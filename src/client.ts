// 语言客户端：启动 bdl-lsp 并把它挂到 bdl/per 两种语言上。
import * as path from "node:path";
import * as vscode from "vscode";

import { linkMode, schemaMode } from "./settings";
import {
  LanguageClient,
  LanguageClientOptions,
  RevealOutputChannelOn,
  ServerOptions,
  Trace,
  TransportKind,
} from "vscode-languageclient/node";

import {
  describeBinary,
  resolveBinary,
  resolveTools,
  type ResolvedBinary,
} from "./server/binary";

/** 两种语言的 documentSelector：与 package.json 的 languages.id 保持一致。 */
const DOCUMENT_SELECTOR = [
  { language: "bdl", scheme: "file" },
  { language: "bdl", scheme: "untitled" },
  { language: "per", scheme: "file" },
  { language: "per", scheme: "untitled" },
] satisfies vscode.DocumentFilter[];

/** 客户端与 LSP 之间的追踪日志（单独通道，避免干扰普通输出）。 */
let traceChannel: vscode.LogOutputChannel | undefined;

/** 当前运行中的客户端；未启动时为 undefined。 */
let client: LanguageClient | undefined;

/** 当前使用的二进制信息，供「显示语言服务器信息」命令展示。 */
let binaryInfo: ResolvedBinary | undefined;

/** 启动状态，避免重复启动与并发重启。 */
let starting: Promise<void> | undefined;

export interface StartOutcome {
  ok: boolean;
  /** 失败原因（可直接展示给用户）。 */
  message?: string;
  /** 可操作的修复建议。 */
  hint?: string;
}

/** 扩展安装目录，供命令侧解析 tiptop 使用。 */
let extensionPath: string | undefined;

/** 当前二进制解析结果的只读快照（供命令使用）。 */
export function currentBinary(): ResolvedBinary | undefined {
  return binaryInfo;
}

/**
 * `tiptop` 的解析结果快照（供部署命令使用）。
 *
 * 与语言服务器分开解析：部署/采集由 tiptop 负责，它可能不在同一个位置
 * （例如开发期内置了 LSP、tiptop 用本地构建产物）。
 * 服务器没启动时这里是 undefined，命令侧会再单独解析一次。
 */
export function currentTools(): ResolvedBinary | undefined {
  const resolved = resolveTools(extensionPath);
  return resolved.ok ? resolved.binary : undefined;
}

/** 供状态栏/日志使用的客户端实例。 */
export function currentClient(): LanguageClient | undefined {
  return client;
}

/** 组装 server options：stdio 启动 `bdl-lsp serve`。 */
function serverOptionsFor(binary: ResolvedBinary): ServerOptions {
  const args = ["serve"];

  // 日志级别通过命令行传入；bdl-lsp 只写 stderr，不会污染协议通道。
  const logLevel = vscode.workspace
    .getConfiguration("bdl")
    .get<string>("server.logLevel", "info");
  if (logLevel && logLevel !== "info") {
    args.push("--log-level", logLevel);
  }

  return {
    run: {
      command: binary.command,
      args,
      transport: TransportKind.stdio,
      options: {
        // 服务器日志里相对路径的意义依赖 cwd，固定到第一个工作区更直观。
        cwd: workspaceCwd(),
        env: { ...process.env },
      },
    },
    debug: {
      command: binary.command,
      args: [...args, "--log-level", "debug"],
      transport: TransportKind.stdio,
      options: {
        cwd: workspaceCwd(),
        env: { ...process.env },
      },
    },
  };
}

/** 语言服务器的工作目录：优先第一个本地工作区，否则用扩展目录。 */
function workspaceCwd(): string | undefined {
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    if (folder.uri.scheme === "file") {
      return folder.uri.fsPath;
    }
  }
  return undefined;
}

