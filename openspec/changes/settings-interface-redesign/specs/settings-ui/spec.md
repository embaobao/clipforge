# settings-ui Spec Delta

## ADDED Requirements

### Requirement: Settings sidebar navigation

ClipForge SHALL render settings top-level navigation with a lightweight Sidebar component instead of a coarse button list.

#### Scenario: Navigate between settings sections

- **GIVEN** the settings window is open
- **WHEN** the user selects a sidebar item
- **THEN** the matching settings section is shown
- **AND** the selected sidebar item has a visible current state
- **AND** keyboard focus remains inside the settings window

#### Scenario: Sidebar accessibility

- **GIVEN** the user navigates settings with the keyboard
- **WHEN** focus moves through the sidebar
- **THEN** each item exposes a readable label
- **AND** the active item is announced or visually distinguishable without relying on color alone

### Requirement: Section-local tabs

ClipForge SHALL use tabs inside settings sections to group related configuration subareas.

#### Scenario: Switch section tabs

- **GIVEN** a settings section contains multiple subareas
- **WHEN** the user switches tabs
- **THEN** only the selected subarea content is shown
- **AND** the layout width remains stable
- **AND** reduced-motion users do not receive positional animation

### Requirement: Semantic control mapping

ClipForge SHALL map every setting to an interaction component that matches the setting type.

#### Scenario: Enum setting uses toggle group

- **GIVEN** a setting has a short fixed set of choices
- **WHEN** the setting is rendered
- **THEN** it uses Toggle Group or an equivalent segmented control
- **AND** the selected option is keyboard reachable
- **AND** changing the selected option persists through the existing settings update command

#### Scenario: Boolean setting uses switch or multi-select toggle

- **GIVEN** a setting represents enabled or disabled state
- **WHEN** the setting is rendered
- **THEN** it uses a Switch or a clearly labeled toggle control
- **AND** the control exposes checked state to assistive technology

#### Scenario: Numeric setting shows bounds

- **GIVEN** a setting accepts a bounded number
- **WHEN** the setting is rendered
- **THEN** the UI shows the current value and unit when applicable
- **AND** the minimum and maximum constraints are enforced before saving

### Requirement: Code examples in code tabs

ClipForge SHALL render MCP, Agent, JSON-RPC, command and provider examples in Code Tabs.

#### Scenario: Copy MCP setup snippet

- **GIVEN** the user opens the MCP and Agent settings section
- **WHEN** the user selects the Agent install prompt code tab and clicks copy
- **THEN** ClipForge copies the same install prompt semantics as the existing MCP copy action
- **AND** the user receives a short success or failure status

#### Scenario: Read JSON-RPC example

- **GIVEN** the JSON-RPC code tab is selected
- **WHEN** the example content is longer than the available panel
- **THEN** the code area scrolls internally
- **AND** the outer settings layout remains stable

### Requirement: Tooltip standardization

ClipForge SHALL use the Animate UI Tooltip implementation for settings tooltips while preserving existing content and trigger strategy.

#### Scenario: Icon action tooltip

- **GIVEN** a settings action is represented by an icon-only button
- **WHEN** the user hovers or focuses the action
- **THEN** a tooltip appears with the existing explanatory content
- **AND** pressing Escape hides the tooltip

### Requirement: Action taxonomy

ClipForge SHALL visually and semantically separate primary, secondary, diagnostic and destructive settings actions.

#### Scenario: Diagnostic export

- **GIVEN** the user opens storage and diagnostics settings
- **WHEN** the user sees the diagnostic bundle action
- **THEN** it is labeled as exporting a diagnostic bundle
- **AND** it is grouped with diagnostics rather than ordinary configuration fields
- **AND** no print-like wording is used for the action

#### Scenario: Destructive maintenance action

- **GIVEN** the user sees log cleanup or permission reset
- **WHEN** the action is available
- **THEN** it is visually separated from ordinary refresh and copy actions
- **AND** the user receives clear feedback after the action completes or fails
