#!/bin/sh
# Recreate the Tauri DMG without a custom volume icon.
# Tauri always passes --volicon (the app icns), so the mounted disk
# shows a second Fetch icon next to Fetch.app. A plain disk is enough.
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
dmg_dir="$root/src-tauri/target/release/bundle/dmg"
app_dir="$root/src-tauri/target/release/bundle/macos"
name="Fetch_0.1.0_aarch64.dmg"
app="Fetch.app"
script="$dmg_dir/bundle_dmg.sh"

if [ ! -x "$script" ] || [ ! -d "$app_dir/$app" ]; then
  echo "pack-dmg: run npm run desktop:build first" >&2
  exit 1
fi

rm -f "$app_dir/$name" "$dmg_dir/$name"
(
  cd "$app_dir"
  "$script" \
    --volname Fetch \
    --icon "$app" 180 170 \
    --app-drop-link 480 170 \
    --window-size 660 400 \
    --hide-extension "$app" \
    "$name" \
    "$app"
)
mv "$app_dir/$name" "$dmg_dir/$name"
rm -f "$dmg_dir/icon.icns"
echo "wrote $dmg_dir/$name"
