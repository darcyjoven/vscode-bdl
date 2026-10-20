// bdl-lsp 可执行文件的定位。
//
// 查找顺序（与 README / 设置说明一致）：
//  1. 设置 `bdl.server.path`（可以是可执行文件，也可以是包含它的目录）
//  2. 环境变量 `BDL_LSP_PATH`（同上，文件或目录）
//  3. 工作区 `.bdl-lsp/bin/bdl-lsp`
//  4. 系统 `PATH`
//
// 找不到时抛出的错误必须**可操作**：告诉用户去哪儿放二进制、或者怎么改设置。
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

/** 可执行文件基名；Windows 需要 .exe 后缀。 */
export function binaryName(): string {
  return process.platform === "win32" ? "bdl-lsp.exe" : "bdl-lsp";
}

/** 二进制来源，用于日志与「服务器信息」展示。 */
export type BinaryOrigin =
  | "setting"
  | "env"
  | "workspace"
  | "path";

export interface ResolvedBinary {
  command: string;
  origin: BinaryOrigin;
  /** 用户的原始输入（设置值、环境变量值或 PATH 命中目录），用于诊断。 */
  detail: string;
}

/** 解析结果：成功给路径，失败给可读原因（不抛异常，便于一次性汇总）。 */
export type ResolveResult =
  | { ok: true; binary: ResolvedBinary }
  | { ok: false; message: string; hint: string };

/**
 * 判断路径是否是可用的可执行文件。
 *
 * Windows 上没有执行位概念，只检查存在性与是否为普通文件；
 * POSIX 上还要检查 execute 权限，否则 spawn 会报 EACCES，
 * 用户很难看出是权限问题。
 */
function isExecutableFile(candidate: string): boolean {
  try {
    const st = fs.statSync(candidate);
    if (!st.isFile()) {
      return false;
    }
    if (process.platform === "win32") {
      return true;
    }
    fs.accessSync(candidate, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * 把一个可能是「文件」也可能是「目录」的输入解析成可执行文件路径。
 *
 * 允许目录是为了方便用户直接填 `~/tools/bdl-lsp/bin`，
 * 不必精确到文件名。
 */
function fromFileOrDir(input: string): string | undefined {
  const trimmed = input.trim();
  if (trimmed === "") {
    return undefined;
  }
  const expanded = expandHome(trimmed);
  const resolved = path.resolve(expanded);

  if (isExecutableFile(resolved)) {
    return resolved;
  }
  const inDir = path.join(resolved, binaryName());
  if (isExecutableFile(inDir)) {
    return inDir;
  }
  return undefined;
}

/** 展开开头的 `~`，因为 VSCode 设置里用户习惯写 `~/...`。 */
function expandHome(p: string): string {
  if (p === "~") {
    return process.env.HOME ?? process.env.USERPROFILE ?? p;
  }
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    const home = process.env.HOME ?? process.env.USERPROFILE;
    if (home) {
      return path.join(home, p.slice(2));
    }
  }
  return p;
}

/** 在 PATH 中查找，行为与 shell 的 `which` 对齐。 */
function fromPathEnv(): string | undefined {
  const raw = process.env.PATH ?? process.env.Path ?? "";
  const name = binaryName();
  for (const dir of raw.split(path.delimiter)) {
    if (dir.trim() === "") {
      continue;
    }
    const candidate = path.join(dir, name);
    if (isExecutableFile(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

/** 工作区内的约定位置；多根工作区按顺序尝试。 */
function fromWorkspace(): { file: string; root: string } | undefined {
  const folders = vscode.workspace.workspaceFolders ?? [];
  for (const folder of folders) {
    if (folder.uri.scheme !== "file") {
      continue;
    }
    const candidate = path.join(
      folder.uri.fsPath,
      ".bdl-lsp",
      "bin",
      binaryName(),
    );
    if (isExecutableFile(candidate)) {
      return { file: candidate, root: folder.uri.fsPath };
    }
  }
  return undefined;
}

/**
 * 按优先级查找语言服务器可执行文件。
 *
 * 不做自动下载：发布与自动下载暂不排期，开发期用本地构建产物。
 */
export function resolveBinary(): ResolveResult {
  const attempts: string[] = [];

  const configured = vscode.workspace
    .getConfiguration("bdl")
    .get<string>("server.path", "")
    .trim();
  if (configured !== "") {
    const hit = fromFileOrDir(configured);
    if (hit) {
      return {
        ok: true,
        binary: { command: hit, origin: "setting", detail: configured },
      };
    }
    attempts.push(`设置 bdl.server.path = ${configured}`);
  }

  const envValue = (process.env.BDL_LSP_PATH ?? "").trim();
  if (envValue !== "") {
    const hit = fromFileOrDir(envValue);
    if (hit) {
      return {
        ok: true,
        binary: { command: hit, origin: "env", detail: envValue },
      };
    }
    attempts.push(`环境变量 BDL_LSP_PATH = ${envValue}`);
  }

  const ws = fromWorkspace();
  if (ws) {
    return {
      ok: true,
      binary: {
        command: ws.file,
        origin: "workspace",
        detail: path.join(".bdl-lsp", "bin", binaryName()),
      },
    };
  }
  attempts.push(
    `工作区 .bdl-lsp/bin/${binaryName()}${
      (vscode.workspace.workspaceFolders ?? []).length === 0
        ? "（当前没有打开文件夹）"
        : ""
    }`,
  );

  const onPath = fromPathEnv();
  if (onPath) {
    return {
      ok: true,
      binary: { command: onPath, origin: "path", detail: onPath },
    };
  }
  attempts.push(`系统 PATH 中的 ${binaryName()}`);

  return {
    ok: false,
    message: `未找到语言服务器 ${binaryName()}`,
    hint: buildHint(attempts),
  };
}

/** 把失败原因组织成一段用户能照着做的提示。 */
function buildHint(attempts: string[]): string {
  const lines = [
    "已尝试以下位置，均未找到可执行文件：",
    ...attempts.map((a) => `  • ${a}`),
    "",
    "解决办法（任选其一）：",
    "  1. 在设置中填写 bdl.server.path（可填可执行文件或所在目录）；",
    "  2. 设置环境变量 BDL_LSP_PATH；",
    `  3. 把 ${binaryName()} 放到工作区的 .bdl-lsp/bin/ 下；`,
    `  4. 把 ${binaryName()} 加入系统 PATH。`,
    "",
    "当前开发阶段使用本地构建产物，可在 bdl-lsp 仓库执行：",
    "  make build   # 产出 bdl-lsp/bin/bdl-lsp",
    "",
    "设置修改后执行命令「Genero BDL: 重启语言服务器」生效。",
  ];
  return lines.join("\n");
}

/** 面向日志的一行描述。 */
export function describeBinary(binary: ResolvedBinary): string {
  const originText: Record<BinaryOrigin, string> = {
    setting: "设置 bdl.server.path",
    env: "环境变量 BDL_LSP_PATH",
    workspace: "工作区 .bdl-lsp/bin",
    path: "系统 PATH",
  };
  return `${binary.command}（来源：${originText[binary.origin]}）`;
}
