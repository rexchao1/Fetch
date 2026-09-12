#!/bin/sh
# Build the disk image from Fetch.app. Tauri's own DMG always stamps a
# volume icon (a second Fetch icon on the disk). This one does not.
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
app="$root/src-tauri/target/release/bundle/macos/Fetch.app"
dmg_dir="$root/src-tauri/target/release/bundle/dmg"
name="Fetch_0.1.0_aarch64.dmg"
dmg="$dmg_dir/$name"

if [ ! -d "$app" ]; then
  echo "pack-dmg: Fetch.app is missing. Run npm run desktop:build first." >&2
  exit 1
fi

for vol in /Volumes/Fetch "/Volumes/Fetch 1"; do
  [ -d "$vol" ] || continue
  hdiutil detach "$vol" -force -quiet 2>/dev/null || true
done

mkdir -p "$dmg_dir"
staging=$(mktemp -d /tmp/fetch-dmg.XXXXXX)
trap 'rm -rf "$staging"' EXIT
cp -R "$app" "$staging/Fetch.app"
ln -s /Applications "$staging/Applications"

rm -f "$dmg"
hdiutil create \
  -volname Fetch \
  -srcfolder "$staging" \
  -ov \
  -format UDZO \
  -imagekey zlib-level=9 \
  "$dmg" \
  -quiet

rm -f "$dmg_dir/icon.icns"
codesign --force --sign - "$dmg"
echo "wrote $dmg"
