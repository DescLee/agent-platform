#!/usr/bin/env bash
# 在 macOS 上安装绿巨人源码工作区并验证构建。

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
GUI="$ROOT/surfaces/gui"
TAURI_MANIFEST="$GUI/src-tauri/Cargo.toml"
VENV="$ROOT/.venv"
VENV_PYTHON="$VENV/bin/python"

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "$2"
}

if [ "$(uname -s)" != "Darwin" ]; then
  fail "install.sh supports macOS. On Windows, run install.bat instead."
fi

echo "==> Checking system requirements"
require_command python3 "Python 3.10 or newer is required: https://www.python.org/downloads/"
require_command node "Node.js 20 or newer is required: https://nodejs.org/"
require_command npm "npm is required and normally ships with Node.js."
require_command rustc "Rust 1.77 or newer is required: https://rustup.rs/"
require_command cargo "Cargo is required and normally ships with Rust."
require_command xcrun "Xcode Command Line Tools are required. Run: xcode-select --install"
xcrun --find clang >/dev/null 2>&1 \
  || fail "Xcode Command Line Tools are incomplete. Run: xcode-select --install"

python3 -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)' \
  || fail "Python 3.10 or newer is required."
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' \
  || fail "Node.js 20 or newer is required."
rustc_version="$(rustc --version | awk '{print $2}')"
rustc_major="${rustc_version%%.*}"
rustc_minor="$(printf '%s' "$rustc_version" | cut -d. -f2)"
if [ "$rustc_major" -lt 1 ] || { [ "$rustc_major" -eq 1 ] && [ "$rustc_minor" -lt 77 ]; }; then
  fail "Rust 1.77 or newer is required."
fi

echo "==> Preparing Python environment"
if [ ! -x "$VENV_PYTHON" ]; then
  python3 -m venv "$VENV"
fi
export VIRTUAL_ENV="$VENV"
export PATH="$VENV/bin:$PATH"
unset PYTHONHOME

"$VENV_PYTHON" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)' \
  || fail "The existing .venv uses an unsupported Python. Recreate it with Python 3.10+."
"$VENV_PYTHON" -m pip install --upgrade pip
"$VENV_PYTHON" -m pip install -e "$ROOT[messaging,bedrock,dev]"
"$VENV_PYTHON" -c 'import aisuite, coworker, fastapi, uvicorn'

echo "==> Installing frontend dependencies"
if [ -f "$GUI/package-lock.json" ]; then
  npm ci --prefix "$GUI"
else
  npm install --prefix "$GUI"
fi

echo "==> Initializing local application data"
STATE_DIR="${COWORKER_STATE_DIR:-$HOME/.config/coworker}"
mkdir -p "$STATE_DIR/logs"
chmod 700 "$STATE_DIR" "$STATE_DIR/logs"

echo "==> Verifying frontend and desktop builds"
npm run build --prefix "$GUI"
cargo build --manifest-path "$TAURI_MANIFEST"

echo
echo "绿巨人安装完成。"
echo "运行 ./start.sh 启动桌面客户端。"
