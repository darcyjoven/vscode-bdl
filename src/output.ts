// 统一输出通道（清理项 C6）：从 6 个通道收敛成 2 个。
//
//   4gl       —— 语言服务器日志 + LSP 追踪（同一通道）
//   4gl 任务  —— 链接资料 / 数据库字段 / 上传 / 编译·链接·预览（tiptop 输出）
//
// 合并后仍能区分来源：每次任务运行前会写一行 `> tiptop <子命令> …`（见
// runTiptopWithProgress），且完整输出另落盘到 globalStorage 的
// `last-run-<cmd>.log`（失败通知上的「打开日志」直接开它）。
import * as vscode from "vscode";

/** 语言服务器日志/追踪通道（deactivate 时释放）。 */
let server: vscode.LogOutputChannel | undefined;
/** 任务输出通道（deactivate 时释放）。 */
let task: vscode.OutputChannel | undefined;

/** 语言服务器日志与 LSP 追踪共用的通道。 */
export function serverChannel(): vscode.LogOutputChannel {
  if (!server) {
    server = vscode.window.createOutputChannel("4gl", { log: true });
  }
  return server;
}

/** 任务输出通道：链接资料 / 数据库字段 / 上传 / 编译链接预览共用。 */
export function taskChannel(): vscode.OutputChannel {
  if (!task) {
    task = vscode.window.createOutputChannel("4gl 任务");
  }
  return task;
}

/** 释放两个通道（扩展停用）。 */
export function disposeOutput(): void {
  server?.dispose();
  server = undefined;
  task?.dispose();
  task = undefined;
}
