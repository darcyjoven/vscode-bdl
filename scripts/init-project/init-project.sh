#!/usr/bin/env bash
# init-project.sh —— 用 rsync 从生产服务器（Linux，如 RedHat 6.5 + TiTop）初始化/更新 4GL 仓库。
#
# ★ 只在**本地 / WSL / Linux** 直接执行（绝不在生产服务器上运行本脚本）。
# ★ 对生产服务器**只读**：一条只读 find（预检/取样）+ rsync **拉取**（pull 方向，远端不写）。
#    用 --print-remote 可以把要在服务器上执行的命令打印出来审计。
#
# 取数范围：<远根>（默认 /u1/topprod，可改）下 **只取 tiptop、topcust 两个顶层目录** 的
#           *.4gl / *.per / *.global；其它顶层目录不管。用 -m/--module a,b 可覆盖这两个目录名。
#           远端没有源文件的目录不会同步到本地（rsync --prune-empty-dirs）。
# 更新语义：默认**只覆盖、不删**本地多余文件；要删加 --delete（会先列出待删再确认）。
set -euo pipefail

SELF_DIR=$(cd "$(dirname "$0")" && pwd)
DETECT_PY="$SELF_DIR/detect-encoding.py"
TPL_DIR="$SELF_DIR/templates"
DEFAULT_REMOTE_ROOT="/u1/topprod"

TARGET="${INIT_PROJECT_TARGET:-}"
PORT=""; KEY=""; REMOTE_ROOT=""; MODULES=""
DEST=""; BRANCH="main"; FROM_ENC=""
DRY_RUN=0; UPDATE=0; DELETE=0; FORCE=0; ASSUME_YES=0; PROTO=0; ASK_PASSWORD=0
COMMIT=1; LEGACY=0; SAMPLES=6; VERBOSE=0; FORCE_TEMPLATES=0; PRINT_REMOTE=0
SSH_BIN="${INIT_PROJECT_SSH:-ssh}"
RSYNC_BIN="${INIT_PROJECT_RSYNC:-rsync}"
# 测试缝隙：把"远端"换成本地目录（离线自测用），不走 ssh
RSYNC_SRC_OVERRIDE="${INIT_PROJECT_RSYNC_SRC:-}"
[ -n "${INIT_PROJECT_SSH:-}" ] && TEST_SSH=1 || TEST_SSH=0

if [ -t 1 ]; then C_OK=$'\033[32m'; C_WARN=$'\033[33m'; C_ERR=$'\033[31m'; C_DIM=$'\033[2m'; C_0=$'\033[0m'
else C_OK=""; C_WARN=""; C_ERR=""; C_DIM=""; C_0=""; fi
info()  { printf '%s==>%s %s\n' "$C_OK" "$C_0" "$*"; }
warn()  { printf '%s[警告]%s %s\n' "$C_WARN" "$C_0" "$*" >&2; }
die()   { printf '%s[错误]%s %s\n' "$C_ERR" "$C_0" "$*" >&2; exit 1; }
dim()   { printf '%s    %s%s\n' "$C_DIM" "$*" "$C_0"; }
# prog 阶段 信息 [done] [total]：默认人类可读；--progress-protocol 时输出机器协议
prog() {
  local phase=$1 detail=$2 done=${3:-} total=${4:-}
  if [ "$PROTO" = 1 ]; then
    if [ -n "$done" ] && [ -n "$total" ]; then printf '进度\t%s\t%s\t%s\t%s\n' "$phase" "$detail" "$done" "$total" >&2
    else printf '进度\t%s\t%s\n' "$phase" "$detail" >&2; fi
  else
    if [ -n "$done" ] && [ -n "$total" ]; then printf '[%s] %s (%s/%s)\n' "$phase" "$detail" "$done" "$total" >&2
    else printf '[%s] %s\n' "$phase" "$detail" >&2; fi
  fi
}

