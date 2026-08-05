# panel-visual-regression Spec Delta

## ADDED Requirements

### Requirement: Preserve quick-list selection interaction

ClipForge SHALL preserve the existing quick-list selection, active, hover, copied and multi-select interaction semantics when visual toolbar or menu work is performed.

#### Scenario: Toolbar polish does not alter row selection

- **GIVEN** the quick panel is open
- **WHEN** top toolbar or top menu styles are changed
- **THEN** `.quick-row.active`, `.quick-row.selected`, copied state and multi-select state keep their established behavior
- **AND** row selection is not rewritten as part of toolbar polish

#### Scenario: Focus ring changes require explicit review

- **GIVEN** the quick list uses a focus or active indicator
- **WHEN** a change proposes to hide, replace or restyle that indicator
- **THEN** the change is tracked as a dedicated list-selection visual change
- **AND** it is not bundled into settings page or top toolbar fixes

### Requirement: Top toolbar menu remains compact and readable

ClipForge SHALL render the quick-panel top toolbar menu as a compact tool menu with clear hierarchy and readable controls.

#### Scenario: Open top toolbar menu

- **GIVEN** the quick panel is open
- **WHEN** the user opens the top toolbar menu
- **THEN** the menu background is visually solid enough to read
- **AND** the ClipForge header is readable but lower priority than actions
- **AND** Trash and Settings rows have compact heights and clear hover states
- **AND** shortcuts are aligned without crowding labels

### Requirement: Visual fixes stay scoped to their surface

ClipForge SHALL scope visual regression fixes to the surface they repair.

#### Scenario: Fix top menu

- **GIVEN** the top toolbar menu is visually broken
- **WHEN** styles are changed to repair it
- **THEN** selectors are scoped to `.app-shell .top-toolbar-menu`
- **AND** generic dropdown menus and detail action menus are not changed

#### Scenario: Fix settings page

- **GIVEN** settings page Sidebar, Tabs or Code Tabs need styling
- **WHEN** styles are changed
- **THEN** selectors are scoped to `.settings-window-shell`, `.settings-window-body` or settings-specific slots
- **AND** main panel rows, toolbar and dropdown menus are not changed as a side effect
