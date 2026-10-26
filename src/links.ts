// 「链接资料」TreeView（P7-E）：显示当前文件属于哪条链接链，以及反查引用程序。
//
// 数据全部来自语言服务器的两个自定义请求（bdl/linkTree / bdl/linkReferences）：
// 插件不读 .project/*.json，避免 schema 演进时两处都要改，也复用服务器已建好的
// 内存索引（反查 aws_xml 那种 324 组的场景，插件自己扫要几百毫秒）。
import * as path from "node:path";
import * as vscode from "vscode";

import { currentClient } from "./client";
import { linkEnabled as linkEnabledByMode } from "./settings";

/** 反查结果一页的条数（aws_xml 被 324 个程序引用，一次铺开会卡）。 */
const REF_PAGE = 50;

type TreeFile = { module?: string; code?: string; path?: string; main?: boolean };

type LinkTree = {
  found?: boolean;
  program?: string;
  main?: string;
  ambiguous?: boolean;
  files?: TreeFile[];
  modules?: Record<string, TreeFile[]>;
  refs?: string[];
  refTotal?: number;
};

type Node =
  | { kind: "info"; label: string; tooltip?: string }
  | { kind: "program"; tree: LinkTree }
  | { kind: "file"; file: TreeFile; label?: string }
  | { kind: "module"; name: string; files: TreeFile[] }
  | { kind: "refsButton"; total: number; loaded: number }
  | { kind: "ref"; program: string }
  | { kind: "moreRefs"; total: number; loaded: number };

/**
 * 链接资料功能开关（`bdl.link.mode`）。
 *
 * P1-4：**默认关闭**（轻量档：零配置、不连库、不后台跑任务、不往项目写文件）。
 * 显式给默认值是为了不依赖 package.json（两者必须一致：false）。
 */
export function linkEnabled(): boolean {
  return linkEnabledByMode();
}

