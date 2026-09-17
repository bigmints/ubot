#!/bin/bash
# Fix @kutalia/whisper-node-addon platform directory naming
# The addon code looks for darwin-arm64/darwin-x64 but the package ships mac-arm64/mac-x64
ADDON_DIR="$(dirname "$0")/../node_modules/@kutalia/whisper-node-addon/dist"
if [ -d "$ADDON_DIR" ]; then
  [ -d "$ADDON_DIR/mac-arm64" ] && [ ! -e "$ADDON_DIR/darwin-arm64" ] && ln -sf mac-arm64 "$ADDON_DIR/darwin-arm64"
  [ -d "$ADDON_DIR/mac-x64" ] && [ ! -e "$ADDON_DIR/darwin-x64" ] && ln -sf mac-x64 "$ADDON_DIR/darwin-x64"
fi
exit 0
