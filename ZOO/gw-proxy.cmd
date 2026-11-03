@echo off
rem gw-proxy launcher: checks for Node.js, installs it if missing, then starts the proxy.
rem Proxy output goes to gw-proxy.log, not to the console: an accidental click on the window
rem (QuickEdit selection) no longer freezes the process - node never writes to console.
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

echo [gw-proxy] Starting... Log: %~dp0gw-proxy.log
echo [gw-proxy] You can minimize this window. Stop: Ctrl+C here or close the window.
node gw-proxy.mjs %* >> gw-proxy.log 2>&1

echo [gw-proxy] Proxy stopped. Last log lines:
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-Content -Path '%~dp0gw-proxy.log' -Tail 15 -Encoding UTF8"
pause
