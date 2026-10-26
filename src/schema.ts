// 「数据库字段」视图与命令（PLUGIN-PLAN P2-1）。
//
// 数据全部来自语言服务器的两个自定义请求（bdl/schemaTables / bdl/schemaColumns）：
// 插件不读 `.project/schema/*.json`——schema 演进时只改一处，也让"正则过滤"
// 与"展开才加载"都发生在服务端（几千张表下视图不会卡）。
//
// 采集/同步一律交给 tiptop（与链接资料一致）：
//   - 直连数据库：`tiptop schema sync -source golang`（复用「生产环境」里的 Oracle 配置）；
//   - 从 CSV：`tiptop schema import -csv …`（也可以 `schema sync -source file`）；
//   - **勾选一个或多个表**后批量同步：加 `-tables a,b,c`（只重算这些表）。
//
// 原则（与链接资料相同）：
//   - 只由用户显式触发，没有后台任务；
//   - 写项目资料的动作直接执行（W2：不再预演，预演只留给编译类命令），
//     用户确认后再落盘；
//   - 默认关闭（`bdl.schema.enable`），视图与命令都据此门控。
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";

import { currentClient } from "./client";
import { refreshDataContexts } from "./dbctx";
import {
  oracleCfg,
  promptNoOracle,
  reportRunFailure,
  runTiptopWithProgress,
  workspaceRoot,
} from "./linktools";

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

/** 预演报告里的统计（从 `== schema 同步 ==` 那几行解析）。 */
export interface SchemaSummary {
  rows?: number;
  tables?: number;
  added?: number;
  changed?: number;
  same?: number;
  kept?: number;
  pruned?: number;
}

/** 数据库字段功能总开关（`bdl.schema.enable`，默认关）。 */
export function schemaEnabled(): boolean {
  return vscode.workspace
    .getConfiguration("bdl")
    .get<boolean>("schema.enable", false);
}

/**
 * 「从数据库同步」每批查几张表（`bdl.schema.batchSize`，默认 200；0=不分批）。
 *
 * W7：全量一次性查几千张表在慢链路上会被单条查询超时取消（ORA-01013）；
 * 改成先取表清单、再每 N 张一批，跑完一批继续下一批。
 */
function schemaBatchSize(): number {
  const v = vscode.workspace
    .getConfiguration("bdl")
    .get<number>("schema.batchSize", 200);
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : 200;
}

/** 「从数据库同步」单批查询超时秒数（`bdl.schema.timeoutSec`，默认 120）。 */
function schemaTimeoutSec(): number {
  const v = vscode.workspace
    .getConfiguration("bdl")
    .get<number>("schema.timeoutSec", 120);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 120;
}

