# 插件操作清单（命令 / 按钮 / 后台任务）

> 生成于 2026-10-26（设置重构 V2 + 清理项 C1–C10 之后）。
> **用途**：看清当前所有操作入口；清理项已在 §7 记录结论。
> 数据来源：`package.json` 的 `contributes.commands` / `contributes.menus` / `activationEvents`，以及 `src/` 里的注册与监听。

## 0. 总览

| 入口 | 数量 | 说明 |
|---|---|---|
| 命令（`contributes.commands`） | **31** | 命令面板可见 26 条，隐藏 5 条（内部或只走右键） |
| 编辑器右上角按钮（`editor/title`） | **7** | 强制解析（按需）+ 6 条编译/链接/预览 |
| 视图标题栏按钮（`view/title`） | **8** | 链接资料 2 + 数据库字段 6 |
| 视图项按钮/右键（`view/item/context`） | **4** | 链接反查 1 + 字段表/列 3 |
| 输出通道 | **2** | `Genero BDL`（服务器+追踪）与 `Genero BDL 任务`（链接/字段/上传/编译） |
| 激活事件（`activationEvents`） | **26** | 2 条 `onLanguage` + 24 条 `onCommand` |
| 上下文键（`when` 依据） | **11** | 见 §6 |

`when` 为空 = 命令面板始终可见；`config.*` 是设置值，`bdl.*` 是扩展维护的上下文键。

## 1. 命令面板（26 条可见）

### 1.1 服务器与排障（3 条）

| id | 标题 | `when` | 说明 |
|---|---|---|---|
| `bdl.restartServer` | 重启语言服务器 | — | 设置里需要重启的键改过之后也会提示它 |
| `bdl.showServerInfo` | 显示语言服务器信息 | — | 二进制来源、版本、当前设置；通知里有**「打开日志」**（C5 合并了原「显示输出」） |
| `bdl.forceParseCurrentFile` | 强制解析当前文件 | `bdl.parseSkipped` | C4：只在当前文件被跳过解析时出现（编辑器按钮同条件） |

### 1.2 链接资料（7 条）

| id | 标题 | `when` | 说明 |
|---|---|---|---|
| `bdl.link.importCsv` | 链接资料：从 CSV 导入 | `bdl.link.enabled` | `file`/`db` 都可用；导入后全量重建 |
| `bdl.link.syncAll` | 链接资料：全量更新 | `bdl.link.modeDb` | 全量扫描 |
| `bdl.link.syncModules` | 链接资料：按模组更新 | `bdl.link.modeDb` | 选模组（lib/sub/qry…） |
| `bdl.link.updateFromDb` | 从数据库更新 | `bdl.link.modeDb && bdl.db.configured && bdl.link.hasData` | **C1：唯一的「更新」入口**（视图标题栏同一条）；只重算当前文件涉及的作业 |
| `bdl.link.status` | 链接资料：查看状态 | `bdl.link.enabled` | 链 / orphan / ambiguous / 缺失文件 |
| `bdl.links.refresh` | 刷新 | `bdl.link.enabled` | 视图刷新 |
| `bdl.links.references` | 反查引用程序 | `bdl.link.enabled && editorLangId == 4gl` | C3：面板里只对 `.4gl` 当前文件出现；视图按钮/视图项始终可用 |

### 1.3 数据库字段（10 条）

| id | 标题 | `when` | 说明 |
|---|---|---|---|
| `bdl.schema.import` | 数据库字段：从 CSV 导入 | `bdl.schema.enabled` | `file`/`db` 都可用 |
| `bdl.schema.refresh` | 数据库字段：刷新 | `bdl.schema.enabled` | |
| `bdl.schema.filter` | 数据库字段：正则过滤表名 | `bdl.schema.enabled` | 弹输入框（`^APF`、`(apg\|aph)0`）；**大小写不敏感**；非法正则退回全部并提示；过滤变更会重新拉列表 |
| `bdl.schema.clearFilter` | 数据库字段：清除过滤 | `bdl.schema.enabled` | 清空恢复全部 |
| `bdl.schema.syncAll` | 数据库字段：从数据库同步 | `bdl.schema.modeDb && bdl.db.configured` | 全量（含 `-prune`） |
| `bdl.schema.syncSelected` | 数据库字段：同步已选中的表 | `…modeDb && configured && hasData` | 复选框多选；**筛选后先「全选当前列表」再点它**（C2 删掉了单独的「同步筛选结果」） |
| `bdl.schema.selectAll` | 数据库字段：全选当前列表 | 同上 | |
| `bdl.schema.clearSelection` | 数据库字段：清除勾选 | 同上 | |

