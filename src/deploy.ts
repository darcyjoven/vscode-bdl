// 部署命令：调用 bdl-lsp deploy 并把结果发布成诊断。
//
// 设计要点：
//   - 部署只由用户显式触发（命令/菜单），绝不挂在保存事件上；
//   - 输出流式写进专用 OutputChannel，失败原因要让用户能直接看到；
//   - 编译诊断发布到 Problems 面板，source 标成 fglcomp/fglform，
//     与 LSP 自己的语法诊断区分开。
import { spawn } from "node:child_process";
import * as path from "node:path";
import * as vscode from "vscode";

import { currentBinary } from "./client";

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
  context.subscriptions.push(
    vscode.commands.registerCommand("bdl.deploy", async () => {
      await runDeploy([]);
    }),

    vscode.commands.registerCommand("bdl.deployCurrentFile", async () => {
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
      await runDeploy([], true);
    }),

    vscode.commands.registerCommand("bdl.deployListTargets", async () => {
      await runDeployList();
    }),
  );
}

/** 判断 URI 是否为可部署的 Genero 源码。 */
function isDeployable(uri: vscode.Uri): boolean {
  const ext = path.extname(uri.fsPath).toLowerCase();
  return ext === ".4gl" || ext === ".global" || ext === ".per";
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
  const binary = currentBinary();
  if (!binary) {
    void vscode.window.showErrorMessage(
      "语言服务器未运行，无法定位 bdl-lsp 可执行文件；请先重启服务器。",
    );
    return;
  }

  const workspace = workspaceRoot();
  if (!workspace) {
    void vscode.window.showErrorMessage("请先打开一个工作区文件夹。");
    return;
  }

  const args = ["deploy", "-workspace", workspace, "-json"];
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
    `$ bdl-lsp ${args.map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ")}`,
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
  const binary = currentBinary();
  const workspace = workspaceRoot();
  if (!binary || !workspace) {
    void vscode.window.showErrorMessage("需要先打开工作区并启动语言服务器。");
    return;
  }
  const out = outputChannel();
  out.show(true);
  await new Promise<void>((resolve) => {
    const child = spawn(
      binary.command,
      ["deploy", "-workspace", workspace, "-list"],
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
