// 初始化项目（从生产服务器拉取代码）—— bdl.initProject
//
// 设计（2026-10-26 与用户确认）：
//   - 按**扩展宿主平台**分派脚本：Windows → init-project.ps1；其它（含 VSCode Remote-WSL/Remote-SSH）→ init-project.sh；
//     命令里先问一次"用哪个脚本"（自动 / 强制 bash / 强制 powershell）。
//   - 收集参数（SSH 目标、生产根、目标目录、选项、编码；上次值预填，存 workspaceState，不存密码）后，
//     **在集成终端里执行**脚本 —— 进度/编码确认等交互都在终端里完成，用户能看到完整过程。
//   - 命令会写入「Genero BDL 任务」输出通道，便于复制重跑；脚本路径取扩展安装目录的 scripts/init-project/。
import * as path from "node:path";
import * as vscode from "vscode";

import { taskChannel } from "./output";

/** 用户选择的脚本口味。 */
export type ScriptFlavor = "auto" | "bash" | "powershell";

/** 传给脚本的参数。 */
export interface InitProjectOptions {
  target: string;
  remoteRoot: string;
  dest: string;
  module?: string;
  update?: boolean;
  deleteLocal?: boolean;
  noCommit?: boolean;
  dryRun?: boolean;
  /** 源编码；空 = 自动（脚本取样检测后在终端里问你） */
  fromEncoding?: string;
  /** 没配密钥时允许改用密码登录（只有初始化脚本；上传/编译仍需密钥） */
  allowPassword?: boolean;
}

/** 按宿主平台决定实际用哪个脚本（纯函数，便于 e2e 断言）。 */
export function scriptFlavorFor(
  platform: NodeJS.Platform,
  choice: ScriptFlavor,
): "bash" | "powershell" {
  if (choice === "bash" || choice === "powershell") {
    return choice;
  }
  return platform === "win32" ? "powershell" : "bash";
}

