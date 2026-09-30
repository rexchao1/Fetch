#!/bin/sh
# Copy this machine's Node into the app as a Tauri sidecar
# (bundle.externalBin in tauri.conf.json), so Fetch.app runs without Node
# installed. Tauri wants the file named for the target triple; it lands in
# Fetch.app/Contents/MacOS/node, where src-tauri/src/main.rs looks for it.
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
node_bin=$(command -v node)
# Version managers (mise, nvm) put a shim or symlink on PATH; take the real binary.
real=$(node -p 'process.execPath')
triple=$(rustc -vV | sed -n 's/^host: //p')
mkdir -p "$root/src-tauri/binaries"
cp "$real" "$root/src-tauri/binaries/node-$triple"
chmod 755 "$root/src-tauri/binaries/node-$triple"
echo "prepare-node: $node_bin ($(node -v)) -> src-tauri/binaries/node-$triple"