usage() {
  cat <<'USAGE'
用法: init-project.sh [选项]        # 本地/WSL/Linux 直接执行（也可从 VSCode 命令面板调用）

连接（缺了就交互询问；只支持 SSH 密钥/agent）:
  -t, --target <user@host | ~/.ssh/config 别名>
  -p, --port <n>  -k, --key <私钥>        --legacy-ssh（老服务器 ssh-rsa/SHA-1）

取数（远端只读）:
  -r, --remote-root </u1/topprod>   生产根（默认 /u1/topprod）
  -m, --module <a,b>                只取远根下这些顶层目录（默认 tiptop,topcust；其它目录不管）
      --print-remote                打印将在服务器上执行的**只读**命令（审计）

本地与 git:
  -d, --dest <目录>                 目标目录（默认 ~/projects/<远根名>）
      --update                      目标已存在时增量更新（rsync 覆盖）
      --delete                      同时删除本地多余的同后缀文件（默认不删；会先列出再确认）
      --force                       目标非空也继续（危险）
      --branch <名>                 默认 main
      --no-commit / --force-templates

编码 / 其他:
      --from-encoding <gbk|big5|euc-cn|utf-8>   跳过样本检测与询问
      --dry-run  -y/--yes  --samples <n>  -v/--verbose  -h/--help
      --progress-protocol               进度按 `进度\t阶段\t信息` 输出（给调用方解析；终端里默认是可读格式）
      --ask-password                    允许用密码登录（没配密钥时；每步会提示输入密码，不保存）
                                        默认：密钥失败且在终端里会询问"是否改用密码登录"

注意：只有本初始化脚本允许密码登录（本阶段）；上传/编译**仍然只支持 SSH 密钥**。
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    -t|--target) TARGET=${2:-}; shift 2 ;;
    -p|--port) PORT=${2:-}; shift 2 ;;
    -k|--key) KEY=${2:-}; shift 2 ;;
    --legacy-ssh) LEGACY=1; shift ;;
    -r|--remote-root) REMOTE_ROOT=${2:-}; shift 2 ;;
    -m|--module) MODULES=${2:-}; shift 2 ;;
    -d|--dest) DEST=${2:-}; shift 2 ;;
    --branch) BRANCH=${2:-}; shift 2 ;;
    --from-encoding) FROM_ENC=${2:-}; shift 2 ;;
    --update) UPDATE=1; shift ;;
    --delete) DELETE=1; shift ;;
    --force) FORCE=1; shift ;;
    --no-commit) COMMIT=0; shift ;;
    --force-templates) FORCE_TEMPLATES=1; shift ;;
    --print-remote) PRINT_REMOTE=1; shift ;;
    --progress-protocol) PROTO=1; shift ;;
    --ask-password) ASK_PASSWORD=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -y|--yes) ASSUME_YES=1; shift ;;
    --samples) SAMPLES=${2:-6}; shift 2 ;;
    -v|--verbose) VERBOSE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "未知参数：${1}（用 -h 看帮助）" ;;
  esac
done

need() { command -v "$1" >/dev/null 2>&1 || die "缺少命令 $1"; }
need ssh; need git; need iconv; need awk; need sed; need python3; need base64
command -v "$RSYNC_BIN" >/dev/null 2>&1 || die "本机缺少 rsync（WSL: sudo apt install rsync）"

# 默认只取远根下的 tiptop 与 topcust（其余顶层目录不管）；-m/--module 可覆盖
[ -n "$MODULES" ] || MODULES="tiptop,topcust"

ask() {
  local prompt=$1 def=${2:-} ans
  if [ -n "$def" ]; then read -r -p "$prompt [$def]: " ans || true; printf '%s' "${ans:-$def}"
  else read -r -p "$prompt: " ans || true; printf '%s' "$ans"; fi
}
[ -n "$TARGET" ] || TARGET=$(ask "SSH 目标（user@host 或 ~/.ssh/config 别名）")
[ -n "$TARGET" ] || die "必须给 --target"
[ -n "$REMOTE_ROOT" ] || REMOTE_ROOT=$(ask "生产根目录" "$DEFAULT_REMOTE_ROOT")
[ -n "$REMOTE_ROOT" ] || die "必须给 --remote-root"
[ -n "$DEST" ] || DEST="$HOME/projects/$(basename "${REMOTE_ROOT%/}")"
PROJECT_NAME=$(basename "${DEST%/}")

