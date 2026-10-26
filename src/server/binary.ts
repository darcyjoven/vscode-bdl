// bdl-lsp 可执行文件的定位。
//
// 查找顺序（与 README / 设置说明一致）：
//  1. 设置 `bdl.server.path`（可以是可执行文件，也可以是包含它的目录）
//  2. 环境变量 `BDL_LSP_PATH`（同上，文件或目录）
//  3. 扩展包内置 `bin/bdl-lsp`（平台包自带；安装即可用）
//  4. 工作区 `.bdl-lsp/bin/bdl-lsp`
//  5. 系统 `PATH`
//
// 找不到时抛出的错误必须**可操作**：告诉用户去哪儿放二进制、或者怎么改设置。
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

/**
 * 扩展涉及的两个可执行文件。
 *
 * - `lsp`：语言服务器，编辑器直接拉起，只读 `.project/` 资料；
 * - `tools`：`tiptop`，负责采集链接资料与部署（生成 `.link/`、上传编译）。
 *
 * 两者**都必须**存在才能用全功能：LSP 负责语言智能，tiptop 负责
 * "资料从哪来"和"改完怎么送上去"。分离的理由见 bdl-lsp 的
 * docs/FEATURES.md §0 职责与边界。
 */
export type BinaryKind = "lsp" | "tools";

/** 各二进制的基名；Windows 需要 .exe 后缀。 */
const BASE_NAMES: Record<BinaryKind, string> = {
  lsp: "bdl-lsp",
  tools: "tiptop",
};

/** 可执行文件基名；Windows 需要 .exe 后缀。 */
export function binaryName(kind: BinaryKind = "lsp"): string {
  const base = BASE_NAMES[kind];
  return process.platform === "win32" ? `${base}.exe` : base;
}

/** 二进制来源，用于日志与「服务器信息」展示。 */
export type BinaryOrigin =
  | "setting"
  | "env"
  | "bundled"
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
function fromFileOrDir(input: string, kind: BinaryKind): string | undefined {
  const trimmed = input.trim();
  if (trimmed === "") {
    return undefined;
  }
  const expanded = expandHome(trimmed);
  const resolved = path.resolve(expanded);

  if (isExecutableFile(resolved)) {
    return resolved;
  }
  const inDir = path.join(resolved, binaryName(kind));
  if (isExecutableFile(inDir)) {
    return inDir;
  }
  return undefined;
}

