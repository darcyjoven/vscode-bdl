# init-project.ps1 —— 从生产服务器（Linux，如 RedHat 6.5 + TiTop）初始化/更新 4GL 仓库（Windows）。
#
# ★ 只在**本地 Windows** 执行（绝不在生产服务器上运行本脚本）。
# ★ 服务器侧：只读 find 预检/取样 + 一次 tar 打包（写到 /u1/out，用完即删）；
#    不修改项目树、不调用上传/部署。
#
# 取数范围：<远根>（默认 /u1/topprod，可改）下 **只取 tiptop、topcust 两个顶层目录** 的
#           *.4gl / *.global / *.per；其它顶层目录不管。用 -Module a,b 可覆盖这两个目录名。
#           远端没有源文件的目录不会同步到本地（只把文件列进 tar，不写目录项）。
#
# 流程：预检 → 取样本（判编码）→ 生产端 tar 打包（/u1/out）→ scp 回本地（<Dest>\.pack）
#       → 解压 → 转码/行尾 → git 初始化与提交 → 清理两端中间文件（失败也清）
#
# 登录区域：有些生产账号登录后由 login shell 先问"区"（1/2/3/4，默认 1），
#   这时非交互 ssh 会把命令当成没人回答的菜单 → 什么也取不到。
#   -Region 1..9 会在每条 ssh/scp 连接建立后先把这一行喂给远端菜单；
#   -Region ""（空）＝ 不喂（没有这种菜单的服务器，保持老行为）。
#
# 进度：按 tiptop 同款协议把 `进度<TAB>阶段<TAB>信息[<TAB>i<TAB>n]` 写到 stderr，
#       VSCode 命令据此显示通知栏进度。
[CmdletBinding()]
param(
  [string]$Target = $env:INIT_PROJECT_TARGET,
  [string]$RemoteRoot = "/u1/topprod",
  [string]$Region = "1",
  [string]$Dest = "",
  [string]$Module = "",
  [int]$Port = 0,
  [string]$Key = "",
  [string]$FromEncoding = "",
  [string]$Branch = "main",
  [string]$RemoteTmpDir = "/u1/out",
  [int]$Samples = 6,
  [switch]$Update,
  [switch]$Delete,
  [switch]$Force,
  [switch]$NoCommit,
  [switch]$ForceTemplates,
  [switch]$PrintRemote,
  [switch]$DryRun,
  [switch]$Yes,
  [switch]$LegacySsh,
  [switch]$ProgressProtocol,
  [switch]$AskPassword
)
$ErrorActionPreference = "Stop"
$SelfDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$TplDir = Join-Path $SelfDir "templates"
# 默认只取远根下的 tiptop 与 topcust（其余顶层目录不管）；-Module 可覆盖
if (-not $Module) { $Module = "tiptop,topcust" }

function Info($m) { [Console]::Error.WriteLine("==> $m") }
function Warn2($m) { [Console]::Error.WriteLine("[警告] $m") }
function Dim2($m) { [Console]::Error.WriteLine("    $m") }
function Die($m) { [Console]::Error.WriteLine("[错误] $m"); exit 1 }
function Progress2([string]$phase, [string]$detail, [int]$done = -1, [int]$total = -1) {
  if ($ProgressProtocol) {
    if ($done -ge 0 -and $total -gt 0) { [Console]::Error.WriteLine("进度`t$phase`t$detail`t$done`t$total") }
    else { [Console]::Error.WriteLine("进度`t$phase`t$detail") }
  } else {
    if ($done -ge 0 -and $total -gt 0) { [Console]::Error.WriteLine("[$phase] $detail ($done/$total)") }
    else { [Console]::Error.WriteLine("[$phase] $detail") }
  }
}
function Confirm2([string]$q) {
  if ($Yes) { return $true }
  $a = Read-Host "$q [y/N]"
  return ($a -eq "y" -or $a -eq "Y" -or $a -eq "yes")
}

# 兼容 .NET Core 下的 GBK/BIG5 代码页
try { [System.Text.Encoding]::RegisterProvider([System.Text.CodePagesEncodingProvider]::Instance) } catch { }

