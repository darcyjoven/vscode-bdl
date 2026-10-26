// 链接资料命令（P1-1）：从 VSCode 里调用 tiptop，不再让用户自己找可执行文件。
//
// 设计：
//   - **只由用户显式触发**：用户明确要求"不要无感知后台同步"，插件不做定时任务；
//   - 写项目资料的动作**直接执行**（W2：不再预演；预演只留给编译类命令）；
//   - 没配置数据库时给明确提示（打开设置 / 改用 CSV 导入），不静默失败；
//   - 输出进专用通道，"为什么失败"能直接看到。
import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";

import { currentTools } from "./client";
import { refreshDataContexts } from "./dbctx";
import { resolveTools } from "./server/binary";

/** 扩展安装目录，用于定位内置的 tiptop（注册命令时写入）。 */
let extensionPath: string | undefined;

/** 链接资料输出通道。 */
let channel: vscode.OutputChannel | undefined;

function output(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel("Genero BDL 链接资料");
  }
  return channel;
}

/** 扩展停用时释放输出通道。 */
export function disposeLinkTools(): void {
  channel?.dispose();
  channel = undefined;
}

/** 一条进度行（tiptop 的 `进度\t阶段\t详情[\ti\tn]` 协议）。 */
export interface ProgressLine {
  phase: string;
  detail?: string;
  done?: number;
  total?: number;
}

/**
 * 解析 tiptop 的进度行；不是进度行时返回 undefined。
 *
 * 协议见 tiptop/internal/progress：stderr 上以「进度」开头、制表符分隔。
 */
export function parseProgressLine(line: string): ProgressLine | undefined {
  const parts = line.replace(/\r$/, "").split("\t");
  if (parts.length < 2 || parts[0] !== "进度") {
    return undefined;
  }
  const out: ProgressLine = { phase: parts[1] };
  const rest = parts.slice(2);
  if (rest.length >= 2 && /^\d+$/.test(rest[rest.length - 1]) && /^\d+$/.test(rest[rest.length - 2])) {
    out.total = Number(rest.pop());
    out.done = Number(rest.pop());
  }
  const detail = rest.join("\t").trim();
  if (detail) {
    out.detail = detail;
  }
  return out;
}

/** 把进度行转成人话（通知栏里显示的那一行）。 */
export function humanizeProgress(p: ProgressLine): string {
  const d = p.detail ?? "";
  const counter = p.done !== undefined && p.total ? `（${p.done}/${p.total}）` : "";
  switch (p.phase) {
    case "采集":
      return d ? `采集：${d}` : "采集…";
    case "采集完成":
      return `采集完成：${d}`;
    case "扫描源码":
      return d.startsWith("0/") ? `扫描源码：${d}` : `扫描源码 ${p.done}/${p.total}`;
    case "成链":
      return `成链 ${p.done}/${p.total}`;
    case "解析":
      return `解析表 ${d}${counter}`;
    case "清理":
      return `清理表 ${d}${counter}`;
    case "写入":
      return d ? `写入：${d}` : "写入…";
    case "写入完成":
      return `写入完成：${d}`;
    default:
      return d ? `${p.phase}：${d}` : p.phase;
  }
}

/** 带进度回调的 tiptop 运行结果。 */
export interface ProgressRunResult extends RunResult {
  cancelled: boolean;
  /** 本次运行的完整日志文件（有 globalStorage 时才有）。 */
  logPath?: string;
}

/**
 * 运行日志目录（扩展 globalStorage）。由 registerLinkToolCommands 设置。
 *
 * 只保留每个子命令的**最后一次**运行：`last-run-<cmd>.log`。
 */
let runLogDir: string | undefined;

/** 设置运行日志目录（不存在会创建）。 */
export function setRunLogDir(dir: string | undefined): void {
  runLogDir = dir;
  if (dir) {
    void fs.mkdir(dir, { recursive: true }).catch(() => {});
  }
}

