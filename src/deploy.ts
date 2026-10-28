// 上传 / 下载当前文件（TODO §0d T4/T5）。
//
// 用户明确：**只允许单文件操作**——传入当前打开文件、按「工作区根 → 生产根」目录
// 映射，不做批量同步。真正的传输交给 `tiptop upload` / `tiptop download`。
//
// 编译/链接/预览不在这里：它们由 `tiptop exec` 在生产服务器上执行（见 build.ts）。
import { spawn } from "node:child_process";
import * as path from "node:path";
import * as vscode from "vscode";

import { ensureDeployConfig } from "./deployconfig";
import { reportRunFailure, runTiptopWithProgress } from "./linktools";
import { taskChannel } from "./output";
import { uploadEnabled } from "./settings";

/** 任务输出通道（清理项 C6：与链接资料/字段/编译共用一个通道）。 */
function output(): vscode.OutputChannel {
  return taskChannel();
}

/** 上传/下载功能是否可用（`bdl.deploy.enable` + 上传方式不是「不上传」）。 */
export function deployEnabled(): boolean {
  return uploadEnabled();
}

function disabledNotice(): void {
  void vscode.window.showWarningMessage(
    "上传 / 下载功能未启用：请在设置「上传编译链接」里打开总开关并把上传方式设为 rsync / scp",
  );
}

/** 可上传/下载的文件类型。 */
const DEPLOYABLE = new Set([".4gl", ".global", ".per"]);

function isDeployable(uri: vscode.Uri): boolean {
  return uri.scheme === "file" && DEPLOYABLE.has(path.extname(uri.fsPath).toLowerCase());
}

function workspaceRoot(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  return folders && folders.length > 0 ? folders[0].uri.fsPath : undefined;
}

/** 上传 / 下载的共同前置：当前文件、工作区、相对路径。 */
interface DeployTarget {
  doc: vscode.TextDocument;
  workspace: string;
  /** 相对工作区根，正斜杠（tiptop 的 -file 参数）。 */
  rel: string;
}

function currentDeployTarget(): DeployTarget | undefined {
  const doc = vscode.window.activeTextEditor?.document;
  if (!doc || !isDeployable(doc.uri)) {
    void vscode.window.showWarningMessage("请先打开一个 .4gl / .global / .per 文件");
    return undefined;
  }
  const workspace = workspaceRoot();
  if (!workspace) {
    void vscode.window.showWarningMessage("请先打开一个工作区");
    return undefined;
  }
  const rel = path.relative(workspace, doc.uri.fsPath).split(path.sep).join("/");
  return { doc, workspace, rel };
}

/**
 * 按当前设置生成 `.project/deploy/deploy.json`；失败时打开设置面板。
 *
 * 上传与下载共用同一份配置：账号/生产根/传输方式都来自「上传编译链接」。
 */
async function prepareDeployConfig(workspace: string): Promise<boolean> {
  const pkg = vscode.extensions.getExtension("darcyjoven.4gl-full")
    ?.packageJSON as { version?: string } | undefined;
  const version = pkg?.version ?? "0.0.0";
  const synth = await ensureDeployConfig(workspace, version);
  if (!synth.path) {
    output().show(true);
    output().appendLine(synth.error ?? "部署配置生成失败。");
    const pick = await vscode.window.showErrorMessage(
      synth.error ?? "部署配置生成失败。",
      "打开设置",
    );
    if (pick === "打开设置") {
      await vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "bdl.prod.deploy",
      );
    }
    return false;
  }
  if (synth.backup) {
    output().appendLine(`原来的 deploy.json 不是本插件生成的，已备份到 ${synth.backup}`);
  }
  return true;
}

/**
 * 文件是否有未提交的差异（工作区/暂存区改动，或未跟踪）。
 *
 * 用 `git status --porcelain` 而不是 VSCode 的 Git 扩展 API：后者要处理
 * 多仓库、API 版本差异，而这里只需要一个布尔值。git 不可用或不在仓库里时
 * 返回 false——不能因为检测不了就堵住下载。
 */
