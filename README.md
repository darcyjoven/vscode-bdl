# Genero BDL (4GL) for VSCode

Genero BDL（`.4gl` / `.global`）与 Form（`.per`）的语言支持：**语法高亮、定义/引用跳转、符号大纲、悬停、补全、格式化、语法诊断**，
需要时再叠加**跨模块函数可见性**、**数据库字段说明**与**远程部署**。

扩展市场里搜 **`Genero BDL (4GL)`**（扩展 id `4gl-full`，发布者 `darcyjoven`）即可安装。
平台安装包**内置语言服务器**，装完就能用，不需要另外装 `bdl-lsp`。

---

## 0. 三种用法：按需要选一档，从简单到复杂

| | ③ **轻量（默认，装完即用）** | ② **本地文件解析** | ① **全功能（账号密码）** |
|---|---|---|---|
| 适合谁 | 只想看代码、改代码 | 公司不让连库 / 拿得到导出文件 | 能申请只读库账号 |
| 需要准备什么 | **什么都不用配** | 一份 DS.GAL_FILE 导出 CSV，外加一份表字段 CSV | 数据库主机/服务名/只读账号 + 密码 |
| 得到什么 | 高亮、跳转、引用、大纲、悬停、补全、格式化、语法诊断、表单字段校验 | 再加：跨模块函数可见性、链接资料视图与反查引用、字段中文说明、记录成员校验 | 再加：**从数据库一键同步**（链接资料 + 表字段）、**远程部署** |
| 敏感信息 | 不碰 | 不碰（只有导出文件） | 账号写在 **Workspace 设置**，**密码不进设置** |
| 会不会往项目里写文件 | **不会** | 会（写 `<项目>/.project/`） | 会（写 `<项目>/.project/`） |
| 会不会连网/连库 | 不会 | 不会 | 只在你点命令时连一次 |

> 📷 **配图位 G1**：`docs/images/guide/01-three-modes.png`
> 拍什么：一张总览图——左侧"轻量档"（只有编辑器界面），中间"本地文件档"（导出 CSV 拖进项目），
> 右侧"全功能档"（设置里填了主机/账号、点了"从数据库同步"）。也可以直接截本节的表格。

**三档是叠加关系，不是三选一选到底**：任何一档都可以随时升级，只改设置、不改代码、不用重装。

---

## 1. 模式 ③ 轻量：装完即用（默认，零配置）

### 1.1 安装

1. VSCode 扩展面板搜 `Genero BDL (4GL)` → 安装；
2. 打开你的项目文件夹（`.4gl` / `.per` 所在目录）；
3. 打开任意一个 `.4gl`，右下角状态栏出现 **Genero BDL** 就绪。

> 📷 **配图位 G2**：`docs/images/guide/02-install.png`
> 拍什么：扩展面板里已安装的 `Genero BDL (4GL)`（显示版本号与"已安装"），不要露出个人账号信息。

### 1.2 这一档直接可用

| 能力 | 怎么用 |
|---|---|
| 语法高亮 | 打开 `.4gl` / `.per` 就有；关键字、函数名、字段访问、注释、字符串都有区分 |
| 大纲 / 面包屑 | 左侧"大纲"或 `Ctrl+Shift+O`：MAIN / FUNCTION / REPORT / DEFINE / RECORD / SCREEN RECORD |
| 定义跳转 | `Ctrl+点击` 或 `F12`：`CALL foo` → `FUNCTION foo`；`rec.field` → 记录字段 |
| 引用查找 | `Shift+F12`：列出所有引用（自动排除注释与字符串） |
| 悬停 | 显示种类、类型、签名、字段数；内置函数还会给 Genero 签名与出处 |
| 补全 | `Ctrl+Space`：同/跨文件符号、表单字段、关键字、内置符号 |
| 格式化 | `Shift+Alt+F`：关键字大小写与缩进归一（`.per` 不做格式化） |
| 语法诊断 | Problems 面板给出解析错误与缺失内容（缺 `END IF`、少逗号等） |
| 表单字段校验 | `INPUT … FROM f01` 里的字段在 `.per` 里不存在时报 `field-not-in-form`，带 Quick Fix |
| GLOBALS 跨文件 | 项目里有 `.global` 就自动生效：全局变量的跳转与来源标注 |
| 快速修复 | 字段拼错 → 一键改成表单里的正确字段；重命名会同时改调用处 |

