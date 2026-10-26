// 部署命令：调用 tiptop deploy 并把结果发布成诊断。
//
// 部署从 bdl-lsp 分离出去了（见 bdl-lsp 的 docs/FEATURES.md §0 职责与边界）：
// 语言服务器只做语言智能，采集链接资料与部署由 tiptop 负责。
// 扩展必须分别定位两个二进制，两者可以来自不同位置。
//
// 设计要点：
//   - 部署只由用户显式触发（命令/菜单），绝不挂在保存事件上；
//   - 输出流式写进专用 OutputChannel，失败原因要让用户能直接看到；
//   - 编译诊断发布到 Problems 面板，source 标成 fglcomp/fglform，
//     与 LSP 自己的语法诊断区分开。
import { spawn } from "node:child_process";
import * as path from "node:path";
import * as vscode from "vscode";

import { currentTools } from "./client";
import { ensureDeployConfig } from "./deployconfig";
import { resolveTools } from "./server/binary";

/** 扩展安装目录，用于定位内置的 tiptop（注册命令时写入）。 */
let extensionPath: string | undefined;

/** 扩展版本号（写进合成配置的 `createdBy`；注册命令时写入）。 */
let extensionVersion = "0.0.0";

/** 部署诊断的 source（Problems 面板里的来源列）。 */
const DIAG_SOURCE = "bdl-deploy";

/** 一次部署的结果（对应 internal/deploy.Result 的 JSON 输出）。 */
interface DeployResult {
  target?: string;
  files?: number;
  uploaded?: number;
  transport?: string;
  fallback?: boolean;
  ok?: boolean;
  diagnostics?: DeployDiagnostic[] | null;
  uploadError?: string;
  compileError?: string;
  logs?: string[];
}

/** 单条编译诊断。 */
interface DeployDiagnostic {
  severity?: string;
  file?: string;
  remoteFile?: string;
  line?: number;
  column?: number;
  code?: string;
  message?: string;
  raw?: string;
}

/** 部署输出通道与诊断集合（按工作区复用）。 */
let channel: vscode.OutputChannel | undefined;
let collection: vscode.DiagnosticCollection | undefined;

/** 取得（或创建）输出通道。 */
function outputChannel(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel("Genero BDL 部署");
  }
  return channel;
}

/** 取得（或创建）诊断集合。 */
function diagnostics(): vscode.DiagnosticCollection {
  if (!collection) {
    collection = vscode.languages.createDiagnosticCollection("bdl-deploy");
  }
  return collection;
}

/** 释放资源（扩展卸载时调用）。 */
export function disposeDeploy(): void {
  channel?.dispose();
  channel = undefined;
  collection?.dispose();
  collection = undefined;
}

/** 注册部署相关命令。 */
export function registerDeployCommands(
  context: vscode.ExtensionContext,
): void {
  extensionPath = context.extensionPath;
  const pkg = context.extension.packageJSON as { version?: string } | undefined;
  extensionVersion = pkg?.version ?? "0.0.0";
  context.subscriptions.push(
    vscode.commands.registerCommand("bdl.deploy", async () => {
      if (!deployEnabled()) {
        disabledNotice();
        return;
      }
      await runDeploy([]);
    }),

    vscode.commands.registerCommand("bdl.deployCurrentFile", async () => {
      if (!deployEnabled()) {
        disabledNotice();
        return;
      }
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        void vscode.window.showWarningMessage("没有打开的文件。");
        return;
      }
      const doc = editor.document;
      if (!isDeployable(doc.uri)) {
        void vscode.window.showWarningMessage(
          "只支持部署 .4gl / .global / .per 文件。",
        );
        return;
      }
      if (doc.isDirty) {
        // 部署读的是磁盘内容：不先保存会让远程拿到旧代码。
        await doc.save();
      }
      await runDeploy([doc.uri.fsPath]);
    }),

    vscode.commands.registerCommand("bdl.deployDryRun", async () => {
      if (!deployEnabled()) {
        disabledNotice();
        return;
      }
      await runDeploy([], true);
    }),

    vscode.commands.registerCommand("bdl.deployListTargets", async () => {
      if (!deployEnabled()) {
        disabledNotice();
        return;
      }
      await runDeployList();
    }),
  );
}

/**
 * 部署功能总开关（`bdl.deploy.enable`）。
 *
 * P1-4：**默认关闭**（轻量档）。打开后命令面板才出现部署命令，
 * 配置走「生产环境 → 部署」设置（插件合成 `.project/deploy/deploy.json`）。
 */
export function deployEnabled(): boolean {
  return vscode.workspace
    .getConfiguration("bdl")
    .get<boolean>("deploy.enable", false);
}

