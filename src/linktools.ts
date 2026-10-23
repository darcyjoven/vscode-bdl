// 链接资料命令（P1-1）：从 VSCode 里调用 tiptop，不再让用户自己找可执行文件。
//
// 设计：
//   - **只由用户显式触发**：用户明确要求"不要无感知后台同步"，插件不做定时任务；
//   - 会写项目资料的动作先用 `-dry-run` 拿到"受影响作业 N 个"，确认后再真跑；
//   - 没配置数据库时给明确提示（打开设置 / 改用 CSV 导入），不静默失败；
//   - 输出进专用通道，"为什么失败"能直接看到。
import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";

import { currentTools } from "./client";
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

/** 一次 tiptop 运行的结果。 */
interface RunResult {
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
  const bin = toolsBinary();
  if (!bin) {
    return { code: null, stdout: "", stderr: "" };
  }
  const out = output();
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
function workspaceRoot(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  return folders && folders.length > 0 ? folders[0].uri.fsPath : undefined;
}

/** 项目资料目录名（默认 `.project`，旧项目可能配了 `.link`）。 */
function dataDirName(): string {
  return cfg().get<string>("link.dataDir") || ".project";
}

/** 导入用的 CSV 落点（与 tiptop 的默认值一致）。 */
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
interface OracleCfg {
  host: string;
  port: number;
  service: string;
  user: string;
}

function oracleCfg(): OracleCfg | undefined {
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
async function promptNoOracle(root: string): Promise<void> {
  const secrets = path.join(root, dataDirName(), "secrets.json");
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
 * 采集类命令的共同流程：dry-run 拿影响面 → 用户确认 → 真跑 → 刷新视图。
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

  const dry = await runTiptop(root, [...base, "-dry-run"]);
  if (dry.code !== 0) {
    output().show(true);
    void vscode.window.showErrorMessage(
      `${label}预演失败（退出码 ${dry.code ?? "?"}）：详见「Genero BDL 链接资料」输出通道`,
    );
    return;
  }
  const affected = parseAffectedJobs(dry.stdout);
  if (affected && affected.count === 0) {
    void vscode.window.showInformationMessage(
      `${label}：没有匹配到任何作业（这个文件可能不属于任何链接链）`,
    );
    return;
  }
  const scope = affected
    ? `将更新 ${affected.count} 个作业${affected.names ? `：${affected.names}` : ""}（其余链保留）`
    : "未能从输出解析出影响面（请看输出通道），仍要继续吗";
  const pick = await vscode.window.showWarningMessage(
    `${label}：${scope}。继续？`,
    { modal: true },
    "更新",
  );
  if (pick !== "更新") {
    return;
  }
  const res = await runTiptop(root, base);
  if (res.code !== 0) {
    output().show(true);
    void vscode.window.showErrorMessage(
      `${label}失败（退出码 ${res.code ?? "?"}）：详见「Genero BDL 链接资料」输出通道`,
    );
    return;
  }
  void vscode.window.showInformationMessage(`${label}完成`);
  await vscode.commands.executeCommand("bdl.links.refresh");
}

/** 从 CSV 导入：复制到 `.project/gal_file.csv`（覆盖源文件）后导入。 */
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
  const res = await runTiptop(root, args);
  if (res.code !== 0) {
    output().show(true);
    void vscode.window.showErrorMessage(
      `导入失败（退出码 ${res.code ?? "?"}）：详见「Genero BDL 链接资料」输出通道`,
    );
    return;
  }
  void vscode.window.showInformationMessage("链接资料导入完成");
  await vscode.commands.executeCommand("bdl.links.refresh");
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
  context.subscriptions.push(
    output(),
    vscode.commands.registerCommand("bdl.link.importCsv", () => importCsv()),
    vscode.commands.registerCommand("bdl.link.syncCurrent", () => syncCurrent()),
    vscode.commands.registerCommand("bdl.link.syncModules", () => syncModules()),
    vscode.commands.registerCommand("bdl.link.syncAll", () => syncAll()),
    vscode.commands.registerCommand("bdl.link.status", () => showStatus()),
    // 「反查引用程序」旁边的"重新同步"：语义就是"更新当前文件的资料"。
    vscode.commands.registerCommand("bdl.links.resync", () => syncCurrent()),
  );
}

/** 供 e2e 使用：当前能否解析到 tiptop（解析失败返回空串）。 */
export function toolsPath(): string {
  const resolved = resolveTools(extensionPath);
  return resolved.ok ? resolved.binary.command : "";
}