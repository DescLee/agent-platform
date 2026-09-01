@echo off
setlocal EnableExtensions

rem Start the Green Giant Tauri desktop client from this source workspace.
set "ROOT=%~dp0"
set "GUI=%ROOT%surfaces\gui"
set "VENV=%ROOT%.venv"
set "VENV_SERVER=%VENV%\Scripts\openworker-server.exe"

if not exist "%VENV_SERVER%" (
  echo ERROR: The .venv Python environment is not installed. Run install.bat first.
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

set "VIRTUAL_ENV=%VENV%"
set "PATH=%VENV%\Scripts;%PATH%"
set "COWORKER_SERVER_BIN=%VENV_SERVER%"
set "PYTHONHOME="

pushd "%GUI%"
call npm run tauri dev
set "RESULT=%errorlevel%"
popd
exit /b %RESULT%
