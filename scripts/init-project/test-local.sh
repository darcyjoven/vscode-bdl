#!/usr/bin/env bash
# test-local.sh —— init-project 的离线自测：不需要真服务器。
#
# 原理：造一棵"远端"fixture 树，再写一个假 ssh，把 remote-collect.sh 在本地 fixture 上执行，
#       跑通「预检 → 样本检测 → 流式打包 → 解包 → 规范化 → git 初始化」全链路，逐项断言。
set -euo pipefail

SELF_DIR=$(cd "$(dirname "$0")" && pwd)
TMP=$(mktemp -d "${TMPDIR:-/tmp}/init-project-test.XXXXXX")
trap 'rm -rf "$TMP"' EXIT

pass=0; fail=0
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; pass=$((pass+1)); }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; fail=$((fail+1)); }
check(){ if eval "$2"; then ok "$1"; else bad "$1"; fi; }

# ── 1) 造远端 fixture（含 UTF-8 / GBK / 垃圾产物 / 多模组）
ROOT="$TMP/remote/toppord"
DEST="$TMP/local/toppord"
mkdir -p "$ROOT/topcust/aap/4gl" "$ROOT/topcust/aap/per" "$ROOT/topcust/aap/42f" \
         "$ROOT/other/lib/4gl" "$ROOT/topcust/aap/bin" "$ROOT/.git" "$ROOT/.project/link"
printf 'MAIN\n    DISPLAY "ok"\nEND MAIN\n' > "$ROOT/topcust/aap/4gl/axcp500.4gl"
printf 'DEFINE g_globals\n' > "$ROOT/topcust/aap/4gl/glo.global"
printf 'SCREEN s { }\n' > "$ROOT/topcust/aap/per/axcp500.per"
printf 'MAIN\nEND MAIN\n' > "$ROOT/other/lib/4gl/libutil.4gl"
# GBK 文件（中文注释）
python3 - "$ROOT/topcust/aap/4gl/zh.4gl" <<'PY'
import sys
open(sys.argv[1], "wb").write('MAIN\n    DISPLAY "料件编号"\nEND MAIN\n'.encode("gbk"))
PY
# CRLF 文件（验证行尾归一）
printf 'MAIN\r\nEND MAIN\r\n' > "$ROOT/topcust/aap/4gl/crlf.4gl"
# 应当被排除的
printf 'bin\n'   > "$ROOT/topcust/aap/42f/x.42m"
printf 'bak\n'   > "$ROOT/topcust/aap/4gl/old.4gl.bak"
printf 'tool\n'  > "$ROOT/topcust/aap/bin/tool"
printf 'secret\n'> "$ROOT/.project/link/links.jsonl"
printf 'git\n'   > "$ROOT/.git/config"

# ── 2) 假 ssh：忽略目标，把远端命令在本地 fixture 上执行
#      （现在远端是**内联只读命令**，脚本本身不再送到服务器上）
FAKE="$TMP/fake-ssh"
cat > "$FAKE" <<'FEOF'
#!/usr/bin/env bash
set -euo pipefail
shift              # 丢掉 target
sh -c "$1"         # 命令里已 cd 到 fixture 根，所以本地跑与远端一致
FEOF
chmod +x "$FAKE"

# ── 2b) 只读审计：打印出来的远端命令里不许出现任何写/上传动作
echo "── 审计：远端只读 ──"
REMOTE_CMDS=$(INIT_PROJECT_SSH="$FAKE" "$SELF_DIR/init-project.sh" \
  --target fake@host --remote-root "$ROOT" --dest "$DEST" --print-remote 2>&1)
printf '%s
' "$REMOTE_CMDS" | sed 's/^/    /' | head -6
check "远端命令只有 find/stat/ls/head/base64/tar/awk/sed/wc" \
  "! printf '%s' \"\$REMOTE_CMDS\" | grep -qE 'tiptop|rsync|scp|curl|wget|upload|deploy'"
check "远端命令没有重定向（> / >>）" "! printf '%s' \"\$REMOTE_CMDS\" | grep -qE '>>|>'"
check "远端命令没有 rm/mkdir/mktemp/touch/tee/cp/mv" \
  "! printf '%s' \"\$REMOTE_CMDS\" | grep -qE '(^|[^a-z])(rm|mkdir|mktemp|touch|tee|cp|mv) '"

