# panel-navigation Spec Delta

## ADDED Requirements

### Requirement: Top toolbar navigation

ClipForge SHALL provide primary quick-panel navigation from a top toolbar rather than a bottom dock.

#### Scenario: Switch between history and favorites

- **GIVEN** the quick panel is open
- **WHEN** the user selects History or Favorites from the top toolbar
- **THEN** the matching list view is shown
- **AND** the selected view has a visible current state
- **AND** clipboard list selection behavior remains unchanged

#### Scenario: Open trash from menu

- **GIVEN** the quick panel is open
- **WHEN** the user opens the top toolbar menu and selects Trash
- **THEN** the trash view is shown
- **AND** the trash keyboard shortcut remains available

### Requirement: Toolbar drag region

ClipForge SHALL allow window dragging from the top toolbar without breaking toolbar controls.

#### Scenario: Drag toolbar background

- **GIVEN** the quick panel is open
- **WHEN** the user drags a non-interactive area of the top toolbar
- **THEN** the native window can be dragged

#### Scenario: Click toolbar controls

- **GIVEN** the quick panel is open
- **WHEN** the user clicks the search input, view switch, Agent button or menu button
- **THEN** the intended control action runs
- **AND** the click is not interpreted as a drag action

### Requirement: Bottom dock removal

ClipForge SHALL remove the bottom dock from the quick panel layout.

#### Scenario: List uses reclaimed space

- **GIVEN** the bottom dock has been removed
- **WHEN** the quick panel displays clipboard items
- **THEN** the list can use the reclaimed vertical space
- **AND** list content is not hidden behind a fixed bottom navigation area
