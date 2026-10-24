# Studio 64 launcher for Windows ("Start Studio 64.bat" runs this).
# Finds Node.js 18+ on this computer or downloads a private copy into .runtime\node (no
# administrator rights, checked against its SHA-256 checksum), then starts tools\start.mjs, which
# opens Studio 64 in the browser. Works with the PowerShell that comes with Windows 10 and 11.
#   STUDIO_NODE=system   only use the Node.js on PATH        STUDIO_NODE=private   always the private one
# (Keep this file ASCII: Windows PowerShell 5.1 reads scripts without a BOM as the ANSI code page.)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest is very slow with its progress bar
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location -LiteralPath $Root

$NodeVersion = '24.21.0'
$Runtime = Join-Path $Root '.runtime'
$NodeDir = Join-Path $Runtime 'node'

function Say([string]$Text) { Write-Host "  $Text" }
function Stop-Launcher([string]$Text, [string]$Fix) {
  Write-Host ''
  Write-Host "  $Text" -ForegroundColor Red
  if ($Fix) { Write-Host "  $Fix" }
  Write-Host ''
  exit 1
}

Write-Host ''
Write-Host '  ------------------------------------------------------------'
Write-Host '  Studio 64' -ForegroundColor Yellow
Write-Host '  ------------------------------------------------------------'
Say 'Make your own Super Mario 64, right in the browser.'
Say 'Keep this window open while you use Studio 64. Close it to stop Studio 64.'
Write-Host ''

# which Windows: 64-bit Intel/AMD or Arm (a 32-bit PowerShell on 64-bit Windows says so in PROCESSOR_ARCHITEW6432)
$Arch = $env:PROCESSOR_ARCHITEW6432
if (-not $Arch) { $Arch = $env:PROCESSOR_ARCHITECTURE }
switch ($Arch) {
  'AMD64' { $Cpu = 'x64'; $Sum = '158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541' }
  'ARM64' { $Cpu = 'arm64'; $Sum = '8779b1bde1d39f8d420e3b57aa657b39891af434d3de44a919044cec06785921' }
  default { Stop-Launcher "This Windows ($Arch) is not supported: Studio 64 needs 64-bit Windows 10 or 11." '' }
}
$Name = "node-v$NodeVersion-win-$Cpu"
$Url = "https://nodejs.org/dist/v$NodeVersion/$Name.zip"

# SHA-256 of a file with .NET: Get-FileHash comes from a module that is not always loadable (a
# Windows PowerShell started from PowerShell 7 inherits its module path and does not find it)
function Get-Sha256([string]$Path) {
  $stream = [System.IO.File]::OpenRead($Path)
  try {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    return ([BitConverter]::ToString($sha.ComputeHash($stream)) -replace '-', '')
  } finally { $stream.Dispose() }
}

function Test-Node([string]$Exe) {
  # (no script on the command line: Windows PowerShell 5.1 drops the double quotes of native arguments)
  if (-not $Exe -or -not (Test-Path -LiteralPath $Exe)) { return $false }
  $ErrorActionPreference = 'Continue'   # (Windows PowerShell 5.1 turns redirected stderr lines into errors)
  try {
    $out = & $Exe --version 2>$null
    if ($LASTEXITCODE -ne 0) { return $false }
    $v = [string](@($out)[0])
    if (-not ($v -match '^v(\d+)\.')) { return $false }
    return ([int]$Matches[1] -ge 18)
  } catch { return $false }
}

$Mode = if ($env:STUDIO_NODE) { $env:STUDIO_NODE } else { 'auto' }
$Node = $null
if ($Mode -ne 'private') {
  $cmd = Get-Command node.exe -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($cmd -and (Test-Node $cmd.Source)) { $Node = $cmd.Source }
}
$Private = Join-Path $NodeDir 'node.exe'
if (-not $Node -and $Mode -ne 'system' -and (Test-Node $Private)) { $Node = $Private }