> C8：`bdl.schema.syncTable` / `bdl.schema.copyColumn` / `bdl.schema.openTable` 只保留右键/内联入口，命令面板不再显示（见 §4）。

### 1.4 编译 / 链接 / 预览（6 条）

| id | 标题 | `when` | `enablement` | 图标 |
|---|---|---|---|---|
| `bdl.build.4gl.preview` | 4GL：预演编译 | `editorLangId == 4gl && bdl.build.enabled` | — | `$(beaker)` |
| `bdl.build.4gl.compile` | 4GL：编译 | 同上 | — | `$(play)` |
| `bdl.build.4gl.link` | 4GL：链接 | 同上 | `bdl.build.hasMain` | `$(link)` |
| `bdl.build.per.preview` | Form：预演编译 | `editorLangId == per && bdl.build.enabled` | — | `$(beaker)` |
| `bdl.build.per.compile` | Form：编译 | 同上 | — | `$(play)` |
| `bdl.build.per.form` | Form：预览画面 | 同上 | — | `$(eye)` |

> C10：去掉了 6 个 per-command `enable`，只留总开关 `bdl.build.enable`。
> 全部由 `tiptop exec` 在**生产服务器**上执行（工作目录 = 生产根）；**不自动上传**。

### 1.5 上传（2 条）

| id | 标题 | `when` | 说明 |
|---|---|---|---|
| `bdl.deployCurrentFile` | 上传当前文件 | `bdl.upload.enabled` | 单文件，工作区根 → 生产根同路径 |
| `bdl.deployDryRun` | 预演上传 | `bdl.upload.enabled` | 只打印计划 |

### 1.6 隐藏（5 条，命令面板不显示）

| id | 标题 | 实际入口 |
|---|---|---|
| `bdl.links.moreRefs` | 显示更多反查结果 | 链接视图「反查引用程序」节点的**「显示更多」** |
| `bdl.migrateLinkDir` | 迁移项目资料目录 | 检测到旧布局（`.project` 根 / `.link/`）时的**通知「迁移」按钮** |
| `bdl.schema.syncTable` | 数据库字段：同步选中的表 | 字段视图**表节点右键** |
| `bdl.schema.openTable` | 数据库字段：打开表资料文件 | 字段视图**表节点右键** |
| `bdl.schema.copyColumn` | 数据库字段：复制列定义 | 字段视图**列节点内联按钮** |

## 2. 编辑器右上角按钮（7 个）

| 文件 | 显示条件 | 按钮 |
|---|---|---|
| `.4gl` / `.per` | 只有当前文件被跳过解析（`bdl.parseSkipped`） | 强制解析当前文件 `$(refresh)` |
| `.4gl` | `bdl.build.enabled` | 预演编译 `$(beaker)`、编译 `$(play)`、链接 `$(link)`（无 `MAIN` 时置灰） |
| `.per` | `bdl.build.enabled` | 预演编译 `$(beaker)`、编译 `$(play)`、预览画面 `$(eye)` |

## 3. 视图标题栏按钮（8 个）

**链接资料（`view == bdlLinks`）**

| 按钮 | 显示条件 |
|---|---|
| 刷新 `$(refresh)` | `bdl.link.enabled` |
| 从数据库更新 `$(cloud-download)` | `bdl.link.modeDb && bdl.db.configured && bdl.link.hasData` |

> C1：原来的「重新同步」按钮已删除——「从数据库更新」是唯一的更新入口。

**数据库字段（`view == bdlSchema`）**

| 按钮 | 显示条件 |
|---|---|
| 正则过滤 `$(filter)` / 刷新 `$(refresh)` / 从 CSV 导入 `$(file-add)` | `bdl.schema.enabled` |
| 同步已选中的表 `$(cloud-upload)` / 全选 `$(checklist)` / 清除勾选 `$(close)` | `bdl.schema.modeDb && bdl.db.configured && bdl.schema.hasData` |

> C2：原来的「同步当前筛选结果」按钮已删除——筛选后先「全选」再「同步已选中的表」。

## 4. 视图项按钮 / 右键（4 个）

