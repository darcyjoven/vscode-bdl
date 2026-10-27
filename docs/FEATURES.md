# 功能总清单（Genero BDL 工具链）

> **面向开发者**的功能索引：把 **vscode-bdl（VSCode 插件）/ bdl-lsp（语言服务）/ tiptop（采集与部署 CLI）**
> 三个组件的全部已实现能力，**按功能类型**整理成可快速浏览的清单，可直接当验收表或二次开发入口用。
>
> | 项目 | 值 |
> |---|---|
> | 覆盖版本 | `bdl-lsp v0.3.13` · `tiptop v0.1.8` · `vscode-bdl v0.6.2` |
> | 生成日期 | 2026-10-24 |
> | 权威细节 | 诊断码见 `bdl-lsp/docs/DIAGNOSTICS.md`；用户可见用法见 [`README.md`](../README.md) |
>
> **归属标记**：`LSP` = [bdl-lsp](https://github.com/darcyjoven/bdl-lsp) ·
> `TIPTOP` = [tiptop](https://github.com/darcyjoven/tiptop) ·
> `VSC` = [vscode-bdl](https://github.com/darcyjoven/vscode-bdl)（本仓库）。
> 本文件是**总表**；单组件切片见
> `bdl-lsp/docs/FEATURES.md`、`tiptop/docs/FEATURES.md`。

> **维护规则**：待办（`vscode-bdl/docs/TODO.md`）完成后，把新功能补进本文对应条目；
> 用户可见的新功能还要同步更新 `vscode-bdl/README.md`（唯一用户引导）与对应组件的功能文档。


---

## 0. 组件分工与数据流

| 组件 | 交付物 | 职责 | 不做什么 |
|---|---|---|---|
| **LSP**（`bdl-lsp`） | `bdl-lsp` 二进制（stdio LSP + `check` CLI） | 解析、诊断、跳转、补全、格式化、字段/表单/GLOBALS 校验；**只读**项目资料 | 不采集资料、不部署 |
| **TIPTOP**（`tiptop`） | `tiptop` 二进制 | 链接资料与表字段资料采集、部署（上传 + 远程编译） | 不做语言智能 |
| **VSC**（`vscode-bdl`） | 平台 VSIX（内置 `bdl-lsp` + `tiptop`） | 编辑器集成：命令、视图、设置、进度与结果展示；从设置合成部署配置 | 不解析源码 |

三者**只通过文件系统交互**：`tiptop` 写 `<项目>/.project/{link/,schema/,deploy/}`，`bdl-lsp` 只读（旧布局 `.project` 根 / `.link/` / `.project/.schema/` 只读兼容）。

```text
Oracle / CSV / 外部命令
        │  (tiptop link|schema)                  (tiptop deploy)
        ▼                                              ▲
<项目>/.project/link/links.jsonl + .schema/                 │
        │  只读（文件系统唯一接口）                       │
        ▼                                              │
bdl-lsp（stdio LSP）◀── VSCode 客户端（vscode-bdl）────┘
                            │  命令 / TreeView / 设置 / 进度
                            ▼
                       编辑器 UI（Problems、大纲、侧边栏）
```

---

## 1. 三档能力模型（默认轻量档）

VSC 插件默认**零配置**：不连库、不写工作区、不跑后台任务。三档由三个总开关控制。

| 档 | 打开方式 | 多出来的能力 |
|---|---|---|
| **③ 轻量（默认）** | 什么都不用做 | 高亮、跳转/引用、大纲、悬停、补全、格式化、诊断、字段校验 |
| **② 本地文件解析** | 导入两份 CSV + 把 `bdl.link.mode` / `bdl.schema.mode` 设为 `file`（或 `db`） | 跨模块函数可见性、链接视图与反查、字段中文说明、记录成员校验 |
| **① 全功能** | 配「生产环境」Oracle 连接（+ `bdl.deploy.enable`） | 从数据库一键同步链接/字段资料、远程部署 |

---

## 2. 语言与解析（LSP）

| # | 功能 | 归属 | 说明 / 入口 |
|---|---|---|---|
| A1 | 双语言支持 | LSP | `.4gl` / `.global` → language id `bdl`；`.per` → `per` |
| A2 | tree-sitter 解析 | LSP | `tree-sitter-bdl` / `tree-sitter-per` grammar；Go cgo；go-tree-sitter v0.25.0（grammar ABI 15） |
| A3 | 文档同步（真增量） | LSP | `didOpen` / `didChange` / `didClose`；`TextDocumentSyncKindIncremental` |
| A4 | UTF-16 ↔ 字节位置换算 | LSP | `internal/textpos`，LSP 位置与 tree-sitter 字节偏移互转 |
| A5 | 语法错误诊断 | LSP | `ERROR` → `syntax-error`；`MISSING` → `missing-<kind>`（整簇兜底 `missing-node`） |
| A6 | 解析资源上限 | LSP | `bdl.limits.maxFileBytes` / `maxFileLines` / `maxIssues` / `parseTimeoutMs`；超限 → `file-too-large` / `parse-timeout` |
| A7 | 强制解析当前文件 | LSP + VSC | 自定义请求 `bdl/forceParse`；编辑器标题栏按钮（上下文 `bdl.parseSkipped`）；**后台不限时**解析（`Timeout 0`），完成回执 `bdl/parseDone` → 自动刷新大纲并显示实测耗时 |
| A8 | 解析检查 CLI | LSP | `bdl-lsp check [--json] [--max-issues N] [-q] <文件...>` |
| A9 | Genero 版本基线 | LSP | `bdl.generoVersion`（默认 `2.50`）；5.0 暂不排期 |

---

## 3. 编辑体验（LSP 服务端能力 / VSC 触发）

| # | 功能 | 归属 | 说明 / 入口 |
|---|---|---|---|
| B1 | 悬停（hover） | LSP | 变量来源、定义位置、函数信息；`LIKE t.col` 追加字段资料；悬停表名给表摘要 |
| B2 | 跳转定义（definition） | LSP | 当前文件、GLOBALS、链接资料内文件 |
| B3 | 查找引用（references） | LSP | 工作区可解析引用 |
| B4 | 文档符号（大纲 / 面包屑） | LSP | `documentSymbol`，`internal/server/symbols.go` |
| B5 | 工作区符号 | LSP | `workspace/symbol`；后台全工作区索引 + 持久化快照，覆盖未打开文件 |
| B6 | 补全 | LSP | 关键字、变量、函数、表单字段、表名、列；`.` 触发记录成员/表单字段；`Ctrl+Space` 手动触发 |
| B7 | 重命名 | LSP | `prepare` + `rename`；**只改当前文件**、大小写不敏感、不动字符串 |
| B8 | 快速修复（Code Action） | LSP | 仅 `quickfix`：字段名写错时的改名建议 |
| B9 | 语义高亮 | LSP（VSC 渲染） | `semanticTokens/full`；只发**用户自定义符号**（关键字/字符串交给 TextMate）；函数 `declaration`、常量 `readonly`、GLOBALS 块 `static` |
| B10 | 格式化 | LSP | `.4gl` / `.global`；`bdl.format.keywords`（unchanged/upper/lower，`lower` 同时作用于关键字补全）+ `indentStyle` + `indentSize`；安全守卫：有 `ERROR` 不格式化、幂等；**`.per` 一律不格式化** |
| B11 | 游标 / PREPARE 符号 | LSP | `PREPARE` / `DECLARE CURSOR` 声明；`EXECUTE`/`FETCH`/`OPEN`/`CLOSE`/`FOREACH` 悬停与跳转；同步接入大纲/补全/语义高亮 |

> VSC 侧快捷键由 VSCode 提供：`F12` 跳转、`Shift+F12` 引用、`F2` 重命名、`Ctrl+.` 快速修复、`Shift+Alt+F` 格式化。

---

## 4. 符号与作用域（LSP）

| # | 功能 | 归属 | 说明 / 入口 |
|---|---|---|---|
| C1 | 按函数隔离作用域 | LSP | 变量跟踪以函数为界，避免整文件线性跟踪导致跨函数误报 |
| C2 | GLOBALS 模组全局变量 | LSP | 跨文件跳转到 `.global` 定义、悬停标注来源；`globals-file-not-found`、`variable-source-unresolved` 两类警告（可关） |
| C3 | GLOBALS 按文档隔离 | LSP | 符号查找/来源检查/函数可见性只看**当前文档**引入的 `.global`；文档关闭或删导入行即清缓存 |
| C4 | GLOBALS 解析根 | LSP | `bdl.globals.searchPaths`（相对工作区根，跨层级仓库用） |
| C5 | 内置符号表 | LSP | 97 条内置变量/函数/类/常量（`builtin/data/builtins.json`，`go:embed`）；豁免 `variable-source-unresolved` 与 `function-not-found`；接入补全与悬停 |
| C6 | 内置符号三层配置 | LSP | ① 内置 JSON ② 项目覆盖 `<root>/.bdl-lsp/builtins.json`（自动发现，2s 节流热更新）③ `bdl.builtins.enable/paths/disable` |

---

## 5. 诊断与校验（LSP）

### 5.1 诊断码（14 个静态码 + 动态 `missing-<kind>`）

| 诊断码 | 默认级别 | 触发条件 |
|---|---|---|
| `syntax-error` | warning | grammar `ERROR` 节点 |
| `missing-node` | warning | grammar `MISSING` 节点整簇兜底（缺 `END IF`、逗号等） |
| `file-too-large` | warning | 超过 `bdl.limits.maxFileBytes` / `maxFileLines`，已跳过语法检查 |
| `parse-timeout` | warning | 超过 `bdl.limits.parseTimeoutMs`，本轮跳过 |
| `globals-file-not-found` | warning | `GLOBALS "路径"` 目标文件找不到 |
| `variable-source-unresolved` | warning | 变量使用处查不到任何定义（局部/模块级/GLOBALS 均无） |
| `field-not-in-form` | warning | `INPUT … FROM`、`AFTER FIELD` 等引用字段不在对应 `.per` |
| `form-duplicate-item` | warning | `.per` `ATTRIBUTES` 重复定义同名 item |
| `form-layout-tag-undefined` | warning | `.per` `LAYOUT` 引用未定义 tag |
| `form-screen-record-undefined` | warning | `.per` `SCREEN RECORD` 引用未定义 item/字段 |
| `record-member-unknown` | **off** | `BY NAME rec.member` 成员不在 `RECORD` 声明里；`RECORD LIKE t.*` 用字段资料展开 |
| `function-not-found` | warning | 调用函数在当前模块及可用模组找不到定义（**需链接资料**） |
| `link-data-invalid` | warning | 链接资料 JSONL 解析失败 / schema 版本过高 |
| `link-data-legacy-dir` | hint | 资料仍在旧目录 `.link/`；`bdl.migrateLinkDir` 可一键迁移 |

> `missing-<kind>` 是**动态码**（kind 来自 grammar 节点类型）；`bdl.diagnostics.missing-<kind>` 精确命中单个类型，`missing-node` 兜底。

### 5.2 诊断控制与质量

| # | 功能 | 归属 | 说明 / 入口 |
|---|---|---|---|
| D1 | 级别唯一入口 | LSP | `bdl.diagnostics.<code>`：`off`/`error`/`warning`/`information`/`hint`；未列出用默认值；旧专用键已删除 |
| D2 | 忽略列表 | LSP | `bdl.ignore.files`（屏蔽该文件所有诊断并排除出索引）、`bdl.ignore.fields`（只屏蔽 `field-not-in-form`）、`bdl.ignore.forms`；glob 支持 `**`，配置热更新 |
| D3 | 诊断降噪 | LSP | 作用域按函数隔离；变量 query 跳过表达式函数名 / `WHENEVER` 目标 / 含点号表单字段；`.per` 布局单元格多 tag 与 `SCREEN RECORD` 字段名修正 |
| D4 | 诊断关联信息 | LSP | `field-not-in-form` 带 `relatedInformation` 跳转 `.per` 对应位置 |
| D5 | 诊断码表防漂移 | LSP | `make diagnostics-check` 校验注册表 ↔ `docs/DIAGNOSTICS.md` ↔ VSC `package.json`；`make diagnostics-write` 生成文档；并入 `make lint` |
| D6 | 诊断度量 | LSP | `cmd/diag-audit` + `make diag-audit`：逐码计数、高频标识符、噪声最高文件 |
| D7 | 外部函数过滤 | TIPTOP + LSP | 被 ≥3 文件或 ≥5 次调用且全语料无定义的名字视为存在，记入 `links.meta.json`；候选 >2000 个则不启用 |

---

## 6. 跨文件资料：链接资料（TIPTOP 写 / LSP 读 / VSC 显示）

程序 → 链 → 文件/函数 的跨模块索引，产物 `<项目>/.project/link/links.jsonl` + `links.meta.json`（旧 `.link/` 只读兼容）。

### 6.1 采集与写侧（TIPTOP）

| # | 功能 | 归属 | 说明 / 入口 |
|---|---|---|---|
| F1 | CSV 导入 | TIPTOP | `tiptop link import -csv <DS.GAL_FILE 导出.csv> -root <项目根>`；表头 `GAL01..GAL04`，`gal04='Y'` 过滤，组内去重，容忍 UTF-8 BOM |
| F2 | 采集来源 | TIPTOP | `link sync -source golang`（纯 Go 直连 Oracle，`go-ora`，无需客户端）/ `command`（命令 stdout 出 CSV）/ `file`（读已导出 CSV） |
| F3 | 状态查看 | TIPTOP | `tiptop link status`：链/orphan/ambiguous/文件数、生成时间、缺失文件数、模组根、全局模组；显示局部更新 `partial` 记录 |
| F4 | 局部更新 | TIPTOP | `-files aap/4gl/x.4gl`（找出引用该文件的作业）或 `-modules lib,sub,qry`；写盘**合并**，其余链保留；命令行 `-dry-run` 仍可先看影响几个作业（**插件已不再自动预演**）；前提是已有一次全量基线 |
| F5 | SQL 下推 | TIPTOP | `source=golang` + 默认 SQL 时，模组/文件条件下推到 Oracle；自定义 `-query` 只在内存过滤 |
| F6 | MAIN 判定 | TIPTOP | 语法树判定 MAIN，文本兜底兼容 `{ MAIN }` 写法 |
| F7 | 原子写入 | TIPTOP | 先写临时文件再 rename，LSP 不会读到半份资料 |
| F8 | 进度协议 | TIPTOP | stderr 制表符分隔：`进度\t阶段\t信息`；阶段 `采集 / 扫描源码 / 成链 / 写入完成`（编辑器据此显示进度条） |
| F9 | 密码来源 | TIPTOP | 环境变量 `BDL_ORA_PASSWORD` 或 `<项目>/.project/secrets.json`（`chmod 600`）；**不写进配置文件** |

### 6.2 读取与语言能力（LSP）

| # | 功能 | 归属 | 说明 / 入口 |
|---|---|---|---|
| F10 | 资料读取与热重载 | LSP | 只读 `.project/link/`（默认 `bdl.link.dataDir`；旧布局回退），按 mtime 热重载（2s 节流），导入后无需重启编辑器 |
| F11 | 旧目录兼容与迁移 | LSP + VSC | 仍读旧布局（`.project` 根 / `.link/`）并发 `link-data-legacy-dir`（hint）；VSC 命令 `迁移项目资料目录` 把 link/schema/deploy 一起搬进 `.project/{link,schema,deploy}/`（不覆盖已有文件），迁移前确认、迁移后重启服务器 |
| F12 | 跨文件函数可见性 | LSP | 可见函数 = 本文件 ∪ GLOBALS ∪ 链接文件 ∪ 全局模组（`sub`/`lib`/`qry` 扁平规则）；**只放大函数，变量可见性不变** |
| F13 | `function-not-found` 启用条件 | LSP | 必须有链接资料且索引预热完成；资料缺失/链内文件不在磁盘/索引未就绪 → 一律不报（宁漏勿误） |
| F14 | 资料自身诊断 | LSP | `link-data-invalid`（JSONL 坏了 → 停用并提示重导）；都落在资料文件上，不污染源码 |
| F15 | 链接资料数据服务 | LSP | 自定义请求 `bdl/linkTree`、`bdl/linkReferences`（反查默认不查、分页 50） |
| F16 | 链接资料配置 | LSP | `bdl.link.mode`（off/file/db）/ `dataDir` / `moduleRoots` / `globalModules` |

### 6.3 界面与操作（VSC）

| # | 功能 | 归属 | 说明 / 入口 |
|---|---|---|---|
| F17 | 链接资料视图 | VSC | 侧边栏「链接资料」TreeView：程序 → 链内文件三级，点击跳转；仅 `bdl.link.mode != off`（视图上下文 `bdl.link.enabled`）时显示 |
| F18 | 反查引用程序 / 从数据库更新 | VSC | 从当前符号反查调用方，Quick Open 选择跳转；结果多时「显示更多反查结果」；视图标题栏「从数据库更新」是**唯一**的更新入口（已合并 `更新当前文件`/`重新同步`；仅 `bdl.db.configured && bdl.link.hasData` 时显示） |
| F19 | 导入/同步命令 | VSC | `链接资料：从 CSV 导入 / 按模组更新 / 全量更新 / 查看状态 / 刷新` + **`从数据库更新`**（唯一的「更新」入口，只重算当前文件涉及的作业）；导入先把 CSV 复制到 `<项目>/.project/link/gal_file.csv` 再确认（**不再预演**；全量前一次不重新扫描的确认）。`file` 模式下没有局部更新——改完程序要重新导入 CSV |
| F20 | 进度与取消 | VSC | 解析 tiptop 进度协议，弹进度通知（含取消）；同步/导入共用同一套显示 |

---

## 7. 数据库字段资料（TIPTOP 写 / LSP 读 / VSC 显示）

产物 `<项目>/.project/schema/tables.json`（总索引）+ `tables/<大写表名>.json`（每表列清单）。

### 7.1 采集与写侧（TIPTOP）

| # | 功能 | 归属 | 说明 / 入口 |
|---|---|---|---|
| G1 | CSV 导入 | TIPTOP | `tiptop schema import -csv <表字段导出.csv> -root <项目根>` |
| G2 | 直连采集（TiTop 字典 + 分批） | TIPTOP | `tiptop schema sync -source golang`：默认 SQL 用 `DS.ZTA_FILE`（`zta02='ds'`）+ `USER_TAB_COLUMNS`，列说明取 `DS.GAQ_FILE.gaq03`（`gaq02='2'`，非 Oracle 备注）；先取表清单、每 `-batch-size`（默认 200）张表一批、每批 `-timeout`（默认 120s）；字典表缺失提示改用 CSV 导入 |
| G3 | 状态查看 | TIPTOP | `tiptop schema status`：表数/列数/导入时间/来源 |
| G4 | 增量与选择 | TIPTOP | `-tables a,b` / `-tables-file 文件`（大清单，插件走这个）/ `-only-new`（只补本地没有的表）/ `-prune`（删除本地多出、仅全量）/ `-dry-run`（命令行能力，**插件不再自动预演**） |
| G5 | 逐表增量写 | TIPTOP | 全量查询后**逐表逐字节比较**，内容没变不重写（避免无意义 mtime 变化触发编辑器重载） |
| G6 | 容错解析 | TIPTOP | 表头先归一化再按别名匹配（容忍导出里的 `data_precicison`、`default_legth` 拼写错误，认不出回退列位置）；UTF-8 BOM / CRLF / 引号包裹逗号；`nullable` 支持 `Y/N`、`YES/NO`；数字空或非数字按 0；`data_length=0` 回退 `char_length`；坏行跳过计数不中断 |
| G7 | 安全写入 | TIPTOP | 原子写入（临时文件 + rename）；已有 `tables.json` 坏 JSON / schema 版本过高 → 报错退出并保留原文件 |
| G8 | 进度协议 | TIPTOP | stderr 制表符分隔；阶段 `采集 / 解析 / 清理 / 写入完成`；远端大查询每 5000 行报一次，采集/解析带 `第 N 个/共 M 个` |

### 7.2 读取与语言能力（LSP）

| # | 功能 | 归属 | 说明 / 入口 |
|---|---|---|---|
| G9 | 表文件按需加载 | LSP | 只读总索引；某表文件**展开时才加载**并缓存（几千张表也不卡） |
| G10 | 字段悬停扩展 | LSP | `DEFINE x LIKE t.col` → 追加 `t.col · 类型(长度) · 中文说明`；`RECORD LIKE t.*` → 列出该表字段（超 20 行折叠）；直接悬停表名 → 表摘要 |
| G11 | 记录成员校验 | LSP | `record-member-unknown`（默认 off）；`RECORD LIKE t.*` 用字段资料展开成员 |
| G12 | 列补全 | LSP | `r.` 补全带每列类型与中文说明 |
| G13 | 字段资料数据服务 | LSP | 自定义请求 `bdl/schemaTables`（服务端正则过滤：**大小写不敏感**、非法正则退回全部并回 `filterError`、`total/matched/returned`）、`bdl/schemaColumns`（展开才取） |
| G14 | 字段资料配置 | LSP | `bdl.schema.mode`（off/file/db）/ `bdl.schema.dataDir`（默认 `.project/schema`） |

### 7.3 界面与操作（VSC）

| # | 功能 | 归属 | 说明 / 入口 |
|---|---|---|---|
| G15 | 数据库字段视图 | VSC | 侧边栏「数据库字段」TreeView；**正则**过滤（`^APF`、`(apg\|aph)0`，大小写不敏感；非法正则退回全部并提示；无匹配显示「没有匹配的表」）；表展开才加载列。过滤器变更会**清缓存重新拉列表**（历史 bug：只改过滤串不重新拉取，视图看起来「筛选没反应」，已修 + e2e 回归） |
| G16 | 多选批量 | VSC | 树视图原生不能多选 → 用**复选框**勾选；标题栏显示「已勾选 N 张」；`全选当前列表`（可先过滤）/ `清除勾选` |
| G17 | 同步命令 | VSC | 单表右键「同步选中的表」（`-tables <表>`）；「同步已选中的表」（表多时自动走 `-tables-file`）；「从数据库同步」/「从 CSV 导入」全量（库同步顺带 `-prune`）。删掉单独的「同步当前筛选结果」——筛选后先「全选当前列表」再「同步已选中的表」。**不再预演**。**W4 门控**：局部/批量需 `bdl.db.configured && bdl.schema.hasData`；「从数据库同步」需 `bdl.db.configured`；CSV 导入/刷新/过滤不受限 |
| G18 | 表/列右键菜单 | VSC | 表：同步选中的表 / 打开表资料文件；列：复制列定义（得到 `LIKE 表.列`） |
| G19 | 进度与取消 | VSC | 同步/导入时进度通知，显示 `采集：连接 …`、`采集：已收到 12000 行`、`解析表 ima_file（12/2648）`、`写入完成：2648 个表文件`；可取消 |

---

## 8. 部署与远程编译（TIPTOP 执行 / VSC 触发）

### 8.1 工具侧（TIPTOP）

| # | 功能 | 归属 | 说明 / 入口 |
|---|---|---|---|
| H1 | 部署命令 | TIPTOP | `tiptop deploy [-target <名>] [-config <文件>] [-workspace <项目根>] [文件...]` |
| H2 | 上传 + 远程编译 | TIPTOP | `rsync` 为主、失败退 `scp`；上传后按文件类型在远端执行编译命令（`fglcomp -M {file}` / `fglform {file}`，`{file}` 替换为远端路径） |
| H3 | 模式开关 | TIPTOP | `-dry-run`（只打印计划）、`-no-compile`（只上传）、`-no-upload`（只编译）、`-json`（结构化结果，给插件用）、`-list`（列出目标） |
| H4 | 配置模型 | TIPTOP | `.project/deploy/deploy.json`（旧 `.bdl-lsp/deploy.json` 兼容）：`targets.<名>.{host,port,user,remoteRoot,localRoot,upload{include,exclude,mode,rsyncArgs,fallback,delete},compile{4gl,per},strictHostKey,connectTimeout}` + `defaultTarget`；`-target` 覆盖 |
| H5 | 认证 | TIPTOP | SSH key / ssh-agent，**不支持在配置里存密码** |
| H6 | 编译结果 | TIPTOP | 解析远端 stderr/行号，`-json` 输出映射结果，供编辑器转成诊断 |

### 8.2 编辑器侧（VSC）

| # | 功能 | 归属 | 说明 / 入口 |
|---|---|---|---|
| H7 | 上传命令（只允许单文件） | VSC | `上传当前文件` / `预演上传`；入口：命令面板 + **编辑器右上角按钮 + 编辑器右键菜单**（`.4gl`/`.global`/`.per` 且 `bdl.upload.enabled` 时出现）；`bdl.deploy.enable=false` 或 `transport=off` 时全部隐藏、直接调用也只提示不执行。**整包部署与列出目标已删除**（批量走 `tiptop deploy` 命令行） |
| H8 | 配置合成 | VSC | 从 `bdl.prod.deploy.*` 合成 `<项目>/.project/deploy/deploy.json`（带 `createdBy: "vscode-bdl <版本>"`）；手写文件被覆盖前先备份 `deploy.json.bak` |
| H9 | 部署当前文件 | VSC | 先保存脏文档，只把当前 `.4gl`/`.global`/`.per` 交给 `tiptop deploy`；Zed 用 task `$ZED_FILE`（Zed 侧暂停） |
| H10 | 编译诊断回传 | VSC | 部署结果解析为编辑器诊断；输出写入「Genero BDL」通道 |

---

## 9. VSCode 客户端集成（VSC）

| # | 功能 | 归属 | 说明 / 入口 |
|---|---|---|---|
| I1 | 语言注册 | VSC | language id `bdl`（`.4gl`/`.global`）、`per`（`.per`）；TextMate 语法 scope `source.4gl` / `source.per`；`language-configuration` |
| I2 | 平台 VSIX 内置二进制 | VSC | 每个平台 VSIX 打包对应的 `bdl-lsp` + `tiptop`（`bin/`），装完即用、无需另装 |
| I3 | 二进制路径覆盖 | VSC | `bdl.server.path` / `bdl.tools.path` 指定外部二进制（开发期或自定义构建） |
| I4 | 轻量档默认 | VSC | 默认不连库、不写工作区、不起后台任务；三个总开关默认 false，命令用 `when` 门控 |
| I5 | 命令（32 条） | VSC | 完整操作清单见 [COMMANDS.md](COMMANDS.md)（面板/按钮/后台）；命令表见 [§10.3](#103-vscode-命令32-条) |
| I6 | 侧边栏视图（2 个） | VSC | 「链接资料」、「数据库字段」TreeView，按开关显隐 |
| I7 | 进度通知 | VSC | 解析 tiptop stderr 进度协议，展示阶段与计数，支持取消 |
| I8 | 输出与追踪 | VSC | 「Genero BDL」输出通道 + 「Genero BDL 追踪」LSP 消息通道（`bdl.trace.server`：off/messages/verbose） |
| I9 | 语言服务器信息 | VSC | 命令「显示语言服务器信息」展示生效设置、版本、资料状态 |
| I10 | 编辑器标题栏按钮 | VSC | `bdl.parseSkipped` 时显示「强制解析当前文件」 |
| I11 | 激活时机 | VSC | `onLanguage:bdl` / `onLanguage:per` / 相关命令按需激活 |
| I12 | 设置分组 | VSC | 设置界面 5 组裸标题（基础 / 生产环境 / 链接资料 / 部署 / 数据库字段） |
| I13 | 项目级配置 | LSP + VSC | `<项目>/.bdl-lsp/config.json` 可提交；与工作区设置合并（见 §11.2） |
| I14 | 端到端测试 | VSC | `npm run test:e2e`，无头 VSCode（`--ozone-platform=headless`）**49 个用例** |
| I15 | 预演策略 | VSC | 只有**编译类**允许预演（`tiptop deploy -dry-run`、W5 的本地「预演编译」）；link/schema 的同步与导入一律直接执行（避免整份扫描跑两遍） |
| I16 | 数据库按钮门控 | VSC | context key `bdl.db.configured`（Oracle host/service/user 配齐）、`bdl.link.hasData`（links.jsonl 存在）、`bdl.schema.hasData`（tables.json 存在）；「链接资料」的 `从数据库更新` 需前两者，「数据库字段」的局部/批量同步需 configure+hasData |
| I18 | 失败可见性与运行日志 | VSC | tiptop 输出进「Genero BDL 任务」通道（原来 6 个通道合并为 `Genero BDL`（服务器+追踪）与 `Genero BDL 任务`；每次运行前写一行 `> tiptop <子命令>` 以区分来源）；失败通知带 stderr 首行 + 「打开日志」；每次运行完整输出落盘到扩展 globalStorage 的 `last-run-<cmd>.log` |
| I17 | 编译/链接/预览（生产端） | VSC | 命令面板 + 编辑器右上角按钮：`.4gl` 预演编译/编译/链接，`.per` 预演编译/编译/预览画面；命令交给 `tiptop exec` 在**生产服务器**（工作目录 = 生产根）通过 ssh 执行，stdout/stderr 原样进「Genero BDL 任务」通道；模板 `bdl.build.<lang>.<mode>.command` + 总开关 `bdl.build.enable`（去掉了各自的 enable）；占位符 `${path}`/`${fullpath}`/`${name}`/`${fullname}`（分隔符恒 `/`）；**不自动上传**；无 `MAIN` 时「链接」不可用；**只有 4GL 链接**弹 `${name}`；Form 预览默认命令是 `cd ${path} && r.gf ${name} 2 p`（三个参数） |

---

## 10. 命令行参考

### 10.1 `bdl-lsp`（LSP）

| 子命令 | 说明 |
|---|---|
| `bdl-lsp serve [--log-level <级别>]` | 以 stdio 启动语言服务（编辑器调用；`--stdio` 兼容） |
| `bdl-lsp check [--json] [--max-issues N] [-q] [--version] <文件...>` | 批量解析检查；`--json` 结构化输出，`-q` 只列有问题的文件 |
| `bdl-lsp version` | 打印版本 |

### 10.2 `tiptop`（TIPTOP）

| 子命令 | 关键参数 |
|---|---|
| `tiptop link import` | `-csv <文件>`（必填）`-root` `-out` `-roots` `-modules` `-files` `-dry-run` `-replace` |
| `tiptop link sync` | `-root` `-out` `-roots` `-source golang\|command\|file` `-command` `-file` `-host` `-port` `-service` `-user` `-query` `-modules` `-files` `-dry-run` |
| `tiptop link status` | `-root` `-out` `-global` |
| `tiptop schema import` | `-csv <文件>`（必填）`-root` `-out` `-tables` `-tables-file` `-only-new` `-dry-run` |
| `tiptop schema sync` | `-root` `-out` `-source golang\|file` `-file` `-host` `-port` `-service` `-user` `-query` `-tables` `-tables-file` `-only-new` `-prune` `-dry-run` `-batch-size` `-timeout`（`-owner` 仅自定义 SQL 用） |
| `tiptop schema status` | `-root` `-out` |
| `tiptop deploy` | `-target` `-config` `-workspace` `-dry-run` `-no-compile` `-no-upload` `-json` `-list` `-version` `[文件...]` |
| `tiptop version` | 打印版本 |

### 10.3 VSCode 命令（32 条）

| 分组 | 命令 ID / 标题 |
|---|---|
| 排障 | `bdl.restartServer` 重启语言服务器 · `bdl.showServerInfo` 显示语言服务器信息（含「打开日志」） · `bdl.forceParseCurrentFile` 强制解析当前文件（仅 `bdl.parseSkipped`） |
| 项目初始化 | `bdl.initProject` 初始化项目（从生产服务器拉取代码）：按宿主平台选 bash/PowerShell 脚本（命令里可强制），在集成终端里执行 |
| 链接资料 | `bdl.link.importCsv` 从 CSV 导入 · `bdl.link.syncModules` 按模组更新 · `bdl.link.syncAll` 全量更新 · `bdl.link.status` 查看状态 · **`bdl.link.updateFromDb` 从数据库更新（唯一的「更新」入口：视图标题栏 + 面板；仅已配库 + 已有全量资料时出现）** · `bdl.links.refresh` 刷新 · `bdl.links.references` 反查引用程序（面板限 `.4gl`） · `bdl.links.moreRefs` 显示更多反查结果（隐藏） · `bdl.migrateLinkDir` 迁移项目资料目录（隐藏）。删掉了 `syncCurrent` / `resync` |
| 编译/链接/预览（生产端） | `bdl.build.4gl.preview` 4GL 预演编译 · `bdl.build.4gl.compile` 4GL 编译 · `bdl.build.4gl.link` 4GL 链接（无 MAIN 时禁用） · `bdl.build.per.preview` Form 预演编译 · `bdl.build.per.compile` Form 编译 · `bdl.build.per.form` Form 预览画面 |
| 数据库字段 | `bdl.schema.import` 从 CSV 导入 · `bdl.schema.syncAll` 从数据库同步 · `bdl.schema.syncSelected` 同步已选中的表 · `bdl.schema.selectAll` 全选当前列表 · `bdl.schema.clearSelection` 清除勾选 · `bdl.schema.filter` 正则过滤表名 · `bdl.schema.clearFilter` 清除过滤 · `bdl.schema.refresh` 刷新 · 右键/内联：`bdl.schema.syncTable` 同步选中的表 · `bdl.schema.copyColumn` 复制列定义 · `bdl.schema.openTable` 打开表资料文件。已删掉 `syncFiltered` 并把三条改为只走右键 |
| 上传 | `bdl.deployCurrentFile` 上传当前文件 · `bdl.deployDryRun` 预演上传（整包部署与列出目标已删除） |

> 跳转/引用/补全/重命名/格式化/快速修复由 LSP 提供，入口是 VSCode 原生菜单或快捷键，不在本表。

---

## 11. 配置项

### 11.1 VSC 设置（3 组 49 键）

| 组 | 键 | 默认 | 作用 |
|---|---|---|---|
| 基础 | `bdl.server.path` / `bdl.tools.path` | 空 | 覆盖内置二进制路径 |
| 基础 | `bdl.server.logLevel` | `info` | 服务器日志级别 |
| 基础 | `bdl.trace.server` | `off` | LSP 消息追踪（off/messages/verbose） |
| 基础 | `bdl.generoVersion` | `2.50` | 目标 Genero 版本 |
| 基础 | `bdl.diagnostics` | `{}` | 逐诊断码调级（唯一入口） |
| 基础 | `bdl.format.keywords` / `indentStyle` / `indentSize` | `unchanged` / `auto` / `0` | 格式化行为（`keywords=lower` 也让补全关键字小写） |
| 基础 | `bdl.index.enable` | `true` | 后台工作区符号索引 |
| 基础 | `bdl.globals.searchPaths` | `[]` | GLOBALS 附加解析根 |
| 基础 | `bdl.perRoots` | `[]` | `.per` 附加查找根 |
| 基础 | `bdl.builtins.enable` / `paths` / `disable` | `true` / `[]` / `[]` | 内置符号表开关、附加 JSON、屏蔽名单 |
| 基础 | `bdl.ignore.files` / `fields` / `forms` | `[]` | 忽略 glob（`**`） |
| 基础 | `bdl.limits.maxFileBytes` / `maxFileLines` / `maxIssues` / `parseTimeoutMs` | `2097152` / `20000` / `200` / `2000` | 资源与报告上限 |
| 账号、生产环境、配置 | `bdl.prod.oracle.host` / `port` / **`service`（新增）** / `user` | `1521`，其余空 | Oracle 连接（**账号须为应用 schema 账号**；密码走环境变量/secrets） |
| 账号、生产环境、配置 | `bdl.prod.deploy.host` / `port` / `user` / `strictHostKey` | `22` / `true`，其余空 | 生产服务器（SSH 密钥登录，不支持密码） |
| 账号、生产环境、配置 | `bdl.link.mode` / `dataDir` / `moduleRoots` / `globalModules` | **`off`** / `.project/link` / `[]` / `["sub","lib","qry"]` | 链接资料三态（off/file/db）与跨模块可见性 |
| 上传编译链接 | `bdl.deploy.enable` / `bdl.prod.deploy.transport` / `localRoot` / `remoteRoot` | **`false`** / **`off`** / `.` / 空 | 单文件上传：总开关 + 方式 + 目录映射 |
| 账号、生产环境、配置 | `bdl.schema.mode` / `dataDir` / `batchSize` / `timeoutSec` | **`off`** / `.project/schema` / `200` / `120` | 字段资料三态；后两者是 W7 分批同步参数 |
| 上传编译链接 | `bdl.build.enable` + `bdl.build.<lang>.<mode>.command`（6 个） | `false` + 命令见 README §8.10 | 编译/链接/预览命令模板（**生产服务器执行**，不自动上传）；去掉了 6 个 per-command enable；占位符 `${path}`/`${fullpath}`/`${name}`/`${fullname}` |

> 密码**不放在设置里**：`BDL_ORA_PASSWORD` 环境变量，或 `<项目>/.project/secrets.json`（`chmod 600`）。
> 「生产环境」只写 Workspace，`settings.json` 不要进 git。

### 11.2 项目级配置 `<项目>/.bdl-lsp/config.json`（LSP 读，可提交）

```jsonc
{
  "generoVersion": "2.50",
  "diagnostics": { "record-member-unknown": "warning" },
  "globals": { "searchPaths": ["tiptop/config", "topcust/config"] },
  "perRoots": ["tiptop/aap/per"],
  "schema": { "enable": true, "dataDir": ".project/schema" },
  "link":   { "enable": true, "dataDir": ".project/link", "moduleRoots": [], "globalModules": ["sub","lib","qry"] },
  "ignore": { "files": ["**/backup/**", "**/tmp/**"] }
}
```

### 11.3 资料格式（LSP 只读）

```text
<项目根>/.project/
├── secrets.json               # 唯一留在根的单文件（0600）
├── link/{links.jsonl,links.meta.json,gal_file.csv}
├── schema/{tables.json,tables/<大写表名>.json,gal_schema.csv}
└── deploy/{deploy.json,deploy.json.bak}
# tables.json 索引：importedAt / source / rowsTotal / 每表列数与文件名
# tables/<大写表名>.json 列清单：name/desc/type/length/charLength/precision/scale/nullable/default
```

---

## 12. 开发者工具与质量门

### 12.1 bdl-lsp（LSP）

| # | 工具 | 说明 |
|---|---|---|
| L1 | `make build` / `test` / `test-race` / `vet` / `fmt` / `lint` | 构建与基础检查；`lint` = vet + `keywords-check` + `builtin-check` + `diagnostics-check` |
| L2 | `make check` / `corpus` / `regress` | 样例冒烟；全语料解析；全量回归（真实语料 7070 个，通过 7068，99.97%） |
| L3 | `make bench` + `scripts/lsp-bench.py` | LSP 延迟基准（`didOpen` 133 ms、`didChange` 往返 6.0 ms） |
| L4 | `make builtin-audit` / `builtin-check` | `cmd/builtin-audit`：按频次+文件数列出不在内置表里的名字并粗判归属；`-check` 进 lint |
| L5 | `make diag-audit` | `cmd/diag-audit`：逐码计数、高频标识符、噪声最高文件（降噪基线） |
| L6 | `make grammar-audit` | `cmd/grammar-audit`：全语料按「最内层 ERROR 上下文」聚合排序；`TestCorpusGrammarBaseline` 冻结 18 个已知坏文件基线（实测 18/15108 = 0.12%） |
| L7 | `make diagnostics-check` / `diagnostics-write` | 诊断码注册表 ↔ 文档 ↔ VSC manifest 三方一致性 |
| L8 | `cmd/field-audit` / `fmt-audit` / `record-audit` | 字段校验、格式化、record 成员的语料评估 |
| L9 | `make grammars` / `grammars-check` / `keywords` / `keywords-check` / `manifest-check` | 生成/校验 TextMate 语法与关键字表、VSC 清单校验 |
| L10 | `make e2e-vscode` / `zed-check` / `zed-check-windows` | 无头 VSCode 端到端；Zed 查询校验 |
| L11 | `scripts/` | `install-toolchain.sh`（幂等）、`dev-env.sh`、`env-check.sh`、`corpus-smoke.sh`、`corpus-regress.sh`、`repro-index-crash.py`、`generate-keywords.mjs`、`generate-tm-grammars.mjs`、`verify-tm-grammars.mjs`、`verify-vscode-manifest.mjs` |
| L12 | 语料与索引性能 | 工作区索引 7756 文件 24.7 s、增量 22 ms；链接最大链组装 3.4 ms |

### 12.2 tiptop（TIPTOP）

| # | 工具 | 说明 |
|---|---|---|
| L13 | `make build` / `build-ps` / `test` / `test-race` / `vet` / `fmt` / `lint` / `clean` | 构建与基础检查；Windows 走 `scripts/build.ps1` |
| L14 | `go.mod` `replace ../bdl-lsp` | 复用 LSP 公开包：`link`、`parser`、`index`、`builtin`、`glob`；发布时替换为版本号 |

### 12.3 vscode-bdl（VSC）

| # | 工具 | 说明 |
|---|---|---|
| L15 | `npm run typecheck` / `build` / `package` | 类型检查、esbuild bundle、打平台 VSIX（需先构建两个二进制） |
| L16 | `npm run test:e2e` | 无头 VSCode 端到端 49 用例 |
| L17 | `scripts/package-vsix.mjs` | 平台 VSIX 打包，内置对应平台二进制与 `BUILD-INFO.json` |
| L17b | 扩展图标 | 根目录 `icon.png`（256×256 PNG，`package.json` 的 `icon` 字段引用）；`check-vsix.sh` 把它列为**必需文件**，缺了出包就失败 |
| L18 | CI 自检 | 构建 + 单测 + 二进制自检 + VSIX 内容自检（`scripts/check-vsix.sh`，CI 与本地同一份：**必需文件**含 `scripts/init-project/**`，**禁止** `docs/`（只留 `docs/images/` 截图）与 `src/test/.github/node_modules`，`scripts/` 只允许 `init-project/`；不再用「文件数 ≤ N」的魔法数字，只留暴涨护栏 ≤60）；`bundle-vsix.yml` 出 4 平台包（`win32-x64` / `linux-x64` / `darwin-x64` / `darwin-arm64`） |
| L19 | 项目初始化（从生产服务器拉取代码） | VSC | 命令 `bdl.initProject`（面板，需打开工作区）：先问用哪个脚本（自动/强制），再收集 SSH 目标/生产根（默认 `/u1/topprod`）/目标目录/选项/编码，**在集成终端里执行**。脚本：Linux/WSL `init-project.sh`（只读 find + **rsync 拉取**；默认只覆盖不删，`--delete` 才删并先列清单确认）；Windows `init-project.ps1`（只读 find + 生产端 **tar** 到 `/u1/out` → **scp** 回 `<Dest>\.pack` → 解压 → **清理两端临时包**）。两者都支持「没配密钥时在过程中输入密码」（密码只交给 ssh，不保存；上传/编译仍需密钥）；转 UTF-8（样本检测+询问）、归一行尾、生成 `.gitignore`/`.gitattributes`/`.editorconfig`/示例设置/来源段落，并设 `core.autocrlf=false`/`core.eol=lf`；跑完校验 `git ls-files --eol` 全 `i/lf w/lf`。离线自测 `test-local.sh`（36 项） |

---

## 13. 编辑器支持矩阵

| 能力 | VSCode | Zed（`4gl-full` v0.1.1，暂停） |
|---|---|---|
| 语法高亮 / LSP 基础 | ✅ | ✅ |
| 链接/数据库字段 TreeView、反查、部署命令 | ✅ | ➖（可见不可跳 / 用 task） |
| 语义高亮 | ✅ | ➖ |
| 断点式 UI（进度通知、标题栏按钮） | ✅ | ➖ |
| 真机验证 | Linux 通过，Windows/macOS 待验 | 缺真机 |

---

## 14. 明确不做

| # | 不做 | 原因 |
|---|---|---|
| N1 | Genero 编译器 / 运行时 / 数据库访问 | 超出 LSP 范围（部署归 tiptop） |
| N2 | 100% 语义正确 | 无法静态确定时明确降级，宁可不报 |
| N3 | 完整 IDE（调试器、GUI 设计器） | 不做 |
| N4 | 替代 `fglform` / `fglcomp` | 编辑期辅助，编译才是最终验证 |
| N5 | 移动端 / Web IDE | v1 不支持 |
| N6 | 纯 Go SFTP | 已选 rsync/scp |
| N7 | Genero 5.0 语法 | 暂不排期 |
| N8 | GitHub Release / 自动下载 / 市场与注册表发布 | 暂不排期 |
| N9 | 把内置函数/变量写进 grammar | 内置名变关键字会冒充用户自定义同名符号 |
| N10 | 用 `documentSymbol` 做跨文件跳转 | 该结构无 URI/target 字段；跨文件需扁平 `SymbolInformation` |
| N11 | GLOBALS 变量跨链接可见 | 链接只放大函数可见性，不放大变量可见性 |
| N12 | 跨文件重命名 / 类型与赋值兼容性检查 | 有意不做（重命名仅当前文件；变量只查「有没有来源」） |
| N13 | 链接资料过期告警 | 设计如此：资料旧不告警（`maxAgeDays` 已删除） |

---

## 15. 相关文档

> 本仓库 [`TODO.md`](TODO.md) **只保留仍未完成的条目**；已完成能力都写在本文件里（不再在待办里留历史）。

| 文档 | 内容 |
|---|---|
| [`../README.md`](../README.md) | **唯一用户引导**：安装、三档用法、功能详解、全部设置、建工作区、排错 |
| [`TODO.md`](TODO.md) | **唯一待办清单**（发布闭环、真机验收、代码层遗留） |
| [`OPEN-ITEMS.md`](OPEN-ITEMS.md) | **待确认记录**（需要用户拍板的事项） |
| [bdl-lsp/docs/FEATURES.md](https://github.com/darcyjoven/bdl-lsp/blob/main/docs/FEATURES.md) | bdl-lsp 单组件功能清单（本仓库文档含全部三组件） |
| [bdl-lsp/docs/DIAGNOSTICS.md](https://github.com/darcyjoven/bdl-lsp/blob/main/docs/DIAGNOSTICS.md) | 14 个诊断码与默认级别（`make diagnostics-write` 生成，构建输入） |
| [tiptop/docs/FEATURES.md](https://github.com/darcyjoven/tiptop/blob/main/docs/FEATURES.md) | tiptop 单组件功能清单 |
| [tiptop/README.md](https://github.com/darcyjoven/tiptop#readme) | tiptop 构建与用法入口 |