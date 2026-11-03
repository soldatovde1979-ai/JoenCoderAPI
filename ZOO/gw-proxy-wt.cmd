@echo off
rem Opens gw-proxy in a new tab of Windows Terminal (if a WT window is already open the tab
rem appears there; if not, wt creates a new window). Falls back to a regular console window
rem if Windows Terminal is not installed. Must stay pure ASCII - see gw-proxy.cmd.
setlocal
where wt >nul 2>nul
if errorlevel 1 (
  echo [gw-proxy-wt] Windows Terminal not found, starting in a regular window...
  call "%~dp0gw-proxy.cmd"
  exit /b %errorlevel%
)
rem -d "%~dp0." - start folder of the tab (trailing dot avoids the trailing-slash issue)
wt -w 0 nt -d "%~dp0." --title gw-proxy cmd /k gw-proxy.cmd
