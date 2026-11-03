@echo off
rem gw-proxy launcher: checks for Node.js, installs it if missing, then starts the proxy.
rem Proxy logs both to this window and to gw-proxy.log (the proxy writes the file itself,
rem trimmed to the last 200 lines on start). No redirect here: output stays live.
rem NOTE: this file must stay pure ASCII. cmd.exe reads .cmd byte by byte in the current
rem code page, so non-ASCII text together with "chcp 65001" breaks command parsing.
setlocal
rem UTF-8 console: safe here because the file itself is ASCII-only.
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [gw-proxy] Node.js not found. Installing OpenJS.NodeJS.LTS via winget...
  winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements
  if errorlevel 1 (
    echo [gw-proxy] Installation failed. Install Node.js manually: https://nodejs.org
    pause
    exit /b 1
  )
  echo [gw-proxy] Node.js installed. If "node" is not found, open a new console window and run this file again.
)

rem OpenCoder install folder. Change this single line if OpenCoder is installed elsewhere.
set "OPENCODER_HOME=C:\OpenCoder"

echo [gw-proxy] Starting... Log: %~dp0gw-proxy.log
echo [gw-proxy] OpenCoder home: %OPENCODER_HOME%
echo [gw-proxy] Live output below is duplicated to the log file. Stop: Ctrl+C here or close the window.
node gw-proxy.mjs %*

echo [gw-proxy] Proxy stopped.
pause
