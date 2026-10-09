@echo off
title AutoDoku
cd /d "%~dp0"
where node >nul 2>nul
if %errorlevel%==0 (
  node server.js
  goto :eof
)
where python >nul 2>nul
if %errorlevel%==0 (
  start "" "http://localhost:5317"
  python -m http.server 5317 --bind 127.0.0.1
  goto :eof
)
echo Weder Node.js noch Python gefunden. Bitte Node.js installieren: https://nodejs.org
pause
