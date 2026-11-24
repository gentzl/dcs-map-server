# Downloads a portable Node.js runtime for start.bat, so Windows users don't
# need Node installed separately. Verified against the official SHA256
# checksum before anything is extracted or run -- a corrupted or tampered
# download should fail loudly here, not run silently as node.exe later.
param(
  [Parameter(Mandatory = $true)][string]$Version,
  [Parameter(Mandatory = $true)][string]$Arch,
  [Parameter(Mandatory = $true)][string]$Sha256,
  [Parameter(Mandatory = $true)][string]$Dest
)
$ErrorActionPreference = 'Stop'

if (Test-Path (Join-Path $Dest 'node.exe')) {
  exit 0
}

$zipName = "node-v$Version-$Arch"
$url = "https://nodejs.org/dist/v$Version/$zipName.zip"
$runtimeDir = Split-Path -Parent $Dest
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
$zipPath = Join-Path $runtimeDir 'node-download.zip'
$extractDir = Join-Path $runtimeDir 'node-extract'

Write-Host "Downloading Node.js v$Version ($Arch, ~35 MB)..."
Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $zipPath

$actualHash = (Get-FileHash -Algorithm SHA256 -Path $zipPath).Hash
if ($actualHash -ne $Sha256) {
  Remove-Item -Force $zipPath
  throw "Checksum mismatch for $zipName.zip (expected $Sha256, got $actualHash) -- not installing it."
}

if (Test-Path $extractDir) { Remove-Item -Recurse -Force $extractDir }
Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force

if (Test-Path $Dest) { Remove-Item -Recurse -Force $Dest }
Move-Item -Path (Join-Path $extractDir $zipName) -Destination $Dest

Remove-Item -Force $zipPath
Remove-Item -Recurse -Force $extractDir
Write-Host "Node.js ready."
