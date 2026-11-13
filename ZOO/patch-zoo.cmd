@echo off
rem Zoo Code patcher launcher: adds OpenCoder gateway request signing to the extension.
rem Usage: patch-zoo.cmd            (apply patch; safe to run repeatedly)
rem        patch-zoo.cmd --check    (report only, changes nothing)
rem        patch-zoo.cmd --revert   (restore dist/extension.js from .orig backup)
rem NOTE: this file must stay pure ASCII. cmd.exe reads .cmd byte by byte in the current
rem code page, so non-ASCII text together with "chcp 65001" breaks command parsing.
setlocal
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [patch-zoo] Node.js not found. Install it: https://nodejs.org
  pause
  exit /b 1
)

node patch-zoo.mjs %*
set RC=%ERRORLEVEL%

if "%1"=="" if "%RC%"=="0" (
  echo.
  echo [patch-zoo] Now reload VS Code: Ctrl+Shift+P -^> "Developer: Reload Window".
)

pause
exit /b %RC%
