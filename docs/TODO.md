# 待办清单（只放未完成项）

> 维护位置：vscode-bdl 仓库（本文件）。新会话入口。
> **规则：本文件只保留未完成条目。功能做完了 → 写进 [`FEATURES.md`](FEATURES.md)
> （用户可见的再同步 [`README.md`](../README.md)），然后从本文件删除该条——不留历史、不勾选留存。**
> 待拍板项放 [`OPEN-ITEMS.md`](OPEN-ITEMS.md)。操作入口总表见 [`COMMANDS.md`](COMMANDS.md)。
> 状态基线：bdl-lsp 0.3.13 / tiptop 0.1.8 / vscode-bdl 0.6.2（生成于 2026-10-24）

---

## 0. 一句话开场（复制给新会话）

```text
读 vscode-extension/docs/TODO.md，先做 §1「发布闭环」：
按附录 A 做 Windows 实机验收（C0，含 §2b 的上传/生产端执行与 W7 全量同步复测），
然后打 tag（C1）、给 bundle-vsix.yml 加 release job（C2）。
```

```text
真机才能验的项见 §2 / §2b；代码层遗留见 §3；Zed 追平见 §3.5（先做 Z-A6）。
已完成的功能不在本文件：看 vscode-bdl/docs/FEATURES.md 与 docs/COMMANDS.md。
```

## 1. 发布闭环（按顺序）

| # | 事项 | 现状 | 要做的事 | 验收门槛 |
|---|---|---|---|---|
| **C0** | 真机验证（Windows） | 从未有人在真机上装过插件；CI 只覆盖"构建 + 单测 + 单测级二进制自检 + VSIX 内容自检"（bdl-lsp/tiptop 已 Linux+Windows 双绿） | 按**附录 A** 逐条勾选，并按 **§2b** 复测本轮新增（上传配置 → 单文件上传 → 生产端编译/链接/预览 → 链接资料命令 → 字段资料含 W7 分批全量同步）。命令默认在 PowerShell 跑，详见附录 A | 附录 A 全绿；失败项保持未勾、把现象写进附录 A「记录」并在 §9 汇总登记（或开 issue） |
| **C0b** | 真机验证（macOS） | CI 有 `darwin-x64` / `darwin-arm64` 两个包，但没在真机装过（风险 F6：macOS 延后带来的构建差异，CI 能构建但无人验证过产物） | 在至少一台 Intel 或 Apple Silicon 上装包并做 C0 的抽样（可借附录 A 的 §1/§2 节）：语言服务能起、跳转/诊断可用、VSIX 不夹带仓库文件 | 两台架构至少各跑通一次装包 + 打开 `.4gl` + 跳转/诊断；`darwin-arm64` 不能在 Intel 机上装（会回退外部二进制） |
| **C1** | 打 tag | `bdl-lsp` 至今**没有 tag**；`tiptop/go.mod` 用 `replace ../bdl-lsp`，CI 只能追 `main` → 版本漂移（见 §3.1 F1/F9） | 打 `bdl-lsp v0.3.13`、`tiptop v0.1.8`、`vscode-bdl v0.6.2`；之后 `bundle-vsix.yml` 用 `bdl_lsp_ref=v0.3.13` / `tiptop_ref=v0.1.8` 出包。命令：`git tag v0.3.13 && git push origin v0.3.13`（三个仓库各一次） | 三个 tag 都存在；用 tag ref 出包成功、产物可复现；`tiptop go.mod` 可去掉 `replace` 指版本号（见 §3.1 F1/F9） |
| **C2** | GitHub Release | `bundle-vsix.yml` 只有 `workflow_dispatch` 的 `bdl_lsp_ref` / `tiptop_ref` 输入，**没有 release job**；现在只有 Actions artifact（90 天过期） | 给 `bundle-vsix.yml` 加 `release` job（或新 workflow）：4 个平台 VSIX（`win32-x64` / `linux-x64` / `darwin-x64` / `darwin-arm64`）一起挂 Release，附 `BUILD-INFO.json` 内容与 sha256 校验和；触发方式建议"tag push 或手动输入 release_tag"。打包与校验口径见 附录 D §1/§4 | Release 页面同时有 4 个 VSIX + `BUILD-INFO.json` 内容 + sha256；tag 推送能自动触发 |
| **C2-子项 C4** | tag 触发时 ref 不对 | `bundle-vsix.yml` 里 `${{ inputs.*_ref \|\| 'main' }}`：tag 推送时 `inputs` 为空 → 回落到 `main`，不会用同名 tag | 改成 `github.ref_name` 回退（`${{ inputs.bdl_lsp_ref \|\| github.ref_name \|\| 'main' }}` 同型），使 tag 构建精确对应同名 tag | tag 推送触发的构建日志里 ref 就是该 tag |
| **C3** | 市场 / 注册表 | 用户已定：**暂缓** | 想发时再做：`vsce publish`（市场，四个包分别 `--target`）+ Open VSX；先用 `vsce package` 的产物人工验证一遍。命令见 附录 D §5 | 用户明确要求发布后再定 |

**验收门槛**：C0 + C0b 全绿（或把问题记进本文件 §1）之后才 C1/C2。

---

## 2. 真机才能验的两件事（沙箱里做不了）

| # | 事项 | 为什么没验 | 怎么验 |
|---|---|---|---|
| **D1** | `tiptop schema sync -source golang`（直连 Oracle 采集表字段） | 沙箱没有 Oracle；只验证了 SQL 生成、`-source file` 全链路、密码来源与参数校验的单元测试 | 真库里跑一次：`export BDL_ORA_PASSWORD=...; tiptop schema sync -root . -host … -service … -user …`（**应用 schema 账号**：默认 SQL 走 `USER_TAB_COLUMNS` + 字典 `DS.ZTA_FILE`/`DS.GAQ_FILE`，`-owner` 只对自定义 `-query` 有意义）。核对：表数/列数与 DBA 导出一致、**中文说明来自 `DS.GAQ_FILE.gaq03`（不是 Oracle 备注）**、`nullable` 与 `default_length` 映射正确、分批进度能跑完（附录 A 5.4.8/5.4.9）；随后在 VSCode 里点 `数据库字段：从数据库同步` 看进度与结果 |
| **D2** | `tiptop link sync -source golang`（直连 Oracle 采集链接资料） | 同上（这条早就在，但同样没在真库跑过） | `tiptop link sync -root . -host … -service … -user …`，与"导出 CSV 再 `link import`"的结果对比（链数/文件数应一致）。CLI 参数与密码来源见 `bdl-lsp/docs/FEATURES.md` 与附录 A 的 3.4 节 |

### 2b. 其它需要真实环境的验证缺口

| # | 事项 | 现状 | 要做什么 |
|---|---|---|---|
| **B3** | 真实 Genero 服务器 | 无本机 `fglcomp`/`fglform`，远程编译整链路没实跑过 | `ssh` 通、`fglcomp`/`fglform` 可用；`tiptop upload` + `tiptop exec` 实跑一次（配置合成见 [`README.md`](../README.md) 附录 A；逐条清单见本文件附录 A §5） |
| **B4** | Zed dev extension 手工加载 | 无图形界面 | `zed: install dev extension` 能加载、LSP 起来、大纲层级正确（与 §3.5 的 Zed 追平一起做） |
| **D3** | 上传 + 生产端编译/链接/预览 | 沙箱没有可达的生产服务器 | 按附录 A §5.0–§5.2 逐条：预演上传的路径映射、**只传单文件**、**不自动上传**、4GL 链接弹 `${name}`、无 MAIN 时置灰、Form 预览 `r.gf ${name} 2 p`、失败时 `last-run-exec.log` |
| **D4** | 全量 schema sync（慢链路，分批） | 沙箱没有 Oracle | 慢链路上跑一次全量：进度要有 `共 N 张表，按每批 200 张分 M 批`、`批次 i/M`，**不再出现 `ORA-01013`**；列说明来自 TiTop 字典（附录 A 5.4.8/5.4.9） |

---

## 3. 代码层遗留（按价值排序）

> 都不是阻塞项。完成时按本文顶部维护规则，把新能力写进 [`FEATURES.md`](FEATURES.md) 并同步 `README.md`。

