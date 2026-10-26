// W3/W4：数据库与资料的"就绪状态"上下文。
//
// 「链接资料」视图的「从数据库更新」按钮、以及「数据库字段」视图里的
// 局部/批量同步按钮，都需要"数据库连接已配置"；局部更新还额外需要
// "已经做过一次全量导入"。这些条件用 VSCode 的 context key 暴露给
// package.json 的 `when`，条件不满足时按钮直接不出现（而不是弹错误）。
//
// 判定口径（与 OPEN-ITEMS §5 的建议一致）：
//   - `bdl.db.configured`   = `bdl.prod.oracle.host/service/user` 三项都非空；
//   - `bdl.link.hasData`    = 解析到的链接资料目录里有 links.jsonl
//                             （能走到局部更新就说明有过全量基线：tiptop 的
//                              局部更新在没有基线时会直接报错）；
//   - `bdl.schema.hasData`  = 解析到的字段资料目录里有 tables.json。
//
// 目录解析与 bdl-lsp/tiptop 一致：新布局优先（`.project/link`、`.project/schema`），
// 回退历史布局（`.project` 根、`.link`、`.project/.schema`）。
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";

import {
  buildEnabled,
  linkEnabled,
  linkMode,
  schemaEnabled,
  schemaMode,
  transport,
  uploadEnabled,
  type DataMode,
} from "./settings";

/** 链接资料候选目录（新 → 旧）。 */
const LINK_DIRS = [".project/link", ".project", ".link"];
/** 字段资料候选目录（新 → 旧）。 */
const SCHEMA_DIRS = [".project/schema", ".project/.schema"];

/** 就绪状态快照（e2e 也用它做断言）。 */
export interface DbReadiness {
  /** Oracle host/service/user 三项是否都配了。 */
  configured: boolean;
  /** 是否已经有链接资料（等价"做过一次全量导入"）。 */
  linkHasData: boolean;
  /** 是否已经有字段资料（等价"做过一次全量导入"）。 */
  schemaHasData: boolean;
  /** 链接资料实际所在目录（相对工作区根；没有为空串）。 */
  linkDir: string;
  /** 字段资料实际所在目录（相对工作区根；没有为空串）。 */
  schemaDir: string;
  /** 链接资料模式（off/file/db）。 */
  linkMode: DataMode;
  /** 字段资料模式（off/file/db）。 */
  schemaMode: DataMode;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

/** 第一个工作区根（与 linktools.workspaceRoot 相同语义，这里独立实现避免循环依赖）。 */
export function firstWorkspaceRoot(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  return folders && folders.length > 0 ? folders[0].uri.fsPath : undefined;
}

/** Oracle 连接三项（host/service/user）是否都配了。 */
export function oracleConfigured(): boolean {
  const c = vscode.workspace.getConfiguration("bdl");
  const host = (c.get<string>("prod.oracle.host") ?? "").trim();
  const service = (c.get<string>("prod.oracle.service") ?? "").trim();
  const user = (c.get<string>("prod.oracle.user") ?? "").trim();
  return host !== "" && service !== "" && user !== "";
}

/** 在候选目录里找第一个含 `file` 的目录；找不到返回空串。 */
async function findDirWith(
  root: string,
  dirs: readonly string[],
  file: string,
): Promise<string> {
  for (const d of dirs) {
    if (await exists(path.join(root, d, file))) {
      return d;
    }
  }
  return "";
}

/** 计算当前就绪状态（不写 context key，便于 e2e 直接断言）。 */
export async function readDbReadiness(): Promise<DbReadiness> {
  const root = firstWorkspaceRoot();
  const out: DbReadiness = {
    configured: oracleConfigured(),
    linkHasData: false,
    schemaHasData: false,
    linkDir: "",
    schemaDir: "",
    linkMode: linkMode(),
    schemaMode: schemaMode(),
  };
  if (!root) {
    return out;
  }
  out.linkDir = await findDirWith(root, LINK_DIRS, "links.jsonl");
  out.schemaDir = await findDirWith(root, SCHEMA_DIRS, "tables.json");
  out.linkHasData = out.linkDir !== "";
  out.schemaHasData = out.schemaDir !== "";
  return out;
}

/** 批量 setContext（少写点重复调用）。 */
async function setContext(key: string, value: unknown): Promise<void> {
  await vscode.commands.executeCommand("setContext", key, value);
}

/** 把就绪状态写进 context key，供 package.json 的 `when` / `enablement` 使用。 */
export async function refreshDataContexts(): Promise<DbReadiness> {
  const r = await readDbReadiness();
  await setContext("bdl.db.configured", r.configured);
  await setContext("bdl.link.enabled", linkEnabled());
  await setContext("bdl.schema.enabled", schemaEnabled());
  await setContext("bdl.link.modeDb", r.linkMode === "db");
  await setContext("bdl.schema.modeDb", r.schemaMode === "db");
  await setContext("bdl.link.hasData", r.linkHasData);
  await setContext("bdl.schema.hasData", r.schemaHasData);
  await setContext("bdl.upload.enabled", uploadEnabled() && transport() !== "off");
  await setContext("bdl.build.enabled", buildEnabled());
  return r;
}

/**
 * 注册自动刷新：配置变化、工作区变化、以及资料文件本身出现/消失/更新时
 * 重算 context。
 *
 * 资料文件只监听索引文件（links.jsonl / tables.json），不监听整棵
 * `.project/**`——schema 目录下可能有几千个表文件，监听全部会让文件监听器很忙。
 */
export function registerDataContextWatcher(
  context: vscode.ExtensionContext,
): void {
  const refresh = (): void => {
    void refreshDataContexts();
  };

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration("bdl.prod.oracle") ||
        e.affectsConfiguration("bdl.prod.deploy") ||
        e.affectsConfiguration("bdl.link") ||
        e.affectsConfiguration("bdl.schema") ||
        e.affectsConfiguration("bdl.deploy") ||
        e.affectsConfiguration("bdl.build")
      ) {
        refresh();
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(refresh),
  );

  const patterns = [
    "**/.project/link/links.jsonl",
    "**/.project/links.jsonl",
    "**/.link/links.jsonl",
    "**/.project/schema/tables.json",
    "**/.project/.schema/tables.json",
  ];
  for (const pattern of patterns) {
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    watcher.onDidCreate(refresh);
    watcher.onDidDelete(refresh);
    watcher.onDidChange(refresh);
    context.subscriptions.push(watcher);
  }

  refresh();
}