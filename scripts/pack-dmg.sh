#!/bin/sh
# Build the disk image from Fetch.app. Tauri's own DMG always stamps a
# volume icon (a second Fetch icon on the disk). This one does not.
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
app="$root/src-tauri/target/release/bundle/macos/Fetch.app"
dmg_dir="$root/src-tauri/target/release/bundle/dmg"
# No version in the name, so the README's releases/latest link never goes stale.
name="Fetch.dmg"
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

# "-" is ad-hoc (local only). A Developer ID name, or APPLE_SIGNING_IDENTITY,
# is what GitHub downloads need so Gatekeeper stops calling it malware.
identity="${APPLE_SIGNING_IDENTITY:--}"
codesign --force --sign "$identity" "$dmg"

if [ -n "${APPLE_ID:-}" ] && [ -n "${APPLE_PASSWORD:-}" ] && [ -n "${APPLE_TEAM_ID:-}" ]; then
  echo "submitting $name to Apple for notarization"
  xcrun notarytool submit "$dmg" \
    --apple-id "$APPLE_ID" \
    --password "$APPLE_PASSWORD" \
    --team-id "$APPLE_TEAM_ID" \
    --wait
  xcrun stapler staple "$dmg"
fi

echo "wrote $dmg"
