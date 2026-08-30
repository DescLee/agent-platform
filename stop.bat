@echo off
setlocal EnableExtensions

rem Stop the OpenWorker Tauri development client started from this workspace.
set "ROOT=%~dp0"
set "OPENWORKER_GUI_PATH=%ROOT%surfaces\gui"

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "$gui = $env:OPENWORKER_GUI_PATH;" ^
  "$process = Get-CimInstance Win32_Process ^| Where-Object { $_.CommandLine -and $_.CommandLine.Contains($gui) -and $_.CommandLine -match 'tauri' -and $_.CommandLine -match '\sdev(\s|$)' } ^| Select-Object -First 1;" ^
  "if (-not $process) { Write-Host 'OpenWorker is not running from this workspace.'; exit 0 };" ^
  "taskkill.exe /PID $process.ProcessId /T /F ^| Out-Null;" ^
  "if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE };" ^
  "Write-Host 'OpenWorker stopped.'"

exit /b %errorlevel%