/**
 * 失败时统一提示：带 stderr 摘要在通知里，并给「打开日志」「显示输出」两个动作。
 *
 * W7.6：以前只报退出码 + "详见某通道"，而通道可能压根没内容（schema 曾写错通道），
 * 用户拿不到任何线索。现在至少能看到失败原因的首行，并能一键打开完整日志。
 */
export async function reportRunFailure(
  label: string,
  res: ProgressRunResult,
  channel: vscode.OutputChannel,
): Promise<void> {
  const detail = firstLine(res.stderr) || firstLine(res.stdout) || "没有输出";
  const actions: string[] = [];
  if (res.logPath) {
    actions.push("打开日志");
  }
  actions.push("显示输出");
  const pick = await vscode.window.showErrorMessage(
    `${label}失败（退出码 ${res.code ?? "?"}）：${detail}`,
    ...actions,
  );
  if (pick === "打开日志" && res.logPath) {
    try {
      const doc = await vscode.workspace.openTextDocument(
        vscode.Uri.file(res.logPath),
      );
      await vscode.window.showTextDocument(doc, { preview: true });
    } catch {
      channel.show(true);
    }
  } else if (pick === "显示输出") {
    channel.show(true);
  }
}

/** 取第一行非空文本，截断到 300 字符（放进通知里）。 */
function firstLine(text: string): string {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line !== "") {
      return line.length > 300 ? `${line.slice(0, 300)}…` : line;
    }
  }
  return "";
}

/**
 * 把一次 tiptop 运行的完整输出写盘，返回文件路径（写失败返回 undefined）。
 *
 * 名字用 `last-run-<子命令>.log`（link / schema / deploy），每次覆盖：
 * 目的是"报错后能拿到现场"，不是审计历史。异步写，不阻塞命令返回。
 */
function writeRunLog(
  args: string[],
  stdout: string,
  stderr: string,
  code: number | null,
  cancelled: boolean,
): string | undefined {
  if (!runLogDir) {
    return undefined;
  }
  const cmd = (args[0] ?? "tiptop").replace(/[^a-zA-Z0-9_-]/g, "");
  const file = path.join(runLogDir, `last-run-${cmd || "tiptop"}.log`);
  const body = [
    `# Genero BDL 本地运行日志`,
    `# 时间：${new Date().toISOString()}`,
    `# 命令：tiptop ${args.join(" ")}`,
    `# 退出码：${code ?? "?"}${cancelled ? "（已取消）" : ""}`,
    ``,
    `===== stdout =====`,
    stdout,
    `===== stderr =====`,
    stderr,
  ].join("\n");
  void fs.writeFile(file, body, "utf8").catch(() => {});
  return file;
}

/**
 * 运行 tiptop 并**在通知栏显示进度**（P2-1 补：link 与 schema 一致）。
 *
 * 进度来源是 tiptop 的「进度」行（见 parseProgressLine）；其余输出照旧进通道。
 * 可取消：用户点取消时杀掉子进程，返回 cancelled=true（调用方提示"已取消"）。
 */
