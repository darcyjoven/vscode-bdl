// 扩展入口：激活语言客户端、注册命令。
import * as vscode from "vscode";

import {
  currentBinary,
  currentClient,
  logToFile,
  registerConfigWatcher,
  restartClient,
  startClient,
  stopClient,
} from "./client";
import { describeBinary, resolveBinary } from "./server/binary";
import { disposeDeploy, registerDeployCommands } from "./deploy";
import { registerLinks } from "./links";
import {
  disposeLinkTools,
  parseAffectedJobs,
  registerLinkToolCommands,
  toolsPath,
} from "./linktools";

/** 首次失败时是否已经提示过，避免每次打开文件都弹窗。 */
let informedFailure = false;

/** 供 e2e 使用的导出 API（activate 的返回值）。 */
interface ExtensionApi {
  /** 解析 `link … -dry-run` 报告里的"受影响作业 N 个"（P1-1）。 */
  parseAffectedJobs: typeof parseAffectedJobs;
  /** 当前解析到的 tiptop 路径（解析不出为空串）。 */
  toolsPath: typeof toolsPath;
}

export async function activate(
  context: vscode.ExtensionContext,
): Promise<ExtensionApi> {
  registerCommands(context);
  registerDeployCommands(context);
  registerLinks(context);
  // P1-1：链接资料的采集/导入/状态命令（调用 tiptop，不再让用户自己找可执行文件）
  registerLinkToolCommands(context);
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

  return { parseAffectedJobs, toolsPath };
}

export async function deactivate(): Promise<void> {
  disposeDeploy();
  disposeLinkTools();
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
      const resolved = resolveBinary(context.extensionPath);
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
        "link.enable",
        "deploy.enable",
        "diagnostics",
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

    vscode.commands.registerCommand("bdl.forceParseCurrentFile", async () => {
      await forceParseCurrentFile();
    }),
  );

  registerParseSkippedContext(context);
}

/**
 * 强制解析当前文件。
 *
 * 服务端在文件超过 bdl.limits.maxFileBytes / maxFileLines、或解析超时时会
 * 跳过解析，只发一条 `file-too-large` / `parse-timeout` 警告（见 PLAN P0-3）。
 * 这个命令让它忽略上限解析当前文件——**直到该文件被关闭**（用户确认的语义）。
 */
async function forceParseCurrentFile(): Promise<void> {
  const doc = vscode.window.activeTextEditor?.document;
  if (!doc) {
    void vscode.window.showWarningMessage("没有打开的文件");
    return;
  }
  const client = currentClient();
  if (!client) {
    void vscode.window.showWarningMessage(
      "语言服务器未运行，无法强制解析当前文件",
    );
    return;
  }
  try {
    await client.sendRequest("bdl/forceParse", { uri: doc.uri.toString() });
    vscode.window.setStatusBarMessage(
      "已强制解析当前文件（关闭该文件后失效）",
      5000,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(`强制解析失败：${msg}`);
  }
}

/**
 * 维护 `bdl.parseSkipped` 上下文：只有服务端明确说"这个文件没被解析"
 * （file-too-large / parse-timeout）时，编辑器标题栏才显示"强制解析"按钮，
 * 免得每个 .4gl 都挂一个没用的图标。文件被解析后诊断变化，按钮自动消失。
 */
function registerParseSkippedContext(
  context: vscode.ExtensionContext,
): void {
  const refresh = (): void => {
    const uri = vscode.window.activeTextEditor?.document.uri;
    const skipped = uri
      ? vscode.languages
          .getDiagnostics(uri)
          .some((d) => d.code === "file-too-large" || d.code === "parse-timeout")
      : false;
    void vscode.commands.executeCommand("setContext", "bdl.parseSkipped", skipped);
  };
  context.subscriptions.push(
    vscode.languages.onDidChangeDiagnostics(refresh),
    vscode.window.onDidChangeActiveTextEditor(refresh),
  );
  refresh();
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
