@echo off
setlocal EnableExtensions

rem Install the OpenWorker source workspace on Windows and verify that it can build.
set "ROOT=%~dp0"
set "GUI=%ROOT%surfaces\gui"
set "TAURI_MANIFEST=%GUI%\src-tauri\Cargo.toml"
set "VENV_PYTHON=%ROOT%.venv\Scripts\python.exe"

echo ==^> Checking system requirements
where py >nul 2>nul
if %errorlevel% equ 0 (
  set "PYTHON_CMD=py -3"
) else (
  where python >nul 2>nul || goto :missing_python
  set "PYTHON_CMD=python"
)

%PYTHON_CMD% -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)"
if errorlevel 1 (
  echo ERROR: Python 3.10 or newer is required.
  exit /b 1
)

where node >nul 2>nul || goto :missing_node
where npm >nul 2>nul || goto :missing_node
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 20 ? 0 : 1)"
if errorlevel 1 (
  echo ERROR: Node.js 20 or newer is required.
  exit /b 1
)

where rustc >nul 2>nul || goto :missing_rust
where cargo >nul 2>nul || goto :missing_rust
for /f "tokens=3 delims=. " %%A in ('rustc --version') do set "RUST_MINOR=%%A"
if not defined RUST_MINOR goto :missing_rust
if %RUST_MINOR% lss 77 (
  echo ERROR: Rust 1.77 or newer is required.
  exit /b 1
)

echo ==^> Preparing Python environment
if not exist "%VENV_PYTHON%" (
  %PYTHON_CMD% -m venv "%ROOT%.venv"
  if errorlevel 1 goto :failed
)
"%VENV_PYTHON%" -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)"
if errorlevel 1 (
  echo ERROR: The existing .venv uses an unsupported Python. Recreate it with Python 3.10+.
  exit /b 1
)
"%VENV_PYTHON%" -m pip install --upgrade pip
if errorlevel 1 goto :failed
"%VENV_PYTHON%" -m pip install -e "%ROOT%[messaging,bedrock,dev]"
if errorlevel 1 goto :failed
"%VENV_PYTHON%" -c "import aisuite, coworker, fastapi, uvicorn"
if errorlevel 1 goto :failed

echo ==^> Installing frontend dependencies
if exist "%GUI%\package-lock.json" (
  call npm ci --prefix "%GUI%"
) else (
  call npm install --prefix "%GUI%"
)
if errorlevel 1 goto :failed

echo ==^> Initializing local application data
if defined COWORKER_STATE_DIR (
  set "STATE_DIR=%COWORKER_STATE_DIR%"
) else (
  if not defined APPDATA (
    echo ERROR: APPDATA is not defined for the current Windows user.
    exit /b 1
  )
  set "STATE_DIR=%APPDATA%\coworker"
)
if not exist "%STATE_DIR%\logs" mkdir "%STATE_DIR%\logs"
if errorlevel 1 goto :failed

echo ==^> Verifying frontend and desktop builds
call npm run build --prefix "%GUI%"
if errorlevel 1 goto :failed
cargo build --manifest-path "%TAURI_MANIFEST%"
if errorlevel 1 goto :failed

echo.
echo OpenWorker installation completed successfully.
echo Start the desktop client with: start.bat
exit /b 0

:missing_python
echo ERROR: Python 3.10 or newer is required: https://www.python.org/downloads/
exit /b 1

:missing_node
echo ERROR: Node.js 20 or newer is required: https://nodejs.org/
exit /b 1

:missing_rust
echo ERROR: Rust 1.77 or newer is required: https://rustup.rs/
exit /b 1

:failed
echo ERROR: OpenWorker installation failed. Review the command output above.
exit /b 1
