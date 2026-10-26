# 待确认记录（需用户拍板）

> 位置：vscode-bdl 仓库。规则：确认后 → 在 docs/TODO.md 落成任务；完成后更新 docs/FEATURES.md 与 README.md。
> 生成于 2026-10-24（bdl-lsp 0.3.13 / tiptop 0.1.8 / vscode-bdl 0.6.2）

只收**尚未拍板**的开放问题；已明确决定的不收（如"市场暂缓""`.project/` 为唯一资料目录""链接只放大函数可见性"本身都是决定）。
每条最后一列给出**建议**时均已标注「建议」，仅供参考，不代表已定。
背景来源：bdl-lsp 的历史待办/设计归档（`NEXT` / `PENDING` / `PLUGIN-PLAN`，文件已随本次文档整理删除）；仍有效的见 `bdl-lsp/docs/FEATURES.md` 与 [README.md](../README.md)。确认后落到 [docs/TODO.md](TODO.md)，能力落在 [docs/FEATURES.md](FEATURES.md)。

## 1. 语言与诊断

| D-01 | T5 `variable-source-unresolved` 剩余 19580 条是否误报 | 全语料 T5 已由 24284 降到 19580（−19.4%）；剩余主体是**跨模块的模块级变量**（`L_AC` 1828、`G_RVV` 1715、`G_SFS` 1128…）：这些名字在语料里确有 `DEFINE`，但定义在**别的模块**的文件里，不在当前文件、也不在它引入的 `GLOBALS` 里 | 高：若判为噪声，需要按"模块/库"聚合可见性，属较大改动（类似 P7-D 的可见性矩阵）；若判为真报，工具不改，但需向用户解释口径 | 模块级 `DEFINE` 是否跨模块可见？是否要按模块/库聚合变量可见性？【建议】先不动，等你在真实项目里看这 1.9 万条是否构成噪声，再决定是否开新项 |
| D-02 | `record-member-unknown` 默认级别 | 当前默认 `off`（`LIKE table.*` 占引用 87%；开启后全语料仅 24 条但仍偏噪）；见 `bdl-lsp/docs/FEATURES.md` 附录 A.2 | 中：影响模式②（本地文件档）用户的默认体验与企划说明口径 | 是否把默认级别改为 `warning`？【建议】保持 `off`，等真实使用反馈再定 |
| D-03 | T5 人工标注（误报率基线） | `scripts/globals-audit.sh` **未做**；从未抽 100 处人工标注算误报率 | 中：是 D-01 拍板的取证手段 | 是否排期这次标注、由谁执行？【建议】先抽 100 处标注，再据此定 D-01 |
| D-04 | `expression name:` 跳过规则逐条复核 | 规则已修，但未逐条复核是否误伤 | 低-中：可能仍有同类漏报/误报未被发现 | 是否做一次语料差异清单人工抽查？【建议】与 D-03 合并做一次 |
| D-05 | 崩溃回归测试进 CI（P0-1b） | P0-1 崩溃修复目前只靠 `scripts/repro-index-crash.py` 人工证明；脚本依赖真实语料，CI 里没有 | 中：无自动化回归守护，同类"后台回调改文档树"问题可能复发 | 是否排期做"合成工作区"（伪 `.link/links.jsonl` + 预热窗口 + 大文件）的 CI 回归？【建议】排期做，属可自动化的确定性回归 |
| D-06 | Genero 5.0 语法支持何时启动 | 目标版本区间 2.50–5.0，当前基线 2.50；5.0 在清单里是"**暂不排期**"（`bdl-lsp/docs/FEATURES.md` #15 / N7） | 低（当前无明确 5.0 项目诉求）；一旦启动涉及 grammar 与语料投入 | 何时启动 5.0 适配？是否需要先拿到真实 5.0 语料与编译样本？【建议】维持暂缓，等有真实 5.0 项目再立项 |
| D-07 | 工作区索引是否跳过超大文件 | 索引目前解析全部文件，包括 `limits` 已排除诊断的超大文件；现况 7756 文件约 24.7 s | 低-中：大工程索引耗时与内存 | 是否让索引按阈值跳过超大文件？阈值沿用 `bdl.limits.maxFileBytes` 还是新增独立键？【建议】沿用 `bdl.limits.*`，等性能需要时再开 |