/** 关闭时的统一提示：让用户知道命令为什么不可用。 */
function disabledNotice(): void {
  void vscode.window.showInformationMessage(
    "部署功能已在设置中关闭（bdl.deploy.enable = false）。",
    "打开设置",
  ).then((choice) => {
    if (choice === "打开设置") {
      void vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "bdl.deploy.enable",
      );
    }
  });
}

/** 判断 URI 是否为可部署的 Genero 源码。 */
function isDeployable(uri: vscode.Uri): boolean {
  const ext = path.extname(uri.fsPath).toLowerCase();
  return ext === ".4gl" || ext === ".global" || ext === ".per";
}

/**
 * 定位 `tiptop` 可执行文件。
 *
 * 优先用语言服务进程启动时解析到的那个（`currentTools`），
 * 它为空时（服务器还没起来）再单独解析一次，并把失败原因告诉用户。
 */
function toolsBinary(): { command: string } | undefined {
  const fromServer = currentTools();
  if (fromServer) {
    return fromServer;
  }
  const resolved = resolveTools(extensionPath);
  if (resolved.ok) {
    return resolved.binary;
  }
  void vscode.window.showErrorMessage(
    `${resolved.message}。${resolved.hint}`,
    "打开设置",
  ).then((pick) => {
    if (pick === "打开设置") {
      void vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "bdl.tools.path",
      );
    }
  });
  return undefined;
}

/**
 * 执行部署。
 *
 * @param files 显式指定的文件（空表示按配置的 include/exclude 全量）
 * @param dryRun 只打印计划
 */
async function runDeploy(
  files: string[],
  dryRun = false,
): Promise<void> {
  const binary = toolsBinary();
  if (!binary) {
    return;
  }

  const workspace = workspaceRoot();
  if (!workspace) {
    void vscode.window.showErrorMessage("请先打开一个工作区文件夹。");
    return;
  }

  // P1-5/W6：部署配置由设置合成到 <项目>/.project/deploy/deploy.json，
  // 用户不再需要手写 JSON（tiptop 的配置模型不变）。
  const synth = await ensureDeployConfig(workspace, extensionVersion);
  if (!synth.path) {
    const out0 = outputChannel();
    out0.show(true);
    out0.appendLine(synth.error ?? "部署配置生成失败。");
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
    return;
  }
  if (synth.backup) {
    outputChannel().appendLine(
      `原来的 deploy.json 不是本插件生成的，已备份到 ${synth.backup}`,
    );
  }

  const args = [
    "deploy",
    "-workspace",
    workspace,
    "-config",
    synth.path,
    "-json",
  ];
  if (dryRun) {
    args.push("-dry-run");
  }
  // 目标可以留空，由配置的 defaultTarget 决定；有设置项时显式传。
  const target = vscode.workspace
    .getConfiguration("bdl")
    .get<string>("deploy.target", "");
  if (target) {
    args.push("-target", target);
  }
  args.push(...files);

  const out = outputChannel();
  out.show(true);
  out.appendLine("");
  out.appendLine(
    `$ tiptop ${args.map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ")}`,
  );

  const result = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: dryRun ? "Genero BDL：部署预演" : "Genero BDL：部署",
      cancellable: true,
    },
    async (_progress, token) => executeDeploy(binary.command, args, out, token),
  );

  if (!result) {
    out.appendLine("部署已取消或未产生输出。");
    return;
  }

  // 日志先回放：失败原因通常就在里面。
  for (const line of result.logs ?? []) {
    out.appendLine(`  ${line}`);
  }

  if (dryRun) {
    out.appendLine("");
    out.appendLine(`预演完成：${result.files ?? 0} 个文件。`);
    void vscode.window.showInformationMessage(
      `部署预演完成：${result.files ?? 0} 个文件，详见输出面板。`,
    );
    return;
  }

  const published = publishDiagnostics(result);
  reportOutcome(result, published);
}

/** 启动子进程执行部署，收集 stdout/stderr 并解析 JSON。 */
function executeDeploy(
  command: string,
  args: string[],
  out: vscode.OutputChannel,
  token: vscode.CancellationToken,
): Promise<DeployResult | undefined> {
  return new Promise<DeployResult | undefined>((resolve) => {
    const child = spawn(command, args, {
      windowsHide: true,
      // 输出通道里要看到原始日志，这里不设 cwd：-workspace 已显式指定。
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stderr += text;
      out.append(text);
    });

    token.onCancellationRequested(() => {
      child.kill();
      out.appendLine("已取消。");
    });

    child.on("error", (err) => {
      out.appendLine(`启动失败：${String(err)}`);
      resolve(undefined);
    });

    child.on("close", (code) => {
      if (stderr.trim() && !stdout.trim()) {
        // 纯 stderr：配置/参数错误，没有 JSON 可解析。
        out.appendLine(`退出码 ${code ?? "?"}`);
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(stdout) as DeployResult);
      } catch {
        // JSON 解析失败时把原文贴出来，至少能看到发生了什么。
        out.appendLine("无法解析部署输出（原始内容如下）：");
        out.appendLine(stdout);
        resolve(undefined);
      }
    });
  });
}

