# 发布与打包

本文给维护者：如何构建“安装即用”的平台 VSIX。日常使用看
[USER-GUIDE.md](USER-GUIDE.md)。

## 1. 平台矩阵

`bdl-lsp` 是 CGO + tree-sitter 的原生二进制，不能一个包跨系统，所以按目标
平台分别打包。VSCode 的 `--target` 会写进 VSIX 清单，市场和安装器据此只给
用户匹配的包。

| 目标 | Runner | Go 目标 | 内置二进制 | 说明 |
|---|---|---|---|---|
| `win32-x64` | `windows-latest` | `windows/amd64` | `bin/bdl-lsp.exe` | 优先静态链接，失败时退回动态链接并打包 MinGW 运行库 |
| `linux-x64` | `ubuntu-22.04` | `linux/amd64` | `bin/bdl-lsp` | glibc 2.35 基线，兼容 Ubuntu 22.04+ / Debian 12+ |
| `darwin-x64` | `macos-15-intel` | `darwin/amd64` | `bin/bdl-lsp` | Intel Mac |
| `darwin-arm64` | `macos-15` | `darwin/arm64` | `bin/bdl-lsp` | Apple Silicon |

构建定义在 [`.github/workflows/bundle-vsix.yml`](../.github/workflows/bundle-vsix.yml)。

## 2. 触发构建

两种方式：

1. GitHub Actions 页面 → `bundle-vsix` → **Run workflow**；
   可填 `bdl_lsp_ref`（默认 `main`，也可填 tag/SHA）决定用哪份语言服务器源码。
2. push `v*` tag。tag 构建使用 `bdl-lsp` 的 `main`。

每个矩阵 job 产出一个 artifact：`vsix-<target>`，里面是
`4gl-full-<version>-<target>.vsix`。例如：

```text
vsix-win32-x64
vsix-linux-x64
vsix-darwin-x64
vsix-darwin-arm64
```

## 3. 本地构建

需要与目标平台一致的二进制。先在 `bdl-lsp` 构建：

```bash
cd ../bdl-lsp
source scripts/dev-env.sh
make build          # Linux/macOS；Windows 用 scripts\build.ps1
```

然后在扩展仓库：

```bash
cd ../vscode-extension
npm ci --include=dev
npm run package      # 平台包：内置当前平台的 bdl-lsp
npm run package:dev  # 开发包：不含二进制，仅 CI/本地冒烟
```

`package` 产出 `dist-vsix/4gl-full-<version>-<platform>.vsix`。
可用环境变量覆盖来源与目标：

```bash
BDL_VSCODE_TARGET=linux-x64 \
BDL_LSP_BINARY=/path/to/bdl-lsp \
BDL_LSP_VERSION=0.3.0 \
node scripts/package-vsix.mjs
```

打包脚本会：

- 把二进制复制到扩展的 `bin/`；
- 写 `bin/BUILD-INFO.json`（目标、语言服务器版本、构建时间）；
- 当前平台与目标一致时，先执行 `bdl-lsp version` 确认能跑；
- Windows 目标会同时复制同目录下的 `*.dll`。

## 4. 校验产物

```bash
unzip -l dist-vsix/4gl-full-0.4.0-linux-x64.vsix
rm -rf /tmp/bdl-vsix && unzip -q dist-vsix/*.vsix -d /tmp/bdl-vsix
/tmp/bdl-vsix/extension/bin/bdl-lsp version
```

必须包含：

- `extension/bin/bdl-lsp`（Windows 为 `bdl-lsp.exe`）
- `extension/bin/BUILD-INFO.json`
- `extension/dist/extension.js`
- `extension/syntaxes/*.tmLanguage.json`
- `extension/language-configuration/*.json`

不能包含 `extension/src/`、`extension/test/`、`extension/.github/`、
`extension/node_modules/`、`extension/scripts/`。

## 5. 发布到市场

四个包分别发布，`--target` 必须与包一致：

```bash
npx vsce publish --target win32-x64 --packagePath dist-vsix/4gl-full-0.4.0-win32-x64.vsix
npx vsce publish --target linux-x64 --packagePath dist-vsix/4gl-full-0.4.0-linux-x64.vsix
npx vsce publish --target darwin-x64 --packagePath dist-vsix/4gl-full-0.4.0-darwin-x64.vsix
npx vsce publish --target darwin-arm64 --packagePath dist-vsix/4gl-full-0.4.0-darwin-arm64.vsix
```

平台包不加 `--target` 直接安装会报平台不匹配。

## 6. 注意事项

- **版本要对齐**：扩展版本在 `package.json`；内置的语言服务器版本由
  `bdl-lsp/main.go` 注入，`BUILD-INFO.json` 会记录两者。
- **不要提交二进制**：`bin/` 与 `dist-vsix/` 已加入 `.gitignore`，只作为
  打包中间产物存在。
- **Windows 运行库**：先尝试 `-static`；失败时动态构建并复制
  `libwinpthread-1.dll`、`libgcc_s_seh-1.dll` 到 `bin/`，扩展启动时会随
  `bdl-lsp.exe` 一起从同目录加载。
- **macOS runner 标签**：`macos-13` / `macos-14` 已下线或已弃用，
  现在用 `macos-15-intel`（Intel）与 `macos-15`（Apple Silicon）。
  必须选对包；`darwin-arm64` 不能跑在 Intel Mac 上。
- **装错平台包**：扩展会读取 `BUILD-INFO.json` 的 `target`，与当前平台不符时
  跳过内置二进制并回退到外部路径，避免 `exec format error`。
- **覆盖内置二进制**：用户可用 `bdl.server.path` / `BDL_LSP_PATH` /
  工作区 `.bdl-lsp/bin/`，行为见 USER-GUIDE 第 1.1 节。
