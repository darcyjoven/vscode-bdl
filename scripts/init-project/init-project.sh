#!/usr/bin/env bash
# init-project.sh —— 从生产服务器（如 RedHat 6.5 + TiTop）初始化/更新一个 4GL 项目仓库。
#
# 平台：Ubuntu / WSL（Windows 版见 init-project.ps1，参数同名）
# 产物：目标目录 = 生产代码镜像 + git 仓库（.gitignore / .gitattributes / .vscode/settings.example.json / README-PROJECT.md）
#
# 设计要点：
#   - 远端只读：先 stats 预检（文件数/字节数），再 tar.gz **流式**回传（不落远端临时文件、不依赖 rsync）
#   - 远端脚本用 `ssh … "sh -s -- …"` 送入：登录 shell 是 csh/ksh 也不受影响
#   - 老服务器（OpenSSH 5.x）默认算法被新客户端禁用：首次失败自动按 legacy 重试
#   - 编码：先取样本检测并**问用户**，再逐文件转 UTF-8（本来就是 UTF-8 的文件跳过）
#   - 幂等：目标目录已存在时默认拒绝；--update 走增量合并（远端已删的文件会先确认再删）
set -euo pipefail

SELF_DIR=$(cd "$(dirname "$0")" && pwd)
REMOTE_SCRIPT="$SELF_DIR/remote-collect.sh"
DETECT_PY="$SELF_DIR/detect-encoding.py"
TPL_DIR="$SELF_DIR/templates"
VERSION="1"

# ── 默认值（都能用参数覆盖；缺关键项时交互询问）
TARGET="${INIT_PROJECT_TARGET:-}"
PORT=""; KEY=""; REMOTE_ROOT=""; MODULES=""
DEST=""; BRANCH="main"; INCLUDES=""; FROM_ENC=""
TRANSPORT="tar"; DRY_RUN=0; UPDATE=0; FORCE=0; ASSUME_YES=0
COMMIT=1; LEGACY=0; KEEP_TMP=0; SAMPLES=6; VERBOSE=0; FORCE_TEMPLATES=0
SSH_BIN="${INIT_PROJECT_SSH:-ssh}"
[ -n "${INIT_PROJECT_SSH:-}" ] && TEST_SSH=1 || TEST_SSH=0

# ── 输出
if [ -t 1 ]; then C_OK=$'\033[32m'; C_WARN=$'\033[33m'; C_ERR=$'\033[31m'; C_DIM=$'\033[2m'; C_0=$'\033[0m'
else C_OK=""; C_WARN=""; C_ERR=""; C_DIM=""; C_0=""; fi
info()  { printf '%s==>%s %s\n' "$C_OK" "$C_0" "$*"; }
warn()  { printf '%s[警告]%s %s\n' "$C_WARN" "$C_0" "$*" >&2; }
die()   { printf '%s[错误]%s %s\n' "$C_ERR" "$C_0" "$*" >&2; exit 1; }
dim()   { printf '%s    %s%s\n' "$C_DIM" "$*" "$C_0"; }

