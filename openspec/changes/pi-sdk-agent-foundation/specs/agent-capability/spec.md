# agent-capability Specification

## ADDED Requirements

### Requirement: Pluggable agent runtime

ClipForge SHALL route all AI capabilities (analysis, tagging, summarization) through a pluggable agent adapter layer, with pi sdk as the default runtime implementation.

#### Scenario: Analysis entry point survives runtime swap

- **GIVEN** the user triggers "AI 分析" from the detail page or context menu
- **WHEN** the agent adapter layer processes the request
- **THEN** the UI interaction, status feedback, and tag-application channels behave identically regardless of the underlying runtime
- **AND** swapping the runtime requires changes only inside `src/agent/` adapter files

### Requirement: Provider keys stay out of the hot path

ClipForge SHALL keep LLM provider configuration and API keys in the settings layer with redaction, and SHALL NOT place network calls or key access on the clipboard hot path.

#### Scenario: Hot path isolation

- **GIVEN** the clipboard capture/copy/paste hot path executes
- **WHEN** verify-hot-path runs its negative assertions against the main panel source
- **THEN** no LLM/provider/network symbols appear in the hot path
- **AND** agent invocations originate only from explicit user actions

### Requirement: DSH chain removal

ClipForge SHALL remove the DSH runtime chain (daemon, sidecar bridge, iframe panel, analysis service) after the pi-based implementation replaces its user-facing capabilities.

#### Scenario: No DSH residue

- **GIVEN** the DSH deletion batches are complete
- **WHEN** the repository is searched for DSH symbols (`dsh.rs`, `spawn_dsh_daemon`, `DSH_WEB_URL`, `dsh-main`, `dsh-panel`)
- **THEN** no source references remain (archived proposals and decision records excepted)
- **AND** the full verification suite passes
