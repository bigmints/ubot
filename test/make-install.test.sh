#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/youbot-make-install.XXXXXX")"
trap 'rm -rf -- "$SANDBOX"' EXIT
SOURCE="$SANDBOX/source"
DEST="$SANDBOX/installed"
mkdir -p "$SOURCE/youbot-core/dist" "$SOURCE/youbot-core/web-ui/out" \
  "$SOURCE/youbot-core/node_modules/@youbot" "$SOURCE/cli" \
  "$SOURCE/packages/collection-engine/dist" "$SOURCE/packages/collection-engine/dist-cjs"
cp "$ROOT/Makefile" "$SOURCE/Makefile"
printf 'export const value = 42;\n' > "$SOURCE/packages/collection-engine/dist/index.js"
printf 'module.exports = {value:42};\n' > "$SOURCE/packages/collection-engine/dist-cjs/index.js"
printf '{"type":"commonjs"}\n' > "$SOURCE/packages/collection-engine/dist-cjs/package.json"
printf '{"name":"@youbot/collection-engine","type":"module","main":"./dist-cjs/index.js","exports":{"import":"./dist/index.js","require":"./dist-cjs/index.js"}}\n' > "$SOURCE/packages/collection-engine/package.json"
ln -s ../../../packages/collection-engine "$SOURCE/youbot-core/node_modules/@youbot/collection-engine"
printf 'console.log("fixture");\n' > "$SOURCE/youbot-core/dist/index.js"
printf '<html>fixture</html>\n' > "$SOURCE/youbot-core/web-ui/out/index.html"
printf '#!/bin/sh\nexit 0\n' > "$SOURCE/cli/youbot"
printf '{}\n' > "$SOURCE/cli/default-config.json"
# Exercise the real install recipe; fixtures replace only its build prerequisites.
make -s -C "$SOURCE" -o build install YOUBOT_HOME="$DEST" INSTALL_BIN_DIR="$SANDBOX/bin"
mv "$SOURCE" "$SANDBOX/source-unavailable"
node - "$DEST" <<'JS'
const { createRequire } = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const home = process.argv[2];
const requireInstalled = createRequire(path.join(home, 'lib', 'index.js'));
if (requireInstalled('@youbot/collection-engine').value !== 42) throw Error('Installed dependency failed');
if (fs.lstatSync(path.join(home,'node_modules/@youbot/collection-engine')).isSymbolicLink()) throw Error('Dependency still linked');
JS
echo 'make install standalone dependency test passed'