foreach ($c in @("ssh", "scp", "tar", "git")) {
  if (-not (Get-Command $c -ErrorAction SilentlyContinue)) { Die "缺少命令 $c（Windows 10+ 自带 ssh/scp/tar）" }
}

if (-not $Target) { $Target = Read-Host "SSH 目标（user@host 或 ~/.ssh/config 别名）" }
if (-not $Target) { Die "必须给 -Target" }
if ($Region -and $Region -notmatch '^\d$') { Die "-Region 只接受 1-9（如 1/2/3/4）；服务器没有这个菜单就传空字符串" }
# 远端登录菜单要的"区"：末尾补一个 LF（PowerShell 给原生程序还会再补 CRLF），
# 这样远端 `read` 先读到干净的一行（否则会读到 "1\r"，菜单认不出来）。
$regionInput = if ($Region) { "$Region`n" } else { "" }
if (-not $Dest) { $Dest = Join-Path $HOME ("projects\" + (Split-Path -Leaf $RemoteRoot)) }
$ProjectName = Split-Path -Leaf $Dest

# ── ssh/ scp 参数（只支持密钥；老服务器自动 legacy 重试）
$sshExe = if ($env:INIT_PROJECT_SSH) { $env:INIT_PROJECT_SSH } else { "ssh" }
# 注意：INIT_PROJECT_SSH 只替换 ssh 可执行文件（测试缝隙），不影响选项构造
$sshCommon = @()
if ($Port -gt 0) { $sshCommon += @("-p", "$Port") }
if ($Key) { $sshCommon += @("-i", $Key) }
$sshCommon += @("-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "-o", "StrictHostKeyChecking=accept-new")
$legacy = @("-o", "HostkeyAlgorithms=+ssh-rsa", "-o", "PubkeyAcceptedAlgorithms=+ssh-rsa",
            "-o", "KexAlgorithms=+diffie-hellman-group14-sha1,diffie-hellman-group1-sha1", "-o", "MACs=+hmac-sha1")
$sshArgs = $sshCommon
$passwordMode = $false
function Invoke-Remote([string]$cmd) {
  # 有区域就先喂一行给远端登录菜单，再让 ssh 跑命令
  # 抛异常时把命令一起打出来：PowerShell 自己的报错（找不到目录/找不到文件之类）
  # 只说"某个路径"，看不出是哪一步、哪条 ssh，排查很费劲。
  try {
    if ($script:regionInput) { $script:regionInput | & $sshExe @sshArgs $Target $cmd }
    else { & $sshExe @sshArgs $Target $cmd }
  } catch {
    Die "调用 ssh 失败：$($_.Exception.Message)`n  命令：$sshExe $($sshArgs -join ' ') $Target <远端命令>"
  }
}

# 关掉 BatchMode，改成"密码优先"的交互登录（密码由 ssh 自己提示，不保存、不进命令行）
function Enable-PasswordMode {
  $script:sshArgs = @()
  for ($i = 0; $i -lt $sshCommon.Count; $i++) {
    if ($sshCommon[$i] -eq "-o" -and $i + 1 -lt $sshCommon.Count -and $sshCommon[$i + 1] -eq "BatchMode=yes") { $i++; continue }
    $script:sshArgs += $sshCommon[$i]
  }
  $script:sshArgs += @("-o", "PreferredAuthentications=password,keyboard-interactive", "-o", "NumberOfPasswordPrompts=3")
  $script:passwordMode = $true
}

# ── 远端只读 find 的公共谓词
$pruneNames = ".git", ".svn", "CVS", "node_modules", "42f", "4fd", "bin", "obj", "tmp", "backup", "bak", ".project", ".link", ".pack", "out"
$prune = ($pruneNames | ForEach-Object { "-name '$_' -o" }) -join " "
$junk = "! -name '*~' ! -name '*.bak' ! -name '*.orig' ! -name '*.rej' ! -name '*.swp' ! -name '*.swo' ! -name '.DS_Store' ! -name 'Thumbs.db'"
$starts = ($Module -split "," | Where-Object { $_.Trim() } | ForEach-Object { "'" + $_.Trim() + "'" }) -join " "
if (-not $starts) { Die "-Module 为空：给远根下要取的顶层目录名（逗号分隔），例如 tiptop,topcust" }
# 只要这三种：4gl 目录下的 *.4gl、per 目录下的 *.per、任意目录的 *.global
#（所以 42f 之类的产物目录、非 4gl/per 目录里的杂文件都不会进来）
#
# ★ 远端命令里不要用双引号：Windows PowerShell 5.1 → ssh 这条链路上，参数里的 `"`
#   会被整对吃掉（实测 awk 的 print "FILES " n 变成 print FILES n，标签打印成空）。
#   需要引号用单引号；要不带标签，让本地去解析。
$nameFilter = "\( -name '*.global' -o \( -path '*/4gl/*' -name '*.4gl' \) -o \( -path '*/per/*' -name '*.per' \) \)"
function Remote-Find([string]$printFlag = "-print") {
  # 只在**远端确实存在**的顶层目录里 find：某个目录不存在（比如站点没有 topcust）时
  # 整条 find 会以非 0 退出并往 stderr 甩 "No such file or directory"，看着像脚本报错。
  #
  # 只用 -print / -print0：-printf 是 GNU 扩展，有些站点的 find 不支持，
  # 一不支持就是"静默 0 个文件"（错误进了 stderr，统计管道照常返回）。
  "cd '$RemoteRoot' 2>/dev/null || exit 0; set -- `$(for x in $starts; do [ -d `$x ] && echo `$x; done); [ `$# -gt 0 ] || exit 0; find `$@ \( $prune -false \) -prune -o -type f $junk $nameFilter $printFlag"
}
# 大小用 stat 累加（-print0 + xargs -0，文件名带空格也安全），不依赖 find -printf。
# 输出只许是纯数字（第一行文件数、第二行总字节）：awk 程序里带双引号会被
# Windows PowerShell → ssh 这条链路吃掉（"FILES " 变成 FILES，打印出空标签）。
$cmdStats = (Remote-Find "-print0") + " | xargs -0 stat -c%s 2>/dev/null | awk '{n++; b+=`$1} END{print n; print b}'"
# 环境体检：根目录在不在、要取的顶层目录缺哪个、远根下到底有什么。
# 永远 exit 0（只报告，不中断），这样"找不到目录"能在预检阶段说清楚。
$cmdEnv = "cd '$RemoteRoot' 2>/dev/null || { echo NOROOT; exit 0; }; for d in $starts; do [ -d `$d ] || echo 'MISSING:'`$d; done; echo 'LIST:'`$(ls -1 2>/dev/null | head -40 | tr '\n' ',')"
# 匹配数为 0 时才跑（只读）：源文件按扩展名统计 + .4gl/.per 样例 + 模块两级子目录。
# 提示语一律 ASCII：远端回传的 UTF-8 中文会被本地控制台按 GBK 解码，显示成乱码。
$probeFind = "find . \( $prune -false \) -prune -o -type f $junk \( -name '*.4gl' -o -name '*.per' -o -name '*.global' \) -print 2>/dev/null"
$cmdProbe = "cd '$RemoteRoot' 2>/dev/null || exit 0; " +
  "echo '== source files by extension'; $probeFind | sed 's/.*\.//' | sort | uniq -c | head -10; " +
  "echo '== *.4gl samples'; $probeFind | grep '\.4gl`$' | sed 's|^\./||' | head -5; " +
  "echo '== *.per samples'; $probeFind | grep '\.per`$' | sed 's|^\./||' | head -3; " +
  "for d in $starts; do [ -d `$d ] || continue; echo '== dirs under' `$d; find `$d -maxdepth 2 -type d 2>/dev/null | head -10; done"
$cmdSample = (Remote-Find) + " | sed 's|^\./||' | head -n $Samples | while IFS= read -r f; do printf 'FILE %s\n' `$f; head -c 4096 `$f | base64 | tr -d '\n'; printf '\nEND\n'; done"
$unique = "topprod-src-{0}-{1}.tar.gz" -f (Get-Date -Format "yyyyMMdd-HHmmss"), (Get-Random -Maximum 999999)
$remoteTar = "$RemoteTmpDir/$unique"
$cmdPack = "set -e; mkdir -p '$RemoteTmpDir'; " + (Remote-Find) + " | sed 's|^\./||' | tar czf '$remoteTar' -C '$RemoteRoot' -T -; echo '$remoteTar'"

if ($PrintRemote) {
  Info "将在服务器上执行的命令（只读 find + 一次 tar 打包到 $RemoteTmpDir，用完即删）："
  Dim2 "0) 每条 ssh/scp 连接先送一行登录区域：$(if ($Region) { $Region } else { '（不送）' })"
  Dim2 "1) $cmdEnv"
  Dim2 "2) $cmdStats"
  Dim2 "3) $cmdSample"
  Dim2 "4) $cmdPack"
  Dim2 "5) rm -f '$remoteTar'"
  Dim2 "6) 仅当匹配数为 0：$cmdProbe"  Dim2 "（没有其它命令；不改项目树、不上传、不部署）"
  exit 0
}

# ── 1) 连通性
Progress2 "连接" "连接 $Target（远端只读）"
Info "连接 $Target …"
if (-not $env:INIT_PROJECT_SSH) {
  Info "连接 $Target …（先试密钥）"
  Invoke-Remote "true" | Out-Null
  if ($LASTEXITCODE -ne 0) {
    if (-not $LegacySsh) {
      Warn2 "默认算法连不上，按老服务器（OpenSSH 5.x）兼容参数重试…"
      $sshArgs = $sshCommon + $legacy
      Invoke-Remote "true" | Out-Null
    }
    if ($LASTEXITCODE -ne 0) {
      # 没配密钥 / 密钥不可用 → 允许改用密码登录（仅本初始化脚本）
      $askOk = $AskPassword
      if (-not $askOk) { $askOk = Confirm2 "密钥登录失败。改用密码登录？（只有本初始化脚本允许；上传/编译仍需密钥）" }
      if (-not $askOk) { Die "连接失败：没有可用密钥，或加 -AskPassword 用密码登录" }
      Enable-PasswordMode
      if ($LegacySsh) { $script:sshArgs += $legacy }
      Warn2 "已改用密码登录：接下来每一步远端操作都会提示输入密码（只交给 ssh，不保存）"
      if ($Region) { Warn2 "同时要把登录区域（$Region）喂给远端菜单；若密码提示被 stdin 干扰，先配好密钥再跑" }
      Invoke-Remote "true" | Out-Null
      if ($LASTEXITCODE -ne 0) { Die "密码登录也失败：确认账号/密码，或服务器不允许密码认证" }
    }
  }
  if ($LegacySsh) { Warn2 "已启用 ssh-rsa/SHA-1 兼容（老服务器）" }
  if ($passwordMode) { Warn2 "密码登录模式：每次远端调用会提示输入密码（不会保存）" }
}

# ── 2) 远端只读预检
Progress2 "预检" "统计源文件（只读 find）"
Info "远端预检（只读）…"
$topDirs = ""
foreach ($line in (Invoke-Remote $cmdEnv)) {
  if ($line -eq "NOROOT") {
    Die "远端没有这个目录：$RemoteRoot`n  确认 -RemoteRoot；若该账号登录后先选'区'，确认 -Region 与区号匹配（区可能决定目录前缀）"
  } elseif ($line -like "MISSING:*") {
    Warn2 "远根下没有顶层目录 $($line.Substring(8))，已跳过（默认取 $Module，可用 -Module 覆盖）"
  } elseif ($line -like "LIST:*") {
    $topDirs = $line.Substring(5)
  }
}
if ($topDirs) { Dim2 "远根下的顶层目录：$topDirs" }
$stats = Invoke-Remote $cmdStats
if ($LASTEXITCODE -ne 0) { Die "远端预检失败（ssh exit=$LASTEXITCODE）" }
# 远端只回两个纯数字：先个数、后字节数（见 $cmdStats 处的说明）
$nums = @($stats | ForEach-Object { $t = "$_".Trim(); if ($t -match '^\d+$') { [long]$t } })
$FILES = if ($nums.Count -ge 1) { [int]$nums[0] } else { 0 }
$BYTES = if ($nums.Count -ge 2) { [long]$nums[1] } else { 0 }
if ($FILES -le 0) {
  # 一个都没匹配到，多半是目录结构与取数规则不一致（不是网络问题）。
  # 先把统计命令的原始输出打出来（能区分"0 个"和"命令根本没跑通"），再探查远端结构。
  foreach ($line in $stats) { if ("$line".Trim()) { Dim2 "统计输出：$("$line".Trim())" } }
  Info "探查远端结构（只读）…"
  foreach ($line in (Invoke-Remote $cmdProbe)) {
    if ("$line".Trim()) { Dim2 "$line".Trim() }
  }
  Die "没有匹配到源文件：只看 */4gl/*.4gl、*/per/*.per、任意目录的 *.global（$Module 下）`n  对照上面的统计：若 .4gl 不在 4gl/ 目录、.per 不在 per/ 目录里，告诉我实际位置，我改取数规则"
}
$mb = [math]::Round($BYTES / 1MB, 2)
Info "找到 $FILES 个源文件，共 $mb MB"

# ── 3) 编码检测（远端只读取样本；本地 .NET 判定）
$enc = $FromEncoding
if (-not $enc) {
  Progress2 "取样" "取 $Samples 个样本检测编码"
  Info "取 $Samples 个样本检测编码（远端 head/base64，只读）…"
  $sampleOut = Invoke-Remote $cmdSample
  if ($LASTEXITCODE -ne 0) { Die "取样本失败（ssh exit=$LASTEXITCODE）" }
  $candidates = @(936, 950, 54936)
  $votes = @{}
  $idx = 0
  $curPath = ""
  $b64 = ""
  $utf8Strict = New-Object System.Text.UTF8Encoding($false, $true)
  foreach ($line in $sampleOut) {
    if ($line -like "FILE *") { $curPath = $line.Substring(5); $b64 = ""; continue }
    if ($line -eq "END") {
      if ($curPath) {
        $idx++
        try { $bytes = [Convert]::FromBase64String($b64) } catch { $bytes = @() }
        $best = "unknown"; $bestScore = [int]::MinValue; $bestText = ""
        if ($bytes.Length -gt 0) {
          if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) { $bytes = $bytes[3..($bytes.Length-1)] }
          # utf-8 严格
          try { [void]$utf8Strict.GetString($bytes); $best = "utf-8"; $bestScore = 1 } catch { }
          foreach ($cp in $candidates) {
            try {
              $e = [System.Text.Encoding]::GetEncoding($cp, [System.Text.EncoderFallback]::ExceptionFallback, [System.Text.DecoderFallback]::ExceptionFallback)
              $t = $e.GetString($bytes)
              $cjk = 0; $bad = 0
              foreach ($ch in $t.ToCharArray()) {
                $c = [int]$ch
                if ($c -ge 0x4E00 -and $c -le 0x9FFF) { $cjk++ }
                elseif ($ch -eq [char]0xFFFD -or ($c -lt 32 -and $c -ne 9 -and $c -ne 10 -and $c -ne 13)) { $bad++ }
              }
              $sc = $cjk - 5 * $bad
              if ($sc -gt $bestScore) { $best = switch ($cp) { 936 { "gbk" } 950 { "big5" } 54936 { "gb18030" } }; $bestScore = $sc; $bestText = $t }
            } catch { }
          }
        }
        Dim2 "$curPath → $best"
        if ($best -ne "unknown" -and $best -ne "utf-8") {
          if ($votes.ContainsKey($best)) { $votes[$best]++ } else { $votes[$best] = 1 }
        }
        if ($bestScore -gt 0 -and $best -ne "utf-8") {
          $preview = ($bestText -replace "`r", "" -replace "`n", " ")
          if ($preview.Length -gt 80) { $preview = $preview.Substring(0, 80) }
          Dim2 "    预览：$preview"
        }
      }
      $curPath = ""; continue
    }
    if ($curPath) { $b64 += $line.Trim() }
  }
  $guess = ""
  if ($votes.Count -gt 0) { $guess = ($votes.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 1).Key }
  if (-not $guess) {
    Info "样本都是合法 UTF-8 → 不转码"
    $enc = ""
  } elseif ($Yes) {
    $enc = $guess; Info "按检测结果使用 $enc（-Yes 不询问）"
  } else {
    Write-Host "源文件不是 UTF-8。选择源编码：1) gbk（建议：$guess） 2) big5 3) 不转码"
    $pick = Read-Host "选择 [1]"
    $enc = switch ($pick) { "2" { "big5" } "3" { "" } default { $guess } }
  }
}
if ($enc) { Info "转码：$enc → UTF-8（已是 UTF-8 的文件跳过）" }

# ── 4) 确认
Write-Host ""
Info "目标：$Target"
Info "远根：$RemoteRoot   范围：$Module（*.4gl / *.global / *.per；其它顶层目录不取）"
Info "登录区域：$(if ($Region) { "$Region（每条连接建立后先输入这一行）" } else { '不输入（直接登录）' })"
Info "源文件：$FILES 个（$mb MB）"
Info "本地：$Dest   模式：$(if ($Update) { '增量更新' } else { '全新初始化' })$(if ($Delete) { '（含删除本地多余）' } else { '（只覆盖，不删）' })"
Info "编码/行尾：$(if ($enc) { $enc } else { '不转码' }) / LF"
if ($DryRun) { Info "DryRun：到此为止，未打包未写盘"; Progress2 "完成" "dry-run 结束"; exit 0 }
if (-not (Confirm2 "继续？")) { Info "已取消"; exit 0 }
if ((Test-Path $Dest) -and (-not $Update) -and (-not $Force)) {
  Die "目标已存在：$Dest（增量更新加 -Update；要混着用加 -Force，谨慎）"
}

$packDir = Join-Path $Dest ".pack"
$localTar = Join-Path $packDir "src.tar.gz"
$tarPath = ""
$succeeded = $false
try {
  # ── 5) 生产端打包 → scp 回本地（find -type f 只列文件，空目录进不了包 → 本地不会多出空目录）
  Progress2 "打包" "生产端 tar 打包（$RemoteTmpDir）"
  Info "远端打包（唯一写操作：$RemoteTmpDir/$unique）…"
  $packOut = Invoke-Remote $cmdPack
  if ($LASTEXITCODE -ne 0) { Die "生产端打包失败（ssh exit=$LASTEXITCODE）" }
  $tarPath = ($packOut | Where-Object { $_ -like "*$unique*" } | Select-Object -Last 1)
  if (-not $tarPath) { Die "远端没有返回打包路径" }
  $tarPath = $tarPath.Trim()
  New-Item -ItemType Directory -Force -Path $packDir | Out-Null
  Progress2 "传输" "scp 回本地"
  Info "scp 回本地…"
  $scpArgs = @()
  if (-not $env:INIT_PROJECT_SSH) {
    if ($Port -gt 0) { $scpArgs += @("-P", "$Port") }
    if ($Key) { $scpArgs += @("-i", $Key) }
    if ($passwordMode) {
      $scpArgs += @("-o", "ConnectTimeout=15", "-o", "StrictHostKeyChecking=accept-new",
                    "-o", "PreferredAuthentications=password,keyboard-interactive", "-o", "NumberOfPasswordPrompts=3")
    } else {
      $scpArgs += @("-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "-o", "StrictHostKeyChecking=accept-new")
    }
    if ($LegacySsh) { $scpArgs += $legacy }
  }
  if ($regionInput) { $regionInput | & scp @scpArgs "$($Target):$tarPath" $localTar }
  else { & scp @scpArgs "$($Target):$tarPath" $localTar }
  if ($LASTEXITCODE -ne 0) { Die "scp 失败（exit=$LASTEXITCODE）" }

  # ── 6) 解压
  Progress2 "解压" "解压到 $Dest"
  Info "解压…"
  New-Item -ItemType Directory -Force -Path $Dest | Out-Null
  & tar -xzf $localTar -C $Dest
  if ($LASTEXITCODE -ne 0) { Die "解压失败（exit=$LASTEXITCODE）" }

  # 远端清单（用于 -Delete 与统计）
  $listing = & tar -tzf $localTar

  # ── 7) 转码 + 行尾（本地做，字节级，不走文本管道）
  Progress2 "规范化" "转码/行尾"
  $srcFiles = Get-ChildItem -Path $Dest -Recurse -File -Include *.4gl, *.global, *.per |
    Where-Object { $_.FullName -notlike "*\.pack\*" -and $_.FullName -notlike "*\.git\*" }
  # 两件事一起做，且**不管有没有转码都要做行尾**：
  #   - 转码（-FromEncoding / 检测结果，只对非 UTF-8 文件）
  #   - CRLF → LF（所有源文件）
  # 只靠 .gitattributes 的 eol=lf 是不够的：它只让「入库」的内容是 LF，
  # 工作区里的文件照样是 CRLF（git ls-files --eol 会显示 i/lf w/crlf），
  # 而且每次 add 都刷一堆 "CRLF will be replaced by LF" 警告。
  $utf8Strict = New-Object System.Text.UTF8Encoding($false, $true)
  $utf8Out = New-Object System.Text.UTF8Encoding($false)
  $cp = switch ($enc) { "gbk" { 936 } "big5" { 950 } "gb18030" { 54936 } "euc-cn" { 936 } default { 936 } }
  $conv = 0; $skip = 0; $crlf = 0
  foreach ($f in $srcFiles) {
    [byte[]]$b = [IO.File]::ReadAllBytes($f.FullName)
    $isUtf8 = $true
    try { [void]$utf8Strict.GetString($b) } catch { $isUtf8 = $false }
    $changed = $false
    if ($isUtf8) {
      $skip++
    } elseif ($enc) {
      # 转码前去掉 BOM（写回时不带 BOM）；已经 UTF-8 的文件保留原 BOM
      [byte[]]$body = $b
      if ($body.Length -ge 3 -and $body[0] -eq 0xEF -and $body[1] -eq 0xBB -and $body[2] -eq 0xBF) { [byte[]]$body = $body[3..($body.Length - 1)] }
      try {
        $e = [System.Text.Encoding]::GetEncoding($cp, [System.Text.EncoderFallback]::ExceptionFallback, [System.Text.DecoderFallback]::ExceptionFallback)
        [byte[]]$b = $utf8Out.GetBytes($e.GetString($body))
        $conv++; $changed = $true
      } catch {
        Warn2 "转码失败（按 $enc）：$($f.FullName)"
        continue
      }
    }
    # 行尾：CRLF → LF（只删紧跟 LF 的 CR，单独的 CR 不动）
    if ([Array]::IndexOf($b, [byte]13) -ge 0) {
      $keep = New-Object 'System.Collections.Generic.List[byte]'
      for ($i = 0; $i -lt $b.Length; $i++) {
        if ($b[$i] -eq 13 -and ($i + 1 -ge $b.Length -or $b[$i + 1] -eq 10)) { continue }
        $keep.Add($b[$i])
      }
      [byte[]]$b = $keep.ToArray()
      $crlf++; $changed = $true
    }
    if ($changed) { [IO.File]::WriteAllBytes($f.FullName, $b) }
  }
  Dim2 "行尾 CRLF→LF $crlf 个；转码 $conv 个；本来就是 UTF-8 跳过 $skip 个"

  # ── 8) 删除本地多余（仅 -Delete；默认只覆盖不删）
  if ($Delete) {
    Progress2 "删除" "检查本地多余文件"
    $inScope = @{}
    foreach ($rel in $listing) { if ($rel -match '\.(4gl|global|per)$') { $inScope[$rel] = $true } }
    $stale = @()
    foreach ($f in $srcFiles) {
      $rel = $f.FullName.Substring($Dest.Length + 1).Replace("\", "/")
      if (-not $inScope.ContainsKey($rel)) { $stale += $rel }
    }
    if ($stale.Count -gt 0) {
      $stale | Select-Object -First 20 | ForEach-Object { Dim2 $_ }
      if (Confirm2 "删除这 $($stale.Count) 个本地多余源文件？") {
        foreach ($rel in $stale) { Remove-Item -Force (Join-Path $Dest ($rel -replace "/", "\")) }
        Info "已删除 $($stale.Count) 个本地遗留源文件"
      } else { Warn2 "保留这些本地文件" }
    } else { Info "没有本地多余文件" }
  }

  # ── 9) git + 模板 + 换行设置
  Progress2 "模板" "写模板与换行设置"
  if (-not (Test-Path (Join-Path $Dest ".git"))) {
    & git -C $Dest init -q -b $Branch
    if ($LASTEXITCODE -ne 0) { & git -C $Dest init -q; & git -C $Dest symbolic-ref HEAD "refs/heads/$Branch" }
  }
  function Write-Tpl([string]$name, [string]$rel) {
    $out = Join-Path $Dest $rel
    if ((Test-Path $out) -and (-not $ForceTemplates)) { Dim2 "已存在，保留：$rel"; return }
    $parent = Split-Path -Parent $out
    if ($parent -and -not (Test-Path $parent)) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
    Copy-Item (Join-Path $TplDir $name) $out -Force
  }
  Write-Tpl "gitignore" ".gitignore"
  Write-Tpl "gitattributes" ".gitattributes"
  Write-Tpl "editorconfig" ".editorconfig"
  Write-Tpl "settings.example.json" ".vscode\settings.example.json"
  $readmePath = Join-Path $Dest "README-PROJECT.md"
  if (-not (Test-Path $readmePath)) {
    $tpl = [IO.File]::ReadAllText((Join-Path $TplDir "README-PROJECT.md"), [System.Text.Encoding]::UTF8)
    $tpl = $tpl.Replace("@PROJECT_NAME@", $ProjectName).Replace("@SOURCE_HOST@", $Target).
      Replace("@REMOTE_ROOT@", $RemoteRoot).
      Replace("@SCOPE@", $Module + "（*.4gl / *.global / *.per）").
      Replace("@FILE_COUNT@", "$FILES").
      Replace("@INIT_AT@", (Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz")).
      Replace("@SOURCE_ENCODING@", $(if ($FromEncoding) { $FromEncoding } elseif ($enc) { $enc } else { "utf-8" }))
    [IO.File]::WriteAllText($readmePath, $tpl, (New-Object System.Text.UTF8Encoding($false)))
    Dim2 "写入 README-PROJECT.md"
  }
  & git -C $Dest config core.autocrlf false
  & git -C $Dest config core.eol lf
  & git -C $Dest config core.safecrlf warn
  Dim2 "已设 core.autocrlf=false / core.eol=lf / core.safecrlf=warn"

  # ── 10) 提交
  if (-not $NoCommit) {
    Progress2 "提交" "git add/commit"
    & git -C $Dest add -A | Out-Null
    $dirty = (& git -C $Dest status --porcelain)
    if ($dirty) {
      $ident = & git -C $Dest var GIT_AUTHOR_IDENT 2>$null
      if ($LASTEXITCODE -ne 0) { Warn2 "git 还没配 user.name/user.email，跳过提交（配置后自行提交，或用 -NoCommit）" }
      else {
        $msg = "chore: 从 ${Target}:${RemoteRoot} 初始化/更新生产代码镜像"
        & git -C $Dest commit -q -m $msg
        if ($LASTEXITCODE -eq 0) { Info "已提交：$msg" }
      }
    } else { Dim2 "没有变化，无需提交" }
  }

  $succeeded = $true
  Progress2 "完成" "初始化完成"
} finally {
  # ── 11) 清理两端中间文件（成功/失败都清）
  Progress2 "清理" "删除两端临时包"
  if ($tarPath) {
    Invoke-Remote "rm -f '$tarPath'" | Out-Null
    if ($LASTEXITCODE -ne 0) { Warn2 "远端临时包可能未删除：$tarPath" }
  }
  if (Test-Path $packDir) { Remove-Item -Recurse -Force $packDir -ErrorAction SilentlyContinue }
  if ($succeeded) { Dim2 "已清理：远端 $tarPath；本地 $packDir" }
}

Info "完成：$Dest"
# 只看 crlf：i/none 表示整个文件没有换行符（或 git 当二进制处理），不是行尾问题
$eolBad = (& git -C $Dest ls-files --eol) | Where-Object { $_ -match 'crlf' } | Select-Object -First 5
if ($eolBad) { Warn2 "以下文件仍是 CRLF（应为 LF，检查 .gitattributes / core.autocrlf）："; $eolBad | ForEach-Object { Dim2 $_ } }
else { Info "换行校验通过：没有 CRLF 文件" }
Write-Host ""
Info "下一步：1) git log --oneline -1  2) 复制 .vscode/settings.example.json → settings.json  3) tiptop link/schema sync 采集资料  4) 更新：init-project.ps1 -Target '$Target' -RemoteRoot '$RemoteRoot' -Dest '$Dest' -Region '$Region' -Update"