confirm() {
  [ "$ASSUME_YES" = 1 ] && return 0
  local ans; read -r -p "$1 [y/N]: " ans || true
  case "${ans:-}" in y|Y|yes|YES) return 0 ;; *) return 1 ;; esac
}

# ── ssh（只用来跑只读命令）
# 注意：INIT_PROJECT_SSH 只替换 ssh 可执行文件（测试缝隙），**不影响**选项构造；
# 这样"未配密钥 → 密码登录"的回退逻辑在自测里也能被覆盖。
SSH_OPTS=()
[ -n "$PORT" ] && SSH_OPTS+=(-p "$PORT")
[ -n "$KEY" ] && SSH_OPTS+=(-i "$KEY")
SSH_OPTS+=(-o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new)
LEGACY_OPTS=(-o HostkeyAlgorithms=+ssh-rsa -o PubkeyAcceptedAlgorithms=+ssh-rsa
             -o KexAlgorithms=+diffie-hellman-group14-sha1,diffie-hellman-group1-sha1
             -o MACs=+hmac-sha1)
ssh_run() { "$SSH_BIN" "${SSH_OPTS[@]}" "$TARGET" "$1"; }

# 关掉 BatchMode，改成"密码优先"的交互登录（密码由 ssh 自己提示，不经过本脚本、不落盘）
enable_password_mode() {
  local out=() i=0 n=${#SSH_OPTS[@]}
  while [ $i -lt $n ]; do
    case "${SSH_OPTS[$i]}" in
      -o)
        case "${SSH_OPTS[$((i+1))]:-}" in
          BatchMode=yes|PreferredAuthentications=*) i=$((i+2)); continue ;;
          *) out+=("-o" "${SSH_OPTS[$((i+1))]}"); i=$((i+2));;
        esac ;;
      *) out+=("${SSH_OPTS[$i]}"); i=$((i+1));;
    esac
  done
  SSH_OPTS=("${out[@]}")
  SSH_OPTS+=(-o "PreferredAuthentications=password,keyboard-interactive")
  SSH_OPTS+=(-o "NumberOfPasswordPrompts=3")
}
q() { printf '%q' "$1"; }

# ── 远端只读 find 的公共谓词（q() 已把每个值转义成单个 shell 词）
PRUNE=""
for _n in .git .svn CVS node_modules 42f 4fd bin obj tmp backup bak .project .link .pack out; do
  PRUNE="$PRUNE -name $_n -o"
done
JUNK=""
for _j in '*~' '*.bak' '*.orig' '*.rej' '*.swp' '*.swo' .DS_Store Thumbs.db; do
  JUNK="$JUNK ! -name $(q "$_j")"
done
# 只要这三种：任意目录的 *.global、4gl 目录下的 *.4gl、per 目录下的 *.per
#（所以 42f 之类的产物目录、非 4gl/per 目录里的杂文件都不会进来）
NAME_PRED="\( -name $(q '*.global') -o \( -path $(q '*/4gl/*') -name $(q '*.4gl') \) -o \( -path $(q '*/per/*') -name $(q '*.per') \) \)"
# 顶层目录（-m 指定；已转义）
STARTS=""
_old_ifs=$IFS; IFS=,
for _m in $MODULES; do [ -n "$_m" ] && STARTS="$STARTS $(q "$_m")"; done
IFS=$_old_ifs
unset _n _j _m _old_ifs

