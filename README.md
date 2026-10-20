# BDL for VSCode

Genero BDL（`.4gl` / `.global`）与 Form（`.per`）的 VSCode 扩展。

> 状态：仓库已初始化，功能开发按 `bdl-lsp/docs/PLAN.md` 推进。
> 远程仓库：`git@github.com:darcyjoven/vscode-bdl.git`（本地目录仍叫 `vscode-extension/`）。
> 本仓库只保留 VSCode 交付物；计划、测试脚本、过程记录统一在本地 `bdl-lsp` 仓库。
> v1 验证平台：**Linux + Windows**；macOS 后续兼容。

## 计划中的能力

- 语法高亮（TextMate）与语义高亮
- 函数/变量/表单字段跳转、引用、悬停、符号
- 4GL 与 `.per` 格式化
- 4GL 字段是否存在于 `.per` 的诊断
- 上传服务器并调用 `fglform` / `fglcomp` 编译
- LSP 二进制自动查找/下载/校验

## LSP 二进制来源

`bdl-lsp` 源码只在本地管理，没有自己的远程仓库；计划把 Linux/Windows 的 LSP 二进制托管到
`vscode-bdl` 的 GitHub Release（tag 形如 `lsp-vX.Y.Z`），扩展优先从 Release 下载，并支持：

1. 设置 `bdl.server.path`
2. 环境变量 `BDL_LSP_PATH`
3. 工作区 `.bdl-lsp/bin/bdl-lsp`
4. 扩展缓存目录（下载）
5. 手动路径提示

> 该托管方案（Q9）待最终确认。

## 本地开发（待实现后补全）

```bash
pnpm install
pnpm build
pnpm test
pnpm package
```

## 许可

MIT，见 [LICENSE](LICENSE)。
