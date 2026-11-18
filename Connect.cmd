@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0connect-ssh.ps1" -Prompt
pause
