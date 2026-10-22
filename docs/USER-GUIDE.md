# Genero BDL for VSCode 使用手册

> 适用扩展 `0.2.0`，语言服务器 `bdl-lsp 0.3.0`。  
> 本文面向日常开发，不要求了解 LSP 或 Go。遇到问题时先看
> [常见问题](#常见问题)，再按“显示服务器信息 / 显示输出”收集日志。

## 目录

1. [安装与第一次打开](#1-安装与第一次打开)
2. [功能总览](#2-功能总览)
3. [编辑与导航](#3-编辑与导航)
4. [诊断与检查](#4-诊断与检查)
5. [表单、GLOBALS 与数据库结构](#5-表单globals-与数据库结构)
6. [链接资料](#6-链接资料)
7. [部署](#7-部署)
8. [配置说明](#8-配置说明)
9. [常见问题](#9-常见问题)

---

## 1. 安装与第一次打开

### 1.1 安装扩展

两种方式任选：

- 在 VSCode 扩展市场搜索 `Genero BDL (4GL)`（扩展 ID
  `darcyjoven.4gl-full`），点“安装”；
- 或下载 `.vsix`，在“扩展 → … → 从 VSIX 安装”中选择文件。

扩展本身不包含语言服务器二进制。首次使用前需要准备 `bdl-lsp`，二选一：

- 把 `bdl-lsp` 放进 `PATH`；
- 在设置里填绝对路径：`bdl.server.path`。

扩展查找服务器的顺序是：`bdl.server.path` → 环境变量 `BDL_LSP_PATH`
→ 工作区 `.bdl-lsp/bin/bdl-lsp` → 系统 `PATH`。团队可以把二进制放进
`.bdl-lsp/bin/`，这样不用每人配路径。

> 📷 **截图位**：`images/vscode/01-install.png`  
> 建议内容：扩展市场里的安装页，能看清扩展名和“安装”按钮。

### 1.2 打开项目

用 VSCode 打开**项目根目录**（通常是含 `.4gl` / `.per` 和
`.bdl-lsp/` 的那一层），不要只打开单个文件。工作区根决定：

- `.bdl-lsp/config.json`、`.bdl-lsp/deploy.json` 从哪里读；
- 链接资料、schema、表单在哪个范围里查找；
- 哪些文件进入工作区索引。

打开后右下角会出现 BDL 语言模式。第一次索引大项目可能需要几秒到几十秒，
状态栏和“输出 → BDL Language Server”会显示进度。

> 📷 **截图位**：`images/vscode/02-first-open.png`  
> 建议内容：打开项目后的 Problems 面板 + 状态栏语言模式。

### 1.3 先做一次自检

命令面板（`Ctrl/Cmd+Shift+P`）运行：

- `Genero BDL: 显示服务器信息`：确认二进制路径、版本、当前设置；
- `Genero BDL: 显示输出`：看服务器日志；
- `Genero BDL: 重启语言服务器`：改完路径或升级二进制后使用。

如果“显示服务器信息”里解析失败，先解决二进制路径，后面的功能都不会工作。

---

## 2. 功能总览

| 能力 | 触发方式 | 说明 |
|---|---|---|
| 语法高亮 | 打开文件 | `.4gl` / `.global` / `.per` 静态高亮 |
| 语义高亮 | 自动 | 变量、函数、参数按语义着色（VSCode 专属） |
| 语法/语义诊断 | 打开、编辑、保存 | Problems 面板显示；见第 4 节 |
| 悬停 | 鼠标停留 | 变量来源、定义位置、函数信息 |
| 跳转定义 | `F12` / `Ctrl+Click` | 当前文件、GLOBALS、链接资料 |
| 查找引用 | `Shift+F12` | 当前工作区可解析的引用 |
| 补全 | 输入时 / `Ctrl+Space` | 关键字、变量、函数、表名等 |
| 重命名 | `F2` | **只改当前文件**，不会跨文件重命名 |
| 快速修复 | `Ctrl+.` | 目前只有“字段名写错”的修复 |
| 格式化 | `Shift+Alt+F` | 只支持 `.4gl` / `.global`，跳过 `.per` |
| 大纲/面包屑 | 自动 | 过程、函数、变量等符号 |
| 链接资料视图 | 侧边栏“链接资料” | 查看程序引用关系；VSCode 专属 |
| 部署 | 命令面板 | 上传 + 远程编译；见第 7 节 |

> 说明：扩展不做类型检查、赋值兼容性检查，也不做跨文件重命名。
> 变量检查只回答“这个名字有没有来源”，函数检查只回答“这个名字有没有定义”。

---

## 3. 编辑与导航

### 3.1 悬停与跳转

把鼠标放在变量、函数、GLOBALS 符号或表单字段上：

- 悬停显示来源（局部变量、模块变量、GLOBALS、内置符号、链接资料等）；
- `F12` 跳到定义；`Ctrl+Click` 同效；
- `Shift+F12` 查引用；
- 跳转结果可能跨文件，返回用 VSCode 的“后退”。

> 🎬 **录屏位**：`images/vscode/03-hover.gif`  
> 建议内容：悬停一个来自 GLOBALS 的变量，显示来源，再按 F12 跳过去。

### 3.2 补全

在语句位置输入关键字、变量名或函数名，或按 `Ctrl+Space` 手动触发。
补全会结合当前文件符号、GLOBALS、内置符号表；配置了链接资料后，还能补全
可用的模组函数。

> 🎬 **录屏位**：`images/vscode/04-completion.gif`  
> 建议内容：输入 `DIS` 后出现 `DISPLAY`，再输入一个函数名前缀。

### 3.3 重命名与快速修复

- `F2` 重命名**当前文件内**的符号；不会改其他文件，也不会改字符串里的名字。
- `Ctrl+.` 打开快速修复。目前只对“字段不在表单里”提供改名字段之类的建议。

### 3.4 格式化

`Shift+Alt+F` 或“格式化文档”。可用设置：

```jsonc
{
  "bdl.format.keywords": "unchanged", // unchanged / upper / lower
  "bdl.format.indentStyle": "auto",   // auto / tab / space
  "bdl.format.indentSize": 0          // 0 表示按原文件推断
}
```

`.per` 文件不做格式化，这是有意为之：表单布局的空白有语义，自动改容易破坏界面。

> 🎬 **录屏位**：`images/vscode/05-format.gif`  
> 建议内容：选中一段缩进混乱的 4GL，执行格式化，展示前后对比。

---

## 4. 诊断与检查

### 4.1 能看到哪些检查

| 检查 | 诊断码 | 默认级别 | 依赖 |
|---|---|---|---|
| 语法错误 | `syntax-error` | warning | 无 |
| 缺少节点（缺 `END IF`、逗号等） | `missing-<kind>` / `missing-node` | warning | 无 |
| GLOBALS 文件找不到 | `globals-file-not-found` | warning | 无 |
| 变量查不到来源 | `variable-source-unresolved` | warning | 无 |
| 字段不在表单里 | `field-not-in-form` | warning | 能唯一解析到 `.per` |
| 表单重复 item | `form-duplicate-item` | warning | `.per` |
| 表单布局 tag 未定义 | `form-layout-tag-undefined` | warning | `.per` |
| `SCREEN RECORD` 引用未定义 item | `form-screen-record-undefined` | warning | `.per` |
| 记录成员不存在 | `record-member-unknown` | **off** | `RECORD` 声明或 schema |
| 函数找不到定义 | `function-not-found` | warning | **链接资料** |
| 链接资料格式错误 | `link-data-invalid` | warning | 链接资料 |
| 链接资料过期 | `link-data-stale` | hint | 链接资料 |
| 文件过大已跳过 | `file-too-large` | information | 无 |

几个容易误解的点：

- **变量检查只查来源**，不查类型、不查赋值是否兼容；
- **函数检查需要链接资料**。没有 `.link/links.jsonl` 时整项不启用，避免误报；
- **字段检查只在表单唯一解析成功时报告**；解析不到表单不会硬猜；
- **记录成员默认关闭**。`RECORD LIKE table.*` 需要 schema 索引才能展开；
- `file-too-large` 是提示，不是错误；大文件会跳过语法检查。

### 4.2 调整级别

所有诊断级别只有一个入口：`bdl.diagnostics`。键是诊断码，值是
`off` / `error` / `warning` / `information` / `hint`。

```jsonc
{
  "bdl.diagnostics": {
    "syntax-error": "error",
    "variable-source-unresolved": "warning",
    "record-member-unknown": "off",
    "link-data-stale": "off"
  }
}
```

未列出的码用默认级别。**旧专用键已删除**：
`bdl.syntaxDiagnostics`、`bdl.missingDiagnostics`、`bdl.fieldDiagnostics`、
`bdl.recordMemberDiagnostics`、`bdl.globals.fileNotFoundDiagnostics`、
`bdl.globals.unresolvedSourceDiagnostics` 不再生效；如果从旧版本升级，
把这些值迁到 `bdl.diagnostics` 对应码即可。

常用改法：

```jsonc
// 想让语法错误显示红色
{ "bdl.diagnostics": { "syntax-error": "error" } }

// 暂时不想看变量未解析（先确认不是 GLOBALS 路径没配对）
{ "bdl.diagnostics": { "variable-source-unresolved": "off" } }

// 字段检查太吵，只关字段类
{ "bdl.diagnostics": {
  "field-not-in-form": "off",
  "form-duplicate-item": "off",
  "form-layout-tag-undefined": "off",
  "form-screen-record-undefined": "off"
} }
```

> 📷 **截图位**：`images/vscode/06-field-fix.png`  
> 建议内容：`INPUT ... FROM` 引用不存在的字段，Problems 里有
> `field-not-in-form`，光标处出现 Quick Fix。

### 4.3 忽略文件、字段、表单

```jsonc
{
  "bdl.ignore.files": ["build/**", "vendor/**"],
  "bdl.ignore.fields": ["tmp_*"],
  "bdl.ignore.forms": ["legacy/**"]
}
```

- `ignore.files`：该文件**所有诊断**都不报，并且不进入工作区索引；
- `ignore.fields`：只屏蔽 `field-not-in-form`；
- `ignore.forms`：屏蔽该表单相关的字段类诊断。

glob 写错不会让服务器崩，但那条规则不会匹配；日志里会有警告。

### 4.4 报告上限

`bdl.limits.maxIssues` 默认 200。单文件诊断太多时会截断，避免 Problems
面板卡死。确实需要看全部时可以临时调大，但不建议长期设得很大。

---

## 5. 表单、GLOBALS 与数据库结构

### 5.1 表单 `.per`

打开 `.per` 会做单文件内部一致性检查：

- `ATTRIBUTES` 重复 item；
- `LAYOUT` 引用未定义的 tag；
- `SCREEN RECORD` 引用未定义的 item/字段。

`INPUT ... FROM`、`AFTER FIELD` 等语句引用的字段，需要能从当前文件解析到
对应的 `.per` 才会检查。表单不在同目录时，用 `bdl.perRoots` 增加解析根：

```jsonc
{ "bdl.perRoots": ["forms", "legacy/forms"] }
```

### 5.2 GLOBALS

`GLOBALS "path"` 默认相对当前文件解析。仓库层级特殊、相对路径解析不到时，
用 `bdl.globals.searchPaths` 增加候选根：

```jsonc
{ "bdl.globals.searchPaths": ["config", "tiptop/config"] }
```

GLOBALS 文件找不到时默认 warning；确认是历史遗留、不打算修，可以把
`globals-file-not-found` 关掉或加进 `ignore.files`。

### 5.3 数据库结构索引（schema）

`RECORD LIKE table.*` 的成员来自数据库表结构，静态源码里看不到。
配置 schema 后可以展开：

```jsonc
{
  "bdl.schema.enable": true,
  "bdl.schema.paths": ["schema/*.sch"]
}
```

没有 schema 时，记录成员检查默认关闭是正确的；不要为了“看起来开了”
把它强行设成 warning，否则 `LIKE table.*` 会成片误报。

---

## 6. 链接资料

链接资料是程序/函数/全局变量的跨模块索引，保存在项目的 `.link/` 下。
它**不是**打开项目就自动有的，需要先生成；没有它时：

- `function-not-found` 不启用；
- 跨模块的函数补全、跳转、引用不完整；
- 链接资料视图为空。

### 6.1 生成链接资料

链接资料来自 DS.GAL_FILE 导出，或直接从数据库/命令/文件采集：

```bash
# 方式一：已有 DS.GAL_FILE 导出 CSV
bdl-lsp link import -csv /path/to/gal_file.csv -root .

# 方式二：从文件采集（CSV 格式与方式一相同）
bdl-lsp link sync -root . -source file -file /path/to/gal_file.csv

# 方式三：从命令采集（命令需输出 CSV）
bdl-lsp link sync -root . -source command -command 'your-export-command'

# 方式四：直连 Oracle 采集
BDL_ORA_PASSWORD=... bdl-lsp link sync -root . -source golang \
  -host db.example.com -service MYDB -user apps
```

大项目第一次扫描会慢一些（几千个文件通常几十秒），终端会打印
`扫描源码 X/Y` 进度。完成后检查：

```bash
bdl-lsp link status -root .
```

### 6.2 在 VSCode 里使用

- 侧边栏“链接资料”树显示当前程序的引用关系；
- 命令 `Genero BDL: 刷新` 重新加载；
- 命令 `Genero BDL: 反查引用程序` 从当前符号反查调用方，选中后跳到对应 `.4gl`；
- 反查结果多时用 `Genero BDL: 显示更多反查结果`。

> 📷 **截图位**：`images/vscode/07-link-view.png`  
> 建议内容：侧边栏链接资料树，展开一个程序节点。

> 🎬 **录屏位**：`images/vscode/08-link-reverse.gif`  
> 建议内容：在一个函数上执行反查，Quick Open 列表里选一个 `.4gl` 并跳转。

### 6.3 配置链接资料

```jsonc
{
  "bdl.link.enable": true,
  "bdl.link.dataDir": ".link",
  "bdl.link.moduleRoots": ["src"],
  "bdl.link.globalModules": ["sub", "lib", "qry"],
  "bdl.link.maxAgeDays": 7
}
```

- `dataDir`：资料目录，默认 `.link`；
- `moduleRoots`：模组根，影响跨模组查找；
- `globalModules`：全局模组名；
- `maxAgeDays`：过期提示阈值，超过后报 `link-data-stale`（hint）。

### 6.4 自动同步

默认关闭。需要时：

```jsonc
{
  "bdl.link.sync.enable": true,
  "bdl.link.sync.source": "golang", // golang / command / file
  "bdl.link.sync.onStart": true,
  "bdl.link.sync.interval": 0        // 秒；0 表示只手动/启动时同步
}
```

`source=command` 时填 `bdl.link.sync.command`；`source=file` 时填
`bdl.link.sync.file`。数据库源需要 `db.host/service/user/query`，
密码**不放在设置里**：用环境变量 `BDL_ORA_PASSWORD`，或
`.link/secrets.json`（权限 0600）。

### 6.5 链接资料常见问题

| 现象 | 先查 |
|---|---|
| 函数仍然报找不到 | 是否生成过 `.link/links.jsonl`；`link status` 是否正常 |
| 链接视图为空 | 当前文件是否在 `moduleRoots` 内；是否点了刷新 |
| 反查跳错文件 | 确认生成资料后重新 `link import`；旧索引可能过期 |
| 资料过期提示 | 重新 `link sync`，或临时关掉 `link-data-stale` |

---

## 7. 部署

部署 = 上传源码到远程服务器 + 远程编译。配置在
`.bdl-lsp/deploy.json`，示例见仓库 `examples/deploy.json`。

### 7.1 最小配置

```json
{
  "targets": {
    "test": {
      "host": "dev.example.com",
      "user": "genero",
      "remoteRoot": "/u1/app",
      "upload": { "include": ["**/*.4gl", "**/*.per"] },
      "compile": {
        "4gl": "fglcomp -M {file}",
        "per": "fglform {file}"
      }
    }
  },
  "defaultTarget": "test"
}
```

认证使用 SSH key / ssh-agent，不支持在设置里存密码。

### 7.2 命令

| 命令 | 作用 |
|---|---|
| `Genero BDL: 部署到远程服务器并编译` | 按 include 上传整个工作区并编译 |
| `Genero BDL: 部署当前文件并编译` | 只处理当前文件 |
| `Genero BDL: 部署预演（不上传）` | 打印计划，不执行 |
| `Genero BDL: 列出部署目标` | 查看 `targets` |

设置 `bdl.deploy.target` 可指定默认目标；留空用 `defaultTarget`。

> 📷 **截图位**：`images/vscode/09-deploy.png`  
> 建议内容：执行“部署预演”后的输出，包含目标、上传列表、编译命令。

### 7.3 部署排查

- 先跑“部署预演”，确认文件列表和编译命令；
- SSH 失败先手动 `ssh user@host`，确认 key/agent；
- 编译失败看输出里的远程命令和 stderr；
- `.bdl-lsp/deploy.json` 含主机信息，建议加入 `.gitignore`，只提交模板。

---

## 8. 配置说明

配置有三层，优先级从高到低：

1. VSCode 设置（`settings.json` 里的 `bdl.*`）；
2. 项目文件 `.bdl-lsp/config.json`；
3. 扩展/服务端内置默认值。

`bdl.diagnostics` 的逐码值覆盖项目文件里的同码值；项目文件适合团队共享，
VSCode 设置适合个人临时调整。

### 8.1 按“要不要改”分类

**第一类：默认即可，基本不用动**

- 诊断级别：`bdl.diagnostics` 默认 warning；只有 `record-member-unknown`
  默认 off、`link-data-stale` 默认 hint、`file-too-large` 默认 information；
- 格式化：`format.keywords=unchanged`、`indentStyle=auto`、`indentSize=0`；
- 资源限制：大文件、行数、诊断条数、解析超时都有安全默认值；
- 项目解析：`index.enable=true`、`schema.enable=true`、`builtins.enable=true`。

**第二类：不配置就用不了**

- 链接资料：需要先生成 `.link`，再按需配 `link.*`；
- 部署：需要 `.bdl-lsp/deploy.json` 和 SSH 访问；
- schema：只有需要展开 `LIKE table.*` 时才配 `schema.paths`；
- 表单/ GLOBALS 搜索路径：项目层级特殊时才需要加。

**第三类：按项目调整**

- `ignore.*`：忽略生成代码、历史代码；
- `link.moduleRoots` / `globalModules` / `sync.*`：多模组项目；
- `limits.*`：超大型文件或诊断特别多的项目；
- `server.path` / `logLevel` / `trace.server`：安装与排障。

### 8.2 设置键总表

**运行与安装**

| 键 | 默认 | 作用 |
|---|---|---|
| `bdl.server.path` | `""` | `bdl-lsp` 绝对路径；留空走工作区 `artifacts/bin` 或 `PATH` |
| `bdl.server.logLevel` | `info` | 服务端日志级别：`debug`/`info`/`warn`/`error` |
| `bdl.trace.server` | `off` | LSP 协议跟踪：`off`/`messages`/`verbose` |
| `bdl.generoVersion` | `2.50` | 目标 Genero 版本：`2.50`/`3.00`/`4.00` |

**诊断与格式化（默认即可）**

| 键 | 默认 | 作用 |
|---|---|---|
| `bdl.diagnostics` | `{}` | 按诊断码覆盖级别；唯一诊断入口 |
| `bdl.format.keywords` | `unchanged` | 关键字大小写：`unchanged`/`upper`/`lower` |
| `bdl.format.indentStyle` | `auto` | 缩进风格：`auto`/`tab`/`space` |
| `bdl.format.indentSize` | `0` | 缩进宽度；0 表示按原文件推断 |

**项目解析（默认开启）**

| 键 | 默认 | 作用 |
|---|---|---|
| `bdl.index.enable` | `true` | 工作区符号索引 |
| `bdl.schema.enable` | `true` | 数据库 schema 索引开关 |
| `bdl.schema.paths` | `[]` | `.sch` 文件路径/glob |
| `bdl.globals.searchPaths` | `[]` | GLOBALS 附加解析根 |
| `bdl.perRoots` | `[]` | `.per` 附加解析根 |
| `bdl.builtins.enable` | `true` | 内置函数/变量符号表 |
| `bdl.builtins.paths` | `[]` | 项目自定义内置表文件 |
| `bdl.builtins.disable` | `[]` | 禁用的内置符号名 |
| `bdl.ignore.files` | `[]` | 忽略诊断并排除索引的文件 glob |
| `bdl.ignore.fields` | `[]` | 忽略 `field-not-in-form` 的字段 glob |
| `bdl.ignore.forms` | `[]` | 忽略字段类诊断的表单 glob |

**资源保护**

| 键 | 默认 | 作用 |
|---|---|---|
| `bdl.limits.maxFileBytes` | `2097152` | 单文件字节上限（2 MB） |
| `bdl.limits.maxFileLines` | `20000` | 单文件行数上限 |
| `bdl.limits.maxIssues` | `200` | 单文件最多诊断条数 |
| `bdl.limits.parseTimeoutMs` | `2000` | 单次解析超时（毫秒） |

**链接资料（不配置不可用）**

| 键 | 默认 | 作用 |
|---|---|---|
| `bdl.link.enable` | `true` | 总开关 |
| `bdl.link.dataDir` | `.link` | 资料目录 |
| `bdl.link.moduleRoots` | `[]` | 模组根 |
| `bdl.link.globalModules` | `["sub","lib","qry"]` | 全局模组名 |
| `bdl.link.maxAgeDays` | `7` | 过期提示阈值（天） |
| `bdl.link.sync.enable` | `false` | 自动同步开关 |
| `bdl.link.sync.source` | `golang` | `golang`/`command`/`file` |
| `bdl.link.sync.onStart` | `false` | 启动时同步 |
| `bdl.link.sync.interval` | `0` | 同步间隔（秒），0 为不定时 |
| `bdl.link.sync.command` | `""` | `source=command` 时执行的命令 |
| `bdl.link.sync.file` | `""` | `source=file` 时读取的文件 |
| `bdl.link.sync.db.host` | `""` | Oracle 主机 |
| `bdl.link.sync.db.port` | `1521` | Oracle 端口 |
| `bdl.link.sync.db.service` | `""` | Oracle service name |
| `bdl.link.sync.db.user` | `""` | Oracle 用户 |
| `bdl.link.sync.db.query` | `""` | 自定义查询 |

**部署（不配置不可用）**

| 键 | 默认 | 作用 |
|---|---|---|
| `bdl.deploy.target` | `""` | 默认部署目标名；留空用 `defaultTarget` |

> 密码不在设置里。链接同步用 `BDL_ORA_PASSWORD` 或
> `.link/secrets.json`；部署用 SSH key / agent。

### 8.3 项目级配置示例

`.bdl-lsp/config.json`：

```jsonc
{
  "generoVersion": "3.00",
  "diagnostics": {
    "record-member-unknown": "warning",
    "function-not-found": "warning"
  },
  "globals": { "searchPaths": ["config"] },
  "perRoots": ["forms"],
  "ignore": { "files": ["build/**"] },
  "link": { "moduleRoots": ["src"], "maxAgeDays": 14 }
}
```

改完项目文件后执行 `Genero BDL: 重启语言服务器`，或等设置热更新生效。

---

## 9. 常见问题

### 9.1 打开文件没有任何诊断

按顺序检查：

1. 右下角语言模式是否是 “Genero BDL” / “Genero Form”；
2. `Genero BDL: 显示服务器信息` 是否解析到二进制；
3. `Genero BDL: 显示输出` 是否有启动失败、CGO、grammar 加载错误；
4. 文件是否被 `bdl.ignore.files` 或 `.bdl-lsp/config.json` 忽略；
5. 是否超过 `limits.maxFileBytes` / `maxFileLines`（会显示 `file-too-large`）。

### 9.2 变量或函数全是波浪线

- 变量：先确认 GLOBALS 路径是否正确，必要时加 `globals.searchPaths`；
- 函数：先确认链接资料是否生成；没有 `.link` 时函数检查不会启用；
- 内置函数被误报：确认 `builtins.enable=true`，版本是否匹配
  `generoVersion`。

### 9.3 跳转/补全不工作

- 当前文件是否解析成功（有语法错误时索引可能不完整）；
- 目标是否在 GLOBALS、链接资料或当前工作区内；
- 多根工作区里，项目是否在正确的根下；
- 大项目索引是否还在进行中。

### 9.4 链接资料视图空 / 反查不到

- 先跑 `bdl-lsp link status -root .`；
- 确认 `.link/links.jsonl` 存在且不是空文件；
- 重新 `link import` 后点“刷新”；
- 反查只对已索引的程序有效，确认当前文件在 `moduleRoots` 内。

### 9.5 部署失败

- 先“部署预演”；
- 手动 `ssh` 验证 key/agent；
- 检查 `remoteRoot` 是否存在、是否有写权限；
- 检查远程编译命令是否在登录 shell 的 `PATH` 里。

### 9.6 升级后旧诊断设置不生效

旧专用键已删除。把旧值迁到 `bdl.diagnostics`：

```jsonc
// 旧： "bdl.fieldDiagnostics": "off"
{ "bdl.diagnostics": { "field-not-in-form": "off" } }
```

完整码表见第 4.1 节。

---

## 附：截图/录屏清单

| 编号 | 文件 | 用在哪 |
|---|---|---|
| 01 | `images/vscode/01-install.png` | 1.1 安装 |
| 02 | `images/vscode/02-first-open.png` | 1.2 第一次打开 |
| 03 | `images/vscode/03-hover.gif` | 3.1 悬停/跳转 |
| 04 | `images/vscode/04-completion.gif` | 3.2 补全 |
| 05 | `images/vscode/05-format.gif` | 3.4 格式化 |
| 06 | `images/vscode/06-field-fix.png` | 4.2 字段诊断 |
| 07 | `images/vscode/07-link-view.png` | 6.2 链接视图 |
| 08 | `images/vscode/08-link-reverse.gif` | 6.2 反查 |
| 09 | `images/vscode/09-deploy.png` | 7.2 部署 |
| 10 | `images/vscode/10-settings.png` | 8. 设置页 |

素材规范见 [`images/vscode/README.md`](images/vscode/README.md)。
