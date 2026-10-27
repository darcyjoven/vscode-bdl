# init-project —— 从生产服务器初始化 4GL 项目仓库

在本地把生产代码拉下来，整理成一个 **git 仓库**，并生成
`.gitignore` / `.gitattributes` / `.editorconfig` / 示例设置 / 来源说明。

**取数规则（两层限制，两个脚本一致）**

1. **目录**：远根（默认 `/u1/topprod`，可改）下**只进 `tiptop` 和 `topcust` 两个顶层目录**，其它顶层目录不管；
2. **文件**：只同步这三种，其余一律不取（`42f` 之类的产物、非 `4gl`/`per` 目录里的杂文件都不会来）：
   - 任意目录的 `*.global`
   - `4gl` 目录下的 `*.4gl`（`*/4gl/*.4gl`）
   - `per` 目录下的 `*.per`（`*/per/*.per`）

> 远根可改（`-RemoteRoot` / `-r`）；要取别的顶层目录用 `-Module a,b` / `-m a,b` 覆盖默认的 `tiptop,topcust`。
> 远端**没有源文件的目录不会同步到本地**（Linux 用 `rsync --prune-empty-dirs`，Windows 只把文件列进 tar，不写目录项）。

> **只在本地跑**（WSL/Linux 用 `init-project.sh`，Windows 用 `init-project.ps1`）；
> 绝不要把这些脚本放到生产服务器上执行。对生产侧只做**只读**操作：
> Linux 流程是"只读 find + rsync 拉取"；Windows 流程是"只读 find + 一次 tar 打包到 `/u1/out`（用完即删）"。
> 两者都**不调用** `tiptop`、不上传、不部署。

## 从 VSCode 里用（推荐）

命令面板 → **`Genero BDL: 初始化项目（从生产服务器拉取代码）`**：

1. 先问"用哪个脚本"：**自动**（按客户端平台）/ 强制 bash / 强制 PowerShell；
   - Windows 宿主 → PowerShell 脚本；Linux / macOS / **Remote-WSL / Remote-SSH** 宿主 → bash 脚本；
2. 依次填：SSH 目标、生产根（默认 `/u1/topprod`）、目标目录（默认当前工作区/可选文件夹）；
3. 选项（多选）：增量更新、删除本地多余、不自动提交、只预演；再选源编码（自动检测 / GBK / BIG5 / 不转码）；
   走 PowerShell（tar + scp）流程时还会问**登录区域**（见下节，预填 `1`，清空 = 不输入）；
4. 命令会**打开集成终端执行**脚本 —— 进度、编码报告、删除确认都在终端里完成；
   命令行同时写入「Genero BDL 任务」输出通道，方便复制重跑。

## 命令行执行

```bash
# Linux / WSL：rsync 拉取（增量最快）
scripts/init-project/init-project.sh -t <user@host> -r /u1/topprod -d ~/projects/topprod -y
scripts/init-project/init-project.sh -t <host> -r /u1/topprod -d <dir> --print-remote   # 审计远端命令

# Windows：生产端 tar → scp 回本地 → 解压 → 清理两端中间文件
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/init-project/init-project.ps1 `
  -Target <user@host> -RemoteRoot /u1/topprod -Dest C:\projects\topprod -Yes
```

## 两条流程

### Linux / WSL（`init-project.sh`，rsync）

```
连接（老服务器自动 legacy 重试）→ 只读 find 预检（文件数/字节）
→ rsync 拉取（只扫 tiptop/topcust 两个顶层目录；过滤规则只取 4gl/global/per，
  排除 .git/.project/42f/bin/tmp… 与 *~ *.bak；-m 剪掉没有源文件的目录）