# 远端只读 find：$1 = 原样追加的管道，$2 = -print / -print0
#
# 两个坑：
#   1) 只用 -print/-print0。-printf 是 GNU 扩展，有些站点的 find 不支持，
#      一不支持就"静默 0 个文件"（错误只进 stderr，管道照常返回）。
#   2) 每个顶层目录单独 find：缺一个目录（比如没有 topcust）不会让整条 find
#      以非 0 退出，也不会把 "No such file or directory" 混进结果。
remote_find() {
  local suffix=${1:-} pflag=${2:--print}
  # cd 必须在管道外：管道右侧（xargs/while read）用的是父 shell 的工作目录，
  # 相对路径才找得到文件。
  printf 'cd %s || exit 0; { for d in %s; do [ -d $d ] || continue; find $d \( %s -false \) -prune -o -type f %s %s %s; done; }%s' \
    "$(q "$REMOTE_ROOT")" "$STARTS" "$PRUNE" "$JUNK" "$NAME_PRED" "$pflag" "$suffix"
}
# 只回两个纯数字：先个数、后字节数（本地按行解析）。
# 用 wc -c 累加而不是 stat -c%s：macOS 的 stat 不认 -c。
r_cmd_stats() {
  remote_find " | xargs -0 wc -c | awk '{if (\$2!=\"total\") {n++; s+=\$1}} END{print n; print s}'" "-print0"
}
# 环境体检：根目录在不在、要取的顶层目录缺哪个、远根下到底有什么（永远 exit 0）
r_cmd_env() {
  printf '{ cd %s || { echo NOROOT; exit 0; }; for d in %s; do [ -d $d ] || echo MISSING:$d; done; echo LIST:$(ls -1 | head -40 | tr "\\n" ","); }' \
    "$(q "$REMOTE_ROOT")" "$STARTS"
}
r_cmd_sample() {
  remote_find " | sed 's|^[.]/||' | head -n $SAMPLES | while IFS= read -r f; do printf 'FILE %s\\n' \"\$f\"; head -c 4096 \"\$f\" | base64 | tr -d '\\n'; printf '\\nEND\\n'; done"
}
# 匹配数为 0 时才跑（只读）：源文件按扩展名统计 + .4gl/.per 样例 + 顶层目录两级结构。
# 提示语用 ASCII：远端回传的 UTF-8 中文在 GBK 控制台上会显示成乱码。
r_cmd_probe() {
  printf '{ cd %s || exit 0; echo "== ext histogram"; find . \\( %s -false \\) -prune -o -type f %s \\( -name %s -o -name %s -o -name %s \\) -print | sed "s/.*[.]//" | sort | uniq -c | head -10; echo "== 4gl samples"; find . \\( %s -false \\) -prune -o -type f %s -name %s -print | sed "s|^[.]/||" | head -5; echo "== per samples"; find . \\( %s -false \\) -prune -o -type f %s -name %s -print | sed "s|^[.]/||" | head -3; for d in %s; do [ -d $d ] || continue; echo "== dirs under $d"; find $d -maxdepth 2 -type d | head -10; done; }' \
    "$(q "$REMOTE_ROOT")" \
    "$PRUNE" "$JUNK" "$(q '*.4gl')" "$(q '*.per')" "$(q '*.global')" \
    "$PRUNE" "$JUNK" "$(q '*.4gl')" \
    "$PRUNE" "$JUNK" "$(q '*.per')" \
    "$STARTS"
}

print_remote_commands() {
  echo "将在服务器上执行的命令（除 rsync 拉取外都是只读 find；rsync 方向是 pull，远端不写）："
  echo "  1) $(r_cmd_env)"
  echo "  2) $(r_cmd_stats)"
  echo "  3) $(r_cmd_sample)"
  echo "  4) $(r_cmd_probe)   # 仅当匹配数为 0"
  echo "  5) $RSYNC_BIN ${RSYNC_FILTER_DISPLAY} -e 'ssh (连接参数)' $TARGET:$REMOTE_ROOT/ \"$DEST/\""
  echo "  （没有其它命令；不写文件、不上传、不部署）"
}
# 审计显示用：把 -m 指定的顶层目录也带上（和实际 RSYNC_ARGS 同一份来源）
RSYNC_FILTER_DISPLAY='-a -m … -f"- .git/" -f"- .project/" …'
for _m in $(printf '%s' "$MODULES" | tr ',' ' '); do
  [ -n "$_m" ] && RSYNC_FILTER_DISPLAY="$RSYNC_FILTER_DISPLAY -f\"+ /$_m/\""
done
RSYNC_FILTER_DISPLAY="$RSYNC_FILTER_DISPLAY -f\"- /*\" -f\"+ */\" -f\"+ *.global\" -f\"+ **/4gl/*.4gl\" -f\"+ **/per/*.per\" -f\"- *\""
unset _m

if [ "$PRINT_REMOTE" = 1 ]; then print_remote_commands; exit 0; fi

