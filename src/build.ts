// W5：本地编译 / 链接 / 预览（Windows 实机反馈第 5 项）。
//
// 设计要点：
//   - 三种方式各一个可自定义的命令模板（用户可以在设置里改）；
//   - 占位符：`${path}`（当前文件的两层目录，如 `axc/4gl`）、
//     `${fullpath}`（三层目录，如 `tiptop/axc/4gl`）、`${name}`（去扩展名）、
//     `${fullname}`（含扩展名）；目录分隔符**恒为 `/`**，与平台无关；
//   - 运行目录 = 工作区根；stdout/stderr **原样**进「Genero BDL 编译」输出通道；
//   - 4GL「链接」前本地校验 MAIN：没有 MAIN 程序块直接报错、不执行脚本；
//   - `${name}`：链接与编译每次弹输入框确认（预填写文件名去扩展名，可改）；
//     预演编译不弹，用默认值；
//   - 只在 `.4gl` / `.per` 文件上可用；入口是命令面板与编辑器右上角按钮。
import { spawn } from "node:child_process";
import * as path from "node:path";
import * as vscode from "vscode";

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
  /** 设置键（`bdl.build.<lang>.<mode>`）。 */
  key: string;
  /** 适用的语言：`bdl` = `.4gl`，`per` = `.per`。 */
  lang: "bdl" | "per";
  /** 用户可见的动作名。 */
  title: string;
  /** 是否弹 `${name}` 输入框（预演编译不弹）。 */
  promptName: boolean;
  /** 是否要求文件含 MAIN 程序块（只有 4GL 链接）。 */
  needMain: boolean;
}

const SPECS: readonly BuildSpec[] = [
  {
    id: "bdl.build.4gl.preview",
    key: "bdl.build.4gl.preview",
    lang: "bdl",
    title: "4GL：预演编译",
    promptName: false,
    needMain: false,
  },
  {
    id: "bdl.build.4gl.compile",
    key: "bdl.build.4gl.compile",
    lang: "bdl",
    title: "4GL：编译",
    promptName: true,
    needMain: false,
  },
  {
    id: "bdl.build.4gl.link",
    key: "bdl.build.4gl.link",
    lang: "bdl",
    title: "4GL：链接",
    promptName: true,
    needMain: true,
  },
  {
    id: "bdl.build.per.preview",
    key: "bdl.build.per.preview",
    lang: "per",
    title: "Form：预演编译",
    promptName: false,
    needMain: false,
  },
  {
    id: "bdl.build.per.compile",
    key: "bdl.build.per.compile",
    lang: "per",
    title: "Form：编译",
    promptName: true,
    needMain: false,
  },
  {
    id: "bdl.build.per.form",
    key: "bdl.build.per.form",
    lang: "per",
    title: "Form：预览画面",
    promptName: true,
    needMain: false,
  },
];

/** 默认命令模板（键是**去掉 `bdl.` 前缀**的段内键，用户可在设置里覆盖）。 */
export const BUILD_DEFAULTS: Readonly<Record<string, string>> = {
  "build.4gl.preview": "cd ${path} && r.c2 ${name}",
  "build.4gl.compile": "cd ${path} && r.c2 ${name}",
  "build.4gl.link": "r.l2 ${name}",
  "build.per.preview":
    "cd ${path} && fglform -M -W all ${fullname} && rm ${name}.42f",
  "build.per.compile":
    "cd ${path} && fglform -M -W all ${fullname} && mv ${name}.42f ../42f/ && " +
    "gsform -M -W all -i -import ${fullname} && mv ${name}.4fd ../4fd/",
  "build.per.form": "cd ${path} && r.gf ${name}",
};

/** 把完整设置键（`bdl.build.…`）转成段内键（`build.…`）。 */
function sectionKey(key: string): string {
  return key.startsWith("bdl.") ? key.slice("bdl.".length) : key;
}

let channel: vscode.OutputChannel | undefined;
let contextKeyTimer: NodeJS.Timeout | undefined;

function cfg(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration("bdl");
}

/** 输出通道（编译输出与语言服务器/采集分开，便于排查）。 */
function output(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel("Genero BDL 编译");
  }
  return channel;
}

/** 释放输出通道（deactivate 用）。 */
export function disposeBuild(): void {
  if (contextKeyTimer) {
    clearTimeout(contextKeyTimer);
    contextKeyTimer = undefined;
  }
  channel?.dispose();
  channel = undefined;
}

