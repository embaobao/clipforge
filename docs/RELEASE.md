# ClipForge Release Contract

ClipForge first-stage distribution uses GitHub Releases.

## Artifacts

Release artifacts use this naming rule:

- `ClipForge_<version>_aarch64.dmg`
- `ClipForge_<version>_x64.dmg`
- optional updater signatures: `<artifact>.sig`
- `latest.json`
- `checksums.txt`
- `CLIPFORGE_MUST_READ.html`

`scripts/build-mac-release.sh` creates the local macOS DMG and then runs
`scripts/generate-release-metadata.mjs`.

## Manifest

`release/latest.json` follows the Tauri updater manifest shape:

- `version`
- `notes`
- `pub_date`
- `platforms[darwin-aarch64 | darwin-x86_64].url`
- `platforms[...].signature`
- `clipforge.channel`
- `clipforge.minAppVersion`
- `clipforge.critical`
- `clipforge.permissionsChanged`

The release URL defaults to:

`https://github.com/<GITHUB_REPOSITORY>/releases/download/v<version>/<artifact>`

Override it with `CLIPFORGE_RELEASE_BASE_URL` for test releases.

## Checksums

`release/checksums.txt` contains SHA-256 rows:

`<sha256>  <artifact>`

## Preflight

Run these checks before publishing artifacts:

```bash
pnpm check:i18n
pnpm build
cd src-tauri && cargo check
```

## Channels

- `stable`: normal public release.
- `prerelease`: GitHub prerelease; set `CLIPFORGE_RELEASE_CHANNEL=prerelease`.

Do not mix stable and prerelease artifacts in one GitHub release.

## Internal Test Marker

The first internal test build is tracked by the git tag
`v0.1.0-internal.1`. The app bundle version remains `0.1.0` for macOS
compatibility; the internal marker lives in git/release metadata rather than
`CFBundleShortVersionString`.

The settings window already displays the current bundle version, bundle id,
target platform, and updater endpoint. Update checking currently supports the
local manifest path from `CLIPFORGE_UPDATE_MANIFEST` and persists the last
check state. Unsigned local builds cannot perform silent install; install still
requires a signed/notarized release artifact.

## Signing

Updater signing uses Tauri v2 signer keys. The repository does not store the
private key or the updater public key. Release builds inject the public key via a
temporary Tauri config overlay and sign the final release artifacts before
`latest.json` is generated.

Generate keys outside the repository:

```bash
pnpm tauri signer generate --write-keys ~/.tauri/clipforge.key
```

Build signed release updater artifacts only in the release environment:

```bash
export CLIPFORGE_RELEASE_REQUIRE_SIGNATURES=1
export CLIPFORGE_UPDATER_PUBLIC_KEY="$(cat ~/.tauri/clipforge.key.pub)"
export TAURI_SIGNING_PRIVATE_KEY_PATH="$HOME/.tauri/clipforge.key"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
pnpm build:mac-release
```

`scripts/build-mac-release.sh` fails fast in strict mode if the public key or
signing key is missing. It signs each `release/ClipForge_<version>_<arch>.dmg`
with `pnpm tauri signer sign`, writes `<artifact>.sig`, and
`scripts/generate-release-metadata.mjs` copies that signature into
`release/latest.json`.

Local smoke builds may omit these variables; they produce unsigned artifacts and
print a warning. Do not publish unsigned artifacts.
