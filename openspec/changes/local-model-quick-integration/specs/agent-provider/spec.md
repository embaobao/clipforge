# agent-provider Specification Delta

## ADDED Requirements

### Requirement: Local model access uses OpenAI-compatible providers

ClipForge SHALL route local and third-party model access through explicit OpenAI-compatible provider configuration instead of spawning local CLI Agent runtimes.

#### Scenario: User configures a local model

- **GIVEN** a user wants to use LM Studio, Ollama, or another local model gateway
- **WHEN** ClipForge stores the provider configuration
- **THEN** the provider uses an OpenAI-compatible base URL, model ID, and optional API key reference
- **AND** ClipForge does not require a `local-cli` command, CLI stdout parser, or child process runtime for chat execution

### Requirement: External tool API key import is explicit and redacted

ClipForge SHALL only import API keys or base URLs from external AI tools after explicit user confirmation and SHALL keep secret handling inside Settings Service redaction boundaries.

#### Scenario: User imports an external tool provider

- **GIVEN** ClipForge detects a candidate provider from an external tool configuration
- **WHEN** the user chooses to import it
- **THEN** ClipForge shows the source tool, base URL, model candidate, and redacted key preview
- **AND** it writes provider settings through Settings Service
- **AND** UI, MCP responses, logs, and diagnostics do not expose the full API key

### Requirement: Provider readiness does not block the clipboard panel

ClipForge SHALL keep local model detection, provider readiness checks, model list loading, and chat runtime initialization asynchronous from quick panel hot paths.

#### Scenario: Provider is slow or unavailable

- **GIVEN** a configured local or third-party provider is offline, slow, or misconfigured
- **WHEN** the user opens the quick panel, scrolls, changes selection, copies, or pastes
- **THEN** those interactions remain available
- **AND** provider failures are surfaced only in Agent or settings surfaces with pending/error feedback
- **AND** quick panel feedback appears without waiting for provider readiness or model listing
