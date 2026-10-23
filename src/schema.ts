// 「数据库字段」视图与命令（PLUGIN-PLAN P2-1）。
//
// 数据全部来自语言服务器的两个自定义请求（bdl/schemaTables / bdl/schemaColumns）：
// 插件不读 `.project/.schema/*.json`——schema 演进时只改一处，也让"正则过滤"
// 与"展开才加载"都发生在服务端（6 万行资料下视图不会卡）。
//
// 与链接资料一致的原则：
//   - 只由用户显式触发同步，没有后台任务；
//   - 会写项目资料的动作（导入/同步表）先 `-dry-run` 预演，用户确认后再落盘；
//   - 默认关闭（`bdl.schema.enable`），视图与命令都据此门控。
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";

import { currentClient } from "./client";
import { runTiptopOn, workspaceRoot } from "./linktools";

/** 一次列表请求的结果（与服务端 schemaTablesResult 对应）。 */
export interface SchemaTablesResult {
  enabled?: boolean;
  present?: boolean;
  error?: string;
  dataDir?: string;
  importedAt?: string;
  source?: string;
  rowsTotal?: number;
  total?: number;
  matched?: number;
  returned?: number;
  filterError?: string;
  tables?: { name: string; desc?: string; columns: number }[];
}

/** 单表列请求的结果（与服务端 schemaColumnsResult 对应）。 */
export interface SchemaColumnsResult {
  enabled?: boolean;
  present?: boolean;
  table?: string;
  desc?: string;
  missing?: boolean;
  columns?: SchemaColumn[];
}

export interface SchemaColumn {
  name: string;
  desc?: string;
  type?: string;
  length?: number;
  charLength?: number;
  precision?: number;
  scale?: number;
  nullable?: boolean;
  /** 实测是"默认长度"（0/2/4/8…），不是默认值，界面不展示。 */
  defaultLength?: string;
}

/** 数据库字段功能总开关（`bdl.schema.enable`，默认关）。 */
export function schemaEnabled(): boolean {
  return vscode.workspace
    .getConfiguration("bdl")
    .get<boolean>("schema.enable", false);
}

/** 字段资料目录（相对工作区根，默认 `.project/.schema`）。 */
function schemaDirName(): string {
  return (
    vscode.workspace.getConfiguration("bdl").get<string>("schema.dataDir") ||
    ".project/.schema"
  );
}

/** 输出通道（与链接资料分开，日志不混）。 */
let channel: vscode.OutputChannel | undefined;
function output(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel("Genero BDL 数据库字段");
  }
  return channel;
}

/** 释放输出通道（deactivate 时调）。 */
export function disposeSchemaView(): void {
  channel?.dispose();
  channel = undefined;
}

/** 查询表清单（正则过滤交给服务端）；服务器没起来时返回 undefined。 */
export async function querySchemaTables(
  query = "",
  limit = 0,
): Promise<SchemaTablesResult | undefined> {
  const client = currentClient();
  if (!client) {
    return undefined;
  }
  return client.sendRequest<SchemaTablesResult>("bdl/schemaTables", {
    query,
    limit,
  });
}

/** 查询单张表的列（展开表节点时才发）。 */
export async function querySchemaColumns(
  table: string,
): Promise<SchemaColumnsResult | undefined> {
  const client = currentClient();
  if (!client) {
    return undefined;
  }
  return client.sendRequest<SchemaColumnsResult>("bdl/schemaColumns", { table });
}

// ---------------------------------------------------------------------------
// 视图
// ---------------------------------------------------------------------------

type Node =
  | { kind: "info"; label: string; tooltip?: string; command?: vscode.Command }
  | { kind: "table"; name: string; desc?: string; columns: number }
  | { kind: "column"; table: string; col: SchemaColumn };

/** 列的一行展示：`ima01 · CHAR(10) · 物料编号`。 */
function columnLabel(col: SchemaColumn): string {
  const parts = [col.name];
  const type = columnType(col);
  if (type) {
    parts.push(type);
  }
  if (col.desc) {
    parts.push(col.desc);
  }
  return parts.join(" · ");
}

