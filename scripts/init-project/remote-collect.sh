#!/bin/sh
# remote-collect.sh —— 在**源服务器**（如 RedHat 6.5）上执行：只读预检 / 取编码样本 / 流式打包。
#
# 不要直接在服务器上跑；它由 init-project.sh 经
#   ssh <target> "sh -s -- <子命令> --root <远根> …" < remote-collect.sh
# 送过去，用 `sh -s` 是为了绕开登录 shell 可能是 csh/ksh 的兼容问题。
#
# 子命令：
#   stats  —— 打印 FILES / BYTES / MODULES（只读预检）
#   sample —— 最多打印 <count> 个源文件的前 4KB（base64），供本地判编码
#   pack   —— 把选中的源文件用 tar.gz 流式写到 stdout（只含源文件，不含目录）
#
# 选择规则：默认取 *.4gl / *.global / *.per；--module 限定顶层模组；
#           --include 可改文件 glob（可多次）。.git/42f/4fd/bin/obj/tmp/backup 等一律跳过。
set -eu

cmd=""
[ $# -gt 0 ] && { cmd=$1; shift; }
root=""; mods=""; includes=""; count=6
while [ $# -gt 0 ]; do
  case "$1" in
    --root) root=$2; shift 2 ;;
    --module) mods="$mods $2"; shift 2 ;;
    --include) includes="$includes $2"; shift 2 ;;
    --count) count=$2; shift 2 ;;
    *) echo "remote-collect: 未知参数 $1" >&2; exit 2 ;;
  esac
done
[ -n "$root" ] || { echo "remote-collect: 缺少 --root" >&2; exit 2; }
[ -d "$root" ] || { echo "remote-collect: 远根不存在或不可读：$root" >&2; exit 3; }

# 要跳过的目录名（任意深度）与垃圾文件
PRUNE_NAMES=".git .svn CVS node_modules 42f 4fd bin obj tmp backup bak .project .link"
JUNK_NAMES='*~ *.bak *.orig *.rej *.swp *.swo .DS_Store Thumbs.db'

# find_files：输出**相对 <root> 的路径**（tar -C 依赖它，否则会打成绝对路径）
find_files() {
  find_files_raw | awk -v r="$root/" 'index($0, r) == 1 { print substr($0, length(r) + 1) }'
}

find_files_raw() {
  if [ -n "$mods" ]; then
    for m in $mods; do
      [ -d "$root/$m" ] || { echo "remote-collect: 模组不存在：$root/$m" >&2; exit 3; }
      find_files_one "$root/$m"
    done
  else
    find_files_one "$root"
  fi
}

find_files_one() {
  base=$1
  prune=""
  for n in $PRUNE_NAMES; do prune="$prune -name $n -o"; done
  junk=""
  for j in $JUNK_NAMES; do junk="$junk ! -name $j"; done
  if [ -n "$includes" ]; then
    # 自定义 glob：逐个 find 再 sort -u（避免把引号当字面量传给 find）
    for g in $includes; do
      # shellcheck disable=SC2086
      find "$base" \( $prune -false \) -prune -o -type f $junk -name "$g" -print
    done | sort -u
  else
    # shellcheck disable=SC2086
    find "$base" \( $prune -false \) -prune -o -type f $junk \
      \( -name '*.4gl' -o -name '*.global' -o -name '*.per' \) -print
  fi
}

case "$cmd" in
  stats)
    files=$(find_files | wc -l | tr -d ' ')
    bytes=$(find_files | while IFS= read -r f; do
              # GNU coreutils/stat 在 RH6.5 都有；优先 stat 更省内存
              stat -c %s "$f" 2>/dev/null || wc -c < "$f"
            done | awk '{s+=$1} END{printf "%d", s+0}')
    printf 'FILES %s\n' "$files"
    printf 'BYTES %s\n' "$bytes"
    printf 'MODULES %s\n' "$(cd "$root" && ls -1 2>/dev/null | head -40 | tr '\n' ',' | sed 's/,$//')"
    ;;
  sample)
    find_files | head -n "$count" | while IFS= read -r f; do
      rel=${f#"$root"/}
      printf 'FILE %s\n' "$rel"
      head -c 4096 "$f" 2>/dev/null | base64 | tr -d '\n'
      printf '\nEND\n'
    done
    ;;
  pack)
    tmplist=$(mktemp "${TMPDIR:-/tmp}/init-project-list.XXXXXX") || exit 4
    trap 'rm -f "$tmplist"' EXIT
    find_files > "$tmplist"
    [ -s "$tmplist" ] || { echo "remote-collect: 没有匹配到任何文件" >&2; exit 5; }
    # 只打包清单里的文件（-T），不带目录、不带其它产物
    tar czf - -C "$root" -T "$tmplist"
    ;;
  ""|-h|--help)
    sed -n '2,20p' "$0"
    ;;
  *)
    echo "remote-collect: 未知子命令 $cmd" >&2; exit 2 ;;
esac