/** 把编译诊断发布到 Problems 面板，返回发布的条数。 */
function publishDiagnostics(result: DeployResult): number {
  const coll = diagnostics();
  coll.clear();

  const diags = result.diagnostics ?? [];
  if (diags.length === 0) {
    return 0;
  }

  const byFile = new Map<string, vscode.Diagnostic[]>();
  for (const d of diags) {
    if (!d.file) {
      // 没有文件位置（如 "cannot open file"）：挂到工作区级的输出里，
      // 不硬塞进某个文件。
      continue;
    }
    const severity =
      d.severity === "warning"
        ? vscode.DiagnosticSeverity.Warning
        : vscode.DiagnosticSeverity.Error;
    // 编译器给的是 1 基行列；LSP/Diagnostic 是 0 基。
    const line = Math.max(0, (d.line ?? 1) - 1);
    const col = Math.max(0, (d.column ?? 1) - 1);
    const range = new vscode.Range(line, col, line, Number.MAX_SAFE_INTEGER);
    const code = d.code ? `[${d.code}] ` : "";
    const diag = new vscode.Diagnostic(
      range,
      `${code}${d.message ?? d.raw ?? "编译错误"}`,
      severity,
    );
    diag.source = DIAG_SOURCE;
    if (d.code) {
      diag.code = d.code;
    }
    const list = byFile.get(d.file) ?? [];
    list.push(diag);
    byFile.set(d.file, list);
  }

  for (const [file, list] of byFile) {
    coll.set(vscode.Uri.file(file), list);
  }
  return diags.length;
}

/** 汇总提示：成功/失败都要说清楚，不能"部分成功却显示成功"。 */
function reportOutcome(result: DeployResult, published: number): void {
  const out = outputChannel();
  const parts: string[] = [];
  if (result.target) {
    parts.push(`目标 ${result.target}`);
  }
  if (result.transport) {
    const fb = result.fallback ? "（已回退）" : "";
    parts.push(`${result.transport}${fb}`);
  }
  parts.push(`上传 ${result.uploaded ?? 0}/${result.files ?? 0}`);

  out.appendLine("");
  out.appendLine(`结果：${parts.join("，")}`);
  if (result.uploadError) {
    out.appendLine(`上传错误：${result.uploadError}`);
  }
  if (result.compileError) {
    out.appendLine(`编译错误：${result.compileError}`);
  }
  if (published > 0) {
    out.appendLine(`编译诊断：${published} 条（见 Problems 面板）`);
  }

  if (result.ok) {
    void vscode.window.showInformationMessage(
      `部署成功：${parts.join("，")}。`,
    );
    return;
  }
  void vscode.window.showErrorMessage(
    `部署失败：${parts.join("，")}，详见输出面板。`,
  );
}

/** 列出配置里的部署目标。 */
async function runDeployList(): Promise<void> {
  // 列出目标同样要用 **tiptop**（部署已从 bdl-lsp 分离；原先这里错用了
  // 语言服务器二进制，命令必然失败——P1-5 顺手修掉）。
  const binary = toolsBinary();
  const workspace = workspaceRoot();
  if (!binary || !workspace) {
    void vscode.window.showErrorMessage("需要先打开工作区并找到 tiptop。");
    return;
  }
  const out = outputChannel();
  out.show(true);
  // 有设置就合成后再列；没设置/合成失败则退回 tiptop 自己找配置文件
  //（用户手写的 .project/deploy/deploy.json 仍然可用）。
  const synth = await ensureDeployConfig(workspace, extensionVersion);
  const args = ["deploy", "-workspace", workspace, "-list"];
  if (synth.path) {
    args.push("-config", synth.path);
  }
  await new Promise<void>((resolve) => {
    const child = spawn(
      binary.command,
      args,
      { windowsHide: true },
    );
    child.stdout.on("data", (c: Buffer) => out.append(c.toString("utf8")));
    child.stderr.on("data", (c: Buffer) => out.append(c.toString("utf8")));
    child.on("close", () => resolve());
    child.on("error", () => resolve());
  });
}

/** 取第一个工作区文件夹作为部署工作区根。 */
function workspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}
