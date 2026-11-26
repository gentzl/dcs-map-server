# Renders the PNG app icons in public/ from the SVG sources, using the
# headless Microsoft Edge that ships with Windows. Only needed after the logo
# changes; the PNGs are committed, so a normal build does not run this.
#
#   powershell -ExecutionPolicy Bypass -File tools\icons\render-icons.ps1

$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$public = Join-Path $root 'public'

$edge = @(
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $edge) { throw 'Microsoft Edge not found.' }

$jobs = @(
  @{ Svg = (Join-Path $public 'icon.svg');              Out = 'icon-192.png';          Size = 192 },
  @{ Svg = (Join-Path $public 'icon.svg');              Out = 'icon-512.png';          Size = 512 },
  @{ Svg = (Join-Path $PSScriptRoot 'icon-maskable.svg'); Out = 'icon-maskable-512.png'; Size = 512 },
  @{ Svg = (Join-Path $PSScriptRoot 'icon-full.svg');     Out = 'apple-touch-icon.png';  Size = 180 }
)

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('dcs-icons-' + [Guid]::NewGuid())
New-Item -ItemType Directory $tmp | Out-Null
try {
  foreach ($j in $jobs) {
    $svg = Get-Content -Raw $j.Svg
    $html = Join-Path $tmp ($j.Out + '.html')
    # The SVG is inlined so the page needs no file access of its own.
    Set-Content -Encoding utf8 $html ("<!doctype html><style>html,body{margin:0;background:transparent}" +
      "svg{display:block;width:$($j.Size)px;height:$($j.Size)px}</style>$svg")
    $out = Join-Path $public $j.Out
    # Edge reports progress on stderr, which Windows PowerShell turns into an
    # error under 'Stop'; success is checked by the file existing instead.
    $ErrorActionPreference = 'Continue'
    & $edge --headless=new --disable-gpu --hide-scrollbars --default-background-color=00000000 `
      --user-data-dir="$tmp\profile" --window-size="$($j.Size),$($j.Size)" `
      --screenshot="$out" ([Uri]$html).AbsoluteUri 2>&1 | Out-Null
    $ErrorActionPreference = 'Stop'
    if (-not (Test-Path $out)) { throw "Edge did not write $out" }
    Write-Host "wrote public\$($j.Out)"
  }
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
