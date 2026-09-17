#!/usr/bin/env bash
# Build and start a production-mode Youbot instance from this checkout.
set -Eeuo pipefail
umask 077

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORE_DIR="$ROOT_DIR/youbot-core"
WEB_DIR="$CORE_DIR/web-ui"
PID_FILE="$CORE_DIR/youbot.pid"
LOG_FILE="$CORE_DIR/youbot.log"
PORT="${PORT:-5080}"
YOUBOT_HOST="${YOUBOT_HOST:-127.0.0.1}"

for command_name in node npm curl lsof ps; do
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

if [[ -f "$PID_FILE" ]]; then
  existing_pid="$(cat "$PID_FILE")"
  if kill -0 "$existing_pid" 2>/dev/null; then
    if pid_belongs_to_checkout "$existing_pid"; then
      echo "Youbot is already running (PID $existing_pid)."
      echo "Dashboard: http://$YOUBOT_HOST:$PORT"
      exit 0
    fi
    echo "PID file points to a process not owned by this checkout; refusing to continue." >&2
    exit 1
  fi
  rm -f "$PID_FILE"
fi

if lsof -tiTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $PORT is already in use; refusing to stop an unrelated process." >&2
  exit 1
fi

[[ -d "$CORE_DIR/node_modules" ]] || (cd "$CORE_DIR" && npm ci)
[[ -d "$WEB_DIR/node_modules" ]] || (cd "$WEB_DIR" && npm ci)

echo "Building backend..."
(cd "$CORE_DIR" && npm run build)

echo "Building dashboard..."
(cd "$WEB_DIR" && npm run build)

echo "Preparing static dashboard assets..."
rm -rf "$CORE_DIR/web"
mkdir -p "$CORE_DIR/web"
cp -R "$WEB_DIR/out/." "$CORE_DIR/web/"

echo "Starting Youbot on http://$YOUBOT_HOST:$PORT ..."
: >"$LOG_FILE"
chmod 600 "$LOG_FILE"
(
  cd "$CORE_DIR"
  nohup env \
    PORT="$PORT" \
    YOUBOT_HOST="$YOUBOT_HOST" \
    YOUBOT_HOME="$CORE_DIR" \
    NODE_ENV=production \
    node dist/index.js >"$LOG_FILE" 2>&1 &
  echo "$!" >"$PID_FILE"
)

started_pid="$(cat "$PID_FILE")"
for _ in {1..30}; do
  if curl --silent --fail --max-time 2 "http://$YOUBOT_HOST:$PORT/health" >/dev/null; then
    echo "Youbot is ready (PID $started_pid)."
    echo "Dashboard: http://$YOUBOT_HOST:$PORT"
    echo "Logs: $LOG_FILE"
    exit 0
  fi
  if ! kill -0 "$started_pid" 2>/dev/null; then
    break
  fi
  sleep 1
done

echo "Youbot failed its readiness check." >&2
kill "$started_pid" 2>/dev/null || true
rm -f "$PID_FILE"
tail -n 80 "$LOG_FILE" >&2 || true
exit 1
