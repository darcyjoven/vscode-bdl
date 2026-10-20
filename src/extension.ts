// 扩展入口：激活语言客户端、注册命令。
import * as vscode from "vscode";

import {
  currentBinary,
  logToFile,
  registerConfigWatcher,
  restartClient,
  startClient,
  stopClient,
} from "./client";
import { describeBinary, resolveBinary } from "./server/binary";

/** 首次失败时是否已经提示过，避免每次打开文件都弹窗。 */
let informedFailure = false;

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  registerCommands(context);
  registerConfigWatcher(context);

  // 激活事件是 onLanguage:bdl / onLanguage:per，此时已经有目标文件了。
  const outcome = await startClient(context);
  if (!outcome.ok) {
    await reportStartFailure(context, outcome);
  }

  // 语言已经打开但服务器没起来时，用户手动改完设置还能救回来：
  // 监听一下工作区文件夹变化，尽量自动恢复一次。
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(async () => {
      const result = await restartClient(context);
      if (!result.ok) {
        await reportStartFailure(context, result);
      }
    }),
  );
}

export async function deactivate(): Promise<void> {
  await stopClient(false);
}

/** 注册三条命令：重启、信息、输出。 */
function registerCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("bdl.restartServer", async () => {
      const outcome = await restartClient(context);
      if (outcome.ok) {
        informedFailure = false;
        vscode.window.showInformationMessage("Genero BDL 语言服务器已重启。");
        return;
      }
      await reportStartFailure(context, outcome, true);
    }),

    vscode.commands.registerCommand("bdl.showServerInfo", async () => {
      const running = currentBinary();
      const resolved = resolveBinary();
      const lines: string[] = [];

      lines.push("语言服务器");
      lines.push(`  状态：${running ? "运行中" : "未运行"}`);
      if (running) {
        lines.push(`  路径：${running.command}`);
        lines.push(`  来源：${describeBinary(running)}`);
      } else if (resolved.ok) {
        lines.push(`  可解析路径：${resolved.binary.command}`);
        lines.push(`  来源：${describeBinary(resolved.binary)}`);
      } else {
        lines.push(`  解析失败：${resolved.message}`);
      }

      lines.push("");
      lines.push("设置（bdl.*）");
      const cfg = vscode.workspace.getConfiguration("bdl");
      for (const key of [
        "server.path",
        "server.logLevel",
        "trace.server",
        "generoVersion",
        "syntaxDiagnostics",
        "missingDiagnostics",
        "limits.maxFileBytes",
        "limits.maxFileLines",
        "limits.maxIssues",
        "limits.parseTimeoutMs",
      ]) {
        const value = cfg.get(key);
        const shown =
          value === "" || value === undefined ? "（未设置）" : String(value);
        lines.push(`  bdl.${key} = ${shown}`);
      }

      const doc = await vscode.workspace.openTextDocument({
        content: lines.join("\n"),
        language: "plaintext",
      });
      await vscode.window.showTextDocument(doc, { preview: true });
    }),

    vscode.commands.registerCommand("bdl.showOutput", async () => {
      await vscode.commands.executeCommand(
        "workbench.action.output.showChannel",
      );
    }),
  );
}

/**
 * 汇报启动失败。
 *
 * 首次自动弹出；后续只在用户主动触发（重启命令）时弹出，
 * 避免打开十个文件弹十次。
 */
async function reportStartFailure(
  context: vscode.ExtensionContext,
  outcome: { message?: string; hint?: string },
  force = false,
): Promise<void> {
  const message = outcome.message ?? "语言服务器启动失败";
  logToFile(context, `${message}\n${outcome.hint ?? ""}`);

  if (informedFailure && !force) {
    return;
  }
  informedFailure = true;

  const choice = await vscode.window.showErrorMessage(
    message,
    "查看详情",
    "打开设置",
  );
  if (choice === "查看详情") {
    const body = [message, "", outcome.hint ?? ""].join("\n");
    const doc = await vscode.workspace.openTextDocument({
      content: body,
      language: "plaintext",
    });
    await vscode.window.showTextDocument(doc, { preview: true });
  } else if (choice === "打开设置") {
    await vscode.commands.executeCommand(
      "workbench.action.openSettings",
      "bdl.server.path",
    );
  }
}
