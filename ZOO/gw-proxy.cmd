@echo off
rem gw-proxy launcher: checks for Node.js, installs it if missing, then starts the proxy.
rem Прокси пишет вывод в gw-proxy.log, а не в консоль: случайный клик мышью по окну
rem (QuickEdit-выделение) больше НЕ замораживает процесс — node не пишет в консоль вовсе.
setlocal
rem UTF-8 для окна: кириллица в echo и хвосте лога без кракозябр (файл сохранён в UTF-8)
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

echo [gw-proxy] Запуск... Лог: %~dp0gw-proxy.log
echo [gw-proxy] Окно можно свернуть. Останов: Ctrl+C здесь или закрыть окно.
node gw-proxy.mjs %* >> gw-proxy.log 2>&1

echo [gw-proxy] Прокси остановлен. Последние строки лога:
powershell -NoProfile -Command "Get-Content -Path '%~dp0gw-proxy.log' -Tail 15 -Encoding UTF8"
pause
