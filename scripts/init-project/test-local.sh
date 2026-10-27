#!/usr/bin/env bash
# test-local.sh —— init-project 的离线自测（不需要真服务器）。
#
# 原理：造一棵"远端"fixture，假 ssh 只负责只读预检/取样，
#       再通过 INIT_PROJECT_RSYNC_SRC 把"远端"指向本地目录，跑通 rsync 全链路并逐项断言。
set -euo pipefail
SELF_DIR=$(cd "$(dirname "$0")" && pwd)
TMP=$(mktemp -d "${TMPDIR:-/tmp}/init-project-test.XXXXXX")
trap 'rm -rf "$TMP"' EXIT
pass=0; fail=0
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; pass=$((pass+1)); }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; fail=$((fail+1)); }
check(){ if eval "$2"; then ok "$1"; else bad "$1"; fi; }

ROOT="$TMP/remote/topprod"; DEST="$TMP/local/topprod"
# 远根下：topcust / tiptop 在范围内，other 在范围外；topcust/empty 里没有任何源文件
# 文件级限制：任意目录的 *.global、*/4gl/*.4gl、*/per/*.per，其余一律不同步
mkdir -p "$ROOT/topcust/aap/4gl" "$ROOT/topcust/aap/per" "$ROOT/topcust/aap/42f" \
         "$ROOT/tiptop/lib/4gl" "$ROOT/other/lib/4gl" "$ROOT/topcust/empty/4gl" \
         "$ROOT/topcust/aap/etc" "$ROOT/topcust/aap/bin" "$ROOT/.git" "$ROOT/.project/link"
printf 'MAIN\n    DISPLAY "ok"\nEND MAIN\n' > "$ROOT/topcust/aap/4gl/axcp500.4gl"
printf 'DEFINE g_globals\n' > "$ROOT/topcust/aap/glo.global"
printf 'SCREEN s { }\n' > "$ROOT/topcust/aap/per/axcp500.per"
printf 'MAIN\nEND MAIN\n' > "$ROOT/tiptop/lib/4gl/libutil.4gl"
printf 'MAIN\nEND MAIN\n' > "$ROOT/other/lib/4gl/outside-scope.4gl"
printf 'MAIN\nEND MAIN\n' > "$ROOT/topcust/aap/etc/odd.4gl"
printf 'MAIN\nEND MAIN\n' > "$ROOT/topcust/aap/per/odd.4gl"
printf 'SCREEN s { }\n'   > "$ROOT/topcust/aap/4gl/odd.per"
python3 - "$ROOT/topcust/aap/4gl/zh.4gl" <<'PY'
import sys
open(sys.argv[1], "wb").write('MAIN\n    DISPLAY "料件编号"\nEND MAIN\n'.encode("gbk"))
PY
printf 'MAIN\r\nEND MAIN\r\n' > "$ROOT/topcust/aap/4gl/crlf.4gl"
printf 'bin\n'    > "$ROOT/topcust/aap/42f/x.42m"
printf 'bak\n'    > "$ROOT/topcust/aap/4gl/old.4gl.bak"
printf 'tool\n'   > "$ROOT/topcust/aap/bin/tool"
printf 'secret\n' > "$ROOT/.project/link/links.jsonl"
printf 'git\n'    > "$ROOT/.git/config"

FAKE="$TMP/fake-ssh"
SSHLOG="$TMP/ssh.log"
cat > "$FAKE" <<'FEOF'
#!/usr/bin/env bash
set -euo pipefail
echo "$*" >> "${INIT_TEST_SSH_LOG:-/dev/null}"
args=("$@"); i=0
while [ $i -lt ${#args[@]} ]; do
  case "${args[$i]}" in
    -o|-p|-i) i=$((i+2)) ;;
    -*)       i=$((i+1)) ;;
    *)        i=$((i+1)); break ;;
  esac
done
cmd=${args[$i]:-}
# 模拟"没有可用密钥"：只要带了 BatchMode=yes 就失败
if [ "${INIT_TEST_NO_KEY:-0}" = 1 ] && [[ " $* " == *"BatchMode=yes"* ]]; then exit 255; fi
sh -c "$cmd"
FEOF
chmod +x "$FAKE"
: > "$SSHLOG"
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.com GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.com

run_init() { # run_init [额外参数...]
  INIT_PROJECT_SSH="$FAKE" INIT_PROJECT_RSYNC_SRC="$ROOT" \
    "$SELF_DIR/init-project.sh" --target fake@host --remote-root "$ROOT" \
    --dest "$DEST" --from-encoding gbk --yes "$@"
}

