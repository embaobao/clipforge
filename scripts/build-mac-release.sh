#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

PRODUCT_NAME="ClipForge"
VERSION="$(node -e 'console.log(JSON.parse(require("fs").readFileSync("package.json", "utf8")).version)')"
RAW_ARCH="$(uname -m)"
BUNDLE_IDENTIFIER="app.clipforge.desktop"

case "$RAW_ARCH" in
  arm64) ARCH="aarch64" ;;
  x86_64) ARCH="x64" ;;
  *) ARCH="$RAW_ARCH" ;;
esac

APP_BUNDLE_PATH="src-tauri/target/release/bundle/macos/${PRODUCT_NAME}.app"
RELEASE_DIR="release"
DMG_NAME="${PRODUCT_NAME}_${VERSION}_${ARCH}.dmg"
OUTPUT_DMG_PATH="${RELEASE_DIR}/${DMG_NAME}"
STAGING_DIR="${RELEASE_DIR}/.dmg-staging"
MUST_READ_SOURCE="release-assets/CLIPFORGE_MUST_READ.html"
MUST_READ_TARGET="0_安装必读_READ_ME_FIRST_ClipForge.html"

rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR" "$RELEASE_DIR"

pnpm tauri build --bundles app

if command -v codesign >/dev/null 2>&1; then
  codesign \
    --force \
    --deep \
    --sign - \
    --identifier "$BUNDLE_IDENTIFIER" \
    --requirements "=designated => identifier \"${BUNDLE_IDENTIFIER}\"" \
    "$APP_BUNDLE_PATH"
  codesign --verify --deep --verbose=2 "$APP_BUNDLE_PATH"
  codesign -d -r- "$APP_BUNDLE_PATH" 2>&1 | sed -n '1,4p'
  codesign -dv --verbose=2 "$APP_BUNDLE_PATH" 2>&1 | sed -n '1,12p'
else
  echo "warning: codesign not found; app bundle will not have a stable local identity" >&2
fi

cp -R "$APP_BUNDLE_PATH" "$STAGING_DIR/"
cp "$MUST_READ_SOURCE" "${STAGING_DIR}/${MUST_READ_TARGET}"
ln -s /Applications "${STAGING_DIR}/Applications"

rm -f "$OUTPUT_DMG_PATH"
hdiutil create \
  -volname "$PRODUCT_NAME" \
  -srcfolder "$STAGING_DIR" \
  -ov \
  -format UDZO \
  "$OUTPUT_DMG_PATH"

echo "Built release DMG at: $OUTPUT_DMG_PATH"
