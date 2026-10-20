@echo off
rem Открывает gw-proxy новой вкладкой в окне Windows Terminal (если оно уже открыто —
rem вкладка появится в нём; если нет — wt создаст новое окно).
rem Если wt не найден — запускает gw-proxy.cmd обычным способом.
setlocal
where wt >nul 2>nul
if errorlevel 1 (
  echo [gw-proxy-wt] Windows Terminal не найден, запускаю в обычном окне...
  call "%~dp0gw-proxy.cmd"
  exit /b %errorlevel%
)
rem -d "%~dp0." — стартовая папка вкладки (точка в конце обходит проблему хвостового слэша в пути)
wt -w 0 nt -d "%~dp0." --title gw-proxy cmd /k gw-proxy.cmd