# ── 1) 连通性（老服务器自动 legacy 重试）
prog "连接" "连接 ${TARGET}（远端只读）"
if [ "$TEST_SSH" = 0 ] || [ "${INIT_TEST_PROBE:-0}" = 1 ]; then
  info "连接 $TARGET …（先试密钥）"
  if ! ssh_run true 2>/dev/null; then
    if [ "$LEGACY" != 1 ]; then
      warn "默认算法连不上，按老服务器（OpenSSH 5.x）兼容参数重试…"
      SSH_OPTS+=("${LEGACY_OPTS[@]}"); LEGACY=1
    fi
    if ! ssh_run true 2>/dev/null; then
      ask_ok=0
      if [ "$ASK_PASSWORD" = 1 ]; then ask_ok=1
      elif [ -t 0 ] && confirm "密钥登录失败。改用密码登录？（只有本初始化脚本允许；上传/编译仍需密钥）"; then ask_ok=1; fi
      [ "$ask_ok" = 1 ] || die "连接失败：没有可用密钥（先配好密钥/agent），或加 --ask-password 用密码登录"
      enable_password_mode
      ASK_PASSWORD=1
      warn "已改用密码登录：接下来每一步远端操作都会提示输入密码（密码只交给 ssh，不保存、不写入日志）"
      [ "$LEGACY" = 1 ] && SSH_OPTS+=("${LEGACY_OPTS[@]}")
      ssh_run true || die "密码登录也失败：确认账号/密码，或该服务器是否允许密码认证（PasswordAuthentication yes）"
    fi
  fi
  [ "$LEGACY" = 1 ] && warn "已启用 ssh-rsa/SHA-1 兼容（老服务器）"
  [ "$ASK_PASSWORD" = 1 ] && warn "密码登录模式：每次远端调用会提示输入密码（不会保存）"
fi

# ── 2) 远端只读预检
prog "预检" "统计源文件（只读 find）"
[ "$VERBOSE" = 1 ] && print_remote_commands
# 环境体检：根目录在不在、要取的顶层目录缺哪个、远根下到底有什么
ENV_OUT=$(ssh_run "$(r_cmd_env)") || ENV_OUT=""
TOP_DIRS=""
while IFS= read -r line; do
  case "$line" in
    NOROOT) die "远端没有这个目录：${REMOTE_ROOT}（确认 --remote-root；若该账号登录后先选区，确认区号与目录前缀）" ;;
    MISSING:*) warn "远根下没有顶层目录 ${line#MISSING:}，已跳过（默认取 ${MODULES}，可用 -m 覆盖）" ;;
    LIST:*) TOP_DIRS=${line#LIST:} ;;
  esac
done <<EOF
$ENV_OUT
EOF
[ -n "$TOP_DIRS" ] && dim "远根下的顶层目录：$TOP_DIRS"
STATS=$(ssh_run "$(r_cmd_stats)") || die "远端预检失败"
# 远端只回两个纯数字：先个数、后字节数
FILES=$(printf '%s\n' "$STATS" | sed -n '1p' | tr -cd '0-9')
BYTES=$(printf '%s\n' "$STATS" | sed -n '2p' | tr -cd '0-9')
if [ "${FILES:-0}" -le 0 ]; then
  info "探查远端结构（只读）…"
  ssh_run "$(r_cmd_probe)" 2>/dev/null | sed 's/^/    /' || true
  die "没有匹配到源文件：只看 */4gl/*.4gl、*/per/*.per、任意目录的 *.global（${MODULES} 下）；对照上面的结构，若源文件不在 4gl/ 或 per/ 目录里，告诉我实际位置"
fi
info "找到 $FILES 个源文件，共 $(awk -v b="${BYTES:-0}" 'BEGIN{printf "%.2f MB", b/1048576}')"

# ── 3) 编码检测（样本只读取样）
TMPDIR_RUN=$(mktemp -d "${TMPDIR:-/tmp}/init-project.XXXXXX")
trap 'rm -rf "$TMPDIR_RUN"' EXIT
ENC="$FROM_ENC"
if [ -z "$ENC" ]; then
  prog "取样" "取 $SAMPLES 个样本检测编码（只读）"
  SAMPLE_OUT=$(ssh_run "$(r_cmd_sample)") || die "取样本失败"
  mkdir -p "$TMPDIR_RUN/samples"
  n=0; path=""; b64=""
  while IFS= read -r line; do
    case "$line" in
      FILE\ *) path=${line#FILE }; b64=""; n=$((n+1));;
      END)     [ -n "$path" ] && printf '%s' "$b64" | base64 -d > "$TMPDIR_RUN/samples/$n-$(basename "$path")" 2>/dev/null || true; path="";;
      *)       [ -n "$path" ] && b64="$b64$line";;
    esac
  done <<EOF