## 2. 发布与平台
| P-01 | Windows 真机验收的排期与机器来源 | 从未有人在真机上装过插件；CI 只覆盖"构建 + 单测 + 自检"（§2）。验收按 [docs/TODO.md](TODO.md) 附录 A 共 71 项 | 高：直接决定"能不能交付给别人用" | 谁在什么时间做？机器从哪来？【建议】先定一台 Windows 机与一个验收窗口 |
| P-02 | macOS 真机验收的排期与机器来源 | CI 已产出 `darwin-x64` / `darwin-arm64` 两个包，但无人装过；CI 能构建 ≠ 能装上跑起来 | 高：同一交付门槛 | 是否需要验证？Intel 还是 Apple Silicon（或两者都要）？机器谁提供？【建议】至少验一台 Apple Silicon，做工抽样 |
| P-03 | 真实 Genero 服务器验证 | 无本机 `fglcomp` / `fglform`；"ssh 通 + 单文件部署 + 远程编译"整条链路未实跑 | 中-高：远程编译结果回到 Problems 是模式①卖点 | 能否提供一台可 ssh 的 Genero 环境？何时？【建议】与 P-01 同批约机器 |
| P-04 | Oracle 真库验证（直连采集） | D1 `tiptop schema sync -source golang`、D2 `tiptop link sync -source golang` 只验了 SQL 生成 / `-source file` 全链路 / 密码来源与参数校验的单测；沙箱无 Oracle | 中-高：直连库是模式①主路径，未跑过真库就不算验证 | 只读库账号与主机谁提供？何时实跑？【建议】与 P-03 同批，使用只读账号并核对表数/列数与 DBA 导出一致 |
| P-05 | tag 与 GitHub Release 何时落地 | `bdl-lsp` 至今无 tag，`tiptop/go.mod` 靠 `replace ../bdl-lsp`，CI 只能追 `main`（版本漂移 F1/F9）；`bundle-vsix.yml` 只有 `workflow_dispatch`，**没有 release job**，现有 Actions artifact 90 天过期 | 高：决定能否 `go install` 分发、产物是否可复现 | 何时打三个 tag（`bdl-lsp v0.3.13` / `tiptop v0.1.8` / `vscode-bdl v0.6.2`）？Release 用 tag push 还是手动触发？是否同时把 `replace` 换成版本号？【建议】P-01/P-02 全绿后立刻执行，Release 支持 tag push + 手动输入 |
| P-06 | 市场（vsce）/ Open VSX 发布启动时机 | "暂缓"本身是已定决定，但**何时启动**没定 | 中：决定用户获取方式（VSIX 手动装 vs 市场一键装） | 什么时候启动 `vsce publish` + Open VSX？【建议】Release 稳定一版后再启动 |
| P-07 | README 与发布状态口径不一致 | [README.md](../README.md) 开头已写"扩展市场里搜 `Genero BDL (4GL)`（扩展 id `4gl-full`，发布者 `darcyjoven`）即可安装"，而市场发布尚未启动（P-06） | 中：用户照 README 去市场会搜不到，属对外口径问题 | 是先发布，还是把 README 改成"目前用 VSIX 安装，市场即将上线"？【建议】先改 README 口径，避免死链式体验 |
| P-08 | Zed 注册表发布 | 未排期；且 Zed 扩展本体是否恢复也待定（见 E-01） | 低 | 是否随 Zed 恢复一起排？【建议】等 E-01 定论后再定 |
| P-09 | 二进制自动下载 / 校验 / 缓存 | "无感"体验增强，未排期（`bdl-lsp/docs/FEATURES.md` #13）；前置是 P-05 的 GitHub Release | 中：决定用户要不要手工编译/指定路径 | 是否排期？【建议】P-05 完成后再做，先保证内置二进制路径可用 |
| P-10 | 三个二进制的版本兼容矩阵 | 扩展与 LSP/tiptop 版本各自独立递增，**没有兼容矩阵**，客户端与服务端错配时无回退策略 | 中：用户混装版本后症状隐蔽 | 是否要定"插件 ↔ 后端最低/最高版本"策略？错配时如何提示？【建议】出一张兼容表 + 服务器启动时校验版本并给一次性提示 |
| P-11 | Windows scp 回退实测 | Windows 无 rsync → 走 scp 回退，稳定性/性能未实测 | 中：Windows 用户的部署路径 | 是否纳入 P-01 的验收清单一起测？【建议】纳入 71 项验收 |
| P-12 | 部署编译细节（超时与产物） | 单文件远程编译超时阈值、编译产物 `.42m` 是否拉回本地，现属 tiptop，标注"待确认" | 低-中：影响大文件部署体验与磁盘占用 | 超时定多少、是否暴露成设置？`.42m` 要不要拉回？【建议】超时沿用现默认并暴露参数；产物默认不拉回 |
| P-13 | 文档配图/录屏占位补齐 | [README.md](../README.md) 有 G1–G11 共 11 处 📷 占位；详细手册另有 10 张（`docs/images/vscode/`）未补 | 中：市场说明与手册缺图，观感与可信度受影响 | 谁拍、何时拍？能否先不带图发布？【建议】发布前至少补 G1（三档总览）、G2（安装）、G7（字段视图）、G9（进度） |
| P-14 | [README.md](../README.md) 附录 A 占位符 | `<用户名>` / `<生产主机>` / `<Oracle主机>` 需按实际环境替换 | 低：填实际值会带入敏感信息 | 是否填成实际环境？【建议】保留占位符并加一句"按你的环境替换"说明 |
| P-15 | 纯 Go SFTP 是否评估 | 已选 rsync/scp 主备；纯 Go SFTP "仅在确有需求时评估"（`bdl-lsp/docs/FEATURES.md` N6） | 低：影响精简环境（无 rsync/scp）能否部署 | 是否有这种场景需要它？【建议】暂不评估 |

