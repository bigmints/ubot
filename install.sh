#!/usr/bin/env bash
# User-scoped Youbot installer for macOS and Linux.
set -Eeuo pipefail
umask 077

readonly PROGRAM="Youbot"
readonly REPOSITORY="${YOUBOT_REPOSITORY:-Bigmints-com/ubot}"
readonly REQUESTED_REF="${YOUBOT_INSTALL_REF:-master}"
readonly INSTALL_HOME="${YOUBOT_HOME:-$HOME/.youbot}"
readonly BIN_DIR="${YOUBOT_BIN_DIR:-$HOME/.local/bin}"
readonly DATA_ROOT="${XDG_DATA_HOME:-$HOME/.local/share}/youbot"
readonly NODE_HOME="${YOUBOT_NODE_HOME:-$DATA_ROOT/runtime/node}"
readonly SOURCE_OVERRIDE="${YOUBOT_SOURCE_DIR:-}"
readonly SKIP_BUILD="${YOUBOT_INSTALL_SKIP_BUILD:-0}"
readonly TEST_FAIL_AFTER_SWITCH="${YOUBOT_INSTALL_TEST_FAIL_AFTER_SWITCH:-0}"

TEMP_DIR=""
LOCK_DIR=""
LOCK_ACQUIRED=false
WRAPPER_BACKUP=""
WRAPPER_INSTALLED=false
COMMIT=""
INSTALLING=false
RELEASE_DIR=""
STAGE_DIR=""
CURRENT_OLD_TARGET=""
CURRENT_SWAPPED=false

say() { printf '%s\n' "$*"; }
fail() { printf '%s\n' "Error: $*" >&2; exit 1; }

