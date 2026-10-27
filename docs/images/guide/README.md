# 插件首页引导手册的配图素材

插件首页（仓库根 `README.md`）里的 `📷` 占位块对应下表中的文件。
拍好后放到本目录，在 `README.md` 里把占位块替换成
`![说明](docs/images/guide/文件名)` 即可（`README.md` 在仓库根，所以路径带 `docs/`）。

| 文件 | 类型 | 拍什么 |
|---|---|---|
| `01-three-modes.png` | 截图/示意图 | 三档用法总览（轻量 / 本地文件 / 全功能），可直接拿 README 里那张表改图 |
| `02-install.png` | 截图 | 扩展面板里已安装的 `4gl (4GL)`（显示版本与"已安装"） |
| `03-jump-hover.gif` | 录屏 | 函数名 `F12` 跳定义 + 悬停变量看来源 |
| `04-outline.png` | 截图 | 大纲面板展开一个 `.4gl`（MAIN / FUNCTION / DEFINE 层级） |
| `05-export-csv.png` | 截图 | 生产端导出的两份 CSV（GAL_FILE 与表字段）文件名列表 |
| `06-import-csv.png` | 截图 | "链接资料：从 CSV 导入"的预演确认框 + 一条进度通知 |
| `07-schema-view.png` | 截图 | 侧边栏「数据库字段」视图 + 悬停 `LIKE t.col` 的中文说明 |
| `08-oracle-settings.png` | 截图 | 设置页「生产环境」四项（**主机/账号打码**）+ 那句 git 提醒 |
| `09-sync-progress.png` | 截图 | "从数据库同步"的进度通知（`解析表 xxx（i/N）`） |
| `10-schema-multi-select.png` | 截图 | 勾选两张表（复选框）+ 标题栏"已勾选 2 张"+ 批量同步确认框 |
| `11-deploy.png` | 截图 | 部署预演输出 + 部署结果摘要 |

素材要求（与 `docs/images/vscode/README.md` 一致）：

- 截图宽度 1200–1600 px，深浅主题都可以，但**同一份文档内保持一致**；
- 录屏 10 秒以内，只保留关键动作，转 GIF 或 MP4；
- **不要包含真实主机名、账号、密码、客户代码**；主机与账号务必打码；
- 建议顺带把 `docs/images/vscode/` 里那 10 张（详细手册用）一起补齐。