function hasUncommittedChanges(workspace: string, rel: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const child = spawn("git", ["status", "--porcelain", "--", rel], {
      cwd: workspace,
      windowsHide: true,
    });
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0 && stdout.trim() !== ""));
  });
}

/**
 * 上传（或预演上传）当前文件。
 *
 * @param dryRun 只打印计划、不连接（`tiptop upload -dry-run`）
 */
async function uploadCurrentFile(dryRun: boolean): Promise<void> {
  if (!deployEnabled()) {
    disabledNotice();
    return;
  }
  const target = currentDeployTarget();
  if (!target) {
    return;
  }
  const { doc, workspace, rel } = target;
  // 上传的是磁盘上的文件：先保存脏文档。
  if (doc.isDirty) {
    await doc.save();
  }
  if (!(await prepareDeployConfig(workspace))) {
    return;
  }

  const title = dryRun ? "预演上传（当前文件）" : "上传当前文件";
  const args = ["upload", "-workspace", workspace, "-file", rel];
  if (dryRun) {
    args.push("-dry-run");
  }
  const res = await runTiptopWithProgress(workspace, args, title, output());
  if (res.cancelled) {
    vscode.window.setStatusBarMessage(`${title}已取消`, 3000);
    return;
  }
  if (res.code !== 0) {
    await reportRunFailure(title, res, output());
    return;
  }
  void vscode.window.showInformationMessage(
    dryRun ? "预演上传完成（未连接服务器）" : `已上传当前文件：${rel}`,
  );
}

/**
 * 下载当前文件，覆盖本地同名文件。
 *
 * 覆盖前检查本地是否有未提交差异（含编辑器里未保存的修改）：有就先弹模态框确认，
 * 用户同意才继续——下载会丢掉这些本地内容。
 */
async function downloadCurrentFile(): Promise<void> {
  if (!deployEnabled()) {
    disabledNotice();
    return;
  }
  const target = currentDeployTarget();
  if (!target) {
    return;
  }
  const { doc, workspace, rel } = target;

  const dirty = doc.isDirty || (await hasUncommittedChanges(workspace, rel));
  if (dirty) {
    const pick = await vscode.window.showWarningMessage(
      "当前有差异未提交，是否忽略差异并下载覆盖?",
      { modal: true },
      "忽略差异并下载覆盖",
    );
    if (pick !== "忽略差异并下载覆盖") {
      return;
    }
  }
  if (!(await prepareDeployConfig(workspace))) {
    return;
  }

  const title = "下载当前文件";
  const args = ["download", "-workspace", workspace, "-file", rel];
  const res = await runTiptopWithProgress(workspace, args, title, output());
  if (res.cancelled) {
    vscode.window.setStatusBarMessage(`${title}已取消`, 3000);
    return;
  }
  if (res.code !== 0) {
    await reportRunFailure(title, res, output());
    return;
  }
  // 未保存的编辑器缓冲不会被磁盘变化自动覆盖，显式 revert 才能看到新内容。
  // （用户已确认“忽略差异”；下载失败时走不到这里，本地修改不会丢。）
  if (doc.isDirty) {
    await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: true });
    await vscode.commands.executeCommand("workbench.action.files.revert");
  }
  void vscode.window.showInformationMessage(`已下载并覆盖当前文件：${rel}`);
}

/** 注册三条命令：上传当前文件 / 预演上传 / 下载当前文件。 */
export function registerDeployCommands(
  context: vscode.ExtensionContext,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("bdl.deployCurrentFile", () =>
      uploadCurrentFile(false),
    ),
    vscode.commands.registerCommand("bdl.deployDryRun", () =>
      uploadCurrentFile(true),
    ),
    vscode.commands.registerCommand("bdl.downloadCurrentFile", () =>
      downloadCurrentFile(),
    ),
  );
}