| 位置 | 命令 | 显示条件 |
|---|---|---|
| 链接视图的「反查引用程序」节点（内联） | 反查引用程序 `$(search)` | `viewItem == bdlLinkRefsButton` |
| 字段视图的表节点（右键 `1_sync`） | 同步选中的表 | `bdl.schema.modeDb && bdl.db.configured && bdl.schema.hasData` |
| 字段视图的表节点（右键 `2_open`） | 打开表资料文件 | `viewItem == bdlSchemaTable` |
| 字段视图的列节点（内联） | 复制列定义 | `viewItem =~ /^bdlSchemaColumn/` |

## 5. 输出通道（2 个）

| 通道 | 谁在写 | 怎么区分来源 |
|---|---|---|
| `Genero BDL` | LSP 服务器日志 + `bdl.trace.server` 打开的 LSP 消息 | — |
| `Genero BDL 任务` | 链接资料 / 数据库字段 / 上传 / 编译·链接·预览（`tiptop` 输出原样） | 每次运行前写一行 `> tiptop <子命令> …`；另有 `last-run-<cmd>.log` |

> C6：原来 6 个通道（服务器/追踪/编译/部署/链接资料/数据库字段）合并成 2 个；
> 失败通知仍带 stderr 首行，并可点「打开日志」直接打开 globalStorage 里的完整日志文件。

## 6. 后台运行与自动行为

**扩展激活（26 个 `activationEvents`）**：`onLanguage:bdl`、`onLanguage:per`，以及 24 条 `onCommand:*`（命令被点/被程序调用时才加载扩展）。

| 行为 | 触发 | 说明 |
|---|---|---|
| 语言服务器启动 | 打开 `.4gl`/`.per` | `bdl-lsp` stdio；索引、诊断、补全、悬停、跳转、引用、大纲、格式化、GLOBALS、表单校验都在服务器里 |
| 工作区符号索引 | 启动后 | 后台建索引（进度见「Genero BDL」通道） |
| 资料热加载 | 文件变化 | 监听 `links.jsonl` / `tables.json`（含旧布局 glob），变了就刷新视图与上下文 |
| 上下文键更新 | 设置/文件夹/诊断/活动编辑器变化 | `bdl.db.configured`、`bdl.link.enabled/modeDb/hasData`、`bdl.schema.enabled/modeDb/hasData`、`bdl.upload.enabled`、`bdl.build.enabled`、`bdl.parseSkipped`、`bdl.build.hasMain` |
| MAIN 门控刷新 | 切换/编辑文档（300ms 防抖） | 决定 4GL「链接」是否置灰 |
| 旧布局提醒 | 打开链接资料视图时 | 提示「迁移」，点了才跑 `bdl.migrateLinkDir` |
| 强制解析 | 点按钮 | 后台不限时解析；完成发 `bdl/parseDone`，客户端刷新大纲 |
| 子进程 | 点链接/字段/上传/编译命令 | 调 `tiptop`，进度通知可取消；取消即杀子进程；输出落盘 `last-run-<cmd>.log` |

**LSP 自定义协议（插件 ↔ 服务器）**：`bdl/forceParse`、`bdl/parseDone`、`bdl/linkTree`、`bdl/linkReferences`、`bdl/schemaTables`、`bdl/schemaColumns`。

## 7. 清理项结论（C1–C10 已执行）

| # | 内容 | 结果 |
|---|---|---|
| C1 | 3 个同义「更新」入口 | 删 `bdl.link.syncCurrent`、`bdl.links.resync`；只留 `bdl.link.updateFromDb`（视图标题栏 + 面板） |
| C2 | 4 个字段同步入口 | 删 `bdl.schema.syncFiltered`；留 `syncAll` / `syncSelected`（面板）+ `syncTable`（右键） |
| C3 | 反查引用 3 处 | 视图按钮 + 视图项保留；面板条目加 `editorLangId == 4gl` |
| C4 | 强制解析面板常显 | 加 `when: bdl.parseSkipped` |
| C5 | 显示输出 / 显示服务器信息 | 删 `bdl.showOutput`；信息里加「打开日志」动作 |
| C6 | 6 个输出通道 | 合并为 2 个（`Genero BDL` / `Genero BDL 任务`） |
| C7 | `migrateLinkDir` 隐藏 | 保持隐藏（通知触发）；README 写明手动迁移路径 |
| C8 | 复制列定义 / 打开表资料 | 只留右键/内联（面板 `when: false`） |
| C9 | 显示更多反查结果 | 保持隐藏（内部） |
| C10 | 6 个 build `enable` | 删除，只留 `bdl.build.enable` 总开关 + 6 个命令模板 |

命令总数 35 → **31**；设置键 55 → **49**（3 组：22 / 16 / 11）。