/** 字段资料目录（相对工作区根，默认 `.project/schema`；W6，旧 `.project/.schema` 只读兼容）。 */
function schemaDirName(): string {
  return (
    vscode.workspace.getConfiguration("bdl").get<string>("schema.dataDir") ||
    ".project/schema"
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

/**
 * 解析预演报告里的统计。
 *
 * 报告形状（tiptop `printImportReport`）是契约：
 *
 *	CSV 行数        58096
 *	表              2648（新增 2648 / 变更 0 / 未变 0 / 保留 0）
 *
 * 解析不出来时返回 undefined——调用方退化成"把输出给用户看，照样让确认"。
 */
export function parseSchemaSummary(text: string): SchemaSummary | undefined {
  const out: SchemaSummary = {};
  const rows = /CSV 行数\s+(\d+)/.exec(text);
  if (rows) {
    out.rows = Number(rows[1]);
  }
  const tables =
    /表\s+(\d+)（新增\s*(\d+)\s*\/\s*变更\s*(\d+)\s*\/\s*未变\s*(\d+)\s*\/\s*保留\s*(\d+)(?:\s*\/\s*删除\s*(\d+))?）/.exec(
      text,
    );
  if (tables) {
    out.tables = Number(tables[1]);
    out.added = Number(tables[2]);
    out.changed = Number(tables[3]);
    out.same = Number(tables[4]);
    out.kept = Number(tables[5]);
    out.pruned = tables[6] === undefined ? undefined : Number(tables[6]);
  }
  if (out.rows === undefined && out.tables === undefined) {
    return undefined;
  }
  return out;
}

/** 统计转成一句人话（确认框用）。 */
function describeSummary(s: SchemaSummary | undefined): string {
  if (!s) {
    return "未能从输出解析出统计（请看输出通道）";
  }
  const parts: string[] = [];
  if (s.tables !== undefined) {
    parts.push(`本次涉及 ${s.tables} 张表`);
  }
  if (s.added !== undefined) {
    parts.push(`新增 ${s.added}`);
  }
  if (s.changed !== undefined) {
    parts.push(`变更 ${s.changed}`);
  }
  if (s.same !== undefined) {
    parts.push(`未变 ${s.same}`);
  }
  if (s.kept) {
    parts.push(`保留 ${s.kept}`);
  }
  if (s.pruned) {
    parts.push(`删除 ${s.pruned}`);
  }
  if (s.rows !== undefined) {
    parts.push(`${s.rows} 行`);
  }
  return parts.join("，");
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

/** 供 e2e 使用的 provider 视图（只暴露断言需要的部分）。 */
export interface SchemaProviderApi {
  load(): Promise<SchemaTablesResult | undefined>;
  listedTables(): string[];
  listedTables(): string[];
  selectedTables(): string[];
  selection: Set<string>;
  currentFilter(): string;
  refresh(): void;
  getChildren(node?: unknown): Promise<unknown[]>;
  getTreeItem(node: unknown): vscode.TreeItem;
}

class SchemaProvider implements vscode.TreeDataProvider<Node> {
  private readonly changed = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.changed.event;

  /** 当前正则过滤字符串。 */
  filter = "";
  /** 勾选待同步的表（键为**小写表名**，比较与 CLI 都大小写不敏感）。 */
  readonly selection = new Set<string>();
  /** 最近一次列表结果（info 节点、"共 N 张表"与全选都用它）。 */
  private tables: SchemaTablesResult | undefined;
  /** 已加载的表的列缓存（展开过就不重复请求）。 */
  private readonly columns = new Map<string, SchemaColumn[]>();
  /** 上次请求失败的原因（网络/服务器没起来）。 */
  private lastError = "";

  refresh(): void {
    this.columns.clear();
    this.changed.fire(undefined);
  }

  /** 只重画某个节点（勾选变化时用，避免整棵树折叠）。 */
  refreshNode(node: Node): void {
    this.changed.fire(node);
  }

  /** 最近一次列出的表名（"全选当前过滤结果"用）。 */
  listedTables(): string[] {
    return (this.tables?.tables ?? []).map((t) => t.name);
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
      const checked = this.selection.has(node.name.toLowerCase());
      item.description = `${node.columns} 字段${checked ? " · 已勾选" : ""}`;
      item.iconPath = new vscode.ThemeIcon("table");
      item.contextValue = "bdlSchemaTable";
      // P2-1 补：树视图原生不能多选，用复选框实现"选一个或多个表批量同步"。
      item.checkboxState = checked
        ? vscode.TreeItemCheckboxState.Checked
        : vscode.TreeItemCheckboxState.Unchecked;
      item.tooltip = new vscode.MarkdownString(
        `**${node.name}**\n\n${node.columns} 个字段（展开看列）\n\n` +
          `勾选后可用「同步已选中的表」批量更新（只重算这些表）`,
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
        label: "从 CSV 导入，或从数据库同步",
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
    const selected = this.selection.size;
    out.push({
      kind: "info",
      label: `共 ${res.total ?? 0} 张表${this.filter ? `，匹配 ${res.matched ?? 0}` : ""}${
        (res.returned ?? 0) < (res.matched ?? 0) ? `（显示前 ${res.returned}）` : ""
      }${selected > 0 ? ` · 已勾选 ${selected} 张` : ""}`,
      tooltip: [
        res.dataDir ? `资料目录：${res.dataDir}` : "",
        res.importedAt ? `导入时间：${res.importedAt}` : "",
        res.source ? `来源：${res.source}` : "",
        res.rowsTotal ? `CSV 行数：${res.rowsTotal}` : "",
        "勾选表后可批量同步（-tables）",
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

  /** 当前勾选的表（小写、排序后）。 */
  selectedTables(): string[] {
    return [...this.selection].sort();
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

/** gal_schema.csv 在项目里的落点（与 tiptop 的默认一致）：`<schema 目录>/gal_schema.csv`。 */
function schemaCSVPath(root: string): string {
  return path.join(root, schemaDirName(), "gal_schema.csv");
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

/** `-tables` 超过这个数就改用 `-tables-file`（避免命令行过长，Windows 上限 ~32K）。 */
const TABLES_ARG_LIMIT = 100;

interface SyncOptions {
  /** 只同步这些表（`-tables`，大小写不敏感）。 */
  tables?: string[];
  /** 强制来源：db=直连数据库，csv=用项目里的 gal_schema.csv。 */
  force?: "db" | "csv";
  /** force=csv 时用这份 CSV（默认项目里的 gal_schema.csv）。 */
  csvPath?: string;
  /** 动作名（确认框与提示里用）。 */
  label: string;
  /** 允许 `-prune`（只对全量 DB 同步有意义）。 */
  prune?: boolean;
}

/**
 * 同步字段资料。
 *
 * 来源选择：`force` 优先；否则配了 Oracle 就用数据库，否则用项目里的 CSV，
 * 都没有就提示用户（打开设置 / 从 CSV 导入）。
 *
 * W2：会写盘的动作**直接执行**（不再预演）；预演只留给编译类命令。
 */
async function syncSchema(
  provider: SchemaProvider,
  options: SyncOptions,
): Promise<void> {
  const root = workspaceRoot();
  if (!root) {
    void vscode.window.showWarningMessage("请先打开一个工作区");
    return;
  }
  const oracle = oracleCfg();
  const csv = options.csvPath ?? schemaCSVPath(root);
  let source: "db" | "csv";
  if (options.force) {
    source = options.force;
  } else if (oracle) {
    source = "db";
  } else if (await exists(csv)) {
    source = "csv";
  } else {
    await promptNoOracle(root);
    return;
  }
  if (source === "db" && !oracle) {
    await promptNoOracle(root);
    return;
  }
  if (source === "csv" && !(await exists(csv))) {
    void vscode.window.showWarningMessage(
      `找不到 ${path.relative(root, csv)}：先用「数据库字段：从 CSV 导入」选一份导出文件`,
    );
    return;
  }

  const extra: string[] = [];
  const dataDir = path.join(root, schemaDirName());
  if (options.tables && options.tables.length > 0) {
    if (options.tables.length > TABLES_ARG_LIMIT) {
      // 表多时走文件：命令行有长度上限（Windows ~32K），几千张表会直接失败。
      const listFile = path.join(dataDir, ".tables.txt");
      await fs.mkdir(dataDir, { recursive: true });
      await fs.writeFile(listFile, `${options.tables.join("\n")}\n`, "utf8");
      extra.push("-tables-file", listFile);
    } else {
      extra.push("-tables", options.tables.join(","));
    }
  } else if (options.prune) {
    // -prune 只对"全量"有意义；有 -tables 时 tiptop 会直接拒绝这种组合。
    extra.push("-prune");
  }
  const base =
    source === "db" && oracle
      ? [
          "schema",
          "sync",
          "-root",
          root,
          "-out",
          path.join(root, schemaDirName()),
          "-source",
          "golang",
          "-host",
          oracle.host,
          "-port",
          String(oracle.port),
          "-service",
          oracle.service,
          "-user",
          oracle.user,
          "-batch-size",
          String(schemaBatchSize()),
          "-timeout",
          String(schemaTimeoutSec()),
          ...extra,
        ]
      : [
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

  const out = output();
  // W2（Windows 实机反馈）：不再预演——dry-run 会把整份 CSV/查询跑两遍。
  // 只有编译类命令允许预演。全量操作保留一次**不重新扫描**的静态确认；
  // 单表 / 勾选批量 / 筛选批量直接执行。
  const isFull = !options.tables || options.tables.length === 0;
  if (isFull) {
    const from = source === "db" ? "数据库" : "CSV";
    const pick = await vscode.window.showWarningMessage(
      `${options.label}：将从${from}重算全部字段资料。通常几分钟、也可能更长，` +
        `请开「输出 → Genero BDL 数据库字段」看进度。继续？`,
      { modal: true },
      "开始",
    );
    if (pick !== "开始") {
      return;
    }
  }
  // W7.5：显式把输出写进「数据库字段」通道（否则会落到「链接资料」通道）。
  const res = await runTiptopWithProgress(root, base, options.label, out);
  if (res.cancelled) {
    vscode.window.setStatusBarMessage(`${options.label}已取消`, 3000);
    return;
  }
  if (res.code !== 0) {
    // W7.6：通知里带 stderr 首行 + 「打开日志」；完整输出仍在「数据库字段」通道。
    await reportRunFailure(options.label, res, out);
    return;
  }
  void vscode.window.showInformationMessage(
    `${options.label}完成：${describeSummary(parseSchemaSummary(res.stdout))}`,
  );
  provider.refresh();
  // W3/W4：字段资料可能刚生成，刷新"局部更新按钮"的显隐条件。
  void refreshDataContexts();
}

/** 从 CSV 导入：复制到 `.project/schema/gal_schema.csv`，确认后落盘。 */
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
  await syncSchema(provider, { force: "csv", csvPath: dest, label: "全量导入" });
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

/** 同步勾选的一张或多张表。 */
async function syncSelected(provider: SchemaProvider): Promise<void> {
  const tables = provider.selectedTables();
  if (tables.length === 0) {
    void vscode.window.showWarningMessage(
      "先在「数据库字段」视图里勾选一张或多张表（复选框），再执行批量同步",
    );
    return;
  }
  const shown = tables.slice(0, 8).join(", ");
  await syncSchema(provider, {
    tables,
    label: `同步 ${tables.length} 张表（${shown}${tables.length > 8 ? " …" : ""}）`,
  });
}

/** 同步"当前筛选结果"里的全部表（正则过滤后的列表）。 */
async function syncFiltered(provider: SchemaProvider): Promise<void> {
  const tables = provider.listedTables();
  if (tables.length === 0) {
    void vscode.window.showWarningMessage("当前列表没有表（可能正则没匹配到）");
    return;
  }
  await syncSchema(provider, {
    tables,
    label: `同步当前筛选结果（${tables.length} 张表）`,
  });
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

/** 注册视图、命令与勾选交互。 */
export function registerSchemaView(context: vscode.ExtensionContext): SchemaProvider {
  const provider = new SchemaProvider();
  const view = vscode.window.createTreeView("bdlSchema", {
    treeDataProvider: provider,
    showCollapseAll: true,
  });

  /** 勾选数量显示在视图标题右侧。 */
  const syncViewDescription = (): void => {
    const n = provider.selection.size;
    view.description = n > 0 ? `已勾选 ${n} 张` : undefined;
  };

  context.subscriptions.push(
    view,
    view.onDidChangeCheckboxState((e) => {
      for (const [node, state] of e.items) {
        const t = node as Node;
        if (t.kind !== "table") {
          continue;
        }
        if (state === vscode.TreeItemCheckboxState.Checked) {
          provider.selection.add(t.name.toLowerCase());
        } else {
          provider.selection.delete(t.name.toLowerCase());
        }
        provider.refreshNode(t);
      }
      syncViewDescription();
    }),
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
    // 单表右键（等价于只勾选这一张）
    vscode.commands.registerCommand("bdl.schema.syncTable", (node?: Node) => {
      if (!node || node.kind !== "table") {
        void vscode.window.showWarningMessage("请在某张表上右键执行");
        return;
      }
      return syncSchema(provider, { tables: [node.name], label: `同步表 ${node.name}` });
    }),
    // P2-1 补：勾选多张后批量同步
    vscode.commands.registerCommand("bdl.schema.syncSelected", () => syncSelected(provider)),
    vscode.commands.registerCommand("bdl.schema.syncFiltered", () => syncFiltered(provider)),
    // P2-1 补：直连数据库全量同步（本地多出的表用 -prune 清理）
    vscode.commands.registerCommand("bdl.schema.syncAll", () =>
      syncSchema(provider, { force: "db", prune: true, label: "从数据库全量同步" }),
    ),
    vscode.commands.registerCommand("bdl.schema.selectAll", () => {
      for (const name of provider.listedTables()) {
        provider.selection.add(name.toLowerCase());
      }
      provider.refresh();
      syncViewDescription();
    }),
    vscode.commands.registerCommand("bdl.schema.clearSelection", () => {
      provider.selection.clear();
      provider.refresh();
      syncViewDescription();
    }),
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
    // 切工作区时重新拉一次（资料可能刚被导入）。
    vscode.workspace.onDidChangeWorkspaceFolders(() => provider.refresh()),
  );
  syncViewDescription();
  return provider;
}