/** 当前进程对应的 VSCode 平台标识，用于识别内置二进制的目标。 */
function currentTarget(): string {
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  return `${process.platform}-${arch}`;
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
function fromPathEnv(kind: BinaryKind): string | undefined {
  const raw = process.env.PATH ?? process.env.Path ?? "";
  const name = binaryName(kind);
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

/**
 * 扩展包内置的二进制。
 *
 * 平台包（win32-x64 / linux-x64 / darwin-x64 / darwin-arm64）把对应平台
 * 的 `bdl-lsp` 放在扩展根目录的 `bin/` 下，安装后无需再单独准备。
 *
 * VSIX 解压后 POSIX 可执行位可能丢失，这里补一次 chmod；失败不抛异常，
 * 继续尝试其它来源。
 */
function fromBundled(
  kind: BinaryKind,
  extensionPath?: string,
): string | undefined {
  if (!extensionPath) {
    return undefined;
  }
  // 装错平台包时直接跳过，避免 spawn 报 exec format error；
  // BUILD-INFO.json 不存在（开发期直接放二进制）时不做限制。
  try {
    const info = JSON.parse(
      fs.readFileSync(path.join(extensionPath, "bin", "BUILD-INFO.json"), "utf8"),
    ) as { target?: string };
    if (info.target && info.target !== currentTarget()) {
      return undefined;
    }
  } catch {
    // 没有 BUILD-INFO.json：按可执行文件本身判断
  }
  const candidate = path.join(extensionPath, "bin", binaryName(kind));
  if (process.platform !== "win32") {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
    } catch {
      try {
        fs.chmodSync(candidate, 0o755);
      } catch {
        // 安装目录只读等情况下交给 isExecutableFile 判断
      }
    }
  }
  return isExecutableFile(candidate) ? candidate : undefined;
}

/** 工作区内的约定位置；多根工作区按顺序尝试。 */
function fromWorkspace(
  kind: BinaryKind,
): { file: string; root: string } | undefined {
  const folders = vscode.workspace.workspaceFolders ?? [];
  for (const folder of folders) {
    if (folder.uri.scheme !== "file") {
      continue;
    }
    const candidate = path.join(
      folder.uri.fsPath,
      ".bdl-lsp",
      "bin",
      binaryName(kind),
    );
    if (isExecutableFile(candidate)) {
      return { file: candidate, root: folder.uri.fsPath };
    }
  }
  return undefined;
}

/**
 * 按优先级查找一个可执行文件。
 *
 * 不做自动下载：发布与自动下载暂不排期，开发期用本地构建产物。
 *
 * @param kind      查语言服务器还是 tiptop
 * @param settingKey  对应的 VSCode 设置名（如 `server.path`）
 * @param envVar    对应的环境变量名
 */
function resolveExecutable(
  kind: BinaryKind,
  settingKey: string,
  envVar: string,
  extensionPath?: string,
): ResolveResult {
  const attempts: string[] = [];
  const name = binaryName(kind);
  const label = kind === "lsp" ? "语言服务器" : "链接资料/部署工具";

  const configured = vscode.workspace
    .getConfiguration("bdl")
    .get<string>(settingKey, "")
    .trim();
  if (configured !== "") {
    const hit = fromFileOrDir(configured, kind);
    if (hit) {
      return {
        ok: true,
        binary: { command: hit, origin: "setting", detail: configured },
      };
    }
    attempts.push(`设置 bdl.${settingKey} = ${configured}`);
  }

  const envValue = (process.env[envVar] ?? "").trim();
  if (envValue !== "") {
    const hit = fromFileOrDir(envValue, kind);
    if (hit) {
      return {
        ok: true,
        binary: { command: hit, origin: "env", detail: envValue },
      };
    }
    attempts.push(`环境变量 ${envVar} = ${envValue}`);
  }

  const bundled = fromBundled(kind, extensionPath);
  if (bundled) {
    return {
      ok: true,
      binary: {
        command: bundled,
        origin: "bundled",
        detail: path.join("bin", name),
      },
    };
  }
  attempts.push(`扩展内置 bin/${name}（不存在，或安装包与当前平台不匹配）`);

  const ws = fromWorkspace(kind);
  if (ws) {
    return {
      ok: true,
      binary: {
        command: ws.file,
        origin: "workspace",
        detail: path.join(".bdl-lsp", "bin", name),
      },
    };
  }
  attempts.push(
    `工作区 .bdl-lsp/bin/${name}${
      (vscode.workspace.workspaceFolders ?? []).length === 0
        ? "（当前没有打开文件夹）"
        : ""
    }`,
  );

  const onPath = fromPathEnv(kind);
  if (onPath) {
    return {
      ok: true,
      binary: { command: onPath, origin: "path", detail: onPath },
    };
  }
  attempts.push(`系统 PATH 中的 ${name}`);

  return {
    ok: false,
    message: `未找到${label} ${name}`,
    hint: buildHint(attempts, kind),
  };
}

/**
 * 查找语言服务器 `bdl-lsp`。
 */
export function resolveBinary(extensionPath?: string): ResolveResult {
  return resolveExecutable("lsp", "server.path", "BDL_LSP_PATH", extensionPath);
}

/**
 * 查找 `tiptop`（链接资料采集 + 部署）。
 *
 * 与语言服务器分开解析：两者可以来自不同位置（比如开发期 LSP 用内置，
 * tiptop 用本地构建）。找不到时部署/采集命令给出各自的提示。
 */
export function resolveTools(extensionPath?: string): ResolveResult {
  return resolveExecutable("tools", "tools.path", "TIPTOP_PATH", extensionPath);
}

/** 把失败原因组织成一段用户能照着做的提示。 */
function buildHint(attempts: string[], kind: BinaryKind): string {
  const name = binaryName(kind);
  if (kind === "tools") {
    return [
      "已尝试以下位置，均未找到 " + name + "：",
      ...attempts.map((a) => `  • ${a}`),
      "",
      "`tiptop` 负责采集链接资料与部署，从 bdl-lsp 分离而来。",
      "解决办法（任选其一）：",
      "  1. 重新安装与当前系统/芯片匹配的扩展包（安装包自带 tiptop）；",
      "  2. 在设置中填写 bdl.tools.path（可填可执行文件或所在目录）；",
      "  3. 设置环境变量 TIPTOP_PATH；",
      `  4. 把 ${name} 放到工作区的 .bdl-lsp/bin/ 下；`,
      `  5. 把 ${name} 加入系统 PATH。`,
      "",
      "从源码运行扩展时，可先在 tiptop 仓库执行：",
      "  make build   # 产出 tiptop/artifacts/bin/tiptop",
    ].join("\n");
  }

  const lines = [
    "已尝试以下位置，均未找到可执行文件：",
    ...attempts.map((a) => `  • ${a}`),
    "",
    "解决办法（任选其一）：",
    "  1. 重新安装与当前系统/芯片匹配的扩展包（安装包自带语言服务器）；",
    "  2. 在设置中填写 bdl.server.path（可填可执行文件或所在目录）；",
    "  3. 设置环境变量 BDL_LSP_PATH；",
    `  4. 把 ${name} 放到工作区的 .bdl-lsp/bin/ 下；`,
    `  5. 把 ${name} 加入系统 PATH。`,
    "",
    "从源码运行扩展时，可先在 bdl-lsp 仓库执行：",
    "  make build   # 产出 bdl-lsp/artifacts/bin/bdl-lsp",
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
    bundled: "扩展内置 bin/",
    workspace: "工作区 .bdl-lsp/bin",
    path: "系统 PATH",
  };
  return `${binary.command}（来源：${originText[binary.origin]}）`;
}
