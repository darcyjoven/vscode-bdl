// W5 + TODO §0d：编译 / 链接 / 预览命令。
//
// 关键变化（2026-10-26 确认）：命令**不在本机执行**——开发机没有 Genero 环境，
// 统一交给 `tiptop exec` 在生产服务器上跑（工作目录 = 生产根目录），
// stdout/stderr 原样进「Genero BDL 任务」输出通道。
//
// 占位符：`${path}`（两层目录）、`${fullpath}`（三层）、`${name}`（去扩展名）、
// `${fullname}`（含扩展名）；分隔符恒为 `/`。命令模板可在设置里改。
//
// `${name}` 弹框（D11）：**只有 4GL「链接」弹**，其它命令直接用文件名去扩展名。
import * as path from "node:path";
import * as vscode from "vscode";

import { reportRunFailure, runTiptopWithProgress } from "./linktools";
import { taskChannel } from "./output";
import { buildCommandValue, buildEnabled } from "./settings";

/** 四个占位符的取值。 */
export interface BuildPlaceholders {
  /** 当前文件的两层目录，如 `axc/4gl`（相对工作区根，正斜杠）。 */
  path: string;
  /** 当前文件的三层目录，如 `tiptop/axc/4gl`。 */
  fullpath: string;
  /** 去扩展名的文件名，如 `axcp500`。 */
  name: string;
  /** 含扩展名的文件名，如 `axcp500.4gl`。 */
  fullname: string;
}

/** 一种编译方式。 */
interface BuildSpec {
  /** 命令 id（package.json 里注册的同名命令）。 */
  id: string;
  /** 适用语言：`bdl` = `.4gl`，`per` = `.per`。 */
  lang: "bdl" | "per";
  /** 方式：preview/compile/link（4gl）或 preview/compile/form（per）。 */
  mode: "preview" | "compile" | "link" | "form";
  /** 用户可见的动作名。 */
  title: string;
  /** 是否弹 `${name}` 输入框（只有 4GL 链接）。 */
  promptName: boolean;
  /** 是否要求文件含 MAIN 程序块（只有 4GL 链接）。 */
  needMain: boolean;
}

const SPECS: readonly BuildSpec[] = [
  { id: "bdl.build.4gl.preview", lang: "bdl", mode: "preview", title: "4GL：预演编译", promptName: false, needMain: false },
  { id: "bdl.build.4gl.compile", lang: "bdl", mode: "compile", title: "4GL：编译", promptName: false, needMain: false },
  { id: "bdl.build.4gl.link", lang: "bdl", mode: "link", title: "4GL：链接", promptName: true, needMain: true },
  { id: "bdl.build.per.preview", lang: "per", mode: "preview", title: "Form：预演编译", promptName: false, needMain: false },
  { id: "bdl.build.per.compile", lang: "per", mode: "compile", title: "Form：编译", promptName: false, needMain: false },
  { id: "bdl.build.per.form", lang: "per", mode: "form", title: "Form：预览画面", promptName: false, needMain: false },
];

/** 默认命令模板（键为 `<lang>.<mode>`；用户可在设置里覆盖）。 */
export const BUILD_DEFAULTS: Readonly<Record<string, string>> = {
  "4gl.preview": "cd ${path} && r.c2 ${name}",
  "4gl.compile": "cd ${path} && r.c2 ${name}",
  "4gl.link": "r.l2 ${name}",
  "per.preview":
    "cd ${path} && fglform -M -W all ${fullname} && rm ${name}.42f",
  "per.compile":
    "cd ${path} && fglform -M -W all ${fullname} && mv ${name}.42f ../42f/ && " +
    "gsform -M -W all -i -import ${fullname} && mv ${name}.4fd ../4fd/",
  "per.form": "cd ${path} && r.gf ${name} 2 p",
};

let contextKeyTimer: NodeJS.Timeout | undefined;

/** 任务输出通道（清理项 C6：与链接资料/字段/上传共用一个通道）。 */
function output(): vscode.OutputChannel {
  return taskChannel();
}

/** 释放定时器（deactivate 用；通道由 output.ts 统一释放）。 */
export function disposeBuild(): void {
  if (contextKeyTimer) {
    clearTimeout(contextKeyTimer);
    contextKeyTimer = undefined;
  }
}

/**
 * 取命令模板：设置里的 `bdl.build.<lang>.<mode>.command` 优先，
 * 为空/未设置时回退内置默认值。
 */
