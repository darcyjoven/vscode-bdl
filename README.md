# BDL for VSCode

Genero BDL（`.4gl` / `.global`）与 Form（`.per`）的 VSCode 扩展。

> 状态：仓库已初始化，功能开发按 `bdl-lsp/docs/PLAN.md` 推进。
> 远程仓库：`git@github.com:darcyjoven/vscode-bdl.git`（本地目录仍叫 `vscode-extension/`）。
> 本仓库只保留 VSCode 交付物；计划、测试脚本、过程记录统一在 `bdl-lsp` 仓库。
> v1 验证平台：**Linux + Windows**；macOS 后续兼容。
> Genero 以 **2.50** 为基线；5.0 暂不排期。

## 计划中的能力

- 语法高亮（TextMate）与语义高亮
- 函数/变量/表单字段跳转、引用、悬停、符号
- 4GL 与 `.per` 格式化
- 4GL 字段是否存在于 `.per` 的诊断
- 上传服务器并调用 `fglform` / `fglcomp` 编译
- LSP 二进制自动查找/下载/校验

## LSP 二进制来源

目标体验是“无感自动下载”（从 `bdl-lsp` Release 按平台/版本下载、校验、缓存），但**发布与自动下载暂不排期**。

当前开发阶段使用本地构建的 `bdl-lsp`，按以下顺序查找：

1. 设置 `bdl.server.path`
2. 环境变量 `BDL_LSP_PATH`
3. 工作区 `.bdl-lsp/bin/bdl-lsp`
4. 系统 `PATH` 中的 `bdl-lsp`

后续排期发布后，再启用自动下载、SHA256 校验、缓存与回退。

## 本地开发（待实现后补全）

```bash
pnpm install
pnpm build
pnpm test
pnpm package
```

## 许可

MIT，见 [LICENSE](LICENSE)。
