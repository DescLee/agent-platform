#!/usr/bin/env bash
# Start the OpenWorker Tauri desktop client from this source workspace.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
GUI="$ROOT/surfaces/gui"
PID_FILE="$ROOT/.openworker-dev.pid"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "ERROR: start.sh supports macOS. On Windows, run start.bat instead." >&2
  exit 1
fi
if [ ! -x "$ROOT/.venv/bin/openworker-server" ]; then
  echo "ERROR: Python environment is not installed. Run ./install.sh first." >&2
  exit 1
fi
if [ ! -x "$GUI/node_modules/.bin/tauri" ]; then
  echo "ERROR: Frontend dependencies are not installed. Run ./install.sh first." >&2
  exit 1
fi
if ! command -v cargo >/dev/null 2>&1; then
  echo "ERROR: Rust/Cargo is unavailable. Run ./install.sh after installing Rust." >&2
  exit 1
fi

if [ -f "$PID_FILE" ]; then
  existing_pid="$(tr -cd '0-9' < "$PID_FILE")"
  if [ -n "$existing_pid" ] && kill -0 "$existing_pid" 2>/dev/null; then
    echo "ERROR: OpenWorker is already running (PID $existing_pid)." >&2
    exit 1
  fi
  rm -f "$PID_FILE"
fi

cd "$GUI"
npm run tauri dev &
runner_pid=$!
printf '%s\n' "$runner_pid" > "$PID_FILE"

cleanup() {
  if [ -f "$PID_FILE" ] && [ "$(tr -cd '0-9' < "$PID_FILE")" = "$runner_pid" ]; then
    rm -f "$PID_FILE"
  fi
}
trap cleanup EXIT
trap 'kill -TERM "$runner_pid" 2>/dev/null || true' INT TERM

wait "$runner_pid"
