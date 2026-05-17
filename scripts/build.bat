@echo off
cd /d "%~dp0.."
python scripts\build.py %*
exit /b %ERRORLEVEL%