/** 缓存最近一次请求的树，避免每次展开都跨进程要一次。 */
export class LinkTreeProvider implements vscode.TreeDataProvider<Node> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  private tree: LinkTree | undefined;
  private loaded = false;
  private loading: Promise<void> | undefined;
  /** 反查已经取回的条数（分页用；0 = 还没点过按钮）。 */
  private refsShown = 0;

  /** 刷新视图：清缓存，下次 getChildren 重新问服务器。 */
  refresh(): void {
    this.tree = undefined;
    this.loaded = false;
    this.loading = undefined;
    this.refsShown = 0;
    this.changed.fire();
  }

  getTreeItem(node: Node): vscode.TreeItem {
    switch (node.kind) {
      case "info": {
        const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon("info");
        item.tooltip = node.tooltip;
        item.contextValue = "bdlLinkInfo";
        return item;
      }
      case "program": {
        const t = node.tree;
        const label = t.main || t.program || "链接资料";
        const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Expanded);
        item.description = t.ambiguous ? "（该组有多个 MAIN）" : t.program;
        item.iconPath = new vscode.ThemeIcon("symbol-class");
        item.contextValue = "bdlLinkProgram";
        return item;
      }
      case "file": {
        const f = node.file;
        const label = node.label ?? (f.module ? `${f.module}/${f.code}` : (f.code ?? ""));
        const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
        // 用户要求显示"模组/程序代码"；MAIN 文件加个标记便于辨认。
        if (!node.label && f.main) {
          item.description = "MAIN";
        }
        item.iconPath = f.path
          ? new vscode.ThemeIcon("file-code")
          : new vscode.ThemeIcon("warning");
        item.tooltip = f.path ?? "资料里有、磁盘上没有（通常是语料快照缺的模组）";
        item.contextValue = "bdlLinkFile";
        if (f.path) {
          item.command = {
            command: "vscode.open",
            title: "打开",
            arguments: [vscode.Uri.file(f.path)],
          };
        }
        return item;
      }
      case "module": {
        const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.Collapsed);
        item.description = `${node.files.length} 个文件（全局可见）`;
        item.iconPath = new vscode.ThemeIcon("library");
        item.contextValue = "bdlLinkModule";
        return item;
      }
      case "refsButton": {
        const item = new vscode.TreeItem(
          node.loaded > 0 ? `被 ${node.total} 个程序链接` : "[ 反查引用程序 ]",
          node.loaded > 0
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.None,
        );
        item.iconPath = new vscode.ThemeIcon("search");
        item.command =
          node.loaded > 0
            ? undefined
            : { command: "bdl.links.references", title: "反查引用程序" };
        item.contextValue = "bdlLinkRefsButton";
        return item;
      }
      case "ref": {
        const item = new vscode.TreeItem(node.program, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon("symbol-class");
        // 反查结果里没有磁盘路径（同一代码可能在多个模组），所以不跳转；
        // 双击用快速打开去搜同名文件，比强行猜路径可靠。
        // 必须带 .4gl：不带后缀时 quickOpen 会把同名 .per 一起列出来。
        const base = node.program.replace(/^.*[\\/]/, "").replace(/\.(4gl|per)$/i, "");
        item.command = {
          command: "workbench.action.quickOpen",
          title: "打开程序",
          arguments: [`${base}.4gl`],
        };
        return item;
      }
      case "moreRefs": {
        const item = new vscode.TreeItem(
          `显示更多…（已显示 ${node.loaded}/${node.total}）`,
          vscode.TreeItemCollapsibleState.None,
        );
        item.iconPath = new vscode.ThemeIcon("ellipsis");
        item.command = { command: "bdl.links.moreRefs", title: "显示更多" };
        return item;
      }
    }
  }

  async getChildren(node?: Node): Promise<Node[]> {
    if (node) {
      return this.childrenOf(node);
    }
    await this.load();
    return this.rootNodes();
  }

  private async childrenOf(node: Node): Promise<Node[]> {
    switch (node.kind) {
      case "program":
        return (node.tree.files ?? []).map((file) => ({ kind: "file", file }));
      case "module":
        return node.files.map((file) => ({ kind: "file", file }));
      case "refsButton": {
        const total = node.total;
        const shown = Math.min(this.refsShown, total);
        const refs = (this.tree?.refs ?? []).slice(0, shown);
        const out: Node[] = refs.map((program) => ({ kind: "ref", program }));
        if (shown < total) {
          out.push({ kind: "moreRefs", total, loaded: shown });
        }
        return out;
      }
      default:
        return [];
    }
  }

  private rootNodes(): Node[] {
    if (!linkEnabled()) {
      return [
        {
          kind: "info",
          label: "链接资料功能已关闭",
          tooltip: "设置「链接资料 → 模式」为「不启用」后不加载资料、不启用相关诊断。\n改模式后执行「Genero BDL: 重启语言服务器」生效。",
        },
      ];
    }
    const t = this.tree;
    if (!t || (!t.found && !t.refTotal)) {
      return [
        {
          kind: "info",
          label: "未找到这个文件的链接资料",
          tooltip:
            "没有 .project/links.jsonl 时先运行 `tiptop link import -csv <导出.csv>` " +
            "或 `tiptop link sync`。子文件不属于任何链时也会显示这条。",
        },
      ];
    }
    const out: Node[] = [];
    if (t.found) {
      out.push({ kind: "program", tree: t });
    }
    if (t.refTotal) {
      // 默认不展开反查：aws_xml 被 324 个程序引用，先让用户点一下。
      out.push({ kind: "refsButton", total: t.refTotal, loaded: this.refsShown });
    }
    const modules = Object.entries(t.modules ?? {});
    modules.sort((a, b) => a[0].localeCompare(b[0]));
    for (const [name, files] of modules) {
      out.push({ kind: "module", name, files });
    }
    return out;
  }

  private activeUri(): vscode.Uri | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return undefined;
    }
    if (!["bdl", "per"].includes(editor.document.languageId)) {
      return undefined;
    }
    // untitled: 没有磁盘路径，发给服务器只会拿到"没有资料"；
    // 旧版服务器还会因此 panic，这里直接不发。
    if (editor.document.uri.scheme !== "file") {
      return undefined;
    }
    return editor.document.uri;
  }

  private async load(): Promise<void> {
    if (this.loaded) {
      return;
    }
    // 链接资料模式为 off：服务器侧不加载资料，这里也别发请求。
    if (!linkEnabled()) {
      this.tree = undefined;
      this.loaded = true;
      return;
    }
    if (this.loading) {
      return this.loading;
    }
    this.loading = (async () => {
      const uri = this.activeUri();
      const client = currentClient();
      if (!uri || !client) {
        this.tree = undefined;
        this.loaded = true;
        return;
      }
      try {
        this.tree = await client.sendRequest<LinkTree>("bdl/linkTree", {
          textDocument: { uri: uri.toString() },
        });
      } catch {
        // 服务器没起来（或旧版本不认这个请求）：静默降级成"没有资料"。
        this.tree = undefined;
      } finally {
        this.loaded = true;
      }
    })();
    try {
      await this.loading;
    } finally {
      this.loading = undefined;
    }
  }

  /** 反查按钮：取回一页并刷新视图。 */
  async showReferences(): Promise<void> {
    await this.load();
    if (!this.tree?.refTotal) {
      this.refresh();
      return;
    }
    this.refsShown = Math.min(REF_PAGE, this.tree.refTotal);
    this.changed.fire();
  }

  /** 「显示更多」：每次多给一页。 */
  moreReferences(): void {
    const total = this.tree?.refTotal ?? 0;
    this.refsShown = Math.min(this.refsShown + REF_PAGE, total);
    this.changed.fire();
  }
}

