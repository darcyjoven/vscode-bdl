# BDL for VSCode

Genero BDL（`.4gl` / `.global`）与 Form（`.per`）的 VSCode 扩展。

> 状态：仓库已初始化，功能开发按 [`bdl-lsp/docs/PLAN.md`](https://github.com/darcyjoven/bdl-lsp/blob/main/docs/PLAN.md) 推进。
> 本仓库只保留 VSCode 交付物；计划、测试脚本、过程记录统一在 `bdl-lsp` 仓库。

## 计划中的能力

- 语法高亮（TextMate）与语义高亮
- 函数/变量/表单字段跳转、引用、悬停、符号
- 4GL 与 `.per` 格式化
- 4GL 字段是否存在于 `.per` 的诊断
- 上传服务器并调用 `fglform` / `fglcomp` 编译
- LSP 二进制自动查找/下载/校验

## 本地开发（待实现后补全）

```bash
pnpm install
pnpm build
pnpm test
pnpm package
```

## 许可

MIT，见 [LICENSE](LICENSE)。