export function buildCommandFor(lang: string, mode: string): string {
  const fromSettings = (buildCommandValue(lang, mode) ?? "").trim();
  if (fromSettings !== "") {
    return fromSettings;
  }
  return BUILD_DEFAULTS[`${lang}.${mode}`] ?? "";
}

/** 字面量替换（不用 String.replaceAll，避免 lib 版本差异）。 */
function replaceAllLiteral(s: string, find: string, repl: string): string {
  return s.split(find).join(repl);
}

/** 展开模板里的四个占位符（导出给 e2e）。 */
export function expandBuildTemplate(tpl: string, p: BuildPlaceholders): string {
  let out = tpl;
  out = replaceAllLiteral(out, "${fullpath}", p.fullpath);
  out = replaceAllLiteral(out, "${path}", p.path);
  out = replaceAllLiteral(out, "${fullname}", p.fullname);
  out = replaceAllLiteral(out, "${name}", p.name);
  return out;
}

/** 文件相对工作区根的路径（正斜杠）。 */
export function relativePathFor(doc: vscode.TextDocument): string {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) {
    return path.basename(doc.uri.fsPath);
  }
  const rel = path.relative(root, doc.uri.fsPath);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    return path.basename(doc.uri.fsPath);
  }
  return rel.split(path.sep).join("/");
}

/** 当前文件相对工作区根的目录（正斜杠；不在工作区内时用原目录）。 */
function relativeDir(uri: vscode.Uri): string {
  let dir = path.dirname(uri.fsPath);
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (root) {
    const rel = path.relative(root.fsPath, dir);
    if (rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel)) {
      dir = rel;
    }
  }
  return dir.split(path.sep).join("/").replace(/^\.\//, "");
}

/** 计算四个占位符（导出给 e2e）。 */
export function buildPlaceholders(
  doc: vscode.TextDocument,
  name: string,
): BuildPlaceholders {
  const parts = relativeDir(doc.uri)
    .split("/")
    .filter((s) => s !== "" && s !== ".");
  return {
    path: parts.slice(-2).join("/"),
    fullpath: parts.slice(-3).join("/"),
    name,
    fullname: path.basename(doc.uri.fsPath),
  };
}

/** 默认 `${name}`：文件名去掉最后一个扩展名。 */
export function defaultBuildName(doc: vscode.TextDocument): string {
  return path.basename(doc.uri.fsPath).replace(/\.[^.]+$/, "");
}

/**
 * 文本是否含 MAIN 程序块（导出给 e2e 与按钮门控）。
 *
 * 4GL 的 MAIN 是**独占一行**的语句：行首可有缩进、只写 `MAIN`，其后可跟行注释。
 * 这样不会把字符串/标识符里的 `main` 误当入口。极少数情况（块注释里独占一行
 * MAIN）会误判为有；运行「链接」前的复核见 `documentHasMain`。
 */
export function hasMainProgram(text: string): boolean {
  return /^[ \t]*MAIN([ \t]*(--.*)?)?$/m.test(text);
}

/** 运行「链接」前的权威判定：优先用语言服务器符号表（index.KindMain）。 */
async function documentHasMain(doc: vscode.TextDocument): Promise<boolean> {
  try {
    const syms = (await vscode.commands.executeCommand(
      "vscode.executeDocumentSymbolProvider",
      doc.uri,
    )) as vscode.DocumentSymbol[] | undefined;
    if (syms && syms.length > 0) {
      return flattenSymbols(syms).some(
        (s) => (s.detail ?? "").toUpperCase() === "MAIN",
      );
    }
  } catch {
    // 语言服务器不可用：退回文本判定
  }
  return hasMainProgram(doc.getText());
}

function flattenSymbols(list: vscode.DocumentSymbol[]): vscode.DocumentSymbol[] {
  const out: vscode.DocumentSymbol[] = [];
  const walk = (syms: vscode.DocumentSymbol[]): void => {
    for (const s of syms) {
      out.push(s);
      if (s.children.length > 0) {
        walk(s.children);
      }
    }
  };
  walk(list);
  return out;
}

/**
 * 组装交给 tiptop 的参数（导出给 e2e 断言）。
 *
 * `tiptop exec` 在生产服务器上执行命令，工作目录 = 生产根目录；`-file` 只用于
 * 打印上下文（命令里的 `${path}`/`${name}` 已在插件侧展开）。
 */
export function buildTiptopArgs(
  root: string,
  rel: string,
  command: string,
): string[] {
  return ["exec", "-workspace", root, "-file", rel, "-command", command];
}

