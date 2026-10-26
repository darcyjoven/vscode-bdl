# @PROJECT_NAME@（生产代码镜像）

> 本仓库由 `scripts/init-project/init-project.sh` 从**生产服务器**初始化生成。
> 请把这里当成"生产代码的镜像"：**不要手改目录结构**，要改内容请在本地改完再走上传/部署流程。

| 项 | 值 |
|---|---|
| 来源服务器 | `@SOURCE_HOST@` |
| 远根目录 | `@REMOTE_ROOT@` |
| 取数范围 | `@SCOPE@` |
| 源文件数 | @FILE_COUNT@ |
| 初始化时间 | @INIT_AT@ |
| 编码 | 原始 @SOURCE_ENCODING@ → 已转 UTF-8（本来就是 UTF-8 的跳过） |
| 行尾 | LF（`.gitattributes` 固定） |

## 重新初始化 / 更新（拉取生产最新代码）

```bash
# 在 vscode-bdl 仓库里执行（或把 scripts/init-project/ 拷到任意位置）
scripts/init-project/init-project.sh \
  --target '@SOURCE_HOST@' \
  --remote-root '@REMOTE_ROOT@' \
  --dest "$(git rev-parse --show-toplevel)" \
  --update
```

> 更新会用生产端的文件覆盖本地对应文件；生产端已删除的文件在本地也会被删（会先确认一次）。
> 本地独有的、不在取数范围内的文件不受影响。

## 在编辑器里用

1. 复制 `.vscode/settings.example.json` 为 `.vscode/settings.json`（已被 `.gitignore` 忽略），
   按你们环境填 Oracle / 生产服务器 / 生产根；
2. `tiptop link sync` / `tiptop schema sync` 采集资料（写入 `.project/`，不进库）；
3. 之后用编辑器的编译/链接/预览按钮与上传命令。