export async function runTiptopWithProgress(
  root: string,
  args: string[],
  title: string,
  channel?: vscode.OutputChannel,
): Promise<ProgressRunResult> {
  const bin = toolsBinary();
  if (!bin) {
    return { code: null, stdout: "", stderr: "", cancelled: false };
  }
  // 输出写到哪个通道由调用方决定：link 命令写「链接资料」，schema 命令写「数据库字段」。
  // 默认仍是链接通道（保持既有行为），schema 必须显式传自己的通道——
  // 否则报错让用户去「数据库字段」看，内容却在「链接资料」里（W7.5）。
  const out = channel ?? output();
  out.appendLine(`\n> tiptop ${args.join(" ")}`);
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title,
      cancellable: true,
    },
    (progress, token) =>
      new Promise<ProgressRunResult>((resolve) => {
        const child = spawn(bin, args, { cwd: root, windowsHide: true });
        let stdout = "";
        let stderr = "";
        let pending = "";
        const handleChunk = (chunk: Buffer): void => {
          const text = chunk.toString("utf8");
          out.append(text);
          pending += text;
          const lines = pending.split("\n");
          pending = lines.pop() ?? "";
          for (const line of lines) {
            const p = parseProgressLine(line);
            if (p) {
              progress.report({ message: humanizeProgress(p) });
            }
          }
        };
        child.stdout.on("data", (chunk: Buffer) => {
          stdout += chunk.toString("utf8");
          handleChunk(chunk);
        });
        child.stderr.on("data", (chunk: Buffer) => {
          stderr += chunk.toString("utf8");
          handleChunk(chunk);
        });
        let cancelled = false;
        token.onCancellationRequested(() => {
          cancelled = true;
          out.appendLine("已取消。");
          child.kill();
        });
        child.on("error", (err) => {
          out.appendLine(`启动失败：${String(err)}`);
          const logPath = writeRunLog(args, stdout, stderr + String(err), null, cancelled);
          resolve({ code: null, stdout, stderr, cancelled, logPath });
        });
        child.on("close", (code) => {
          out.appendLine(`（退出码 ${code ?? "?"}）`);
          const logPath = writeRunLog(args, stdout, stderr, code, cancelled);
          resolve({ code, stdout, stderr, cancelled, logPath });
        });
      }),
  );
}

/** 一次 tiptop 运行的结果。 */
export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * 定位 `tiptop`：优先用语言服务启动时解析到的那个，其次单独解析一次
 * （与部署命令同一套顺序：内置 bin/ → 设置 → PATH → 工作区）。
 */
export function toolsBinary(): string | undefined {
  const fromServer = currentTools();
  if (fromServer) {
    return fromServer.command;
  }
  const resolved = resolveTools(extensionPath);
  if (resolved.ok) {
    return resolved.binary.command;
  }
  void vscode.window
    .showErrorMessage(`${resolved.message}。${resolved.hint}`, "打开设置")
    .then((pick) => {
      if (pick === "打开设置") {
        void vscode.commands.executeCommand(
          "workbench.action.openSettings",
          "bdl.tools.path",
        );
      }
    });
  return undefined;
}

/** 运行 tiptop，stdout/stderr 实时写进输出通道。 */
async function runTiptop(root: string, args: string[]): Promise<RunResult> {
  return runTiptopOn(output(), root, args);
}

/**
 * 运行 tiptop，输出写进**指定**通道。
 *
 * 数据库字段功能复用同一套二进制解析与执行逻辑，但用自己的通道
 *（两边的日志混在一个通道里不好找）。
 */
export async function runTiptopOn(
  out: vscode.OutputChannel,
  root: string,
  args: string[],
): Promise<RunResult> {
  const bin = toolsBinary();
  if (!bin) {
    return { code: null, stdout: "", stderr: "" };
  }
  out.appendLine(`\n> tiptop ${args.join(" ")}`);
  return new Promise<RunResult>((resolve) => {
    const child = spawn(bin, args, { cwd: root, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stdout += text;
      out.append(text);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stderr += text;
      out.append(text);
    });
    child.on("error", (err) => {
      out.appendLine(`启动失败：${String(err)}`);
      resolve({ code: null, stdout, stderr });
    });
    child.on("close", (code) => {
      out.appendLine(`（退出码 ${code ?? "?"}）`);
      resolve({ code, stdout, stderr });
    });
  });
}

function cfg(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration("bdl");
}

/** 第一个工作区根（资料目录、相对路径都相对它）。 */
export function workspaceRoot(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  return folders && folders.length > 0 ? folders[0].uri.fsPath : undefined;
}

/**
 * `.project` 项目资料根目录（W6）：只放 `secrets.json` 一个文件，
 * link/schema/deploy 各自在它的子目录下。
 */
export const PROJECT_DIR = ".project";