/** 注册视图、命令与随编辑切换自动刷新。 */
export function registerLinks(context: vscode.ExtensionContext): LinkTreeProvider {
  const provider = new LinkTreeProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("bdlLinks", provider),
    vscode.commands.registerCommand("bdl.links.refresh", () => provider.refresh()),
    vscode.commands.registerCommand("bdl.links.references", () => provider.showReferences()),
    vscode.commands.registerCommand("bdl.links.moreRefs", () => provider.moreReferences()),
    // 切文件就换内容；不监听文档内容变化（链接资料与正文无关）。
    vscode.window.onDidChangeActiveTextEditor(() => provider.refresh()),
    vscode.commands.registerCommand("bdl.migrateLinkDir", () => migrateLinkDir()),
  );
  registerLegacyDirWatcher(context);
  return provider;
}

/**
 * W6：`.project` 目录化布局。
 *
 *   .project/
 *   ├── secrets.json                  # 唯一留在根的单文件
 *   ├── link/{links.jsonl,links.meta.json,gal_file.csv}
 *   ├── schema/{tables.json,tables/,gal_schema.csv}
 *   └── deploy/deploy.json
 *
 * 历史位置（`.project` 根的 link 文件、`.project/.schema/`、`.project/deploy.json`、
 * `.link/`、`.bdl-lsp/deploy.json`）都能被 bdl-lsp/tiptop 读取；下面的迁移命令
 * 负责把它们搬到新位置。
 */
const PROJECT_DIR = ".project";
const LINK_DIR = "link";
const SCHEMA_DIR = "schema";
const DEPLOY_DIR = "deploy";

/** 迁移统计。 */
interface MigrateStat {
  moved: number;
  skipped: number;
}

/** 列出"旧位置 → 新位置"的候选（不一定存在，调用方先 stat）。 */
function legacySources(root: vscode.Uri): Array<[vscode.Uri, vscode.Uri]> {
  const project = vscode.Uri.joinPath(root, PROJECT_DIR);
  const link = vscode.Uri.joinPath(project, LINK_DIR);
  const schema = vscode.Uri.joinPath(project, SCHEMA_DIR);
  const deploy = vscode.Uri.joinPath(project, DEPLOY_DIR);
  const jobs: Array<[vscode.Uri, vscode.Uri]> = [];
  // 1) 最老的 .link/ → .project/link/
  jobs.push([vscode.Uri.joinPath(root, ".link"), link]);
  // 2) W6 之前的 .project 根 → .project/link/
  for (const name of ["links.jsonl", "links.meta.json", "gal_file.csv"]) {
    jobs.push([
      vscode.Uri.joinPath(project, name),
      vscode.Uri.joinPath(link, name),
    ]);
  }
  // 3) 字段资料旧目录 .project/.schema/ → .project/schema/
  jobs.push([vscode.Uri.joinPath(project, ".schema"), schema]);
  jobs.push([
    vscode.Uri.joinPath(project, "gal_schema.csv"),
    vscode.Uri.joinPath(schema, "gal_schema.csv"),
  ]);
  // 4) 部署配置 → .project/deploy/deploy.json
  jobs.push([
    vscode.Uri.joinPath(project, "deploy.json"),
    vscode.Uri.joinPath(deploy, "deploy.json"),
  ]);
  jobs.push([
    vscode.Uri.joinPath(root, ".bdl-lsp", "deploy.json"),
    vscode.Uri.joinPath(deploy, "deploy.json"),
  ]);
  return jobs;
}

async function statOrUndefined(
  uri: vscode.Uri,
): Promise<vscode.FileStat | undefined> {
  try {
    return await vscode.workspace.fs.stat(uri);
  } catch {
    return undefined;
  }
}

/** 迁移一个文件；目标已存在则不覆盖（计入 skipped）。 */
async function moveFile(
  from: vscode.Uri,
  to: vscode.Uri,
  stat: MigrateStat,
): Promise<void> {
  if (await statOrUndefined(to)) {
    stat.skipped += 1;
    return;
  }
  await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(to, ".."));
  await vscode.workspace.fs.rename(from, to, { overwrite: false });
  stat.moved += 1;
}

