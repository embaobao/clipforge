<p align="center">
  <img src="src-tauri/icons/icon.png" width="96" alt="ClipForge icon" />
</p>

<h1 align="center">ClipForge</h1>

<p align="center">
  A fast local clipboard workbench for macOS, Windows, and Linux.
  <br />
  Built with Tauri v2, React, TypeScript, and SQLite.
</p>

<p align="center">
  <a href="https://github.com/embaobao/clipforge/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/embaobao/clipforge/ci.yml?branch=main&label=CI"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-black"></a>
  <img alt="Tauri" src="https://img.shields.io/badge/Tauri-v2-24C8DB">
  <img alt="React" src="https://img.shields.io/badge/React-19-61DAFB">
  <img alt="Status" src="https://img.shields.io/badge/status-alpha-111111">
</p>

---

ClipForge is a cross-platform clipboard tool focused on the high-frequency path: open quickly, find what you copied, paste it back, and get out of the way. It starts from the practical Clipy-style workflow and extends it with local persistence, fast search, virtualized history, configurable rules, and standard service contracts for future sync and MCP integrations.

ClipForge is not an AI dashboard. AI and agent access should enter through explicit tools such as `clipboard.search` or `clipboard.capture`, while the product remains a fast local clipboard utility.

## Highlights

- **Fast quick panel**: global shortcut, status bar entry, compact window, and direct click-to-copy.
- **Local-first storage**: SQLite-backed durable history with timestamps, copy counts, favorites, and soft delete.
- **High-density history**: virtualized list and cursor pagination for large clipboard datasets.
- **Search and tags**: instant search, type-based tags, and saved search rules.
- **Bulk operations**: multi-select, quick delete, and aggregate copy.
- **Markdown and resources**: content analysis, Markdown preview, link/resource detection, and open actions.
- **Configurable runtime**: settings mapped to a JSON5 file in the user's system directory.
- **Future-proof contracts**: typed interfaces for import/export, realtime sync, and MCP tools.

## Screens

ClipForge is designed around two windows:

- **Quick panel**: compact, high-density, optimized for copy and paste.
- **Settings panel**: separate management surface for shortcuts, storage, cleanup, tags, and paths.

This split keeps the quick panel lightweight and avoids slow settings forms affecting launch speed.

## Install from Source

Prerequisites:

- Node.js 22+
- pnpm 11+
- Rust stable
- Tauri platform prerequisites for your OS

```bash
pnpm install
pnpm tauri dev
```

Frontend-only development:

```bash
pnpm dev
```

Production build:

```bash
pnpm build
pnpm tauri build
```

## Verification

```bash
pnpm build
cd src-tauri && cargo check
cd src-tauri && cargo fmt --check
```

## Keyboard Shortcut

On macOS the default quick-panel shortcut is:

```text
Control + V
```

macOS Accessibility permission is used when available to position the panel near the focused input. If permission is missing or the focused input cannot be detected, ClipForge falls back to a right-side panel on the current screen.

## Local Data

ClipForge keeps clipboard data local by default.

Typical paths are shown inside the settings panel:

- JSON5 user settings file
- SQLite clipboard database
- Local log file

Deletion is soft by default. Hard cleanup is controlled by retention settings.

## Service Contracts

The external API surface is defined in [`src/services/contracts.ts`](src/services/contracts.ts). A minimal round trip is available in [`src/services/example.ts`](src/services/example.ts).

Example tool mapping for future MCP:

```text
clipboard.capture
clipboard.search
clipboard.copy
clipboard.update
clipboard.delete
clipboard.export
clipboard.import
```

Read more in [`docs/SERVICE_CONTRACTS.md`](docs/SERVICE_CONTRACTS.md).

## Documentation

- [`docs/INTRODUCTION.md`](docs/INTRODUCTION.md) - product overview and principles
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) - runtime architecture
- [`docs/SERVICE_CONTRACTS.md`](docs/SERVICE_CONTRACTS.md) - import/export/sync/MCP contracts
- [`CONTRIBUTING.md`](CONTRIBUTING.md) - development workflow
- [`SECURITY.md`](SECURITY.md) - clipboard privacy and reporting
- [`CHANGELOG.md`](CHANGELOG.md) - release notes

## Roadmap

- Stabilize quick panel layout, animation, and keyboard flow.
- Complete cross-platform clipboard formats beyond plain text.
- Improve Markdown and code previews.
- Add import/export UI.
- Expose MCP server using the service contracts.
- Add signed release builds.

## License

ClipForge is released under the [MIT License](LICENSE).