echo "── 首次初始化 ──"
run_init >"$TMP/run1.log" 2>&1 || { tail -20 "$TMP/run1.log"; echo "主脚本失败"; exit 1; }
grep -E '^\[.+\]' "$TMP/run1.log" | head -8 | sed 's/^/    /'

echo "── 取数与排除 ──"
check "取到 6 个源文件" "[ \"\$(find '$DEST' -type f \( -name '*.4gl' -o -name '*.global' -o -name '*.per' \) | wc -l)\" = 6 ]"
check "没有 42f 产物"   "[ ! -e '$DEST/topcust/aap/42f/x.42m' ]"
check "没有 *.bak"      "[ ! -e '$DEST/topcust/aap/4gl/old.4gl.bak' ]"
check "没有 bin/tool"   "[ ! -e '$DEST/topcust/aap/bin/tool' ]"
check "没有 .project"   "[ ! -e '$DEST/.project' ]"
check "没有 .git（远端的）" "[ ! -e '$DEST/.git/config' ] || git -C '$DEST' rev-parse --git-dir >/dev/null 2>&1"
check "tiptop 与 topcust 两个目录都取到" "[ -e '$DEST/tiptop/lib/4gl/libutil.4gl' ] && [ -e '$DEST/topcust/aap/4gl/axcp500.4gl' ]"
check "任意目录的 .global 取到"    "[ -e '$DEST/topcust/aap/glo.global' ]"
check "范围外的 other/ 没被取"    "[ ! -e '$DEST/other' ]"
check "非 4gl 目录里的 .4gl 不取"  "[ ! -e '$DEST/topcust/aap/etc' ]"
check "per 目录里的 .4gl 不取"     "[ ! -e '$DEST/topcust/aap/per/odd.4gl' ]"
check "4gl 目录里的 .per 不取"     "[ ! -e '$DEST/topcust/aap/4gl/odd.per' ]"
check "没有源文件的目录不同步"     "[ ! -e '$DEST/topcust/empty' ]"

echo "── 编码与行尾 ──"
check "GBK 已转成合法 UTF-8" "iconv -f UTF-8 -t UTF-8 '$DEST/topcust/aap/4gl/zh.4gl' >/dev/null 2>&1"
check "中文内容正确"    "grep -q '料件编号' '$DEST/topcust/aap/4gl/zh.4gl'"
check "CRLF 已归一 LF"  "! grep -q \$'\\r' '$DEST/topcust/aap/4gl/crlf.4gl'"
check "原来的 UTF-8 没坏" "grep -q 'DISPLAY \"ok\"' '$DEST/topcust/aap/4gl/axcp500.4gl'"

echo "── 模板与换行设置 ──"
check ".gitignore 忽略 .project"  "grep -q '^\\.project/' '$DEST/.gitignore'"
check ".gitignore 忽略 .pack"     "grep -q '^\\.pack/' '$DEST/.gitignore'"
check ".gitattributes 固定 LF"    "grep -q 'eol=lf' '$DEST/.gitattributes'"
check ".editorconfig 生成"        "[ -s '$DEST/.editorconfig' ] && grep -q 'end_of_line = lf' '$DEST/.editorconfig'"
check "settings.example.json"     "[ -s '$DEST/.vscode/settings.example.json' ]"
check "README-PROJECT.md 有来源"  "grep -q 'fake@host' '$DEST/README-PROJECT.md' && grep -q -- '--update' '$DEST/README-PROJECT.md'"
check "core.autocrlf=false"       "[ \"\$(git -C '$DEST' config core.autocrlf)\" = false ]"
check "core.eol=lf"               "[ \"\$(git -C '$DEST' config core.eol)\" = lf ]"

echo "── git 校验 ──"
check "分支 main"                 "[ \"\$(git -C '$DEST' rev-parse --abbrev-ref HEAD)\" = main ]"
check "已自动提交"                "git -C '$DEST' log --oneline | grep -q '生产代码镜像'"
check "提交里没有 .project"       "! git -C '$DEST' ls-files | grep -q '^\\.project/'"
check "git ls-files --eol 全是 LF" "! git -C '$DEST' ls-files --eol | awk '\$1!=\"i/lf\" || \$2!=\"w/lf\"' | grep -q ."
check "git diff --check 干净"     "git -C '$DEST' diff --check >/dev/null 2>&1"

