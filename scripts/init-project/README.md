# init-project —— 从生产服务器初始化 4GL 项目仓库

在 **Ubuntu / WSL** 上跑：从 **RedHat 6.5 类生产服务器**（TiTop 环境）把 `*.4gl` / `*.global` / `*.per`
取回本地，整理成一个 **git 仓库**，并生成 `.gitignore` / `.gitattributes` / 示例设置。

> **运行位置**：只在**本地 / WSL** 直接执行——**不要把这个脚本放到生产服务器上跑**。
> 对服务器只做**只读**操作：`find` / `stat` / `ls` / `head` / `base64` / `tar`（结果经 stdout 回传），
> 不在服务器上写任何文件（**连临时文件都不建**）、不调用任何上传/部署命令（`tiptop`、`rsync`、`scp` 一律不用）。
> 用 `--print-remote` 可以把将要执行的远端命令原样打印出来审计。
>
> Windows 版计划中的 `init-project.ps1` 与本脚本**参数同名**（远端命令与模板共用同一套）。

## 依赖

`ssh`（密钥或 agent，**不支持密码**）、`tar`、`git`、`iconv`、`python3`、`base64`。
服务器侧只需要：`sh`、`find`、`tar`、`stat`、`base64`、`mktemp`（RH6.5 全都有）。

## 快速开始

```bash
# 交互式（会问：SSH 目标、生产根、本地目录；并展示编码检测结果让你选）
scripts/init-project/init-project.sh

# 一步到位（推荐：编好参数，--yes 不再确认）
scripts/init-project/init-project.sh \
  -t tiptop@erp.example.com \
  -r /u1/toppord \
  -d ~/projects/toppord \
  --module topcust,other \
  -y
```

首次会先做**只读预检**：连不上/远根不存在/没有匹配文件都会立刻报错，不会先传一半。

## 参数

| 参数 | 说明 |
|---|---|
| `-t, --target` | `user@host` 或 `~/.ssh/config` 别名 |
| `-p, --port` / `-k, --key` | 端口 / 私钥（默认走 agent 与 `~/.ssh` 默认密钥） |
| `--legacy-ssh` | 强制用 `ssh-rsa`/SHA-1 兼容（老服务器）；默认**连不上时自动重试一次** |
| `-r, --remote-root` | 生产根目录（必填） |
| `-m, --module a,b` | 只取这些顶层模组（默认全部） |
| `--include '<glob>'` | 改文件匹配（可多次；默认 `*.4gl` / `*.global` / `*.per`） |
| `-d, --dest` | 目标目录（默认 `~/projects/<远根名>`） |
| `--branch` | 分支名，默认 `main` |
| `--from-encoding <gbk\|big5\|euc-cn\|utf-8>` | 跳过"样本检测+询问"，直接按它转码；给 `utf-8` 表示不转 |
| `--update` | 目标已存在时增量合并（见下） |
| `--force` | 目标非空也继续（可能与旧文件混在一起，慎用） |
| `--no-commit` | 只落盘不提交 |
| `--force-templates` | 覆盖已存在的 `.gitignore` / `.gitattributes` |
| `--print-remote` | 打印将在服务器上执行的**只读**命令（可单独用，便于审计） |
| `--dry-run` | 只预检 + 检测编码，不传输不写盘（结束时也会打印远端命令） |
| `-y, --yes` | 全程不再确认（编码仍用检测结果） |
| `--keep-tmp` / `-v` | 保留临时 tarball / 详细输出 |

## 它做了什么

1. **连通性**：默认算法失败时按老服务器（OpenSSH 5.x）兼容参数重试，并提示已启用。
2. **只读预检**：统计匹配到的文件数与字节数，打印顶层目录名让你核对。
3. **编码检测**：远端 `head -c 4096 | base64` 取最多 6 个样本，本地用 `detect-encoding.py` 打分
   （能解码 + 汉字多 + 控制字符少），打印候选与各自解码预览，**问你选哪个**（默认给检测建议）。
4. **流式取回**：远端 `find … | tar czf - -T -` 直接把 tar.gz 写到 stdout 回传；
   **服务器上不落任何文件**，也不依赖 rsync。
5. **解包 + 规范化**：转 UTF-8（**本来就是 UTF-8 的文件跳过**）、CRLF→LF、剔除副作用文件。
6. **git**：`git init -b main`、写模板、生成来源段落、`git add -A` 后提交
   （`chore: 从 <host>:<root> 初始化/更新生产代码镜像`）。

### 取数范围（写死在逻辑里的排除）

跳过：`.git` `.svn` `CVS` `node_modules` `42f` `4fd` `bin` `obj` `tmp` `backup` `bak`
`.project` `.link`，以及 `*~` `*.bak` `*.orig` `*.rej` `*.swp` `.DS_Store` `Thumbs.db`。
**只打包源文件**（`tar -T 清单`），所以产物/日志不会混进来。

### 生成的文件

```
<dest>/
├── .gitignore                 # 忽略 .project/（含 secrets）、编译产物、编辑器临时、.vscode/settings.json
├── .gitattributes             # 源码一律 LF；*.ps1/.cmd 保留 CRLF；产物标 binary
├── .vscode/settings.example.json   # 复制成 settings.json 用（该文件已被忽略，避免提交主机/路径）
├── README-PROJECT.md          # 来源（主机/远根/文件数/时间/编码）+ 重新初始化命令
└── <模组>/…                   # 与生产完全一致的相对路径
```

## 更新（`--update`）

- 用生产端文件**覆盖**本地同名文件；
- 生产端已删除的**源文件**（仅限取数范围内）会列出来问你"本地是否也删"——**绝不碰** `.git/`、模板、`.vscode/`、`.project/` 与你自己添加的文件；
- 已存在的 `.gitignore` / `.gitattributes` / `README-PROJECT.md` 不会被覆盖（要刷用 `--force-templates`）。

## 排障

| 现象 | 处理 |
|---|---|
| `no matching host key type / kex` | 老服务器：脚本会自动用 legacy 重试；也可显式 `--legacy-ssh` |
| `Permission denied (publickey)` | 只支持密钥：先 `ssh -i <key> <target> true` 或 `ssh-agent` 加好 key |
| 中文全是乱码 | 编码选错：先 `--dry-run` 看检测报告（含 alt 预览），再用 `--from-encoding big5`（或 gbk）重跑 |
| `tar: Removing leading '/'` | 已修（远端输出相对路径）；若在旧版本看到，更新脚本即可 |
| 目标目录已有内容 | 正常重跑用 `--update`；确实要混着用才加 `--force` |
| 想看远端到底会执行什么 | `scripts/init-project/init-project.sh -t <host> -r <root> --print-remote` |
| 想手工核对选中了哪些文件 | `ssh <host> "cd <root> && find . \( -name 42f -o -name 4fd -o -name bin \) -prune -o -type f \( -name '*.4gl' -o -name '*.global' -o -name '*.per' \) -print"` |

## 自测（不需要真服务器）

```bash
scripts/init-project/test-local.sh
```

造一棵"远端"fixture + 假 `ssh`，把整条链路（预检 → 编码检测 → 流式取回 → 解包 → 规范化 → git）
跑一遍并逐项断言（取数/排除、GBK→UTF-8、CRLF→LF、模板、提交、增量更新与删除同步），
外加**只读审计**（远端命令里不许出现重定向/`rm`/`mkdir`/`tiptop`/`rsync`/`scp`/`upload`/`deploy`），
当前 **29/29 通过**。
