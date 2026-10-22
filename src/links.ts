// 「链接资料」TreeView（P7-E）：显示当前文件属于哪条链接链，以及反查引用程序。
//
// 数据全部来自语言服务器的两个自定义请求（bdl/linkTree / bdl/linkReferences）：
// 插件不读 .link/*.json，避免 schema 演进时两处都要改，也复用服务器已建好的
// 内存索引（反查 aws_xml 那种 324 组的场景，插件自己扫要几百毫秒）。
import * as path from "node:path";
import * as vscode from "vscode";

import { currentClient } from "./client";

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
    const t = this.tree;
    if (!t || (!t.found && !t.refTotal)) {
      return [
        {
          kind: "info",
          label: "未找到这个文件的链接资料",
          tooltip:
            "没有 .link/links.jsonl 时先运行 `bdl-lsp link import -csv <导出.csv>` " +
            "或 `bdl-lsp link sync`。子文件不属于任何链时也会显示这条。",
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
  );
  return provider;
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