usage() {
  cat <<'USAGE'
用法: init-project.sh [选项]

连接（缺了就交互询问；只支持 SSH 密钥/agent，不支持密码）:
  -t, --target <user@host | ~/.ssh/config 别名>
  -p, --port <n>                默认 22（或在别名里写）
  -k, --key <私钥路径>          默认走 agent / ~/.ssh 默认密钥
      --legacy-ssh              用 ssh-rsa/SHA-1 兼容老服务器（OpenSSH 5.x）

取数:
  -r, --remote-root </u1/toppord>   生产根目录（必填）
  -m, --module <a,b>                只取这些顶层模组（默认全部）
      --include '<glob>'            改文件匹配（可多次；默认 *.4gl/*.global/*.per）

本地与 git:
  -d, --dest <目录>                 目标目录（默认 ~/projects/<远根名>）
      --branch <名>                 默认 main
      --update                      目标已存在时增量合并（远端已删的本地文件会先确认再删）
      --force                       目标非空也继续（危险：可能混入旧文件）
      --no-commit                   只落盘不提交
      --force-templates             覆盖已存在的 .gitignore/.gitattributes

编码 / 其他:
      --from-encoding <gbk|big5|euc-cn|utf-8>   跳过"样本检测+询问"，直接用它转码
      --dry-run                     只预检与检测编码，不传输不写盘
  -y, --yes                         全程不再确认（编码仍会用检测结果，除非给了 --from-encoding）
      --keep-tmp                    保留临时 tarball（排障用）
  -v, --verbose
  -h, --help                        本帮助
USAGE
}

# ── 参数解析
while [ $# -gt 0 ]; do
  case "$1" in
    -t|--target) TARGET=${2:-}; shift 2 ;;
    -p|--port) PORT=${2:-}; shift 2 ;;
    -k|--key) KEY=${2:-}; shift 2 ;;
    --legacy-ssh) LEGACY=1; shift ;;
    -r|--remote-root) REMOTE_ROOT=${2:-}; shift 2 ;;
    -m|--module) MODULES=${2:-}; shift 2 ;;
    --include) INCLUDES="$INCLUDES ${2:-}"; shift 2 ;;
    -d|--dest) DEST=${2:-}; shift 2 ;;
    --branch) BRANCH=${2:-}; shift 2 ;;
    --from-encoding) FROM_ENC=${2:-}; shift 2 ;;
    --update) UPDATE=1; shift ;;
    --force) FORCE=1; shift ;;
    --no-commit) COMMIT=0; shift ;;
    --force-templates) FORCE_TEMPLATES=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -y|--yes) ASSUME_YES=1; shift ;;
    --keep-tmp) KEEP_TMP=1; shift ;;
    --samples) SAMPLES=${2:-6}; shift 2 ;;
    -v|--verbose) VERBOSE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "未知参数：$1（用 -h 看帮助）" ;;
  esac
done

need() { command -v "$1" >/dev/null 2>&1 || die "缺少命令 $1"; }
need ssh; need tar; need git; need iconv; need awk; need sed
need python3; need base64

# ── 交互补齐
ask() { # ask <提示> <默认值>
  local prompt=$1 def=${2:-} ans
  if [ -n "$def" ]; then read -r -p "$prompt [$def]: " ans || true; printf '%s' "${ans:-$def}"
  else read -r -p "$prompt: " ans || true; printf '%s' "$ans"; fi
}
[ -n "$TARGET" ] || TARGET=$(ask "SSH 目标（user@host 或 ~/.ssh/config 别名）")
[ -n "$TARGET" ] || die "必须给 --target"
[ -n "$REMOTE_ROOT" ] || REMOTE_ROOT=$(ask "生产根目录（如 /u1/toppord）")
[ -n "$REMOTE_ROOT" ] || die "必须给 --remote-root"
[ -n "$DEST" ] || DEST="$HOME/projects/$(basename "${REMOTE_ROOT%/}")"
PROJECT_NAME=$(basename "${DEST%/}")

confirm() { # confirm <问题>
  [ "$ASSUME_YES" = 1 ] && return 0
  local ans; read -r -p "$1 [y/N]: " ans || true
  case "${ans:-}" in y|Y|yes|YES) return 0 ;; *) return 1 ;; esac
}

# ── SSH 调用
SSH_OPTS=()
[ "$TEST_SSH" = 1 ] || {
  [ -n "$PORT" ] && SSH_OPTS+=(-p "$PORT")
  [ -n "$KEY" ] && SSH_OPTS+=(-i "$KEY")
  SSH_OPTS+=(-o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new)
}
LEGACY_OPTS=(-o HostkeyAlgorithms=+ssh-rsa -o PubkeyAcceptedAlgorithms=+ssh-rsa
             -o KexAlgorithms=+diffie-hellman-group14-sha1,diffie-hellman-group1-sha1
             -o MACs=+hmac-sha1)

ssh_run() { "$SSH_BIN" "${SSH_OPTS[@]}" "$TARGET" "$@"; }

# 把远端子脚本送过去执行：ssh <target> "sh -s -- <args...>" < remote-collect.sh
ssh_collect() {
  local q="" a
  for a in "$@"; do q="$q $(printf '%q' "$a")"; done
  "$SSH_BIN" "${SSH_OPTS[@]}" "$TARGET" "sh -s --$q" < "$REMOTE_SCRIPT"
}

collect_args() {
  local args=(--root "$REMOTE_ROOT")
  local IFS=,
  local m
  for m in $MODULES; do [ -n "$m" ] && args+=(--module "$m"); done
  unset IFS
  local g
  for g in $INCLUDES; do [ -n "$g" ] && args+=(--include "$g"); done
  printf '%s\n' "${args[@]}"
}

mapfile -t C_ARGS < <(collect_args)

# ── 1) 连通性（老服务器自动 legacy 重试）
info "连接 $TARGET …"
if ! ssh_run true 2>/dev/null; then
  if [ "$LEGACY" = 1 ]; then die "连不上 $TARGET（已用 --legacy-ssh）"; fi
  warn "默认算法连不上，按老服务器（OpenSSH 5.x）兼容参数重试…"
  SSH_OPTS+=("${LEGACY_OPTS[@]}"); LEGACY=1
  ssh_run true || die "连不上 $TARGET：确认密钥/agent、网络与主机名（密码登录不支持）"
fi
[ "$LEGACY" = 1 ] && warn "已启用 ssh-rsa/SHA-1 兼容（老服务器）"

# ── 2) 远根只读预检
info "远端预检（只读）…"
STATS=$(ssh_collect stats "${C_ARGS[@]}") || die "远端预检失败"
FILES=$(printf '%s\n' "$STATS" | awk '/^FILES /{print $2}')
BYTES=$(printf '%s\n' "$STATS" | awk '/^BYTES /{print $2}')
MODS=$(printf '%s\n' "$STATS"  | awk '/^MODULES /{print $2}')
[ "${FILES:-0}" -gt 0 ] || die "没有匹配到源文件：确认 --remote-root / --module / --include"
info "找到 $FILES 个源文件，共 $(awk -v b="$BYTES" 'BEGIN{printf "%.2f MB", b/1048576}')"
dim "顶层目录：$MODS"

# ── 3) 编码：取样本 → 检测 → 问用户
TMPDIR_RUN=$(mktemp -d "${TMPDIR:-/tmp}/init-project.XXXXXX")
cleanup() {
  if [ "$KEEP_TMP" = 1 ]; then warn "临时目录保留：$TMPDIR_RUN"
  else rm -rf "$TMPDIR_RUN"; fi
}
trap cleanup EXIT

ENC="$FROM_ENC"
if [ -z "$ENC" ]; then
  info "取 $SAMPLES 个样本检测编码…"
  SAMPLE_OUT=$(ssh_collect sample --root "$REMOTE_ROOT" --count "$SAMPLES" "${C_ARGS[@]:2}") || die "取样本失败"
  mkdir -p "$TMPDIR_RUN/samples"
  n=0; path=""; b64=""
  while IFS= read -r line; do
    case "$line" in
      FILE\ *) path=${line#FILE }; b64=""; n=$((n+1));;
      END)     [ -n "$path" ] && printf '%s' "$b64" | base64 -d > "$TMPDIR_RUN/samples/$n-$(basename "$path")" 2>/dev/null || true
               path="";;
      *)       [ -n "$path" ] && b64="$b64$line";;
    esac
  done <<EOF
$SAMPLE_OUT
EOF
  shopt -s nullglob
  sample_files=("$TMPDIR_RUN"/samples/*)
  shopt -u nullglob
  [ ${#sample_files[@]} -gt 0 ] || die "没取到样本文件"
  REPORT=$(python3 "$DETECT_PY" "${sample_files[@]}")
  printf '%s\n' "$REPORT" | sed 's/^/    /'
  GUESS=$(printf '%s\n' "$REPORT" | awk -F'\t' '/^FILE\t/{print $4}' | sort | uniq -c | sort -rn | head -1 | awk '{print $2}')
  if [ "$GUESS" = "utf-8" ]; then
    info "样本都是合法 UTF-8 → 不需要转码"
    ENC=""
  else
    if [ "$ASSUME_YES" = 1 ]; then
      ENC=$GUESS; info "按检测结果使用 $ENC（--yes 不询问）"
    else
      echo
      echo "源文件不是 UTF-8。请选择源编码（上方 alt 行可对比解码预览）："
      echo "  1) gbk（大陆环境最常见，检测建议：$GUESS）"
      echo "  2) big5"
      echo "  3) euc-cn"
      echo "  4) 不转码（保持原样）"
      read -r -p "选择 [1]: " pick || true
      case "${pick:-1}" in
        1) ENC=gbk;; 2) ENC=big5;; 3) ENC=euc-cn;; 4) ENC="";; *) ENC=$GUESS;;
      esac
    fi
  fi
fi
[ -n "$ENC" ] && info "转码：$ENC → UTF-8（已是 UTF-8 的文件跳过）"

# ── 4) 确认
echo
echo "──────────────────────────────────────────────"
echo " 目标        : $TARGET"
echo " 远根        : $REMOTE_ROOT${MODULES:+   模组: $MODULES}"
echo " 源文件      : $FILES 个（$(awk -v b="$BYTES" 'BEGIN{printf "%.2f MB", b/1048576}')）"
echo " 本地目标    : $DEST"
echo " 模式        : $([ "$UPDATE" = 1 ] && echo 增量更新 || echo 全新初始化)  分支: $BRANCH"
echo " 编码/行尾   : ${ENC:-不转码} / LF${DRY_RUN:+    [dry-run]}"
echo "──────────────────────────────────────────────"
if [ "$DRY_RUN" = 1 ]; then info "dry-run：到此为止，未传输、未写盘"; exit 0; fi
confirm "继续？" || { info "已取消"; exit 0; }
if [ -e "$DEST" ] && [ "$UPDATE" != 1 ] && [ "$FORCE" != 1 ]; then
  die "目标已存在：$DEST（要增量更新加 --update；要混着用加 --force，谨慎）"
fi

# ── 5) 打包传输（tar 流式）
TARBALL="$TMPDIR_RUN/source.tar.gz"
info "从服务器流式打包…"
ssh_collect pack "${C_ARGS[@]}" > "$TARBALL" || die "打包/传输失败"
[ -s "$TARBALL" ] || die "收到的 tarball 为空"
GOT=$(tar tzf "$TARBALL" | wc -l | tr -d ' ')
[ "$GOT" = "$FILES" ] || warn "tarball 条目 $GOT 与预检文件数 $FILES 不一致（继续，但请留意）"
info "收到 $GOT 个文件"

# ── 6) 解包到位
info "解包到临时目录…"
mkdir -p "$TMPDIR_RUN/out"
tar xzf "$TARBALL" -C "$TMPDIR_RUN/out"
if [ ! -e "$DEST" ]; then
  mkdir -p "$(dirname "$DEST")"; mv "$TMPDIR_RUN/out" "$DEST"
  info "已创建 $DEST"
elif [ "$UPDATE" = 1 ]; then
  # 覆盖合并（只覆盖本次取到的文件）
  cp -a "$TMPDIR_RUN/out/." "$DEST/"
  # 生产端已删的**源文件**（只在取数范围内找，绝不碰 .git/模板/.project）
  tar tzf "$TARBALL" | sort > "$TMPDIR_RUN/listing.txt"
  scan_roots=()
  if [ -n "$MODULES" ]; then IFS=,; for m in $MODULES; do [ -n "$m" ] && scan_roots+=("$DEST/$m"); done; unset IFS
  else scan_roots=("$DEST"); fi
  mapfile -t STALE < <(
    find "${scan_roots[@]}" -type f \( -name '*.4gl' -o -name '*.global' -o -name '*.per' -o -name '*.sch' \) -print 2>/dev/null |
    while IFS= read -r f; do
      rel=${f#"$DEST"/}
      grep -qxF "$rel" "$TMPDIR_RUN/listing.txt" || printf '%s\n' "$rel"
    done
  )
  if [ ${#STALE[@]} -gt 0 ]; then
    if confirm "生产端已删除 ${#STALE[@]} 个源文件（取数范围内），本地也删除？"; then
      for rel in "${STALE[@]}"; do rm -f "$DEST/$rel"; done
      info "已删除 ${#STALE[@]} 个本地遗留源文件"
    else
      warn "保留 ${#STALE[@]} 个本地遗留源文件"
    fi
  fi
  info "已增量更新 $DEST"
else
  die "目标已存在且未指定 --update/--force"
fi
rm -rf "$TMPDIR_RUN/out"

# ── 7) 规范化：清垃圾 / 行尾 / 编码
SRC_GLOBS=(-name '*.4gl' -o -name '*.global' -o -name '*.per' -o -name '*.sch')
mapfile -t SRC_FILES < <(find "$DEST" -type f \( "${SRC_GLOBS[@]}" \) -print)
info "规范化 ${#SRC_FILES[@]} 个源文件（行尾 LF${ENC:+/$ENC→UTF-8}）…"
conv=0 skip=0 crlf=0
for f in "${SRC_FILES[@]}"; do
  if LC_ALL=C grep -q $'\r' "$f" 2>/dev/null; then sed -i 's/\r$//' "$f"; crlf=$((crlf+1)); fi
  if [ -z "$ENC" ]; then continue; fi
  if iconv -f UTF-8 -t UTF-8 "$f" >/dev/null 2>&1; then skip=$((skip+1)); continue; fi
  tmp="$f.utf8tmp"
  if iconv -f "$ENC" -t UTF-8 "$f" > "$tmp" 2>/dev/null; then mv "$tmp" "$f"; conv=$((conv+1))
  else rm -f "$tmp"; warn "转码失败（按 $ENC）：$f"; fi
done
dim "行尾转换 $crlf 个；转码 $conv 个；本来就是 UTF-8 跳过 $skip 个"

# ── 8) git + 模板文件
git_init() {
  if git -C "$DEST" rev-parse --git-dir >/dev/null 2>&1; then return 0; fi
  if git init -q -b "$BRANCH" "$DEST" 2>/dev/null; then return 0; fi
  git init -q "$DEST"; git -C "$DEST" symbolic-ref HEAD "refs/heads/$BRANCH"
}
git_init
info "生成模板文件…"
esc() { printf '%s' "$1" | sed -e 's/[\\&|]/\\&/g'; }
write_tpl() { # write_tpl <模板> <目标> [--force]
  local tpl=$1 out=$2
  if [ -e "$out" ] && [ "$FORCE_TEMPLATES" != 1 ] && [ "${3:-}" != "--force" ]; then
    dim "已存在，保留：${out#"$DEST"/}"; return 0
  fi
  cp "$tpl" "$out"
}
write_tpl "$TPL_DIR/gitignore" "$DEST/.gitignore"
write_tpl "$TPL_DIR/gitattributes" "$DEST/.gitattributes"
mkdir -p "$DEST/.vscode"
write_tpl "$TPL_DIR/settings.example.json" "$DEST/.vscode/settings.example.json"
if [ ! -e "$DEST/README-PROJECT.md" ]; then
  sed -e "s|@PROJECT_NAME@|$(esc "$PROJECT_NAME")|g" \
      -e "s|@SOURCE_HOST@|$(esc "$TARGET")|g" \
      -e "s|@REMOTE_ROOT@|$(esc "$REMOTE_ROOT")|g" \
      -e "s|@SCOPE@|$(esc "${MODULES:-全部模组}")（*.4gl / *.global / *.per）|g" \
      -e "s|@FILE_COUNT@|$FILES|g" \
      -e "s|@INIT_AT@|$(date '+%Y-%m-%d %H:%M:%S %Z')|g" \
      -e "s|@SOURCE_ENCODING@|$(esc "${FROM_ENC:-${ENC:-utf-8}}")|g" \
      "$TPL_DIR/README-PROJECT.md" > "$DEST/README-PROJECT.md"
  dim "写入 README-PROJECT.md（来源信息）"
else
  dim "README-PROJECT.md 已存在，保留"
fi

# ── 9) 提交
if [ "$COMMIT" = 1 ]; then
  git -C "$DEST" add -A
  if [ -n "$(git -C "$DEST" status --porcelain)" ]; then
    if ! git -C "$DEST" var GIT_AUTHOR_IDENT >/dev/null 2>&1; then
      warn "git 还没配 user.name/user.email，跳过提交（配好后自己提交，或用 --no-commit）"
    else
      MSG="chore: 从 $TARGET:$REMOTE_ROOT 初始化/更新生产代码镜像"
      git -C "$DEST" commit -q -m "$MSG" && info "已提交：$MSG"
    fi
  else
    dim "没有变化，无需提交"
  fi
fi

# ── 10) 汇总
echo
info "完成：$DEST"
dim "文件：$(git -C "$DEST" ls-files | wc -l | tr -d ' ') 个已入库；分支 $(git -C "$DEST" rev-parse --abbrev-ref HEAD)"
cat <<NEXT

下一步：
  1) cd "$DEST" && git log --oneline -1     # 看初始化提交
  2) 复制 .vscode/settings.example.json → .vscode/settings.json，填 Oracle/生产服务器
  3) tiptop link sync / schema sync 采集资料（写入 .project/，不进库）
  4) 更新：$(basename "$0") --target '$TARGET' --remote-root '$REMOTE_ROOT' --dest "$DEST" --update
NEXT