/** POSIX 单引号：把任意字符串安全放进 shell 命令行。 */
function shellSingleQuote(value: string): string {
  return `'${value.split("'").join(`'\\''`)}'`;
}

/** PowerShell/cmd 双引号：替换内部双引号（少见；路径里一般没有）。 */
function psDoubleQuote(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

/**
 * 组装终端里要执行的命令行（纯函数，供 e2e 断言）。
 *
 * - bash：`bash '<脚本>' --target '<值>' …`（单引号转义，路径含空格/引号都安全）
 * - powershell：`powershell -NoProfile -ExecutionPolicy Bypass -File "<脚本>" -Target "<值>" …`
 *
 * 不传 `--yes`/`-Yes`：这是在终端里交互跑，编码确认/删除确认都让脚本自己问。
 */
export function buildInitProjectCommandLine(
  flavor: "bash" | "powershell",
  extensionPath: string,
  opts: InitProjectOptions,
): string {
  if (flavor === "powershell") {
    const script = path.join(
      extensionPath,
      "scripts",
      "init-project",
      "init-project.ps1",
    );
    const parts = [
      "powershell",
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      psDoubleQuote(script),
      "-Target",
      psDoubleQuote(opts.target),
      "-RemoteRoot",
      psDoubleQuote(opts.remoteRoot),
      "-Dest",
      psDoubleQuote(opts.dest),
    ];
    if (opts.module) parts.push("-Module", psDoubleQuote(opts.module));
    if (opts.update) parts.push("-Update");
    if (opts.deleteLocal) parts.push("-Delete");
    if (opts.noCommit) parts.push("-NoCommit");
    if (opts.dryRun) parts.push("-DryRun");
    if (opts.fromEncoding) parts.push("-FromEncoding", psDoubleQuote(opts.fromEncoding));
    if (opts.allowPassword) parts.push("-AskPassword");
    return parts.join(" ");
  }
  const script = path.join(
    extensionPath,
    "scripts",
    "init-project",
    "init-project.sh",
  );
  const parts = [
    "bash",
    shellSingleQuote(script),
    "--target",
    shellSingleQuote(opts.target),
    "--remote-root",
    shellSingleQuote(opts.remoteRoot),
    "--dest",
    shellSingleQuote(opts.dest),
  ];
  if (opts.module) parts.push("--module", shellSingleQuote(opts.module));
  if (opts.update) parts.push("--update");
  if (opts.deleteLocal) parts.push("--delete");
  if (opts.noCommit) parts.push("--no-commit");
  if (opts.dryRun) parts.push("--dry-run");
  if (opts.fromEncoding) parts.push("--from-encoding", shellSingleQuote(opts.fromEncoding));
  if (opts.allowPassword) parts.push("--ask-password");
  return parts.join(" ");
}

/** 注册命令：bdl.initProject。 */
export function registerInitProject(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("bdl.initProject", () => runWizard(context)),
  );
}

const STATE_KEY = "bdl.initProject.last";

async function runWizard(context: vscode.ExtensionContext): Promise<void> {
  const last =
    context.workspaceState.get<Partial<InitProjectOptions>>(STATE_KEY) ?? {};
  const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  const autoLabel =
    process.platform === "win32"
      ? "自动（本机是 Windows → PowerShell 脚本）"
      : "自动（本机是 Linux/macOS/WSL → bash 脚本）";
  const flavorPick = await vscode.window.showQuickPick(
    [
      { label: autoLabel, value: "auto" as ScriptFlavor },
      { label: "强制用 bash 脚本（rsync 拉取）", value: "bash" as ScriptFlavor },
      {
        label: "强制用 PowerShell 脚本（tar + scp 回传）",
        value: "powershell" as ScriptFlavor,
      },
    ],
    { title: "初始化项目：用哪个脚本？", ignoreFocusOut: true },
  );
  if (!flavorPick) {
    return;
  }
  const flavor = scriptFlavorFor(process.platform, flavorPick.value);

  const target = await vscode.window.showInputBox({
    title: "初始化项目（1/4）：SSH 目标",
    prompt:
      "user@host 或 ~/.ssh/config 别名；有密钥优先用密钥；没配密钥时可在过程中输入密码（上传/编译仍需密钥）",
    value: last.target ?? "",
    ignoreFocusOut: true,
  });
  if (!target) {
    return;
  }
  const remoteRoot = await vscode.window.showInputBox({
    title: "初始化项目（2/4）：生产根目录",
    prompt: "只取该目录下的 *.4gl / *.per / *.global（默认 /u1/topprod）",
    value: last.remoteRoot ?? "/u1/topprod",
    ignoreFocusOut: true,
  });
  if (!remoteRoot) {
    return;
  }

  let dest = last.dest ?? wsRoot ?? "";
  const destPick = await vscode.window.showQuickPick(
    [
      ...(wsRoot
        ? [{ label: "当前工作区", description: wsRoot, value: wsRoot }]
        : []),
      { label: "选择文件夹…", value: "__pick__" },
    ],
    { title: "初始化项目（3/4）：拉到哪里？", ignoreFocusOut: true },
  );
  if (!destPick) {
    return;
  }
  if (destPick.value === "__pick__") {
    const picked = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      openLabel: "选择目标目录",
    });
    if (!picked || picked.length === 0) {
      return;
    }
    dest = picked[0].fsPath;
  } else {
    dest = destPick.value;
  }

  const optPick = await vscode.window.showQuickPick(
    [
      { label: "增量更新（--update）", value: "update", picked: true },
      {
        label: "删除本地多余源文件（--delete；默认不删，脚本会再确认）",
        value: "delete",
        picked: false,
      },
      { label: "不自动提交（--no-commit）", value: "nocommit", picked: false },
      { label: "只预演（--dry-run，不落盘）", value: "dryrun", picked: false },
      {
        label: "允许在过程中输入密码（没配密钥时；上传/编译仍需密钥）",
        value: "askpass",
        picked: true,
      },
    ],
    {
      title: "初始化项目（4/4）：选项（可多选）",
      canPickMany: true,
      ignoreFocusOut: true,
    },
  );
  if (!optPick) {
    return;
  }
  const values = new Set(optPick.map((p) => p.value));
  const encPick = await vscode.window.showQuickPick(
    [
      { label: "自动：按服务器样本检测（终端里会显示报告并问你）", value: "" },
      { label: "GBK → UTF-8（不再询问）", value: "gbk" },
      { label: "BIG5 → UTF-8（不再询问）", value: "big5" },
      { label: "不转码（保持字节原样）", value: "utf-8" },
    ],
    { title: "初始化项目：源编码", ignoreFocusOut: true },
  );
  if (!encPick) {
    return;
  }

  const opts: InitProjectOptions = {
    target: target.trim(),
    remoteRoot: remoteRoot.trim(),
    dest,
    update: values.has("update"),
    deleteLocal: values.has("delete"),
    noCommit: values.has("nocommit"),
    dryRun: values.has("dryrun"),
    fromEncoding: encPick.value || undefined,
    allowPassword: values.has("askpass"),
  };
  await context.workspaceState.update(STATE_KEY, {
    target: opts.target,
    remoteRoot: opts.remoteRoot,
    dest: opts.dest,
  });

  const commandLine = buildInitProjectCommandLine(
    flavor,
    context.extensionPath,
    opts,
  );
  const out = taskChannel();
  out.appendLine(
    `\n> ${commandLine}\n（在终端里执行；进度与确认都在终端里完成）`,
  );

  const cwd = opts.dest && (await exists(opts.dest)) ? opts.dest : path.dirname(opts.dest);
  const terminal = vscode.window.createTerminal({
    name: "初始化项目",
    cwd: cwd || undefined,
  });
  terminal.show(true);
  terminal.sendText(commandLine, true);
}

async function exists(p: string): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(vscode.Uri.file(p));
    return true;
  } catch {
    return false;
  }
}
