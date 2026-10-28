@echo off
setlocal
cd /d "%~dp0"
set "MOVIX_NODE=node"
where node >nul 2>nul
if errorlevel 1 set "MOVIX_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
start "" "http://localhost:4180"
"%MOVIX_NODE%" "%~dp0server.cjs"
pause
