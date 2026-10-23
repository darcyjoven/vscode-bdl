# 生产项目工作区搭建指引

> 面向"把生产端 `/u1/toppord` 拉成本地工作区，并在 VSCode 里完整用起来"的
> 全流程。命令均可直接复制执行，方括号 `<>` 里的内容按实际替换。
>
> 涉及的插件：VSCode 扩展 `4gl-full`（`darcyjoven.4gl-full`）。
> Zed 扩展暂不支持内置二进制与本流程的部署部分。

## 目录

1. [整体流程](#1-整体流程)
2. [第 0 步：准备工作区目录](#2-第-0-步准备工作区目录)
3. [第 1 步：从生产端打包源码](#3-第-1-步从生产端打包源码)
4. [第 2 步：解压并初始化 Git 仓库](#4-第-2-步解压并初始化-git-仓库)
5. [第 3 步：导出链接资料](#5-第-3-步导出链接资料)
6. [第 4 步：配置项目](#6-第-4-步配置项目)
7. [第 5 步：单文件上传编译测试](#7-第-5-步单文件上传编译测试)
8. [第 6 步：在 VSCode 里验证](#8-第-6-步在-vscode-里验证)
9. [排错](#9-排错)

---

## 1. 整体流程

```text
生产端 /u1/toppord
   │  ① tar 打包（只含源码）
   ▼
本地包文件 xxx.tar.gz
   │  ② 解压 → git init
   ▼
本地工作区
   │  ③ 导出 DS.GAL_FILE → tiptop link import → .project/links.jsonl
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
| `*/*/sch/*.sch` | 数据库表结构 | 展开 `RECORD LIKE t.*` 的成员；不开 schema 时记录成员校验不可用 |

> `*/*/` 是**两级**目录：`/<顶层>/<模组>/4gl/...`，例如
> `/u1/toppord/tiptop/aap/4gl/aapi202.4gl`。
> 顶层目录通常是 `tiptop`、`topcust` 等；模组目录是 `aap`、`axm` 等。

---

## 2. 第 0 步：准备工作区目录

在本地选一个**空目录**作为工作区根（后面所有命令的"工作区根"都指它）：

```bash
export WORKSPACE="$HOME/work/toppord"
mkdir -p "$WORKSPACE"
cd "$WORKSPACE"
```

工作区根会被 VSCode 打开，`.bdl-lsp/config.json`、`.bdl-lsp/deploy.json`、
`.project/` 都要放在它下面。

> 迁移前的项目资料在 `.link/`；语言服务器仍会读取旧目录并提示迁移，
> 一键命令：**`Genero BDL: 迁移链接资料目录`**（搬完自动重启语言服务器）。

确认插件已安装（平台包自带语言服务器，不用另外装 `bdl-lsp`）：

```bash
code --list-extensions | grep -i 4gl
# 期望输出：darcyjoven.4gl-full
```

---

## 3. 第 1 步：从生产端打包源码

### 3.1 在生产端执行（SSH 登录生产机）

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

### 3.2 把包拉回本地

```bash
# 在本地执行
scp <用户名>@<生产主机>:/tmp/toppord-src.tar.gz "$WORKSPACE/"
cd "$WORKSPACE"
ls -lh toppord-src.tar.gz
```

### 3.3 校验包内容（可选但建议）

```bash
tar tzf toppord-src.tar.gz | head -20
echo "---- 统计 ----"
tar tzf toppord-src.tar.gz | grep -c '/4gl/.*\.4gl$'
tar tzf toppord-src.tar.gz | grep -c '/per/.*\.per$'
tar tzf toppord-src.tar.gz | grep -c '/sch/.*\.sch$'
```

三个计数应与生产端一致（生产端可先跑同样的 `find | wc -l` 对照）。

---

## 4. 第 2 步：解压并初始化 Git 仓库

### 4.1 解压

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

### 4.2 初始化 Git 仓库

```bash
cd "$WORKSPACE"

git init -b main

# 忽略不该进版本库的东西
cat > .gitignore <<'EOF'
# 链接资料（由工具生成，含环境相关信息）
.project/

# 部署配置（含主机名、账号，不同开发者不同）
.bdl-lsp/deploy.json

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

> **`.bdl-lsp/deploy.json` 建议不进版本库**：它含生产主机名与账号。
> 用 `deploy.json.example` 做模板提交，或由每个开发者本地维护。
> `.bdl-lsp/config.json`（不含敏感信息）可以提交，供团队共享。

### 4.3 确认工作区根选对

VSCode 必须打开 `$WORKSPACE` 本身（不是它的子目录），否则：

- `.bdl-lsp/config.json` 读不到；
- 链接资料目录 `.project/` 找不到；
- GLOBALS 相对路径解析的起点不对。

打开方式：

```bash
code "$WORKSPACE"
```

---

## 5. 第 3 步：导出链接资料

链接资料回答的是"`CALL foo()` 里的 foo 在哪个文件里定义"。
它来自生产库的 `DS.GAL_FILE` 表（程序与 4GL 文件的链接关系）。

**三种采集方式，按可用性从高到低选一个。**

### 5.1 方式 A：本地直连 Oracle（推荐，无需 sqlplus）

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

成功后 `.project/` 下会有：

```text
.project/
├── links.jsonl        # 链接资料（链、文件、MAIN）
├── links.meta.json    # 元信息（来源、统计、schema 版本）
└── secrets.json       # 密码（仅当用了密文件方式时才有）
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

### 5.2 方式 B：从生产端用 sqlplus 导出 CSV，再本地导入

适合本地连不上库、但能 SSH 到生产机的情况。

**在生产机执行**（`bdl-lsp` 仓库的脚本，或手写 SQL）：

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
scp <用户名>@<生产主机>:/tmp/gal_file.csv "$WORKSPACE/.project/"
cd "$WORKSPACE"

tiptop link import -csv .project/gal_file.csv -root "$WORKSPACE"
```

> CSV 必须有表头 `GAL01,GAL02,GAL03,GAL04`（`link import` 按表头定位列）。
> `gal04='Y'` 表示"确实链接"，`'N'` 的行会被自动过滤。

### 5.3 方式 C：用外部命令采集

如果你们已有导出脚本（能输出上面那份 CSV），直接用它：

```bash
cd "$WORKSPACE"

tiptop link sync \
  -root "$WORKSPACE" \
  -source command \
  -command '<你们的导出命令，输出 CSV 到 stdout>'
```

### 5.4 验证资料已生成

```bash
cd "$WORKSPACE"

ls -lh .project/
tiptop link status -root "$WORKSPACE"
```

`tiptop link status` 应显示链数、文件数、过期时间。**这一步没有输出"链 0"就说明没成功**。

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

---

## 6. 第 4 步：配置项目

### 6.1 `.bdl-lsp/config.json`（项目级配置，可提交）

```jsonc
{
  "generoVersion": "2.50",

  // 诊断级别：只写要改的，其余用默认值（默认 warning）
  "diagnostics": {
    "record-member-unknown": "warning",   // 有 .sch 了才建议开
    "function-not-found": "warning"        // 有链接资料了才有意义
  },

  // GLOBALS 解析：跨层级引用时加候选根（相对工作区根）
  "globals": {
    "searchPaths": ["tiptop/config", "topcust/config"]
  },

  // 表单 .per 的附加查找根（相对工作区根）。
  // 默认规则已经能处理"引用文件同级的 ../per/"，只有跨模组引用才需要配。
  "perRoots": ["tiptop/aap/per"],

  // schema 索引：展开 RECORD LIKE t.*
  // 注意：paths 填**目录**，不是 glob；目录本身叫 sch 或其下有 sch 都可以。
  // 模组根（tiptop/topcust）下的 sch 目录会被自动发现，通常不用配。
  "schema": {
    "enable": true,
    "paths": []
  },

  // 链接资料
  "link": {
    "enable": true,
    "dataDir": ".project",
    // 模组根：留空则自动探测（tiptop / topcust 优先），一般不用配
    "moduleRoots": [],
    "globalModules": ["sub", "lib", "qry"],
    "maxAgeDays": 7
  },

  // 忽略清单：生成代码与历史文件
  "ignore": {
    "files": ["**/backup/**", "**/tmp/**"]
  }
}
```

### 6.2 `.bdl-lsp/deploy.json`（部署配置，建议不提交）

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

### 6.3 确认配置被读到

在 VSCode 里执行命令面板：

```text
Genero BDL: 显示语言服务器信息
```

应能看到 `bdl.diagnostics`、当前设置等信息。若提示"解析失败"，说明工作区根
选错了或 `.bdl-lsp/` 目录不在根下。

---

## 7. 第 5 步：单文件上传编译测试

### 7.1 先看计划（强烈建议先做这步）

```bash
cd "$WORKSPACE"

# 列出配置里的目标
tiptop deploy -workspace "$WORKSPACE" -list

# 预演：只打印要传什么、编译什么，不真的连生产机
tiptop deploy -workspace "$WORKSPACE" -target prod -dry-run
```

输出应包含"待处理 N 个文件"与将要执行的编译命令。

### 7.2 单文件上传 + 远程编译（第一个文件）

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

### 7.3 编译结果怎么判断

`tiptop deploy` 会把远程编译的输出解析成诊断：

- 编译失败 → 在 VSCode 的 Problems 面板里出现该文件的错误；
- 编译成功 → 没有错误诊断，命令输出面板里显示成功。

用 JSON 看结构化结果：

```bash
tiptop deploy -workspace "$WORKSPACE" -target prod -json \
  tiptop/aap/4gl/aapi202.4gl
```

### 7.4 试一个 `.per` 表单

```bash
tiptop deploy -workspace "$WORKSPACE" -target prod \
  tiptop/aap/per/<某个表单>.per
```

远程命令会变成 `fglform <远程路径>`。

### 7.5 只上传不编译 / 只编译不上传

```bash
# 只上传
tiptop deploy -workspace "$WORKSPACE" -target prod -no-compile <文件>

# 只编译（文件已在生产端）
tiptop deploy -workspace "$WORKSPACE" -target prod -no-upload <文件>
```

### 7.6 在 VSCode 里做同样的事

命令面板：

| 命令 | 作用 |
|---|---|
| `Genero BDL: 部署当前文件并编译` | 上传当前打开的文件并远程编译 |
| `Genero BDL: 部署到远程服务器并编译` | 按 `include` 传整个工作区 |
| `Genero BDL: 部署预演（不上传）` | 只打印计划 |
| `Genero BDL: 列出部署目标` | 打印 `targets` |

> 部署功能可以在设置里关掉：`bdl.deploy.enable = false`
> （设置界面 "Genero BDL: 部署" 一节）。关闭后命令面板不再显示这四条命令。

---

## 8. 第 6 步：在 VSCode 里验证

按顺序做这 6 项，能确认整套东西都通了：

| # | 操作 | 期望 |
|---|---|---|
| 1 | 打开任意 `.4gl` | 右下角语言模式显示 "Genero BDL" |
| 2 | 命令面板 → `Genero BDL: 显示语言服务器信息` | 状态"运行中"，来源是"扩展内置 bin/" |
| 3 | 悬停一个 GLOBALS 引入的变量 | 弹出"来源（GLOBALS 引入）"，只列一次来源文件 |
| 4 | `F12` 跳转到定义 | 跳到 `.global` 文件里的定义处 |
| 5 | 侧边栏"链接资料" | 展开当前程序 → 链内的 4gl 文件列表（需要第 3 步已生成资料） |
| 6 | 命令面板 → `Genero BDL: 部署预演（不上传）` | 输出面板列出将上传的文件与编译命令 |

侧边栏"链接资料"为空，说明第 3 步的链接资料没生成或路径不对：

```bash
cd "$WORKSPACE"
tiptop link status -root "$WORKSPACE"
```

> 侧边栏"链接资料"视图受 `bdl.link.enable` 控制（设置界面
> "Genero BDL: 链接资料" 一节）。关掉后整个视图会隐藏，
> 打开它才会显示"链接资料功能已关闭"。

### 8.1 只想快速验证一个文件

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

---

## 9. 排错

### 9.1 打包后目录结构不对

```bash
tar tzf toppord-src.tar.gz | head -20
```

期望看到 `./tiptop/aap/4gl/xxx.4gl` 这种**三层**结构。
若只有两层，说明生产端目录不是 `顶层/模组/类型` 的布局，
第 1 步的 `find -mindepth 3 -maxdepth 3` 要按实际层级调整。

### 9.2 `tiptop link import` 报"表头缺少 GAL01..GAL04"

CSV 表头不对。用 `SET MARKUP CSV ON` 导出（见 5.2），或手工加表头行：

```bash
head -1 .project/gal_file.csv
# 期望：GAL01,GAL02,GAL03,GAL04
```

### 9.3 `tiptop link import` 结果是"链 0"

- `gal04` 全是 `'N'`：SQL 条件写错了，应为 `WHERE gal04 = 'Y'`；
- 表里确实没数据：确认连的是正确的库；
- 用 `tiptop link status -root "$WORKSPACE"` 复核。

### 9.4 链接资料有，但 `function-not-found` 还是报

- 确认 `bdl.link.enable` 是 `true`（设置界面 "Genero BDL: 链接资料" 一节）；
- 确认 `bdl.link.dataDir` 与实际目录一致（默认 `.project`）；
- 资料过期会报 `link-data-stale`（hint 级），重新导入即可。

### 9.5 GLOBALS 变量跳转不到

- 确认 `bdl.globals.searchPaths` 覆盖了实际的 config 目录；
- 确认 GLOBALS 引用是相对路径时，工作区根没选错。

### 9.6 部署失败

| 现象 | 检查 |
|---|---|
| 找不到 `tiptop` | 用平台包里的：`~/.vscode/extensions/darcyjoven.4gl-full-*/bin/tiptop`；或在设置里填 `bdl.tools.path` |
| SSH 认证失败 | `ssh <账号>@<主机> 'echo ok'` 手动验证；检查 key/agent |
| 远端没有该目录 | `remoteRoot` 要与生产端源码目录一致（`/u1/toppord`） |
| 远端找不到 `fglcomp` | 远程命令走登录 shell 的 `PATH`；用绝对路径或确认 `.bash_profile` 里有 Genero 环境 |
| 上传了但没编译 | 目标缺少 `compile` 配置，或用了 `-no-compile` |
| 编译报找不到子文件 | `remoteRoot` 与本地目录层级不一致，导致相对 include 解析不到 |

### 9.7 第一次索引很慢

工作区索引要扫全部文件（几千个 `.4gl` 实测约 25 秒）。
大项目建议：

- 把 `bdl.limits.maxFileBytes` 调大一点（默认 2 MB），
  否则超大文件会被跳过；
- 用 `bdl.ignore.files` 排除生成代码与备份目录。

### 9.8 密码相关

- **不要**把 Oracle 密码写进 `settings.json` 或提交进仓库；
- 用 `BDL_ORA_PASSWORD` 环境变量，或 `.project/secrets.json`（`chmod 600`，
  且 `.project/` 已在 `.gitignore` 里）。

---

## 附录 A：一键脚本

把下面保存为 `setup-workspace.sh`，按需改顶部的变量后执行：

```bash
#!/usr/bin/env bash
# 从生产端拉源码 → 建工作区 → 出链接资料 → 部署测试。
# 用法：bash setup-workspace.sh
set -euo pipefail

# ===== 需要按环境修改的变量 =====
PROD_HOST="${PROD_HOST:?请设置 PROD_HOST}"
PROD_USER="${PROD_USER:?请设置 PROD_USER}"
WORKSPACE="${WORKSPACE:-$HOME/work/toppord}"

# Oracle（只读账号）
ORA_HOST="${ORA_HOST:?请设置 ORA_HOST}"
ORA_SERVICE="${ORA_SERVICE:?请设置 ORA_SERVICE}"
ORA_USER="${ORA_USER:?请设置 ORA_USER}"

# 部署目标里的本地示例文件（换成你自己的）
SAMPLE_FILE="${SAMPLE_FILE:-tiptop/aap/4gl/aapi202.4gl}"

# ===== 找到 bdl-lsp 与 tiptop =====
if command -v bdl-lsp >/dev/null 2>&1; then
  BDL_LSP=bdl-lsp
else
  BDL_LSP="$(ls "$HOME"/.vscode/extensions/darcyjoven.4gl-full-*/bin/bdl-lsp 2>/dev/null | head -1 || true)"
  [ -n "$BDL_LSP" ] || { echo "找不到 bdl-lsp：装好 VSCode 扩展，或把它放进 PATH" >&2; exit 2; }
fi
# 链接资料与部署由 tiptop 负责（0.3.2 从 bdl-lsp 分离）
if command -v tiptop >/dev/null 2>&1; then
  TIPTOP=tiptop
else
  TIPTOP="$(ls "$HOME"/.vscode/extensions/darcyjoven.4gl-full-*/bin/tiptop 2>/dev/null | head -1 || true)"
  [ -n "$TIPTOP" ] || { echo "找不到 tiptop：装好 VSCode 扩展，或把它放进 PATH" >&2; exit 2; }
fi
echo "==> 使用 $BDL_LSP / $TIPTOP"

# ===== ① 生产端打包 =====
echo "==> [1/6] 生产端打包"
ssh "$PROD_USER@$PROD_HOST" 'cd /u1/toppord && \
  find . -mindepth 3 -maxdepth 3 -type d \( -name 4gl -o -name per -o -name sch \) -print \
  | tar czf /tmp/toppord-src.tar.gz \
      --exclude=".git" --exclude="*.o" --exclude="*.err" \
      --exclude="*.form" --exclude="build" -T -'

# ===== ② 拉回并解压 =====
echo "==> [2/6] 拉回并解压"
mkdir -p "$WORKSPACE"
scp "$PROD_USER@$PROD_HOST":/tmp/toppord-src.tar.gz "$WORKSPACE/"
cd "$WORKSPACE"
tar xzf toppord-src.tar.gz

# ===== ③ Git 初始化 =====
echo "==> [3/6] 初始化 Git 仓库"
if [ ! -d .git ]; then
  git init -b main
  cat > .gitignore <<'EOF'
.project/
.bdl-lsp/deploy.json
*.o
*.err
*.form
EOF
  git add -A
  git commit -m "从生产端导入源码"
else
  echo "    （已有 .git，跳过）"
fi

# ===== ④ 链接资料 =====
echo "==> [4/6] 导出链接资料"
mkdir -p .link
"$TIPTOP" link sync -root "$WORKSPACE" -source golang \
  -host "$ORA_HOST" -service "$ORA_SERVICE" -user "$ORA_USER"
"$TIPTOP" link status -root "$WORKSPACE"

# ===== ⑤ 部署测试 =====
echo "==> [5/6] 部署预演 + 单文件测试"
"$TIPTOP" deploy -workspace "$WORKSPACE" -dry-run
"$TIPTOP" deploy -workspace "$WORKSPACE" -dry-run "$SAMPLE_FILE"

# ===== ⑥ 打开 =====
echo "==> [6/6] 打开 VSCode"
code "$WORKSPACE"
```

> 密码通过环境变量 `BDL_ORA_PASSWORD` 传入，不要写进脚本：
> ```bash
> export BDL_ORA_PASSWORD='<密码>'
> bash setup-workspace.sh
> ```

---

## 附录 B：完整命令速查

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
printf '.project/\n.bdl-lsp/deploy.json\n*.o\n*.err\n*.form\n' > .gitignore
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

## 附录 C：目录结构速查

```text
$WORKSPACE/
├── .bdl-lsp/
│   ├── config.json          # 项目配置（可提交）
│   ├── deploy.json          # 部署配置（含主机，建议不提交）
│   └── builtins.json        # 可选：项目自定义内置符号
├── .project/                   # 链接资料（不提交）
│   ├── links.jsonl
│   ├── links.meta.json
│   └── gal_file.csv         # 方式 B 的中间产物
├── tiptop/
│   └── <模组>/
│       ├── 4gl/*.4gl *.global
│       ├── per/*.per
│       └── sch/*.sch
└── topcust/
    └── ...
```
