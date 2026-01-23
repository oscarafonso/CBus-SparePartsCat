@echo off
setlocal
cd /d "%~dp0"

echo =====================================
echo  Build Search Index (SVG BOM Parser)
echo =====================================
echo.

where py >nul 2>nul
if %errorlevel%==0 (
  py -3 tools\build_search_index.py
  echo.
  pause
  exit /b %errorlevel%
)

where python >nul 2>nul
if %errorlevel%==0 (
  python tools\build_search_index.py
  echo.
  pause
  exit /b %errorlevel%
)

echo [ERROR] Python not found (no 'py' and no 'python' in PATH).
pause
endlocal