### 3.1 高价值（先做）

| # | 事项 | 现状 | 要做的事（命令 / 文件） | 验收 |
|---|---|---|---|---|
| **P0-1b** | 崩溃回归进 CI | P0-1（链接预热回调关文档树导致 SIGSEGV）已修复并人工验证，但 `bdl-lsp/scripts/repro-index-crash.py` 依赖真实语料（CI 没有），修复只靠人工脚本证明 | 造一个**合成工作区**：`.project/links.jsonl`（或 `.link/`）+ 全局模组文件（拉开索引预热窗口）+ 一个 4 万行大文件，断言"不崩、能出大纲"；接进 CI | CI 里能复现并拦住回归；等价于 `scripts/repro-index-crash.py` 的退出码语义（0=OK / 1=崩溃） |
| **P0-2b** | T5 剩余量级（**等你拍板**） | `variable-source-unresolved` 全语料 19580 条，主体是**跨模块的模块级变量**（`L_AC` 1828、`G_RVV` 1715、`G_SFS` 1128…）：它们在别的模块里确有 `DEFINE`，但不在当前文件或其 GLOBALS 里 | 先确认语义：若"模块级 `DEFINE` 不跨模块可见"（Genero 手册常规理解）→ 这些是**真报**，工具不动；若这套项目构建方式让它们跨模块可见 → 需按模块/库聚合可见性（类似链接可见性矩阵，改动不小）。口径与证据建议归档到 `docs/OPEN-ITEMS.md` | 用户给定口径；若确认是噪声，另开一项并给出"改动后全语料 T5 下降、`function-not-found` / `field-not-in-form` 不变"的对比 |
| **F1/F9** | 版本漂移 | `tiptop` 依赖 `bdl-lsp` 公开包但用 `replace ../bdl-lsp`（无 tag）；`tiptop` CI 只能追 `main` | C1 打 tag 后：把 `tiptop/go.mod` 的 `replace` 换成版本号依赖（`require github.com/darcyjoven/bdl-lsp v0.3.13`），并让 CI 按 tag 校验（tag 与 `go.mod` 版本一致） | `go install github.com/darcyjoven/tiptop@latest` 可用；CI 在 tag 上校验通过；任一侧改公开包签名会构建失败而非静默漂移 |
| **P2-1+** | schema 增量采集 | 目前 `schema sync`（直连）与 `import`（CSV）都是"全量查询 → 逐表逐字节比较只写变化的表"；2648 表 2.4 s，够用 | 可加"按表 diff（只查变化的表）"或 `-since` 时间戳过滤；接口在 `tiptop`（`internal/schemacli`、`internal/oradb`），可选 `-source golang` 那套 | 增量路径有单测；大库重跑时间明显下降且结果与全量一致 |
| **P1-8** | 链接资料 **Code Lens**（**补充视图**，与 TreeView 并存） | 未做。VSCode 已有侧边栏「链接资料」TreeView；服务端尚无 `textDocument/codeLens` | 服务端（`bdl-lsp`）实现 `textDocument/codeLens`：链内**子文件各一条 lens**，全部挂在该文件 **MAIN 函数头**，每条带自己的 `command` 可分别点击；数量上限 `bdl.link.lensMax`（默认 10），超出给一条「…共 N 个」汇总；函数级反查（每个函数定义上方「🔗 被 N 处调用」，调用点来自 `wsindex.CallsOf`）。数据来自 `link.Resolver.Tree()`（纯内存查询）。VSCode 侧作为补充视图与 TreeView 并存 | 协议级测试 + e2e；点击 lens 能打开目标文件；与 Zed 侧 **Z-B2 共用同一份服务端实现**（见 §3.5，Z-A6 的实机结论决定实现方式） |

### 3.2 稳定性 / 性能加固

| # | 事项 | 现状 | 要做的事 | 验收 |
|---|---|---|---|---|
| **S1** | 语言服务器异常退出兜底 | 「Genero BDL」通道里对**非 0 退出码**没有明确日志、不自动重启、不通知用户 | 插件侧：异常退出时写明确日志 + **自动重启一次** + 通知用户（配合 P0-1 已修好的崩溃） | 手工 kill 服务器后能看到日志与通知，并自动重启一次；日志进「Genero BDL」通道（或「显示语言服务器信息」→「打开日志」） |
| **S2** | `parseMu` 同类异步路径审计 | 只有链接预热回调这一条"从外部改文档树"的路径已纳入纪律；结论只在文档里 | 把审计结论写进代码注释（`parseMu` 的说明）：后续新增任何"后台 → 文档树"的路径都必须走 `requestRediagnose()` 一类入口（`internal/server`） | 注释落地；新增异步路径有 lock 纪律单测（参考 `internal/server/lock_test.go`） |
| **S3** | 工作区索引是否跳过超大文件 | 工作区索引现在解析一切，包括 `bdl.limits.*` 已排除诊断的文件 | 评估让索引跳过超大文件（性能优化，**不是**崩溃原因） | 大项目索引耗时下降且跳转/符号搜索不明显变差 |
| **F3** | 扩展与 LSP/tiptop 版本错配的回退策略 | 三个二进制版本独立递增，没有兼容矩阵 | 定义兼容矩阵与错配时的回退/提示策略（`BUILD-INFO.json` 已有 `target`，可扩展记录所需版本） | 文档 + `BUILD-INFO.json` 校验；错配时给出可操作的提示 |
| **F2** | ABI 15 ↔ Zed tree-sitter 运行时兼容 | 未在 Zed 实机验证 | 与 §3.5 的 Z-A6 一起在 Zed 真机上确认（必要时固定 tree-sitter 运行时要求） | Zed 真机能加载语法/高亮，不报 ABI 错 |
| **F4** | Windows 无 rsync → scp 回退 | 回退是显式打印的（设计如此），但稳定性/性能未实测 | 用大文件/多文件在真机上实测 scp 回退（附录 A 5.1.4），有问题再评估 | 回退日志可见、传输成功；把结论记进本文件 |
| **F5** | 沙箱 `HOME`/`GOPROXY` 对文档/CI 的影响 | 本地构建需 `source scripts/dev-env.sh`，文档/CI 里散落此前提 | 把 `dev-env.sh` 的前提写清（写进 [`README.md`](../README.md) 附录 C 与 CI 注释），避免新会话反复踩 | 新会话按文档能一次构建成功 |

### 3.3 诊断质量核实（小项）

| # | 事项 | 现状 | 要做的事 | 验收 |
|---|---|---|---|---|
| **B5** | `record-member-unknown` 默认级别 | 默认 `off`（`LIKE table.*` 占 87% 引用，开启后全语料仅 24 条但仍偏噪） | 收集真实使用反馈后决定是否改 `warning`（诊断码注册表见 `bdl-lsp/docs/DIAGNOSTICS.md`） | 给出维持 `off` 或改级的结论与依据 |
| **B6** | `variable-source-unresolved` 人工标注 | `scripts/globals-audit.sh` **未做** | 抽 100 处人工标注，算出误报率（与 §3.1 P0-2b 共用口径） | 误报率有数字；据此定 P0-2b 是否开改动 |
| **B7** | `expression name:` 跳过规则抽查 | 已修，未逐条复核 | 跑语料差异清单，人工抽查是否误伤（对比 `make diag-audit` 前后） | 抽查记录；发现误伤则补语法跳过 |

### 3.4 文档收尾

| # | 事项 | 现状 | 要做的事 | 验收 |
|---|---|---|---|---|
| **C8** | [`README.md`](../README.md) 附录 A 占位符 | `<用户名>` / `<生产主机>` / `<Oracle主机>` 仍是占位（可选） | 按实际环境替换（或明确标注"示例"） | 文档里无未说明的尖括号占位 |
| **C9** | 文档截图 / 录屏占位 | `vscode-extension/docs/images/` 列了要补哪些图 | 按新 UI（两个视图、命令面板、进度通知、迁移提示）补齐截图/录屏 | 占位清单清零 |

### 3.5 Zed 扩展恢复（`zed-bdl 0.1.1`，**追平中**）

