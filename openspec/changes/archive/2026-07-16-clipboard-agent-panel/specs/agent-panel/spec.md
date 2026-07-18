# agent-panel Spec Delta

## ADDED Requirements

### Requirement: Clipboard Agent panel entry

ClipForge SHALL provide an Agent work panel inside the floating panel without changing the default clipboard-first workflow.

#### Scenario: Floating panel opens by default

- **GIVEN** the user opens the floating panel
- **WHEN** the panel becomes visible
- **THEN** the clipboard list remains the default active surface
- **AND** the Agent surface is available as an explicit `剪贴板 / Agent` switch
- **AND** Agent service readiness MUST NOT block panel show, hide, position, search, copy, paste, or detail navigation

#### Scenario: Detail page asks Agent

- **GIVEN** the user is viewing a clip detail page
- **WHEN** the user selects the `询问 Agent` action
- **THEN** ClipForge opens the same Agent panel surface
- **AND** the current detail clip is included as the default context reference

### Requirement: Agent context set

ClipForge SHALL send Agent requests through a structured `AgentContextSet` instead of blindly inserting full clipboard content into the prompt.

#### Scenario: Default current clip context

- **GIVEN** a current clip exists
- **WHEN** the user opens the Agent surface
- **THEN** ClipForge creates an `AgentContextSet` whose first reference is the current clip
- **AND** the default permission scope is summary-only
- **AND** full content requires an explicit per-run authorization

#### Scenario: User switches context source

- **GIVEN** clipboard history, favorites, search results, or selected clips exist
- **WHEN** the user switches the Agent context source
- **THEN** ClipForge rebuilds the `AgentContextSet` from the chosen source
- **AND** `all` and collection sources include item limits and scope labels
- **AND** changing the context set does not automatically rerun an existing Agent request

### Requirement: Agent message scroller

ClipForge SHALL render Agent messages in a stable scroller that preserves the user's reading position.

#### Scenario: User leaves the live edge

- **GIVEN** an Agent response is streaming or appending
- **WHEN** the user scrolls away from the latest message
- **THEN** ClipForge does not force-scroll the viewport to the bottom
- **AND** a visible jump-to-latest control is shown when new content arrives

#### Scenario: Agent panel is reopened

- **GIVEN** an Agent conversation has existing messages
- **WHEN** the Agent panel is opened again
- **THEN** message rows use stable ids
- **AND** the panel can restore to the latest meaningful user turn or run marker

### Requirement: Agent result actions

ClipForge SHALL require explicit user actions before Agent output changes clipboard history, source clips, tags, or the system clipboard.

#### Scenario: Save Agent output as clip

- **GIVEN** an Agent output is visible
- **WHEN** the user chooses save as clip
- **THEN** ClipForge creates or updates a clipboard entry from the visible output
- **AND** the saved entry receives Agent provenance metadata
- **AND** the saved entry receives the default `AI` tag

#### Scenario: Manage source clip

- **GIVEN** an Agent output references a source clip
- **WHEN** the user chooses favorite or archive source
- **THEN** ClipForge performs the requested source clip update through the normal clipboard update path
- **AND** the action is not performed silently by the Agent

### Requirement: Private clipboard skills

ClipForge SHALL support user-private clipboard skill drafts as local clipboard processing templates, not as a public skill marketplace or auto-learning system.

#### Scenario: Save private skill draft

- **GIVEN** the user has a prompt and context mode in the Agent panel
- **WHEN** the user saves a private skill draft
- **THEN** ClipForge stores the skill name, prompt template, default context mode, output actions, and timestamps
- **AND** the skill is only run manually by the user

#### Scenario: Skill uses tools

- **GIVEN** a private skill declares clipboard tools or MCP tools
- **WHEN** the skill runs
- **THEN** ClipForge applies the same context scope and write-confirmation rules as a normal Agent request
- **AND** the skill MUST NOT modify plugin priority, execute scripts, or collect all history automatically
