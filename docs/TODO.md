# 待办清单（唯一实时清单）

> 维护位置：vscode-bdl 仓库（本文件）。新会话入口。
> 维护规则：待办完成时 → ①把新功能写进对应项目的 docs/FEATURES.md；
> ②若是用户可见的新功能，同步更新 README.md 用户引导；③在本文移除该条。
> 状态基线：bdl-lsp 0.3.13 / tiptop 0.1.8 / vscode-bdl 0.6.2（生成于 2026-10-24）

> 本文件由 bdl-lsp 仓库里散落的待办（原 `NEXT.md` / `PENDING.md` / `PLUGIN-PLAN.md` /
> `WINDOWS-CHECKLIST.md`）合并而成，**只保留仍未完成的条目**；已完成项在附录 C 用一行汇总。
> 需要翻历史证据时：已实现能力看 [`FEATURES.md`](FEATURES.md)；待拍板/开放问题看
> [`OPEN-ITEMS.md`](OPEN-ITEMS.md)（本清单也内联了关键口径）。

---

## 0. 一句话开场（复制给新会话）

```text
读 vscode-extension/docs/TODO.md，先做 §0d「设置重构 V2 + 远程编译/链接/预览」：
按已确认的方案重构设置分组、新增 tiptop 远程执行与单文件上传、插件命令随之调整。
```

```text
（已完成的）§0c 字段资料同步、§0b Windows 反馈 W1–W6 见各自小节与附录 E。
```

```text
然后做 §1「发布闭环」：按附录 A 做 Windows 实机验收（C0，其中务必按附录 E 复测 W1–W6）、
打 tag（C1）、给 bundle-vsix.yml 加 release job（C2）。
```

```text
做 Zed 追平：读本文件 §3.5，先做 Z-A6（Code Lens 实机验证），再做 Z-B1 → Z-B2。
```

## 0b. Windows 实机反馈 W1–W6（**已完成**，见 附录 E）