/** 构造客户端选项。 */
function clientOptionsFor(context: vscode.ExtensionContext): LanguageClientOptions {
  const outputChannel = vscode.window.createOutputChannel("Genero BDL", {
    log: true,
  });
  context.subscriptions.push(outputChannel);

  traceChannel = vscode.window.createOutputChannel("Genero BDL 追踪", {
    log: true,
  });
  context.subscriptions.push(traceChannel);

  return {
    documentSelector: DOCUMENT_SELECTOR,
    diagnosticCollectionName: "bdl",
    outputChannel,
    traceOutputChannel: traceChannel,
    revealOutputChannelOn: RevealOutputChannelOn.Never,
    // 把初始化配置直接带过去，避免服务器先按默认值解析一遍。
    initializationOptions: collectSettings(),
    // 关键：让 vscode-languageclient 在设置变化时自动下发
    // workspace/didChangeConfiguration（settings 会包在 "bdl" 键下）。
    synchronize: {
      configurationSection: "bdl",
    },
  };
}

/** 收集发送给服务器的设置；字段名与 internal/config.Settings 对应。 */
function collectSettings(): Record<string, unknown> {
  const cfg = vscode.workspace.getConfiguration("bdl");
  return {
    generoVersion: cfg.get<string>("generoVersion"),
    logLevel: cfg.get<string>("server.logLevel"),
    globals: {
      searchPaths: cfg.get<string[]>("globals.searchPaths"),
    },
    // 诊断级别的唯一入口：按诊断码覆盖（键为码、值为
    // off/error/warning/information/hint）。collectSettings 是白名单，
    // 这里必须显式转交，否则设置不会下发。
    diagnostics: cfg.get<Record<string, string>>("diagnostics") ?? {},
    // 内置符号表（P7-C）：项目级覆盖文件/路径与禁用列表。
    builtins: {
      enable: cfg.get<boolean>("builtins.enable") ?? true,
      paths: cfg.get<string[]>("builtins.paths") ?? [],
      disable: cfg.get<string[]>("builtins.disable") ?? [],
    },
    // 链接资料（P7-D）：同样必须显式转交（collectSettings 是白名单）。
    link: {
      // §0d：新模式三态（off/file/db）。服务端按 mode 判断是否加载资料。
      mode: linkMode(),
      dataDir: cfg.get<string>("link.dataDir") ?? ".project/link",
      moduleRoots: cfg.get<string[]>("link.moduleRoots") ?? [],
      globalModules: cfg.get<string[]>("link.globalModules") ?? ["sub", "lib", "qry"],
    },
    // 工作区索引 / schema 索引（P6）：显式转交，避免只靠后续
    // didChangeConfiguration 下发（首次启动时初始化选项里没有）。
    index: {
      enable: cfg.get<boolean>("index.enable") ?? true,
    },
    schema: {
      // §0d：新模式三态（off/file/db）。
      mode: schemaMode(),
      // P2-1/W6：资料目录（默认 .project/schema，由 tiptop schema import 生成；旧 .project/.schema 只读兼容）。
      dataDir: cfg.get<string>("schema.dataDir") ?? ".project/schema",
    },
    // 忽略列表（P8）：文件/字段/表单 glob。
    ignore: {
      files: cfg.get<string[]>("ignore.files") ?? [],
      fields: cfg.get<string[]>("ignore.fields") ?? [],
      forms: cfg.get<string[]>("ignore.forms") ?? [],
    },
    perRoots: cfg.get<string[]>("perRoots"),
    format: {
      keywords: cfg.get<string>("format.keywords"),
      indentStyle: cfg.get<string>("format.indentStyle"),
      indentSize: cfg.get<number>("format.indentSize"),
    },
    limits: {
      maxFileBytes: cfg.get<number>("limits.maxFileBytes"),
      maxFileLines: cfg.get<number>("limits.maxFileLines"),
      maxIssues: cfg.get<number>("limits.maxIssues"),
      parseTimeoutMs: cfg.get<number>("limits.parseTimeoutMs"),
    },
  };
}

/** 读取追踪级别并同步给客户端。 */
function applyTraceLevel(c: LanguageClient): void {
  const level = vscode.workspace
    .getConfiguration("bdl")
    .get<string>("trace.server", "off");
  // setTrace 收的是 Trace 枚举而不是字符串，需显式转换。
  const map: Record<string, Trace> = {
    off: Trace.Off,
    messages: Trace.Messages,
    compact: Trace.Compact,
    verbose: Trace.Verbose,
  };
  void c.setTrace(map[level] ?? Trace.Off);
}

