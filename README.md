# BDL for VSCode

Genero BDL（`.4gl` / `.global`）与 Form（`.per`）的 VSCode 扩展。

> 状态：仓库已初始化，功能开发按 `bdl-lsp/docs/PLAN.md` 推进。
> 远程仓库：`git@github.com:darcyjoven/vscode-bdl.git`（本地目录仍叫 `vscode-extension/`）。
> 本仓库只保留 VSCode 交付物；计划、测试脚本、过程记录统一在 `bdl-lsp` 仓库。
> v1 验证平台：**Linux + Windows**；macOS 后续兼容。
> 目标 Genero **2.50–5.0**（当前 grammar 以 2.50 为基线）。

## 计划中的能力

- 语法高亮（TextMate）与语义高亮
- 函数/变量/表单字段跳转、引用、悬停、符号
- 4GL 与 `.per` 格式化
- 4GL 字段是否存在于 `.per` 的诊断
- 上传服务器并调用 `fglform` / `fglcomp` 编译
- LSP 二进制自动查找/下载/校验

## LSP 二进制来源与“无感”安装

LSP 二进制由 `bdl-lsp` 仓库自己的 GitHub Release 发布（tag 形如 `lsp-vX.Y.Z`）。扩展激活时：

1. 根据平台/架构与目标版本，检查本地缓存；
2. 缺失或过旧时后台自动下载、SHA256 校验、设置可执行权限；
3. 启动 LSP，并用 `--version` 校验；
4. 失败时保留上一个可用版本，给出可操作错误。

正常用户不需要手工安装。以下覆盖方式仅用于离线/企业内网：

1. 设置 `bdl.server.path`
2. 环境变量 `BDL_LSP_PATH`
3. 工作区 `.bdl-lsp/bin/bdl-lsp`
4. 扩展缓存目录（下载）
5. 离线包（后续）

## 本地开发（待实现后补全）

```bash
pnpm install
pnpm build
pnpm test
pnpm package
```

## 许可

MIT，见 [LICENSE](LICENSE)。