> 2026-10-24 实机反馈的 6 组问题已全部实现（2026-10-26，第 1–4 轮；e2e 49/49、三仓库全绿）。
> 实现摘要与**真机复测要点**见 [附录 E](#附录-ew1w6-实现摘要与真机复测要点)。
> 这批改动尚未在 Windows 实机复测——**C0 验收时按附录 E 逐条复测**，有问题就新开待办。

---

## 0c. 字段资料全量同步失败排查（2026-10-26 反馈，下一轮先做）

**现象**：`数据库字段：从数据库同步` 报「失败（退出码 1）」。输出其实写进了**「Genero BDL 链接资料」**通道
（不是"空面板"），错误原文：

```text
tiptop schema sync: 查询失败: ORA-01013: user requested cancel of current operation
 error occur at position: 182
```

**根因（已确认）**：`ORA-01013` 是 Oracle 的"语句被取消"。用户选定方案：**分批查询**——先取表清单，再每 200 张表查一批，跑完一批继续下一批（而不是单纯加大超时）。

| # | 事实 | 位置 |
|---|---|---|
| a | `schema sync` 给全量查询的**总超时只有 120 秒**（`link sync` 是 60 秒） | `tiptop/internal/schemacli/sync.go:133`、`tiptop/internal/linksync/db.go:36` |
| b | 这个超时是**整段查询 + 逐行读取**的总时限（`context.WithTimeout`），不是"无进展才取消" | `tiptop/internal/oradb/oradb.go:88-91`、`QueryContext` |
| c | 超时后 context 取消传到 go-ora → Oracle 中断语句 → `ORA-01013`，被包成「查询失败」退出 1 | `oradb.go:103-105` |
| d | 全量查 `ALL_TAB_COLUMNS` + `ALL_COL_COMMENTS`（几千表/几万列）在慢链路超过 120s 很正常；等待期间能看到「已收到 N 行」进度 | `docs/FEATURES.md` 里的 2.4 s 是本机快库口径 |

**第二个问题（W6 回归）**：`secrets.json` 路径不一致——schema 读 `.project/secrets.json`，
link 却读 `.project/link/secrets.json`。原因：`oradb.QueryCSV` 用传入目录找 secrets，
而 W6 把 link 资料目录改成 `.project/link` 后，`linksync` 把 link 目录当成了 secrets 目录
（`linksync/db.go:36` ← `source.go:138` ← `sync.go:51-56`）。**统一为 `.project/secrets.json`。**

**第三个问题（可见性）**：schema 的输出被写进「链接资料」通道，失败提示却让用户看「数据库字段」通道。

**关于空的 `.tmp-#T28_SID`**：`writeFileAtomic` 正常错误返回会 `defer` 删除临时文件；**空**文件更像
**上一次运行被取消/被杀**（插件取消会 `child.kill()`，defer 来不及跑）或删除时被 Windows 占用
（`_ = os.Remove(tmp)` 静默吞掉）。不是本次失败的直接原因，但仍要清理＋告警（W7.8）。

**状态（2026-10-26，已修复）**：W7.1–W7.10 全部实现；tiptop 全量测试、`npm run typecheck`、e2e 49/49 通过。
**待你在 Windows 慢链路上复跑一次全量同步验证**（正是要验的场景：能否跑完、失败时能否看到原因）。

| # | 要做的事 | 验收 |
|---|---|---|
| ✅ W7.1 | **查询超时改为「空闲超时 + 总上限」**：每收到一行就重置空闲计时（默认 120s），另设总上限（默认 30min）；`schema sync` / `link sync` 共用；CLI 加 `-timeout`；插件加设置（策略见 OPEN-ITEMS `W-i`） | 慢链路上的全量查询不再 120s 到点被取消 |
| ✅ W7.2 | `ORA-01013` 人话化：识别该码 → 「查询被超时取消（空闲超过 Ns）：可加大 `-timeout`/设置，或改用 CSV 导入」 | 报错一眼能懂并给出下一步 |
| ✅ W7.3 | **secrets 路径统一**：`oradb` 参数语义改为"secrets 目录"；`linksync` 传**项目目录**（`.project`）而非 link 资料目录；schema 保持 `.project` | 同一个 `.project/secrets.json` 对 link/schema 都生效；`link sync` 不再去 `.project/link/` 找密码 |
| ✅ W7.4 | 回归测试：`link sync -source golang` 的 secrets 只在 `.project/secrets.json` 生效（`.project/link/secrets.json` 不再被读）；`schema sync` 同理；文档口径一致 | 单测 + 文档 |
| ✅ W7.5 | **输出通道修正**：进度执行器支持指定通道；schema 写「数据库字段」、link 写「链接资料」 | 两个通道各自只出现本功能输出 |
| ✅ W7.6 | 失败可见性：错误对话框带 stderr 末尾若干行（去空行、限长）；"详见…"指向的通道保证有内容 | 只看通知就知道原因 |
| ✅ W7.7 | 每次 tiptop 运行**落盘完整日志**（扩展 globalStorage，带时间戳）；失败提示给出文件路径 | 通道被清/编辑器重启后仍可回看，便于远程报错 |
| ✅ W7.8 | 临时文件：`schema import/sync` 启动时清理 `tables/` 下遗留的 `.tmp-*`（link 目录同理）；删除失败记警告 | 复跑后不再残留；失败有记录 |
| ✅ W7.9 | 表名安全校验：`tableFileName` 对 `\ / : * ? " < > \|` 与超长名给明确报错（带表名） | 遇到非法表名能看出是哪张表 |
| ✅ W7.10 | 排障文档：通道/日志/`-timeout`/`ORA-01013`/权限与 `-owner` 自检 SQL 写进 README FAQ + tiptop 文档 | 用户可自助定位 |

**顺序**：W7.1–W7.3（根因）→ W7.5–W7.7（可见性）→ W7.8–W7.10（清理与文档）。
做完请你在 Windows 复跑一次全量同步验证（慢链路正是要验的场景）。

---

## 0d. 设置重构 V2 + 远程编译/链接/预览（2026-10-26 已确认，执行中）

**已确认的决策**（用户 2026-10-26 确认）

| # | 决策 |
|---|---|
| D1 | 设置分 **3 组**：**基本设置** / **账号、生产环境、配置** / **上传编译链接**（把"键少的"生产环境+链接资料+数据库字段合并；基础与编译链接各独立一组） |
| D2 | 数据库配置加 **`service`**（连接必需）；**不加 `owner`**；密码**不进设置**（`<项目>/.project/secrets.json` 或 `BDL_ORA_PASSWORD`） |
| D3 | 生产服务器填 host/port/user（默认示例 `erp`/`22`/`tiptop`）；**SSH 密钥登录，不支持密码**；保留 `strictHostKey` |
| D4 | 上传**只允许单文件**（当前打开文件，按"项目根目录 → 生产根目录"映射路径）；**删除整包/批量同步** |
| D5 | **编译/链接/预览在生产服务器上执行（ssh）**；**不自动上传**——用户自己决定先点「上传当前文件」再点编译/链接/预览 |
| D6 | link/schema 做**三态** `bdl.link.mode` / `bdl.schema.mode` = `off|file|db`（`file`=只用 CSV 导入，`db`=可连库）。**不保留旧键兼容**（未发布，用户 2026-10-26 决定删除全部旧值兼容） |
| D7 | 删除：整包部署命令、`bdl.deploy.target`、「列出部署目标」、`include/exclude/delete`、`prod.deploy.compile4gl/compilePer`（由新的编译命令取代） |
| D8 | 保留：上传方式 `transport`（`off|rsync|scp`，rsync 主 scp 备）、`localRoot`（项目根目录，默认 `.`）、`remoteRoot`（生产根目录，示例 `/u1/toppord`）、`link.moduleRoots`/`globalModules`、schema `batchSize`/`timeoutSec` |
| D9 | 基本设置（现有 22 键：server/tools 路径、日志、trace、generoVersion、diagnostics、format、index、globals/perRoots、builtins、ignore、limits）**维持不变** |
| D10 | 上传方式枚举 `transport = off\|rsync\|scp`（`off` 时隐藏上传命令；`rsync` = 主 rsync、备 scp） |
| D11 | **只有 4GL「链接」弹 `${name}` 输入框**；4GL 编译、Form 预演编译/编译/预览都不弹，直接用默认名 |
| D12 | Form「预览画面」默认命令**按原文加 `2 p`**：`cd ${path} && r.gf ${name} 2 p`（不是笔误，字面照录；确切写法见 OPEN-ITEMS S-j） |
| D13 | 远程执行会自行调起本地 GUI（`r.gf` 等）；我们只按命令执行、回传输出，不做特殊处理 |
| D14 | 视图/工具栏图标化：「数据库字段」的正则过滤/刷新/CSV 导入，「链接资料」的重新同步/从数据库更新；**编译 4gl / 编译 per 的图标从齿轮改为运行形状**（`$(play)`） |
| D15 | 字段说明 SQL：默认查询就用你的 TiTop 字典 SQL，`zta02='ds'` **固定**；你临时加的 `zta01='ima_file'` **去掉**（分批时自动变成 `zta01 IN (...)`） |
| D16 | 连接账号 = **应用 schema 账号**（自己拥有表 + 对 `ds.zta_file`/`ds.gaq_file` 有读权限），故用 `user_tab_columns`，`owner` 不需要 |
| D17 | 本版本**只用 TiTop 专用字典 SQL**；若 `DS.ZTA_FILE`/`DS.GAQ_FILE` 不存在（ORA-00942）→ 明确提示「TiTop 字典表不存在，请改用 CSV 导入」 |
| D18 | 列名**全部小写**（SQL 里 `lower(column_name)`）；Form 预览命令是**三个参数**：`cd ${path} && r.gf ${name} 2 p`（`${name}`、`2`、`p`） |

**目标键位（3 组，约 55 键）**

| 组 | 键 |
|---|---|
| 基本设置（22） | 现有「基础」原样 |
| 账号、生产环境、配置（16） | `prod.oracle.host/port/service/user`；`prod.deploy.host/port/user/strictHostKey`；`link.mode`/`link.dataDir`/`link.moduleRoots`/`link.globalModules`；`schema.mode`/`schema.dataDir`/`schema.batchSize`/`schema.timeoutSec` |
| 上传编译链接（17） | `deploy.enable`（组总开关）、`prod.deploy.transport`、`prod.deploy.localRoot`、`prod.deploy.remoteRoot`；`build.enable`（编译/链接/预览总开关）；6 组 `<lang>.<mode>.enable` + `.command`（4gl：preview/compile/link，per：preview/compile/form） |

**要做的**

**状态（2026-10-26，已实现并全绿）**：**T1–T9 全部完成**。

- 设置重构为 **3 组 55 键**（基本设置 22 / 账号、生产环境、配置 16 / 上传编译链接 17）；新增 `bdl.prod.oracle.service`、`bdl.link.mode`/`bdl.schema.mode`（off/file/db）、`bdl.prod.deploy.transport`（off/rsync/scp）、`bdl.build.enable` + 6 组 `enable`/`command`；删除整包部署、`deploy.target`、列出目标、`include`/`exclude`/`delete`/`compile4gl|Per`。**不保留任何旧键兼容**：`link.enable`/`schema.enable`、旧 6 个 build 键、`deploy.target` 等一律不再读取（未发布）。
- **bdl-lsp 也认 `mode`**（`SchemaSettings.Mode`/`LinkSettings.Mode`；服务端另有 `enable` 布尔入口，供 Zed 等直接配置 LSP 的客户端使用，`mode` 非空时优先），并加了单测。
- 插件：命令 37 → **35**（删除 2 条），上传只剩「上传当前文件 / 预演上传」（单文件）；编译/链接/预览改走 `tiptop exec`（生产端 ssh，不自动上传）；**只有 4GL 链接弹 `${name}`**；视图按钮图标化 + 编译图标 `$(play)`；`dbctx` 新增 `bdl.link.enabled`/`modeDb`/`schema.enabled`/`schema.modeDb`/`upload.enabled`/`build.enabled` 门控。
- 验证：bdl-lsp 全量测试、tiptop 全量测试、`npm run typecheck`、**e2e 49/49** 全绿；`tiptop upload/exec -dry-run` 实跑验证。
- **剩余**：真机连生产服务器验证上传/编译/链接/预览（本地无法连）——建议按下面清单在 Windows 上过一遍。

| # | 真机验证清单 | 预期 |
|---|---|---|
| V1 | 填好生产服务器 + 生产根 + transport=rsync，点「预演上传」 | 输出里给出 本地路径 → `user@host:/生产根/相对路径`，不连接 |
| V2 | 点「上传当前文件」 | 文件出现在生产根同路径；失败时通知带 stderr 首行 + 「打开日志」 |
| V3 | 点「4GL：编译」 | 在服务器对应目录执行 `cd ${path} && r.c2 ${name}`，输出进「Genero BDL 编译」 |
| V4 | 4GL「链接」按钮（无 MAIN 的文件） | 按钮禁用/本地直接报错，不发 ssh |
| V5 | Form「预览画面」 | 远程执行 `cd ${path} && r.gf ${name} 2 p`（会调起本地 GUI） |

> 旧键兼容已**全部删除**（未发布，用户 2026-10-26 决定）：插件只读 3 组 55 键里的当前键。
> 服务器侧仍保留 `enable` 布尔入口，因为 Zed 扩展是把 `lsp.bdl-lsp.settings` 原样透传的，
> 其文档用的是 `enable`；是否也统一成 `mode` 待你决定。

| # | 事项 | 验收 |
|---|---|---|
| ✅ T1 | 设置重构：`package.json` 改成 3 组；新增/删除键；`bdl.link.mode`/`bdl.schema.mode` 三态；build 6 键拆成 `enable`+`command`；**不留旧键兼容**（未发布） | 设置面板 3 组；键数/文档一致 |
| ✅ T2 | tiptop 新增远程执行：`tiptop exec`——读 deploy 配置 → `ssh` 在**生产根目录**执行命令（模板里的 `cd ${path}` 由此生效）→ stdout/stderr 流式回传 + 退出码；`-dry-run`/`-json`。**不自动上传**（用户自己决定先上传） | 本地无法测真机，需 Windows/生产服务器复测；单测覆盖配置解析、路径映射、缺配置报错 |
| ✅ T3 | 单文件上传：`tiptop upload -file <相对路径>`（当前文件 → `remoteRoot/<相对路径>`），rsync 主/scp 备（scp 前先 `mkdir -p`）；无整包、无 include/exclude/delete | 单文件落到正确远端路径；不传其它文件 |
| ✅ T4 | 插件：删除 `bdl.deploy`（整包）、`bdl.deploy.target`、`bdl.deployListTargets`；改名/保留「上传当前文件」「预演上传」；6 条编译/链接/预览命令改调 `tiptop exec`（**不再本地 spawn**，占位符仍在插件侧展开，输出仍进「Genero BDL 编译」） | 命令面板与工具栏只剩单文件上传 + 6 条远程命令；输出完整 |
| ✅ T5 | 旧值的处理：**全部删除、不做兼容**（未发布）；README/FEATURES 只写当前键 | 文档里不再出现旧键 |
| ✅ T6 | 测试：tiptop exec/upload 单测（dry-run、路径映射、缺配置）；插件 e2e（命令注册、3 组设置、门控、上传预演） | 全绿 |
| ✅ T7 | 文档：README（三档/设置/命令/FAQ）、三份 `FEATURES.md`、本文件、`OPEN-ITEMS.md` | 无死链、口径一致 |
| ✅ T8 | 图标化：`bdl.schema.filter` / `bdl.schema.refresh` / `bdl.schema.import` / `bdl.links.resync` / `bdl.link.updateFromDb` 加 `icon`；`bdl.build.4gl.compile`、`bdl.build.per.compile` 改 `$(play)`（具体 codicon 见 OPEN-ITEMS S-k） | 视图标题栏只显示图标；编译按钮是运行形状 |
| ✅ T9 | `${name}` 弹框规则改为**只有 4GL 链接弹**（D11）：`build.ts` 里 4gl.compile / per.preview / per.compile / per.form 的 `promptName` 置 false | 点编译/预览不再弹框；点 4GL 链接仍弹 |

**说明**：D5 与现有 W5 实现（本机执行）冲突，T2/T4 完成后 W5 的"本地执行"描述要一并改掉；「预演编译」仍是远程执行同一条命令（不写盘效果由脚本自身保证）。

---

## 0e. 字段说明来源：改用 TiTop 字典（DS.ZTA_FILE + DS.GAQ_FILE）（2026-10-26 待确认）

**现状（已核实）**：`tiptop schema sync` 的默认 SQL 是
`ALL_TAB_COLUMNS c LEFT JOIN ALL_COL_COMMENTS cc ...`（`internal/schemacli/sync.go` 的 `DefaultSchemaQuery`）——
说明列取的是 **Oracle 自己的备注（column comments）**。你们环境里 Oracle 备注基本不维护，所以只有少数列有说明。

**目标 SQL（用户 2026-10-26 提供）**：

```sql
select zta01 table_name,
       lower(column_name) column_name,
       gaq03 column_desc,
       data_type, data_length, char_length, data_precision, data_scale, nullable, default_length
  from ds.zta_file, user_tab_columns
  left join ds.gaq_file
    on column_name = upper(gaq01)
   and gaq02 = '2'
 where zta02 = 'ds'
   and table_name = upper(zta01)
   -- 默认查询到此结束；分批时由工具追加：and zta01 in ('ima_file', …)
 order by table_name, column_name
```

**要点（对照现有实现）**

| # | 变化 | 影响 |
|---|---|---|
| a | 说明来源从 `ALL_COL_COMMENTS.comments` 换成 **`DS.GAQ_FILE.gaq03`**（`gaq02='2'`） | 列说明终于来自你们真正维护的字典档 |
| b | 表清单从 `all_tab_columns` 换成 **`DS.ZTA_FILE`（`zta02='ds'`）**，明细用 `user_tab_columns` | 需要连接账号**自己是表 owner**（`user_tab_columns` 才有行），且能读 `ds.zta_file`/`ds.gaq_file` |
| c | 列名按 SQL 的 **`lower(column_name)`** 存小写（现在是大写） | 悬停/补全显示的列名变成小写；不想要就去掉 `lower()` |
| d | CSV 列名与现有解析器**完全一致**（`table_name/column_name/column_desc/data_type/data_length/char_length/data_precision/data_scale/nullable/default_length`） | **解析器不用改**；只换默认查询 |
| e | 分批：表清单查 `SELECT DISTINCT zta01 FROM ds.zta_file WHERE zta02='ds'`，批次条件 `AND zta01 IN (...)`（用 ZTA_FILE 里的原名） | W7 的分批逻辑保留，只把 SQL/条件换掉 |
| f | `-query` 自定义 SQL 仍保留；`-owner` 在默认查询下不再需要（保留参数，仅自定义 SQL 用）。字典表不存在时按 T13 提示改用 CSV 导入 | 非 TiTop 环境用 `-query`；权限/表缺失有明确提示 |

**待确认**：`zta02='ds'` 是否固定；连接账号是否即表 owner；是否需要保留一套"通用（Oracle 注释）"预设；列名是否接受小写（见 OPEN-ITEMS S-g/S-h/S-i/S-j）。

**状态（2026-10-26，已实现）**：默认 SQL 已换成 TiTop 字典；生成的 SQL 与用户给的完全一致（多 `NVL(gaq03,'')` 与分批 `zta01 IN (...)`）；`go test ./...` 全绿；**待真库复跑**（用 schema 账号）。另：用户决定**中间文件不落盘**（维持现状、只保存结果），原 §0f 作废。

| # | 要做的事 | 验收 |
|---|---|---|
| ✅ T10 | 默认查询换成上面的 TiTop 字典 SQL（含分批与表清单） | 导入后 `ima_file` 等表的列说明来自 `ds.gaq_file`，覆盖率明显提高 |
| ✅ T11 | 保留 `-query` 覆盖；`-owner` 语义在文档里标注"仅自定义/通用 SQL" | 非 TiTop 环境不被破坏 |
| ✅ T12 | 文档：tiptop README/FEATURES + 插件 README/FEATURES 写清"说明来自 DS.GAQ_FILE"、需要的权限与账号 | 用户能自查权限；命令都在文档里 |
| ✅ T13 | 字典表缺失的友好报错：识别 ORA-00942 并提示「TiTop 字典表（DS.ZTA_FILE/DS.GAQ_FILE）不存在，请改用 CSV 导入」 | 非 TiTop 库/权限不足时不会只抛原始 ORA 码 |

---

## 0g. 命令清理（2026-10-26 待你圈定）

**当前操作清单**（命令面板 / 编辑器按钮 / 视图按钮 / 右键 / 后台任务）已整理成
[docs/COMMANDS.md](COMMANDS.md)：35 条命令（面板可见 33、隐藏 2）、编辑器按钮 7 个、
视图标题栏 10 个、视图项 5 个、输出通道 6 个、上下文键 11 个。

**待决策**：COMMANDS.md §7 的 C1–C10——

- C1 「更新链接资料」3 个同义入口（`syncCurrent` / `links.resync` / `link.updateFromDb`）→ 只留 1 个？
- C2 字段同步 4 个入口（`syncAll` / `syncSelected` / `syncFiltered` / `syncTable`）→ 合并成 2–3 个？
- C3 `bdl.links.references` 出现在 3 处 → 去重？
- C4 `bdl.forceParseCurrentFile` 面板始终可见 → 加 `when: bdl.parseSkipped`？
- C5 `showOutput` 与 `showServerInfo` 合并？
- C6 输出通道 6 → 2？
- C7 `migrateLinkDir` 面板隐藏（通知触发）→ 保持 + 文档写手动路径？
- C8 `copyColumn` / `openTable` 只留右键？
- C9 `moreRefs` 保持隐藏（内部）？
- C10 6 个 build `enable` 开关是否精简为"总开关 + 命令模板"？

你圈定后我改代码 + e2e + 文档，并更新 COMMANDS.md。

---

## 1. 发布闭环（按顺序）

| # | 事项 | 现状 | 要做的事 | 验收门槛 |
|---|---|---|---|---|
| **C0** | 真机验证（Windows） | 从未有人在真机上装过插件；CI 只覆盖"构建 + 单测 + 单测级二进制自检 + VSIX 内容自检"（bdl-lsp/tiptop 已 Linux+Windows 双绿） | 按**附录 A**（71 项）逐条勾选，并按**附录 E**复测 W1–W6：装包 → 内置二进制 → 语言服务 UI → ⭐路径/迁移/大文件 → 链接资料命令 → 数据库字段（视图/悬停/多选/直连库同步/进度）→ 部署（scp 回退）。命令默认在 PowerShell 跑，详见附录 A | 71 项全绿；失败项保持未勾、把现象写进附录 A「记录」并在 §9 汇总登记（或开 issue） |
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
| **D1** | `tiptop schema sync -source golang`（直连 Oracle 采集表字段） | 沙箱没有 Oracle；只验证了 SQL 生成、`-source file` 全链路、密码来源与参数校验的单元测试 | 真库里跑一次：`export BDL_ORA_PASSWORD=...; tiptop schema sync -root . -host … -service … -user …`（应用 schema 与账号不同时加 `-owner`）。核对：表数/列数与 DBA 导出一致、中文说明来自 `ALL_COL_COMMENTS`、`nullable` 与 `default_length` 映射正确；随后在 VSCode 里点 `数据库字段：从数据库同步` 看进度与结果（附录 A 的 5.1d.10） |
| **D2** | `tiptop link sync -source golang`（直连 Oracle 采集链接资料） | 同上（这条早就在，但同样没在真库跑过） | `tiptop link sync -root . -host … -service … -user …`，与"导出 CSV 再 `link import`"的结果对比（链数/文件数应一致）。CLI 参数与密码来源见 `bdl-lsp/docs/FEATURES.md` 与附录 A 的 3.4 节 |

### 2b. 其它需要真实环境的验证缺口

| # | 事项 | 现状 | 要做什么 |
|---|---|---|---|
| **B3** | 真实 Genero 服务器 | 无本机 `fglcomp`/`fglform`，远程编译整链路没实跑过 | `ssh` 通、`fglcomp -M` 可用；单文件部署 + 远程编译实跑一次（配置合成与部署实跑见 [`README.md`](../README.md) 附录 A） |
| **B4** | Zed dev extension 手工加载 | 无图形界面 | `zed: install dev extension` 能加载、LSP 起来、大纲层级正确（与 §3.5 的 Zed 追平一起做） |

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
| **S1** | 语言服务器异常退出兜底 | `显示输出` 里对**非 0 退出码**没有明确日志、不自动重启、不通知用户 | 插件侧：异常退出时写明确日志 + **自动重启一次** + 通知用户（配合 P0-1 已修好的崩溃） | 手工 kill 服务器后能看到日志与通知，并自动重启一次；日志进「Genero BDL: 显示输出」 |
| **S2** | `parseMu` 同类异步路径审计 | 只有链接预热回调这一条"从外部改文档树"的路径已纳入纪律；结论只在文档里 | 把审计结论写进代码注释（`parseMu` 的说明）：后续新增任何"后台 → 文档树"的路径都必须走 `requestRediagnose()` 一类入口（`internal/server`） | 注释落地；新增异步路径有 lock 纪律单测（参考 `internal/server/lock_test.go`） |
| **S3** | 工作区索引是否跳过超大文件 | 工作区索引现在解析一切，包括 `bdl.limits.*` 已排除诊断的文件 | 评估让索引跳过超大文件（性能优化，**不是**崩溃原因） | 大项目索引耗时下降且跳转/符号搜索不明显变差 |
| **F3** | 扩展与 LSP/tiptop 版本错配的回退策略 | 三个二进制版本独立递增，没有兼容矩阵 | 定义兼容矩阵与错配时的回退/提示策略（`BUILD-INFO.json` 已有 `target`，可扩展记录所需版本） | 文档 + `BUILD-INFO.json` 校验；错配时给出可操作的提示 |
| **F2** | ABI 15 ↔ Zed tree-sitter 运行时兼容 | 未在 Zed 实机验证 | 与 §3.5 的 Z-A6 一起在 Zed 真机上确认（必要时固定 tree-sitter 运行时要求） | Zed 真机能加载语法/高亮，不报 ABI 错 |
| **F4** | Windows 无 rsync → scp 回退 | 回退是显式打印的（设计如此），但稳定性/性能未实测 | 用大文件/多文件在真机上实测 scp 回退（附录 A 5.2.1），有问题再评估 | 回退日志可见、传输成功；把结论记进本文件 |
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
| Z-A1 | 文档纠错（9 条） | `bdl-lsp link/deploy` → `tiptop link/deploy`（这两个子命令 0.3.2 已移除）；删 `link.maxAgeDays` 与整块 `link.sync.*`；`link.dataDir` 默认 `.project`；`link.enable`/`schema.enable` 默认 **false**；诊断码表同步 14 个码；补 `prod.*` 说明；修「Zed 不支持任意命令」「不消费语义 token」两处错误结论；版本号 0.3.0→0.3.13 | `zed-extension/README.md` + 本仓库 `README.md`；全文 grep 无过期命令名 |
| Z-A2 | **补轻量档默认**（真实行为差异） | VSCode 客户端在 `client.ts` 显式下发 `link/schema.enable=false`；Zed 侧原样透传，服务端兜底返回 `true` → Zed 用户开箱即用时链接资料与 schema **是开着的**。修法：在 `language_server_workspace_configuration` 返回前把缺失的三开关补成 `false` | Zed 开箱即轻量档；与服务端兜底逻辑一致（兜底仍"开"，是无客户端设置时的安全兜底） |
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
3. **已完成只留一行**：被移除的条目最多在附录 C 加一行汇总。
4. **不写死链**：引用文档时只指向仍然存在的文件（本仓库 `docs/FEATURES.md`、`README.md`、`docs/OPEN-ITEMS.md`；`bdl-lsp/docs/DIAGNOSTICS.md`、`bdl-lsp/docs/FEATURES.md`、`tiptop/docs/FEATURES.md`、`zed-extension/docs/PLAN.md`）。历史归档类内容要么内联，要么进 `docs/OPEN-ITEMS.md`。
5. **待拍板项**：需要用户决定的（如 §3.1 P0-2b、§3.6 N1）留在本文件并显式标注"待确认"，把证据与口径写进 `docs/OPEN-ITEMS.md`。
6. **Windows 清单**：附录 A 的 71 项**整份搬入、不再单独维护**；勾选状态与「记录」直接写在本文件里（失败项也要如实保留未勾 + 记录现象）。

---

## 附录 A：Windows 实机验收清单（71 项，全文）

> 本附录由 bdl-lsp 仓库的 Windows 实机验收清单**原样搬入**（分节与 71 个勾选框完整保留），
> 作为 §1 的 **C0** 执行清单；勾选状态与记录直接写在这里。

> 用途：本文件 §1 的 **C0（Windows 实机验收）执行清单**（71 项，从 bdl-lsp 原样搬入）。CI 自 2026-10-23 起 Linux + Windows 双绿，
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

### 5. 链接资料与部署 **[需服务器]**

> 需要：真实 SSH 可达的 Genero 机器（`fglcomp`/`fglform` 可用）。没有就跳过并标注"未测"。

### 5.1 准备部署配置

**不用手写**：打开「部署」总开关（默认关），并在「生产环境」一组填主机 / 端口 /
账号 / 远程根 —— 插件会在部署前把它合成为 `$ws\.project\deploy.json`（带 `createdBy` 标记）。
手写仍然支持（`tiptop deploy -config <文件>`）。

- [ ] 6.0 填一半（例如只填主机）时执行部署：弹出的提示要**说清缺哪一项**
      （"部署需要先配置：… remoteRoot"），而不是含糊失败
- [ ] 6.0b 合成出来的 `$ws\.project\deploy.json` 里 `createdBy` 是 `vscode-bdl <版本>`；
      把该文件手改一下（删掉 `createdBy`）再部署一次 → 原文件被备份成 `deploy.json.bak`

- [ ] 5.1.1 `deploy -list` 列出目标
  ```powershell
  & "$ext\bin\tiptop.exe" deploy -list -workspace "$ws"
  ```
  - 记录：____
- [ ] 5.1.2 `deploy -dry-run` 打印"要传什么、要编译什么"，且**不上传**
  - 记录：____

### 5.1b ⭐ link 局部同步（`-modules` / `-files`）

> **前置**：`bdl.link.enable` 现在**默认关**（轻量档）。先在设置界面
> 「链接资料」一组里把总开关打开，否则界面里看不到链接视图/命令。

> 只重算受影响作业的链，其余链保留——改一两个程序不用整份重跑（全量 10–20 秒）。

```powershell
# 先看"会影响几个作业"（不写盘）
& "$ext\bin\tiptop.exe" link import -csv .project\gal_file.csv -root "$ws" -files topcust/aap/4gl/globals_main.4gl -dry-run
# 按模组更新
& "$ext\bin\tiptop.exe" link sync -root "$ws" -modules lib,sub,qry -dry-run
```

- [ ] 5.1b.1 `-dry-run` 输出里有 **"受影响作业 N 个（程序名…）"**，且没有写盘
- [ ] 5.1b.2 去掉 `-dry-run` 执行后：`link status -root "$ws"` 出现 **"局部更新 … 作业 N 个 / 重算链 M 条"**，
      且**其他作业的链仍在**（对比更新前后 `links.jsonl` 的程序列表）
  - 记录：____

### 5.1c ⭐ 链接资料命令（在 VSCode 里，不用开终端）

> **前置**：`bdl.link.enable` **默认关**，先打开它，命令面板里才会出现
> `Genero BDL: 链接资料：…` 系列命令。

命令面板 `Ctrl+Shift+P` → 输入 `Genero BDL: 链接资料`：

- [ ] 5.1c.1 设置里有 **「Genero BDL: 生产环境」** 一节（主机/端口/服务名/只读账号），
      描述里写明"只写 Workspace、`settings.json` 不要进 git、密码用 `BDL_ORA_PASSWORD`
      或 `.project/secrets.json`"
- [ ] 5.1c.2 **没配数据库**时执行 `链接资料：全量更新`：弹出明确提示，带
      「打开设置」「改用 CSV 导入」两个按钮（不是静默失败、不是看不懂的报错）
- [ ] 5.1c.3 `链接资料：从 CSV 导入`：选一个 CSV → 提示已复制到 `.project/gal_file.csv`
      → 选"全量导入" → 输出通道能看到 tiptop 的进度与统计
- [ ] 5.1c.4 打开一个公共 `.4gl`（被多个作业引用）执行 `链接资料：更新当前文件`：
      预演对话框里显示 **"将更新 N 个作业：…"**；取消不会写盘；确认后其他作业的链仍在
      （用 `链接资料：查看状态` 看"局部更新"行）
- [ ] 5.1c.5 链接资料视图里「反查引用程序」那一行有 **重新同步** 按钮，点它等同 5.1c.4
- [ ] 5.1c.6 关掉 `bdl.link.enable`：命令面板里这些命令消失，视图按钮也消失
  - 记录：____

### 5.1d ⭐ 数据库字段资料（P2-1）

> **前置**：`bdl.schema.enable` **默认关**，先打开它，侧边栏才会出现「数据库字段」视图。

```powershell
# 从 Oracle 导出 CSV 生成资料（也可以走命令面板「数据库字段：从 CSV 导入」）
& "$ext\bin\tiptop.exe" schema import -csv .\gal_schema.csv -root "$ws"
& "$ext\bin\tiptop.exe" schema status -root "$ws"
```

- [ ] 5.1d.1 侧边栏出现 **「数据库字段」** 视图，第一条显示"共 N 张表"（点 tooltip 能看到资料目录/导入时间/来源）
- [ ] 5.1d.2 顶部 **正则查询框**：输入 `^IMA_` 只剩匹配的表（总数仍显示全部）；输入 `(ima`（半截正则）→ 显示**全部**并有一行"正则无效"
- [ ] 5.1d.3 展开一张表 → 列出现（显示 `列名 · 类型(长度) · 中文说明`）；**第一次展开才加载**（表多时不卡）
- [ ] 5.1d.4 在 `.4gl` 里写 `DEFINE r RECORD LIKE ima_file.*`，悬停 `r`：列出该表字段（超过 20 行显示"其余 N 个字段…"）
- [ ] 5.1d.5 写 `DEFINE f LIKE ima_file.ima01`，悬停 `f`：多出一段 `字段资料：ima_file.ima01 · VARCHAR2(40) · 料件编号`
- [ ] 5.1d.6 表上右键 →「复制列定义」得到 `LIKE ima_file.ima01`；「打开表资料文件」打开 `.project\.schema\tables\IMA_FILE.json`
- [ ] 5.1d.7 关掉 `bdl.schema.enable`：视图与命令面板里的「数据库字段：…」命令都消失
- [ ] 5.1d.8 **多选批量**：勾选两张表（复选框）→ 标题栏出现"已勾选 2 张"→ 命令「同步已选中的表」
      弹预演确认并只处理这两张（输出里 `表 2（…保留 N）`）；「清除勾选」后恢复正常
- [ ] 5.1d.9 **筛选批量**：正则过滤 （如 `^IMA_`）后执行「同步当前筛选结果」：
      只同步列表里的表（表多时自动走 `-tables-file`）
- [ ] 5.1d.10 **直连数据库**：配好「生产环境」的 Oracle 连接后执行「从数据库同步」：
      进度通知依次显示 `采集：连接 …`、`采集：已收到 N 行`、`解析表 x（i/n）`、`写入完成`；
      点**取消**能中断（状态栏提示"已取消"）
- [ ] 5.1d.11 **link 与 schema 进度一致**：执行「链接资料：全量更新」或「更新当前文件」，
      进度通知显示 `采集 / 扫描源码 i/n / 成链 i/n / 写入完成`（与大表字段同步同一套文案）
  - 记录：____

### 5.2 真实单文件部署 + scp 回退

- [ ] 5.2.1 Windows 无 rsync → 输出里出现**显式回退**：
  `↪ 回退到 scp（请在输出中确认，这不是静默降级）`
  - 记录（贴出那几行）：____
- [ ] 5.2.2 单文件部署成功：
  ```powershell
  & "$ext\bin\tiptop.exe" deploy -workspace "$ws" "$ws\topcust\aap\4gl\globals_main.4gl"
  ```
  - 记录：____
- [ ] 5.2.3 故意把源码改坏（删一个分号/写错标识符）再部署 → 远程 `fglcomp` 的错误**按行号映射回本地文件**，出现在输出里
  - 记录（贴出错误行与其对应的本地行号）：____
- [ ] 5.2.4 通过 VSCode 命令 `Genero BDL: 部署当前文件并编译` 走一遍（编辑器内路径，与命令行同一配置）
  - 记录：____
- [ ] 5.2.5 `Genero BDL: 部署预演（不上传）` 与 `Genero BDL: 列出部署目标` 两个命令可用
  - 记录：____

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
| 5.1b | ⭐ link 局部同步（CLI） | ⬜ | |
| 5.1c | ⭐ 链接资料命令（VSCode 内） | ⬜ | |
| 5.1d | ⭐ 数据库字段资料（P2-1：视图/悬停/请求） | ⬜ | |
| 5.1.1–5.2.5 | 部署（需服务器） | ⬜ | |
| 6.1 | e2e 45/45 | ⬜ | |

**失败项汇总**（每条写：编号 / 期望 / 实际 / 日志或截图路径）：

1.
2.

**回归信息带回 Linux 侧**（贴回本文件 §1 的 C0 验收记录，或开 issue 时用）：

- 被测版本：`bdl-lsp 0.3.13` / `tiptop 0.1.8` / `4gl-full 0.6.2`
- 机器与架构：
- 失败项与最小复现：
- 语言服务器输出（`Genero BDL: 显示输出` 整段）：
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

## 附录 C：已完成（一行汇总，不再追踪）

- **VSCode 插件改版**：P0-1（链接预热回调崩溃，复现脚本 8/8 → 20/20 OK）、P0-2（表单侧名字误报 T5，全语料 24284 → 19580，−19.4%）、P0-3（超限/超时提示 + 强制解析按钮）、P1-1（6 条链接资料命令入口 + 影响面预演确认）、P1-2（`.link` → `.project` + 读兼容 + 迁移命令与提示）、P1-3（`-modules`/`-files` 局部同步与合并）、P1-4（默认轻量档：三开关默认 false + 命令门控 + 不写工作区）、P1-5（设置五组 + `prod.deploy.*` + 插件合成 `.project/deploy.json`）、P1-6（去掉 7 天过期与后台自动同步死代码）、P2-1（数据库字段资料全链路：CSV 导入 / 直连 Oracle / 视图 / 正则 / 悬停 / 补全 / 多选 / 进度，真实数据 2648 表 2.4 s）、P1-7（首页三档引导；用户引导已合并为单一 `README.md`，去重收尾完成）。
- **分离收尾残留（§A A1–A8）**：命令名与归属更正、`fetch-gal-file.sh` 迁到 tiptop、`link.sync` 配置清理、Zed/编辑器文档命令名更新、tiptop 自建 CI（Linux 全绿）。
- **Windows CI 修复**：B8（服务端手写 path→URI 在 Windows 产出非法 `file://C:/…`，链接诊断挂不上文件）、B9（Windows `go test`、`build.ps1` grammar 检查、CRLF + `gofmt`）、F7（Windows `secrets.json` 权限误判）、F8 —— bdl-lsp 与 tiptop **Linux + Windows 双绿**。
- **文档清理**：旧 `TODO.md`、`PLAN*.md`、`DEPLOY-ZED.md` 等阶段记录已删除，有效决策抢救保留。
- **改代码前先看的历史教训**：手写 path→URI 的坑（用 `internal/server` 现成工具，不要 `"file://"+路径`）；CRLF 与 `gofmt`；`parseMu` 锁纪律（后台 → 文档树必须走 `requestRediagnose()` 一类入口）；每个 query pattern 的字段顺序必须与 grammar 一致（写错会"Impossible pattern"**静默禁用整条 query**）；改 `scanner.c` 后必须 `go build -a ./internal/parser`。细节与证据见 [`FEATURES.md`](FEATURES.md) 与代码注释。


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
- **装错平台包**：扩展读 `BUILD-INFO.json` 的 `target`，与当前平台不符时跳过内置二进制并回退外部路径。
- **覆盖内置二进制**：用户可用 `bdl.server.path` / `BDL_LSP_PATH` / 工作区 `.bdl-lsp/bin/`，见 [`README.md`](../README.md) 安装一节。

---

## 附录 E：W1–W6 实现摘要与真机复测要点

> 代码层已完成并在 Linux 验证（三仓库测试 + e2e 49/49）。**C0 Windows 实机验收时逐条复测。**

| # | 问题 | 实现（2026-10-26） | 真机复测要点 |
|---|---|---|---|
| **W1** | 强制解析仍超时、大纲空 | `bdl/forceParse` 改后台执行且**不限时**（`Timeout 0`），完成发 `bdl/parseDone`（含耗时/字节/版本）；提示键名修回 `bdl.limits.parseTimeoutMs`；客户端收到回执后自动刷新大纲并显示耗时 | 打开 `saapt310`：点标题栏「强制解析」→ 状态栏出现「强制解析完成：N ms」，大纲**出现** MAIN/函数；设备慢时耗时合理（几十秒内） |
| **W2** | 预演导致全量跑两遍（约 5 分钟） | link/schema 不再 `-dry-run` 预演，直接执行（全量前仅一次不重新扫描的确认）；耗时文案统一「通常几分钟，也可能更长，请在 Output 查看进度」；只有编译保留预演 | 全量 link 只跑一遍（对比改前总耗时明显下降）；Output 有阶段进度；提示里不再写秒数 |
| **W6** | `.project` 目录零散 | 新布局 `.project/{link,schema,deploy}/`，根只留 `secrets.json`；旧布局只读兼容；命令「迁移项目资料目录」一键搬 | 查看 `.project` 下目录结构；旧工程能读、出现迁移提示；迁移后 LSP/视图正常 |
| **W3** | 链接视图缺"从数据库更新" | 视图标题栏新增 `bdl.link.updateFromDb`，门控 `bdl.db.configured && bdl.link.hasData` | 未配库/无资料时**不显示**；配库且全量过后显示，点击能更新当前文件 |
| **W4** | 字段视图局部更新未门控 | 局部/批量同步需 `bdl.db.configured && bdl.schema.hasData`；全量「从数据库同步」需配库；CSV 导入/刷新/过滤不受限 | 未配库或无资料时，右键「同步选中的表」与批量按钮**不出现** |
| **W5** | 缺本地编译/链接 | 命令面板 + 右上角按钮：4GL 预演编译/编译/链接、Form 预演编译/编译/预览画面；六键模板（`bdl.build.*`）可改；占位符 `${path}/${fullpath}/${name}/${fullname}`（分隔符恒 `/`）；无 MAIN 时「链接」禁用且本地报错；输出原样进「Genero BDL 编译」 | 用你们的 `r.c2`/`r.l2`/`r.gf`/`fglform`/`gsform` 各跑一遍；确认 `${path}`/`${fullpath}` 指向正确目录、Output 有完整 stdout/stderr；无 MAIN 的文件「链接」按钮为灰 |