/**
 * 启动（或复用已启动的）语言客户端。
 *
 * 返回而不是抛异常，让调用方决定是弹提示还是写日志——
 * 找不到二进制是常见情况，不应该变成未捕获异常。
 */
export async function startClient(
  context: vscode.ExtensionContext,
): Promise<StartOutcome> {
  if (client?.isRunning()) {
    return { ok: true };
  }
  if (starting) {
    await starting;
    return { ok: true };
  }

  const resolved = resolveBinary(context.extensionPath);
  if (!resolved.ok) {
    return { ok: false, message: resolved.message, hint: resolved.hint };
  }

  extensionPath = context.extensionPath;
  binaryInfo = resolved.binary;
  const serverOptions = serverOptionsFor(resolved.binary);
  const clientOptions = clientOptionsFor(context);

  const instance = new LanguageClient(
    "bdl",
    "Genero BDL 语言服务器",
    serverOptions,
    clientOptions,
  );

  starting = (async () => {
    await instance.start();
    client = instance;
    applyTraceLevel(instance);

    // 扩展自己维护的日志文件：VS Code 的输出通道在重启后会被清，
    // 排查现场问题时需要能回看的记录。
    logToFile(context, `语言服务器已启动：${describeBinary(resolved.binary)}`);
  })();

  try {
    await starting;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logToFile(context, `语言服务器启动失败：${message}`);

    // 启动失败时把实例清掉，否则下次 didOpen 会命中半死状态。
    client = undefined;
    return {
      ok: false,
      message: `语言服务器启动失败：${message}`,
      hint: [
        `可执行文件：${resolved.binary.command}`,
        "请确认该文件能在终端直接运行：",
        `  ${resolved.binary.command} version`,
        "若提示缺少动态库或权限不足，请检查构建产物与文件权限。",
      ].join("\n"),
    };
  } finally {
    starting = undefined;
  }

  return { ok: true };
}

/** 停止客户端；rethrow 让「重启」命令能感知停止失败。 */
export async function stopClient(rethrow = false): Promise<void> {
  const instance = client;
  client = undefined;
  binaryInfo = undefined;
  if (!instance) {
    return;
  }
  try {
    await instance.stop();
  } catch (err) {
    if (rethrow) {
      throw err;
    }
  }
}

/** 重启：先停后起。 */
export async function restartClient(
  context: vscode.ExtensionContext,
): Promise<StartOutcome> {
  await stopClient(false);
  return startClient(context);
}

/** 追加写入扩展日志目录下的 bdl-lsp-client.log。 */
export function logToFile(
  context: vscode.ExtensionContext,
  line: string,
): void {
  try {
    const dir = context.logUri.fsPath;
    const file = path.join(dir, "bdl-lsp-client.log");
    const stamp = new Date().toISOString();
    // 同步写入：日志量很小（每次启动/失败一条），异步反而容易丢尾部。
    require("node:fs").appendFileSync(file, `[${stamp}] ${line}\n`, "utf8");
  } catch {
    // 日志失败不影响功能
  }
}

/** 配置项变化时需要重启服务器的那部分键。 */
const RESTART_KEYS = [
  "bdl.server.path",
  "bdl.server.logLevel",
  "bdl.generoVersion",
  // 链接资料模式决定服务器启动时是否加载资料与采集调度，热切换会造成“半开”状态，
  // 统一要求重启。字段资料模式是热切换（服务器按新值重载），所以不在这个清单里。
  "bdl.link.mode",
];

/** 注册配置变化监听：需要重启的键提示重启，其余自动同步。 */
export function registerConfigWatcher(
  context: vscode.ExtensionContext,
): void {
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (RESTART_KEYS.some((key) => event.affectsConfiguration(key))) {
        const choice = await vscode.window.showInformationMessage(
          "Genero BDL 设置已修改，需要重启语言服务器才能生效。",
          "立即重启",
          "稍后",
        );
        if (choice === "立即重启") {
          await vscode.commands.executeCommand("bdl.restartServer");
        }
        return;
      }
      if (event.affectsConfiguration("bdl.trace.server") && client) {
        applyTraceLevel(client);
      }
    }),
  );
}

/** 供其他模块读取 trace 通道。 */
export function traceOutputChannel(): vscode.LogOutputChannel | undefined {
  return traceChannel;
}