## 3. 编辑器支持
| E-01 | Zed 扩展（`4gl-full`）是否恢复、何时恢复 | **口径冲突**：按 VSCode 进度追平"）" | 中-高：决定 Z-A/Z-B 整组工作是否启动 | 到底做不做、什么时候？【建议】明确一次，并把两份文档口径改成一致 |
| E-02 | Zed Code Lens 实机验证（Z-A6） | 两个行为决定实现方式：① `code_lens: "on"` 时多条同 range 的 lens 是否各占一行；② 点击 lens 的 `command` 能否打开目标文件。需**有 GUI 的机器** | 中：它决定 Z-B2（服务端 Code Lens）怎么实现 | 是否安排有 GUI 的机器做这次验证？【建议】与 E-01 一起定，且按文档要求**先做** Z-A6 再动 Z-B2 |
| E-03 | Z-B1 `workspace/executeCommand` 通道（需授权改 bdl-lsp） | 需在 `ServerCapabilities` 加 `ExecuteCommandProvider`，并把 `bdl/linkTree` / `bdl/linkReferences` / `bdl/forceParse` 转接为标准命令 | 中：Zed 侧命令点击的前置 | 是否授权改动 `bdl-lsp`？【建议】授权；VSCode 侧继续用自定义请求，不受影响 |
| E-04 | Z-B2 Code Lens 服务端实现（需授权、两端共用） | `textDocument/codeLens`：链内子文件各一条 lens 挂在 MAIN 头上，`bdl.link.lensMax` 默认 10；与 §P 的 P1-8（E-05）**是同一份实现**（§P P1-8） | 中-高：VSCode 与 Zed 共用的能力 | 是否授权？是否与 VSCode 侧一起做？【建议】授权并只实现一份，两端共用 |
| E-05 | VSCode 侧链接资料 Code Lens（P1-8）何时排期 | P1-8 未完成：作为侧边栏 TreeView 的**补充视图**（就地看，不切面板），可点、可分页；依赖 E-04 的服务端实现 | 中：TreeView 之外的体验提升 | 是否排期做？"与 TreeView 并存、不互相替代"的定位是否认可？【建议】排期，与 E-04 同批 |
| E-06 | Zed 语义高亮的默认状态 | 需加 `languages/bdl/semantic_token_rules.json`；Zed 默认 **off**，用户必须自己写 `{"languages":{"Genero BDL":{"semantic_tokens":"combined"}}}` 才生效 | 低-中：默认关等于多数用户看不到该能力 | 是否接受默认关（靠文档教用户开）？【建议】接受默认关，但在 [README.md](../README.md) 写清开启方法 |
| E-07 | Zed dev extension 手工加载验证（B4） | 无图形界面：`zed: install dev extension` 能否加载、LSP 能否起、大纲层级是否正确，均未验 | 低 | 是否安排这次验证（可与 E-02 同机）？【建议】与 E-02 同批做 |
| E-08 | ABI 15 ↔ Zed tree-sitter 运行时兼容 | 未在 Zed 实机验证 | 中：直接影响 Zed 侧语法高亮能否用 | 是否纳入 Zed 恢复后的首次实机检查？【建议】纳入 |