/**
 * 链接资料目录名（相对工作区根）。
 *
 * W6：默认 `.project/link`（旧项目可能在 `.project` 根或 `.link`，
 * 由 bdl-lsp/tiptop 侧回退读取；迁移命令会把它们搬过来）。
 */
export function dataDirName(): string {
  return cfg().get<string>("link.dataDir") || ".project/link";
}

/** 导入用的 CSV 落点（与 tiptop 的默认值一致：`<link 目录>/gal_file.csv`）。 */
function csvPath(root: string): string {
  return path.join(root, dataDirName(), "gal_file.csv");
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

/** Oracle 连接配置（`bdl.prod.oracle.*`；密码不在这里）。 */
export interface OracleCfg {
  host: string;
  port: number;
  service: string;
  user: string;
}

export function oracleCfg(): OracleCfg | undefined {
  const c = cfg();
  const host = (c.get<string>("prod.oracle.host") ?? "").trim();
  const service = (c.get<string>("prod.oracle.service") ?? "").trim();
  const user = (c.get<string>("prod.oracle.user") ?? "").trim();
  if (!host || !service || !user) {
    return undefined;
  }
  return {
    host,
    port: c.get<number>("prod.oracle.port") ?? 1521,
    service,
    user,
  };
}

/** 没配数据库时的统一提示：给"打开设置"与"改用 CSV 导入"两条出路。 */
export async function promptNoOracle(root: string): Promise<void> {
  // W6：secrets.json 始终在 `.project` 根（不随 link 资料目录走）。
  const secrets = path.join(root, PROJECT_DIR, "secrets.json");
  const pick = await vscode.window.showWarningMessage(
    `还没有配置数据库连接：在「Genero BDL: 生产环境」里填主机 / 服务名 / 只读账号，` +
      `密码放 ${secrets}（chmod 600）或环境变量 BDL_ORA_PASSWORD；` +
      `也可以先导出一份 CSV，用「链接资料：从 CSV 导入」更新。`,
    "打开设置",
    "改用 CSV 导入",
  );
  if (pick === "打开设置") {
    await vscode.commands.executeCommand(
      "workbench.action.openSettings",
      "bdl.prod.oracle",
    );
  } else if (pick === "改用 CSV 导入") {
    await vscode.commands.executeCommand("bdl.link.importCsv");
  }
}

/** 当前打开文件的 `-files` 规格（工作区相对路径，正斜杠）。 */
function currentFileSpec(root: string): string | undefined {
  const doc = vscode.window.activeTextEditor?.document;
  if (!doc || doc.uri.scheme !== "file") {
    return undefined;
  }
  const rel = path.relative(root, doc.uri.fsPath);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    return undefined;
  }
  if (!/\.(4gl|global|per)$/i.test(rel)) {
    return undefined;
  }
  return rel.split(path.sep).join("/");
}

/**
 * 从 `link … -dry-run` 的报告里读"受影响作业 N 个（a, b …）"。
 *
 * 解析失败时返回 undefined——调用方会退化成"把输出给用户看、照样确认"，
 * 不因为格式变化就把命令卡死。
 */
export function parseAffectedJobs(
  text: string,
): { count: number; names: string } | undefined {
  const m = /受影响作业\s+(\d+)\s*个(?:（([^）]*)）)?/.exec(text);
  if (!m) {
    return undefined;
  }
  return {
    count: Number(m[1]),
    names: (m[2] ?? "").replace(/…/g, "").trim(),
  };
}

/** 探测可选的模组名：`<root>/<mod>/4gl` 与 `<root>/<顶层>/<mod>/4gl`（不递归）。 */
async function discoverModules(root: string): Promise<string[]> {
  const found = new Set<string>(["sub", "lib", "qry"]);
  const dirs = async (dir: string): Promise<string[]> => {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      return entries
        .filter((e) => e.isDirectory() && !e.name.startsWith("."))
        .map((e) => e.name);
    } catch {
      return [];
    }
  };
  for (const top of await dirs(root)) {
    const topPath = path.join(root, top);
    if (await exists(path.join(topPath, "4gl"))) {
      found.add(top);
    }
    for (const mod of await dirs(topPath)) {
      if (await exists(path.join(topPath, mod, "4gl"))) {
        found.add(mod);
      }
    }
  }
  return [...found].sort();
}

