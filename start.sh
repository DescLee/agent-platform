#!/usr/bin/env bash
# 从源码工作区启动绿巨人 Tauri 桌面客户端。

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
GUI="$ROOT/surfaces/gui"
PID_FILE="$ROOT/.openworker-dev.pid"
VENV="$ROOT/.venv"
VENV_SERVER="$VENV/bin/openworker-server"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "错误：start.sh 仅支持 macOS；Windows 请运行 start.bat。" >&2
  exit 1
fi
if [ ! -x "$VENV_SERVER" ]; then
  echo "错误：.venv Python 环境尚未安装，请先运行 ./install.sh。" >&2
  exit 1
fi
if [ ! -x "$GUI/node_modules/.bin/tauri" ]; then
  echo "错误：前端依赖尚未安装，请先运行 ./install.sh。" >&2
  exit 1
fi
if ! command -v cargo >/dev/null 2>&1; then
  echo "错误：Rust/Cargo 不可用，请安装 Rust 后运行 ./install.sh。" >&2
  exit 1
fi

export VIRTUAL_ENV="$VENV"
export PATH="$VENV/bin:$PATH"
export COWORKER_SERVER_BIN="$VENV_SERVER"
unset PYTHONHOME

if [ -f "$PID_FILE" ]; then
  existing_pid="$(tr -cd '0-9' < "$PID_FILE")"
  if [ -n "$existing_pid" ] && kill -0 "$existing_pid" 2>/dev/null; then
    echo "错误：绿巨人已在运行（PID $existing_pid）。" >&2
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
