#!/usr/bin/env bash
# Stop the OpenWorker Tauri development client started from this workspace.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
GUI="$ROOT/surfaces/gui"
PID_FILE="$ROOT/.openworker-dev.pid"

is_openworker_process() {
  local pid="$1" command
  command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  case "$command" in
    *"npm run tauri dev"*|*"$GUI/node_modules/.bin/tauri dev"*) return 0 ;;
    *) return 1 ;;
  esac
}

process_running() {
  local pid="$1" state
  state="$(ps -p "$pid" -o stat= 2>/dev/null | tr -d '[:space:]' || true)"
  [ -n "$state" ] && [[ "$state" != Z* ]]
}

root_pid=""
if [ -f "$PID_FILE" ]; then
  candidate="$(tr -cd '0-9' < "$PID_FILE")"
  if [ -n "$candidate" ] && kill -0 "$candidate" 2>/dev/null && is_openworker_process "$candidate"; then
    root_pid="$candidate"
  else
    rm -f "$PID_FILE"
  fi
fi

# Compatibility with clients started before PID tracking was added.
if [ -z "$root_pid" ]; then
  root_pid="$(pgrep -f "$GUI/node_modules/.bin/tauri dev" 2>/dev/null | head -n 1 || true)"
fi

if [ -z "$root_pid" ] || ! process_running "$root_pid"; then
  echo "OpenWorker is not running from this workspace."
  exit 0
fi

# Snapshot the full process tree before sending signals; children can be re-parented as
# their parents exit. This stays scoped to the exact Tauri process for this checkout.
pids=("$root_pid")
index=0
while [ "$index" -lt "${#pids[@]}" ]; do
  parent="${pids[$index]}"
  while IFS= read -r child; do
    [ -n "$child" ] && pids+=("$child")
  done < <(pgrep -P "$parent" 2>/dev/null || true)
  index=$((index + 1))
done

for pid in "${pids[@]}"; do
  kill -TERM "$pid" 2>/dev/null || true
done

for _ in 1 2 3 4 5; do
  any_running=false
  for pid in "${pids[@]}"; do
    if process_running "$pid"; then
      any_running=true
      break
    fi
  done
  [ "$any_running" = false ] && break
  sleep 1
done

for pid in "${pids[@]}"; do
  kill -KILL "$pid" 2>/dev/null || true
done
rm -f "$PID_FILE"

echo "OpenWorker stopped."
