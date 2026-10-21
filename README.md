# BDL for VSCode

Genero BDL（`.4gl` / `.global`）与 Form（`.per`）的 VSCode 扩展。

> 状态：**v0.1.0 可用**（高亮、跳转、引用、大纲、悬停、诊断、配置）。
> 远程仓库：`git@github.com:darcyjoven/vscode-bdl.git`（本地目录仍叫 `vscode-extension/`）。
> 本仓库只保留 VSCode 交付物；计划、测试脚本、过程记录统一在 `bdl-lsp` 仓库。
> v1 验证平台：**Linux + Windows**；macOS 后续兼容。
> Genero 以 **2.50** 为基线；5.0 暂不排期。

## 已实现能力

| 能力 | 说明 |
|---|---|
| 语法高亮 | TextMate 语法，覆盖 grammar 里全部 361（BDL）/ 76（`.per`）个关键字，含多词短语、注释、字符串、数字、预处理指令、函数名、字段访问 |
| 定义跳转 | `CALL foo` → `FUNCTION foo`；`rec.field` → 记录字段；局部/参数/全局按作用域解析 |
| 引用查找 | 词边界匹配，自动排除注释、字符串、预处理行 |
| 文档大纲 | MAIN / FUNCTION / REPORT / DEFINE / CONSTANT / TYPE / RECORD（含字段）/ SCREEN RECORD |
| 工作区符号 | 跨已打开文档搜索全局符号 |
| 悬停 | 显示种类、类型、签名、字段数；内置名显示 Genero 签名与出处 |
| 代码补全 | 同文件/跨文件符号、表单字段、关键字、内置符号（`fgl_*`/`ARG_VAL`/`ui`…） |
| 语法诊断 | 解析错误与缺失内容，级别可配，大文件与超时保护 |
| 配置热更新 | 改设置立即生效，无需重载窗口 |
| 语言配置 | 注释、括号、自动闭合、缩进规则 |

## 安装

```bash
code --install-extension 4gl-full-0.1.0.vsix
```

## LSP 二进制来源

目标体验是"无感自动下载"（从 `bdl-lsp` Release 按平台/版本下载、校验、缓存），但**发布与自动下载暂不排期**。

当前按以下顺序查找本地构建的 `bdl-lsp`：

1. 设置 `bdl.server.path`（可填可执行文件**或所在目录**，支持 `~/`）
2. 环境变量 `BDL_LSP_PATH`（同上）
3. 工作区 `.bdl-lsp/bin/bdl-lsp`
4. 系统 `PATH`

四级都找不到时不会静默失败：会弹出可操作的提示，列出已尝试的位置、四种解决办法，并提供「打开设置」按钮。

构建语言服务器：

```bash
cd ../bdl-lsp
source scripts/dev-env.sh
make build          # 产出 artifacts/bin/bdl-lsp
```

## 设置项

| 设置 | 默认 | 说明 |
|---|---|---|
| `bdl.server.path` | 空 | LSP 可执行文件或所在目录 |
| `bdl.server.logLevel` | `info` | 日志级别（error/warn/info/debug） |
| `bdl.trace.server` | `off` | LSP 消息追踪通道 |
| `bdl.generoVersion` | `2.50` | 目标 Genero 版本 |
| `bdl.syntaxDiagnostics` | `error` | 语法错误级别 |
| `bdl.missingDiagnostics` | `warning` | 缺失内容级别 |
| `bdl.limits.maxFileBytes` | 2097152 | 超过则不诊断 |
| `bdl.limits.maxFileLines` | 20000 | 超过则不诊断 |
| `bdl.limits.maxIssues` | 200 | 单文件诊断上限 |
| `bdl.limits.parseTimeoutMs` | 2000 | 单次解析超时 |
| `bdl.builtins.enable` | `true` | 内置符号表（`STATUS`/`SQLCA`/`fgl_*`…）。关掉 = 这些名字重新报"无法确定来源" |
| `bdl.builtins.paths` | `[]` | 额外的内置符号覆盖文件/目录（相对工作区根） |
| `bdl.builtins.disable` | `[]` | 本项目里不当内置的名字（大小写不敏感） |

改 `server.path` / `server.logLevel` / `generoVersion` 后需要重启语言服务器，扩展会主动询问。

### 内置符号表（P7-C）

Genero 自带的变量/函数/类名（`SQLCA`、`INT_FLAG`、`STATUS`、`ARG_VAL`、
`fgl_*`、`ui.*` 等）在静态分析里找不到定义，本功能提供一张符号表豁免它们，
并让它们出现在补全与悬停里。

表**可以随时更新，不需要重新安装扩展**：

```jsonc
// .bdl-lsp/builtins.json —— 放在项目根，自动加载（可提交进仓库）
{
  "schemaVersion": 1,
  "generoVersion": "2.50",
  "disable": ["SUM"],                       // 本项目里 SUM 是用户函数
  "symbols": [
    { "name": "MY_PROJECT_BUILTIN", "kind": "variable", "doc": "公司级内置变量" }
  ]
}
```

- 同名按**字段**合并（只改 `doc` 不必重写整条），`kind` 以新条目为准；
- `disable` 优先级最高，在所有文件加载完之后统一应用；
- 改完保存即可生效（约 2 秒内自动重载，不用重启窗口）；
- 想额外加载别的文件/目录，用 `bdl.builtins.paths`。

## 命令

| 命令 | 说明 |
|---|---|
| `Genero BDL: 重启语言服务器` | 重新查找并启动 LSP |
| `Genero BDL: 显示语言服务器信息` | 展示当前路径、来源、全部设置 |
| `Genero BDL: 显示输出` | 打开输出通道 |

## 本地开发

```bash
source ../bdl-lsp/scripts/dev-env.sh

npm install          # NODE_ENV=production 会跳过 devDeps，需 `NODE_ENV= npm install --include=dev`
npm run typecheck
npm run build
npm run package      # 生成 4gl-full-0.1.0.vsix

npm run grammars         # 从 grammar 源码重新生成 TextMate 语法
npm run grammars:check   # 校验语法为最新
npm run test:e2e         # 真实 VSCode 扩展宿主里的 14 个用例
```

完整 e2e（含构建 LSP、类型检查、打包）：

```bash
cd ../bdl-lsp
make e2e-vscode
```

### 无头环境下跑 e2e 的注意事项

本机沙箱无 root、无 X server、`/dev/shm` 不可写，`test/runTest.js` 已逐条处理：

| 约束 | 处理 |
|---|---|
| 无 X server | `--ozone-platform=headless` |
| `/dev/shm` 不可写 | `--disable-dev-shm-usage` |
| TMPDIR / XDG_RUNTIME_DIR 必须可写 | 固定在 `bdl-lsp/artifacts/e2e/`，runtime 目录 `chmod 700` |
| 测试入口必须位于扩展目录内 | `test/suite/index.js`（放 `/tmp` 会拿不到 `vscode` API） |
| VSCode 退出码不反映测试结果 | 以 JSON 报告文件判定成败 |
| 缺省日志级别下窗口提前退出 | 启动参数必须带 `--verbose` |
| 残留进程抢占单实例锁 | 启动前 `pkill -f <vscode 目录>` |

## 许可

MIT，见 [LICENSE](LICENSE)。