function columnType(col: SchemaColumn): string {
  const t = (col.type ?? "").toUpperCase();
  if (!t) {
    return "";
  }
  if ((col.scale ?? 0) > 0) {
    return `${t}(${col.precision ?? 0},${col.scale})`;
  }
  if ((col.precision ?? 0) > 0 && t.includes("NUMBER")) {
    return `${t}(${col.precision})`;
  }
  if ((col.length ?? 0) > 0) {
    return `${t}(${col.length})`;
  }
  return t;
}

class SchemaProvider implements vscode.TreeDataProvider<Node> {
  private readonly changed = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.changed.event;

  /** 当前正则过滤字符串。 */
  filter = "";
  /** 最近一次列表结果（info 节点与"共 N 张表"用它）。 */
  private tables: SchemaTablesResult | undefined;
  /** 已加载的表的列缓存（展开过就不重复请求）。 */
  private readonly columns = new Map<string, SchemaColumn[]>();
  /** 上次请求失败的原因（网络/服务器没起来）。 */
  private lastError = "";

  refresh(): void {
    this.columns.clear();
    this.changed.fire(undefined);
  }

  async load(): Promise<SchemaTablesResult | undefined> {
    const res = await querySchemaTables(this.filter);
    this.tables = res;
    this.lastError = res ? "" : "语言服务器未运行";
    return res;
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === "info") {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
      if (node.tooltip) {
        item.tooltip = node.tooltip;
      }
      if (node.command) {
        item.command = node.command;
      }
      return item;
    }
    if (node.kind === "table") {
      const item = new vscode.TreeItem(
        node.desc ? `${node.name} · ${node.desc}` : node.name,
        vscode.TreeItemCollapsibleState.Collapsed,
      );
      item.description = `${node.columns} 字段`;
      item.iconPath = new vscode.ThemeIcon("table");
      item.contextValue = "bdlSchemaTable";
      item.tooltip = new vscode.MarkdownString(
        `**${node.name}**\n\n${node.columns} 个字段（展开看列）`,
      );
      return item;
    }
    const item = new vscode.TreeItem(columnLabel(node.col), vscode.TreeItemCollapsibleState.None);
    item.contextValue = "bdlSchemaColumn";
    item.iconPath = new vscode.ThemeIcon("symbol-field");
    item.tooltip = new vscode.MarkdownString(tooltipFor(node.table, node.col));
    item.command = {
      command: "bdl.schema.copyColumn",
      title: "复制列定义",
      arguments: [node],
    };
    return item;
  }

  async getChildren(node?: Node): Promise<Node[]> {
    if (!node) {
      return this.roots();
    }
    if (node.kind === "table") {
      const cached = this.columns.get(node.name);
      if (cached) {
        return cached.map((col) => ({ kind: "column", table: node.name, col }) as Node);
      }
      const res = await querySchemaColumns(node.name);
      if (!res || res.missing || !res.columns || res.columns.length === 0) {
        return [{ kind: "info", label: "（没有这张表的列，试试「同步选中的表」）" }];
      }
      this.columns.set(node.name, res.columns);
      return res.columns.map((col) => ({ kind: "column", table: node.name, col }) as Node);
    }
    return [];
  }

  private async roots(): Promise<Node[]> {
    const res = this.tables ?? (await this.load());
    if (!res) {
      return [{ kind: "info", label: this.lastError || "语言服务器未运行" }];
    }
    const out: Node[] = [];
    if (!res.enabled) {
      out.push({ kind: "info", label: "数据库字段功能已关闭（bdl.schema.enable）" });
      return out;
    }
    if (!res.present) {
      out.push({
        kind: "info",
        label: res.error ? `字段资料读不出来：${res.error}` : "还没有字段资料",
        tooltip: res.dataDir ? `资料目录：${res.dataDir}` : undefined,
      });
      out.push({
        kind: "info",
        label: "运行「数据库字段：从 CSV 导入」生成资料",
        command: { command: "bdl.schema.import", title: "从 CSV 导入" },
      });
      return out;
    }
    if (res.filterError) {
      out.push({
        kind: "info",
        label: `正则无效：${res.filterError}（已显示全部）`,
        tooltip: "查询框支持正则；无效时会退回显示全部表",
      });
    }
    out.push({
      kind: "info",
      label: `共 ${res.total ?? 0} 张表${this.filter ? `，匹配 ${res.matched ?? 0}` : ""}${
        (res.returned ?? 0) < (res.matched ?? 0) ? `（显示前 ${res.returned}）` : ""
      }`,
      tooltip: [
        res.dataDir ? `资料目录：${res.dataDir}` : "",
        res.importedAt ? `导入时间：${res.importedAt}` : "",
        res.source ? `来源：${res.source}` : "",
        res.rowsTotal ? `CSV 行数：${res.rowsTotal}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    });
    if ((res.returned ?? 0) === 0) {
      out.push({ kind: "info", label: "没有匹配的表" });
      return out;
    }
    for (const t of res.tables ?? []) {
      out.push({ kind: "table", name: t.name, desc: t.desc, columns: t.columns });
    }
    return out;
  }

  /** 当前过滤串（供 e2e 与状态展示）。 */
  currentFilter(): string {
    return this.filter;
  }
}

/** 列悬停的 markdown。 */
function tooltipFor(table: string, col: SchemaColumn): string {
  const lines = [`**${table}.${col.name}**`];
  const type = columnType(col);
  if (type) {
    lines.push(`\n类型：\`${type}\``);
  }
  if (col.desc) {
    lines.push(`\n说明：${col.desc}`);
  }
  if (col.nullable) {
    lines.push("\n可空：是");
  }
  lines.push(`\n\n> 4GL：\`LIKE ${table}.${col.name}\``);
  return lines.join("");
}

// ---------------------------------------------------------------------------
// 命令
// ---------------------------------------------------------------------------

/** gal_schema.csv 在项目里的落点。 */
function schemaCSVPath(root: string): string {
  return path.join(root, ".project", "gal_schema.csv");
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

/** 从 CSV 导入：先复制到 `.project/gal_schema.csv`，`-dry-run` 预演后确认再落盘。 */
async function importSchema(provider: SchemaProvider): Promise<void> {
  const root = workspaceRoot();
  if (!root) {
    void vscode.window.showWarningMessage("请先打开一个工作区");
    return;
  }
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    title: "选择 Oracle 导出的表字段 CSV",
    filters: { CSV: ["csv"] },
  });
  if (!picked || picked.length === 0) {
    return;
  }
  const dest = schemaCSVPath(root);
  try {
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(picked[0].fsPath, dest);
  } catch (err) {
    void vscode.window.showErrorMessage(
      `复制 CSV 失败：${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }
  await runImport(provider, root, dest, [], "全量导入");
}

/** 跑一次 schema import（可选 -tables / -only-new），带预演确认。 */
async function runImport(
  provider: SchemaProvider,
  root: string,
  csv: string,
  extra: string[],
  label: string,
): Promise<void> {
  const out = output();
  const base = [
    "schema",
    "import",
    "-csv",
    csv,
    "-root",
    root,
    "-out",
    path.join(root, schemaDirName()),
    ...extra,
  ];
  const dry = await runTiptopOn(out, root, [...base, "-dry-run"]);
  if (dry.code !== 0) {
    out.show(true);
    void vscode.window.showErrorMessage(
      `${label}预演失败（退出码 ${dry.code ?? "?"}）：详见「Genero BDL 数据库字段」输出`,
    );
    return;
  }
  const pick = await vscode.window.showWarningMessage(
    `${label}：将写入 ${path.relative(root, path.join(root, schemaDirName()))}/（预演结果见输出）。继续？`,
    { modal: true },
    "导入",
  );
  if (pick !== "导入") {
    return;
  }
  const res = await runTiptopOn(out, root, base);
  if (res.code !== 0) {
    out.show(true);
    void vscode.window.showErrorMessage(
      `${label}失败（退出码 ${res.code ?? "?"}）：详见「Genero BDL 数据库字段」输出`,
    );
    return;
  }
  void vscode.window.showInformationMessage(`${label}完成`);
  provider.refresh();
}

/** 正则过滤（输入框；空串 = 清除）。 */
async function filterTables(provider: SchemaProvider): Promise<void> {
  const value = await vscode.window.showInputBox({
    title: "按正则过滤表名",
    prompt: "例如 ^APF / (apg|aph)0；留空显示全部",
    value: provider.currentFilter(),
    placeHolder: "^APF",
  });
  if (value === undefined) {
    return;
  }
  provider.filter = value.trim();
  provider.refresh();
}

/** 同步选中的表（右键）——从项目里的 gal_schema.csv 只更新这些表。 */
async function syncTable(provider: SchemaProvider, node?: Node): Promise<void> {
  const root = workspaceRoot();
  if (!root) {
    void vscode.window.showWarningMessage("请先打开一个工作区");
    return;
  }
  const table = node && node.kind === "table" ? node.name : undefined;
  if (!table) {
    void vscode.window.showWarningMessage("请在某张表上右键执行");
    return;
  }
  const csv = schemaCSVPath(root);
  if (!(await exists(csv))) {
    const pick = await vscode.window.showWarningMessage(
      `需要先有一份表字段 CSV（${path.relative(root, csv)}）。现在导入？`,
      "从 CSV 导入",
    );
    if (pick === "从 CSV 导入") {
      await vscode.commands.executeCommand("bdl.schema.import");
    }
    return;
  }
  await runImport(provider, root, csv, ["-tables", table], `同步表 ${table}`);
}

/** 复制列定义（4GL 形式：`LIKE table.col`）。 */
async function copyColumn(node?: Node): Promise<void> {
  if (!node || node.kind !== "column") {
    return;
  }
  const text = `LIKE ${node.table}.${node.col.name}`;
  await vscode.env.clipboard.writeText(text);
  vscode.window.setStatusBarMessage(`已复制：${text}`, 3000);
}

/** 打开某张表的资料文件（JSON，只读查看）。 */
async function openTable(root: string, table: string): Promise<void> {
  const file = path.join(root, schemaDirName(), "tables", `${table.toUpperCase()}.json`);
  if (!(await exists(file))) {
    void vscode.window.showWarningMessage(`找不到表资料文件：${path.relative(root, file)}`);
    return;
  }
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  await vscode.window.showTextDocument(doc, { preview: true });
}

/** 注册视图、命令与随工作区变化刷新。 */
export function registerSchemaView(context: vscode.ExtensionContext): SchemaProvider {
  const provider = new SchemaProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("bdlSchema", provider),
    vscode.commands.registerCommand("bdl.schema.refresh", async () => {
      await provider.load();
      provider.refresh();
    }),
    vscode.commands.registerCommand("bdl.schema.filter", () => filterTables(provider)),
    vscode.commands.registerCommand("bdl.schema.clearFilter", async () => {
      provider.filter = "";
      provider.refresh();
    }),
    vscode.commands.registerCommand("bdl.schema.import", () => importSchema(provider)),
    vscode.commands.registerCommand("bdl.schema.syncTable", (node?: Node) =>
      syncTable(provider, node),
    ),
    vscode.commands.registerCommand("bdl.schema.copyColumn", (node?: Node) =>
      copyColumn(node),
    ),
    vscode.commands.registerCommand("bdl.schema.openTable", async (node?: Node) => {
      const root = workspaceRoot();
      if (!root || !node || node.kind !== "table") {
        return;
      }
      await openTable(root, node.name);
    }),
    // 切文件/切工作区时重新拉一次（资料可能刚被导入）。
    vscode.workspace.onDidChangeWorkspaceFolders(() => provider.refresh()),
  );
  return provider;
}