/**
 * 取模板：设置为空时回退默认值。
 *
 * `key` 可以是完整设置键（`bdl.build.4gl.preview`）或段内键
 * （`build.4gl.preview`）。注意 `cfg()` 已经是 `bdl` 段，不能再带 `bdl.` 前缀，
 * 否则会读成 `bdl.bdl.build…` 而永远落回默认值。
 */
export function buildCommandFor(key: string): string {
  const rel = sectionKey(key);
  const v = (cfg().get<string>(rel) ?? "").trim();
  return v !== "" ? v : (BUILD_DEFAULTS[rel] ?? "");
}

/** 字面量替换（不用 String.replaceAll，避免 lib 版本差异）。 */
function replaceAllLiteral(s: string, find: string, repl: string): string {
  return s.split(find).join(repl);
}

/** 展开模板里的四个占位符（导出给 e2e）。 */
export function expandBuildTemplate(
  tpl: string,
  p: BuildPlaceholders,
): string {
  let out = tpl;
  out = replaceAllLiteral(out, "${fullpath}", p.fullpath);
  out = replaceAllLiteral(out, "${path}", p.path);
  out = replaceAllLiteral(out, "${fullname}", p.fullname);
  out = replaceAllLiteral(out, "${name}", p.name);
  return out;
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

/** 运行一条 shell 命令，stdout/stderr 原样写入输出通道。 */
async function runShell(
  root: string,
  command: string,
  title: string,
): Promise<number | null> {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title,
      cancellable: true,
    },
    (progress, token) =>
      new Promise<number | null>((resolve) => {
        void progress;
        const out = output();
        // shell:true 在 Windows 用 cmd.exe（/d /s /c），类 Unix 用 /bin/sh -c，
        // 所以模板里的 `cd … && …` 两种平台都能用（W-c 的建议口径）。
        const child = spawn(command, {
          cwd: root,
          shell: true,
          windowsHide: true,
        });
        let cancelled = false;
        token.onCancellationRequested(() => {
          cancelled = true;
          out.appendLine("已取消：正在结束进程…");
          child.kill();
        });
        child.stdout.on("data", (d: Buffer) => out.append(d.toString("utf8")));
        child.stderr.on("data", (d: Buffer) => out.append(d.toString("utf8")));
        child.on("error", (err) => {
          out.appendLine(`启动失败：${String(err)}`);
          resolve(cancelled ? null : -1);
        });
        child.on("close", (code) => {
          resolve(cancelled ? null : code);
        });
      }),
  );
}

/**
 * 执行一种编译方式。
 *
 * `uri` 可选：命令由编辑器按钮/命令面板触发时省略，取当前编辑器；
 * 传了就用指定文件（e2e 与其它扩展集成时用，避免依赖"当前激活编辑器"）。
 */
async function runBuild(spec: BuildSpec, uri?: vscode.Uri): Promise<void> {
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
  // 脚本读的是磁盘上的文件：先保存脏文档，避免编译到旧内容。
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
    void vscode.window.showErrorMessage(
      `没有 MAIN 函数，不允许链接：${base}`,
    );
    return;
  }

  const tpl = buildCommandFor(spec.key);
  const params = buildPlaceholders(doc, name);
  const command = expandBuildTemplate(tpl, params);
  const out = output();
  out.appendLine("");
  out.appendLine(`> ${spec.title}：${path.basename(doc.uri.fsPath)}`);
  out.appendLine(`  工作区：${root}`);
  out.appendLine(`  占位符：path=${params.path} fullpath=${params.fullpath} name=${params.name} fullname=${params.fullname}`);
  out.appendLine(`  模板：${tpl}`);
  out.appendLine(`  命令：${command}`);
  out.show(true);

  const started = Date.now();
  const code = await runShell(root, command, spec.title);
  const ms = Date.now() - started;
  if (code === null) {
    out.appendLine(`（已取消，${ms} ms）`);
    vscode.window.setStatusBarMessage(`${spec.title}已取消`, 3000);
    return;
  }
  out.appendLine(`（退出码 ${code}，${ms} ms）`);
  if (code === 0) {
    void vscode.window.showInformationMessage(`${spec.title}完成`);
  } else {
    out.show(true);
    void vscode.window.showErrorMessage(
      `${spec.title}失败（退出码 ${code}）：详见「Genero BDL 编译」输出`,
    );
  }
}

/** 立刻更新 `bdl.build.hasMain` 门控（决定 4GL「链接」按钮是否可用）。 */
function updateHasMainContext(): void {
  const doc = vscode.window.activeTextEditor?.document;
  const hasMain = doc?.languageId === "bdl" ? hasMainProgram(doc.getText()) : true;
  void vscode.commands.executeCommand(
    "setContext",
    "bdl.build.hasMain",
    hasMain,
  );
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