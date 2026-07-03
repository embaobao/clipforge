# Contributing

ClipForge is early-stage. Contributions are welcome, but changes should stay focused on the product goal: a fast local clipboard tool.

## Development

```bash
pnpm install
pnpm tauri dev
```

Frontend-only preview:

```bash
pnpm dev
```

## Required Checks

Run these before opening a pull request:

```bash
pnpm build
cd src-tauri && cargo check
cd src-tauri && cargo fmt --check
```

## Product Rules

- Keep the quick panel fast and compact.
- Do not turn the product into an AI dashboard.
- Keep platform-specific behavior inside the Rust/Tauri layer.
- Prefer durable local storage and recoverable operations.
- Use service contracts for sync, import/export, CLI, and MCP integrations.

## Documentation

Architecture and proposals should be written in Chinese by default unless a specific upstream convention requires English.