$SAMPLE_OUT
EOF
  shopt -s nullglob; sample_files=("$TMPDIR_RUN"/samples/*); shopt -u nullglob
  [ ${#sample_files[@]} -gt 0 ] || die "没取到样本文件"
  REPORT=$(python3 "$DETECT_PY" "${sample_files[@]}")
  printf '%s\n' "$REPORT" | sed 's/^/    /'
  GUESS=$(printf '%s\n' "$REPORT" | awk -F'\t' '/^FILE\t/{print $4}' | sort | uniq -c | sort -rn | head -1 | awk '{print $2}')
  if [ "$GUESS" = "utf-8" ]; then info "样本都是合法 UTF-8 → 不转码"; ENC=""
  elif [ "$ASSUME_YES" = 1 ]; then ENC=$GUESS; info "按检测结果使用 ${ENC}（--yes 不询问）"
  else
    echo; echo "源文件不是 UTF-8。请选择源编码（上方 alt 行可对比解码预览）："
    echo "  1) gbk（检测建议：${GUESS}）   2) big5   3) euc-cn   4) 不转码"
    read -r -p "选择 [1]: " pick || true
    case "${pick:-1}" in 1) ENC=gbk;; 2) ENC=big5;; 3) ENC=euc-cn;; 4) ENC="";; *) ENC=$GUESS;; esac
  fi
fi
[ -n "$ENC" ] && info "转码：$ENC → UTF-8（已是 UTF-8 的文件跳过）"

# ── 4) 确认
echo; echo "──────────────────────────────────────────────"
echo " 目标        : $TARGET"
echo " 远根        : $REMOTE_ROOT   范围: ${MODULES}（*.4gl / *.global / *.per；其它顶层目录不取）"
echo " 源文件      : $FILES 个（$(awk -v b="$BYTES" 'BEGIN{printf "%.2f MB", b/1048576}')）"
echo " 本地目标    : $DEST"
echo " 模式        : $([ "$UPDATE" = 1 ] && echo 增量更新 || echo 全新初始化)$([ "$DELETE" = 1 ] && echo '（含删除本地多余）' || echo '（只覆盖，不删）')  分支: $BRANCH"
echo " 编码/行尾   : ${ENC:-不转码} / LF${DRY_RUN:+    [dry-run]}"
echo " 远端动作    : 只读 find + rsync 拉取（pull，不写生产）"
echo "──────────────────────────────────────────────"
if [ "$DRY_RUN" = 1 ]; then info "dry-run：到此为止，未拉取、未写盘"; print_remote_commands; exit 0; fi
confirm "继续？" || { info "已取消"; exit 0; }
if [ -e "$DEST" ] && [ "$UPDATE" != 1 ] && [ "$FORCE" != 1 ]; then
  die "目标已存在：${DEST}（增量更新加 --update；要混着用加 --force，谨慎）"
fi

# ── 5) rsync 拉取
# 规则顺序（先匹配先生效）：
#   1) 垃圾/VCS/产物目录与文件：丢
#   2) 只放进 tiptop / topcust 两个顶层目录，其它顶层条目直接丢（连扫都不扫）
#   3) 目录都放进去（第 2 步已挡掉范围外的），否则无法往下走
#   4) 只要：任意目录的 *.global、4gl 目录下的 *.4gl、per 目录下的 *.per
# -m/--prune-empty-dirs：没有源文件的目录不进文件列表 → 本地不会多出空目录
RSYNC_ARGS=(-a -m --info=progress2
  -f'- .git/' -f'- .svn/' -f'- CVS/' -f'- node_modules/' -f'- 42f/' -f'- 4fd/'
  -f'- bin/' -f'- obj/' -f'- tmp/' -f'- backup/' -f'- bak/' -f'- .project/' -f'- .link/' -f'- .pack/'
  -f'- *~' -f'- *.bak' -f'- *.orig' -f'- *.rej' -f'- *.swp' -f'- *.swo' -f'- .DS_Store' -f'- Thumbs.db')
for m in $(printf '%s' "$MODULES" | tr ',' ' '); do
  [ -n "$m" ] && RSYNC_ARGS+=(-f"+ /$m/")
done
RSYNC_ARGS+=(-f'- /*' -f'+ */'
  -f'+ *.global' -f'+ **/4gl/*.4gl' -f'+ **/per/*.per' -f'- *')