remove_scoped_path() {
  local target="$1"
  case "$target" in
    "$INSTALL_HOME"/*|"$TEMP_DIR"|"$TEMP_DIR"/*|"$NODE_HOME".previous.*|"$LOCK_DIR") rm -rf -- "$target" ;;
    *) fail "Refusing to remove an unexpected path: $target" ;;
  esac
}

rollback() {
  [ "$INSTALLING" = true ] || return 0
  if [ "$CURRENT_SWAPPED" = true ]; then
    rm -f -- "$INSTALL_HOME/current.new.$$"
    if [ -n "$CURRENT_OLD_TARGET" ]; then
      ln -s "$CURRENT_OLD_TARGET" "$INSTALL_HOME/current.new.$$"
      rm -f -- "$INSTALL_HOME/current"
      mv -- "$INSTALL_HOME/current.new.$$" "$INSTALL_HOME/current"
    else
      rm -f -- "$INSTALL_HOME/current"
    fi
  fi
  if [ -n "$STAGE_DIR" ] && [ -d "$STAGE_DIR" ]; then
    remove_scoped_path "$STAGE_DIR"
  fi
  if [ -n "$RELEASE_DIR" ] && [ -d "$RELEASE_DIR" ]; then
    remove_scoped_path "$RELEASE_DIR"
  fi
  if [ -n "$WRAPPER_BACKUP" ] && { [ -e "$WRAPPER_BACKUP" ] || [ -L "$WRAPPER_BACKUP" ]; }; then
    mv -- "$WRAPPER_BACKUP" "$BIN_DIR/youbot"
  elif [ "$WRAPPER_INSTALLED" = true ]; then
    rm -f -- "$BIN_DIR/youbot"
  fi
}

cleanup() {
  local status=$?
  if [ "$status" -ne 0 ]; then rollback || true; fi
  [ -z "$TEMP_DIR" ] || remove_scoped_path "$TEMP_DIR"
  if [ "$LOCK_ACQUIRED" = true ]; then remove_scoped_path "$LOCK_DIR"; fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required."
}

assert_safe_home_path() {
  local label="$1" target="$2" relative current segment
  case "$target" in
    "$HOME"/*) ;;
    *) fail "$label must be a dedicated directory inside your user account." ;;
  esac
  relative="${target#"$HOME"/}"
  case "/$relative/" in
    *'//'*|*'/./'*|*'/../'*) fail "$label cannot contain empty, current-directory, or parent-directory segments." ;;
  esac
  current="$HOME"
  local old_ifs="$IFS"
  IFS='/'
  for segment in $relative; do
    current="$current/$segment"
    if [ -L "$current" ]; then
      IFS="$old_ifs"
      fail "$label cannot use a symbolic-link path: $current"
    fi
  done
  IFS="$old_ifs"
}

assert_disjoint_paths() {
  local first_label="$1" first="$2" second_label="$3" second="$4"
  case "$first/" in "$second/"*) fail "$first_label must not overlap $second_label." ;; esac
  case "$second/" in "$first/"*) fail "$second_label must not overlap $first_label." ;; esac
}

verify_sha256() {
  local expected="$1" file="$2" actual
  if command -v shasum >/dev/null 2>&1; then
    actual="$(shasum -a 256 "$file" | awk '{print $1}')"
  elif command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$file" | awk '{print $1}')"
  else
    fail "A SHA-256 tool is required (shasum or sha256sum)."
  fi
  [ "$actual" = "$expected" ] || fail "Checksum verification failed for $(basename "$file")."
}

download() {
  curl --fail --location --silent --show-error --retry 3 \
    --connect-timeout 20 --proto '=https' --tlsv1.2 "$1" -o "$2"
}

case "$(uname -s)" in
  Darwin) NODE_PLATFORM="darwin" ;;
  Linux) NODE_PLATFORM="linux" ;;
  *) fail "This installer supports macOS and Linux. On Windows, use Start Youbot.cmd." ;;
esac

case "$(uname -m)" in
  arm64|aarch64) NODE_ARCH="arm64" ;;
  x86_64|amd64) NODE_ARCH="x64" ;;
  *) fail "This processor is not supported. Youbot requires a 64-bit Arm or Intel/AMD device." ;;
esac

[ "$(id -u)" -ne 0 ] || fail "Do not run this installer with sudo or as root."
assert_safe_home_path YOUBOT_HOME "$INSTALL_HOME"
assert_safe_home_path YOUBOT_BIN_DIR "$BIN_DIR"
assert_safe_home_path YOUBOT_NODE_HOME "$NODE_HOME"
assert_disjoint_paths YOUBOT_HOME "$INSTALL_HOME" YOUBOT_BIN_DIR "$BIN_DIR"
assert_disjoint_paths YOUBOT_HOME "$INSTALL_HOME" YOUBOT_NODE_HOME "$NODE_HOME"
assert_disjoint_paths YOUBOT_BIN_DIR "$BIN_DIR" YOUBOT_NODE_HOME "$NODE_HOME"
case "$SKIP_BUILD" in 0|1) ;; *) fail "YOUBOT_INSTALL_SKIP_BUILD must be 0 or 1." ;; esac
[ "$SKIP_BUILD" = 0 ] || [ -n "$SOURCE_OVERRIDE" ] || fail "Skipping the build is allowed only with an explicit local source directory."
case "$TEST_FAIL_AFTER_SWITCH" in 0|1) ;; *) fail "YOUBOT_INSTALL_TEST_FAIL_AFTER_SWITCH must be 0 or 1." ;; esac
[ "$TEST_FAIL_AFTER_SWITCH" = 0 ] || { [ "$SKIP_BUILD" = 1 ] && [ -n "$SOURCE_OVERRIDE" ]; } || fail "The failure injection is allowed only for a skipped local test build."

require_command curl
require_command tar
require_command awk
require_command install
require_command mktemp
require_command tr

TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/youbot-install.XXXXXX")"
LOCK_DIR="$INSTALL_HOME.install-lock"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  fail "Another Youbot install appears to be running ($LOCK_DIR)."
fi
LOCK_ACQUIRED=true
printf '%s\n' "$$" > "$LOCK_DIR/pid"

if [ -f "$INSTALL_HOME/youbot.pid" ]; then
  running_pid="$(cat "$INSTALL_HOME/youbot.pid" 2>/dev/null || true)"
  if [[ "$running_pid" =~ ^[0-9]+$ ]] && kill -0 "$running_pid" 2>/dev/null; then
    fail "Stop Youbot before installing an update."
  fi
fi

NODE_BIN="$(command -v node || true)"
if [ -n "$NODE_BIN" ] && "$NODE_BIN" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' 2>/dev/null; then
  NPM_BIN="$(command -v npm || true)"
  [ -n "$NPM_BIN" ] || fail "Node.js is installed, but npm is missing."
else
  say "Installing a private Node.js 22 runtime…"
  checksums="$TEMP_DIR/node-checksums"
  download "https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt" "$checksums"
  archive_name="$(awk -v suffix="-$NODE_PLATFORM-$NODE_ARCH.tar.gz" '$2 ~ suffix "$" {print $2; exit}' "$checksums")"
  [[ "$archive_name" =~ ^node-v22\.[0-9]+\.[0-9]+-(darwin|linux)-(arm64|x64)\.tar\.gz$ ]] || fail "Node.js did not publish a supported runtime for this device."
  expected="$(awk -v name="$archive_name" '$2 == name {print $1; exit}' "$checksums")"
  [ -n "$expected" ] || fail "Node.js checksum was not found."
  download "https://nodejs.org/dist/latest-v22.x/$archive_name" "$TEMP_DIR/$archive_name"
  verify_sha256 "$expected" "$TEMP_DIR/$archive_name"
  node_stage="$TEMP_DIR/node"
  mkdir -p "$node_stage"
  tar -xzf "$TEMP_DIR/$archive_name" -C "$node_stage" --strip-components=1
  mkdir -p "$(dirname "$NODE_HOME")"
  node_previous="$NODE_HOME.previous.$$"
  if [ -e "$NODE_HOME" ]; then mv -- "$NODE_HOME" "$node_previous"; fi
  if ! mv -- "$node_stage" "$NODE_HOME"; then
    [ ! -e "$node_previous" ] || mv -- "$node_previous" "$NODE_HOME"
    fail "Could not install the private Node.js runtime."
  fi
  [ ! -e "$node_previous" ] || remove_scoped_path "$node_previous"
  NODE_BIN="$NODE_HOME/bin/node"
  NPM_BIN="$NODE_HOME/bin/npm"
fi
export PATH="$(dirname "$NODE_BIN"):$PATH"

if [ -n "$SOURCE_OVERRIDE" ]; then
  SOURCE_DIR="$(cd "$SOURCE_OVERRIDE" 2>/dev/null && pwd)" || fail "Local source directory was not found."
  COMMIT="local-source"
else
  [[ "$REPOSITORY" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || fail "YOUBOT_REPOSITORY must be in owner/repository form."
  [[ "$REQUESTED_REF" =~ ^[A-Za-z0-9._/-]+$ ]] || fail "YOUBOT_INSTALL_REF contains unsupported characters."
  if [[ "$REQUESTED_REF" =~ ^[0-9a-fA-F]{40}$ ]]; then
    COMMIT="$(printf '%s' "$REQUESTED_REF" | tr '[:upper:]' '[:lower:]')"
  else
    metadata="$TEMP_DIR/commit.json"
    download "https://api.github.com/repos/$REPOSITORY/commits/$REQUESTED_REF" "$metadata"
    COMMIT="$("$NODE_BIN" -e 'const fs=require("node:fs");const value=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));if(!/^[0-9a-f]{40}$/i.test(value.sha||""))process.exit(1);process.stdout.write(value.sha.toLowerCase())' "$metadata")" || fail "Could not resolve the requested Youbot version."
  fi
  say "Downloading Youbot at commit ${COMMIT:0:12}…"
  archive="$TEMP_DIR/youbot.tar.gz"
  download "https://api.github.com/repos/$REPOSITORY/tarball/$COMMIT" "$archive"
  if tar -tzf "$archive" | awk '/(^\/)|(^|\/)\.\.($|\/)/ {found=1} END {exit !found}'; then
    fail "The downloaded archive contains an unsafe path."
  fi
  if tar -tvzf "$archive" | awk 'substr($1,1,1) == "l" || substr($1,1,1) == "h" {found=1} END {exit !found}'; then
    fail "The downloaded archive contains a link and cannot be installed safely."
  fi
  SOURCE_DIR="$TEMP_DIR/source"
  mkdir -p "$SOURCE_DIR"
  tar -xzf "$archive" -C "$SOURCE_DIR" --strip-components=1
fi

for required in \
  packages/collection-engine/package.json \
  youbot-core/package.json \
  youbot-core/web-ui/package.json \
  cli/youbot cli/default-config.json; do
  [ -e "$SOURCE_DIR/$required" ] || fail "The selected source is missing $required."
done

if [ "$SKIP_BUILD" = 0 ]; then
  say "Building Youbot. This may take several minutes…"
  "$NPM_BIN" --prefix "$SOURCE_DIR/packages/collection-engine" ci
  "$NPM_BIN" --prefix "$SOURCE_DIR/packages/collection-engine" run build
  "$NPM_BIN" --prefix "$SOURCE_DIR/youbot-core" ci
  "$NPM_BIN" --prefix "$SOURCE_DIR/youbot-core/web-ui" ci
  "$NPM_BIN" --prefix "$SOURCE_DIR/youbot-core" run build
  "$NPM_BIN" --prefix "$SOURCE_DIR/youbot-core/web-ui" run build
  "$NPM_BIN" --prefix "$SOURCE_DIR/youbot-core" prune --omit=dev
fi

for required in youbot-core/dist/index.js youbot-core/web-ui/out/index.html youbot-core/node_modules; do
  [ -e "$SOURCE_DIR/$required" ] || fail "The build did not produce $required."
done

say "Installing Youbot for $(id -un)…"
install -d -m 700 "$INSTALL_HOME" "$INSTALL_HOME/data" "$INSTALL_HOME/logs" \
  "$INSTALL_HOME/sessions" "$INSTALL_HOME/creds" "$INSTALL_HOME/browser-profile" \
  "$INSTALL_HOME/backups" "$INSTALL_HOME/workspace" "$INSTALL_HOME/custom" \
  "$INSTALL_HOME/releases"
install -d -m 755 "$BIN_DIR"

if [ -L "$INSTALL_HOME/current" ]; then
  CURRENT_OLD_TARGET="$(readlink "$INSTALL_HOME/current")"
  case "$CURRENT_OLD_TARGET" in
    releases/*) ;;
    *) fail "$INSTALL_HOME/current points outside the managed releases directory." ;;
  esac
  case "/$CURRENT_OLD_TARGET/" in
    *'//'*|*'/./'*|*'/../'*) fail "$INSTALL_HOME/current contains an unsafe target." ;;
  esac
elif [ -e "$INSTALL_HOME/current" ]; then
  fail "$INSTALL_HOME/current must be a symbolic link managed by the installer."
fi

release_suffix="${COMMIT:0:12}-$(date -u +%Y%m%dT%H%M%SZ)-$$"
STAGE_DIR="$INSTALL_HOME/releases/.stage.$$"
RELEASE_DIR="$INSTALL_HOME/releases/$release_suffix"
mkdir -p "$STAGE_DIR/bin"
INSTALLING=true
cp -R "$SOURCE_DIR/youbot-core/dist" "$STAGE_DIR/lib"
cp -R "$SOURCE_DIR/youbot-core/web-ui/out" "$STAGE_DIR/web"
cp -R "$SOURCE_DIR/youbot-core/node_modules" "$STAGE_DIR/node_modules"
if [ -L "$STAGE_DIR/node_modules/@youbot/collection-engine" ]; then
  remove_scoped_path "$STAGE_DIR/node_modules/@youbot/collection-engine"
  mkdir -p "$STAGE_DIR/node_modules/@youbot/collection-engine"
  cp -R "$SOURCE_DIR/packages/collection-engine/dist" "$STAGE_DIR/node_modules/@youbot/collection-engine/dist"
  [ ! -d "$SOURCE_DIR/packages/collection-engine/dist-cjs" ] || cp -R "$SOURCE_DIR/packages/collection-engine/dist-cjs" "$STAGE_DIR/node_modules/@youbot/collection-engine/dist-cjs"
  install -m 644 "$SOURCE_DIR/packages/collection-engine/package.json" "$STAGE_DIR/node_modules/@youbot/collection-engine/package.json"
fi
if [ -d "$SOURCE_DIR/youbot-core/supabase/migrations" ]; then
  cp -R "$SOURCE_DIR/youbot-core/supabase/migrations" "$STAGE_DIR/migrations"
else
  mkdir -p "$STAGE_DIR/migrations"
fi
install -m 644 "$SOURCE_DIR/youbot-core/package.json" "$STAGE_DIR/package.json"
install -m 600 "$SOURCE_DIR/cli/default-config.json" "$STAGE_DIR/default-config.json"
install -m 755 "$SOURCE_DIR/cli/youbot" "$STAGE_DIR/bin/youbot"
printf '%s\n' "$COMMIT" > "$STAGE_DIR/.installed-version"
mv -- "$STAGE_DIR" "$RELEASE_DIR"

ln -s "releases/$release_suffix" "$INSTALL_HOME/current.new.$$"
"$NODE_BIN" -e 'require("node:fs").renameSync(process.argv[1], process.argv[2])' \
  "$INSTALL_HOME/current.new.$$" "$INSTALL_HOME/current"
CURRENT_SWAPPED=true
if [ "$TEST_FAIL_AFTER_SWITCH" = 1 ]; then
  fail "Injected test failure after release switch."
fi

if [ ! -f "$INSTALL_HOME/config.json" ]; then
  install -m 600 "$INSTALL_HOME/current/default-config.json" "$INSTALL_HOME/config.json"
else
  chmod 600 "$INSTALL_HOME/config.json"
fi

wrapper="$TEMP_DIR/youbot-wrapper"
{
  printf '%s\n' '#!/usr/bin/env bash' '# Installed by Youbot install.sh.' 'set -Eeuo pipefail'
  printf 'export YOUBOT_HOME=%q\n' "$INSTALL_HOME"
  printf 'export YOUBOT_APP_HOME=%q\n' "$INSTALL_HOME/current"
  if [[ "$NODE_BIN" == "$NODE_HOME"/* ]]; then
    printf 'export PATH=%q:"$PATH"\n' "$NODE_HOME/bin"
  fi
  printf 'cd %q\n' "$INSTALL_HOME/current"
  printf 'exec %q "$@"\n' "$INSTALL_HOME/current/bin/youbot"
} > "$wrapper"
if [ -e "$BIN_DIR/youbot" ] || [ -L "$BIN_DIR/youbot" ]; then
  WRAPPER_BACKUP="$TEMP_DIR/previous-youbot-wrapper"
  mv -- "$BIN_DIR/youbot" "$WRAPPER_BACKUP"
fi
install -m 755 "$wrapper" "$BIN_DIR/youbot.new.$$"
mv -- "$BIN_DIR/youbot.new.$$" "$BIN_DIR/youbot"
WRAPPER_INSTALLED=true

INSTALLING=false
WRAPPER_BACKUP=""

say ""
say "$PROGRAM is installed."
say "Start it with: $BIN_DIR/youbot start"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) say "Add $BIN_DIR to your PATH to run: youbot start" ;;
esac
say "Then open http://localhost:11490 and finish setup."