> 🎬 **录屏位 G3**：`docs/images/guide/03-jump-hover.gif`
> 拍什么：在一个函数名上 `F12` 跳到定义，再悬停一个变量看来源（10 秒内，两三个动作）。
>
> 📷 **配图位 G4**：`docs/images/guide/04-outline.png`
> 拍什么：大纲面板展开一个 `.4gl`（能看到 MAIN / FUNCTION / DEFINE 层级）。

### 1.3 这一档**不会**做的事（有意为之）

- **不连数据库、不连网**；没有任何后台任务、没有定时器；
- **不往你的项目里写文件**（连日志都写在 VSCode 的全局日志目录）；
- **不弹"请先配置 XXX"**：没配好之前，相关命令和视图**直接隐藏**，而不是点了再报错。

这就是默认行为。所以你装上之后看到"没有链接资料视图""没有那些命令"是正常的——
按第 2 或第 3 节打开对应开关，它们才会出现。

### 1.4 30 秒自检

- 打开一个 `.4gl`，`Ctrl+Shift+P` 执行 **`Genero BDL: 显示语言服务器信息`**，
  能看到版本、二进制来源、当前设置 → 说明语言服务器在跑；
- `Ctrl+Shift+O` 能列出函数 → 解析正常；
- 故意把 `END IF` 删掉 → Problems 里出现语法错误 → 诊断正常。

---

## 2. 模式 ② 本地文件解析：自己下载导出文件

**目标**：不用任何数据库账号，只靠"别人给你两份 CSV"，就得到跨模块函数可见性、链接资料视图、字段中文说明。

### 2.1 需要的两份文件

