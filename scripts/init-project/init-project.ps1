# init-project.ps1 —— 从生产服务器（Linux，如 RedHat 6.5 + TiTop）初始化/更新 4GL 仓库（Windows）。
#
# ★ 只在**本地 Windows** 执行（绝不在生产服务器上运行本脚本）。
# ★ 服务器侧：只读 find 预检/取样 + 一次 tar 打包（写到 /u1/out，用完即删）；
#    不修改项目树、不调用上传/部署。
#
# 流程：预检 → 取样本（判编码）→ 生产端 tar 打包（/u1/out）→ scp 回本地（<Dest>\.pack）
#       → 解压 → 转码/行尾 → git 初始化与提交 → 清理两端中间文件（失败也清）
#
# 进度：按 tiptop 同款协议把 `进度<TAB>阶段<TAB>信息[<TAB>i<TAB>n]` 写到 stderr，
#       VSCode 命令据此显示通知栏进度。
[CmdletBinding()]
param(
  [string]$Target = $env:INIT_PROJECT_TARGET,
  [string]$RemoteRoot = "/u1/topprod",
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
  [switch]$ProgressProtocol
)
$ErrorActionPreference = "Stop"
$SelfDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$TplDir = Join-Path $SelfDir "templates"

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
if (-not $Dest) { $Dest = Join-Path $HOME ("projects\" + (Split-Path -Leaf $RemoteRoot)) }
$ProjectName = Split-Path -Leaf $Dest

# ── ssh/ scp 参数（只支持密钥；老服务器自动 legacy 重试）
$sshExe = if ($env:INIT_PROJECT_SSH) { $env:INIT_PROJECT_SSH } else { "ssh" }
$sshCommon = @()
if (-not $env:INIT_PROJECT_SSH) {
  if ($Port -gt 0) { $sshCommon += @("-p", "$Port") }
  if ($Key) { $sshCommon += @("-i", $Key) }
  $sshCommon += @("-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "-o", "StrictHostKeyChecking=accept-new")
}
$legacy = @("-o", "HostkeyAlgorithms=+ssh-rsa", "-o", "PubkeyAcceptedAlgorithms=+ssh-rsa",
            "-o", "KexAlgorithms=+diffie-hellman-group14-sha1,diffie-hellman-group1-sha1", "-o", "MACs=+hmac-sha1")
$sshArgs = $sshCommon
function Invoke-Remote([string]$cmd) { & $sshExe @sshArgs $Target $cmd }

# ── 远端只读 find 的公共谓词
$pruneNames = ".git", ".svn", "CVS", "node_modules", "42f", "4fd", "bin", "obj", "tmp", "backup", "bak", ".project", ".link", ".pack", "out"
$prune = ($pruneNames | ForEach-Object { "-name '$_' -o" }) -join " "
$junk = "! -name '*~' ! -name '*.bak' ! -name '*.orig' ! -name '*.rej' ! -name '*.swp' ! -name '*.swo' ! -name '.DS_Store' ! -name 'Thumbs.db'"
$starts = "."
if ($Module) { $starts = ($Module -split "," | Where-Object { $_ } | ForEach-Object { "'" + $_.Trim() + "'" }) -join " " }
$nameFilter = "\\( -name '*.4gl' -o -name '*.global' -o -name '*.per' \\)"
function Remote-Find([string]$fmt) {
  "cd '$RemoteRoot' && find $starts \\( $prune -false \\) -prune -o -type f $junk $nameFilter -printf '$fmt'"
}
$cmdStats = (Remote-Find '%s\n') + " | awk '{n++; b+=`$1} END{print \"FILES \" n; print \"BYTES \" b}'"
$cmdModules = "cd '$RemoteRoot' && ls -1 | head -40 | tr '\n' ',' | sed 's/,`$//'"
$cmdSample = (Remote-Find '%p\n') + " | sed 's|^\./||' | head -n $Samples | while IFS= read -r f; do printf 'FILE %s\n' `"`$f`"; head -c 4096 `"`$f`" | base64 | tr -d '\n'; printf '\nEND\n'; done"
$unique = "topprod-src-{0}-{1}.tar.gz" -f (Get-Date -Format "yyyyMMdd-HHmmss"), (Get-Random -Maximum 999999)
$remoteTar = "$RemoteTmpDir/$unique"
$cmdPack = "set -e; mkdir -p '$RemoteTmpDir'; " + (Remote-Find '%p\n') + " | sed 's|^\./||' | tar czf '$remoteTar' -C '$RemoteRoot' -T -; echo '$remoteTar'"

if ($PrintRemote) {
  Info "将在服务器上执行的命令（只读 find + 一次 tar 打包到 $RemoteTmpDir，用完即删）："
  Dim2 "1) $cmdStats"
  Dim2 "2) $cmdModules"
  Dim2 "3) $cmdSample"
  Dim2 "4) $cmdPack"
  Dim2 "5) rm -f '$remoteTar'"
  Dim2 "（没有其它命令；不改项目树、不上传、不部署）"
  exit 0
}

# ── 1) 连通性
Progress2 "连接" "连接 $Target（远端只读）"
Info "连接 $Target …"
if (-not $env:INIT_PROJECT_SSH) {
  Invoke-Remote "true" | Out-Null
  if ($LASTEXITCODE -ne 0) {
    if ($LegacySsh) { Die "连不上 $Target（已用 -LegacySsh）" }
    Warn2 "默认算法连不上，按老服务器（OpenSSH 5.x）兼容参数重试…"
    $sshArgs = $sshCommon + $legacy
    Invoke-Remote "true" | Out-Null
    if ($LASTEXITCODE -ne 0) { Die "连不上 $Target：确认密钥/agent、网络与主机名（只支持密钥）" }
    Warn2 "已启用 ssh-rsa/SHA-1 兼容（老服务器）"
  }
}

# ── 2) 远端只读预检
Progress2 "预检" "统计源文件（只读 find）"
Info "远端预检（只读）…"
$stats = Invoke-Remote $cmdStats
if ($LASTEXITCODE -ne 0) { Die "远端预检失败（ssh exit=$LASTEXITCODE）" }
$FILES = 0; $BYTES = 0
foreach ($line in $stats) {
  if ($line -match '^FILES (\d+)') { $FILES = [int]$Matches[1] }
  if ($line -match '^BYTES (\d+)') { $BYTES = [long]$Matches[1] }
}
if ($FILES -le 0) { Die "没有匹配到源文件：确认 -RemoteRoot（$RemoteRoot）" }
$mb = [math]::Round($BYTES / 1MB, 2)
Info "找到 $FILES 个源文件，共 $mb MB"
try { $mods = (Invoke-Remote $cmdModules) } catch { $mods = "" }
Dim2 "顶层目录：$mods"

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
if ($Module) { Info "远根：$RemoteRoot  模组：$Module" } else { Info "远根：$RemoteRoot" }
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
  # ── 5) 生产端打包 → scp 回本地
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
    $scpArgs += @("-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "-o", "StrictHostKeyChecking=accept-new")
    if ($LegacySsh -or ($sshArgs.Count -gt $sshCommon.Count)) { $scpArgs += $legacy }
  }
  & scp @scpArgs "$($Target):$tarPath" $localTar
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
  if ($enc) {
    $utf8Strict = New-Object System.Text.UTF8Encoding($false, $true)
    $utf8Out = New-Object System.Text.UTF8Encoding($false)
    $conv = 0; $skip = 0
    foreach ($f in $srcFiles) {
      $bytes = [IO.File]::ReadAllBytes($f.FullName)
      $b = $bytes
      if ($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF) { $b = $b[3..($b.Length - 1)] }
      $isUtf8 = $true
      try { [void]$utf8Strict.GetString($b) } catch { $isUtf8 = $false }
      if ($isUtf8) { $skip++; continue }
      $cp = switch ($enc) { "gbk" { 936 } "big5" { 950 } "gb18030" { 54936 } "euc-cn" { 936 } default { 936 } }
      try {
        $e = [System.Text.Encoding]::GetEncoding($cp, [System.Text.EncoderFallback]::ExceptionFallback, [System.Text.DecoderFallback]::ExceptionFallback)
        [IO.File]::WriteAllBytes($f.FullName, $utf8Out.GetBytes($e.GetString($b)))
        $conv++
      } catch { Warn2 "转码失败（按 $enc）：$($f.FullName)" }
    }
    Dim2 "转码 $conv 个；本来就是 UTF-8 跳过 $skip 个"
  }

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
      Replace("@SCOPE@", $(if ($Module) { $Module } else { "全部模组" }) + "（*.4gl / *.global / *.per）").
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
$eolBad = (& git -C $Dest ls-files --eol) | Where-Object { $_ -notmatch 'i/lf\s+w/lf' } | Select-Object -First 5
if ($eolBad) { Warn2 "以下文件不是 LF（检查 .gitattributes / core.autocrlf）："; $eolBad | ForEach-Object { Dim2 $_ } }
else { Info "换行校验通过：git ls-files --eol 全是 i/lf w/lf" }
Write-Host ""
Info "下一步：1) git log --oneline -1  2) 复制 .vscode/settings.example.json → settings.json  3) tiptop link/schema sync 采集资料  4) 更新：init-project.ps1 -Target '$Target' -RemoteRoot '$RemoteRoot' -Dest '$Dest' -Update"