[ "$VERBOSE" = 1 ] && RSYNC_ARGS+=(-v)

if [ -n "$RSYNC_SRC_OVERRIDE" ]; then
  SRC="$RSYNC_SRC_OVERRIDE/"          # 测试缝隙：本地目录当远端
else
  SSH_CMD="$SSH_BIN"
  for o in "${SSH_OPTS[@]}"; do SSH_CMD="$SSH_CMD $(q "$o")"; done
  SRC="$TARGET:$REMOTE_ROOT/"
fi
mkdir -p "$DEST"

if [ "$DELETE" = 1 ]; then
  info "先列出将被删除的本地多余文件（--delete 预演）…"
  # 不用 mapfile/readarray：macOS 自带的 bash 3.2 没有（readarray 是 bash 4.0+）。
  DELETE_ARGS=("${RSYNC_ARGS[@]}" --dry-run --delete -i)
  [ -n "$RSYNC_SRC_OVERRIDE" ] || DELETE_ARGS+=(-e "$SSH_CMD")
  WOULD_DELETE=()
  while IFS= read -r entry; do WOULD_DELETE+=("$entry"); done \
    < <("$RSYNC_BIN" "${DELETE_ARGS[@]}" "$SRC" "$DEST/" | awk '/^\*deleting/{print $2}')
  if [ ${#WOULD_DELETE[@]} -gt 0 ]; then
    info "发现 ${#WOULD_DELETE[@]} 个本地多余文件（需要你确认后才删除）"
    printf '  %s\n' "${WOULD_DELETE[@]:0:20}"
    if [ ${#WOULD_DELETE[@]} -gt 20 ]; then dim "… 共 ${#WOULD_DELETE[@]} 个"; fi
    if confirm "确认删除这 ${#WOULD_DELETE[@]} 个本地文件？"; then
      RSYNC_ARGS+=(--delete)
    else
      warn "已改为不删（本地多余文件保留）"
    fi
  else
    info "没有需要删除的本地多余文件"
  fi
fi

prog "拉取" "rsync 拉取（生产侧只读）"
if [ -n "$RSYNC_SRC_OVERRIDE" ]; then
  "$RSYNC_BIN" "${RSYNC_ARGS[@]}" "$SRC" "$DEST/"
else
  "$RSYNC_BIN" "${RSYNC_ARGS[@]}" -e "$SSH_CMD" "$SRC" "$DEST/"
fi
GOT=$(find "$DEST" -type f \( -name '*.4gl' -o -name '*.global' -o -name '*.per' \) | wc -l | tr -d ' ')
[ "$GOT" = "$FILES" ] || warn "本地 $GOT 个源文件与预检 $FILES 不一致（本地原有文件未删时属正常）"
info "本地现有 $GOT 个源文件"

# ── 6) 规范化：行尾 + 编码（本地做）
SRC_PRED=(-name '*.4gl' -o -name '*.global' -o -name '*.per')
# 同上：read 循环代替 mapfile；空数组在 set -u + bash 3.2 下展开要加 ${arr[@]+...} 保护
SRC_FILES=()
while IFS= read -r src_file; do SRC_FILES+=("$src_file"); done \
  < <(find "$DEST" -type f \( "${SRC_PRED[@]}" \) -print)
prog "规范化" "转码/行尾（${#SRC_FILES[@]} 个源文件）"
conv=0; skip=0; crlf=0
for f in ${SRC_FILES[@]+"${SRC_FILES[@]}"}; do
  # 不用 sed -i：macOS 的 BSD sed 要求 -i 带参数（sed -i '' ...），Linux 又不接受空参数
  if LC_ALL=C grep -q $'\r' "$f" 2>/dev/null; then
    tr -d '\r' < "$f" > "$f.crtmp" && mv "$f.crtmp" "$f"
    crlf=$((crlf+1))
  fi
  [ -z "$ENC" ] && continue
  if iconv -f UTF-8 -t UTF-8 "$f" >/dev/null 2>&1; then skip=$((skip+1)); continue; fi
  tmp="$f.utf8tmp"
  if iconv -f "$ENC" -t UTF-8 "$f" > "$tmp" 2>/dev/null; then mv "$tmp" "$f"; conv=$((conv+1))
  else rm -f "$tmp"; warn "转码失败（按 ${ENC}）：$f"; fi
done
dim "行尾转换 $crlf 个；转码 $conv 个；本来就是 UTF-8 跳过 $skip 个"

# ── 7) git + 模板 + 换行设置
git_init() {
  git -C "$DEST" rev-parse --git-dir >/dev/null 2>&1 && return 0
  git init -q -b "$BRANCH" "$DEST" 2>/dev/null && return 0
  git init -q "$DEST"; git -C "$DEST" symbolic-ref HEAD "refs/heads/$BRANCH"
}
git_init
prog "模板" "写模板与换行设置"
esc() { printf '%s' "$1" | sed -e 's/[\\&|]/\\&/g'; }
write_tpl() {
  local tpl=$1 out=$2
  if [ -e "$out" ] && [ "$FORCE_TEMPLATES" != 1 ]; then dim "已存在，保留：${out#"$DEST"/}"; return 0; fi
  cp "$tpl" "$out"
}
write_tpl "$TPL_DIR/gitignore" "$DEST/.gitignore"
write_tpl "$TPL_DIR/gitattributes" "$DEST/.gitattributes"
write_tpl "$TPL_DIR/editorconfig" "$DEST/.editorconfig"
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
  dim "写入 README-PROJECT.md"
else
  dim "README-PROJECT.md 已存在，保留"
fi
# 换行：仓库级配置，防止 Windows 侧 autocrlf 改动
git -C "$DEST" config core.autocrlf false
git -C "$DEST" config core.eol lf
git -C "$DEST" config core.safecrlf warn
dim "已设 core.autocrlf=false / core.eol=lf / core.safecrlf=warn"

# ── 8) 提交 + 校验
if [ "$COMMIT" = 1 ]; then
  prog "提交" "git add/commit"
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

prog "完成" "初始化完成"
echo
info "完成：$DEST"
dim "文件：$(git -C "$DEST" ls-files | wc -l | tr -d ' ') 个已入库；分支 $(git -C "$DEST" rev-parse --abbrev-ref HEAD)"
# 只看 crlf：i/none 表示整个文件没有换行符（或 git 当二进制处理），不是行尾问题
EOL_BAD=$(git -C "$DEST" ls-files --eol | awk '$1=="i/crlf" || $2=="w/crlf"' | head -5)
if [ -n "$EOL_BAD" ]; then warn "以下文件仍是 CRLF（应为 LF，检查 .gitattributes / core.autocrlf）："; printf '%s\n' "$EOL_BAD" | sed 's/^/    /'
else info "换行校验通过：没有 CRLF 文件"; fi
git -C "$DEST" diff --check >/dev/null 2>&1 || warn "git diff --check 有空白告警（看 git diff --check）"
cat <<NEXT

下一步：
  1) cd "$DEST" && git log --oneline -1
  2) 复制 .vscode/settings.example.json → .vscode/settings.json，填 Oracle/生产服务器
  3) tiptop link sync / schema sync 采集资料（写入 .project/，不进库。由你自己执行）
  4) 更新：$(basename "$0") --target '$TARGET' --remote-root '$REMOTE_ROOT' --dest "$DEST" --update
NEXT
