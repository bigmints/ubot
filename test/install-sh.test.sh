#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/youbot-install-test.XXXXXX")"
SANDBOX="$(cd "$SANDBOX" && pwd)"
trap 'rm -rf -- "$SANDBOX"' EXIT INT TERM

SOURCE="$SANDBOX/source"
TEST_HOME="$SANDBOX/home"
mkdir -p \
  "$SOURCE/packages/collection-engine/dist" \
  "$SOURCE/youbot-core/dist" \
  "$SOURCE/youbot-core/web-ui/out" \
  "$SOURCE/youbot-core/node_modules" \
  "$SOURCE/youbot-core/supabase/migrations" \
  "$SOURCE/cli" \
  "$TEST_HOME/.youbot/data"

printf '%s\n' '{"name":"@youbot/collection-engine","version":"0.0.0"}' > "$SOURCE/packages/collection-engine/package.json"
printf '%s\n' 'export const fixture = true;' > "$SOURCE/packages/collection-engine/dist/index.js"
printf '%s\n' '{"name":"youbot-core","version":"0.0.0"}' > "$SOURCE/youbot-core/package.json"
printf '%s\n' 'console.log("fixture-v1");' > "$SOURCE/youbot-core/dist/index.js"
printf '%s\n' '<!doctype html><title>fixture</title>' > "$SOURCE/youbot-core/web-ui/out/index.html"
printf '%s\n' '{"name":"web","version":"0.0.0"}' > "$SOURCE/youbot-core/web-ui/package.json"
printf '%s\n' '-- fixture migration' > "$SOURCE/youbot-core/supabase/migrations/001.sql"
printf '%s\n' '#!/usr/bin/env bash' 'printf "fixture-cli:%s:%s\\n" "$PWD" "$*"' > "$SOURCE/cli/youbot"
chmod 755 "$SOURCE/cli/youbot"
printf '%s\n' '{"fixture":"default"}' > "$SOURCE/cli/default-config.json"

printf '%s\n' '{"fixture":"preserved"}' > "$TEST_HOME/.youbot/config.json"
printf '%s\n' 'keep-me' > "$TEST_HOME/.youbot/data/sentinel"

run_installer() {
  HOME="$TEST_HOME" \
  YOUBOT_SOURCE_DIR="$SOURCE" \
  YOUBOT_INSTALL_SKIP_BUILD=1 \
  bash "$ROOT/install.sh"
}

run_installer
test -x "$TEST_HOME/.local/bin/youbot"
test -L "$TEST_HOME/.youbot/current"
test -x "$TEST_HOME/.youbot/current/bin/youbot"
test -f "$TEST_HOME/.youbot/current/lib/index.js"
test -f "$TEST_HOME/.youbot/current/web/index.html"
test -d "$TEST_HOME/.youbot/current/node_modules"
test "$(cat "$TEST_HOME/.youbot/data/sentinel")" = 'keep-me'
test "$(cat "$TEST_HOME/.youbot/config.json")" = '{"fixture":"preserved"}'
test "$(cat "$TEST_HOME/.youbot/current/.installed-version")" = 'local-source'
"$TEST_HOME/.local/bin/youbot" status | grep -F "fixture-cli:$TEST_HOME/.youbot/current:status" >/dev/null

printf '%s\n' 'console.log("fixture-v2");' > "$SOURCE/youbot-core/dist/index.js"
run_installer
grep -F 'fixture-v2' "$TEST_HOME/.youbot/current/lib/index.js" >/dev/null
test "$(cat "$TEST_HOME/.youbot/data/sentinel")" = 'keep-me'
test "$(cat "$TEST_HOME/.youbot/config.json")" = '{"fixture":"preserved"}'

printf '%s\n' 'console.log("fixture-v3");' > "$SOURCE/youbot-core/dist/index.js"
if HOME="$TEST_HOME" YOUBOT_SOURCE_DIR="$SOURCE" YOUBOT_INSTALL_SKIP_BUILD=1 YOUBOT_INSTALL_TEST_FAIL_AFTER_SWITCH=1 bash "$ROOT/install.sh" >"$SANDBOX/rollback.out" 2>&1; then
  echo 'installer unexpectedly ignored the injected cutover failure' >&2
  exit 1
fi
grep -F 'Injected test failure after release switch' "$SANDBOX/rollback.out" >/dev/null
grep -F 'fixture-v2' "$TEST_HOME/.youbot/current/lib/index.js" >/dev/null
"$TEST_HOME/.local/bin/youbot" status | grep -F "fixture-cli:$TEST_HOME/.youbot/current:status" >/dev/null
test "$(find "$TEST_HOME/.youbot/releases" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')" = 2

mkdir "$TEST_HOME/.youbot.install-lock"
if run_installer >"$SANDBOX/locked.out" 2>&1; then
  echo 'installer unexpectedly ignored its concurrency lock' >&2
  exit 1
fi
grep -F 'Another Youbot install appears to be running' "$SANDBOX/locked.out" >/dev/null
rmdir "$TEST_HOME/.youbot.install-lock"

if HOME="$TEST_HOME" YOUBOT_HOME="$TEST_HOME/../escaped" YOUBOT_SOURCE_DIR="$SOURCE" YOUBOT_INSTALL_SKIP_BUILD=1 bash "$ROOT/install.sh" >"$SANDBOX/traversal.out" 2>&1; then
  echo 'installer unexpectedly accepted a parent-directory install path' >&2
  exit 1
fi
grep -F 'cannot contain empty, current-directory, or parent-directory segments' "$SANDBOX/traversal.out" >/dev/null

if HOME="$TEST_HOME" YOUBOT_NODE_HOME="$TEST_HOME/.youbot/data" YOUBOT_SOURCE_DIR="$SOURCE" YOUBOT_INSTALL_SKIP_BUILD=1 bash "$ROOT/install.sh" >"$SANDBOX/overlap.out" 2>&1; then
  echo 'installer unexpectedly accepted overlapping app and Node paths' >&2
  exit 1
fi
grep -F 'must not overlap' "$SANDBOX/overlap.out" >/dev/null

printf '%s\n' "$$" > "$TEST_HOME/.youbot/youbot.pid"
if run_installer >"$SANDBOX/running.out" 2>&1; then
  echo 'installer unexpectedly updated a running installation' >&2
  exit 1
fi
grep -F 'Stop Youbot before installing an update' "$SANDBOX/running.out" >/dev/null
rm "$TEST_HOME/.youbot/youbot.pid"

echo 'install.sh disposable-home test passed'