/**
 * 采集类命令的共同流程：**直接执行**（不再预演）→ 刷新视图。
 *
 * W2（Windows 实机反馈）：以前先跑一次 `-dry-run` 拿"受影响 N 个作业"再让用户确认，
 * 但对全量来说 dry-run 本身就要整份扫描/解析——等于跑两遍（实测从文档里的
 * "20–30 秒"变成约 5 分钟）。现在只有编译类命令允许预演：这里一律直接执行，
 * 全量操作保留一次**不重新扫描**的静态确认，避免误触几分钟的任务。
 *
 * @param filterArgs `-files …` / `-modules …`；空数组 = 全量
 * @param label 用户可见的动作名
 */
async function syncWithConfirm(
  root: string,
  filterArgs: string[],
  label: string,
): Promise<void> {
  const oracle = oracleCfg();
  const csv = csvPath(root);
  const haveCsv = await exists(csv);
  if (!oracle && !haveCsv) {
    await promptNoOracle(root);
    return;
  }
  const base = oracle
    ? [
        "link",
        "sync",
        "-root",
        root,
        "-source",
        "golang",
        "-host",
        oracle.host,
        "-port",
        String(oracle.port),
        "-service",
        oracle.service,
        "-user",
        oracle.user,
        ...filterArgs,
      ]
    : ["link", "import", "-csv", csv, "-root", root, ...filterArgs];

  // 全量：一次静态确认（不重新扫描）避免误触；局部更新直接执行。
  if (filterArgs.length === 0) {
    const from = oracle ? "数据库" : "CSV";
    const pick = await vscode.window.showWarningMessage(
      `${label}：将从${from}重算全部链接资料。通常几分钟、也可能更长，` +
        `请开「输出 → Genero BDL 链接资料」看进度。继续？`,
      { modal: true },
      "开始",
    );
    if (pick !== "开始") {
      return;
    }
  }

  const res = await runTiptopWithProgress(root, base, label);
  if (res.cancelled) {
    vscode.window.setStatusBarMessage(`${label}已取消`, 3000);
    return;
  }
  if (res.code !== 0) {
    await reportRunFailure(label, res, output());
    return;
  }
  void vscode.window.showInformationMessage(`${label}完成`);
  await vscode.commands.executeCommand("bdl.links.refresh");
  // W3/W4：资料可能刚生成，刷新"按钮显隐"用到的就绪状态。
  void refreshDataContexts();
}