> 用户 2026-10-23 决定重启，按 VSCode 进度追平。完整设计与差距矩阵见
> `zed-extension/docs/PLAN.md`（仍有效）。关键前提（已核实）：Zed **无侧边栏树视图 API** →
> 链接资料改用 **Code Lens 挂在 MAIN 头上**（服务端 `textDocument/codeLens`，与 §3.1 P1-8 同一份实现，两端共用）。
> **顺序**：Z-A6 先做（实机结论决定 Z-B2 的实现方式），再 Z-B1 → Z-B2。

**Z-A：只改 `zed-extension/`（不动其它仓库）**

| # | 事项 | 要做的事 | 验收 |
|---|---|---|---|
| Z-A1 | 文档纠错（9 条） | `bdl-lsp link/deploy` → `tiptop link/deploy`（这两个子命令 0.3.2 已移除）；删 `link.maxAgeDays` 与整块 `link.sync.*`；`link.dataDir` 默认 `.project/link`；VSCode 侧已改成 `link.mode`/`schema.mode` 三态（Zed 侧仍用布尔 `link.enable`/`schema.enable`，需补默认 **false**）；诊断码表同步 14 个码；补 `prod.*` 说明；修「Zed 不支持任意命令」「不消费语义 token」两处错误结论；版本号 0.3.0→0.3.13 | `zed-extension/README.md` + 本仓库 `README.md`；全文 grep 无过期命令名 |
| Z-A2 | **补轻量档默认**（真实行为差异） | VSCode 客户端现在下发 `link/schema.mode = off`；Zed 侧原样透传用户设置，服务端在两者都缺时兜底返回 `true` → Zed 开箱即用时链接资料与 schema **是开着的**。修法：在 `language_server_workspace_configuration` 返回前把缺失的三开关补成 `false` | Zed 开箱即轻量档；与服务端兜底逻辑一致（兜底仍"开"，是无客户端设置时的安全兜底） |
| Z-A3 | 语义高亮落地 | 加 `languages/bdl/semantic_token_rules.json`（+ `per/`）；文档教用户开 `{"languages":{"Genero BDL":{"semantic_tokens":"combined"}}}`（**默认 off**，写清）；`verify-manifest.py` 加校验防误删 | 开 `semantic_tokens` 后自定义符号着色；`verify-manifest.py` 全绿 |
| Z-A4 | slash command 入口 | 实现 `run_slash_command` + `extension.toml` 声明 `[slash_commands.*]`；4 条：`/bdl-link-status`、`/bdl-deploy-dry-run`、`/bdl-deploy-list`、`/bdl-force-parse`；走 `zed::process::Command` 调 tiptop（需新增「定位 tiptop」四级查找）；**采集/导入类（会写盘）不进 slash command**，只给 task | 命令面板/Agent 面板可用；新增校验：`extension.toml` 声明与 Rust `match` 分支一一对应（写错名不编译错、只会静默不响应） |
| Z-A5 | task 模板更新 | 命令名改 `tiptop`；补 `deploy -list`；补 4 条链接资料 task | `zed-extension/README.md` 的 task 模板 + 本仓库 `README.md` |
| Z-A6 | Code Lens **实机验证**（**先做**） | 两个关键行为决定实现方式：① `code_lens: "on"` 时**多条同 range 的 lens 是否各占一行**；② 点击 lens 的 `command` 能否打开目标文件 | **有 GUI 的机器**上实测（沙箱做不了）；结论回写本文件与 `zed-extension/docs/PLAN.md` |
| Z-A7 | 「VSCode 独有 / Zed 降级」对照表 | 本仓库 `README.md` 新增一节：Zed 无侧边栏树 → 用 MAIN 头上的 Code Lens；反查为**函数级** | 文档与实现一致 |
| Z-A8 | `.project/deploy.json` 生成助手 | Rust 侧从 `prod.deploy.*` 合成（对应 VSCode `src/deployconfig.ts` 的 `ensureDeployConfig`） | 与 VSCode 行为一致 |
| Z-A9 | 扩展版本 0.1.1 → 0.2.0 | 版本策略：每完成一轮完整改动 +1 | `extension.toml` + `Cargo.toml` 同步 |

**Z-B：需要动其他仓库（🔒 需授权）**

| # | 事项 | 仓库 | 要做的事 | 验收 |
|---|---|---|---|---|
| 🔒 Z-B1 | `workspace/executeCommand` 通道 | `bdl-lsp` | `ServerCapabilities`（`internal/server/server.go`）加 `ExecuteCommandProvider`；新增 handler，把现有 `bdl/linkTree` / `bdl/linkReferences` / `bdl/forceParse` 三个自定义请求**转接**为标准命令 | 协议级测试；VSCode 侧不受影响（继续用自定义请求） |
| 🔒 Z-B2 | Code Lens 服务端实现（**两端共用**） | `bdl-lsp` | 实现 `textDocument/codeLens`：链内子文件各一条 lens 挂 MAIN 头上（数据来自 `link.Resolver.Tree()`，**纯内存查询**）；`bdl.link.lensMax`（默认 10）；函数级反查用 `wsindex.Index.CallsOf`；**依赖 Z-B1**（点击命令） | 与 §3.1 P1-8 同一份实现；协议级测试 |
| 🔒 Z-B3 | 二进制自动下载 | `bdl-lsp` + `tiptop` | Zed 扩展用 `latest_github_release` → `current_platform()` 拼资产名 → `download_file` → `make_file_executable`；**前置是 bdl-lsp 要有 GitHub Release**（C1/C2 未做） | 扩展侧安装即用，不用手工 `make build` |
| 🔒 Z-B4 | 文档同步 | `bdl-lsp` / `tiptop` / `zed-extension` | `HANDOVER` §0/§4/§8 一类仓库说明；`FEATURES.md` 补 Code Lens 行 | 三处口径一致 |

### 3.6 未排期 / 条件触发（长期项）

| # | 事项 | 现状 / 触发条件 | 要做什么 |
|---|---|---|---|
| **E1** | P7-D 链接资料分片 | 触发条件 >8 MB；当前 415 KB，**远未到** | 到量级后再设计分片（`links.jsonl` 读写路径） |
| **E3** | 使用处语义着色 | 未排期；需要全文件符号解析，成本高收益低 | 有明确用户需求再评估 |
| **E4** | Code Action 批量修复（fix all） | 未排期 | 有需求再排 |
| **E5** | 纯 Go SFTP | 仅在确有需求时评估（现有 rsync 主 / scp 备） | 需求出现再评估 |
| **E6** | Genero 5.0 语法 | 未排期（当前 2.50 基线） | 拿到 5.0 语料/语法变化清单后再排 |
| **E7** | 单文件远程编译超时；编译产物 `.42m` 是否拉回 | 现属 `tiptop`，**待确认** | 确认真实需求后定行为（超时值 / 是否回传产物） |
| **C6** | 二进制自动下载 / 校验 / 缓存 | "无感"体验，**未排期**（与 Z-B3 同源） | 需求出现再做；前置是 C1/C2 |
| **C7** | Zed 注册表发布 | **未排期** | 与市场发布（C3）一起评估 |
| **N1** | schema 列语义校准 | **待确认**：正式导入时按前 1000 行校准列语义（尤其 `data_length` / `char_length` 在 VARCHAR2/NUMBER 上的取舍） | 发布后一版定，不阻塞发布；口径归档 `docs/OPEN-ITEMS.md` |

---

## 4. 维护规则

1. **唯一性**：本文件是三个仓库共同的唯一实时待办清单。新会话从这里开始；不要在别处（旧 `NEXT` / `PENDING` / `PLAN`）新增待办。
2. **完成即移出**：待办做完时 → ①把新功能写进对应项目的 `docs/FEATURES.md`（`bdl-lsp` / `tiptop` / 本仓库各一份，总表在本仓库 [`FEATURES.md`](FEATURES.md)）；②若是用户可见的新功能，同步更新本仓库 [`README.md`](../README.md) 用户引导（唯一用户引导，已含全部细节）；③在本文**移除**该条（不要只勾选、不要留长篇历史）。
3. **完成即移出、不留历史**：能力写进 `docs/FEATURES.md`（用户可见的再同步 `README.md`），本文件删掉该条；不再保留「已完成汇总」附录。
4. **不写死链**：引用文档时只指向仍然存在的文件（本仓库 `docs/FEATURES.md`、`README.md`、`docs/OPEN-ITEMS.md`；`bdl-lsp/docs/DIAGNOSTICS.md`、`bdl-lsp/docs/FEATURES.md`、`tiptop/docs/FEATURES.md`、`zed-extension/docs/PLAN.md`）。历史归档类内容要么内联，要么进 `docs/OPEN-ITEMS.md`。
5. **待拍板项**：需要用户决定的（如 §3.1 P0-2b、§3.6 N1）留在本文件并显式标注"待确认"，把证据与口径写进 `docs/OPEN-ITEMS.md`。
6. **Windows 清单**：附录 A **整份内联、不再单独维护**；勾选状态与「记录」直接写在本文件里（失败项也要如实保留未勾 + 记录现象）。