→ 本地转 UTF-8（样本检测后问；已是 UTF-8 跳过）+ CRLF→LF
→ git init -b main + 模板 + core.autocrlf=false/core.eol=lf + 提交
→ 校验 git ls-files --eol 全是 i/lf w/lf
```
**更新语义**：默认**只覆盖不删**；`--delete` 才会删本地多余（先列出清单 + 确认；rsync 的排除规则同时保护 `.git/`、模板、`.project/` 和你的其它文件）。

### Windows（`init-project.ps1`，tar + scp）

```
连接（登录菜单要选区就先喂一行 `-Region`）→ 只读 find 预检 → 取样本判编码
→ 生产端 tar 打包到 /u1/out/<唯一名>.tar.gz（唯一写操作，不碰项目树，用管道喂 tar -T -，不留清单文件）
→ scp 回本地 <Dest>\.pack\src.tar.gz（.pack/ 已被 .gitignore 排除）
→ 本地 tar 解压（find -type f 只列文件，所以空目录不会跟着落地）
→ 转码/行尾（字节级 .NET，绝不走 Get-Content/Set-Content）
→ git init + 模板 + 三项换行配置 + 提交
→ finally：删远端 /u1/out 里那个包 + 本地 .pack 目录（成功失败都清）
```

## 换行符不会变（关键设置）

生产是 Linux（LF），Windows 编辑后仍保持 LF —— 脚本会自动落地这几项：

| 落点 | 内容 |
|---|---|
| `.gitattributes` | `*.4gl` / `*.per` / `*.global` 均 `text eol=lf`；其余 `* -text` |
| `.editorconfig` | `end_of_line = lf`、`charset = utf-8`、`trim_trailing_whitespace = false` |
| 仓库 git 配置 | `core.autocrlf=false`、`core.eol=lf`、`core.safecrlf=warn` |
| `.vscode/settings.example.json` | `"files.eol": "\n"`（复制成 `settings.json` 用；该文件已被忽略） |
| 运行期校验 | 跑完打印 `git ls-files --eol`（应全 `i/lf w/lf`）与 `git diff --check` |

## 参数（两者同名）

| Linux | Windows | 说明 |
|---|---|---|
| `-t/--target` | `-Target` | `user@host` 或 `~/.ssh/config` 别名（只支持密钥/agent） |
| `-r/--remote-root` | `-RemoteRoot` | 生产根，默认 `/u1/topprod` |
| `-d/--dest` | `-Dest` | 目标目录 |
| `-m/--module` | `-Module` | 只取远根下这些顶层目录（默认 `tiptop,topcust`；其它目录不管） |
| `--update` | `-Update` | 增量更新（默认模式检测：目标已存在时必须给） |
| `--delete` | `-Delete` | 删除本地多余源文件（默认不删） |
| `--from-encoding` | `-FromEncoding` | 跳过检测与询问（`utf-8` = 不转码） |
| `--no-commit` | `-NoCommit` | 不自动提交 |
| `--print-remote` | `-PrintRemote` | 只打印将在服务器上执行的命令（审计） |
| `--dry-run` | `-DryRun` | 只预检/检测，不拉取不写盘 |
| `-y/--yes` | `-Yes` | 不再交互确认（在终端里跑时通常**不要**加，保留编码/删除确认） |
| `--ask-password` | `-AskPassword` | 没配密钥时允许用密码登录（每步会提示输入密码；密码只交给 ssh，不保存） |
| —（rsync 不需要） | `-Region` | 登录后要输入的「区」（1-9，默认 `1`；空字符串 = 不输入）。见下节 |
| `--progress-protocol` | `-ProgressProtocol` | 进度改成 `进度\t阶段\t信息` 机器格式（默认是终端可读的 `[阶段] 信息`） |

## 登录区域（只有 tar + scp 流程需要）

有些生产账号在 login shell 里会先问你「区」（`1`/`2`/`3`/`4`，直接回车 = 1）。
非交互 ssh 不会有人回答这个菜单，**远端命令就相当于没跑**——典型现象是

```
[错误] 没有匹配到源文件：确认 -RemoteRoot（/u1/topprod）
```

处理：给 `-Region` 一个值，脚本在**每条** ssh / scp 连接建立后先把这一行喂给远端菜单：

```powershell
... -Target tiptop@host -RemoteRoot /u1/topprod -Dest D:\cache\tiptopgp -Region 2 -Update
```

- 不写 `-Region` ＝ 默认 `1`（适合"默认选 1"的服务器）；
- `-Region ""`（空字符串）＝ 什么都不输入，跟以前的直接登录一样——服务器没有这个菜单时用；
- 只作用在 `init-project.ps1`（tar + scp）：`init-project.sh` 走 rsync，不需要这个参数。

## 密码登录（本阶段允许，仅初始化脚本）

- **有密钥**：优先用密钥/agent，不会提示密码。
- **没配密钥**：默认先试一次密钥；失败且在终端里时会问一句
  `密钥登录失败。改用密码登录？（只有本初始化脚本允许；上传/编译仍需密钥）`，答 y 即可；
  也可显式加 `--ask-password`（Windows：`-AskPassword`）跳过询问。
- 密码**由 ssh 自己在终端提示**输入：脚本不读取、不保存、不写日志、不进命令行（`ps` 里看不到）。
- 密码模式下每一步远端操作（预检 / 取样 / rsync 或 tar+scp）都会**再提示一次密码**——本阶段的预期行为。
- 若服务器禁用密码认证（`PasswordAuthentication no`），密码模式仍会失败，那就只能配密钥。
- **上传/编译命令仍然只支持密钥**（按之前决定），不会提示密码。

## 排障

| 现象 | 处理 |
|---|---|
| `no matching host key type / kex` | 老服务器：脚本自动 legacy 重试；也可显式 `--legacy-ssh` / `-LegacySsh` |
| `没有匹配到源文件`，但远根确实有文件 | 该账号登录后要选区：加 `-Region 1`（或 2/3/4）；确认没有这种菜单就用 `-Region ""` |
| `Permission denied (publickey)` | 没配密钥时：初始化脚本会问是否改用密码登录（或加 `--ask-password`）；**上传/编译**必须先配密钥（`ssh-copy-id` 或 ssh-agent） |
| 中文乱码 | 先用 `--dry-run`/`-DryRun` 看编码报告（含候选与预览），再用 `--from-encoding big5` 重跑 |
| Windows 组策略禁止脚本 | 命令会把命令行写进输出通道，复制到终端手工执行（或让管理员放开 ExecutionPolicy） |
| 目标目录已有内容 | 用 `--update`/`-Update`；确实要混着用才加 `--force`/`-Force` |
| 远端 `/u1/out` 里发现残留包 | 说明上次被强杀（`finally`/`trap` 没跑到）；删掉即可，脚本每次用唯一名不冲突 |

## 自测（不需要真服务器）

```bash
scripts/init-project/test-local.sh
```

造一棵"远端"fixture + 假 ssh，跑通 rsync 全链路并逐项断言：取数范围（只 tiptop/topcust）、
文件级过滤（任意目录 `*.global` / `*/4gl/*.4gl` / `*/per/*.per`，其余不取）、空目录不同步、
GBK→UTF-8、CRLF→LF、模板与换行配置、`git ls-files --eol` 全 LF、默认不删 / `--delete` 才删
（含"答 n 保留"）、远端只读审计（无重定向、无 `rm/mkdir/mktemp/cp/mv`、无上传/部署）。
当前 **46 项通过**；本机（Windows Git Bash）`git ls-files --eol` 那项失败是**既有环境问题**
（改动前同样失败，见文末）。

> Windows 版 `init-project.ps1` 已做静态检查（括号配平、无 PS7-only 语法），但**未在本机实跑**
> （开发环境无 PowerShell）；建议先在非生产环境用 `-DryRun` 跑一遍。
