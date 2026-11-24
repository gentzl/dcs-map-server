@echo off
setlocal
cd /d "%~dp0"

set "NODE_VERSION=22.23.5"
set "NODE_DIR=%~dp0runtime\node"

if /i "%PROCESSOR_ARCHITECTURE%"=="ARM64" (
  set "NODE_ARCH=win-arm64"
  set "NODE_SHA256=c1856817f611738c77534efbff8a5a17990593eab24046bc8d2c23a77a160d13"
) else (
  set "NODE_ARCH=win-x64"
  set "NODE_SHA256=4a191082e9706866830379d577d2cc8a50c776fcd9436a8d061b063ed0d9a0e3"
)

powershell -NoProfile -ExecutionPolicy Bypass -File "tools\bootstrap-node.ps1" -Version "%NODE_VERSION%" -Arch "%NODE_ARCH%" -Sha256 "%NODE_SHA256%" -Dest "%NODE_DIR%"
if errorlevel 1 (
  echo.
  echo Could not set up Node.js. Check your internet connection and try again.
  pause
  exit /b 1
)

"%NODE_DIR%\node.exe" "tools\reconfigure-theaters.js"
if errorlevel 1 (
  echo.
  echo Something went wrong -- see above.
)
pause
endlocal