echo "── 默认不删：本地多余文件保留 ──"
printf 'MAIN\nEND MAIN\n' > "$DEST/topcust/aap/4gl/local-extra.4gl"
rm -f "$ROOT/topcust/aap/per/axcp500.per"          # 远端也删掉一个
run_init --update >"$TMP/run2.log" 2>&1 || { tail -20 "$TMP/run2.log"; echo "更新失败"; exit 1; }
check "本地多余文件仍在（默认不删）" "[ -e '$DEST/topcust/aap/4gl/local-extra.4gl' ]"
check "远端已删的文件本地也保留"     "[ -e '$DEST/topcust/aap/per/axcp500.per' ]"
check "远端改动已同步（中文重新转码）" "grep -q 'DISPLAY \"ok\"' '$DEST/topcust/aap/4gl/axcp500.4gl'"
check "更新也有提交"                 "[ \"\$(git -C '$DEST' log --oneline | wc -l)\" -ge 2 ]"

echo "── --delete 才删（列清单 + --yes 确认） ──"
echo "  （先验证"会问"：不带 --yes，答 n 应保留）"
printf 'y\nn\n' | INIT_PROJECT_SSH="$FAKE" INIT_PROJECT_RSYNC_SRC="$ROOT" \
  "$SELF_DIR/init-project.sh" --target fake@host --remote-root "$ROOT" \
  --dest "$DEST" --from-encoding gbk --update --delete >"$TMP/run3a.log" 2>&1 || true
check "删除前列出并提示需确认" "grep -qE '发现 [0-9]+ 个本地多余文件' '$TMP/run3a.log' && grep -q 'local-extra.4gl' '$TMP/run3a.log'"
check "答 n 不删（多余文件仍在）" "[ -e '$DEST/topcust/aap/4gl/local-extra.4gl' ]"
run_init --update --delete >"$TMP/run3.log" 2>&1 || { tail -20 "$TMP/run3.log"; echo "删除运行失败"; exit 1; }
check "本地多余文件已删"             "[ ! -e '$DEST/topcust/aap/4gl/local-extra.4gl' ]"
check "远端已删的文件本地也删"       "[ ! -e '$DEST/topcust/aap/per/axcp500.per' ]"
check "保留其它本地文件（模板还在）" "[ -s '$DEST/.gitignore' ] && [ -s '$DEST/README-PROJECT.md' ]"

echo "── 远端只读审计 ──"
CMDS=$(INIT_PROJECT_SSH="$FAKE" INIT_PROJECT_RSYNC_SRC="$ROOT" "$SELF_DIR/init-project.sh" \
  --target fake@host --remote-root "$ROOT" --dest "$DEST" --print-remote 2>&1)
# 注意：tiptop/topcust 现在就是取数目录名，所以不能再用 "tiptop" 子串判断有没有调上传/部署命令
check "只有 find/ls/head/base64/rsync（无上传/部署）" \
  "! printf '%s' \"\$CMDS\" | grep -qE 'scp |curl|wget|upload|deploy|(^|[&|;]) *tiptop +(link|schema|compile|build)'"
check "没有重定向写文件" "! printf '%s' \"\$CMDS\" | grep -qE '>>|>'"
check "没有 rm/mkdir/mktemp/touch/cp/mv" \
  "! printf '%s' \"\$CMDS\" | grep -qE '(^|[^a-z])(rm|mkdir|mktemp|touch|tee|cp|mv) '"

echo "── 未配密钥：允许过程中输入密码（--ask-password） ──"
DEST2="$TMP/local/topprod-pw"
: > "$SSHLOG"
INIT_TEST_SSH_LOG="$SSHLOG" INIT_TEST_PROBE=1 INIT_TEST_NO_KEY=1 \
  INIT_PROJECT_SSH="$FAKE" INIT_PROJECT_RSYNC_SRC="$ROOT" \
  "$SELF_DIR/init-project.sh" --target fake@host --remote-root "$ROOT" \
  --dest "$DEST2" --from-encoding gbk --ask-password -y >"$TMP/runpw.log" 2>&1 \
  || { tail -20 "$TMP/runpw.log"; bad "无密钥+--ask-password 应能跑通"; }
check "无密钥时用密码登录跑通"      "[ -e '$DEST2/tiptop/lib/4gl/libutil.4gl' ]"
check "提示已改用密码登录"          "grep -q '已改用密码登录' '$TMP/runpw.log'"
check "探针只在前两次带 BatchMode（≤2）" "[ \"\$(grep -c 'BatchMode=yes' '$SSHLOG')\" -le 2 ]"
check "最后一次远端调用不再带 BatchMode" "! tail -1 '$SSHLOG' | grep -q 'BatchMode=yes'"
check "密码模式带 PreferredAuthentications=password" \
  "grep -q 'PreferredAuthentications=password' '$SSHLOG'"

echo
echo "结果：$pass 通过 / $fail 失败"
[ "$fail" = 0 ] || exit 1
