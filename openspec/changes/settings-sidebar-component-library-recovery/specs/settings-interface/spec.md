# settings-interface Spec Delta

## ADDED Requirements

### Requirement: Settings sidebar uses component-library Sidebar

ClipForge SHALL render the settings primary navigation with the Animate UI registry Sidebar component instead of a hand-written sidebar state manager.

#### Scenario: Collapsible settings sidebar

- **GIVEN** the settings window is open
- **WHEN** the user activates the Sidebar trigger
- **THEN** the Sidebar collapses to icon mode through the component-library state
- **AND** the settings content remains visible in `SidebarInset`
- **AND** category labels are still available through Sidebar menu tooltip behavior

#### Scenario: Settings tabs remain component-library tabs

- **GIVEN** a settings category is active
- **WHEN** the user changes an internal tab
- **THEN** the tab switch uses Animate UI Tabs
- **AND** the sidebar collapse state does not reset the active category or tab content
