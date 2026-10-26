// 上传当前文件（TODO §0d T4）。
//
// 用户明确：**只允许单文件上传**——传入当前打开文件、按「工作区根 → 生产根」目录
// 映射到生产目录，不做批量同步。真正的传输交给 `tiptop upload`。
//
// 编译/链接/预览不在这里：它们由 `tiptop exec` 在生产服务器上执行（见 build.ts）。
import * as path from "node:path";
import * as vscode from "vscode";

import { ensureDeployConfig } from "./deployconfig";
import { reportRunFailure, runTiptopWithProgress } from "./linktools";
import { uploadEnabled } from "./settings";

let channel: vscode.OutputChannel | undefined;

/** 上传输出通道。 */
function output(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel("Genero BDL 部署");
  }
  return channel;
}

/** 释放输出通道（deactivate 用）。 */
export function disposeDeploy(): void {
  channel?.dispose();
  channel = undefined;
}

/** 上传功能是否可用（`bdl.deploy.enable` + 上传方式不是「不上传」）。 */
export function deployEnabled(): boolean {
  return uploadEnabled();
}

function disabledNotice(): void {
  void vscode.window.showWarningMessage(
    "上传功能未启用：请在设置「上传编译链接」里打开总开关并把上传方式设为 rsync / scp",
  );
}

/** 可上传的文件类型。 */
const DEPLOYABLE = new Set([".4gl", ".global", ".per"]);

function isDeployable(uri: vscode.Uri): boolean {
  return uri.scheme === "file" && DEPLOYABLE.has(path.extname(uri.fsPath).toLowerCase());
}

function workspaceRoot(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  return folders && folders.length > 0 ? folders[0].uri.fsPath : undefined;
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
  const doc = vscode.window.activeTextEditor?.document;
  if (!doc || !isDeployable(doc.uri)) {
    void vscode.window.showWarningMessage("请先打开一个 .4gl / .global / .per 文件");
    return;
  }
  const workspace = workspaceRoot();
  if (!workspace) {
    void vscode.window.showWarningMessage("请先打开一个工作区");
    return;
  }
  // 上传的是磁盘上的文件：先保存脏文档。
  if (doc.isDirty) {
    await doc.save();
  }

  const pkg = vscode.extensions.getExtension("darcyjoven.4gl-full")
    ?.packageJSON as { version?: string } | undefined;
  const version = pkg?.version ?? "0.0.0";
  const synth = await ensureDeployConfig(workspace, version);
  if (!synth.path) {
    output().show(true);
    output().appendLine(synth.error ?? "上传配置生成失败。");
    const pick = await vscode.window.showErrorMessage(
      synth.error ?? "上传配置生成失败。",
      "打开设置",
    );
    if (pick === "打开设置") {
      await vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "bdl.prod.deploy",
      );
    }
    return;
  }
  if (synth.backup) {
    output().appendLine(`原来的 deploy.json 不是本插件生成的，已备份到 ${synth.backup}`);
  }

  const rel = path.relative(workspace, doc.uri.fsPath).split(path.sep).join("/");
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

/** 注册两条上传命令：上传当前文件 / 预演上传。 */
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
  );
}
