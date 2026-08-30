@echo off
setlocal EnableExtensions

rem Start the OpenWorker Tauri desktop client from this source workspace.
set "ROOT=%~dp0"
set "GUI=%ROOT%surfaces\gui"

if not exist "%ROOT%.venv\Scripts\openworker-server.exe" (
  echo ERROR: Python environment is not installed. Run install.bat first.
  exit /b 1
)
if not exist "%GUI%\node_modules\.bin\tauri.cmd" (
  echo ERROR: Frontend dependencies are not installed. Run install.bat first.
  exit /b 1
)
where cargo >nul 2>nul
if errorlevel 1 (
  echo ERROR: Rust/Cargo is unavailable. Run install.bat after installing Rust.
  exit /b 1
)

pushd "%GUI%"
call npm run tauri dev
set "RESULT=%errorlevel%"
popd
exit /b %RESULT%
