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
import {
  buildCommandFor,
  buildPlaceholders,
  disposeBuild,
  expandBuildTemplate,
  hasMainProgram,
  registerBuild,
} from "./build";
import {
  readDbReadiness,
  refreshDataContexts,
  registerDataContextWatcher,
} from "./dbctx";
import { describeBinary, resolveBinary } from "./server/binary";
import { disposeDeploy, registerDeployCommands } from "./deploy";
import { registerLinks } from "./links";
import { ensureDeployConfig, readDeployValues } from "./deployconfig";
import {
  disposeLinkTools,
  humanizeProgress,
  parseAffectedJobs,
  parseProgressLine,
  registerLinkToolCommands,
  toolsPath,
} from "./linktools";
import {
  disposeSchemaView,
  parseSchemaSummary,
  querySchemaColumns,
  querySchemaTables,
  registerSchemaView,
  type SchemaProviderApi,
} from "./schema";

/** 首次失败时是否已经提示过，避免每次打开文件都弹窗。 */
let informedFailure = false;

/** `bdl/parseDone` 通知的参数（与 bdl-lsp internal/server 的 parseDoneParams 对应）。 */
interface ParseDoneParams {
  uri: string;
  ms: number;
  bytes: number;
  version: number;
  ok: boolean;
  error?: string;
}

/**
 * W1：等待"后台强制解析完成"以刷新大纲的文件。
 *
 * 服务端对强制解析的文件在每次**全量重解析**后都会发 `bdl/parseDone`
 * （包括我们自己刷新大纲引起的重解析），所以必须只在用户显式点过
 * "强制解析"之后刷新一次，否则会和刷新动作互相触发死循环。
 */
const pendingOutlineRefresh = new Set<string>();
let parseDoneSub: vscode.Disposable | undefined;

/** 供 e2e 使用的导出 API（activate 的返回值）。 */
interface ExtensionApi {
  /** 解析 `link … -dry-run` 报告里的"受影响作业 N 个"（P1-1）。 */
  parseAffectedJobs: typeof parseAffectedJobs;
  /** 当前解析到的 tiptop 路径（解析不出为空串）。 */
  toolsPath: typeof toolsPath;
  /** 把「生产环境 → 部署」设置合成为 `<root>/.project/deploy/deploy.json`（P1-5/W6）。 */
  ensureDeployConfig: typeof ensureDeployConfig;
  /** 读出当前部署设置（e2e 校验用）。 */
  readDeployValues: typeof readDeployValues;
  /** 解析 tiptop 的进度行（e2e 校验协议）。 */
  parseProgressLine: typeof parseProgressLine;
  /** 进度行转人话（e2e 校验文案）。 */
  humanizeProgress: typeof humanizeProgress;
  /** 查表清单（e2e 校验字段资料端到端可用）。 */
  querySchemaTables: typeof querySchemaTables;
  /** 查单表列（e2e 用）。 */
  querySchemaColumns: typeof querySchemaColumns;
  /** 解析 `schema … -dry-run` 报告里的统计（e2e 用）。 */
  parseSchemaSummary: typeof parseSchemaSummary;
  /** 「数据库字段」视图的 provider（e2e 用来验证勾选/全选）。 */
  schemaProvider: SchemaProviderApi;
  /** W3/W4：数据库/资料就绪状态（e2e 用来断言门控条件）。 */
  dbReadiness: typeof readDbReadiness;
  /** W5：模板占位符展开（e2e 用来验证 `${path}` 等语义）。 */
  expandBuildTemplate: typeof expandBuildTemplate;
  /** W5：计算当前文档的四个占位符（e2e 用）。 */
  buildPlaceholders: typeof buildPlaceholders;
  /** W5：MAIN 程序块判定（e2e 用）。 */
  hasMainProgram: typeof hasMainProgram;
  /** W5：当前设置下的命令模板（e2e 用）。 */
  buildCommandFor: typeof buildCommandFor;
}

