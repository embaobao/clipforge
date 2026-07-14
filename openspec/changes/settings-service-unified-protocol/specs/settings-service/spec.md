# settings-service Spec Delta

## ADDED Requirements

### Requirement: Unified Settings Service

ClipForge SHALL expose a single Settings Service as the canonical settings read/write boundary for the settings window, Tauri commands, and MCP tools.

#### Scenario: Read settings through the service

- **GIVEN** a caller needs settings
- **WHEN** it calls the Settings Service get operation
- **THEN** the response includes the current settings document
- **AND** the response includes JSON Schema
- **AND** the response includes a revision
- **AND** the response includes write policy and redaction metadata

#### Scenario: Avoid duplicate write semantics

- **GIVEN** the settings window writes a setting
- **WHEN** the setting is persisted
- **THEN** the write goes through the Settings Service
- **AND** the settings window does not directly write the settings file

### Requirement: Settings patch protocol

ClipForge SHALL recommend partial patch updates for normal settings writes.

#### Scenario: Patch one setting

- **GIVEN** the current settings revision is known
- **WHEN** a caller patches one supported setting key
- **THEN** ClipForge validates the patch against schema
- **AND** only the requested field is changed
- **AND** the response includes the next revision and changed paths

#### Scenario: Reject invalid patch

- **GIVEN** a patch contains an unsupported key or invalid value
- **WHEN** the caller submits the patch
- **THEN** ClipForge rejects the write
- **AND** the error includes a stable code
- **AND** the error identifies the invalid JSON path
- **AND** the error suggests reading schema before retrying

### Requirement: Replace and reset safeguards

ClipForge SHALL require explicit confirmation for full replacement and reset operations.

#### Scenario: Reject unconfirmed replacement

- **GIVEN** a caller submits a full settings replacement
- **WHEN** `confirmed` is not true
- **THEN** ClipForge rejects the request
- **AND** the response recommends using patch for normal updates

#### Scenario: Reset scoped settings

- **GIVEN** a caller wants to reset settings
- **WHEN** it provides a reset scope and `confirmed=true`
- **THEN** ClipForge resets only the requested scope
- **AND** the response includes revision and changed paths

### Requirement: Settings changed event

ClipForge SHALL emit a settings changed event after successful Settings Service writes.

#### Scenario: Notify settings window

- **GIVEN** a settings write succeeds
- **WHEN** the write completes
- **THEN** ClipForge emits `settings_changed`
- **AND** the event includes revision, previousRevision, changedPaths, actor, mode and updatedAt
- **AND** no event is emitted for failed writes

### Requirement: MCP settings tools

ClipForge SHALL expose Settings Service operations through MCP tools using the `clipf.settings.*` namespace.

#### Scenario: MCP reads schema

- **GIVEN** an Agent calls `clipf.settings.get`
- **WHEN** the tool returns successfully
- **THEN** the response includes settings, schema, writePolicy, revision and redaction metadata

#### Scenario: MCP patches settings

- **GIVEN** an Agent calls `clipf.settings.patch`
- **WHEN** the patch is valid
- **THEN** ClipForge writes through Settings Service
- **AND** the MCP response includes revision, changedPaths and nextActions

### Requirement: Agent provider settings

ClipForge SHALL standardize Agent provider configuration under `settings.agent`.

#### Scenario: Configure OpenAI-compatible provider

- **GIVEN** the user or Agent configures an OpenAI-compatible provider
- **WHEN** the provider is saved
- **THEN** the provider supports baseUrl, modelId, apiKeyEnv or apiKey, enabled and timeoutSeconds
- **AND** the provider can be selected by `agent.defaultProviderId`

#### Scenario: Redact secrets

- **GIVEN** a provider has an inline apiKey
- **WHEN** provider status is returned to UI or MCP
- **THEN** ClipForge does not return the cleartext key
- **AND** the response may indicate whether an inline key exists

#### Scenario: Fetch models

- **GIVEN** an OpenAI-compatible provider has key and baseUrl configured
- **WHEN** the caller requests models
- **THEN** ClipForge attempts to fetch the provider model list
- **AND** returns model ids, status and reason
- **AND** local CLI providers return not-supported for model listing

### Requirement: Staged frontend migration

ClipForge SHALL not migrate the main panel settings lifecycle in the first Settings Service implementation phase.

#### Scenario: Protect main panel behavior

- **GIVEN** Settings Service is introduced
- **WHEN** the first phase ships
- **THEN** the settings window and MCP may use the service
- **AND** the main panel keeps its existing settings lifecycle
- **AND** any main panel migration requires a later explicit task