| 文件 | 从哪来 | 用来做什么 |
|---|---|---|
| **程序链接资料**（DS.GAL_FILE 导出，列 `GAL01..GAL04`） | DBA/生产环境执行一条 SQL 导出，或用脚本 [`fetch-gal-file.sh`](https://github.com/darcyjoven/tiptop/blob/main/scripts/fetch-gal-file.sh) 在生产机上跑 | 跨模块**函数可见性**：`function-not-found` 不再乱报；侧边栏"链接资料"树与**反查引用程序** |
| **表字段资料**（表名/列名/中文说明/类型/长度…） | DBA 导出 `ALL_TAB_COLUMNS` + `ALL_COL_COMMENTS`（见 `tiptop` 仓库文档） | 悬停 `LIKE t.col` 显示**中文说明**；`RECORD LIKE t.*` 的成员校验；`rec.` 补全带说明 |

> 📷 **配图位 G5**：`docs/images/guide/05-export-csv.png`
> 拍什么：生产端导出得到两个 CSV 的样子（文件列表即可；不要露真实库名/主机名/账号）。

### 2.2 在 VSCode 里导入（推荐，不用开终端）

1. 命令面板 → **`Genero BDL: 链接资料：从 CSV 导入`** → 选 `GAL_FILE` 的 CSV；
   扩展会把它复制成 `<项目>/.project/gal_file.csv`，然后问你：
   - **全量导入**（第一次用，几秒到几十秒，看项目大小）；
   - **只更新当前文件**（以后改了某几个文件再用，秒级；会先告诉你会影响几个作业）。
2. 命令面板 → **`Genero BDL: 数据库字段：从 CSV 导入`** → 选表字段 CSV → 同样先**预演**（列出新增/变更/未变/保留几张表）再确认导入。
3. 打开侧边栏的 **「链接资料」** 与 **「数据库字段」**，能看到树。

> 两个导入都会先 `-dry-run` 预演、把统计摆出来让你确认，才会写盘；写盘时可以点进度通知上的**取消**。

> 📷 **配图位 G6**：`docs/images/guide/06-import-csv.png`
> 拍什么：执行"链接资料：从 CSV 导入"后的确认对话框（显示"受影响作业 N 个"或统计），加一条进度通知。
>
> 📷 **配图位 G7**：`docs/images/guide/07-schema-view.png`
> 拍什么：侧边栏「数据库字段」视图——顶部"共 N 张表"、展开一张表看到 `列名 · 类型(长度) · 中文说明`，
> 最好附一个悬停 `DEFINE f LIKE t.col` 显示中文说明的截图。

### 2.3 也可以用终端（适合脚本/CI）

```bash
# 这两条命令来自 tiptop（与 bdl-lsp 分离的独立工具；平台安装包里也内置了它）
tiptop link import   -csv gal_file.csv   -root <项目根>
tiptop schema import -csv gal_schema.csv -root <项目根>
tiptop link status   -root <项目根>        # 看链数/文件数/生成时间
tiptop schema status -root <项目根>        # 看表数/列数/导入时间
```

本地编译的二进制在 `bdl-lsp/artifacts/bin/`、`tiptop/artifacts/bin/`；
插件里也可以用 `bdl.tools.path` 指到你自己的 `tiptop`。

### 2.4 打开开关（这一步别忘）

导入完资料后，在设置里打开两个总开关，视图与命令才会出现：

```jsonc
{
  "bdl.link.enable": true,      // 链接资料：跨模块可见性 + 链接视图 + 反查
  "bdl.schema.enable": true     // 数据库字段：悬停中文说明 + 成员校验
}
```

> 资料落在 `<项目>/.project/`（`links.jsonl`、`tables.json`、`tables/<表>.json`）。
> 它是一份**快照**：不想要了直接删掉；想更新就再导出一次、再执行一次导入。
> **不会有"资料已过期"的提示**——什么时候更新完全由你决定。

### 2.5 模式 ② 新增的能力

- **`function-not-found`**：调用一个函数，若在本文件/GLOBALS/链接文件/全局模组（`sub`/`lib`/`qry`）里都找不到才报；
  没有链接资料时这项**完全不产生诊断**（宁可漏报，不可误报）。
- **链接资料视图**：当前程序属于哪条链、链内文件（点击跳转）、全局模组；程序被谁引用（**反查引用程序**，结果多时分页）。
- **数据库字段**：悬停 `LIKE t.col` → `t.col · VARCHAR2(40) · 料件编号`；`RECORD LIKE t.*` → 列出该表字段（超 20 行折叠）；`rec.` 补全带类型与中文说明。
- **记录成员校验**（可选）：把 `bdl.diagnostics.record-member-unknown` 设为 `warning`，就能查出 `rec.bad_member` 这类拼错的成员。

---

## 3. 模式 ① 全功能：配置账号密码，从数据库同步 + 部署

**目标**：一次配置，之后在 VSCode 里点一下就把资料更新到最新；顺便把"上传 + 远程编译"也一起做了。

### 3.1 配置数据库（生产环境）

设置里搜 **`Genero BDL: 生产环境`**，填四项：

| 设置 | 例子 | 说明 |
|---|---|---|
| `bdl.prod.oracle.host` | `db.example.com` | 主机 |
| `bdl.prod.oracle.port` | `1521` | 端口（默认） |
| `bdl.prod.oracle.service` | `PROD` | 服务名 |
| `bdl.prod.oracle.user` | `readonly` | **只读账号** |

> ⚠️ **这些值只写在 Workspace 设置里**，并且**不要让 `settings.json` 进 git 管理**——
> 主机名与账号也算敏感信息。部署配置 `.project/deploy.json` 同理。

**密码不放在设置里**，二选一：

```bash
# 方式 1：环境变量（推荐，CI/多机通用）
export BDL_ORA_PASSWORD='<密码>'      # Windows: setx BDL_ORA_PASSWORD "..."

# 方式 2：项目里的 secrets.json（unix 必须 chmod 600）
#   <项目>/.project/secrets.json
#   {"readonly": "<密码>", "*": "<默认密码>"}
chmod 600 <项目>/.project/secrets.json
```

> 📷 **配图位 G8**：`docs/images/guide/08-oracle-settings.png`
> 拍什么：设置页 `Genero BDL: 生产环境` 四项已填（**主机名/账号打码**），
> 并显示那句"只写 Workspace、不要让 settings.json 进 git"的说明文字。

### 3.2 一键同步（链接资料 + 表字段）

| 命令 | 做什么 |
|---|---|
| `Genero BDL: 链接资料：全量更新` | 直连 Oracle 查 DS.GAL_FILE，重算全部链接链（先预演再确认） |
| `Genero BDL: 链接资料：更新当前文件` | 只重算**当前文件**涉及的作业（秒级；会先告诉你会影响几个作业） |
| `Genero BDL: 链接资料：按模组更新` | 只更新 `lib`/`sub`/`qry` 等你选的模组 |
| `Genero BDL: 数据库字段：从数据库同步` | 查 `ALL_TAB_COLUMNS` + `ALL_COL_COMMENTS`，同步表字段资料 |
| `Genero BDL: 链接资料：查看状态` | 链数/文件数/生成时间/来源 |

**进度**：每次同步都会弹出进度通知，能看清"卡在哪一步"、并且可以取消：

```text
采集：连接 db.example.com:1521/PROD（owner=APP）…
采集：已收到 12000 行
采集完成：58096 行
解析表 ima_file（12/2648）
写入完成：2648 个表文件
```

链接资料与数据库字段用**同一套**进度文案（采集 / 扫描源码 / 成链 / 写入完成）。

> 📷 **配图位 G9**：`docs/images/guide/09-sync-progress.png`
> 拍什么：一次"从数据库同步"的进度通知（显示"解析表 xxx（i/N）"）+ 输出通道里的统计。
>
> 📷 **配图位 G10**：`docs/images/guide/10-schema-multi-select.png`
> 拍什么：侧边栏勾选两张表（复选框）+ 标题栏"已勾选 2 张"+ 执行"同步已选中的表"的确认框。

数据库字段视图还有几种更新粒度，按需选：

| 想更新 | 用哪个 |
|---|---|
| 一张表 | 表上**右键 → 同步选中的表** |
| 几张表 | **勾选复选框** → `数据库字段：同步已选中的表` |
| 一批（按正则筛出来的） | 先用 `数据库字段：正则过滤表名`（如 `^IMA_`），再 `数据库字段：同步当前筛选结果` |
| 全部 | `数据库字段：从数据库同步`（顺带清理本地多出来的表） |

### 3.3 部署：上传源码 + 远程编译

1. 打开总开关 `bdl.deploy.enable`；
2. 在 **`Genero BDL: 生产环境`** 里填部署目标：`bdl.prod.deploy.host` / `port`(默认 22) / `user` / `remoteRoot`（远程工作根，如 `/home/apps/tiptop`），
   可选：`localRoot`、`transport`(rsync/scp)、`fallback`、`delete`、`include`/`exclude`、`strictHostKey`、`compile4gl`/`compilePer`；
3. **不用手写 JSON**：每次部署前插件会把上述设置合成为 `<项目>/.project/deploy.json`（文件里带 `createdBy` 标记），
   再交给 `tiptop deploy`；如果你之前手写过一个 `deploy.json`，第一次覆盖前会备份成 `deploy.json.bak`；
4. 然后用命令：`部署预演（不上传）` → 看计划 → `部署当前文件并编译` / `部署到远程服务器并编译`。
   远端编译结果会以诊断形式回到 Problems 面板。

> 📷 **配图位 G11**：`docs/images/guide/11-deploy.png`
> 拍什么：部署预演的输出（列出要上传/编译的文件）+ 部署完成后的输出摘要。

### 3.4 安全清单（务必看一眼）

- [ ] 数据库账号是**只读**账号；
- [ ] 密码只在环境变量或 `<项目>/.project/secrets.json`（`chmod 600`），**从不写进设置**；
- [ ] 生产环境相关的设置只写 **Workspace**，`settings.json` 不进 git；
- [ ] 部署配置 `.project/deploy.json` 由插件生成，同样**不要提交**；
- [ ] 团队共享的话，提交导出的 CSV 资料（模式 ②）比提交账号安全得多。

---

## 4. 怎么选？三句话

- **只是看/改代码** → 模式 ③（默认，什么都不用做）。
- **公司不让连库，或者只想离线** → 模式 ②（让 DBA 导两份 CSV，导入即可）。
- **有只读账号、想让资料一直新、还要部署** → 模式 ①。

---

## 5. 常见问题

| 现象 | 原因 / 怎么办 |
|---|---|
| 侧边栏没有「链接资料」/「数据库字段」视图，命令也搜不到 | 这两个功能**默认关闭**（轻量档）。打开 `bdl.link.enable` / `bdl.schema.enable` 后视图与命令才出现 |
| 函数调用报"找不到定义"（`function-not-found`） | 需要链接资料：模式 ② 导入 CSV，或模式 ① 从数据库同步。没有资料时这项**不报** |
| 诊断太多/太吵 | 这是**你的选择**：`bdl.diagnostics` 按码调级（`off`/`error`/`warning`/`information`/`hint`），也可以 `bdl.ignore.files` 忽略生成代码目录 |
| 打开大文件没有大纲、没有诊断 | Problems 里有 `file-too-large` / `parse-timeout` 警告 → 点**编辑器标题栏的"强制解析"**，或调大 `bdl.limits.maxFileBytes` / `maxFileLines` / `parseTimeoutMs`。强制解析**到文件关闭为止有效** |
| 表单字段明明有，却报 `field-not-in-form` | 表单不在 `<模组>/per/` 下时配 `bdl.perRoots`；确认打开的是最新 `.per`（改完 `.per` 会自动刷新引用方） |
| `RECORD LIKE t.*` 的成员校验不生效 | 需要字段资料 + 把 `bdl.diagnostics.record-member-unknown` 打开（默认 `off`），见模式 ② |
| 资料旧了要重启吗 | 不用：资料按 mtime 热加载（2 秒节流）。而且**不会有"过期"提示**——想更新就再执行一次同步 |
| 连接数据库报"缺少密码" | 设 `BDL_ORA_PASSWORD`，或写 `<项目>/.project/secrets.json`（`chmod 600`） |
| Windows 上提示 secrets.json 权限问题 | Windows 没有 unix 权限位，扩展在那边**跳过**权限校验（安全性由文件 ACL 决定） |
| 语言服务器起不来 | 命令 `显示语言服务器信息` 看二进制来源。顺序：包内置 `bin/` → `bdl.server.path` → `PATH` → 工作区 `.bdl-lsp/bin/`。用 **dev 包/源码**运行时没有内置二进制，需要自己编译或指定路径 |
| 公司网络不能上网 | 插件本身**不联网**；只有你手动点"从数据库同步/全量更新"时才连你配的那台数据库 |
| 想彻底回到零配置 | 把 `bdl.link.enable` / `bdl.deploy.enable` / `bdl.schema.enable` 关掉，删掉 `<项目>/.project/` 即可 |

---

## 6. 设置速查（共 5 组 47 个键，全部说明见[手册第 8 节](docs/USER-GUIDE.md)）

| 组 | 里面的东西 | 默认 |
|---|---|---|
| **基础** | 诊断级别 `bdl.diagnostics`、格式化 `bdl.format.*`、项目解析 `bdl.generoVersion`/`bdl.perRoots`/`bdl.globals.searchPaths`、资源限制 `bdl.limits.*`、忽略 `bdl.ignore.*`、`bdl.builtins.*`、`bdl.index.enable` | 诊断 warning；其余安全默认 |
| **生产环境** | `bdl.prod.oracle.*`（数据库连接）、`bdl.prod.deploy.*`（部署目标） | 空（不连、不提示） |
| **链接资料** | `bdl.link.enable`（**默认关**）、`bdl.link.dataDir`（`.project`）、`bdl.link.moduleRoots`、`bdl.link.globalModules` | 关闭 |
| **部署** | `bdl.deploy.enable`（**默认关**）、`bdl.deploy.target` | 关闭 |
| **数据库字段** | `bdl.schema.enable`（**默认关**）、`bdl.schema.dataDir`（`.project/.schema`） | 关闭 |

最常用的几个：

```jsonc
{
  // 一键切换三档
  "bdl.link.enable": false,
  "bdl.schema.enable": false,
  "bdl.deploy.enable": false,

  // 诊断按码调级（唯一入口）
  "bdl.diagnostics": { "record-member-unknown": "warning", "file-too-large": "warning" },

  // 大文件/慢机器
  "bdl.limits.maxFileBytes": 2097152,
  "bdl.limits.maxFileLines": 20000,
  "bdl.limits.parseTimeoutMs": 2000
}
```

---

## 7. 命令速查

| 命令 | 用在哪一档 | 说明 |
|---|---|---|
| `重启语言服务器` / `显示语言服务器信息` / `显示输出` | 全部 | 排障三件套 |
| `强制解析当前文件` | 全部 | 大文件被跳过时，标题栏出现按钮 |
| `链接资料：从 CSV 导入` | ② ① | 选 CSV → 复制到 `.project/gal_file.csv` → 预演确认后导入 |
| `链接资料：全量更新` / `按模组更新` / `更新当前文件` | ①（已配库）；② 有 CSV 时也可 | 只重算受影响的部分，其余链保留 |
| `链接资料：查看状态` | ①② | 链数/文件数/生成时间 |
| `重新同步` | ①② | 链接视图里"反查引用程序"旁的按钮，等同"更新当前文件" |
| `反查引用程序` / `显示更多反查结果` / `刷新` | ①② | 链接资料视图 |
| `迁移链接资料目录` | ①② | 旧项目资料还在 `.link/` 时一键搬到 `.project/` |
| `数据库字段：从 CSV 导入` | ② | 表字段 CSV → `.project/.schema` |
| `数据库字段：从数据库同步` | ① | 直连库全量同步 |
| `数据库字段：同步选中的表` / `同步已选中的表` / `同步当前筛选结果` / `全选当前列表` / `清除勾选` | ①② | 一张 / 多张 / 筛选结果批量 |
| `数据库字段：正则过滤表名` / `清除过滤` / `刷新` | ①② | 视图顶部查询框 |
| `数据库字段：复制列定义` / `打开表资料文件` | ①② | 得到 `LIKE 表.列` / 打开该表 JSON |
| `部署预演（不上传）` / `部署当前文件并编译` / `部署到远程服务器并编译` / `列出部署目标` | ①（打开 `bdl.deploy.enable`） | 由 `tiptop` 执行 |

---

## 8. 配图清单（拍好后替换本文档里的 📷 占位块）

图片放 `docs/images/guide/`，命名见下表；拍好后把占位块替换成 `![说明](docs/images/guide/文件名)`。

| 编号 | 文件 | 拍什么 | 用在哪 |
|---|---|---|---|
| G1 | `01-three-modes.png` | 三档总览（可用本节表格改图） | §0 |
| G2 | `02-install.png` | 扩展面板安装 `Genero BDL (4GL)` | §1.1 |
| G3 | `03-jump-hover.gif` | 跳转定义 + 悬停看来源 | §1.2 |
| G4 | `04-outline.png` | 大纲面板 | §1.2 |
| G5 | `05-export-csv.png` | 生产端导出的两份 CSV | §2.1 |
| G6 | `06-import-csv.png` | "从 CSV 导入"的预演确认框 | §2.2 |
| G7 | `07-schema-view.png` | 「数据库字段」视图 + 字段中文说明 | §2.2 |
| G8 | `08-oracle-settings.png` | 「生产环境」四项设置（打码） | §3.1 |
| G9 | `09-sync-progress.png` | 同步进度通知（解析表 i/N） | §3.2 |
| G10 | `10-schema-multi-select.png` | 勾选多张表 + 批量同步 | §3.2 |
| G11 | `11-deploy.png` | 部署预演与结果 | §3.3 |

> 素材规范（宽高、打码要求）见 [`docs/images/guide/README.md`](docs/images/guide/README.md)；
> 详细手册的截图清单在 [`docs/images/vscode/README.md`](docs/images/vscode/README.md)。

---

## 9. 更多文档

| 文档 | 内容 |
|---|---|
| [完整操作手册](docs/USER-GUIDE.md) | 每个功能的细节、诊断码表、全部设置、排错 |
| [生产环境建工作区](docs/PROJECT-SETUP.md) | 从生产端打包源码、Git 管理、部署测试、secrets 权限 |
| [诊断码清单（bdl-lsp 仓库）](https://github.com/darcyjoven/bdl-lsp/blob/main/docs/DIAGNOSTICS.md) | 14 个诊断码与默认级别 |
| [tiptop（采集与部署工具）](https://github.com/darcyjoven/tiptop) | `link import/sync/status`、`schema import/sync/status`、`deploy` |

## 10. 本地开发

```bash
npm install
npm run typecheck        # 类型检查
npm run build            # 打 bundle（esbuild）
npm run package          # 打 VSIX（平台包内置 bdl-lsp / tiptop，需要先构建它们）
npm run test:e2e         # 无头 VSCode 端到端测试（45 个用例）
```

- 仓库只保留 VSCode 交付物；**计划、待办、测试脚本、过程记录都在 `bdl-lsp` 仓库**；
- 语言服务器与 CLI 在 `bdl-lsp`，采集/部署工具在 `tiptop`，语法在 `tree-sitter-bdl` / `tree-sitter-per`。

## 许可

MIT（见仓库 `LICENSE`）。