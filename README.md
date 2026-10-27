# 4gl (4GL) for VSCode

4gl（`.4gl` / `.global`）与 Form（`.per`）的语言支持：**语法高亮、定义/引用跳转、符号大纲、悬停、补全、格式化、语法诊断**。
本项目适配 TiTop-GP 版 ERP，可用功能有**跨模块函数可见性**、**数据库字段说明**与**远程部署**；其它版本的项目需要二次开发才能使用这些功能。

> 本项目包含两个二进制执行文件：[bdl-lsp 语言服务器](https://github.com/darcyjoven/bdl-lsp)、[tiptop 专用于 TiTop-GP 的工具](https://github.com/darcyjoven/tiptop)。

## 目录

1. [安装](#1-安装)
2. [项目初始化](#2-项目初始化)
3. [链接资料、数据库字段初始化](#3-链接资料数据库字段初始化)
4. [上传、编译、链接、预览](#4-上传编译链接预览)
5. [功能清单](#5-功能清单)
6. [附录](#6-附录)

## 1. 安装

### 1.1 安装方式

两种方式任选：

1. 在 VSCode 扩展市场（扩展面板）搜索 `4gl (4GL)`（扩展 ID `darcyjoven.4gl-full`），点**安装**；
   市场会按你的系统/芯片分发对应平台包。
2. 或下载平台 `.vsix`（如 `4gl-full-1.0.0-win32-x64.vsix`），在"扩展 → … → 从 VSIX 安装"中选择该文件。

装好后：

1. 打开你的项目文件夹（`.4gl` / `.per` 所在目录）；
2. 打开任意一个 `.4gl`，右下角状态栏出现 **4gl** 表示就绪。

![alttext](https://qn.darven.top/extension.png)

### 1.2 插件偏好

- 开发者用的是 Linux 环境、用 WSL 开发：所有功能在 WSL 里测试覆盖更多，且不少功能在 Linux 下运行更快，建议 Windows 用户切到 WSL 使用；
- 所有插件配置建议使用 **Workspace** 级别，不要全局设置，并注意敏感信息。

## 2. 项目初始化

*目标*：把生产端 `/u1/topprod` 下的 `*.4gl` / `*.per` / `*.global` 拉到本地，变成一个带 git 的工程。

前置条件

| # | 条件 | 说明 |
|---|---|---|
| 1 | 能 SSH 到生产服务器 | **有密钥最好**；本阶段没配密钥也可以，过程中会提示输入密码 |
| 2 | 本地工具 | VSCode 方式需要先装扩展；终端方式需要 `git` + `ssh`（Linux 还需 `rsync`；Windows 自带 `ssh`/`scp`/`tar`） |
| 3 | 生产根路径 | 默认 `/u1/topprod`；只取它下面 `tiptop`、`topcust` 两个顶层目录里的 `*/4gl/*.4gl`、`*/per/*.per`，以及任意目录的 `*.global` |

### 2.1 VSCode 中直接运行

命令面板中搜 **`4gl: 初始化项目（从生产服务器拉取代码）`**

![init](https://qn.darven.top/init.png)

1. 用哪个脚本，**自动**（Windows → PowerShell 脚本；Linux/WSL/**Remote-WSL** → bash 脚本），也可强制选某一个

![whichshell](https://qn.darven.top/whichshell.png)

2. SSH 目标，`user@host`，或 `~/.ssh/config` 里的**别名**（端口/密钥写在 ssh config 里最省事）

![erphost](https://qn.darven.top/erphost.png)

3. 登录后的区域，默认 `1`：(1) topprod (2) toptest (3) topstd (4) Browser-based；清空表示登录后不用选区
   （只有 PowerShell 流程会问这一步，bash/rsync 不需要）

4. 生产根目录，默认 `/u1/topprod`

![productroot](https://qn.darven.top/productroot.png)

5. 目标目录，默认**当前工作区**，也可以选别的文件夹

![localroot](https://qn.darven.top/localroot.png)

6. 选项（多选）：增量更新、删除本地多余、不自动提交、只预演；**允许在过程中输入密码**（默认勾选）

![moreparam](https://qn.darven.top/moreparam.png)

7. 源编码：自动（按服务器样本检测并在终端里问你）/ GBK / BIG5 / 不转码

![encode](https://qn.darven.top/encode.png)

8. 运行后，终端里会显示进度

![progress](https://qn.darven.top/progress.png)

### 2.2 终端中运行

**Linux（rsync 拉取，增量最快）**

```bash
# 在 vscode-bdl 本仓库里（或把 scripts/init-project/ 拷到任意位置）
scripts/init-project/init-project.sh \
  -t tiptop@192.168.1.19 \
  -r /u1/topprod \
  -d ~/tiptop-gp \
  --update --from-encoding gbk
```

**Windows（生产端 tar 打包 → scp 回本地 → 解压 → 清理两端中间文件）**

```shell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\init-project\init-project.ps1 `
  -Target tiptop@192.168.1.19 -RemoteRoot /u1/topprod -Dest D:\code\topprod-gp `
  -Region 1 -Update -FromEncoding gbk
```

其它参数介绍

| 用途 | Linux | Windows |
|---|---|---|
| 先空跑看计划（不写盘） | `--dry-run` | `-DryRun` |
| 只看服务器上会执行什么（审计） | `--print-remote` | `-PrintRemote` |
| 增量更新（目标已存在时必须给） | `--update` | `-Update` |
| 删除本地多余的源文件（默认**不删**，会先列清单确认） | `--delete` | `-Delete` |
| 只取某些模组 | `--module topcust,other` | `-Module topcust,other` |
| 跳过编码询问 | `--from-encoding gbk` | `-FromEncoding gbk` |
| 没配密钥时用密码登录 | `--ask-password` | `-AskPassword` |
| 登录后先选区（默认 `1`，清空 = 不选） | —（rsync 不需要） | `-Region 1` |
| 老服务器 `ssh-rsa`/SHA-1 兼容 | `--legacy-ssh` | `-LegacySsh` |

### 2.3 拉取代码之后会自动做这些设置

- `git init -b main` + 自动提交（`chore: 从 <host>:<root> 初始化/更新生产代码镜像`）；
- 生成 `.gitignore`、`.gitattributes`、`.editorconfig`、`.vscode/settings.example.json`、`README-PROJECT.md`（来源说明 + 重新初始化命令）；
- **换行固定为 LF**：`*.4gl`/`*.per`/`*.global` 全部 `text eol=lf`，仓库配置 `core.autocrlf=false` + `core.eol=lf`，所以在 Windows 上改完**不会**产生空白符差异；
- 跑完会打印校验：`git ls-files --eol` 应全是 `i/lf w/lf`，`git diff --check` 无告警。

### 2.4 初始化常见问题

| 现象 | 处理 |
|---|---|
| `no matching host key type / kex`（老服务器） | 脚本会自动按 `ssh-rsa`/SHA-1 兼容重试；也可显式 `--legacy-ssh` / `-LegacySsh` |
| `Permission denied (publickey)` | 没配密钥：脚本会问是否改用密码登录（或加 `--ask-password`）；上传/编译必须先配密钥 |
| 中文乱码 | 先用 `--dry-run`/`-DryRun` 看编码报告（含候选与预览），再用 `--from-encoding big5` 重跑 |
| 提示"目标已存在" | 二次拉取要加 `--update`/`-Update` |
| 远端 `/u1/out` 里有残留包 | 上次被强杀（清理没跑到），删掉即可；脚本每次用唯一名，不会冲突 |
| Windows 组策略禁止脚本 | 从「4gl 任务」通道复制命令行，在终端里手动执行 |

## 3. 链接资料、数据库字段初始化

**目标**：让"跨模块函数跳转/链接资料视图/反查引用"与"字段中文说明 / `LIKE t.*` 成员校验 / 列补全"可用。
两份资料互相独立，可以只做一份，建议两份都做。

### 3.1 打开总开关（默认不启用）

- 链接是否启用：`file` 解析你导出的 CSV，`db` 配置数据库连接后自动同步，`off` 不启用

![linkenable](https://qn.darven.top/linkenable.png)

用以下 SQL 自己导出 CSV 文件，字段名不要修改：

```sql
SELECT gal01, gal02, gal03, gal04 FROM DS.GAL_FILE WHERE gal04 = 'Y';
```

- 数据字段是否启用：`file` 解析你导出的 CSV，`db` 配置数据库连接后自动同步，`off` 不启用

![schemaenable](https://qn.darven.top/schemaenable.png)

用以下 SQL 自己导出 CSV 文件，字段名不要修改：

```sql
SELECT z.zta01 AS table_name,
       LOWER(c.column_name) AS column_name,
       NVL(g.gaq03, '') AS column_desc,
       c.data_type, c.data_length, c.char_length, c.data_precision,
       c.data_scale, c.nullable, c.default_length
  FROM ds.zta_file z
  JOIN user_tab_columns c ON c.table_name = UPPER(z.zta01)
  LEFT JOIN ds.gaq_file g ON g.gaq01 = UPPER(c.column_name) AND g.gaq02 = '2'
 WHERE z.zta02 = 'ds'
 ORDER BY z.zta01, c.column_name;
```

> 打开总开关之后，如果还未显示链接等命令，重启语言服务器或者 VSCode。

### 3.2 配置数据库连接

![oracle](https://qn.darven.top/oracle.png)

使用数据库自动同步，需要配置数据库连接方式。只要有上一小节两张表的查询权限的用户即可。
密码放在 `BDL_ORA_PASSWORD` 环境变量，或者写入文件 `<项目>/.project/secrets.json`（`chmod 600`），JSON 内容为：

```json
{"dbuser":"dbpassword"}
```

### 3.3 同步

- VSCode 运行

按照不同方式在命令面板中选择不同功能，数据库字段和链接资料可以分别同步。

> 数据库字段同步很快，链接资料同步需要几分钟时间，会有进度显示，请耐心等待。

*进度显示*

![progresssync](https://qn.darven.top/progresssync.png)

- 终端运行

也可以直接用 `tiptop` 执行文件在终端同步：

```bash
BDL_ORA_PASSWORD=... tiptop link   sync -root . -source golang -host <主机> -service <服务名> -user <账号>
BDL_ORA_PASSWORD=... tiptop schema sync -root . -host <主机> -service <服务名> -user <账号> \
  -batch-size 200 -timeout 120
```

（Windows PowerShell 里用 `$env:BDL_ORA_PASSWORD = "..."` 设置环境变量。）

*完成显示*

> 需要重启语言服务器或者 VSCode。

- 总页面

![allview](https://qn.darven.top/allview.png)

- 跨文件函数跳转

![jump](https://qn.darven.top/jump.png)

- 字段悬浮提示类型和说明

![column](https://qn.darven.top/column.png)
![recordlike](https://qn.darven.top/recordlike.png)

## 4. 上传、编译、链接、预览

> 2026年10月27日，此功能还未经过完整测试，请不要使用此功能！！！

为了安全考虑，上传、编译、链接只允许配置密钥使用，如果没有权限请手动上传、编译，无法使用此功能。

### 4.1 总开关

- 上传总开关

![upload](https://qn.darven.top/upload.png)

- 编译、链接、预览画面总开关

![complie](https://qn.darven.top/complie.png)

- 上传方式默认 `off`，改成 `scp`（Linux 环境可以用 `rsync`）；本项目只允许单个文件上传，两者差别不大

![synccmd](https://qn.darven.top/synccmd.png)

### 4.2 生产服务器与登录区域

| 设置 | 说明 |
|---|---|
| `bdl.prod.deploy.host` / `port` / `user` | SSH 主机 / 端口 / 账号（**只支持密钥登录**） |
| `bdl.prod.deploy.region` | 登录后要输入的「区」，默认 `1`：`1`=topprod、`2`=toptest、`3`=topstd、`4`=Browser-based |
| `bdl.prod.deploy.remoteRoot` | 生产根目录，如 `/u1/topprod` |

编译 / 链接 / 预览会在远端登录后**先输入这个区号**，再 source 对应的环境脚本
（`1`→`/u1/usr/profile/profile.topprod`、`2`→`profile.toptest`、`3`→`profile.topstd`、`4`→ 不 source），
最后 `cd` 到生产根执行命令。**区域没配置时这些命令会直接报错**，并给出设置入口。
初始化项目用的是脚本自己的 `-Region`/`--region` 参数，与这里无关。

### 4.3 编辑器工具栏

开关打开之后，编辑器右上角的工具栏会显示编译等按钮组；`.4gl` / `.per` 的按钮不相同。

![4gl](https://qn.darven.top/4gl.png)
![per](https://qn.darven.top/per.png)

### 4.4 编译、链接、预览命令

这些命令模板可以修改，模板里可以使用占位符，分隔符恒为 `/`：

- `${path}` 两层目录（如 `axc/4gl`）
- `${fullpath}` 三层目录（如 `tiptop/axc/4gl`）
- `${name}` 去扩展名
- `${fullname}` 含扩展名

> 链接命令，还允许在链接的时候重新指定主程序名

## 5. 功能清单

| 能力 | 触发方式 | 说明 |
|---|---|---|
| 语法高亮 | 打开文件 | `.4gl` / `.global` / `.per` 静态高亮 |
| 语义高亮 | 自动 | 变量、函数、参数按语义着色（VSCode 专属） |
| 语法/语义诊断 | 打开、编辑、保存 | Problems 面板显示 |
| 悬停 | 鼠标停留 | 变量来源、定义位置、函数信息 |
| 跳转定义 | `F12` / `Ctrl+Click` | 当前文件、GLOBALS、链接资料 |
| 查找引用 | `Shift+F12` | 当前工作区可解析的引用（自动排除注释与字符串） |
| 补全 | 输入时 / `Ctrl+Space` | 关键字、变量、函数、表名等 |
| 重命名 | `F2` | **只改当前文件**，不会跨文件重命名 |
| 快速修复 | `Ctrl+.` | 目前只有"字段名写错"的修复 |
| 格式化 | `Shift+Alt+F` | 只支持 `.4gl` / `.global`，跳过 `.per` |
| 大纲/面包屑 | 自动 / `Ctrl+Shift+O` | MAIN / FUNCTION / REPORT / DEFINE / RECORD / SCREEN RECORD 等符号 |
| 表单字段校验 | 打开 `.4gl` | `INPUT … FROM f01` 里的字段在 `.per` 里不存在 → `field-not-in-form` + Quick Fix |
| GLOBALS 跨文件 | 自动 | 项目里有 `.global` 就自动生效：全局变量的跳转与来源标注 |
| 链接资料视图 | 侧边栏"链接资料" | 查看程序引用关系、反查引用程序（VSCode 专属） |
| 数据库字段 | 侧边栏"数据库字段" | 悬停字段中文说明、`RECORD LIKE t.*` 成员校验 |
| 编译/链接/预览 | 编辑器右上角按钮 / 命令面板 | `.4gl` 预演编译/编译/链接、`.per` 预演编译/编译/预览画面；命令在**生产服务器**上执行，模板可自定义（需先上传文件） |
| 上传当前文件 | 命令面板 / 编辑器右上角 / 右键菜单 | 「预演上传」只打印计划，「上传当前文件」只传当前打开的那一个文件（见第 4 章） |

> 说明：扩展**不做类型检查、不做赋值兼容性检查，也不做跨文件重命名**。
> 变量检查只回答"这个名字有没有来源"，函数检查只回答"这个名字有没有定义"。

## 6. 附录

### 6.1 我的配置

```json
{
    "bdl.prod.deploy.host": "192.168.1.1",
    "bdl.prod.deploy.user": "tiptop",
    "bdl.prod.deploy.region": "1",
    "bdl.prod.oracle.host": "192.168.1.2",
    "bdl.prod.oracle.service": "topprod",
    "bdl.prod.oracle.user": "dbuser",
    "bdl.schema.mode": "db",
    "bdl.prod.deploy.remoteRoot": "/u1/topprod",
    "bdl.deploy.enable": true,
    "bdl.build.enable": true,
    "bdl.link.mode": "db",
    "bdl.format.keywords": "lower",
    "bdl.prod.deploy.transport": "scp"
}
```
