# Genero BDL (4GL) for VSCode

Genero BDL（`.4gl` / `.global`）与 Form（`.per`）的语言支持：**语法高亮、定义/引用跳转、符号大纲、悬停、补全、格式化、语法诊断**，
需要时再叠加**跨模块函数可见性**、**数据库字段说明**与**远程部署**。

> 适用扩展 `0.6.x`（扩展 id `darcyjoven.4gl-full`，市场里的名字是 `Genero BDL (4GL)`），
> 语言服务器 `bdl-lsp 0.3.x`、工具 `tiptop 0.1.x`。
> 本文是**唯一一份面向使用者的引导文档**，**按使用顺序组织**：
> **第 1 章**从生产服务器初始化项目（VSCode 里跑 / 终端里跑两种方式）→ **第 2 章**初始化链接资料与数据库字段 →
> **第 3 章**上传、编译、链接、测试程序；**第 4 章起**才是功能详解、全部设置、常见问题与附录。
> 命令都可以直接复制执行，方括号 `<>` 里的内容按实际替换。遇到问题先看[常见问题](#14-常见问题)，
> 再用「显示语言服务器信息」收集日志（信息打开后可点「打开日志」）。

## 目录

1. [初始化项目（从生产服务器拉取代码）](#1-初始化项目从生产服务器拉取代码)
2. [初始化资料：链接资料 + 数据库字段](#2-初始化资料链接资料--数据库字段)
3. [上传、编译、链接与测试程序](#3-上传编译链接与测试程序)
4. [这是什么扩展](#4-这是什么扩展)
5. [安装](#5-安装)
6. [三种用法：三档模型](#6-三种用法三档模型)
7. [快速开始与 30 秒自检](#7-快速开始与-30-秒自检)
8. [功能详解](#8-功能详解)
9. [诊断与检查](#9-诊断与检查)
10. [表单 .per、GLOBALS 与数据库字段资料](#10-表单-perglobals-与数据库字段资料)
11. [链接资料](#11-链接资料)
12. [部署](#12-部署)
13. [配置说明（3 组 49 键）](#13-配置说明3-组-49-键)
14. [常见问题](#14-常见问题)
15. [附录 A：从生产端搭建工作区](#附录-a从生产端搭建工作区)
16. [附录 B：配图与录屏清单](#附录-b配图与录屏清单)
17. [附录 C：本地开发与许可](#附录-c本地开发与许可)
18. [更多文档](#更多文档)
---

## 1. 初始化项目（从生产服务器拉取代码）

**目标**：把生产端 `/u1/topprod` 下的 `*.4gl` / `*.per` / `*.global` 拉到本地，变成一个带 git 的工程。

**前置条件**

| # | 条件 | 说明 |
|---|---|---|
| 1 | 能 SSH 到生产服务器 | **有密钥最好**；本阶段没配密钥也可以，过程中会提示输入密码（见 [§1.3](#13-没配密钥可以过程中输入密码)） |
| 2 | 本地工具 | VSCode 方式需要先装扩展（见 [§5 安装](#5-安装)）；终端方式需要 `git` + `ssh`（Linux/WSL 还要 `rsync`；Windows 自带 `ssh`/`scp`/`tar`） |
| 3 | 生产根路径 | 默认 `/u1/topprod`；只取它下面的 `*.4gl` / `*.per` / `*.global` |

支持两种运行方式，二选一即可。

### 1.1 方式一：在 VSCode 里运行（推荐）

命令面板（`Ctrl/Cmd+Shift+P`）→ **`Genero BDL: 初始化项目（从生产服务器拉取代码）`**，然后按向导走：

| 步骤 | 要填什么 |
|---|---|
| 1/4 用哪个脚本 | **自动**（Windows → PowerShell 脚本；Linux/WSL/**Remote-WSL** → bash 脚本），也可强制选某一个 |
| 2/4 SSH 目标 | `user@host`，或 `~/.ssh/config` 里的**别名**（端口/密钥写在 ssh config 里最省事） |
| 3/4 生产根目录 | 默认 `/u1/topprod` |
| 4/4 目标目录 | 默认**当前工作区**，也可以选别的文件夹 |
| 选项（多选） | 增量更新、删除本地多余、不自动提交、只预演；**允许在过程中输入密码**（默认勾选） |
| 源编码 | 自动（按服务器样本检测并在终端里问你）/ GBK / BIG5 / 不转码 |
| 登录区域（仅 PowerShell 流程） | 登录后要输入的「区」（1/2/3/4，预填 `1`）；**留空 = 不输入**（服务器没这个菜单时） |

确认后命令会**打开集成终端执行**脚本：进度、编码报告、删除确认都在终端里完成；命令行同时写进「Genero BDL 任务」输出通道，方便复制重跑。
上次填过的 SSH 目标/生产根/目标目录会**自动预填**（只存在本机 workspaceState，不含密码）。

### 1.2 方式二：在终端里运行

**Linux / WSL（rsync 拉取，增量最快）**

```bash
# 在 vscode-bdl 仓库里（或把 scripts/init-project/ 拷到任意位置）
scripts/init-project/init-project.sh \
  -t tiptop@erp.example.com \
  -r /u1/topprod \
  -d ~/projects/topprod \
  --update --from-encoding gbk
```

**Windows（生产端 tar 打包 → scp 回本地 → 解压 → 清理两端中间文件）**

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\init-project\init-project.ps1 `
  -Target tiptop@erp.example.com -RemoteRoot /u1/topprod -Dest C:\projects\topprod `
  -Update -FromEncoding gbk
```

常用参数（两端同名）：

| 用途 | Linux / WSL | Windows |
|---|---|---|
| 先空跑看计划（不写盘） | `--dry-run` | `-DryRun` |
| 只看服务器上会执行什么（审计） | `--print-remote` | `-PrintRemote` |
| 增量更新（目标已存在时必须给） | `--update` | `-Update` |
| 删除本地多余的源文件（默认**不删**，会先列清单确认） | `--delete` | `-Delete` |
| 只取某些模组 | `--module topcust,other` | `-Module topcust,other` |
| 跳过编码询问 | `--from-encoding gbk` | `-FromEncoding gbk` |
| 没配密钥时用密码登录 | `--ask-password` | `-AskPassword` |
| 登录后要先选「区」（1-4，默认 1；空 = 不输入） | —（rsync 不需要） | `-Region 1` |

> 对生产端只做**只读**操作：Linux 是"只读 find + rsync 拉取"；Windows 是"只读 find + 一次 tar 打包到 `/u1/out`（用完即删）"。
> 两者都不会调用上传/部署，也不修改生产端项目树。用 `--print-remote` 可以逐条审计。

### 1.3 没配密钥？可以过程中输入密码

- **有密钥**：优先用密钥/agent，不会提示密码。
- **没配密钥**：脚本先试一次密钥；失败且在终端里时会问
  `密钥登录失败。改用密码登录？（只有本初始化脚本允许；上传/编译仍需密钥）`，答 `y` 即可；
  加 `--ask-password`（Windows `-AskPassword`）可跳过这次询问。
- 密码**由 ssh 自己在终端提示**输入：不保存、不写日志、不进命令行；密码模式下每步远端操作都会再提示一次。
- ⚠️ **上传/编译仍然只支持密钥**（按既定决定）：没密钥时可以先初始化项目，但用不了上传/编译。

### 1.4 拉下来之后（脚本已经替你做好）

- 目录结构与生产端一致（`<模组>/4gl/xxx.4gl`、`<模组>/per/xxx.per`…）；
- `git init -b main` + 自动提交（`chore: 从 <host>:<root> 初始化/更新生产代码镜像`）；
- 生成 `.gitignore`、`.gitattributes`、`.editorconfig`、`.vscode/settings.example.json`、`README-PROJECT.md`（来源说明 + 重新初始化命令）；
- **换行固定为 LF**：`*.4gl/*.per/*.global` 全部 `text eol=lf`，仓库配置 `core.autocrlf=false` + `core.eol=lf`，所以在 Windows 上改完**不会**产生空白符差异；
- 跑完会打印校验：`git ls-files --eol` 应全是 `i/lf w/lf`，`git diff --check` 无告警。

接下来：

```bash
cd ~/projects/topprod
git log --oneline -1                     # 看初始化提交
cp .vscode/settings.example.json .vscode/settings.json   # 填 Oracle / 生产服务器（见第 2、3 章）
```

### 1.5 初始化常见问题

| 现象 | 处理 |
|---|---|
| `no matching host key type / kex`（老服务器） | 脚本会自动按 `ssh-rsa`/SHA-1 兼容重试；也可显式 `--legacy-ssh` / `-LegacySsh` |
| `Permission denied (publickey)` | 没配密钥：脚本会问是否改用密码登录（或加 `--ask-password`）；上传/编译必须先配密钥 |
| 中文乱码 | 先用 `--dry-run`/`-DryRun` 看编码报告（含候选与预览），再用 `--from-encoding big5` 重跑 |
| 提示"目标已存在" | 二次拉取要加 `--update`/`-Update` |
| 远端 `/u1/out` 里有残留包 | 上次被强杀（清理没跑到），删掉即可；脚本每次用唯一名，不会冲突 |
| Windows 组策略禁止脚本 | 改用终端：把命令面板写进输出通道的那行命令复制到终端执行 |

---

## 2. 初始化资料：链接资料 + 数据库字段

**目标**：让"跨模块函数跳转/链接资料视图/反查引用"与"字段中文说明 / `LIKE t.*` 成员校验 / 列补全"可用。
两份资料互相独立，可以只做一份，建议两份都做。

### 2.1 先打开两个模式（默认都是关的）

设置面板「**账号、生产环境、配置**」里：

| 设置 | 取值 | 含义 |
|---|---|---|
| `bdl.link.mode` | `file` / `db` | `file`=只用 CSV 导入；`db`=可以连数据库同步/更新；`off`=不启用（默认） |
| `bdl.schema.mode` | `file` / `db` | 同上，作用于数据库字段 |

打开后侧边栏才会出现「链接资料」「数据库字段」视图，命令面板里也才会出现对应命令（见 [§13.2](#132-模式与总开关)）。

### 2.2 方式 A：CSV 导入（不连数据库，建议先走这条）

1. 找 DBA 导出两份 CSV：链接资料（`DS.GAL_FILE`）与表字段（含 `column_desc` 中文说明）；
2. VSCode 命令：
   - **`链接资料：从 CSV 导入`** → 选 CSV → 复制到 `<项目>/.project/link/gal_file.csv` → 全量导入；
   - **`数据库字段：从 CSV 导入`** → 选表字段 CSV → 导入到 `<项目>/.project/schema`；
3. 终端等价命令：

```bash
tiptop link import   -csv gal_file.csv   -root .
tiptop schema import -csv gal_schema.csv -root .
```

### 2.3 方式 B：直连数据库同步

1. 在「**账号、生产环境、配置**」里填 Oracle：`host` / `port`(1521) / `service` / `user`；
   - `user` 用**应用 schema 账号**（字段资料的默认 SQL 走 `USER_TAB_COLUMNS` + TiTop 字典 `DS.ZTA_FILE`/`DS.GAQ_FILE`，需要账号自己拥有这些表并能读字典表）；
   - **密码不写进设置**：放 `<项目>/.project/secrets.json`（`chmod 600`），或用环境变量 `BDL_ORA_PASSWORD`（见 [§11.5](#115-直连数据库采集生产环境设置与密码)）。
2. VSCode 命令：
   - **`链接资料：全量更新`**（第一次）/ **`链接资料：从数据库更新`**（以后只改了几个文件）；
   - **`数据库字段：从数据库同步`**（全量，顺带 `-prune` 清理本地多出的表）。
3. 终端等价命令：

```bash
BDL_ORA_PASSWORD=... tiptop link   sync -root . -source golang -host <主机> -service <服务名> -user <账号>
BDL_ORA_PASSWORD=... tiptop schema sync -root . -host <主机> -service <服务名> -user <账号> \
  -batch-size 200 -timeout 120
```

> 字段同步是**分批查询**的（默认每批 200 张表、单批超时 120 秒），慢链路上不会因为"一条大查询超时"失败。
> 要调：设置 `bdl.schema.batchSize` / `bdl.schema.timeoutSec`。列说明来自 TiTop 字典 `DS.GAQ_FILE.gaq03`，
> **不是** Oracle 备注；字典表不存在时会提示改用 CSV 导入。

### 2.4 自检（30 秒）

```bash
tiptop link   status -root .    # 链数 / 文件数 / 生成时间
tiptop schema status -root .    # 表数 / 列数 / 导入时间
```

- 侧边栏「链接资料」能展开出 程序 → 链 → 文件；
- 侧边栏「数据库字段」首行显示"共 N 张表"，展开某表能看到 `列名 · 类型(长度) · 中文说明`；
- 编辑器里：跨模块函数能跳转；悬停 `LIKE 表.列` 会多出一段"字段资料：…"。

### 2.5 资料常见问题

| 现象 | 处理 |
|---|---|
| 视图/命令不出现 | 两个 `mode` 还是 `off`；改成 `file` 或 `db` |
| `tiptop link status` 显示"链 0" | CSV 选错了或表头不对；重新导出/导入 |
| 字段几乎没有中文说明 | 说明来自 TiTop 字典：确认账号是应用 schema 账号且能读 `DS.ZTA_FILE` / `DS.GAQ_FILE` |
| 同步报 `ORA-01013`（查询被取消） | 单批超时：调小 `bdl.schema.batchSize` 或加大 `bdl.schema.timeoutSec` |
| 提示缺少密码 | 配 `.project/secrets.json` 或 `BDL_ORA_PASSWORD`（见 [§11.5](#115-直连数据库采集生产环境设置与密码)） |

---

## 3. 上传、编译、链接与测试程序

**目标**：改完代码 → 传到生产服务器 → 在生产端编译/链接/预览，验证改动没把程序改坏。

> 关键点：**编译/链接/预览不在本机执行**（开发机没有 Genero 环境），而是由 `tiptop exec` 通过 ssh 在**生产服务器**上跑；
> 而**上传不会自动发生**——要先上传，再编译。

### 3.1 三个开关与配置

| 设置位置 | 设置 | 值 |
|---|---|---|
| 上传编译链接 | `bdl.deploy.enable` | `true`（总开关，默认关） |
| 上传编译链接 | `bdl.prod.deploy.transport` | `rsync`（主，失败退 scp）或 `scp` |
| 上传编译链接 | `bdl.prod.deploy.remoteRoot` | 生产根目录，如 `/u1/topprod` |
| 账号、生产环境、配置 | `bdl.prod.deploy.host` / `port` / `user` | 生产服务器 SSH（**只支持密钥，不支持密码**） |
| 上传编译链接 | `bdl.build.enable` | `true`（六条编译/链接/预览命令） |

还有六个命令模板（`bdl.build.<lang>.<mode>.command`）默认已按 TiTop 惯例填好，需要时再改，
占位符与默认值见 [§8.10](#810-编译--链接--预览在生产服务器上执行)。

### 3.2 上传当前文件

命令面板 → **`预演上传`**：只打印计划（`本地路径 → user@host:/生产根/相对路径`），不连接服务器。
确认无误后再 → **`上传当前文件`**：**只传当前打开的那一个文件**，不做批量同步。
入口有三个（同一条命令）：**命令面板**、**编辑器右上角**（打开 `.4gl`/`.global`/`.per` 时，图标在编译按钮左边）、**编辑器右键菜单**（右键里还有「预演上传」）。

⚠️ 编译/链接/预览**不会**替你上传：改完必须先「上传当前文件」，否则编译的是服务器上的旧代码。

### 3.3 编译 / 链接 / 预览（都在生产端执行）

编辑器右上角按钮（`.4gl` / `.per` 打开时出现）：

| 文件 | 命令 | 默认模板 |
|---|---|---|
| `.4gl` | `4GL：预演编译` / `4GL：编译` | `cd ${path} && r.c2 ${name}` |
| `.4gl` | `4GL：链接` | `r.l2 ${name}` |
| `.per` | `Form：预演编译` | `cd ${path} && fglform -M -W all ${fullname} && rm ${name}.42f` |
| `.per` | `Form：编译` | `cd ${path} && fglform -M -W all ${fullname} && mv ${name}.42f ../42f/ && gsform -M -W all -i -import ${fullname} && mv ${name}.4fd ../4fd/` |
| `.per` | `Form：预览画面` | `cd ${path} && r.gf ${name} 2 p` |

- 占位符：`${path}` 两层目录（`axc/4gl`）、`${fullpath}` 三层（`tiptop/axc/4gl`）、`${name}` 去扩展名、`${fullname}` 含扩展名；分隔符恒为 `/`；
- **只有 4GL「链接」会弹 `${name}` 确认框**；其余命令直接用文件名，不打断；
- 没有 `MAIN` 的文件：4GL「链接」按钮**置灰**（不会发出 ssh）；
- 输出原样进「**Genero BDL 任务**」输出通道；失败时通知里带 stderr 首行 + 「打开日志」。

### 3.4 完整走一遍（测试程序）

1. 打开要改的生产文件（如 `topcust/aap/4gl/xxx.4gl`），确认它就是生产版本；
2. 改一行 → 保存；
3. `预演上传`（可选，看路径对吗）→ `上传当前文件`；
4. `4GL：编译` → 输出里应能看到远端命令、输出与退出码；
5. `4GL：链接`（有 `MAIN` 的文件；会弹 `${name}` 确认）；
6. 表单 `.per`：`Form：编译` → `Form：预览画面`；
7. 验证没问题再 `git commit`（脚本的自动提交只在初始化/更新时发生，日常编辑由你自己提交）。

### 3.5 上传/编译常见问题

| 现象 | 处理 |
|---|---|
| 命令都看不到 | `bdl.deploy.enable` 或 `bdl.build.enable` 还是 `false`；`transport` 是 `off` |
| 提示缺配置 | 按提示补「生产服务器 host/user」与「生产根目录」；没填全时命令会说清缺哪一项 |
| 连不上（密钥） | **上传/编译不支持密码**：`ssh-copy-id` 装好公钥，或用 ssh-agent |
| 编译报错看不到细节 | 点失败通知里的**「打开日志」**（`last-run-exec.log`），或看「Genero BDL 任务」通道 |
| 改了代码但服务器上没变 | 忘了「上传当前文件」——编译前必须先上传 |
| 编译/链接命令要改脚本 | 改 `bdl.build.<lang>.<mode>.command`（模板），见 [§8.10](#810-编译--链接--预览在生产服务器上执行) |

---

## 4. 这是什么扩展

这是一个 VSCode 扩展，给 Genero BDL（4GL）与 Genero Form 项目提供**日常开发需要的语言能力**：

- 打开 `.4gl` / `.global` 就有语法高亮、语义高亮、大纲、悬停、跳转、引用、补全、格式化、语法诊断；
- 表单 `.per` 有字段校验与表单内部一致性检查；
- 需要时再叠加**跨模块函数可见性**（链接资料）、**数据库字段中文说明**（字段资料）与**远程部署**。

它由三个组件配合：

| 组件 | 职责 |
|---|---|
| **VSCode 扩展**（`4gl-full` / `darcyjoven.4gl-full`） | 编辑器里的全部功能、视图、命令、设置 |
| **`bdl-lsp`**（语言服务器） | 解析、索引、诊断、跳转/补全/悬停、字段校验 |
| **`tiptop`**（独立 CLI） | 链接资料的采集/导入、数据库字段资料的导入/同步、部署（上传 + 远程编译） |

扩展市场里搜 **`Genero BDL (4GL)`**（扩展 id `4gl-full`，发布者 `darcyjoven`）即可安装。
平台安装包**内置语言服务器与 `tiptop`**，装完就能用，不需要另外装 `bdl-lsp`。
**Zed 扩展暂不支持内置二进制，也不支持本文的部署流程。**

---

## 5. 安装

### 5.1 安装扩展

两种方式任选：

1. 在 VSCode 扩展市场（扩展面板）搜索 `Genero BDL (4GL)`（扩展 ID `darcyjoven.4gl-full`），点**安装**；
   市场会按你的系统/芯片分发对应平台包。
2. 或下载平台 `.vsix`（如 `4gl-full-0.4.0-win32-x64.vsix`），在"扩展 → … → 从 VSIX 安装"中选择该文件。

装好后：

1. 打开你的项目文件夹（`.4gl` / `.per` 所在目录）；
2. 打开任意一个 `.4gl`，右下角状态栏出现 **Genero BDL** 就绪。

> 📷 **配图位 G2**：`docs/images/guide/02-install.png`
> 拍什么：扩展面板里已安装的 `Genero BDL (4GL)`（显示版本号与"已安装"），不要露出个人账号信息。

> 📷 **截图位**：`docs/images/vscode/01-install.png`
> 建议内容：扩展市场里的安装页，能看清扩展名和"安装"按钮。

### 5.2 平台与内置语言服务器

**平台安装包已经内置 `bdl-lsp`，不需要另外安装语言服务器。** 支持：

| 平台 | 包标识 |
|---|---|
| Windows x64 | `win32-x64` |
| Linux x64 | `linux-x64` |
| macOS Intel | `darwin-x64` |
| macOS Apple Silicon | `darwin-arm64` |

验证扩展已安装：

```bash
code --list-extensions | grep -i 4gl
# 期望输出：darcyjoven.4gl-full
```

从源码运行扩展（未打包）没有内置二进制，先在 `bdl-lsp` 执行 `make build`，
或用下面的方式指定路径。

### 5.3 语言服务器查找顺序

扩展查找服务器的顺序：

1. 设置 `bdl.server.path`；
2. 环境变量 `BDL_LSP_PATH`；
3. 扩展内置 `bin/bdl-lsp`；
4. 工作区 `.bdl-lsp/bin/bdl-lsp`；
5. 系统 `PATH`。

正常安装不需要改任何路径。只有在"临时用本地构建调试"或"公司内部分发自己的二进制"时
才需要第 1/2/4 项：设置 `bdl.server.path`、设 `BDL_LSP_PATH`，或把文件放到工作区 `.bdl-lsp/bin/`。

`tiptop` 同理：优先用扩展内置 `bin/tiptop`，也可以用 `bdl.tools.path` 指向你自己的那份。

---

## 6. 三种用法：三档模型

| | ③ **轻量（默认，装完即用）** | ② **本地文件解析** | ① **全功能（账号密码）** |
|---|---|---|---|
| 适合谁 | 只想看代码、改代码 | 公司不让连库 / 拿得到导出文件 | 能申请只读库账号 |
| 需要准备什么 | **什么都不用配** | 一份 DS.GAL_FILE 导出 CSV，外加一份表字段 CSV | 数据库主机/服务名/只读账号 + 密码 |
| 得到什么 | 高亮、跳转、引用、大纲、悬停、补全、格式化、语法诊断、表单字段校验 | 再加：跨模块函数可见性、链接资料视图与反查引用、字段中文说明、记录成员校验 | 再加：**从数据库一键同步**（链接资料 + 表字段）、**单文件上传 + 生产端编译/链接/预览** |
| 敏感信息 | 不碰 | 不碰（只有导出文件） | 账号写在 **Workspace 设置**，**密码不进设置** |
| 会不会往项目里写文件 | **不会** | 会（写 `<项目>/.project/{link,schema}/`） | 会（写 `<项目>/.project/{link,schema,deploy}/`） |
| 会不会连网/连库 | 不会 | 不会 | 只在你点命令时连一次 |

> 📷 **配图位 G1**：`docs/images/guide/01-three-modes.png`
> 拍什么：一张总览图——左侧"轻量档"（只有编辑器界面），中间"本地文件档"（导出 CSV 拖进项目），
> 右侧"全功能档"（设置里填了主机/账号、点了"从数据库同步"）。也可以直接截本节的表格。

**三档是叠加关系，不是三选一选到底**：任何一档都可以随时升级，只改设置、不改代码、不用重装。

怎么选？三句话：

- **只是看/改代码** → 模式 ③（默认，什么都不用做）。
- **公司不让连库，或者只想离线** → 模式 ②（让 DBA 导两份 CSV，导入即可）。
- **有只读账号、想让资料一直新、还要部署** → 模式 ①。

---

## 7. 快速开始与 30 秒自检

### 7.1 打开项目

用 VSCode 打开**项目根目录**（通常是含 `.4gl` / `.per` 和 `.bdl-lsp/` 的那一层），不要只打开单个文件。
工作区根决定：

- `.bdl-lsp/config.json`、`.project/deploy/deploy.json` 从哪里读；
- 链接资料、schema、表单在哪个范围里查找；
- 哪些文件进入工作区索引。

打开后右下角会出现 BDL 语言模式。第一次索引大项目通常要几分钟、也可能更长（几千个 `.4gl`），
状态栏和"输出 → BDL Language Server"会显示进度。

> 📷 **截图位**：`docs/images/vscode/02-first-open.png`
> 建议内容：打开项目后的 Problems 面板 + 状态栏语言模式。

### 7.2 30 秒自检

命令面板（`Ctrl/Cmd+Shift+P`）运行 **`Genero BDL: 显示语言服务器信息`**：确认二进制路径、版本、当前设置。
如果这里解析失败，先解决二进制路径，后面的功能都不会工作（查找顺序见 §5.3）。

- 打开一个 `.4gl`，`Ctrl+Shift+P` 执行 **`Genero BDL: 显示语言服务器信息`**，
  能看到版本、二进制来源、当前设置 → 说明语言服务器在跑；
- `Ctrl+Shift+O` 能列出函数 → 解析正常；
- 故意把 `END IF` 删掉 → Problems 里出现语法错误 → 诊断正常。

排障用的另一条命令：

- **`Genero BDL: 重启语言服务器`**：改完路径、升级二进制、或改完项目配置文件后使用。

> 看服务器日志：`Genero BDL: 显示语言服务器信息` 打开信息后点通知上的**「打开日志」**，
> 或直接看「Genero BDL」输出通道（原来的「显示输出」命令已合并进来）。

### 7.3 轻量档（默认）直接可用

装完不改任何设置，就能用：语法高亮、语义高亮、大纲/面包屑、定义跳转、引用查找、悬停、补全、
格式化、语法诊断、表单字段校验、GLOBALS 跨文件、快速修复。逐项用法见 [§8 功能详解](#8-功能详解)。

### 7.4 轻量档**不会**做的事（有意为之）

- **不连数据库、不连网**；没有任何后台任务、没有定时器；
- **不往你的项目里写文件**（连日志都写在 VSCode 的全局日志目录）；
- **不弹"请先配置 XXX"**：没配好之前，相关命令和视图**直接隐藏**，而不是点了再报错。

这就是默认行为。所以你装上之后看到"没有链接资料视图""没有那些命令"是正常的——
按 [§10](#10-表单-perglobals-与数据库字段资料) / [§11](#11-链接资料) / [§12](#12-部署) 打开对应开关，它们才会出现。

---

## 8. 功能详解

### 8.1 能力总览

| 能力 | 触发方式 | 说明 | 档 |
|---|---|---|---|
| 语法高亮 | 打开文件 | `.4gl` / `.global` / `.per` 静态高亮 | ③ |
| 语义高亮 | 自动 | 变量、函数、参数按语义着色（VSCode 专属） | ③ |
| 语法/语义诊断 | 打开、编辑、保存 | Problems 面板显示；见 [§9](#9-诊断与检查) | ③ |
| 悬停 | 鼠标停留 | 变量来源、定义位置、函数信息 | ③ |
| 跳转定义 | `F12` / `Ctrl+Click` | 当前文件、GLOBALS、链接资料 | ③ |
| 查找引用 | `Shift+F12` | 当前工作区可解析的引用（自动排除注释与字符串） | ③ |
| 补全 | 输入时 / `Ctrl+Space` | 关键字、变量、函数、表名等 | ③ |
| 重命名 | `F2` | **只改当前文件**，不会跨文件重命名 | ③ |
| 快速修复 | `Ctrl+.` | 目前只有"字段名写错"的修复 | ③ |
| 格式化 | `Shift+Alt+F` | 只支持 `.4gl` / `.global`，跳过 `.per` | ③ |
| 大纲/面包屑 | 自动 / `Ctrl+Shift+O` | MAIN / FUNCTION / REPORT / DEFINE / RECORD / SCREEN RECORD 等符号 | ③ |
| 表单字段校验 | 打开 `.4gl` | `INPUT … FROM f01` 里的字段在 `.per` 里不存在 → `field-not-in-form` + Quick Fix | ③ |
| GLOBALS 跨文件 | 自动 | 项目里有 `.global` 就自动生效：全局变量的跳转与来源标注 | ③ |
| 链接资料视图 | 侧边栏"链接资料" | 查看程序引用关系、反查引用程序（VSCode 专属） | ②① |
| 数据库字段 | 侧边栏"数据库字段" | 悬停字段中文说明、`RECORD LIKE t.*` 成员校验 | ②① |
| 编译/链接/预览 | 编辑器右上角按钮 / 命令面板 | `.4gl` 预演编译/编译/链接、`.per` 预演编译/编译/预览画面；命令在**生产服务器**上执行，模板可自定义（需先上传文件） | ③ |
| 部署 | 命令面板 | 上传 + 远程编译；见 [§12](#12-部署) | ① |

> 说明：扩展**不做类型检查、不做赋值兼容性检查，也不做跨文件重命名**。
> 变量检查只回答"这个名字有没有来源"，函数检查只回答"这个名字有没有定义"。

### 8.2 语法高亮与语义高亮

- 语法高亮：打开 `.4gl` / `.global` / `.per` 就有；关键字、函数名、字段访问、注释、字符串都有区分。
- 语义高亮：变量、函数、参数按语义着色（VSCode 专属），自动生效，不需要配置。

### 8.3 大纲与面包屑

左侧"大纲"面板或 `Ctrl+Shift+O` 可以列出：MAIN / FUNCTION / REPORT / DEFINE / RECORD / SCREEN RECORD。

> 📷 **配图位 G4**：`docs/images/guide/04-outline.png`
> 拍什么：大纲面板展开一个 `.4gl`（能看到 MAIN / FUNCTION / DEFINE 层级）。

### 8.4 悬停与跳转

把鼠标放在变量、函数、GLOBALS 符号或表单字段上：

- 悬停显示来源（局部变量、模块变量、GLOBALS、内置符号、链接资料等）、种类、类型、签名、字段数；
  内置函数还会给 Genero 签名与出处；
- `F12` 跳到定义；`Ctrl+Click` 同效：`CALL foo` → `FUNCTION foo`；`rec.field` → 记录字段；
- `Shift+F12` 查引用：列出所有引用（自动排除注释与字符串）；
- 跳转结果可能跨文件，返回用 VSCode 的"后退"。

> 📷 **配图位 G3**：`docs/images/guide/03-jump-hover.gif`
> 拍什么：在一个函数名上 `F12` 跳到定义，再悬停一个变量看来源（10 秒内，两三个动作）。

> 🎬 **录屏位**：`docs/images/vscode/03-hover.gif`
> 建议内容：悬停一个来自 GLOBALS 的变量，显示来源，再按 F12 跳过去。

### 8.5 查找引用

`Shift+F12` 列出当前工作区可解析的引用（自动排除注释与字符串）。
配置了链接资料后，还可以从当前符号**反查调用方**（见 [§11](#11-链接资料)）。

### 8.6 补全

在语句位置输入关键字、变量名或函数名，或按 `Ctrl+Space` 手动触发。
补全会结合当前文件符号、GLOBALS、内置符号表、表单字段与关键字；配置了链接资料后，
还能补全可用的模组函数；配置了字段资料后，`rec.` 补全会带上每列的类型与中文说明。

> 🎬 **录屏位**：`docs/images/vscode/04-completion.gif`
> 建议内容：输入 `DIS` 后出现 `DISPLAY`，再输入一个函数名前缀。

### 8.7 重命名

`F2` 重命名**当前文件内**的符号；不会改其他文件，也不会改字符串里的名字。
重命名会同时改调用处，但**不跨文件**。

### 8.8 快速修复

`Ctrl+.` 打开快速修复。目前只对"字段不在表单里"提供改名字段之类的建议：
字段拼错 → 一键改成表单里的正确字段。

### 8.9 格式化

`Shift+Alt+F` 或"格式化文档"。可用设置：

```jsonc
{
  "bdl.format.keywords": "unchanged", // unchanged / upper / lower（lower 时补全也给小写）
  "bdl.format.indentStyle": "auto",   // auto / tab / space
  "bdl.format.indentSize": 0          // 0 表示按原文件推断
}
```

`.per` 文件不做格式化，这是有意为之：表单布局的空白有语义，自动改容易破坏界面。

> 🎬 **录屏位**：`docs/images/vscode/05-format.gif`
> 建议内容：选中一段缩进混乱的 4GL，执行格式化，展示前后对比。

> 操作流程见第 3 章；这里只列模板与占位符细节。
### 8.10 编译 / 链接 / 预览（在生产服务器上执行）

编辑器**右上角有 3 个按钮**（命令面板里同名命令也能用）。这些命令
**不在本机执行**——开发机没有 Genero 环境，插件把命令交给 `tiptop exec`，
通过 ssh 在**生产根目录**下运行你们自己的脚本：

> **先上传再编译**：上传是**单独的动作**（`上传当前文件`），插件**不会自动上传**。
> 流程是：改完文件 → 保存 → 点「上传当前文件」→ 再点「4GL：编译 / 链接 / 预览画面」。
> 图标：预演编译 `$(beaker)`、编译 `$(play)`、链接 `$(link)`、Form 预览 `$(eye)`。

| 文件 | 三种方式 | 默认命令 |
|---|---|---|
| `.4gl` | 预演编译 / 编译 | `cd ${path} && r.c2 ${name}` |
| `.4gl` | 链接 | `r.l2 ${name}` |
| `.per` | 预演编译 | `cd ${path} && fglform -M -W all ${fullname} && rm ${name}.42f` |
| `.per` | 编译 | `cd ${path} && fglform -M -W all ${fullname} && mv ${name}.42f ../42f/ && gsform -M -W all -i -import ${fullname} && mv ${name}.4fd ../4fd/` |
| `.per` | 预览画面 | `cd ${path} && r.gf ${name} 2 p` |

**`${name}` 弹框**：**只有 4GL「链接」会弹确认框**（预填文件名去扩展名，可改）；
其余命令直接用文件名去扩展名，不再打断你。

**占位符**（六种模板通用；目录分隔符恒为 `/`，与平台无关）：

| 占位符 | 含义 | 例（文件 `tiptop/apm/4gl/axcp500.4gl`） |
|---|---|---|
| `${path}` | 当前文件的**两层**目录 | `apm/4gl` |
| `${fullpath}` | 当前文件的**三层**目录 | `tiptop/apm/4gl` |
| `${name}` | 去掉扩展名的文件名 | `axcp500` |
| `${fullname}` | 含扩展名的文件名 | `axcp500.4gl` |

规则：

- 命令在**生产服务器**上执行（`tiptop exec`，工作目录 = 生产根）；stdout / stderr **原样**进「Genero BDL 任务」输出通道（含命令回显、耗时与退出码）；
- 六种模板都能在设置里改（[§13.5](#135-设置键总表3-组-49-键) 组 3「上传编译链接」）；
- `.4gl`「链接」**每次**弹出 `${name}` 输入框（预填文件名去扩展名，可改）；「编译」同样会弹；「预演编译」不弹、直接用默认名；
- **没有 `MAIN` 程序块**的 `.4gl`：右上角「链接」按钮是**不可用**（灰）状态；直接执行命令也会本地报错"没有 MAIN 函数，不允许链接"，不会跑脚本；
- 运行前若文件有未保存修改会**先保存**（脚本读的是磁盘文件）；编译中可点进度通知上的**取消**结束进程；
- 这是**本机脚本**，与 [§12 远程部署](#12-部署) 的 `tiptop deploy` 并存、互不影响。

---

## 9. 诊断与检查

### 9.1 能看到哪些检查（14 个诊断码）

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
| 记录成员不存在 | `record-member-unknown` | **off** | `RECORD` 声明或 `.project/schema` 字段资料 |
| 函数找不到定义 | `function-not-found` | warning | **链接资料** |
| 链接资料格式错误 | `link-data-invalid` | warning | 链接资料 |
| 格式资料还在旧目录 | `link-data-legacy-dir` | hint | 链接资料 |
| 文件过大已跳过 | `file-too-large` | **warning** | 无 |
| 解析超时已跳过 | `parse-timeout` | **warning** | 无 |

几个容易误解的点：

- **变量检查只查来源**，不查类型、不查赋值是否兼容；
- **函数检查需要链接资料**。没有 `.project/link/links.jsonl` 时整项不启用，避免误报；
- **字段检查只在表单唯一解析成功时报告**；解析不到表单不会硬猜；
- **记录成员默认关闭**。`RECORD LIKE table.*` 需要字段资料（`.project/schema`）才能展开；
- `file-too-large` / `parse-timeout` 是**警告**（0.3.7 起从 information 上调）：
  这个文件确实没被检查，点编辑器标题栏的"强制解析"（**后台不限时**解析，完成后自动刷新大纲并显示耗时）或调大 `bdl.limits.*` 即可；
- 资料**旧**不会有任何提示（P1-6 去掉了 7 天过期告警）。

### 9.2 调整级别：按码调级

所有诊断级别只有一个入口：`bdl.diagnostics`。键是诊断码，值是
`off` / `error` / `warning` / `information` / `hint`。

```jsonc
{
  "bdl.diagnostics": {
    "syntax-error": "error",
    "variable-source-unresolved": "warning",
    "record-member-unknown": "off"
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

// 有字段资料了，打开记录成员校验
{ "bdl.diagnostics": { "record-member-unknown": "warning" } }
```

> 📷 **截图位**：`docs/images/vscode/06-field-fix.png`
> 建议内容：`INPUT ... FROM` 引用不存在的字段，Problems 里有
> `field-not-in-form`，光标处出现 Quick Fix。

### 9.3 忽略文件、字段、表单

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

### 9.4 报告上限

`bdl.limits.maxIssues` 默认 200。单文件诊断太多时会截断，避免 Problems
面板卡死。确实需要看全部时可以临时调大，但不建议长期设得很大。

---

> 操作路径见第 2 章；本章是资料相关的细节。
## 10. 表单 .per、GLOBALS 与数据库字段资料

### 10.1 表单 `.per`

打开 `.per` 会做单文件内部一致性检查：

- `ATTRIBUTES` 重复 item（`form-duplicate-item`）；
- `LAYOUT` 引用未定义的 tag（`form-layout-tag-undefined`）；
- `SCREEN RECORD` 引用未定义的 item/字段（`form-screen-record-undefined`）。

`INPUT ... FROM`、`AFTER FIELD` 等语句引用的字段，需要能从当前文件解析到
对应的 `.per` 才会检查（`field-not-in-form`）。表单不在同目录时，用 `bdl.perRoots` 增加解析根：

```jsonc
{ "bdl.perRoots": ["forms", "legacy/forms"] }
```

一个常见现象：表单字段明明有，却报 `field-not-in-form` —— 表单不在 `<模组>/per/` 下时配
`bdl.perRoots`；并确认打开的是最新 `.per`（改完 `.per` 会自动刷新引用方）。

### 10.2 GLOBALS

`GLOBALS "path"` 默认相对当前文件解析。仓库层级特殊、相对路径解析不到时，
用 `bdl.globals.searchPaths` 增加候选根：

```jsonc
{ "bdl.globals.searchPaths": ["config", "tiptop/config"] }
```

GLOBALS 文件找不到时默认 warning（`globals-file-not-found`）；确认是历史遗留、不打算修，
可以把该码关掉或加进 `ignore.files`。
变量跳转不到时，先确认 `searchPaths` 覆盖了实际的 config 目录，再确认工作区根没选错。

### 10.3 数据库字段资料（schema）

`RECORD LIKE table.*` 的成员、`LIKE table.col` 的类型与中文说明，都不在源码里——
它们来自 **TiTop 字典**（`DS.ZTA_FILE` + `DS.GAQ_FILE.gaq03`，或 DBA 导出的同格式 CSV，含
表名/列名/中文说明/类型/长度/精度/是否可空），由 `tiptop` 转换成项目资料：

```bash
# 一次性导入
tiptop schema import -csv gal_schema.csv -root .
tiptop schema status -root .          # 看表数/列数/导入时间
```

资料落在 `.project/schema/`（`tables.json` 总索引 + `tables/<表>.json` 每表一列）。
在设置里把 **`bdl.schema.mode`** 设为 `file`/`db`（默认 `off`）之后：

- 侧边栏出现 **「数据库字段」** 视图：查询框支持**正则**（`^APF`、`(apg|aph)0`，**大小写不敏感**，输小写 `ima` 也能匹配 `ima_file`；正则写一半非法时会退回显示全部并提示「正则无效」），
  表**展开时才加载**列（几千张表也不卡）；右键表可以"同步选中的表 / 打开表资料文件"，
  右键列可以"复制列定义"（得到 `LIKE tab.col`）；
- 悬停 `DEFINE r RECORD LIKE ima_file.*` → 列出该表字段（列名 · 类型(长度) · 中文说明，超 20 行折叠）；
- 悬停 `DEFINE f LIKE ima_file.ima01` → 多出一段 `字段资料：ima_file.ima01 · VARCHAR2(40) · 料件编号`；
- 悬停表名本身 → 该表摘要；
- `r.` 补全会带上每列的类型与中文说明。

**四种更新方式**（都在命令面板 `Genero BDL: 数据库字段：…` 里；不再预演，全量前有一次不重新扫描的确认）：

| 方式 | 命令 | 说明 |
|---|---|---|
| 选择一笔 | 表上**右键 → 同步选中的表** | 只重算这一张（`-tables <表>`） |
| 多选批量 | 勾选多张 → **`同步已选中的表`** | 树视图原生不能多选，用**复选框**勾选；标题栏显示"已勾选 N 张" |
| 筛选批量 | 正则过滤后 → **`全选当前列表`** → **`同步已选中的表`** | 不再单设「同步筛选结果」命令；筛选后全选即等价（表多时自动走 `-tables-file`） |
| 全量 | **`从数据库同步`** / `从 CSV 导入` | 直连 Oracle 或读 CSV，全量重算（`从数据库同步` 顺带 `-prune` 清理本地多出的表） |

配合用的两个命令：**`全选当前列表`**（先正则过滤再全选）、**`清除勾选`**。

> **W4 门控**：上面「选择一笔 / 多选批量 / 筛选批量」属于**局部/批量更新**，
> 只有**配了数据库连接**（「生产环境」填了主机/服务名/只读账号）**且已经全量导入过**
> （`.project/schema/tables.json` 存在）时才会出现；「从数据库同步」只需要配了数据库连接；
> 「从 CSV 导入」「刷新」「过滤」始终可用。

**直连数据库**：先按 [§11.5](#115-直连数据库采集生产环境设置与密码) 用「生产环境」填好 Oracle
主机/服务名/只读账号（密码走环境变量 `BDL_ORA_PASSWORD` 或 `<项目>/.project/secrets.json`
——link 与 schema **共用这一份**），然后：

- `从数据库同步`：默认 SQL 查 **`DS.ZTA_FILE`（`zta02='ds'`）+ `USER_TAB_COLUMNS`**，
  列说明取 **`DS.GAQ_FILE.gaq03`**（`gaq02='2'`）——所以**连接账号要用应用 schema 账号**
  （自己拥有表，且对这两张字典表有读权限）；字典表不存在时会提示改用 CSV 导入；
- **分批查询**：先取表清单，再每 **200 张表**查一批（`-batch-size`，0=不分批），
  每批超时 120 秒（`-timeout`），跑完一批继续下一批。慢链路上不会再出现单条大查询
  被取消的 `ORA-01013`；
- 也可以在终端直接跑：`tiptop schema sync -root . -host … -service … -user …`。

**进度显示**：同步/导入时编辑器弹出**进度通知**，实时显示到哪一步，例如
`采集：连接 dbhost:1521/PROD（owner=TOPPORD）…`、`采集：已收到 12000 行`、
`解析表 ima_file（12/2648）`、`写入完成：2648 个表文件`；点通知上的**取消**可中断。
链接资料的同步（`从数据库更新` / `全量更新`）用**同一套**进度显示，
阶段是 `采集 / 扫描源码 / 成链 / 写入完成`。

> 📷 **配图位 G7**：`docs/images/guide/07-schema-view.png`
> 拍什么：侧边栏「数据库字段」视图——顶部"共 N 张表"、展开一张表看到 `列名 · 类型(长度) · 中文说明`，
> 最好附一个悬停 `DEFINE f LIKE t.col` 显示中文说明的截图。

> 📷 **配图位 G9**：`docs/images/guide/09-sync-progress.png`
> 拍什么：一次"从数据库同步"的进度通知（显示"解析表 xxx（i/N）"）+ 输出通道里的统计。

> 📷 **配图位 G10**：`docs/images/guide/10-schema-multi-select.png`
> 拍什么：侧边栏勾选两张表（复选框）+ 标题栏"已勾选 2 张"+ 执行"同步已选中的表"的确认框。

> 没有资料时记录成员检查默认关闭是正确的；不要为了"看起来开了"把它强行设成
> warning，否则 `LIKE table.*` 会成片误报。
>
> 旧版的"扫各模组下分散的 `sch/*.sch`"与 `bdl.schema.paths` 已**下线**（一个项目一份资料）。

---

> 操作路径见第 2 章；本章是链接资料的细节（采集方式、配置、退化行为）。
## 11. 链接资料

链接资料是程序/函数/全局变量的跨模块索引，保存在项目的 `.project/link/` 下。
迁移前它放在 `.link/`：语言服务器**仍会读取旧目录**并发一条提示（`link-data-legacy-dir`），
执行命令 `Genero BDL: 迁移项目资料目录` 可以把旧布局整体搬到 `.project/{link,schema,deploy}/`（搬完自动重启服务器）。

它**不是**打开项目就自动有的，需要先生成；没有它时：

- `function-not-found` 不启用；
- 跨模块的函数补全、跳转、引用不完整；
- 链接资料视图为空。

资料形态（`<项目>/.project/link/`）：

```text
.project/link/
├── links.jsonl        # 链接资料（链、文件、MAIN）
├── links.meta.json    # 元信息（来源、统计、schema 版本）
└── gal_file.csv       # 从 CSV 导入时的中间产物
```

> 资料是一份**快照**：不想要了直接删掉；想更新就再导出一次、再执行一次导入。
> **不会有"资料已过期"的提示**——什么时候更新完全由你决定。资料按 mtime 热加载（2 秒节流），
> 导入/同步完不需要重启。

### 11.1 资料从哪来：两份 CSV

| 文件 | 从哪来 | 用来做什么 |
|---|---|---|
| **程序链接资料**（DS.GAL_FILE 导出，列 `GAL01..GAL04`） | DBA/生产环境执行一条 SQL 导出，或用脚本 [`fetch-gal-file.sh`](https://github.com/darcyjoven/tiptop/blob/main/scripts/fetch-gal-file.sh) 在生产机上跑 | 跨模块**函数可见性**：`function-not-found` 不再乱报；侧边栏"链接资料"树与**反查引用程序** |
| **表字段资料**（表名/列名/中文说明/类型/长度…） | 直连时查 TiTop 字典 `DS.ZTA_FILE` + `DS.GAQ_FILE`；也可由 DBA 导出同格式 CSV | 悬停 `LIKE t.col` 显示**中文说明**；`RECORD LIKE t.*` 的成员校验；`rec.` 补全带说明 |

表字段 CSV 的导入与使用见 [§10.3](#103-数据库字段资料schema)；本节下面的内容针对链接资料。

> 📷 **配图位 G5**：`docs/images/guide/05-export-csv.png`
> 拍什么：生产端导出得到两个 CSV 的样子（文件列表即可；不要露真实库名/主机名/账号）。

### 11.2 生成链接资料（终端）

链接资料来自 DS.GAL_FILE 导出，或直接从数据库/命令/文件采集：

```bash
# 方式一：已有 DS.GAL_FILE 导出 CSV
tiptop link import -csv /path/to/gal_file.csv -root .

# 方式二：从文件采集（CSV 格式与方式一相同）
tiptop link sync -root . -source file -file /path/to/gal_file.csv

# 方式三：从命令采集（命令需输出 CSV）
tiptop link sync -root . -source command -command 'your-export-command'

# 方式四：直连 Oracle 采集
BDL_ORA_PASSWORD=... tiptop link sync -root . -source golang \
  -host db.example.com -service MYDB -user apps
```

大项目第一次扫描可能要几分钟、也可能更长，终端会打印
`扫描源码 X/Y` 进度。完成后检查：

```bash
tiptop link status -root .          # 看链数/文件数/生成时间
tiptop link import -csv .project/link/gal_file.csv -root .
```

如果 `tiptop` 不在 PATH 里（平台包内置，命令行不一定有）：

```bash
# 用 VSCode 内置的那份
ls ~/.vscode/extensions/darcyjoven.4gl-full-*/bin/tiptop
# 或
TIPTOP=$(ls ~/.vscode/extensions/darcyjoven.4gl-full-*/bin/tiptop | head -1)
"$TIPTOP" link status -root "$WORKSPACE"
```

> **`tiptop` 是什么**：链接资料的采集与部署由 tiptop 负责，它是从
> 语言服务器 `bdl-lsp` 分离出来的独立工具。语言服务器只读取 `.project/` 资料，
> 不负责生成它。平台扩展包同时内置两者。

上传/编译用的二进制在 `bdl-lsp/artifacts/bin/`、`tiptop/artifacts/bin/`；
插件里也可以用 `bdl.tools.path` 指到你自己的 `tiptop`。

### 11.3 从 CSV 导入（推荐，不用开终端）

1. 命令面板 → **`Genero BDL: 链接资料：从 CSV 导入`** → 选 `GAL_FILE` 的 CSV；
   扩展会把它复制成 `<项目>/.project/link/gal_file.csv`，然后问你：
   - **全量导入**（第一次用，通常几分钟、也可能更长，请在「输出 → Genero BDL 任务」看进度）。
   > 局部更新（`从数据库更新`）**需要连数据库**（`bdl.link.mode = db`）；
   > 只用 CSV（`file`）时，改完程序要重新导入一次 CSV 全量重建。
2. 命令面板 → **`Genero BDL: 数据库字段：从 CSV 导入`** → 选表字段 CSV → 确认后导入
   （全量前只做一次不重新扫描的确认，不再预演）。
3. 打开侧边栏的 **「链接资料」** 与 **「数据库字段」**，能看到树。

> 两个导入都**不再预演**（预演只留给编译类命令）；全量前有一次不重新扫描的确认。写盘时可以点进度通知上的**取消**。

导入完资料后，在设置里打开两个总开关，视图与命令才会出现：

```jsonc
{
  "bdl.link.mode": "db",        // 链接资料：跨模块可见性 + 链接视图 + 反查
  "bdl.schema.mode": "db"       // 数据库字段：悬停中文说明 + 成员校验
}
```

> 📷 **配图位 G6**：`docs/images/guide/06-import-csv.png`
> 拍什么：执行"链接资料：从 CSV 导入"后的确认对话框（显示"受影响作业 N 个"或统计），加一条进度通知。

### 11.4 在 VSCode 里使用

- 侧边栏"链接资料"树显示当前程序的引用关系：当前程序属于哪条链、链内文件（点击跳转）、全局模组；
  程序被谁引用（**反查引用程序**，结果多时分页）；
- 命令 `Genero BDL: 刷新` 重新加载；
- 命令 `Genero BDL: 反查引用程序` 从当前符号反查调用方，选中后跳到对应 `.4gl`；
- 反查结果多时用 `Genero BDL: 显示更多反查结果`；
- 视图标题栏的 **`从数据库更新`** 是**唯一**的「更新链接资料」入口（原来的
  `更新当前文件` / `重新同步` 两个同义命令合并掉了）：只重算当前文件涉及的作业（通常几秒），
  且**只在「配了数据库连接 + 已经全量导入过一次」时出现**——没配库或还没有资料时不会给一个点了就报错的按钮。

命令面板（`Ctrl+Shift+P`）里的 `链接资料：…`：

| 命令 | 什么时候用 |
|---|---|
| `从 CSV 导入` | 拿到 DS.GAL_FILE 导出后：会复制到 `<项目>/.project/link/gal_file.csv`，然后全量重建 |
| `从数据库更新` | 只改了一两个程序：只更新当前文件涉及的作业，其余链保留（不再预演；进度见输出）。**需要 mode=db + 已有全量资料**；视图标题栏上也有这个按钮 |
| `按模组更新` | 更新 `lib`/`sub`/`qry`（或项目里探测到的其他模组）涉及的所有作业 |
| `全量更新` | 第一次、或链接结构大改后：从数据库/CSV 重算全部（会先确认，耗时较长） |
| `查看状态` | 看链数、生成时间、是否局部更新过 |

采集需要有数据库配置：在设置里选 **生产环境** 填主机 / 服务名 / 只读账号，
密码放环境变量 `BDL_ORA_PASSWORD` 或 `<项目>/.project/secrets.json`（`chmod 600`）。
没配时命令会明确提示，并给"打开设置""改用 CSV 导入"两个按钮。
**生产环境设置只写 Workspace，且 `settings.json` 不要进 git 管理。**

> 📷 **截图位**：`docs/images/vscode/07-link-view.png`
> 建议内容：侧边栏链接资料树，展开一个程序节点。

> 🎬 **录屏位**：`docs/images/vscode/08-link-reverse.gif`
> 建议内容：在一个函数上执行反查，Quick Open 列表里选一个 `.4gl` 并跳转。

### 11.5 直连数据库采集：生产环境设置与密码

设置里搜 **`Genero BDL: 生产环境`**，填四项：

| 设置 | 例子 | 说明 |
|---|---|---|
| `bdl.prod.oracle.host` | `db.example.com` | 主机 |
| `bdl.prod.oracle.port` | `1521` | 端口（默认） |
| `bdl.prod.oracle.service` | `PROD` | 服务名 |
| `bdl.prod.oracle.user` | `readonly` | **只读账号** |

> ⚠️ **这些值只写在 Workspace 设置里**，并且**不要让 `settings.json` 进 git 管理**——
> 主机名与账号也算敏感信息。部署配置 `.project/deploy/deploy.json` 同理。

**密码不放在设置里**，二选一：

```bash
# 方式 1：环境变量（推荐，CI/多机通用）
export BDL_ORA_PASSWORD='<密码>'      # Windows: setx BDL_ORA_PASSWORD "..."

# 方式 2：项目里的 secrets.json（unix 必须 chmod 600）
#   <项目>/.project/secrets.json
#   {"readonly": "<密码>", "*": "<默认密码>"}
chmod 600 <项目>/.project/secrets.json
```

一键同步（链接资料 + 表字段）命令：

| 命令 | 做什么 |
|---|---|
| `Genero BDL: 链接资料：全量更新` | 直连 Oracle 查 DS.GAL_FILE，重算全部链接链（确认后执行，不再预演） |
| `Genero BDL: 从数据库更新` | 只重算**当前文件**涉及的作业（通常几秒；不再预演） |
| `Genero BDL: 链接资料：按模组更新` | 只更新 `lib`/`sub`/`qry` 等你选的模组 |
| `Genero BDL: 数据库字段：从数据库同步` | 查 TiTop 字典 `DS.ZTA_FILE` + `DS.GAQ_FILE.gaq03`（配 `USER_TAB_COLUMNS`），同步表字段资料 |
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

> 📷 **配图位 G8**：`docs/images/guide/08-oracle-settings.png`
> 拍什么：设置页 `Genero BDL: 生产环境` 四项已填（**主机名/账号打码**），
> 并显示那句"只写 Workspace、不要让 settings.json 进 git"的说明文字。

#### 8.5.1 安全清单（务必看一眼）

- [ ] 数据库账号是**只读**账号；
- [ ] 密码只在环境变量或 `<项目>/.project/secrets.json`（`chmod 600`），**从不写进设置**；
- [ ] 生产环境相关的设置只写 **Workspace**，`settings.json` 不进 git；
- [ ] 部署配置 `.project/deploy/deploy.json` 由插件生成，同样**不要提交**；
- [ ] 团队共享的话，提交导出的 CSV 资料（模式 ②）比提交账号安全得多。

Windows 上提示 `secrets.json` 权限问题属正常：Windows 没有 unix 权限位，
扩展在那边**跳过**权限校验（安全性由文件 ACL 决定）。

### 11.6 链接资料配置

```jsonc
{
  "bdl.link.mode": "db",
  "bdl.link.dataDir": ".project",
  "bdl.link.moduleRoots": ["src"],
  "bdl.link.globalModules": ["sub", "lib", "qry"]
}
```

- `enable`：**总开关**（默认关，轻量档）；
- `dataDir`：资料目录，默认 `.project/link`；
- `moduleRoots`：模组根，影响跨模组查找；
- `globalModules`：全局模组名。

采集/同步的键（旧 `bdl.link.sync.*`）**不存在了**：链接资料的采集/导入自 `bdl-lsp 0.3.2`
起由 **tiptop** 负责，扩展里没有自动同步设置项，也不负责生成资料。在项目根用终端执行：

```bash
# 从已导出的 CSV 导入
tiptop link import -csv .project/link/gal_file.csv -root .

# 直连 Oracle 采集（纯 Go 驱动，无需 Oracle 客户端）
BDL_ORA_PASSWORD=... tiptop link sync -root . -source golang \
  -host dbhost -service PROD -user readonly

# 从命令 stdout / 本地文件采集
tiptop link sync -root . -source command -command 'your-export-command'
tiptop link sync -root . -source file -file /path/to/gal_file.csv
```

密码**不放在设置里**：用环境变量 `BDL_ORA_PASSWORD`，或 `.project/secrets.json`（权限 0600）。
导入完成后编辑器按 mtime 自动热加载，无需重启。

> 没有"过期"相关的键：资料旧不旧由你决定，插件不会自动提示（P1-6）。

### 11.7 没有链接资料时的退化行为

- **`function-not-found`**：调用一个函数，若在本文件/GLOBALS/链接文件/全局模组（`sub`/`lib`/`qry`）里
  都找不到才报；没有链接资料时这项**完全不产生诊断**（宁可漏报，不可误报）。
- **链接资料视图**：无资料时为空。
- **记录成员校验**（可选）：把 `bdl.diagnostics.record-member-unknown` 设为 `warning`，
  就能查出 `rec.bad_member` 这类拼错的成员（需要字段资料，见 [§10.3](#103-数据库字段资料schema)）。

### 11.8 链接资料常见问题

| 现象 | 先查 |
|---|---|
| 函数仍然报找不到 | 是否生成过 `.project/link/links.jsonl`；`tiptop link status` 是否正常 |
| 链接视图为空 | 当前文件是否在 `moduleRoots` 内；是否点了刷新 |
| 反查跳错文件 | 确认生成资料后重新 `tiptop link import`；旧索引可能过期 |
| 资料很久没更新 | 设计如此：资料**旧**不告警（P1-6）；想更新用 `Genero BDL: 从数据库更新` / `链接资料：全量更新` |

---

> 操作路径见第 3 章；本章是上传/页面部署的细节与排查。
## 12. 部署

部署 = 上传源码到远程服务器 + 远程编译。配置在 `<项目>/.project/deploy/deploy.json`，
示例见 tiptop 仓库 `examples/deploy.json`。

不需要部署的机器可以把 `bdl.deploy.enable` 关掉：命令面板里的四条部署
命令会消失，命令即使被直接调用也不会执行。

### 12.1 配置

1. 打开总开关 `bdl.deploy.enable`（默认关）；
2. 在 **`Genero BDL: 生产环境`** 里填部署目标：`bdl.prod.deploy.host` / `port`(默认 22) / `user` / `remoteRoot`
   （生产根，如 `/u1/toppord`），可选：`localRoot`、`transport`(off/rsync/scp)、`strictHostKey`；
3. **不用手写 JSON**：每次上传前插件会把上述设置合成为 `<项目>/.project/deploy/deploy.json`（文件里带 `createdBy` 标记），
   再交给 `tiptop upload` / `tiptop exec`；如果你之前手写过一个 `deploy.json`，第一次覆盖前会备份成 `deploy.json.bak`；
4. 然后用命令：`预演上传` → 看计划 → `上传当前文件`；编译/链接/预览用 [§8.10](#810-编译--链接--预览在生产服务器上执行) 的按钮。
   **只上传当前文件，不做批量同步。**

手写仍然支持（`tiptop deploy -config <文件>`）；如果不是插件生成的文件，第一次被覆盖前会备份成 `deploy.json.bak`。

生成出来的样子（也可以照着手写）：

```jsonc
{
  "targets": {
    "prod": {
      "host": "<生产主机>",
      "port": 22,
      "user": "<生产账号>",
      "remoteRoot": "/u1/toppord",
      "localRoot": ".",
      "upload": {
        "include": ["**/*.4gl", "**/*.global", "**/*.per", "**/*.sch"],
        "exclude": ["**/.git/**", "**/.project/**", "**/.bdl-lsp/**"],
        "mode": "rsync",
        "rsyncArgs": ["-az"],
        "fallback": "scp",
        "delete": false
      },
      "compile": {
        "4gl": "fglcomp -M {file}",
        "per": "fglform {file}"
      },
      "strictHostKey": true,
      "connectTimeout": 20
    }
  },
  "defaultTarget": "prod"
}
```

最小配置版本：

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

> `remoteRoot` 必须是**生产端源码所在的同一目录**（如 `/u1/toppord`），
> 这样单文件上传后远程编译用的就是生产环境的那套依赖。
> 认证使用 SSH key / ssh-agent，**不支持在设置或配置里存密码**。

### 12.2 命令

| 命令 | 作用 |
|---|---|
| `Genero BDL: 上传当前文件` | 只上传当前打开的文件（工作区根 → 生产根同路径）；不做批量 |
| `Genero BDL: 预演上传` | 打印上传计划，不连接服务器 |

配置由设置自动合成（单目标 `prod`）；这些命令都由 `tiptop upload` 执行。

> 📷 **配图位 G11**：`docs/images/guide/11-deploy.png`
> 拍什么：部署预演的输出（列出要上传/编译的文件）+ 部署完成后的输出摘要。

> 📷 **截图位**：`docs/images/vscode/09-deploy.png`
> 建议内容：执行"部署预演"后的输出，包含目标、上传列表、编译命令。

### 12.3 部署排查

- 先跑"部署预演"，确认文件列表和编译命令；
- SSH 失败先手动 `ssh user@host`，确认 key/agent；
- 编译失败看输出里的远程命令和 stderr；
- `.project/deploy/deploy.json` 含主机信息，建议加入 `.gitignore`，只提交模板。

| 现象 | 检查 |
|---|---|
| 找不到 `tiptop` | 用平台包里的：`~/.vscode/extensions/darcyjoven.4gl-full-*/bin/tiptop`；或在设置里填 `bdl.tools.path` |
| SSH 认证失败 | `ssh <账号>@<主机> 'echo ok'` 手动验证；检查 key/agent |
| 远端没有该目录 | `remoteRoot` 要与生产端源码目录一致（如 `/u1/toppord`） |
| 远端找不到 `fglcomp` | 远程命令走登录 shell 的 `PATH`；用绝对路径或确认 `.bash_profile` 里有 Genero 环境 |
| 上传了但没编译 | 目标缺少 `compile` 配置，或用了 `-no-compile` |
| 编译报找不到子文件 | `remoteRoot` 与本地目录层级不一致，导致相对 include 解析不到 |
| 检查 `remoteRoot` 写权限 | 确认远程账号在 `remoteRoot` 下有写权限 |

---

## 13. 配置说明（3 组 49 键）

### 13.1 设置界面分三组

设置界面按用途分成六组（和 CSS 语言插件一样的多层次设置）。
**默认是轻量档**：零配置开箱即用，不连库、不后台跑任务、不往项目里写文件。

| 组 | 内容 | 默认 | 什么时候看 |
|---|---|---|---|
| **基本设置** | 诊断级别、格式化、项目解析、资源限制、安装与排障 | 开 | 大多数人只需要这一组 |
| **账号、生产环境、配置** | Oracle 连接、生产服务器、链接资料模式、字段资料模式（**密码不放这里**） | 空 / **关** | 要采集资料、或要连库同步时 |
| **上传编译链接** | 单文件上传方式与目录、编译/链接/预览命令（在生产服务器上执行） | **关** | 需要上传当前文件、或用编辑器右上角编译按钮时 |

### 13.2 模式与总开关

- `bdl.link.mode`（**默认 `off`**）——链接资料三态：`off` 不加载资料、不发
  `function-not-found` / `link-data-*` 诊断、隐藏视图与命令；`file` 只用 CSV 导入；
  `db` 允许连数据库同步/更新。
- `bdl.schema.mode`（**默认 `off`**）——字段资料三态，含义同上。
- `bdl.deploy.enable`（**默认关**）+ `bdl.prod.deploy.transport`（**默认 `off`**）——
  「上传编译链接」组：两者都满足才出现「上传当前文件 / 预演上传」；
  `bdl.build.enable` 控制六个编译/链接/预览命令（命令在**生产服务器**上执行）。

需要这些能力时，**只在这个设置面板里改**，不用手写 JSON、不用找命令行。

> **生产环境这组只写 Workspace 设置，并且不要让 `settings.json` 进 git 管理**；
> 密码/密钥一律不放在设置里（见 [§11.5](#115-直连数据库采集生产环境设置与密码)）。

### 13.3 配置优先级

配置有三层，优先级从高到低：

1. VSCode 设置（`settings.json` 里的 `bdl.*`）；
2. 项目文件 `.bdl-lsp/config.json`；
3. 扩展/服务端内置默认值。

`bdl.diagnostics` 的逐码值覆盖项目文件里的同码值；项目文件适合团队共享，
VSCode 设置适合个人临时调整。

### 13.4 按"要不要改"分类

（这里按"要不要改"分成三类，是**文档的阅读顺序**；设置界面本身按用途分成三组，见 [§13.1](#131-设置界面分三组)。）

**第一类：默认即可，基本不用动**

- 诊断级别：`bdl.diagnostics` 默认 warning；例外：`record-member-unknown` 默认 off、
  `link-data-legacy-dir` 默认 hint、`file-too-large`/`parse-timeout` 默认 warning；
- 格式化：`format.keywords=unchanged`、`indentStyle=auto`、`indentSize=0`；
- 资源限制：大文件、行数、诊断条数、解析超时都有安全默认值；
- 项目解析：`index.enable=true`、`builtins.enable=true`、
  `schema.enable=false`（要用 `LIKE t.*` 成员校验/字段说明时打开，资料见 [§10.3](#103-数据库字段资料schema)）。

**第二类：不配置就用不了**

- 链接资料：需要先生成 `.project/link`，再按需配 `link.*`；
- 部署：需要 `.project/deploy/deploy.json` 和 SSH 访问；
- schema：只有需要展开 `LIKE table.*` / 字段说明时才配 `schema.enable`（资料目录 `schema.dataDir` 默认 `.project/schema`）；
- 表单 / GLOBALS 搜索路径：项目层级特殊时才需要加。

**第三类：按项目调整**

- `ignore.*`：忽略生成代码、历史代码；
- `link.moduleRoots` / `globalModules`：多模组项目；
- `limits.*`：超大型文件或诊断特别多的项目；
- `server.path` / `tools.path` / `logLevel` / `trace.server`：安装与排障。

### 13.5 设置键总表（3 组 49 键）

#### 组 1：基础（22 键）

**运行与安装（5 键）**

| 键 | 默认 | 作用 |
|---|---|---|
| `bdl.server.path` | `""` | 覆盖内置语言服务器：可填绝对路径或所在目录；留空走内置 `bin/` → 环境变量 → 工作区 → `PATH` |
| `bdl.tools.path` | `""` | 指定 `tiptop` 可执行文件（采集/部署用）；留空用扩展内置 `bin/tiptop` |
| `bdl.server.logLevel` | `info` | 服务端日志级别：`debug`/`info`/`warn`/`error` |
| `bdl.trace.server` | `off` | LSP 协议跟踪：`off`/`messages`/`verbose` |
| `bdl.generoVersion` | `2.50` | 目标 Genero 版本：`2.50`/`3.00`/`4.00` |

**诊断与格式化（4 键，默认即可）**

| 键 | 默认 | 作用 |
|---|---|---|
| `bdl.diagnostics` | `{}` | 按诊断码覆盖级别；唯一诊断入口 |
| `bdl.format.keywords` | `unchanged` | 关键字大小写：`unchanged`/`upper`/`lower`；`lower` 同时让补全的关键字用小写 |
| `bdl.format.indentStyle` | `auto` | 缩进风格：`auto`/`tab`/`space` |
| `bdl.format.indentSize` | `0` | 缩进宽度；0 表示按原文件推断 |

**项目解析（9 键，默认开启）**

| 键 | 默认 | 作用 |
|---|---|---|
| `bdl.index.enable` | `true` | 工作区符号索引 |
| `bdl.globals.searchPaths` | `[]` | GLOBALS 附加解析根 |
| `bdl.perRoots` | `[]` | `.per` 附加解析根 |
| `bdl.builtins.enable` | `true` | 内置函数/变量符号表 |
| `bdl.builtins.paths` | `[]` | 项目自定义内置表文件 |
| `bdl.builtins.disable` | `[]` | 禁用的内置符号名 |
| `bdl.ignore.files` | `[]` | 忽略诊断并排除索引的文件 glob |
| `bdl.ignore.fields` | `[]` | 忽略 `field-not-in-form` 的字段 glob |
| `bdl.ignore.forms` | `[]` | 忽略字段类诊断的表单 glob |

**资源保护（4 键）**

| 键 | 默认 | 作用 |
|---|---|---|
| `bdl.limits.maxFileBytes` | `2097152` | 单文件字节上限（2 MB） |
| `bdl.limits.maxFileLines` | `20000` | 单文件行数上限 |
| `bdl.limits.maxIssues` | `200` | 单文件最多诊断条数 |
| `bdl.limits.parseTimeoutMs` | `2000` | 单次解析超时（毫秒） |

#### 组 2：账号、生产环境、配置（16 键；不配置就用不了采集/上传；只写 Workspace）

**Oracle 连接（4 键）**

| 键 | 默认 | 作用 |
|---|---|---|
| `bdl.prod.oracle.host` | `""` | 主机（示例 `oracle`） |
| `bdl.prod.oracle.port` | `1521` | 端口 |
| `bdl.prod.oracle.service` | `""` | 服务名（**连接必需**） |
| `bdl.prod.oracle.user` | `""` | **应用 schema 账号**（字段资料默认 SQL 走 `USER_TAB_COLUMNS` + TiTop 字典；密码走环境变量或 `.project/secrets.json`） |

**生产服务器（4 键）**

| 键 | 默认 | 作用 |
|---|---|---|
| `bdl.prod.deploy.host` | `""` | SSH 主机（示例 `erp`） |
| `bdl.prod.deploy.port` | `22` | SSH 端口 |
| `bdl.prod.deploy.user` | `""` | SSH 账号（示例 `tiptop`；**只支持密钥登录**） |
| `bdl.prod.deploy.strictHostKey` | `true` | 严格校验 SSH host key（换主机后可关掉，走 accept-new） |

**链接资料（4 键）**

| 键 | 默认 | 作用 |
|---|---|---|
| `bdl.link.mode` | `off` | 三态：`off` 不启用 / `file` 只用 CSV 导入 / `db` 允许连库同步 |
| `bdl.link.dataDir` | `.project/link` | 资料目录 |
| `bdl.link.moduleRoots` | `[]` | 模组根（留空自动探测） |
| `bdl.link.globalModules` | `["sub","lib","qry"]` | 全局模组名 |

**数据库字段（4 键）**

| 键 | 默认 | 作用 |
|---|---|---|
| `bdl.schema.mode` | `off` | 三态：`off` / `file`（只用 CSV 导入）/ `db`（可连库同步） |
| `bdl.schema.dataDir` | `.project/schema` | 字段资料目录 |
| `bdl.schema.batchSize` | `200` | 「从数据库同步」每批查几张表（0=不分批）；慢链路可调小 |
| `bdl.schema.timeoutSec` | `120` | 单批查询超时秒数；慢链路可加大 |

#### 组 3：上传编译链接（11 键）

**上传（4 键）——只上传当前文件，不做批量同步**

| 键 | 默认 | 作用 |
|---|---|---|
| `bdl.deploy.enable` | `false` | **总开关**：关闭后隐藏上传与编译/链接/预览命令 |
| `bdl.prod.deploy.transport` | `off` | 上传方式：`off` 不上传 / `rsync`（失败退 scp）/ `scp` |
| `bdl.prod.deploy.localRoot` | `.` | 项目根目录（相对工作区根） |
| `bdl.prod.deploy.remoteRoot` | `""` | 生产根目录（示例 `/u1/toppord`）：上传落点 + 命令的工作目录 |

**编译 / 链接 / 预览（7 键；命令在生产服务器上通过 ssh 执行）**

| 键 | 默认 | 作用 |
|---|---|---|
| `bdl.build.enable` | `false` | 编译/链接/预览总开关（关掉后六个按钮与命令都隐藏；去掉了各自的 enable） |
| `bdl.build.4gl.preview.command` | `cd ${path} && r.c2 ${name}` | 命令模板 |
| `bdl.build.4gl.compile.command` | `cd ${path} && r.c2 ${name}` | 命令模板 |
| `bdl.build.4gl.link.command` | `r.l2 ${name}` | 命令模板；**只有这条会弹 `${name}` 确认**（无 `MAIN` 时按钮置灰） |
| `bdl.build.per.preview.command` | `cd ${path} && fglform -M -W all ${fullname} && rm ${name}.42f` | 命令模板 |
| `bdl.build.per.compile.command` | `cd ${path} && fglform -M -W all ${fullname} && mv ${name}.42f ../42f/ && gsform -M -W all -i -import ${fullname} && mv ${name}.4fd ../4fd/` | 命令模板 |
| `bdl.build.per.form.command` | `cd ${path} && r.gf ${name} 2 p` | 命令模板（三个参数：`${name}`、`2`、`p`） |

> 密码不在设置里。链接/字段同步用 `BDL_ORA_PASSWORD` 或
> `.project/secrets.json`；上传/执行用 SSH key / agent。

### 13.6 项目级配置 `.bdl-lsp/config.json`

项目文件可以提交，供团队共享（不含敏感信息）。完整示例：

```jsonc
{
  "generoVersion": "2.50",

  // 诊断级别：只写要改的，其余用默认值（默认 warning）
  "diagnostics": {
    "record-member-unknown": "warning",   // 有字段资料（.project/schema）了才建议开
    "function-not-found": "warning"        // 有链接资料了才有意义
  },

  // GLOBALS 解析：跨层级引用时加候选根（相对工作区根）
  "globals": {
    "searchPaths": ["tiptop/config", "topcust/config"]
  },

  // 表单 .per 的附加查找根（相对工作区根）。
  // 默认规则已经能处理"引用文件同级的 ../per/"，只有跨模组引用才需要配。
  "perRoots": ["tiptop/aap/per"],

  // 数据库字段资料：展开 RECORD LIKE t.*、悬停 LIKE t.col 显示中文说明
  // 资料由 tiptop schema import -csv <Oracle导出.csv> 生成到下面的目录。
  "schema": {
    "enable": true,
    "dataDir": ".project/schema"
  },

  // 链接资料
  "link": {
    "enable": true,
    "dataDir": ".project/link",
    // 模组根：留空则自动探测（tiptop / topcust 优先），一般不用配
    "moduleRoots": [],
    "globalModules": ["sub", "lib", "qry"]
  },

  // 忽略清单：生成代码与历史文件
  "ignore": {
    "files": ["**/backup/**", "**/tmp/**"]
  }
}
```

也可以只写按需的几项：

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
  "link": { "moduleRoots": ["src"] }
}
```

改完项目文件后执行 `Genero BDL: 重启语言服务器`，或等设置热更新生效。

### 13.7 最常用片段

```jsonc
{
  // 一键切换三档
  "bdl.link.mode": "off",
  "bdl.schema.mode": "off",
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

## 14. 常见问题

### 14.1 快速对照表

| 现象 | 原因 / 怎么办 |
|---|---|
| 侧边栏没有「链接资料」/「数据库字段」视图，命令也搜不到 | 这两个功能**默认关闭**（轻量档）。把 `bdl.link.mode` / `bdl.schema.mode` 改成 `file`（只用 CSV）或 `db`（可连库）后视图与命令才出现 |
| 函数调用报"找不到定义"（`function-not-found`） | 需要链接资料：模式 ② 导入 CSV，或模式 ① 从数据库同步。没有资料时这项**不报** |
| 诊断太多/太吵 | 这是**你的选择**：`bdl.diagnostics` 按码调级（`off`/`error`/`warning`/`information`/`hint`），也可以 `bdl.ignore.files` 忽略生成代码目录 |
| 打开大文件没有大纲、没有诊断 | Problems 里有 `file-too-large` / `parse-timeout` 警告 → 点**编辑器标题栏的"强制解析"**，或调大 `bdl.limits.maxFileBytes` / `maxFileLines` / `parseTimeoutMs`。强制解析会**后台不限时**解析并在完成后自动刷新大纲（状态栏显示耗时），**到文件关闭为止有效** |
| 表单字段明明有，却报 `field-not-in-form` | 表单不在 `<模组>/per/` 下时配 `bdl.perRoots`；确认打开的是最新 `.per`（改完 `.per` 会自动刷新引用方） |
| `RECORD LIKE t.*` 的成员校验不生效 | 需要字段资料 + 把 `bdl.diagnostics.record-member-unknown` 打开（默认 `off`），见 [§10.3](#103-数据库字段资料schema) |
| 资料旧了要重启吗 | 不用：资料按 mtime 热加载（2 秒节流）。而且**不会有"过期"提示**——想更新就再执行一次同步 |
| 连接数据库报"缺少密码" | 设 `BDL_ORA_PASSWORD`，或写 `<项目>/.project/secrets.json`（`chmod 600`）。**link 与 schema 都只读这一份**（不要放进 `.project/link/`） |
| 编译/链接/预览报错（没有配置 / 连不上） | 这些命令**在生产服务器上执行**：先在「上传编译链接」打开 `bdl.deploy.enable`、把 `bdl.prod.deploy.transport` 设为 rsync/scp、填好生产根目录，并在「账号、生产环境、配置」填生产服务器主机/账号（SSH 密钥）；再打开 `bdl.build.enable`。报错通知里可点「打开日志」看完整输出 |
| 点了编译，但服务器上还是旧代码 | 上传是**单独动作**：插件不会自动上传。先点「上传当前文件」，再点编译/链接/预览 |
| 只有 4GL 链接弹 `${name}` 吗 | 是。只有 4GL「链接」弹确认框；4GL 编译、Form 预演编译/编译/预览都用文件名去扩展名，不打断 |
| 上传能一次传整个工作区吗 | 不能（**只允许单文件上传**）：只传当前打开的文件，按「工作区根 → 生产根」同路径映射。批量同步请用 `tiptop deploy` 命令行 |
| 从数据库同步失败（退出码 1） | 失败通知已带 stderr 首行；点通知上的**「打开日志」**看完整输出（扩展 globalStorage 里的 `last-run-schema.log`），或点「打开日志」看完整输出（任务输出在「Genero BDL 任务」通道）。若是 `ORA-01013`（查询被取消）多半是单批超时：加大 `-timeout` 或减小 `-batch-size`；权限/owner 问题按「从数据库同步」一节核对 |
| Windows 上提示 `secrets.json` 权限问题 | Windows 没有 unix 权限位，扩展在那边**跳过**权限校验（安全性由文件 ACL 决定） |
| 语言服务器起不来 | 命令 `显示语言服务器信息` 看二进制来源。顺序：包内置 `bin/` → `bdl.server.path` → `PATH` → 工作区 `.bdl-lsp/bin/`。用 **dev 包/源码**运行时没有内置二进制，需要自己编译或指定路径 |
| 公司网络不能上网 | 插件本身**不联网**；只有你手动点"从数据库同步/全量更新"时才连你配的那台数据库 |
| 想彻底回到零配置 | 把 `bdl.link.mode` / `bdl.schema.mode` 设为 `off`、`bdl.deploy.enable` 关掉，删掉 `<项目>/.project/` 即可 |
| 链接资料有，但 `function-not-found` 还是报 | 确认 `bdl.link.mode` 不是 `off`、`bdl.link.dataDir` 与实际目录一致（默认 `.project/link`） |
| GLOBALS 变量跳转不到 | 确认 `bdl.globals.searchPaths` 覆盖实际的 config 目录；确认工作区根没选错 |
| 第一次索引很慢 | 工作区索引要扫全部文件（通常几分钟、也可能更长，进度见输出）；用 `bdl.ignore.files` 排除生成代码与备份目录，必要时调大 `bdl.limits.maxFileBytes` |
| 升级后旧诊断设置不生效 | 旧专用键已删除，把旧值迁到 `bdl.diagnostics`，见 [§14.7](#147-升级后旧诊断设置不生效) |
| 找不到 `tiptop` | 用平台包内置的那份，或填 `bdl.tools.path` |

### 14.2 打开文件没有任何诊断

按顺序检查：

1. 右下角语言模式是否是 "Genero BDL" / "Genero Form"；
2. `Genero BDL: 显示服务器信息` 是否解析到二进制；
3. 输出通道「Genero BDL」（或「显示语言服务器信息」→「打开日志」）是否有启动失败、CGO、grammar 加载错误；
4. 文件是否被 `bdl.ignore.files` 或 `.bdl-lsp/config.json` 忽略；
5. 是否超过 `limits.maxFileBytes` / `maxFileLines`（会显示 `file-too-large`）。

### 14.3 变量或函数全是波浪线

- 变量：先确认 GLOBALS 路径是否正确，必要时加 `globals.searchPaths`；
- 函数：先确认链接资料是否生成；没有 `.project` 时函数检查不会启用；
- 内置函数被误报：确认 `builtins.enable=true`，版本是否匹配 `generoVersion`。

### 14.4 跳转 / 补全不工作

- 当前文件是否解析成功（有语法错误时索引可能不完整）；
- 目标是否在 GLOBALS、链接资料或当前工作区内；
- 多根工作区里，项目是否在正确的根下；
- 大项目索引是否还在进行中。

### 14.5 链接资料视图空 / 反查不到

- 先跑 `tiptop link status -root .`；
- 确认 `.project/link/links.jsonl` 存在且不是空文件；
- 重新 `tiptop link import` 后点"刷新"；
- 反查只对已索引的程序有效，确认当前文件在 `moduleRoots` 内。

### 14.6 部署失败

- 先"部署预演"；
- 手动 `ssh` 验证 key/agent；
- 检查 `remoteRoot` 是否存在、是否有写权限；
- 检查远程编译命令是否在登录 shell 的 `PATH` 里。
- 更细的现象对照见 [§12.3 部署排查](#123-部署排查)。

### 14.7 升级后旧诊断设置不生效

旧专用键已删除。把旧值迁到 `bdl.diagnostics`：

```jsonc
// 旧： "bdl.fieldDiagnostics": "off"
{ "bdl.diagnostics": { "field-not-in-form": "off" } }
```

完整码表见 [§9.1](#91-能看到哪些检查14-个诊断码)。

### 14.8 密码相关

- **不要**把 Oracle 密码写进 `settings.json` 或提交进仓库；
- 用 `BDL_ORA_PASSWORD` 环境变量，或 `.project/secrets.json`（`chmod 600`，
  且 `.project/` 已在 `.gitignore` 里）。

---

> **快速路径见第 1–3 章**；本附录保留详细命令、排错与目录速查（一键脚本已由 `scripts/init-project/` 取代）。
## 附录 A：从生产端搭建工作区

> 面向"把生产端 `/u1/toppord` 拉成本地工作区，并在 VSCode 里完整用起来"的全流程：
> 打包 → Git → 资料 → 部署测试。命令均可直接复制执行，`<>` 里的内容按实际替换。
> 涉及的插件：VSCode 扩展 `4gl-full`（`darcyjoven.4gl-full`）。
> Zed 扩展暂不支持内置二进制与本流程的部署部分。

### A.1 整体流程

```text
生产端 /u1/toppord
   │  ① tar 打包（只含源码）
   ▼
本地包文件 xxx.tar.gz
   │  ② 解压 → git init
   ▼
本地工作区
   │  ③ 导出 DS.GAL_FILE → tiptop link import → .project/link/links.jsonl
   │  ④ 写 .bdl-lsp/config.json 与 deploy.json
   │  ⑤ tiptop deploy 单文件上传 + 远程编译
   ▼
VSCode 里完整可用
```

**为什么第 ① 步只打包这三类文件**：

| 目录 | 内容 | 为什么需要 |
|---|---|---|
| `*/*/4gl/*.4gl` | Genero 4GL 源码（含 `.global`） | 语言服务的主对象：解析、跳转、诊断 |
| `*/*/per/*.per` | 表单定义 | 字段校验（`field-not-in-form`）、表单内部一致性检查 |
| `*/*/sch/*.sch` | 数据库表结构（**旧**） | **P2-1 起不再读取**：改用 `<项目>/.project/schema/` 里的字段资料（由 `tiptop schema import` 从 Oracle 导出生成） |

> `*/*/` 是**两级**目录：`/<顶层>/<模组>/4gl/...`，例如
> `/u1/toppord/tiptop/aap/4gl/aapi202.4gl`。
> 顶层目录通常是 `tiptop`、`topcust` 等；模组目录是 `aap`、`axm` 等。

### A.2 第 0 步：准备工作区目录

在本地选一个**空目录**作为工作区根（后面所有命令的"工作区根"都指它）：

```bash
export WORKSPACE="$HOME/work/toppord"
mkdir -p "$WORKSPACE"
cd "$WORKSPACE"
```

工作区根会被 VSCode 打开，`.bdl-lsp/config.json`、`.project/deploy/deploy.json`、
`.project/` 都要放在它下面。

> 迁移前的项目资料在 `.link/` 或 `.project` 根；语言服务器仍会读取旧布局并提示迁移，
> 一键命令：**`Genero BDL: 迁移项目资料目录`**（搬到 `.project/{link,schema,deploy}/`，搬完自动重启语言服务器）。

确认插件已安装（平台包自带语言服务器，不用另外装 `bdl-lsp`）：

```bash
code --list-extensions | grep -i 4gl
# 期望输出：darcyjoven.4gl-full
```

### A.3 第 1 步：从生产端打包源码

#### A.3.1 在生产端执行（SSH 登录生产机）

```bash
ssh <用户名>@<生产主机>

cd /u1/toppord

# 只打包三类源码目录：*/*/4gl、*/*/per、*/*/sch
# -mindepth 3 -maxdepth 3 限定"顶层/模组/类型"三级
find . -mindepth 3 -maxdepth 3 -type d \( -name 4gl -o -name per -o -name sch \) -print \
  | tar czf /tmp/toppord-src.tar.gz \
      --exclude='.git' \
      --exclude='*.o' \
      --exclude='*.err' \
      --exclude='*.form' \
      --exclude='build' \
      -T -

ls -lh /tmp/toppord-src.tar.gz
```

**先干跑一次看看会打包什么**（不写文件）：

```bash
cd /u1/toppord
find . -mindepth 3 -maxdepth 3 -type d \( -name 4gl -o -name per -o -name sch \) -print \
  | head -20
```

> **不要用 `tar czf ... /u1/toppord`（整目录打包）**：会把编译产物、
> 版本库、临时文件一并拉回来，本地仓库很快变脏。

#### A.3.2 把包拉回本地

```bash
# 在本地执行
scp <用户名>@<生产主机>:/tmp/toppord-src.tar.gz "$WORKSPACE/"
cd "$WORKSPACE"
ls -lh toppord-src.tar.gz
```

#### A.3.3 校验包内容（可选但建议）

```bash
tar tzf toppord-src.tar.gz | head -20
echo "---- 统计 ----"
tar tzf toppord-src.tar.gz | grep -c '/4gl/.*\.4gl$'
tar tzf toppord-src.tar.gz | grep -c '/per/.*\.per$'
tar tzf toppord-src.tar.gz | grep -c '/4gl/.*\.global$'
```

> 表字段资料**不在源码包里**：它来自 DBA 导出的 CSV，`tiptop schema import` 生成到
> `.project/schema/`（见 [A.6](#a6-第-4-步配置项目) 与 [§10.3](#103-数据库字段资料schema)）。

三个计数应与生产端一致（生产端可先跑同样的 `find | wc -l` 对照）。

### A.4 第 2 步：解压并初始化 Git 仓库

#### A.4.1 解压

```bash
cd "$WORKSPACE"
tar xzf toppord-src.tar.gz
ls -la
```

解压后结构应类似：

```text
$WORKSPACE/
├── tiptop/
│   ├── aap/
│   │   ├── 4gl/aapi202.4gl ...
│   │   ├── per/...
│   │   └── sch/...
│   └── ...
└── topcust/
    └── ...
```

#### A.4.2 初始化 Git 仓库

```bash
cd "$WORKSPACE"

git init -b main

# 忽略不该进版本库的东西
cat > .gitignore <<'EOF'
# 链接资料（由工具生成，含环境相关信息）
.project/

# 部署配置（含主机名、账号，不同开发者不同）
.project/deploy/deploy.json

# 编译产物与临时文件
*.o
*.err
*.form
*.4gl.bak
EOF

git add -A
git commit -m "从生产端导入源码（tiptop/topcust）"
git log --oneline -1
```

> **`.project/deploy/deploy.json` 建议不进版本库**：它含生产主机名与账号。
> 用 `deploy.json.example` 做模板提交，或由每个开发者本地维护。
> `.bdl-lsp/config.json`（不含敏感信息）可以提交，供团队共享。

#### A.4.3 确认工作区根选对

VSCode 必须打开 `$WORKSPACE` 本身（不是它的子目录），否则：

- `.bdl-lsp/config.json` 读不到；
- 链接资料目录 `.project/link/` 找不到；
- GLOBALS 相对路径解析的起点不对。

打开方式：

```bash
code "$WORKSPACE"
```

### A.5 第 3 步：导出链接资料

链接资料回答的是"`CALL foo()` 里的 foo 在哪个文件里定义"。
它来自生产库的 `DS.GAL_FILE` 表（程序与 4GL 文件的链接关系）。

**三种采集方式，按可用性从高到低选一个。**

#### A.5.1 方式 A：本地直连 Oracle（推荐，无需 sqlplus）

需要能连到生产库、网络可达、有一个只读账号。

```bash
cd "$WORKSPACE"
mkdir -p .link

export BDL_ORA_PASSWORD='<只读账号密码>'   # 不要写进任何文件

tiptop link sync \
  -root "$WORKSPACE" \
  -source golang \
  -host <Oracle主机> \
  -port 1521 \
  -service <服务名> \
  -user <只读账号>
```

成功后 `.project/link/` 下会有（`secrets.json` 在 `.project/` 根）：

```text
.project/link/
├── links.jsonl        # 链接资料（链、文件、MAIN）
└── links.meta.json    # 元信息（来源、统计、schema 版本）
```

**密码的两种给法**（不要写进 `settings.json`，会被提交）：

```bash
# 方式 A-1：环境变量（推荐）
export BDL_ORA_PASSWORD='<密码>'

# 方式 A-2：密文件（无人值守 / 不想每次 export）
cat > .project/secrets.json <<'EOF'
{ "<只读账号>": "<密码>" }
EOF
chmod 600 .project/secrets.json
```

#### A.5.2 方式 B：从生产端用 sqlplus 导出 CSV，再本地导入

适合本地连不上库、但能 SSH 到生产机的情况。

**在生产机执行**（`tiptop` 仓库的脚本，或手写 SQL）：

```bash
# 方式 B-1：用仓库里的脚本（交互输入密码，不进 history）
bash scripts/fetch-gal-file.sh /tmp/gal_file.csv

# 方式 B-2：手写 sqlplus
sqlplus -s /nolog <<'SQL'
SET HEADING ON
SET FEEDBACK OFF
SET PAGESIZE 0
SET LINESIZE 32767
SET TRIMSPOOL ON
SET MARKUP CSV ON DELIMITER , QUOTE ON
SELECT gal01, gal02, gal03, gal04 FROM DS.GAL_FILE WHERE gal04 = 'Y';
EXIT
SQL
```

**拉回本地并导入**：

```bash
scp <用户名>@<生产主机>:/tmp/gal_file.csv "$WORKSPACE/.project/link/"
cd "$WORKSPACE"

tiptop link import -csv .project/link/gal_file.csv -root "$WORKSPACE"
```

> CSV 必须有表头 `GAL01,GAL02,GAL03,GAL04`（`link import` 按表头定位列）。
> `gal04='Y'` 表示"确实链接"，`'N'` 的行会被自动过滤。

#### A.5.3 方式 C：用外部命令采集

如果你们已有导出脚本（能输出上面那份 CSV），直接用它：

```bash
cd "$WORKSPACE"

tiptop link sync \
  -root "$WORKSPACE" \
  -source command \
  -command '<你们的导出命令，输出 CSV 到 stdout>'
```

#### A.5.4 验证资料已生成

```bash
cd "$WORKSPACE"

ls -lh .project/link/
tiptop link status -root "$WORKSPACE"
```

`tiptop link status` 应显示链数、文件数与生成时间。**这一步没有输出"链 0"就说明没成功**。

> **`tiptop` 是什么**：链接资料的采集与部署由 tiptop 负责，它是从
> 语言服务器 `bdl-lsp` 分离出来的独立工具。语言服务器只读取 `.project/` 资料，
> 不负责生成它。平台扩展包同时内置两者。

如果 `tiptop` 不在 PATH 里（平台包内置，命令行不一定有）：

```bash
# 用 VSCode 内置的那份
ls ~/.vscode/extensions/darcyjoven.4gl-full-*/bin/tiptop
# 或
TIPTOP=$(ls ~/.vscode/extensions/darcyjoven.4gl-full-*/bin/tiptop | head -1)
"$TIPTOP" link status -root "$WORKSPACE"
```

### A.6 第 4 步：配置项目

#### A.6.1 `.bdl-lsp/config.json`（项目级配置，可提交）

完整示例见 [§13.6](#136-项目级配置-bdl-lspconfigjson)。生产环境的典型写法：

```jsonc
{
  "generoVersion": "2.50",

  // 诊断级别：只写要改的，其余用默认值（默认 warning）
  "diagnostics": {
    "record-member-unknown": "warning",   // 有字段资料（.project/schema）了才建议开
    "function-not-found": "warning"        // 有链接资料了才有意义
  },

  // GLOBALS 解析：跨层级引用时加候选根（相对工作区根）
  "globals": {
    "searchPaths": ["tiptop/config", "topcust/config"]
  },

  // 表单 .per 的附加查找根（相对工作区根）。
  // 默认规则已经能处理"引用文件同级的 ../per/"，只有跨模组引用才需要配。
  "perRoots": ["tiptop/aap/per"],

  // 数据库字段资料：展开 RECORD LIKE t.*、悬停 LIKE t.col 显示中文说明
  // 资料由 tiptop schema import -csv <Oracle导出.csv> 生成到下面的目录。
  "schema": {
    "enable": true,
    "dataDir": ".project/schema"
  },

  // 链接资料
  "link": {
    "enable": true,
    "dataDir": ".project/link",
    // 模组根：留空则自动探测（tiptop / topcust 优先），一般不用配
    "moduleRoots": [],
    "globalModules": ["sub", "lib", "qry"]
  },

  // 忽略清单：生成代码与历史文件
  "ignore": {
    "files": ["**/backup/**", "**/tmp/**"]
  }
}
```

#### A.6.2 `.project/deploy/deploy.json`（部署配置：**插件从设置生成**，建议不提交）

> **不用手写**：在设置里填「生产环境 → 部署」（主机/端口/账号/远程根/上传规则），
> 每次部署前插件会把它合成为 `<项目>/.project/deploy/deploy.json` 再交给 tiptop，
> 文件里带 `createdBy: "vscode-bdl <版本>"` 标记。改设置即可，改完自动生效。
>
> 手写仍然支持（`tiptop deploy -config <文件>`）；如果不是插件生成的文件，
> 第一次被覆盖前会备份成 `deploy.json.bak`。

下面是生成出来的样子（也可以照着手写）：

```jsonc
{
  "targets": {
    "prod": {
      "host": "<生产主机>",
      "port": 22,
      "user": "<生产账号>",
      "remoteRoot": "/u1/toppord",
      "localRoot": ".",
      "upload": {
        "include": ["**/*.4gl", "**/*.global", "**/*.per", "**/*.sch"],
        "exclude": ["**/.git/**", "**/.project/**", "**/.bdl-lsp/**"],
        "mode": "rsync",
        "rsyncArgs": ["-az"],
        "fallback": "scp",
        "delete": false
      },
      "compile": {
        "4gl": "fglcomp -M {file}",
        "per": "fglform {file}"
      },
      "strictHostKey": true,
      "connectTimeout": 20
    }
  },
  "defaultTarget": "prod"
}
```

> `remoteRoot` 必须是**生产端源码所在的同一目录**（`/u1/toppord`），
> 这样单文件上传后远程编译用的就是生产环境的那套依赖。
> 认证用 SSH key / ssh-agent，不支持在配置里存密码。

#### A.6.3 确认配置被读到

在 VSCode 里执行命令面板：

```text
Genero BDL: 显示语言服务器信息
```

应能看到 `bdl.diagnostics`、当前设置等信息。若提示"解析失败"，说明工作区根
选错了或 `.bdl-lsp/` 目录不在根下。

### A.7 第 5 步：单文件上传编译测试

#### A.7.1 先看计划（强烈建议先做这步）

```bash
cd "$WORKSPACE"

# 列出配置里的目标
tiptop deploy -workspace "$WORKSPACE" -list

# 预演：只打印要传什么、编译什么，不真的连生产机
tiptop deploy -workspace "$WORKSPACE" -target prod -dry-run
```

输出应包含"待处理 N 个文件"与将要执行的编译命令。

#### A.7.2 单文件上传 + 远程编译（第一个文件）

```bash
cd "$WORKSPACE"

# 只部署这一个文件：上传 + 在生产端编译
tiptop deploy -workspace "$WORKSPACE" -target prod \
  tiptop/aap/4gl/aapi202.4gl
```

分解来看等价于：

```bash
# 1) 上传（rsync 优先，失败退 scp）
rsync -az "$WORKSPACE/tiptop/aap/4gl/aapi202.4gl" \
  <生产账号>@<生产主机>:/u1/toppord/tiptop/aap/4gl/aapi202.4gl

# 2) 远程编译（{file} 会被替换成远程路径）
ssh <生产账号>@<生产主机> \
  'cd /u1/toppord && fglcomp -M tiptop/aap/4gl/aapi202.4gl'
```

> 手工核对 SSH key 是否可用：
> ```bash
> ssh <生产账号>@<生产主机> 'hostname; ls /u1/toppord | head'
> ```
> 这一步不通，后面都会失败。

#### A.7.3 编译结果怎么判断

`tiptop deploy` 会把远程编译的输出解析成诊断：

- 编译失败 → 在 VSCode 的 Problems 面板里出现该文件的错误；
- 编译成功 → 没有错误诊断，命令输出面板里显示成功。

用 JSON 看结构化结果：

```bash
tiptop deploy -workspace "$WORKSPACE" -target prod -json \
  tiptop/aap/4gl/aapi202.4gl
```

#### A.7.4 试一个 `.per` 表单

```bash
tiptop deploy -workspace "$WORKSPACE" -target prod \
  tiptop/aap/per/<某个表单>.per
```

远程命令会变成 `fglform <远程路径>`。

#### A.7.5 只上传不编译 / 只编译不上传

```bash
# 只上传
tiptop deploy -workspace "$WORKSPACE" -target prod -no-compile <文件>

# 只编译（文件已在生产端）
tiptop deploy -workspace "$WORKSPACE" -target prod -no-upload <文件>
```

#### A.7.6 在 VSCode 里做同样的事

命令面板：

| 命令 | 作用 |
|---|---|
| `上传当前文件` | 只上传当前打开的文件（不做批量同步） |
| `预演上传` | 只打印计划，不连接 |

> 上传功能**默认关闭**（轻量档）：`bdl.deploy.enable = false` 且
> `bdl.prod.deploy.transport = off`（设置界面「上传编译链接」一组）。
> 要上传时打开总开关并选 rsync/scp，并在「账号、生产环境、配置」一组填主机/账号/生产根；
> 没填全的话上传命令会明确告诉你缺哪一项，而不是含糊失败。

### A.8 第 6 步：在 VSCode 里验证

按顺序做这 6 项，能确认整套东西都通了：

| # | 操作 | 期望 |
|---|---|---|
| 1 | 打开任意 `.4gl` | 右下角语言模式显示 "Genero BDL" |
| 2 | 命令面板 → `Genero BDL: 显示语言服务器信息` | 状态"运行中"，来源是"扩展内置 bin/" |
| 3 | 悬停一个 GLOBALS 引入的变量 | 弹出"来源（GLOBALS 引入）"，只列一次来源文件 |
| 4 | `F12` 跳转到定义 | 跳到 `.global` 文件里的定义处 |
| 5 | 侧边栏"链接资料" | 展开当前程序 → 链内的 4gl 文件列表（需要第 3 步已生成资料） |
| 6 | 命令面板 → `预演上传` → `上传当前文件` | 先看路径映射，再只传当前文件 |

侧边栏"链接资料"为空，说明第 3 步的链接资料没生成或路径不对：

```bash
cd "$WORKSPACE"
tiptop link status -root "$WORKSPACE"
```

> 侧边栏"链接资料"视图受 `bdl.link.mode` 控制（设置界面「账号、生产环境、配置」一组）。
> **默认关闭**（轻量档）：视图与命令面板里的链接命令都隐藏。
> 需要时打开，并用 `Genero BDL: 链接资料：从 CSV 导入` 生成资料。

#### A.8.1 只想快速验证一个文件

不必做全套。最小验证：

```bash
cd "$WORKSPACE"
# 1) 文件能解析
bdl-lsp check tiptop/aap/4gl/aapi202.4gl
# 2) 链接资料在
tiptop link status -root "$WORKSPACE"
# 3) 部署计划对
tiptop deploy -workspace "$WORKSPACE" -dry-run tiptop/aap/4gl/aapi202.4gl
```

### A.9 排错

#### A.9.1 打包后目录结构不对

```bash
tar tzf toppord-src.tar.gz | head -20
```

期望看到 `./tiptop/aap/4gl/xxx.4gl` 这种**三层**结构。
若只有两层，说明生产端目录不是 `顶层/模组/类型` 的布局，
第 1 步的 `find -mindepth 3 -maxdepth 3` 要按实际层级调整。

#### A.9.2 `tiptop link import` 报"表头缺少 GAL01..GAL04"

CSV 表头不对。用 `SET MARKUP CSV ON` 导出（见 [A.5.2](#a52-方式-b从生产端用-sqlplus-导出-csv再本地导入)），或手工加表头行：

```bash
head -1 .project/link/gal_file.csv
# 期望：GAL01,GAL02,GAL03,GAL04
```

#### A.9.3 `tiptop link import` 结果是"链 0"

- `gal04` 全是 `'N'`：SQL 条件写错了，应为 `WHERE gal04 = 'Y'`；
- 表里确实没数据：确认连的是正确的库；
- 用 `tiptop link status -root "$WORKSPACE"` 复核。

#### A.9.4 链接资料有，但 `function-not-found` 还是报

- 确认 `bdl.link.mode` 不是 `off`（设置界面「账号、生产环境、配置」一组；**默认是关的**，
  轻量档不会自动去加载资料）；
- 确认 `bdl.link.dataDir` 与实际目录一致（默认 `.project/link`）；
- 资料**旧**不会告警（P1-6 去掉了"7 天过期"提示）：同步只由命令触发，
  想更新就执行 `Genero BDL: 从数据库更新` 或 `链接资料：全量更新`。

#### A.9.5 GLOBALS 变量跳转不到

- 确认 `bdl.globals.searchPaths` 覆盖了实际的 config 目录；
- 确认 GLOBALS 引用是相对路径时，工作区根没选错。

#### A.9.6 部署失败

| 现象 | 检查 |
|---|---|
| 找不到 `tiptop` | 用平台包里的：`~/.vscode/extensions/darcyjoven.4gl-full-*/bin/tiptop`；或在设置里填 `bdl.tools.path` |
| SSH 认证失败 | `ssh <账号>@<主机> 'echo ok'` 手动验证；检查 key/agent |
| 远端没有该目录 | `remoteRoot` 要与生产端源码目录一致（`/u1/toppord`） |
| 远端找不到 `fglcomp` | 远程命令走登录 shell 的 `PATH`；用绝对路径或确认 `.bash_profile` 里有 Genero 环境 |
| 上传了但没编译 | 目标缺少 `compile` 配置，或用了 `-no-compile` |
| 编译报找不到子文件 | `remoteRoot` 与本地目录层级不一致，导致相对 include 解析不到 |

#### A.9.7 第一次索引很慢

工作区索引要扫全部文件（通常几分钟、也可能更长，进度见输出）。
大项目建议：

- 把 `bdl.limits.maxFileBytes` 调大一点（默认 2 MB），
  否则超大文件会被跳过；
- 用 `bdl.ignore.files` 排除生成代码与备份目录。

#### A.9.8 密码相关

- **不要**把 Oracle 密码写进 `settings.json` 或提交进仓库；
- 用 `BDL_ORA_PASSWORD` 环境变量，或 `.project/secrets.json`（`chmod 600`，
  且 `.project/` 已在 `.gitignore` 里）。

### A.10 一键脚本（已由 `scripts/init-project/` 取代）

初始化项目不再需要手写脚本：用 VSCode 命令 **`Genero BDL: 初始化项目（从生产服务器拉取代码）`**
或直接跑 `scripts/init-project/init-project.sh`（Linux/WSL）/ `init-project.ps1`（Windows），
用法见 [第 1 章](#1-初始化项目从生产服务器拉取代码)；参数对照表在
[`scripts/init-project/README.md`](scripts/init-project/README.md)。

### A.11 完整命令速查

#### A.11.1 VSCode 命令

| 命令 | 用在哪一档 | 说明 |
|---|---|---|
| `重启语言服务器` / `显示语言服务器信息` | 全部 | 排障两条；信息里可点「打开日志」 |
| `强制解析当前文件` | 全部 | 大文件被跳过时，标题栏出现按钮；后台不限时解析，完成后刷新大纲并提示耗时 |
| `迁移项目资料目录` | ①② | 旧布局（`.link/`、`.project` 根、`.project/.schema/`）一键搬到 `.project/{link,schema,deploy}/` |
| `链接资料：从 CSV 导入` | ② ① | 选 CSV → 复制到 `.project/link/gal_file.csv` → 确认后导入 |
| `链接资料：全量更新` / `按模组更新` / `从数据库更新` | ①（`mode=db`） | 只重算受影响的部分，其余链保留；`从数据库更新` 只动当前文件 |
| `链接资料：查看状态` | ①② | 链数/文件数/生成时间 |
| `反查引用程序` / `显示更多反查结果` / `刷新` | ①② | 链接资料视图 |
| `数据库字段：从 CSV 导入` | ② | 表字段 CSV → `.project/schema` |
| `数据库字段：从数据库同步` | ① | 直连库全量同步 |
| `数据库字段：同步选中的表` / `同步已选中的表` / `全选当前列表` / `清除勾选` | ①② | 一张 / 多张；筛选后先「全选」再「同步已选中」 |
| `数据库字段：正则过滤表名` / `清除过滤` / `刷新` | ①② | 正则、大小写不敏感；非法正则退回全部；清除过滤恢复全部 |
| `数据库字段：复制列定义` / `打开表资料文件` | ①② | 得到 `LIKE 表.列` / 打开该表 JSON |
| `4GL：预演编译` / `4GL：编译` / `4GL：链接` | ③ | 编辑器右上角按钮（`.4gl`）；**在生产服务器上执行**；无 MAIN 时「链接」不可用。模板见 [§8.10](#810-编译--链接--预览在生产服务器上执行) |
| `Form：预演编译` / `Form：编译` / `Form：预览画面` | ③ | 编辑器右上角按钮（`.per`）；**在生产服务器上执行**。模板见 [§8.10](#810-编译--链接--预览在生产服务器上执行) |
| `上传当前文件` / `预演上传` | ①（`bdl.deploy.enable` + `transport ≠ off`） | 由 `tiptop upload` 执行；只传当前文件。命令面板 / 编辑器工具栏 / 编辑器右键都有入口 |

#### A.11.2 `tiptop` / `bdl-lsp` 命令行

```bash
# ===== 链接资料 =====
tiptop link import -csv /path/to/gal_file.csv -root .          # 从 CSV 导入
tiptop link sync   -root . -source file    -file /path/to/gal_file.csv
tiptop link sync   -root . -source command -command '<导出命令>'
BDL_ORA_PASSWORD=... tiptop link sync -root . -source golang \
  -host <主机> -port 1521 -service <服务名> -user <只读账号>
tiptop link status -root .                                      # 链数/文件数/生成时间

# ===== 数据库字段资料 =====
tiptop schema import -csv gal_schema.csv -root .                # 从 CSV 导入
tiptop schema sync   -root . -host <主机> -service <服务名> -user <应用schema账号>
tiptop schema status -root .                                    # 表数/列数/导入时间

# ===== 单文件上传 / 生产端执行（插件用的就是这两条）=====
tiptop upload -workspace . -file topcust/aap/4gl/globals_main.4gl           # 只传这一个文件
tiptop upload -workspace . -file topcust/aap/4gl/globals_main.4gl -dry-run  # 只打印计划
tiptop exec   -workspace . -command 'cd aap/4gl && r.c2 globals_main'       # 生产端执行（工作目录=生产根）

# ===== 部署（整包/多文件，命令行）=====
tiptop deploy -workspace "$WORKSPACE" -list                     # 列出 targets
tiptop deploy -workspace "$WORKSPACE" -target prod -dry-run     # 预演
tiptop deploy -workspace "$WORKSPACE" -target prod <文件>        # 上传 + 编译
tiptop deploy -workspace "$WORKSPACE" -target prod -json <文件>  # 结构化结果
tiptop deploy -workspace "$WORKSPACE" -target prod -no-compile <文件>   # 只上传
tiptop deploy -workspace "$WORKSPACE" -target prod -no-upload  <文件>   # 只编译
tiptop deploy -config <文件>                                     # 用手写配置

# ===== 单文件检查（语言服务器 CLI） =====
bdl-lsp check tiptop/aap/4gl/aapi202.4gl
```

#### A.11.3 从生产端建工作区（完整流程）

```bash
# ===== 变量 =====
export WORKSPACE="$HOME/work/toppord"
export PROD_USER="<生产账号>"
export PROD_HOST="<生产主机>"

# ===== ① 生产端打包 =====
ssh "$PROD_USER@$PROD_HOST" 'cd /u1/toppord && \
  find . -mindepth 3 -maxdepth 3 -type d \( -name 4gl -o -name per -o -name sch \) -print \
  | tar czf /tmp/toppord-src.tar.gz -T -'

# ===== ② 拉回并解压 =====
scp "$PROD_USER@$PROD_HOST":/tmp/toppord-src.tar.gz "$WORKSPACE/"
cd "$WORKSPACE" && tar xzf toppord-src.tar.gz

# ===== ③ Git 初始化 =====
cd "$WORKSPACE"
git init -b main
printf '.project/\n.project/deploy/deploy.json\n*.o\n*.err\n*.form\n' > .gitignore
git add -A && git commit -m "从生产端导入源码"

# ===== ④ 链接资料 =====
cd "$WORKSPACE" && mkdir -p .link
export BDL_ORA_PASSWORD='<密码>'
tiptop link sync -root "$WORKSPACE" -source golang \
  -host <Oracle主机> -service <服务名> -user <只读账号>
tiptop link status -root "$WORKSPACE"

# ===== ⑤ 部署测试 =====
cd "$WORKSPACE"
tiptop deploy -workspace "$WORKSPACE" -list
tiptop deploy -workspace "$WORKSPACE" -target prod -dry-run
tiptop deploy -workspace "$WORKSPACE" -target prod \
  tiptop/aap/4gl/aapi202.4gl

# ===== ⑥ 打开 =====
code "$WORKSPACE"
```

### A.12 目录结构速查

```text
$WORKSPACE/
├── .bdl-lsp/
│   ├── config.json          # 项目配置（可提交）
│   └── builtins.json        # 可选：项目自定义内置符号（bdl.builtins.paths）
├── .project/                   # 项目资料（不提交；根只留 secrets.json）
│   ├── secrets.json            # 可选：Oracle 密码（chmod 600）
│   ├── link/
│   │   ├── links.jsonl
│   │   ├── links.meta.json
│   │   └── gal_file.csv        # 方式 B 的中间产物
│   ├── schema/
│   │   ├── tables.json
│   │   ├── tables/<表>.json
│   │   └── gal_schema.csv      # 表字段 CSV 落点
│   └── deploy/
│       ├── deploy.json         # 部署配置（含主机，建议不提交；插件从设置合成）
│       └── deploy.json.bak     # 手写配置首次被覆盖前的备份
├── tiptop/
│   └── <模组>/
│       ├── 4gl/*.4gl *.global
│       ├── per/*.per
│       └── sch/*.sch        # 旧：P2-1 起不再读；表字段改用 .project/schema（DBA 导出）
└── topcust/
    └── ...
```

> 注：早期速查表把 `deploy.json` 列在 `.bdl-lsp/` 下；实际路径是
> `<项目>/.project/deploy/deploy.json`（本表已按实际路径列出）。迁移前的链接资料目录是 `.link/`，
> 用命令 `Genero BDL: 迁移项目资料目录` 搬到 `.project/{link,schema,deploy}/`。

---

## 附录 B：配图与录屏清单

图片放 `docs/images/guide/`，命名见下表；拍好后把占位块替换成 `![说明](docs/images/guide/文件名)`。
素材规范（宽高、打码要求）见 [`docs/images/guide/README.md`](docs/images/guide/README.md)。

### B.1 引导图（`docs/images/guide/`）

| 编号 | 文件 | 拍什么 | 用在哪 |
|---|---|---|---|
| G1 | `01-three-modes.png` | 三档总览（可用本节表格改图） | §6 |
| G2 | `02-install.png` | 扩展面板安装 `Genero BDL (4GL)` | §5.1 |
| G3 | `03-jump-hover.gif` | 跳转定义 + 悬停看来源 | §8.4 |
| G4 | `04-outline.png` | 大纲面板 | §8.3 |
| G5 | `05-export-csv.png` | 生产端导出的两份 CSV | §11.1 |
| G6 | `06-import-csv.png` | "从 CSV 导入"的确认框 | §11.3 |
| G7 | `07-schema-view.png` | 「数据库字段」视图 + 字段中文说明 | §10.3 |
| G8 | `08-oracle-settings.png` | 「生产环境」四项设置（打码） | §11.5 |
| G9 | `09-sync-progress.png` | 同步进度通知（解析表 i/N） | §10.3 |
| G10 | `10-schema-multi-select.png` | 勾选多张表 + 批量同步 | §10.3 |
| G11 | `11-deploy.png` | 部署预演与结果 | §12 |

### B.2 截图/录屏（`docs/images/vscode/`）

素材规范见 [`docs/images/vscode/README.md`](docs/images/vscode/README.md)。

| 编号 | 文件 | 用在哪 |
|---|---|---|
| 01 | `docs/images/vscode/01-install.png` | §5.1 安装 |
| 02 | `docs/images/vscode/02-first-open.png` | §7.1 第一次打开 |
| 03 | `docs/images/vscode/03-hover.gif` | §8.4 悬停/跳转 |
| 04 | `docs/images/vscode/04-completion.gif` | §8.6 补全 |
| 05 | `docs/images/vscode/05-format.gif` | §8.9 格式化 |
| 06 | `docs/images/vscode/06-field-fix.png` | §9.2 字段诊断 |
| 07 | `docs/images/vscode/07-link-view.png` | §11.4 链接视图 |
| 08 | `docs/images/vscode/08-link-reverse.gif` | §11.4 反查 |
| 09 | `docs/images/vscode/09-deploy.png` | §12.2 部署 |
| 10 | `docs/images/vscode/10-settings.png` | §13.1 设置页 |

---

## 附录 C：本地开发与许可

```bash
npm install
npm run typecheck        # 类型检查
npm run build            # 打 bundle（esbuild）
npm run package          # 打 VSIX（平台包内置 bdl-lsp / tiptop，需要先构建它们）
npm run test:e2e         # 无头 VSCode 端到端测试（50 个用例）

# 从生产服务器初始化一个 4GL 项目仓库：
#   ① VSCode 命令面板 →「Genero BDL: 初始化项目（从生产服务器拉取代码）」
#      （有密钥用密钥；没配密钥时可在过程中输入密码——只有初始化允许，上传/编译仍需密钥）
#      （按客户端平台自动选脚本：Windows→PowerShell，Linux/WSL→bash；在集成终端里执行）
#   ② 或命令行（详见 scripts/init-project/README.md）
scripts/init-project/init-project.sh -t <user@host> -r /u1/topprod -d <本地目录> -y   # Linux/WSL：rsync 拉取
scripts/init-project/init-project.sh -t <host> -r /u1/topprod --print-remote          # 审计：远端只跑只读命令
scripts/init-project/test-local.sh   # 离线自测（不需要服务器，36 项）
```

- 仓库只保留 VSCode 交付物；**计划、待办、测试脚本、过程记录都在 `bdl-lsp` 仓库**；
- 语言服务器与 CLI 在 `bdl-lsp`，采集/部署工具在 `tiptop`，语法在 `tree-sitter-bdl` / `tree-sitter-per`。

许可：MIT（见仓库 `LICENSE`）。

---

## 更多文档

| 文档 | 内容 |
|---|---|
| [功能文档](docs/FEATURES.md) | **本仓库三个组件按类型整合的功能清单**（插件 + `bdl-lsp` + `tiptop`） |
| [待办清单](docs/TODO.md) | 已知待办与计划 |
| [待确认记录](docs/OPEN-ITEMS.md) | 待确认/待决策事项 |
| [bdl-lsp 功能文档](https://github.com/darcyjoven/bdl-lsp/blob/main/docs/FEATURES.md) | 语言服务器仓库的功能清单 |
| [tiptop 功能文档](https://github.com/darcyjoven/tiptop/blob/main/docs/FEATURES.md) | 采集/部署工具仓库的功能清单 |