# Security Policy

ClipForge handles clipboard content, which can include sensitive text. Treat privacy and local data safety as core requirements.

## Supported Versions

The project is pre-1.0. Security fixes target the current `main` branch.

## Reporting a Vulnerability

Please report security issues privately through GitHub Security Advisories when available. If advisories are not enabled yet, open a minimal issue without sensitive details and request a private contact path.

## Security Expectations

- Clipboard data should remain local by default.
- No remote sync should be enabled without explicit user action.
- Logs must avoid dumping full clipboard contents.
- MCP and external tools should use narrow, explicit input/output contracts.
- Deletion should be recoverable unless a cleanup policy intentionally hard-deletes old soft-deleted records.
