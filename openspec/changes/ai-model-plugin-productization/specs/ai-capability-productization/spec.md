## ADDED Requirements

### Requirement: Model Provider Profiles

ClipForge SHALL model configured AI access as provider configs and model profiles, and React UI SHALL only receive non-secret provider/profile metadata.

#### Scenario: Provider is configured

- **GIVEN** the user configures an OpenAI-compatible, local CLI, local server, AI SDK provider, Tiptap AI provider, or custom plugin provider
- **WHEN** the settings UI renders available models
- **THEN** it SHALL display provider id, label, model profile id, purpose, health, and capability flags
- **AND** it SHALL NOT expose API keys, tokens, credential refs, or raw secret values to React state or localStorage.

#### Scenario: Provider is unavailable

- **GIVEN** a configured provider health check fails
- **WHEN** the user opens the quick panel, detail page, or clipboard list
- **THEN** ClipForge SHALL keep the core clipboard path available
- **AND** only model-backed actions SHALL show disabled, fallback, or reconnect states.

### Requirement: Default AI Capability Outputs

ClipForge SHALL normalize AI, Agent, Tiptap AI, and plugin-generated results into previewable output kinds before any write action.

#### Scenario: AI rewrites detail content

- **GIVEN** the user invokes rewrite, translate, format repair, or tag suggestion from the detail page
- **WHEN** the model returns a result
- **THEN** ClipForge SHALL convert the result into `previewPatch`, `newClipDraft`, `copyResult`, or `renderPanel`
- **AND** it SHALL require user confirmation before updating clipboard history, system clipboard, tags, files, or external targets.

#### Scenario: AI saves generated content

- **GIVEN** the user confirms saving AI-generated or Agent-generated content as a clipboard item
- **WHEN** ClipForge writes the item
- **THEN** the item SHALL include provenance metadata
- **AND** it SHALL add the `AI` tag by default unless the action is a normal user-only save.

### Requirement: Tiptap AI Is an Editor Enhancement

ClipForge SHALL treat Tiptap Content AI / AI Toolkit as an optional detail editor enhancement, not as the source of truth for clipboard storage or permissions.

#### Scenario: Tiptap AI is available

- **GIVEN** the user is editing supported rich text in the detail page
- **AND** a Tiptap AI-capable provider is configured and enabled
- **WHEN** the user invokes a Tiptap AI action for a selection or document
- **THEN** ClipForge SHALL route the action through an editor tool bridge
- **AND** the bridge SHALL produce a preview patch before save, copy, paste, or metadata update.

#### Scenario: Tiptap AI is unavailable

- **GIVEN** Tiptap AI is unconfigured, unauthorized, failed, or disabled by policy
- **WHEN** the user opens the detail editor
- **THEN** ClipForge SHALL keep the compact editor available for text, Markdown source, code, command, tags, and manual save
- **AND** it SHALL NOT block detail page viewing, copying, searching, or basic editing.

### Requirement: Agent Is a Plugin Capability

ClipForge SHALL model Agent providers, Agent runs, Agent skills, and Agent-generated plugin drafts as plugin capabilities governed by the same manifest, permission, policy, and output rules as other plugins.

#### Scenario: Agent runs from Agent page

- **GIVEN** the user opens the Agent page with a selected context set
- **WHEN** the user starts an Agent run
- **THEN** ClipForge SHALL resolve the run through an Agent plugin capability
- **AND** the run SHALL only access context fields allowed by its capability policy
- **AND** results SHALL return as previewable output kinds or run events.

#### Scenario: Agent runs from detail page

- **GIVEN** the user invokes a detail-page AI suggestion
- **WHEN** the suggestion is powered by an Agent provider
- **THEN** ClipForge SHALL treat the Agent as a plugin capability
- **AND** it SHALL require patch preview before applying changes to the editor draft or clipboard item.

#### Scenario: Agent creates a plugin draft

- **GIVEN** the user asks an Agent to create a reusable plugin
- **WHEN** the Agent returns a manifest or script draft
- **THEN** ClipForge SHALL save it only as a disabled draft until manifest validation, permission review, and user confirmation pass
- **AND** it SHALL NOT execute the draft automatically.

### Requirement: Plugin Manifest Supports AI Productization

ClipForge SHALL extend plugin manifests to describe AI requirements, Agent behavior, editor-tool behavior, model-provider behavior, and product tier gating.

#### Scenario: Plugin declares model requirements

- **GIVEN** a plugin requires model access
- **WHEN** ClipForge lists or invokes the plugin
- **THEN** it SHALL show whether the required model profile or purpose is available
- **AND** it SHALL disable or degrade the plugin if the model policy rejects network, local, tool-calling, file-content, or full-content access.

#### Scenario: Product tier disables a capability

- **GIVEN** a capability belongs to AI Edit Pack, Agent Clip Pack, Plugin Builder Pack, Local Privacy Pack, or Team Governance Pack
- **WHEN** product gating or enterprise policy disables that capability
- **THEN** ClipForge SHALL hide, disable, or explain the unavailable action without breaking Core Clipboard behavior.

### Requirement: AI Capability Boundaries Are Auditable

ClipForge SHALL record structured, redacted traces for model, Agent, plugin, editor-tool, and MCP AI capability calls.

#### Scenario: Capability call is allowed

- **GIVEN** a user invokes an AI, Agent, plugin, Tiptap tool, or MCP tool action
- **WHEN** ClipForge accepts the action
- **THEN** the trace SHALL include trace id, business chain, provider/profile ids, plugin id, permission decision, redacted fields, output kind, and confirmation state
- **AND** it SHALL NOT include raw secrets, full prompt text, or full clipboard content by default.

#### Scenario: Capability call is rejected

- **GIVEN** a policy denies a capability call
- **WHEN** ClipForge displays the failure
- **THEN** it SHALL explain the denied capability at a user-readable level
- **AND** the rejection SHALL NOT interrupt clipboard capture, search, copy, delete, or detail viewing.

