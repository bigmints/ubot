#!/usr/bin/env bash
# Gracefully stop the checkout-local Youbot process.
set -Eeuo pipefail
umask 077

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORE_DIR="$ROOT_DIR/youbot-core"
PID_FILE="$CORE_DIR/youbot.pid"

for command_name in lsof ps; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "Missing required command: $command_name" >&2
    exit 1
  }
done

pid_belongs_to_checkout() {
  local pid="$1" cwd command_line
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1)"
  command_line="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  [[ "$cwd" == "$CORE_DIR" && "$command_line" == *"dist/index.js"* ]]
}

if [[ ! -f "$PID_FILE" ]]; then
  echo "Youbot is not running from this checkout (no PID file)."
  exit 0
fi

pid="$(cat "$PID_FILE")"
if ! kill -0 "$pid" 2>/dev/null; then
  rm -f "$PID_FILE"
  echo "Removed stale PID file."
  exit 0
fi

if ! pid_belongs_to_checkout "$pid"; then
  echo "PID file points to a process not owned by this checkout; refusing to stop it." >&2
  exit 1
fi

echo "Stopping Youbot (PID $pid)..."
kill -TERM "$pid"

for _ in {1..30}; do
  if ! kill -0 "$pid" 2>/dev/null; then
    rm -f "$PID_FILE"
    echo "Youbot stopped."
    exit 0
  fi
  sleep 0.5
done

echo "Graceful shutdown timed out; forcing PID $pid to stop." >&2
kill -KILL "$pid" 2>/dev/null || true
rm -f "$PID_FILE"
