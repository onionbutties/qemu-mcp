@echo off
setlocal
cd /d "%~dp0.."

node scripts/uninstall.mjs
set "EXITCODE=%ERRORLEVEL%"

echo.
if not "%EXITCODE%"=="0" echo Uninstall failed (exit code %EXITCODE%).
pause
exit /b %EXITCODE%