/** 执行一种编译方式。 */
async function runBuild(spec: BuildSpec, uri?: vscode.Uri): Promise<void> {
  if (!buildEnabled()) {
    void vscode.window.showWarningMessage(
      "编译/链接/预览功能未启用：请在设置「上传编译链接」里打开总开关",
    );
    return;
  }
  const doc = uri
    ? await vscode.workspace.openTextDocument(uri)
    : vscode.window.activeTextEditor?.document;
  if (!doc || doc.uri.scheme !== "file") {
    void vscode.window.showWarningMessage("请先打开一个 .4gl / .per 文件");
    return;
  }
  if (doc.languageId !== spec.lang) {
    void vscode.window.showWarningMessage(
      `${spec.title} 只能用于 ${spec.lang === "bdl" ? ".4gl" : ".per"} 文件`,
    );
    return;
  }
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) {
    void vscode.window.showWarningMessage("请先打开一个工作区");
    return;
  }
  // 生产端读的是已上传的文件；本机先保存，避免改完没存就编译。
  if (doc.isDirty) {
    await doc.save();
  }

  let name = defaultBuildName(doc);
  if (spec.promptName) {
    const input = await vscode.window.showInputBox({
      title: `${spec.title}：确认 ${"${name}"}`,
      prompt: "将替换模板里的 ${name}；默认是文件名去扩展名，可修改",
      value: name,
      valueSelection: [0, name.length],
    });
    if (input === undefined) {
      return; // 用户取消
    }
    const trimmed = input.trim();
    if (trimmed !== "") {
      name = trimmed;
    }
  }

  if (spec.needMain && !(await documentHasMain(doc))) {
    const base = path.basename(doc.uri.fsPath);
    output().appendLine("");
    output().appendLine(`✗ ${base}：没有 MAIN 程序块，已拒绝链接`);
    void vscode.window.showErrorMessage(`没有 MAIN 函数，不允许链接：${base}`);
    return;
  }

  const tpl = buildCommandFor(spec.lang, spec.mode);
  const params = buildPlaceholders(doc, name);
  const command = expandBuildTemplate(tpl, params);
  const rel = relativePathFor(doc);

  const out = output();
  out.appendLine("");
  out.appendLine(`> ${spec.title}：${rel}（在生产服务器上执行）`);
  out.appendLine(
    `  占位符：path=${params.path} fullpath=${params.fullpath} name=${params.name} fullname=${params.fullname}`,
  );
  out.appendLine(`  模板：${tpl}`);
  out.appendLine(`  命令：${command}`);
  out.show(true);

  // §0d：交给 tiptop 在**生产服务器**上执行（工作目录 = 生产根目录）。
  const res = await runTiptopWithProgress(
    root,
    buildTiptopArgs(root, rel, command),
    spec.title,
    out,
  );
  if (res.cancelled) {
    vscode.window.setStatusBarMessage(`${spec.title}已取消`, 3000);
    return;
  }
  if (res.code !== 0) {
    await reportRunFailure(spec.title, res, out);
    return;
  }
  void vscode.window.showInformationMessage(`${spec.title}完成`);
}

/** 立刻更新 `bdl.build.hasMain` 门控（决定 4GL「链接」按钮是否可用）。 */
function updateHasMainContext(): void {
  const doc = vscode.window.activeTextEditor?.document;
  const hasMain =
    doc?.languageId === "bdl" ? hasMainProgram(doc.getText()) : true;
  void vscode.commands.executeCommand("setContext", "bdl.build.hasMain", hasMain);
}

/** 防抖版（打字时不必每个键都判一次）。 */
function scheduleHasMainContext(): void {
  if (contextKeyTimer) {
    clearTimeout(contextKeyTimer);
  }
  contextKeyTimer = setTimeout(() => {
    contextKeyTimer = undefined;
    updateHasMainContext();
  }, 300);
}

/** 注册六条命令与 MAIN 门控。 */
export function registerBuild(context: vscode.ExtensionContext): void {
  for (const spec of SPECS) {
    context.subscriptions.push(
      vscode.commands.registerCommand(spec.id, (uri?: vscode.Uri) =>
        runBuild(spec, uri),
      ),
    );
  }
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => scheduleHasMainContext()),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document === vscode.window.activeTextEditor?.document) {
        scheduleHasMainContext();
      }
    }),
  );
  updateHasMainContext();
}
