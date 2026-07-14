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
UPDATER_CONFIG_PATH="${RELEASE_DIR}/.tauri-updater-public-key.json"
REQUIRE_SIGNATURES="${CLIPFORGE_RELEASE_REQUIRE_SIGNATURES:-0}"

cleanup_release_config() {
  rm -f "$UPDATER_CONFIG_PATH"
}
trap cleanup_release_config EXIT

rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR" "$RELEASE_DIR"
find "$RELEASE_DIR" -maxdepth 1 \( \
  -name "${PRODUCT_NAME}_*.dmg" -o \
  -name "${PRODUCT_NAME}_*.zip" -o \
  -name "${PRODUCT_NAME}_*_internal-test" -o \
  -name "CLIPFORGE_MUST_READ.html" \
\) -exec rm -rf {} +

node scripts/generate-release-manual.mjs
TAURI_BUILD_ARGS=(tauri build --bundles app)
if [[ -n "${CLIPFORGE_UPDATER_PUBLIC_KEY:-}" ]]; then
  node --input-type=module - "$UPDATER_CONFIG_PATH" "$CLIPFORGE_UPDATER_PUBLIC_KEY" <<'NODE'
import fs from "node:fs";

const [outputPath, pubkey] = process.argv.slice(2);
fs.writeFileSync(
  outputPath,
  `${JSON.stringify({ plugins: { updater: { pubkey } } }, null, 2)}\n`,
);
NODE
  TAURI_BUILD_ARGS+=(--config "$UPDATER_CONFIG_PATH")
elif [[ "$REQUIRE_SIGNATURES" == "1" ]]; then
  echo "error: CLIPFORGE_UPDATER_PUBLIC_KEY is required when CLIPFORGE_RELEASE_REQUIRE_SIGNATURES=1" >&2
  exit 1
else
  echo "warning: CLIPFORGE_UPDATER_PUBLIC_KEY is not set; using placeholder updater public key for local build" >&2
fi

pnpm "${TAURI_BUILD_ARGS[@]}"

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
cp "$MUST_READ_SOURCE" "${RELEASE_DIR}/CLIPFORGE_MUST_READ.html"
ln -s /Applications "${STAGING_DIR}/Applications"

rm -f "$OUTPUT_DMG_PATH"
hdiutil create \
  -volname "$PRODUCT_NAME" \
  -srcfolder "$STAGING_DIR" \
  -ov \
  -format UDZO \
  "$OUTPUT_DMG_PATH"

echo "Built release DMG at: $OUTPUT_DMG_PATH"
node scripts/sign-release-artifacts.mjs
node scripts/generate-release-metadata.mjs