/** 从 CSV 导入：复制到 `.project/link/gal_file.csv`（覆盖源文件）后导入。 */
async function importCsv(): Promise<void> {
  const root = workspaceRoot();
  if (!root) {
    void vscode.window.showWarningMessage("请先打开一个工作区");
    return;
  }
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    title: "选择 DS.GAL_FILE 导出（CSV）",
    filters: { CSV: ["csv"] },
  });
  if (!picked || picked.length === 0) {
    return;
  }
  const dest = csvPath(root);
  try {
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(picked[0].fsPath, dest);
  } catch (err) {
    void vscode.window.showErrorMessage(
      `复制 CSV 到 ${dest} 失败：${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }
  const spec = currentFileSpec(root);
  const items = spec ? ["全量导入", "只更新当前文件", "取消"] : ["全量导入", "取消"];
  const pick = await vscode.window.showInformationMessage(
    `已把 CSV 复制到 ${path.relative(root, dest)}。`,
    { modal: true },
    ...items,
  );
  if (!pick || pick === "取消") {
    return;
  }
  const args =
    pick === "只更新当前文件" && spec
      ? ["link", "import", "-csv", dest, "-root", root, "-files", spec]
      : ["link", "import", "-csv", dest, "-root", root];
  const res = await runTiptopWithProgress(root, args, "链接资料导入");
  if (res.cancelled) {
    vscode.window.setStatusBarMessage("链接资料导入已取消", 3000);
    return;
  }
  if (res.code !== 0) {
    await reportRunFailure("链接资料导入", res, output());
    return;
  }
  void vscode.window.showInformationMessage("链接资料导入完成");
  await vscode.commands.executeCommand("bdl.links.refresh");
  void refreshDataContexts();
}

/** 更新当前打开文件相关的链接资料。 */
async function syncCurrent(): Promise<void> {
  const root = workspaceRoot();
  if (!root) {
    void vscode.window.showWarningMessage("请先打开一个工作区");
    return;
  }
  const spec = currentFileSpec(root);
  if (!spec) {
    void vscode.window.showWarningMessage(
      "请先打开一个 .4gl / .global / .per 文件（按当前文件更新链接资料）",
    );
    return;
  }
  await syncWithConfirm(root, ["-files", spec], `更新当前文件（${spec}）`);
}

/** 按模组更新（多选）。 */
async function syncModules(): Promise<void> {
  const root = workspaceRoot();
  if (!root) {
    void vscode.window.showWarningMessage("请先打开一个工作区");
    return;
  }
  const modules = await discoverModules(root);
  const picked = await vscode.window.showQuickPick(modules, {
    canPickMany: true,
    title: "选择要更新的模组（其余作业的链保留）",
    placeHolder: modules.join(", "),
  });
  if (!picked || picked.length === 0) {
    return;
  }
  await syncWithConfirm(
    root,
    ["-modules", picked.join(",")],
    `按模组更新（${picked.join(",")}）`,
  );
}

/** 全量更新（会重扫全语料判定 MAIN，提示耗时）。 */
async function syncAll(): Promise<void> {
  const root = workspaceRoot();
  if (!root) {
    void vscode.window.showWarningMessage("请先打开一个工作区");
    return;
  }
  await syncWithConfirm(root, [], "全量更新");
}

/** 查看资料统计。 */
async function showStatus(): Promise<void> {
  const root = workspaceRoot();
  if (!root) {
    void vscode.window.showWarningMessage("请先打开一个工作区");
    return;
  }
  const res = await runTiptop(root, ["link", "status", "-root", root]);
  output().show(true);
  if (res.code !== 0) {
    void vscode.window.showWarningMessage(
      `查看链接资料状态失败（退出码 ${res.code ?? "?"}）：详见输出通道`,
    );
  }
}

/** 注册链接资料命令（P1-1）。 */
export function registerLinkToolCommands(
  context: vscode.ExtensionContext,
): void {
  extensionPath = context.extensionPath;
  // W7.7：把每次运行的完整输出落盘，输出通道被清或编辑器重启后仍能回看。
  setRunLogDir(context.globalStorageUri.fsPath);
  context.subscriptions.push(
    output(),
    vscode.commands.registerCommand("bdl.link.importCsv", () => importCsv()),
    vscode.commands.registerCommand("bdl.link.syncCurrent", () => syncCurrent()),
    vscode.commands.registerCommand("bdl.link.syncModules", () => syncModules()),
    vscode.commands.registerCommand("bdl.link.syncAll", () => syncAll()),
    vscode.commands.registerCommand("bdl.link.status", () => showStatus()),
    // 「反查引用程序」旁边的"重新同步"：语义就是"更新当前文件的资料"。
    vscode.commands.registerCommand("bdl.links.resync", () => syncCurrent()),
    // W3：视图标题栏的「从数据库更新」按钮（等同"更新当前文件"；门控见 package.json）。
    vscode.commands.registerCommand("bdl.link.updateFromDb", () => syncCurrent()),
  );
}

/** 供 e2e 使用：当前能否解析到 tiptop（解析失败返回空串）。 */
export function toolsPath(): string {
  const resolved = resolveTools(extensionPath);
  return resolved.ok ? resolved.binary.command : "";
}