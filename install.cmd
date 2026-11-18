@echo off
cd /d "%~dp0"
echo Figma Agent Bridge - local setup
echo 1. Codex
echo 2. Claude Desktop
echo 3. Both
set /p FIGMA_BRIDGE_CLIENT_CHOICE=Choose your AI client [1-3]:
set "FIGMA_BRIDGE_CLIENT=codex"
if "%FIGMA_BRIDGE_CLIENT_CHOICE%"=="2" set "FIGMA_BRIDGE_CLIENT=claude-desktop"
if "%FIGMA_BRIDGE_CLIENT_CHOICE%"=="3" set "FIGMA_BRIDGE_CLIENT=both"
if exist "runtime\node.exe" (
  "runtime\node.exe" setup.mjs --client %FIGMA_BRIDGE_CLIENT%
) else (
  node setup.mjs --client %FIGMA_BRIDGE_CLIENT%
)
pause
