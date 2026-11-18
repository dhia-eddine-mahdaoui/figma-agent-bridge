@echo off
cd /d "%~dp0"
if exist "runtime\node.exe" (
  "runtime\node.exe" call.mjs
) else (
  node call.mjs
)
pause