## 4. 资料与兼容
| C-01 | 旧 `.link/` 目录兼容保留多久、是否强制迁移 | 现状：读 `.project/` 优先、旧 `.link/` **只读兼容**，出现 `link-data-legacy-dir`（hint）并在看到提示时弹"迁移/稍后"，命令 `bdl.migrateLinkDir` 一键搬 | 中：兼容分支与文档需要长期维护 | 保留到什么时候？到期后是只发警告还是彻底不读？【建议】先无限期只读兼容 + hint，等模式①用户迁完再定死线 |
| C-02 | 旧 `.bdl-lsp/` 目录兼容期限 | tiptop 默认配置目录已由 `.bdl-lsp/` 改为 `.project/`，旧目录**只读兼容** | 低：老工作区的 `deploy.json` 还在旧目录 | 同样问期限与是否强制迁移？【建议】与 C-01 同一口径，一处决定两处执行 |
| C-03 | schema 列语义校准时点与口径 | 正式导入数据时按**前 1000 行**校准列语义，尤其 `data_length` / `char_length` 在 `VARCHAR2` / `NUMBER` 上的取舍；历史设计归档当时标注"发布后一版再定，不阻塞发布" | 中：直接影响悬停与补全里显示的列类型/长度是否可信 | 长度按什么口径取（`char_length` 优先？`data_length` 优先？按类型分支）？何时校准？【建议】后一版做，暂定 `char_length` 优先、缺失回落 `data_length` |
| C-04 | 旧 `.sch` 资料的重建/迁移路径 | P2-1 已把"扫各模组 `sch/*.sch`"与 `schema.paths` **整包下线**（`bdl-lsp/docs/FEATURES.md` #38f）；只有 `.sch` 的老工作区必须重新导出 CSV 或直连库 | 中：老项目需要重建字段资料，步骤只在文档里 | 是否提供 `.sch → .schema` 转换工具？还是只文档化"重新导出 CSV"？【建议】先文档化重建步骤，确有需求再做转换器 |
| C-05 | schema 增量采集（P2-1+）是否排期 | 现在是"全量查询 → 逐表逐字节比较，只写变化的表"；可加"按表 diff（只查变化的表）"或 `-since` 时间戳过滤；实测 2648 表 2.4 s | 低：当前性能已够用 | 是否排期做增量？【建议】暂不做，等表规模或库变慢再开 |
| C-07 | 表字段 CSV 的导出 SQL 模板 | README §2.1 说表字段资料"由 DBA 导出 `ALL_TAB_COLUMNS` + `ALL_COL_COMMENTS`（见 tiptop 仓库文档）"，但未确认是否已有可直接交给 DBA 的导出 SQL | 低-中：DBA 侧自助导出的成本与出错误的概率 | 是否提供一份正式的导出 SQL 模板进 tiptop 文档/脚本？【建议】提供模板，并在 README §2.1 直接链接 |