# ── 3) 跑主脚本（首次初始化）
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.com
export GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.com
echo "── 首次初始化 ──"
INIT_PROJECT_SSH="$FAKE" "$SELF_DIR/init-project.sh" \
  --target fake@host --remote-root "$ROOT" --dest "$DEST" \
  --from-encoding gbk -y >"$TMP/run1.log" 2>&1 || { cat "$TMP/run1.log"; echo "主脚本失败"; exit 1; }
sed 's/^/    /' "$TMP/run1.log" | tail -8

echo "── 断言：取数与排除 ──"
check "取到 6 个源文件（4gl/global/per）" "[ \"\$(find '$DEST' -type f \( -name '*.4gl' -o -name '*.global' -o -name '*.per' \) | wc -l)\" = 6 ]"
check "没有 42f 产物" "[ ! -e '$DEST/topcust/aap/42f/x.42m' ]"
check "没有 *.bak"    "[ ! -e '$DEST/topcust/aap/4gl/old.4gl.bak' ]"
check "没有 bin/tool" "[ ! -e '$DEST/topcust/aap/bin/tool' ]"
check "没有 .project 资料" "[ ! -e '$DEST/.project' ]"
check "多模组都在" "[ -e '$DEST/other/lib/4gl/libutil.4gl' ]"

echo "── 断言：编码与行尾 ──"
check "GBK 已转成合法 UTF-8" "iconv -f UTF-8 -t UTF-8 '$DEST/topcust/aap/4gl/zh.4gl' >/dev/null 2>&1"
check "中文内容正确" "grep -q '料件编号' '$DEST/topcust/aap/4gl/zh.4gl'"
check "CRLF 已归一为 LF" "! grep -q \$'\\r' '$DEST/topcust/aap/4gl/crlf.4gl'"
check "本来就是 UTF-8 的文件没坏" "grep -q 'DISPLAY \"ok\"' '$DEST/topcust/aap/4gl/axcp500.4gl'"

echo "── 断言：模板与 git ──"
check "生成 .gitignore"  "[ -s '$DEST/.gitignore' ]"
check ".gitignore 忽略 .project" "grep -q '^\\.project/' '$DEST/.gitignore'"
check "生成 .gitattributes" "[ -s '$DEST/.gitattributes' ]"
check "生成 .vscode/settings.example.json" "[ -s '$DEST/.vscode/settings.example.json' ]"
check "生成 README-PROJECT.md" "[ -s '$DEST/README-PROJECT.md' ]"
check "README 写了来源主机与远根" "grep -q 'fake@host' '$DEST/README-PROJECT.md' && grep -q '$ROOT' '$DEST/README-PROJECT.md'"
check "README 写了重新初始化命令" "grep -q -- '--update' '$DEST/README-PROJECT.md'"
check "是 git 仓库且分支 main" "[ \"\$(git -C '$DEST' rev-parse --abbrev-ref HEAD)\" = main ]"
check "已自动提交" "git -C '$DEST' log --oneline | grep -q '生产代码镜像'"
check "提交里没有 .project" "! git -C '$DEST' ls-files | grep -q '^\\.project/'"

# ── 4) 增量更新：远端改一个、删一个、加一个
echo "── 增量更新 ──"
printf 'MAIN\n    DISPLAY "v2"\nEND MAIN\n' > "$ROOT/topcust/aap/4gl/axcp500.4gl"
rm -f "$ROOT/topcust/aap/per/axcp500.per"
printf 'DEFINE n\n' > "$ROOT/topcust/aap/4gl/new.4gl"
INIT_PROJECT_SSH="$FAKE" "$SELF_DIR/init-project.sh" \
  --target fake@host --remote-root "$ROOT" --dest "$DEST" \
  --from-encoding gbk -y --update >"$TMP/run2.log" 2>&1 || { cat "$TMP/run2.log"; echo "更新失败"; exit 1; }
check "改动已同步" "grep -q 'DISPLAY \"v2\"' '$DEST/topcust/aap/4gl/axcp500.4gl'"
check "新增文件已拉取" "[ -e '$DEST/topcust/aap/4gl/new.4gl' ]"
check "远端已删的文件本地也删了" "[ ! -e '$DEST/topcust/aap/per/axcp500.per' ]"
check "模板文件没被覆盖" "[ -s '$DEST/.gitignore' ] && grep -q '^\\.project/' '$DEST/.gitignore'"
check "README 没被覆盖" "grep -q 'fake@host' '$DEST/README-PROJECT.md'"
check "更新也提交了" "git -C '$DEST' log --oneline | wc -l | grep -qv '^1$'"

echo
echo "结果：$pass 通过 / $fail 失败"
[ "$fail" = 0 ] || exit 1
