#!/bin/bash
set -Eeuo pipefail
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
trap 'echo "Setup stopped. Check your internet connection, then open Start Youbot again. See START HERE.md for help."; read -r -p "Press Return to close."' ERR
if command -v node >/dev/null 2>&1 && node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' 2>/dev/null; then
  exec node "$ROOT_DIR/scripts/start-desktop.mjs"
fi
echo "Welcome to Youbot. Getting the tools ready for this computer…"
case "$(uname -m)" in arm64) NODE_ARCH=arm64 ;; x86_64) NODE_ARCH=x64 ;; *) echo 'This Mac is not supported.'; exit 1 ;; esac
RUNTIME_DIR="$HOME/Library/Application Support/Youbot/runtime"
mkdir -p "$RUNTIME_DIR"
if [[ ! -x "$RUNTIME_DIR/node/bin/node" ]]; then
  DOWNLOAD_DIR="$(mktemp -d)"
  curl --fail --location --proto '=https' --tlsv1.2 'https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt' -o "$DOWNLOAD_DIR/checksums"
  ARCHIVE_NAME="$(awk -v suffix="-darwin-$NODE_ARCH.tar.gz" '$2 ~ suffix"$" {print $2; exit}' "$DOWNLOAD_DIR/checksums")"
  [[ "$ARCHIVE_NAME" =~ ^node-v22\.[0-9]+\.[0-9]+-darwin-(arm64|x64)\.tar\.gz$ ]]
  curl --fail --location --proto '=https' --tlsv1.2 "https://nodejs.org/dist/latest-v22.x/$ARCHIVE_NAME" -o "$DOWNLOAD_DIR/$ARCHIVE_NAME"
  (cd "$DOWNLOAD_DIR" && awk -v name="$ARCHIVE_NAME" '$2 == name {print}' checksums | shasum -a 256 -c -)
  mkdir -p "$RUNTIME_DIR/node"
  tar -xzf "$DOWNLOAD_DIR/$ARCHIVE_NAME" -C "$RUNTIME_DIR/node" --strip-components=1
  rm -rf "$DOWNLOAD_DIR"
fi
export PATH="$RUNTIME_DIR/node/bin:$PATH"
exec "$RUNTIME_DIR/node/bin/node" "$ROOT_DIR/scripts/start-desktop.mjs"