## 5. Windows 实机反馈（已按建议实现，无待确认项）

> 对应 [docs/TODO.md](TODO.md) §0b 的 W1–W6 工作包。**W1–W6 全部已按建议值实现（2026-10-26，第 1–4 轮）**，
> 本节原先的 8 项（`W-a` 强制解析无界后台、`W-b` link/schema 直接执行 + 静态确认、`W-c` Windows cmd / 类 Unix sh、
> `W-d` 链接与编译弹 `${name}`、`W-e` 六键 `bdl.build.*`、`W-f` deploy.json 移入 `.project/deploy/`、
> `W-g` 检测 + 提示 + 一键迁移、`W-h` 只认 `MAIN` 程序块）都已落地；本节暂无待确认项，
> 实现状态与"待 Windows 复测"见 [docs/TODO.md](TODO.md) §0b。

## 6. 字段资料同步（2026-10-26 反馈，已定）

| 编号 | 事项 | 背景/现状 | 影响 | 需要你确认什么 |
|---|---|---|---|---|
> 你已选定方案：**分批查询**——先取表清单，再按**每批 200 张表**查明细，一批完成继续下一批。
> 实现为 `schema sync -batch-size 200`（0=不分批）、每批超时 `-timeout 120` 秒；不再依赖加大单条查询的超时。

## 7. 设置重构 V2 的小决策（2026-10-26 已确认）

- **S-a** 接受建议：`bdl.prod.deploy.transport` = `off | rsync | scp`（`off` 时隐藏上传命令；`rsync` = 主 rsync、备 scp）。
- **S-b** **只有 4GL「链接」弹 `${name}` 输入框**；4GL 编译、Form 预演编译/编译/预览都不弹。
- **S-c** 远程执行会自行调起本地 GUI；我们只按命令执行并回传输出，不做特殊处理。
- **S-d** `2 p` 不是笔误：Form「预览画面」默认命令字面为 `cd ${path} && r.gf ${name} 2 p`。
- **S-e** 基本设置（现有 22 键）全部维持不动。
- **S-f** 沿用 `bdl.deploy.enable` 作为"上传编译链接"组的总开关。

## 8. 字段说明 SQL 与图标（2026-10-26 已确认）

- **S-g** `zta02='ds'` 固定；临时条件 `zta01='ima_file'` 去掉（分批时自动变成 `zta01 IN (...)`）。
- **S-h** 用**应用 schema 账号**（自己拥有表、且对 `ds.zta_file`/`ds.gaq_file` 有读权限）→ `user_tab_columns`，不需要 `owner`。
- **S-i** 本版本只做 **TiTop 专用**；字典表不存在时提示「请改用 CSV 导入」。
- **S-j** 列名**全部小写**；Form 预览命令是**三个参数** `${name}`、`2`、`p`。
- **S-k** 图标方案确认：过滤 `$(filter)`、刷新 `$(refresh)`、CSV 导入 `$(file-add)`、重新同步 `$(sync)`、从数据库更新 `$(cloud-download)`；编译 4gl/per 改 `$(play)`；标题栏其余 4 个文字按钮一并图标化。

## 9. 采集中间文件（2026-10-26 已定）

- **S-l / S-m / S-n / S-o**：用户决定**不保存中间文件**——采集本身不落盘（维持现状），只保存最终结果（`links.jsonl` / `.schema`）。
  TODO §0f 已作废，不再实现 CSV/SQL 落盘。