export async function activate(
  context: vscode.ExtensionContext,
): Promise<ExtensionApi> {
  registerCommands(context);
  registerDeployCommands(context);
  registerLinks(context);
  // P1-1：链接资料的采集/导入/状态命令（调用 tiptop，不再让用户自己找可执行文件）
  registerLinkToolCommands(context);
  // P2-1：数据库字段视图与命令（数据来自语言服务器，同步由 tiptop 执行）
  const schemaProvider = registerSchemaView(context);
  // W3/W4：数据库连接与资料是否就绪（决定按钮显隐）。
  registerDataContextWatcher(context);
  // W5：本地编译/链接/预览（4GL 与 Form 各三种方式）。
  registerBuild(context);
  registerConfigWatcher(context);

  // 激活事件是 onLanguage:bdl / onLanguage:per，此时已经有目标文件了。
  const outcome = await startClient(context);
  if (!outcome.ok) {
    await reportStartFailure(context, outcome);
  }
  attachParseDoneHandler();
  // 语言服务器/资料可能在启动后才就绪，这里再算一次。
  void refreshDataContexts();

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

  return {
    parseAffectedJobs,
    toolsPath,
    ensureDeployConfig,
    readDeployValues,
    parseProgressLine,
    humanizeProgress,
    querySchemaTables,
    querySchemaColumns,
    parseSchemaSummary,
    schemaProvider,
    dbReadiness: readDbReadiness,
    expandBuildTemplate,
    buildPlaceholders,
    hasMainProgram,
    buildCommandFor,
  };
}

export async function deactivate(): Promise<void> {
  disposeBuild();
  parseDoneSub?.dispose();
  parseDoneSub = undefined;
  disposeDeploy();
  disposeLinkTools();
  disposeSchemaView();
  await stopClient(false);
}

/** 注册三条命令：重启、信息、输出。 */
function registerCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("bdl.restartServer", async () => {
      const outcome = await restartClient(context);
      if (outcome.ok) {
        attachParseDoneHandler();
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
    // W1：登记"这次强制解析完成后刷新大纲"（服务端是后台不限时解析，
    // 请求会立刻返回；解析完成再发 `bdl/parseDone`）。
    pendingOutlineRefresh.add(doc.uri.toString());
    await client.sendRequest("bdl/forceParse", { uri: doc.uri.toString() });
    vscode.window.setStatusBarMessage(
      "已开始后台强制解析（不限时）：完成后会刷新大纲并显示耗时",
      8000,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(`强制解析失败：${msg}`);
  }
}

/**
 * W1：把 `bdl/parseDone` 通知挂到当前语言客户端上。
 *
 * 重启客户端后要重新挂；旧的订阅先释放，避免重复触发。
 */
function attachParseDoneHandler(): void {
  parseDoneSub?.dispose();
  parseDoneSub = undefined;
  const client = currentClient();
  if (!client) {
    return;
  }
  parseDoneSub = client.onNotification(
    "bdl/parseDone",
    (params: ParseDoneParams) => {
      void handleParseDone(params);
    },
  );
}

/** W1：处理后台强制解析完成回执。 */
async function handleParseDone(params: ParseDoneParams): Promise<void> {
  if (params.ok) {
    vscode.window.setStatusBarMessage(
      `强制解析完成：${params.ms} ms（${params.bytes} 字节）`,
      8000,
    );
  } else {
    void vscode.window.showWarningMessage(
      `强制解析失败：${params.error ?? "未知错误"}`,
    );
  }
  const pending = pendingOutlineRefresh.delete(params.uri);
  if (pending && params.ok) {
    await refreshOutline(vscode.Uri.parse(params.uri), params.version);
  }
}

/**
 * W1：让编辑器重新拉取大纲。
 *
 * VSCode 的文档符号/大纲按 `TextDocument.version` 缓存：服务端在后台解析
 * 出语法树并不会改变文档版本，所以"点了强制解析、大纲还是空"。
 * 这里做一次"插入空格 → 撤销"，让版本前进两次、缓存失效，从而重新查询
 * 大纲；撤销保证内容回到原样（未保存状态也回到原样）。
 */
async function refreshOutline(
  uri: vscode.Uri,
  parsedVersion: number,
): Promise<void> {
  const editor = vscode.window.visibleTextEditors.find(
    (e) => e.document.uri.toString() === uri.toString(),
  );
  if (!editor) {
    return; // 文件不在可见编辑器里：大纲面板也没在看它
  }
  if (editor.document.version !== parsedVersion) {
    return; // 用户在解析期间动过文件：它的编辑会自然刷新大纲
  }
  const ok = await editor.edit((b) =>
    b.insert(new vscode.Position(0, 0), " "),
  );
  if (!ok) {
    return;
  }
  await vscode.commands.executeCommand("undo");
  // 兜底：万一 undo 没落到这次插入上，把空格删掉，保证内容不变。
  if (editor.document.lineAt(0).text.startsWith(" ")) {
    await editor.edit((b) =>
      b.delete(new vscode.Range(0, 0, 0, 1)),
    );
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
