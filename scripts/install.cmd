@echo off
setlocal
cd /d "%~dp0.."

node scripts/install.mjs
set "EXITCODE=%ERRORLEVEL%"

echo.
if not "%EXITCODE%"=="0" echo Installation failed (exit code %EXITCODE%).
pause
exit /b %EXITCODE%