/** 递归迁移一个目录下的文件（保留子目录结构；不删空目录）。 */
async function moveDir(
  from: vscode.Uri,
  to: vscode.Uri,
  stat: MigrateStat,
): Promise<void> {
  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(from);
  } catch {
    return;
  }
  for (const [name, type] of entries) {
    const src = vscode.Uri.joinPath(from, name);
    const dst = vscode.Uri.joinPath(to, name);
    if (type === vscode.FileType.Directory) {
      await moveDir(src, dst, stat);
    } else {
      await moveFile(src, dst, stat);
    }
  }
}

/** 按类型迁移（目录递归、文件直搬）。 */
async function moveAny(
  from: vscode.Uri,
  to: vscode.Uri,
  stat: MigrateStat,
): Promise<void> {
  const info = await statOrUndefined(from);
  if (!info) {
    return;
  }
  if (info.type === vscode.FileType.Directory) {
    await moveDir(from, to, stat);
  } else {
    await moveFile(from, to, stat);
  }
}

/**
 * W6：把历史布局的项目资料整体搬到 `.project/{link,schema,deploy}/`。
 *
 * 只搬、不覆盖：目标已存在的文件保留原样并计入 skipped。
 * 搬完自动重启语言服务器，让服务端按新目录重新加载。
 */
async function migrateLinkDir(): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    void vscode.window.showWarningMessage("请先打开一个工作区");
    return;
  }
  const root = folders[0].uri;

  // 先算出真的存在哪些来源，避免"没有任何可搬的东西"还弹确认框。
  const present: Array<[vscode.Uri, vscode.Uri]> = [];
  for (const [from, to] of legacySources(root)) {
    if (await statOrUndefined(from)) {
      present.push([from, to]);
    }
  }
  if (present.length === 0) {
    void vscode.window.showInformationMessage(
      `没有需要迁移的旧资料（已经是 ${PROJECT_DIR}/{${LINK_DIR},${SCHEMA_DIR},${DEPLOY_DIR}}/ 布局）`,
    );
    return;
  }

  const pick = await vscode.window.showWarningMessage(
    `将把 ${present.length} 处旧资料搬到 ` +
      `${PROJECT_DIR}/{${LINK_DIR},${SCHEMA_DIR},${DEPLOY_DIR}}/（已存在的目标文件不覆盖），` +
      "搬完自动重启语言服务器。继续？",
    { modal: true },
    "迁移",
  );
  if (pick !== "迁移") {
    return;
  }

  const stat: MigrateStat = { moved: 0, skipped: 0 };
  for (const [from, to] of present) {
    await moveAny(from, to, stat);
  }
  void vscode.window.showInformationMessage(
    `已迁移 ${stat.moved} 个文件到 ${PROJECT_DIR}/` +
      (stat.skipped > 0 ? `（${stat.skipped} 个目标已存在，保留原样）` : "") +
      "，正在重启语言服务器",
  );
  await vscode.commands.executeCommand("bdl.restartServer");
}

/**
 * 服务端读到旧布局时会发 `link-data-legacy-dir`（hint）。
 * 这里接住它，弹一次"要不要迁移"的提示——PowerShell 用户不会去翻 Problems。
 */
function registerLegacyDirWatcher(context: vscode.ExtensionContext): void {
  let asked = false;
  context.subscriptions.push(
    vscode.languages.onDidChangeDiagnostics((e) => {
      if (asked) {
        return;
      }
      const hit = e.uris.some((uri) =>
        vscode.languages
          .getDiagnostics(uri)
          .some((d) => d.code === "link-data-legacy-dir"),
      );
      if (!hit) {
        return;
      }
      asked = true;
      void vscode.window
        .showInformationMessage(
          `项目资料还在旧目录布局，建议迁移到 ${PROJECT_DIR}/{${LINK_DIR},${SCHEMA_DIR},${DEPLOY_DIR}}/`,
          "迁移",
          "稍后",
        )
        .then((pick) => {
          if (pick === "迁移") {
            void vscode.commands.executeCommand("bdl.migrateLinkDir");
          }
        });
    }),
  );
}

/** 供信息面板展示：当前文件属于哪个链（没有则空串）。 */
export function describeActiveChain(provider: LinkTreeProvider): string {
  void provider;
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return "";
  }
  return path.basename(editor.document.fileName);
}