if (-not $Node) {
  if ($Mode -eq 'system') { Stop-Launcher 'Node.js 18 or newer was not found (STUDIO_NODE=system).' 'Install it from https://nodejs.org' }
  Say "Getting Node.js $NodeVersion, which runs Studio 64 (about 35 MB, only the first time)..."
  $Downloads = Join-Path $Runtime 'downloads'
  try { New-Item -ItemType Directory -Force -Path $Downloads | Out-Null } catch {
    Stop-Launcher "Could not make the folder $Runtime." 'Move the Studio 64 folder to your Documents or Desktop and start it again.'
  }
  $Zip = Join-Path $Downloads "$Name.zip"
  $Have = (Test-Path -LiteralPath $Zip) -and ((Get-Sha256 $Zip) -eq $Sum.ToUpper())
  if (-not $Have) {
    Remove-Item -LiteralPath $Zip -Force -ErrorAction SilentlyContinue
    $Part = "$Zip.part"
    $curl = Join-Path $env:SystemRoot 'System32\curl.exe'
    $ok = $false
    if (Test-Path -LiteralPath $curl) {
      & $curl -fL --retry 3 --connect-timeout 20 --progress-bar -o $Part $Url
      $ok = ($LASTEXITCODE -eq 0)
    }
    if (-not $ok) {
      try { Invoke-WebRequest -Uri $Url -OutFile $Part -UseBasicParsing; $ok = $true } catch { $ok = $false }
    }
    if (-not $ok) { Stop-Launcher 'Downloading Node.js failed.' 'Check your internet connection, then start Studio 64 again.' }
    Move-Item -LiteralPath $Part -Destination $Zip -Force
  }
  $Got = Get-Sha256 $Zip
  if ($Got -ne $Sum.ToUpper()) {
    Remove-Item -LiteralPath $Zip -Force -ErrorAction SilentlyContinue
    Stop-Launcher 'The Node.js download was damaged (its checksum does not match).' 'Start Studio 64 again to download it once more.'
  }
  $Tmp = "$NodeDir.tmp"
  Remove-Item -LiteralPath $NodeDir, $Tmp -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $Tmp | Out-Null
  # tar.exe (Windows 10 1803+) unpacks zips much faster than .NET's ZipFile
  $tar = Join-Path $env:SystemRoot 'System32\tar.exe'
  $unpacked = $false
  if (Test-Path -LiteralPath $tar) {
    & $tar -xf $Zip -C $Tmp
    $unpacked = ($LASTEXITCODE -eq 0)
  }
  if (-not $unpacked) {
    # (.NET, not Expand-Archive: that one comes from a module too, like Get-FileHash)
    try { Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory($Zip, $Tmp); $unpacked = $true } catch { $unpacked = $false }
  }
  if (-not $unpacked) { Stop-Launcher 'Unpacking Node.js failed.' 'Check that there is free disk space, then start Studio 64 again.' }
  Move-Item -LiteralPath (Join-Path $Tmp $Name) -Destination $NodeDir
  Remove-Item -LiteralPath $Tmp -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $Zip -Force -ErrorAction SilentlyContinue
  if (-not (Test-Node $Private)) { Stop-Launcher 'The downloaded Node.js does not start on this computer.' 'Install Node.js 18 or newer from https://nodejs.org and start Studio 64 again.' }
  $Node = $Private
  Say 'Node.js is ready.'
}

# files from a downloaded ZIP carry a "came from the internet" mark; the tools in this folder must
# not ask about it every time (this only touches the Studio 64 folder)
$Unblocked = Join-Path $Runtime 'unblocked'
if (-not (Test-Path -LiteralPath $Unblocked)) {
  try {
    Get-ChildItem -LiteralPath $Root -Recurse -File -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path $Runtime | Out-Null
    Set-Content -LiteralPath $Unblocked -Value 'Studio 64: the files of this folder were unblocked once' -ErrorAction SilentlyContinue
  } catch { }
}

$env:STUDIO_LAUNCHER = '1'
& $Node (Join-Path $Root 'tools\start.mjs') @args
$rc = $LASTEXITCODE
if ($rc -and $rc -ne 0 -and $rc -ne 130 -and $rc -ne -1073741510) {   # (-1073741510: the window was closed / Ctrl+C)
  Stop-Launcher "Studio 64 stopped with an error (code $rc)." 'The messages above say what went wrong. Start Studio 64 again to retry.'
}
exit 0
