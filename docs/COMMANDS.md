# 插件操作清单（命令 / 按钮 / 后台任务）

> 生成于 2026-10-26（设置重构 V2 之后，旧键兼容已全部删除）。
> **用途**：做一次操作清理——逐条确认「保留 / 合并 / 改名 / 删除」。
> 数据来源：`package.json` 的 `contributes.commands` 与 `contributes.menus`，以及 `src/` 里的注册与监听。

## 0. 总览

| 入口 | 数量 | 说明 |
|---|---|---|
| 命令（`contributes.commands`） | **35** | 命令面板可见 33 条，隐藏 2 条（内部/通知触发） |
| 编辑器右上角按钮（`editor/title`） | **7** | 强制解析（按需）+ 6 条编译/链接/预览 |
| 视图标题栏按钮（`view/title`） | **10** | 链接资料 3 + 数据库字段 7 |
| 视图项按钮/右键（`view/item/context`） | **5** | 链接反查 2 + 字段表 2 + 字段列 1（内联） |
| 命令面板隐藏命令 | **2** | `bdl.links.moreRefs`（树项「显示更多」触发）、`bdl.migrateLinkDir`（旧布局通知按钮触发） |
| 输出通道 | **6** | 服务器 / 追踪 / 编译 / 部署 / 链接资料 / 数据库字段 |
| 激活事件 | **29** | 2 条 `onLanguage` + 27 条 `onCommand` |
| 上下文键（`when` 依据） | **11** | 见 [§6](#6-后台运行与自动行为) |

## 1. 命令面板（33 条可见）

`when` 为空 = 始终可见；否则只在条件成立时出现（`config.*` 是设置值，`bdl.*` 是扩展维护的上下文键）。

### 1.1 服务器与排障（4 条，始终可见）

| id | 标题 | `when` | 说明 |
|---|---|---|---|
| `bdl.restartServer` | 重启语言服务器 | — | 设置改了需要重启的键后也会提示它 |
| `bdl.showServerInfo` | 显示语言服务器信息 | — | 二进制来源、版本、设置值 |
| `bdl.showOutput` | 显示输出 | — | 打开「Genero BDL」服务器通道 |
| `bdl.forceParseCurrentFile` | 强制解析当前文件 | —（编辑器按钮限 `bdl.parseSkipped`） | 大文件/超时被跳过时后台不限时解析，完成后回执刷新大纲 |

### 1.2 链接资料（9 条）

| id | 标题 | `when` | 说明 |
|---|---|---|---|
| `bdl.link.importCsv` | 链接资料：从 CSV 导入 | `bdl.link.enabled` | `file`/`db` 模式都可用 |
| `bdl.link.syncCurrent` | 链接资料：更新当前文件 | `bdl.link.modeDb` | 按当前文件反查受影响作业 |
| `bdl.link.syncModules` | 链接资料：按模组更新 | `bdl.link.modeDb` | 选模组（lib/sub/qry…） |
| `bdl.link.syncAll` | 链接资料：全量更新 | `bdl.link.modeDb` | 全量扫描 |
| `bdl.link.status` | 链接资料：查看状态 | `bdl.link.enabled` | 链/orphan/ambiguous/缺失文件 |
| `bdl.links.refresh` | 刷新 | `bdl.link.enabled` | 视图刷新 |
| `bdl.links.references` | 反查引用程序 | `bdl.link.enabled` | 也出现在视图按钮/视图项 |
| `bdl.links.resync` | 重新同步 | `bdl.link.enabled` | **等同** `bdl.link.syncCurrent`（视图按钮文案） |
| `bdl.link.updateFromDb` | 从数据库更新 | `bdl.link.modeDb && bdl.db.configured && bdl.link.hasData` | **等同** `bdl.link.syncCurrent` |

### 1.3 数据库字段（12 条）

| id | 标题 | `when` | 说明 |
|---|---|---|---|
| `bdl.schema.import` | 数据库字段：从 CSV 导入 | `bdl.schema.enabled` | `file`/`db` 都可用 |
| `bdl.schema.refresh` | 数据库字段：刷新 | `bdl.schema.enabled` | |
| `bdl.schema.filter` | 数据库字段：正则过滤表名 | `bdl.schema.enabled` | 视图查询框 |
| `bdl.schema.clearFilter` | 数据库字段：清除过滤 | `bdl.schema.enabled` | |
| `bdl.schema.copyColumn` | 数据库字段：复制列定义 | `bdl.schema.enabled` | 得到 `LIKE 表.列`；也内联在列节点 |
| `bdl.schema.openTable` | 数据库字段：打开表资料文件 | `bdl.schema.enabled` | 也右键在表节点 |
| `bdl.schema.syncAll` | 数据库字段：从数据库同步 | `bdl.schema.modeDb && bdl.db.configured` | 全量（含 `-prune`） |
| `bdl.schema.syncSelected` | 数据库字段：同步已选中的表 | `…modeDb && configured && hasData` | 复选框多选 |
| `bdl.schema.syncFiltered` | 数据库字段：同步当前筛选结果 | 同上 | 正则筛选后全同步 |
| `bdl.schema.selectAll` | 数据库字段：全选当前列表 | 同上 | |
| `bdl.schema.clearSelection` | 数据库字段：清除勾选 | 同上 | |
| `bdl.schema.syncTable` | 数据库字段：同步选中的表 | 同上（视图项右键） | 单表 |

### 1.4 编译 / 链接 / 预览（6 条）

| id | 标题 | `when` | `enablement` | 图标 |
|---|---|---|---|---|
| `bdl.build.4gl.preview` | 4GL：预演编译 | `editorLangId == 4gl && bdl.build.enabled && config.bdl.build.4gl.preview.enable` | — | `$(beaker)` |
| `bdl.build.4gl.compile` | 4GL：编译 | 同上（`.compile`） | — | `$(play)` |
| `bdl.build.4gl.link` | 4GL：链接 | 同上（`.link`） | `bdl.build.hasMain` | `$(link)` |
| `bdl.build.per.preview` | Form：预演编译 | `editorLangId == per && …per.preview.enable` | — | `$(beaker)` |
| `bdl.build.per.compile` | Form：编译 | 同上（`.compile`） | — | `$(play)` |
| `bdl.build.per.form` | Form：预览画面 | 同上（`.form`） | — | `$(eye)` |

> 全部由 `tiptop exec` 在**生产服务器**上执行（工作目录 = 生产根）；**不自动上传**。

### 1.5 上传（2 条）

| id | 标题 | `when` | 说明 |
|---|---|---|---|
| `bdl.deployCurrentFile` | 上传当前文件 | `bdl.upload.enabled` | 单文件，工作区根 → 生产根同路径 |
| `bdl.deployDryRun` | 预演上传 | `bdl.upload.enabled` | 只打印计划 |

### 1.6 隐藏（2 条，无命令面板入口）

| id | 标题 | 触发方式 |
|---|---|---|
| `bdl.links.moreRefs` | 显示更多反查结果 | 链接视图里「反查引用程序」节点的**「显示更多」** |
| `bdl.migrateLinkDir` | 迁移项目资料目录 | 检测到旧布局（`.project` 根/`.link`）时的**通知「迁移」按钮** |

## 2. 编辑器右上角按钮（7 个）

| 文件 | 显示条件 | 按钮 |
|---|---|---|
| `.4gl` / `.per` | 只有当前文件被跳过解析（`bdl.parseSkipped`） | 强制解析当前文件 `$(refresh)` |
| `.4gl` | `bdl.build.enabled` + 各自 `.enable` | 预演编译 `$(beaker)`、编译 `$(play)`、链接 `$(link)`（无 `MAIN` 时置灰） |
| `.per` | 同上 | 预演编译 `$(beaker)`、编译 `$(play)`、预览画面 `$(eye)` |

## 3. 视图标题栏按钮（10 个）

**链接资料（`view == bdlLinks`）**

| 按钮 | 显示条件 |
|---|---|
| 刷新 `$(refresh)` | `bdl.link.enabled` |
| 重新同步 `$(sync)` | `bdl.link.enabled` |
| 从数据库更新 `$(cloud-download)` | `bdl.link.modeDb && bdl.db.configured && bdl.link.hasData` |

**数据库字段（`view == bdlSchema`）**

| 按钮 | 显示条件 |
|---|---|
| 正则过滤 `$(filter)` / 刷新 `$(refresh)` / 从 CSV 导入 `$(file-add)` | `bdl.schema.enabled` |
| 同步已选中的表 `$(cloud-upload)` / 全选 `$(checklist)` / 清除勾选 `$(close)` / 同步当前筛选结果 `$(cloud-upload)` | `bdl.schema.modeDb && bdl.db.configured && bdl.schema.hasData` |

## 4. 视图项按钮 / 右键（5 个）

| 位置 | 命令 | 显示条件 |
|---|---|---|
| 链接视图的「反查引用程序」节点（内联） | 反查引用程序 `$(search)` | `viewItem == bdlLinkRefsButton` |
| 同上（内联） | 重新同步 `$(sync)` | 同上 + `bdl.link.enabled` |
| 字段视图的表节点（右键 `1_sync`） | 同步选中的表 | `bdl.schema.modeDb && …hasData` |
| 字段视图的表节点（右键 `2_open`） | 打开表资料文件 | `viewItem == bdlSchemaTable` |
| 字段视图的列节点（内联） | 复制列定义 | `viewItem =~ /^bdlSchemaColumn/` |

## 5. 输出通道（6 个）

| 通道 | 谁在写 |
|---|---|
| Genero BDL | LSP 服务器日志/启动信息 |
| Genero BDL 追踪 | `bdl.trace.server` 打开时的 LSP 消息 |
| Genero BDL 编译 | 6 条编译/链接/预览命令（`tiptop exec` 输出原样） |
| Genero BDL 部署 | 上传当前文件 / 预演上传（`tiptop upload` 输出） |
| Genero BDL 链接资料 | 链接同步命令 + 状态 |
| Genero BDL 数据库字段 | 字段同步/导入 |

> tiptop 每次运行还会把完整输出落盘到扩展 globalStorage 的 `last-run-<cmd>.log`（失败通知可点「打开日志」）。

## 6. 后台运行与自动行为

**扩展激活（29 个 `activationEvents`）**：`onLanguage:bdl`、`onLanguage:per`，以及 27 条命令的 `onCommand:*`（命令被点/被程序调用时才加载扩展）。

**扩展侧后台（不需要点任何东西）**

| 行为 | 触发 | 说明 |
|---|---|---|
| 语言服务器启动 | 打开 `.4gl`/`.per` | `bdl-lsp` stdio；索引、诊断、补全、悬停、跳转、引用、大纲、格式化、GLOBALS、表单校验都在服务器里 |
| 工作区符号索引 | 启动后 | 后台建索引（进度见「Genero BDL」通道） |
| 资料热加载 | 文件变化 | 监听 `links.jsonl` / `tables.json`（含旧布局 5 个 glob），变了就刷新视图与上下文 |
| 上下文键更新 | 设置/文件夹/诊断/活动编辑器变化 | `bdl.db.configured`、`bdl.link.enabled/modeDb/hasData`、`bdl.schema.enabled/modeDb/hasData`、`bdl.upload.enabled`、`bdl.build.enabled`、`bdl.parseSkipped`、`bdl.build.hasMain` |
| MAIN 门控刷新 | 切换/编辑文档（300ms 防抖） | 决定 4GL「链接」是否置灰 |
| 旧布局提醒 | 打开链接资料视图时 | 提示「迁移」，点了才跑 `bdl.migrateLinkDir` |
| 强制解析 | 点按钮 | 后台不限时解析；完成发 `bdl/parseDone`，客户端刷新大纲 |
| 索引未命中提示 | 打开文件时 | 解析被跳过 → `bdl.parseSkipped` → 显示强制解析按钮 |
| 子进程 | 点链接/字段/上传/编译命令 | 调 `tiptop`，进度通知可取消；取消即杀子进程 |

**LSP 自定义协议（插件 ↔ 服务器）**：`bdl/forceParse`、`bdl/parseDone`、`bdl/linkTree`、`bdl/linkReferences`、`bdl/schemaTables`、`bdl/schemaColumns`。

## 7. 清理建议（待你圈定）

| # | 观察 | 建议 |
|---|---|---|
| C1 | 「更新链接资料」有 **3 个同义入口**：`syncCurrent`（命令面板）、`links.resync`（视图按钮）、`link.updateFromDb`（视图按钮 + 命令面板） | 只留 1 个用户可见入口（建议视图按钮「从数据库更新」），另两个删掉或仅内部复用 |
| C2 | 字段同步有 **4 个入口**：`syncAll` / `syncSelected` / `syncFiltered` / `syncTable` | 建议合并为「同步（全部 / 已选 / 当前表）」3 个；命令面板只留 `syncAll`+`syncSelected` |
| C3 | `bdl.links.references` 出现在命令面板 + 视图按钮 + 视图项（3 处） | 保留视图按钮 + 视图项；命令面板可按 `when` 限当前文件 |
| C4 | `bdl.forceParseCurrentFile` 在命令面板**始终可见** | 建议 palette 加 `when: bdl.parseSkipped`（与编辑器按钮一致） |
| C5 | `bdl.showOutput` 与 `bdl.showServerInfo` 功能相邻 | 可合并为「显示语言服务器信息」（信息里给「打开日志」动作） |
| C6 | 输出通道 **6 个** | 可合并为 2 个：「Genero BDL」（服务器/追踪）与「Genero BDL 任务」（编译/上传/链接/字段） |
| C7 | `bdl.migrateLinkDir` 在命令面板隐藏 | 建议保留隐藏（通知触发），但在 README 写明"手动执行一次"的替代路径 |
| C8 | `bdl.schema.copyColumn` / `openTable` 同时出现在命令面板与右键菜单 | 建议只留右键（命令面板隐藏） |
| C9 | `bdl.links.moreRefs` 纯内部 | 保持隐藏（合理） |
| C10 | 编译/链接/预览 6 条命令 + 6 个 enable 开关 | 若觉得设置项偏多，可只留总开关 + 命令模板（按需再拆 enable） |

## 8. 下一步

你按 C1–C10 圈定「保留 / 合并 / 删除 / 改名」，我再改代码、e2e 与文档；
改完这份清单会同步更新（它就是当前状态的快照）。