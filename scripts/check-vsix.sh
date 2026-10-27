#!/usr/bin/env bash
# check-vsix.sh —— VSIX 内容自检（CI 与本地同一份，避免魔法数字）
#
# 用法： bash scripts/check-vsix.sh <路径.vsix> --dev|--platform
#   --dev       开发包（不含二进制）：只要有语法/语言配置/dist/初始化脚本即可
#   --platform  平台包：额外必须有 bin/bdl-lsp、bin/tiptop、bin/BUILD-INFO.json
#
# 判定方式：必需文件清单 + 禁止文件清单（而不是"文件数 ≤ N"）——
# 之前用 count>15 的魔法数字，正常加两个文档就误报，还把"脚本必须打进包"这条漏掉了。
set -euo pipefail

VSIX=${1:-}
MODE=${2:-}
[ -n "$VSIX" ] && [ -f "$VSIX" ] || { echo "用法: check-vsix.sh <路径.vsix> --dev|--platform"; exit 2; }
case "$MODE" in --dev|--platform) ;; *) echo "必须给 --dev 或 --platform"; exit 2 ;; esac

require() {
  unzip -l "$VSIX" | awk '{print $4}' | grep -qx "extension/$1" || { echo "VSIX 缺少 extension/$1"; exit 1; }
}
# 平台二进制在 Windows 是 .exe，用正则断言
require_glob() {
  unzip -l "$VSIX" | awk '{print $4}' | grep -qE "^extension/$1$" || { echo "VSIX 缺少 extension/$1"; exit 1; }
}
# 注意：vsce 打包时会把根文件改名（README.md → readme.md、LICENSE → LICENSE.txt）
require_glob 'package\.json'
require_glob '(README|readme)\.md'
require_glob '(LICENSE|license)(\.txt)?'
for f in icon.png dist/extension.js \
         syntaxes/bdl.tmLanguage.json syntaxes/per.tmLanguage.json \
         language-configuration/bdl.json language-configuration/per.json \
         scripts/init-project/init-project.sh \
         scripts/init-project/init-project.ps1 \
         scripts/init-project/detect-encoding.py \
         scripts/init-project/templates/gitignore \
         scripts/init-project/templates/settings.example.json; do
  require "$f"
done
if [ "$MODE" = "--platform" ]; then
  require_glob 'bin/bdl-lsp(\.exe)?'
  require_glob 'bin/tiptop(\.exe)?'
  require "bin/BUILD-INFO.json"
fi

# 禁止：仓库内部实现与工程文件；scripts/ 只允许 init-project/
BAD=$(unzip -l "$VSIX" | awk '{print $4}' | grep -E '^extension/(src|test|\.github|node_modules|dist-vsix|out|coverage)/|^extension/[^/]*\.(map|vsix|log)$|^extension/(esbuild\.mjs|tsconfig\.json|package-lock\.json)$' || true)
# docs/ 只允许截图（docs/images/**）
DOCS=$(unzip -l "$VSIX" | awk '{print $4}' | grep -E '^extension/docs/' | grep -vE '^extension/docs/images/' || true)
OTHERSCRIPTS=$(unzip -l "$VSIX" | awk '{print $4}' | grep -E '^extension/scripts/' | grep -vE '^extension/scripts/init-project/' || true)
if [ -n "$BAD$OTHERSCRIPTS$DOCS" ]; then
  echo "VSIX 夹带了不该进包的文件："
  printf '%s\n' "$BAD" "$OTHERSCRIPTS" "$DOCS" | sed '/^$/d' | sed 's/^/  /'
  echo "（提示：docs/ 只允许 docs/images/ 截图；scripts/ 只允许 scripts/init-project/）"
  exit 1
fi

# 暴涨护栏：只防"忽略规则整体失效"，不当作精确值
count=$(unzip -l "$VSIX" | tail -1 | awk '{print $2}')
echo "VSIX 内容自检通过（$MODE）：$count 个条目"
if [ "$count" -gt 60 ]; then
  echo "VSIX 条目数暴涨（$count），检查 .vscodeignore"; exit 1
fi