---

## 附录 A：Windows 实机验收清单（全文）

> 本附录由 bdl-lsp 仓库的 Windows 实机验收清单搬入，作为 §1 的 **C0** 执行清单；
> 勾选状态与记录直接写在这里（§5 已按 2026-10-26 的上传/生产端执行改造更新）。

> 用途：本文件 §1 的 **C0（Windows 实机验收）执行清单**。CI 自 2026-10-23 起 Linux + Windows 双绿，
> 但**从来没有人在这两个平台上装过包**——"CI 绿"只证明能编译、单元测试能过，
> 不证明 VSIX 能装上、语言服务器能在 VSCode 里跑起来、scp 部署能接通。
>
> 用法：逐条执行 → 通过就把 `- [ ]` 改成 `- [x]`；**不符就保持未勾**，把现象写在该条
> 的「记录」里，并在 [§9 汇总](#9-结果汇总) 登记。命令默认在 **PowerShell**（不是 cmd）里跑。

| 项 | 值 |
|---|---|
| 被测版本 | `bdl-lsp 0.3.13` · `tiptop 0.1.8` · `4gl-full 0.6.2` |
| 机器 | ____（Windows 版本 / 架构，如 Windows 11 23H2 x64） |
| 执行人 / 日期 | ____ |
| 总耗时 | ____ |
| 结论 | ⬜ 全部通过 ⬜ 有失败（见 §9） |

> 标记说明：**⭐** = 2026-10-23 这一轮（0.3.5–0.3.8 / 0.1.3 / 0.5.1–0.5.3）刚改的点，最值得盯；
> **[需服务器]** = 要有真实 SSH + Genero 编译机的环境才能做，没有就跳过并如实标注。

---

### 0. 环境准备

### 0.1 工具链

```powershell
go version          # 期望 go1.24.x windows/amd64
gcc --version       # MinGW-w64 必需（CGO 编 tree-sitter）
where.exe gcc       # 期望 ...\mingw64\bin\gcc.exe
node --version      # 期望 v24.x（走源码/e2e 路线才需要）
code --version      # VSCode
ssh -V              # OpenSSH（部署项才需要）
```

- [ ] 0.1 上述命令**全部**有输出且版本达标
  - 记录：____

### 0.2 仓库与行尾

```powershell
git config --global core.autocrlf false   # 兜底；仓库里已有 .gitattributes
```

- [ ] 0.2 已设置 `core.autocrlf false`
  - 记录：____

### 0.3 构造一个自包含测试工作区

**刻意放在「带空格 + 中文」的路径下**——这是 Windows 路径/URI 最容易出问题的地方（见 §3）。

> 用下面这个 `Write-Fixture` 而不是 `Set-Content`：PowerShell 5.1 的
> `-Encoding UTF8` 会写 **BOM**（会让语法解析多出莫名其妙的错误），
> 且写出来是 CRLF（项目的 `.4gl/.global/.per` 要求 LF）。
> 这里用「字符串数组 + `-join "`n"`」显式构造 LF 内容，
> 并用 `[IO.File]::WriteAllText` 写无 BOM 的 UTF-8。

```powershell
$ws = "$env:USERPROFILE\bdl win 测试\topprod"
New-Item -ItemType Directory -Force -Path `
  "$ws\topcust\aap\4gl", "$ws\topcust\aap\per", "$ws\topcust\config" | Out-Null

function Write-Fixture($path, [string[]]$lines) {
  [IO.File]::WriteAllText($path, ($lines -join "`n") + "`n")
}

Write-Fixture "$ws\topcust\config\globals_defs.global" @(
  "GLOBALS"
  "    DEFINE g_counter INTEGER"
  "    DEFINE g_rec RECORD"
  "        id INTEGER"
  "    END RECORD"
  "END GLOBALS"
)

Write-Fixture "$ws\topcust\aap\4gl\globals_main.4gl" @(
  'GLOBALS "../../config/globals_defs.global"'
  "MAIN"
  "    DEFINE l_local INTEGER"
  "    LET l_local = g_counter"
  "    DISPLAY l_local"
  "    DISPLAY g_rec.id"
  "END MAIN"
  ""
  "FUNCTION globals_probe()"
  "    DISPLAY g_counter"
  "END FUNCTION"
)

Write-Fixture "$ws\topcust\aap\per\form_defs.per" @(
  "SCHEMA formonly"
  "LAYOUT"
  "GRID"
  "{"
  "  [good_field]"
  "}"
  "END"
  "END"
  "ATTRIBUTES"
  "EDIT good_field = formonly.good_field;"
  "END"
)

Write-Fixture "$ws\topcust\aap\4gl\field_main.4gl" @(
  "MAIN"
  '  OPEN WINDOW w WITH FORM "form_defs"'
  "  INPUT g_x FROM good_field"
  "    AFTER FIELD good_field"
  "    AFTER FIELD bad_field"
  "  END INPUT"
  "END MAIN"
)

Write-Fixture "$ws\topcust\aap\4gl\broken.4gl" @(
  "MAIN"
  '    DISPLAY "it''s unterminated'
  "END MAIN"
)

# 自检：首字节应是 47 4C 4F（"GLO"），不是 EF BB BF（BOM）
Format-Hex "$ws\topcust\config\globals_defs.global" | Select-Object -First 1
```

> 这份工作区里的 4 个 .4gl/.global/.per 文件与 `vscode-extension/test/fixtures/` 里的
> e2e 夹具同源，期望结果在 [§2](#2-语言服务在真机上的表现) 写明。

- [ ] 0.3 工作区已创建，`$ws` 路径含空格与中文，首字节**不是** `EF BB BF`
  - 记录（贴出实际路径与 Format-Hex 首行）：____

> **换 PowerShell 窗口后变量会丢**，先重新定义再继续（下面各节都用到）：
> ```powershell
> $ws  = "$env:USERPROFILE\bdl win 测试\topprod"
> $ext = (Get-ChildItem "$env:USERPROFILE\.vscode\extensions" -Directory `
>         -Filter "darcyjoven.4gl-full-*" | Sort-Object Name | Select-Object -Last 1).FullName
> ```

> **取证提示**：出问题时先执行命令 `Genero BDL: 显示输出`（输出通道），
> 里面是语言服务器 stderr 与客户端日志；失败项请把整段贴进 §9。

---

### 1. 装包：VSIX 能否真的装上、内置二进制能否跑

> 这是**最关键**的一段：CI 的 e2e 用的是"开发目录 + 扩展宿主"，**没有验证过 VSIX 安装路径**。

### 1.1 取得 win32-x64 VSIX（二选一）

**路线 A（推荐，用 CI 产物）**

```powershell
# 触发一次打包（也可在 GitHub 页面 Actions → bundle-vsix → Run workflow 里点）
gh workflow run bundle-vsix.yml -R darcyjoven/vscode-bdl `
  -f bdl_lsp_ref=main -f tiptop_ref=main

gh run list -R darcyjoven/vscode-bdl -w bundle-vsix -L 3      # 等它变绿
gh run download -R darcyjoven/vscode-bdl <run-id> -n vsix-win32-x64 -D .\vsix
Get-ChildItem .\vsix -Recurse -Filter *.vsix | Select-Object FullName
```

**路线 B（本机打包，需已克隆三个仓库）**

> 以下命令从**三个仓库的共同父目录**开始（`bdl-lsp\`、`tiptop\`、`vscode-extension\` 并列）。

```powershell
cd bdl-lsp   ; powershell -ExecutionPolicy Bypass -File scripts\build.ps1 -Check
cd ..\tiptop ; powershell -ExecutionPolicy Bypass -File scripts\build.ps1
cd ..\vscode-extension
npm install
npm run package            # typecheck + 打包 → dist-vsix\4gl-full-0.6.2-win32-x64.vsix
```

- [ ] 1.1 拿到 `4gl-full-0.6.2-win32-x64.vsix`
  - 记录（来源与文件名）：____

### 1.2 安装并确认内置二进制可用

```powershell
code --install-extension .\vsix\4gl-full-0.6.2-win32-x64.vsix --force
# 装完重启（或 Reload Window）VSCode

$ext = (Get-ChildItem "$env:USERPROFILE\.vscode\extensions" -Directory `
        -Filter "darcyjoven.4gl-full-*" | Sort-Object Name | Select-Object -Last 1).FullName
Get-ChildItem "$ext\bin"                       # 期望：bdl-lsp.exe、tiptop.exe、BUILD-INFO.json、若干 .dll
Get-Content    "$ext\bin\BUILD-INFO.json"
& "$ext\bin\bdl-lsp.exe" version               # 期望：bdl-lsp 0.3.13
& "$ext\bin\tiptop.exe"  version               # 期望：tiptop 0.1.8
& "$ext\bin\bdl-lsp.exe" check "$ws\topcust\aap\4gl\broken.4gl"
```

- [ ] 1.2 安装成功，`bin\` 下两个 exe + `BUILD-INFO.json` 都在
  - 记录：____
- [ ] 1.3 两个 exe 直接运行**不报缺 DLL**（`0xc0000135` 之类）
  - 记录：____
- [ ] 1.4 `Genero BDL: 显示语言服务器信息` 命令输出的「路径 / 来源」指向扩展内置 `bin\bdl-lsp.exe`
  - 记录：____

### 1.5 在 VSCode 里打开工作区

```powershell
code "$ws"
```

- [ ] 1.5 打开 `$ws` 后，状态栏/输出里语言服务器**运行中**（命令 `Genero BDL: 显示语言服务器信息`）
  - 记录：____
- [ ] 1.6 重启机器或重启 VSCode 后再打开一次，服务器仍能起来（排除"只在首次会话可用"）
- [ ] 1.7 **轻量档默认（P1-4）**：侧边栏**没有**「链接资料」视图；命令面板里搜
      `Genero BDL: 链接资料` 一条都没有（默认关）；工作区里**没有**被新建 `.project/` 目录
- [ ] 1.8 设置界面里设置分成 **5 组**：基础 / 生产环境 / 链接资料 / 部署 / 数据库字段
      （组标题不再带 "Genero BDL: " 前缀）
  - 记录：____

---

### 2. 语言服务在真机上的表现

打开 §0.3 的工作区，逐个文件看**真实 UI**（Problems 面板、悬停浮窗、跳转、补全）。

> 下面的"CLI 口径"是从这份夹具在 Linux 上实跑出来的（`bdl-lsp check`），
> 与 UI 里的数量可能因诊断级别设置略有差异，但**位置和归属文件应当一致**；
> 语义类（GLOBALS/字段）的期望同时被 e2e 套件断言（`vscode-extension/test/suite/index.js`）。

- [ ] 2.1 `broken.4gl`：出现**语法类**诊断，落在第 2 行第 13 列（未闭合字符串）
  - CLI 口径（可与 UI 对照）：
    ```powershell
    & "$ext\bin\bdl-lsp.exe" check "$ws\topcust\aap\4gl\broken.4gl"
    # 期望：2 个问题；`2:13 语法错误` 是主诊断
    ```
  - 记录：____
- [ ] 2.2 `globals_main.4gl`：**没有** `globals-file-not-found`；大纲（Outline）能看到 `MAIN`
  - 记录：____
- [ ] 2.3 光标停在 `g_counter` 上 → 悬停显示来源（`globals_defs.global`）
  - 记录：____
- [ ] 2.4 `g_counter` 上按 `F12` → 跳到 `topcust\config\globals_defs.global`（跨目录的 `../../config/` 引用）
  - 记录：____
- [ ] 2.5 `field_main.4gl`：`bad_field` 报 `field-not-in-form`，`good_field` **不报**；诊断可点开关联位置跳到 `.per`
  - 记录：____
- [ ] 2.6 格式化：在 `field_main.4gl` 上按 `Shift+Alt+F`，关键字大小写/缩进按设置生效；对 `.per` 执行格式化应被**拒绝**
  - 记录：____
- [ ] 2.7 补全：在 `MAIN` 里输入 `DIS` 能出关键字补全；输入一个已定义函数名能出符号补全
  - 记录：____
- [ ] 2.8 链接资料视图（侧边栏「链接资料」）能刷新、展开（没有 `.project/` 资料时给出提示而非报错）
  - 记录：____

---

### 3. ⭐ 本轮修复点回归（0.3.5–0.3.10 / 0.1.3–0.1.5 / 0.5.1–0.5.5）

> 本节涉及链接资料的项目，都**先打开** `bdl.link.enable`（P1-4 之后默认关）。

> 这些是本轮为了让 Windows 变绿而改的东西。**CI 只能证明单测过**，
> 真正的客户端行为（VSCode 收不收得到诊断、点击能不能打开）必须在真机上看。

### 3.1 ⭐ 带空格/中文的路径 + 盘符大小写

- [ ] 3.1 工作区路径含空格与中文（§0.3 就是），§2.2–2.4 全部正常
  - 记录：____
- [ ] 3.2 用**小写盘符**再打开一次同一目录（例如命令行 `code c:\users\...`），诊断与跳转仍正常
  - 记录：____
- [ ] 3.3 把工作区放到 `D:\` 等非系统盘（若本机有），重复 §2.3：悬停/跳转正常
  - 记录：____

### 3.2 ⭐ 链接资料诊断必须挂到 `.project\` 文件上

> 修复前：服务端手写 `"file://"+路径`，Windows 上生成非法 URI（`file://C:/…`），
> 客户端收不到这些诊断。**这是本轮最容易被忽略、但用户会真实遇到的一条。**

```powershell
New-Item -ItemType Directory -Force -Path "$ws\.project" | Out-Null
[IO.File]::WriteAllText("$ws\.project\links.jsonl", "{这不是 JSON}`n")
```

- [ ] 3.4 触发重载（重新打开工作区或执行 `Genero BDL: 重启语言服务器`）后，Problems 面板出现 `link-data-invalid`
  - 记录：____
- [ ] 3.5 该诊断**归属文件是 `.project\links.jsonl`**（点它能在编辑器里打开那个文件，而不是一个不存在的路径）
  - 记录：____

```powershell
# 3.6「旧资料不再告警」检查：写一份 2020 年的 meta
[IO.File]::WriteAllText("$ws\.project\links.jsonl",
  '{"schema":1,"program":"globals_main","module":"AAP","main":"globals_main","files":[["AAP","globals_main"]]}' + "`n")
[IO.File]::WriteAllText("$ws\.project\links.meta.json",
  '{"schema":1,"generatedAt":"2020-01-01T00:00:00+08:00","rowsTotal":1,"rowsY":1,"chains":1}')
```

- [ ] 3.6 **P1-6 起"过期"不再提示**：重启服务器后 Problems 面板**没有**任何来自
      `.project\links.meta.json` / `links.jsonl` 的提示（只有资料坏掉或还在旧 `.link/` 目录时才提示）
  - 记录：____

> 查完把这套假资料清掉（`Remove-Item "$ws\.project\links.jsonl","$ws\.project\links.meta.json"`），
> 否则 §3.3 的索引/符号搜索会受"缺文件"的资料影响。

### 3.2b ⭐ 旧目录 `.link/` 仍可用 + 一键迁移（P1-2）

```powershell
# 造一个"迁移前"的项目：把资料只放在旧目录 .link/
Remove-Item -Recurse -Force "$ws\.project" -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path "$ws\.link" | Out-Null
[IO.File]::WriteAllText("$ws\.link\links.jsonl",
  '{"schema":1,"program":"globals_main","module":"AAP","main":"globals_main","files":[["AAP","globals_main"]]}' + "`n")
[IO.File]::WriteAllText("$ws\.link\links.meta.json",
  '{"schema":1,"generatedAt":"2026-10-23T00:00:00+08:00","rowsTotal":1,"rowsY":1,"chains":1}')
```

- [ ] 3.2b.1 重新打开工作区后：链接视图/跨文件跳转**照旧可用**（不是"突然没有资料"）
- [ ] 3.2b.2 Problems 面板出现 `link-data-legacy-dir`（归属文件是**旧目录**的 `.link\links.jsonl`），
      并且右下角弹出一次"迁移 / 稍后"提示
- [ ] 3.2b.3 点"迁移"（或执行命令 `Genero BDL: 迁移项目资料目录`）→ 文件出现在 `.project/link/`，
      语言服务器自动重启，链接资料仍然可用、提示消失
  - 记录：____

### 3.2c ⭐ 大文件提示 + 强制解析（P0-3）

```powershell
# 用一个明显超过默认上限（20000 行）的文件；没有就用生成一个
$big = "$ws\topcust\aap\4gl\big.4gl"
'MAIN' + ("`n  DISPLAY 1" * 30000) + "`nEND MAIN" | Set-Content -Encoding utf8 "$big"
```

- [ ] 3.2c.1 打开 `big.4gl`：Problems 里出现 **warning** 级的 `file-too-large`（不是 information），大纲为空
- [ ] 3.2c.2 **编辑器标题栏右侧**出现"强制解析"图标（`.4gl` 已解析的文件不该有这个图标）
- [ ] 3.2c.3 点它 → 状态栏提示"已强制解析（关闭该文件后失效）"；大纲出现内容、`file-too-large` 消失
- [ ] 3.2c.4 关闭再打开该文件 → `file-too-large` 又出现（有效期到关闭）
  - 记录：____

### 3.3 ⭐ 工作区索引给出的位置能打开

> 先**关掉** `globals_main.4gl` 的编辑器标签——这一步专门验"没打开的文件也在索引里"。

- [ ] 3.7 等索引建完（输出通道会打耗时；大项目几十秒），按 `Ctrl+T` 搜 `globals_probe`
- [ ] 3.8 从搜索结果回车 → **能打开 `globals_main.4gl` 并定位到该函数**（不是"文件不存在"或空白）
  - 记录：____

### 3.4 ⭐ tiptop 的 `secrets.json` 在 Windows 不再被误判

> 修复前：该文件按 unix 权限位校验，Windows 上一律报"权限过松（0666）"，等于这条密码来源不可用。

```powershell
New-Item -ItemType Directory -Force -Path "$ws\.project" | Out-Null
[IO.File]::WriteAllText("$ws\.project\secrets.json", '{"<你的只读账号>": "<密码>"}')

$ext = (Get-ChildItem "$env:USERPROFILE\.vscode\extensions" -Directory `
        -Filter "darcyjoven.4gl-full-*" | Sort-Object Name | Select-Object -Last 1).FullName
& "$ext\bin\tiptop.exe" link status -root "$ws"
```

- [ ] 3.9 `link status` 能跑（没有资料时提示"没有资料"属正常）
  - 记录：____
- [ ] 3.10 用 `-source golang -dry-run` 试一次采集：**不再**出现「权限过松（0666），请 chmod 600」；
  连不上库时报的是连接错误（这才是预期）
  ```powershell
  & "$ext\bin\tiptop.exe" link sync -root "$ws" -source golang `
      -host <主机> -port 1521 -service <服务名> -user <只读账号> -dry-run
  ```
  - 记录：____

### 3.5 ⭐ 行尾（CRLF）不再干扰 lint

- [ ] 3.11 源码路线下 gofmt 检查通过（与 `make lint` 同口径，排除 `artifacts/` 里的模块缓存）
  ```powershell
  cd bdl-lsp
  gofmt -l . | Select-String -NotMatch '^artifacts/'    # 期望：无输出
  ```
  - 记录：____

---

### 4. 源码构建与自检（源码路线，可与 §1 并行）

```powershell
cd bdl-lsp
powershell -ExecutionPolicy Bypass -File scripts\build.ps1 -Check
```

- [ ] 4.1 构建成功，产物 `artifacts\bin\bdl-lsp.exe` 存在（PE 文件）
  - 记录：____
- [ ] 4.2 `build.ps1` 末尾的 `version` 自检打印 `bdl-lsp 0.3.13`
  - 记录：____
- [ ] 4.3 `-Check` 的样例冒烟通过（期望 `共 2 个文件，0 个有问题`）
  - 记录：____
- [ ] 4.4 全量单测通过：
  ```powershell
  cd bdl-lsp ; go test -race ./...
  ```
  - 记录：____
- [ ] 4.5 tiptop 同样构建 + 单测通过：
  ```powershell
  cd tiptop ; powershell -ExecutionPolicy Bypass -File scripts\build.ps1 ; go test -race ./...
  ```
  - 记录：____

---

### 5. 上传 / 生产端执行 / 资料采集 **[需服务器]**

> 需要：真实 SSH 可达的 Genero 机器（`fglcomp`/`fglform`/`r.*` 脚本可用）与只读 Oracle 账号。
> 没有就跳过并标注「未测」。变量：`$ws` = 测试工作区根，`$ext` = 解包后的扩展目录。

#### 5.0 上传配置（不用手写 JSON）

打开「上传编译链接」组的总开关（`bdl.deploy.enable`，默认关），上传方式选 `rsync`（或 `scp`），
在「账号、生产环境、配置」填生产服务器主机/端口/账号，并把「生产根目录」填成生产路径（如 `/u1/toppord`）。
插件会在上传/执行前合成为 `$ws\.project\deploy\deploy.json`（带 `createdBy`）。

- [ ] 5.0.1 只填一半（例如不填生产根）→ 提示要说清缺哪一项（"上传需要先配置：… 生产根目录（remoteRoot）"）
- [ ] 5.0.2 合成文件里 `createdBy = vscode-bdl <版本>`；手改删掉 `createdBy` 再上传一次 → 原文件被备份成 `deploy.json.bak`
- [ ] 5.0.3 上传方式选「不上传」（`transport = off`）→ 命令面板里上传命令消失，直接调用只提示
- [ ] 5.0.4 设置面板只有 **3 组**：基本设置 / 账号、生产环境、配置 / 上传编译链接；Oracle 连接含 `service`

#### 5.1 单文件上传（预演 + 实传）

- [ ] 5.1.1 `预演上传`：输出给出 `本地路径 → user@host:/生产根/相对路径`，**不连接服务器**
- [ ] 5.1.2 `上传当前文件`：文件出现在生产根同路径；**只传这一个文件**（不做批量同步）
- [ ] 5.1.3 命令行等价：
  ```powershell
  & "$ext\bin\tiptop.exe" upload -workspace "$ws" -file topcust\aap\4gl\globals_main.4gl -dry-run
  ```
- [ ] 5.1.4 Windows 上无 rsync → 输出里出现**显式回退**（`rsync 失败，回退 scp：…`），不是静默降级
  - 记录（贴出那几行）：____

#### 5.2 编译 / 链接 / 预览（在生产服务器上执行）

> 前置：`bdl.build.enable` 打开（默认关）。命令通过 `tiptop exec` 在**生产根目录**下执行，
> stdout/stderr 原样进「Genero BDL 任务」通道。**编译前不会自动上传**。

- [ ] 5.2.1 `4GL：预演编译` / `4GL：编译`：远端执行 `cd ${path} && r.c2 ${name}`，输出完整（含命令回显与退出码）
- [ ] 5.2.2 `4GL：链接`：弹 `${name}` 确认框（**只有这条弹**）；**没有 MAIN 的文件按钮置灰、不发 ssh**
- [ ] 5.2.3 `Form：预演编译` / `Form：编译`：`fglform` + `gsform` 按模板执行，产物按模板落到 `../42f/`、`../4fd/`
- [ ] 5.2.4 `Form：预览画面`：远端执行 `cd ${path} && r.gf ${name} 2 p`（三个参数，会调起本地 GUI）
- [ ] 5.2.5 改完文件**不点上传**直接编译 → 服务器上仍是旧代码（确认这与文档一致：上传是独立动作）
- [ ] 5.2.6 失败时通知带 stderr 首行；点「打开日志」打开 `last-run-exec.log`
- [ ] 5.2.7 输出通道只有两个：`Genero BDL`（服务器 + 追踪）与 `Genero BDL 任务`（上传/编译/链接/字段）
- [ ] 5.2.8 无生产配置时点编译 → 提示缺哪一项，而不是抛栈

#### 5.3 链接资料命令（在 VSCode 里，不用开终端）

> **前置**：`bdl.link.mode` 设为 `db`（连库）或 `file`（只用 CSV）；默认 `off` 时视图与命令都不出现。

- [ ] 5.3.1 没配数据库时执行 `链接资料：全量更新`：弹出明确提示（含「打开设置」「改用 CSV 导入」），不是静默失败
- [ ] 5.3.2 `链接资料：从 CSV 导入`：选 CSV → 复制到 `.project\link\gal_file.csv` → 全量导入，输出有进度
- [ ] 5.3.3 `从数据库更新`（**唯一**的更新入口，视图标题栏同一条）：只更新当前文件涉及的作业，**没有预演对话框**（W2），其它链保留
- [ ] 5.3.4 确认旧命令已删除：`链接资料：更新当前文件`、`重新同步` 在命令面板里搜不到（清理项 C1）
- [ ] 5.3.5 关闭 `bdl.link.mode`（设 `off`）：视图、命令、诊断一起消失
- [ ] 5.3.6 CLI 仍保留预演能力：
  ```powershell
  & "$ext\bin\tiptop.exe" link import -csv .project\link\gal_file.csv -root "$ws" -files topcust/aap/4gl/globals_main.4gl -dry-run
  ```
  → 输出「受影响作业 N 个（…）」，且没有写盘
  - 记录：____

#### 5.4 数据库字段资料

> **前置**：`bdl.schema.mode` = `db`（连库）或 `file`（CSV）；默认 `off`。

```powershell
& "$ext\bin\tiptop.exe" schema import -csv .\gal_schema.csv -root "$ws"
& "$ext\bin\tiptop.exe" schema status -root "$ws"
```

- [ ] 5.4.1 侧边栏出现「数据库字段」视图，首行显示"共 N 张表"（tooltip 有资料目录/导入时间/来源）
- [ ] 5.4.2 顶部正则查询框：`^IMA_` 只剩匹配表；半截正则 `(ima` → 退回全部并提示"正则无效"
- [ ] 5.4.3 展开一张表才加载列；列显示 `列名 · 类型(长度) · 中文说明`
- [ ] 5.4.4 `.4gl` 里 `DEFINE r RECORD LIKE ima_file.*` 悬停列字段；`DEFINE f LIKE ima_file.ima01` 悬停多出`字段资料：…`
- [ ] 5.4.5 表上右键「复制列定义」得到 `LIKE ima_file.ima01`；「打开表资料文件」打开 `.project\schema\tables\IMA_FILE.json`
- [ ] 5.4.6 多选批量：勾选两张 → 标题栏"已勾选 2 张" → `同步已选中的表` 只处理这两张
- [ ] 5.4.7 筛选批量：正则过滤后 → `全选当前列表` → `同步已选中的表`（确认旧的「同步当前筛选结果」已删除，C2）
- [ ] 5.4.8 ⭐ **W7 全量同步（慢链路）**：配好 Oracle 后执行 `从数据库同步` → 进度出现
      `共 N 张表，按每批 200 张分 M 批`、`批次 i/M：…`，**能跑完**、不再出现 `ORA-01013`
      - 记录（批次数与总耗时）：____
- [ ] 5.4.9 ⭐ **说明来自 TiTop 字典**：抽查 `ima_file` 等常用表，列说明来自 `DS.GAQ_FILE.gaq03`（不是 Oracle 备注），覆盖率明显高于旧行为
- [ ] 5.4.10 字典表缺失/无权限（ORA-00942）→ 提示「TiTop 字典表不存在，请改用 CSV 导入」
- [ ] 5.4.11 失败时点「打开日志」拿到 `last-run-schema.log`；输出在「Genero BDL 任务」通道
- [ ] 5.4.12 门控（W4）：未配库或无资料时，右键「同步选中的表」与批量按钮**不出现**
- [ ] 5.4.13 关闭 `bdl.schema.mode`：视图与命令消失

---

### 6. 自动化 e2e（可选，等价于 CI 的 Windows 行为在本机复现）

> 前提：三个仓库并列检出（`bdl-lsp\`、`tiptop\`、`vscode-extension\`）且
> `vscode-extension` 已 `npm install`。脚本会自己构建语言服务器、类型检查、
> 用 `dist` 起一个真实 VSCode 扩展宿主跑 38 条用例。

```powershell
cd bdl-lsp
powershell -ExecutionPolicy Bypass -File scripts\e2e-vscode.ps1
# 失败时想保留现场：加 -Keep
```

- [ ] 6.1 输出 `用例 38/38 通过` 且 `VSCode 退出码=0`
  - 记录：____

---

### 7. Windows 上**不要**误判为 Bug 的现象

| 现象 | 说明 |
|---|---|
| 部署时提示"缺少 rsync"并回退 scp | **设计如此**：Windows 默认没有 rsync，v1 的 Windows 验收就是走 scp 回退 |
| `record-member-unknown` 一条都不报 | 该诊断出厂默认 `off`（`LIKE table.*` 引用太多，误报风险高） |
| 资料明明很久没更新，却没提示 | **设计如此**（P1-6 去掉 7 天过期提示）：同步只由命令触发，插件不因为资料"旧"而报警 |
| 刚打开大项目时 `Ctrl+T` 搜不全 | 工作区索引在后台建（几十秒），期间结果不全属正常 |
| `fglcomp: command not found` | 这是**远端**的问题（目标机没装 Genero），与本机扩展无关 |
| 打开大文件时出现 `file-too-large` / `parse-timeout` 警告 | **有意为之**（P0-3）：这个文件确实没被检查，点标题栏的"强制解析"即可；不想要就调大 `bdl.limits.*` |
| 出现 `link-data-legacy-dir`（hint） | 资料还在旧布局（`.link/` 或 `.project` 根）：能用，但建议执行「迁移项目资料目录」搬到 `.project/{link,schema,deploy}/` |

---

### 8. Zed（Windows）

**暂停中**（用户 2026-10-22 决定；恢复入口见本文件 §3.5）——本次**不测**，勾选留空。

---

### 9. 结果汇总

| # | 项目 | 结果 | 现象 / 证据 |
|---|---|---|---|
| 0.1 | 工具链 | ⬜ | |
| 0.2 | 行尾设置 | ⬜ | |
| 0.3 | 测试工作区 | ⬜ | |
| 1.1 | 取得 VSIX | ⬜ | |
| 1.2–1.4 | 装包 + 内置二进制 | ⬜ | |
| 1.5–1.6 | VSCode 内服务器运行 | ⬜ | |
| 2.1–2.8 | 语言服务 UI 表现 | ⬜ | |
| 3.1–3.3 | ⭐ 路径/盘符 | ⬜ | |
| 3.2b | ⭐ 旧目录迁移 | ⬜ | |
| 3.2c | ⭐ 大文件提示 + 强制解析 | ⬜ | |
| 3.4–3.6 | ⭐ `.project` 诊断落点 + 旧资料不告警（P1-6） | ⬜ | |
| 3.7–3.8 | ⭐ 索引位置可打开 | ⬜ | |
| 3.9–3.10 | ⭐ secrets.json | ⬜ | |
| 3.11 | ⭐ gofmt / CRLF | ⬜ | |
| 4.1–4.5 | 源码构建 + 单测 | ⬜ | |
| 5.0 | ⭐ 上传配置（合成 deploy.json / 缺项提示） | ⬜ | |
| 5.1 | ⭐ 单文件上传（预演 + 实传 + scp 回退） | ⬜ | |
| 5.2 | ⭐ 编译/链接/预览（生产端执行） | ⬜ | |
| 5.3 | ⭐ 链接资料命令（VSCode 内） | ⬜ | |
| 5.4 | ⭐ 数据库字段资料（含 W7 分批全量同步） | ⬜ | |
| 6.1 | e2e 50/50 | ⬜ | |

**失败项汇总**（每条写：编号 / 期望 / 实际 / 日志或截图路径）：

1.
2.

**回归信息带回 Linux 侧**（贴回本文件 §1 的 C0 验收记录，或开 issue 时用）：

- 被测版本：`bdl-lsp 0.3.13` / `tiptop 0.1.8` / `4gl-full 0.6.2`
- 机器与架构：
- 失败项与最小复现：
- 语言服务器/任务输出（「Genero BDL」与「Genero BDL 任务」通道整段，或 globalStorage 的 `last-run-*.log`）：
---

## 附录 B：已决定不做 / 已取消（不计入待办，仅防重新纠结）

| # | 事项 | 决定与原因 |
|---|---|---|
| E2 | 跨文件重命名 | **刻意不做**：索引里的调用点是名字匹配，可能命中同名局部变量，漏改比不支持更糟 |
| E8 | 安装时提示把 `.link/` 加 `.gitignore` | **刻意不做**（不擅自改用户文件；`.project/` 里的 `secrets.json`/`deploy.json` 是插件内部文件） |
| E9 | 本地 Oracle 驱动（Instant Client / CGO） | **已取消**，只保留纯 Go `go-ora` |
| Zed-D1 | Zed 侧**复刻** VSCode 侧边栏 TreeView | Zed 无树视图 API；改用 MAIN 头上的 Code Lens（§3.5 关键前提） |
| Zed-D2 | 把链接树从 bdl-lsp **移到 tiptop** | 用户 2026-10-23 决策：link 分析保持原状（`Resolver.Tree()` 本就是纯内存查询，采集阶段早就在 tiptop） |
| Zed-D3 | Call Hierarchy（`prepareCallHierarchy`） | **语义不等价**：基于源码调用点，看不到"链接进链但没被调用"的文件，而那正是业务要看的 |
| Zed-D4 | LSP `documentLink` | 位置分散在文中（每个子文件一个 link 节点散落各行），正是 Code Lens 要避免的 |
| Zed-D5 | slash command 里做**会写盘**的采集/导入 | 误触成本高；这类操作只给 task（显式确认） |

> 注：`zed-extension/extension.toml` 的 `language_servers.bdl-lsp` 仍指向 `bdl-lsp`——这一层**不需要改**（语言服务器职责没变），只有"采集/部署"的命令名要改。

---

## 附录 D：发布与打包（维护者 runbook）

> 原 `RELEASE.md` 内容并入本附录（该文件已删除）。日常使用看 [`README.md`](../README.md)。

### D.1 平台矩阵

`bdl-lsp` 是 CGO + tree-sitter 的原生二进制，不能一个包跨系统，按目标平台分别打包。
VSCode 的 `--target` 会写进 VSIX 清单，市场和安装器据此只给用户匹配的包。

| 目标 | Runner | Go 目标 | 内置二进制 | 说明 |
|---|---|---|---|---|
| `win32-x64` | `windows-latest` | `windows/amd64` | `bin/bdl-lsp.exe` | 优先静态链接，失败退回动态链接并打包 MinGW 运行库 |
| `linux-x64` | `ubuntu-22.04` | `linux/amd64` | `bin/bdl-lsp` | glibc 2.35 基线，兼容 Ubuntu 22.04+ / Debian 12+ |
| `darwin-x64` | `macos-15-intel` | `darwin/amd64` | `bin/bdl-lsp` | Intel Mac |
| `darwin-arm64` | `macos-15` | `darwin/arm64` | `bin/bdl-lsp` | Apple Silicon |

构建定义在 [`.github/workflows/bundle-vsix.yml`](../.github/workflows/bundle-vsix.yml)。

### D.2 触发构建

1. GitHub Actions 页面 → `bundle-vsix` → **Run workflow**；可填 `bdl_lsp_ref`（默认 `main`，也可填 tag/SHA）与 `tiptop_ref`。
2. push `v*` tag。

每个矩阵 job 产出一个 artifact：`vsix-<target>`，内含 `4gl-full-<version>-<target>.vsix`。

### D.3 本地构建

```bash
cd ../bdl-lsp && source scripts/dev-env.sh && make build   # Windows 用 scripts\build.ps1
cd ../vscode-extension
npm ci --include=dev
npm run package        # 平台包：内置当前平台的 bdl-lsp + tiptop
npm run package:dev    # 开发包：不含二进制，仅本地冒烟
```

可覆盖来源与目标：

```bash
BDL_VSCODE_TARGET=linux-x64 BDL_LSP_BINARY=/path/to/bdl-lsp \
BDL_LSP_VERSION=0.3.13 node scripts/package-vsix.mjs
```

打包脚本会：复制二进制到 `bin/`；写 `bin/BUILD-INFO.json`（目标、版本、构建时间）；
当前平台与目标一致时执行 `bdl-lsp version` 自检；Windows 目标同时复制同目录 `*.dll`。

### D.4 校验产物

```bash
unzip -l dist-vsix/4gl-full-<version>-linux-x64.vsix
rm -rf /tmp/bdl-vsix && unzip -q dist-vsix/*.vsix -d /tmp/bdl-vsix
/tmp/bdl-vsix/extension/bin/bdl-lsp version
```

必须包含：`extension/bin/bdl-lsp`（Windows 为 `.exe`）、`extension/bin/tiptop`、`extension/bin/BUILD-INFO.json`、
`extension/dist/extension.js`、`extension/syntaxes/*.tmLanguage.json`、`extension/language-configuration/*.json`。
不能包含 `src/`、`test/`、`.github/`、`node_modules/`、`scripts/`。

### D.5 发布到市场

四个包分别发布，`--target` 必须与包一致：

```bash
npx vsce publish --target win32-x64   --packagePath dist-vsix/4gl-full-<version>-win32-x64.vsix
npx vsce publish --target linux-x64   --packagePath dist-vsix/4gl-full-<version>-linux-x64.vsix
npx vsce publish --target darwin-x64  --packagePath dist-vsix/4gl-full-<version>-darwin-x64.vsix
npx vsce publish --target darwin-arm64 --packagePath dist-vsix/4gl-full-<version>-darwin-arm64.vsix
```

平台包不加 `--target` 直接安装会报平台不匹配。

### D.6 注意事项

- **版本对齐**：扩展版本在 `package.json`；内置语言服务器版本由 `bdl-lsp/main.go` 注入，`BUILD-INFO.json` 记录两者。
- **不要提交二进制**：`bin/` 与 `dist-vsix/` 已在 `.gitignore`。
- **Windows 运行库**：先试 `-static`；失败则动态构建并复制 `libwinpthread-1.dll`、`libgcc_s_seh-1.dll` 到 `bin/`。
- **macOS runner**：用 `macos-15-intel`（Intel）与 `macos-15`（Apple Silicon）；`darwin-arm64` 不能跑在 Intel Mac 上。
- **bash 脚本里变量紧跟中文标点必须写 `${VAR}`**：bash 用 libc 的 `isalnum()`（按当前 locale 的 ctype 表）找变量名结尾；macOS 上 `$MODE（` 的首字节 `EF` 会被吞进变量名 → `set -u` 报 `unbound variable`，不带 `-u` 则静默丢字符。仓库级检查：`npm run lint:sh`（= `node ../bdl-lsp/scripts/check-sh-utf8-vars.mjs .`），CI 的 verify job 也会跑。
- **`init-project.sh` 要能在 macOS 自带 bash 3.2 上跑**：不能用 `mapfile`/`readarray`（bash 4.0+）；空数组在 `set -u` 下展开要写 `${arr[@]+"${arr[@]}"}`。改动后用 `scripts/init-project/test-local.sh` 在 bash 3.2 下回归（当前 47/47，全绿）。
- **装错平台包**：扩展读 `BUILD-INFO.json` 的 `target`，与当前平台不符时跳过内置二进制并回退外部路径。
- **覆盖内置二进制**：用户可用 `bdl.server.path` / `BDL_LSP_PATH` / 工作区 `.bdl-lsp/bin/`，见 [`README.md`](../README.md) 安装一节。

---
