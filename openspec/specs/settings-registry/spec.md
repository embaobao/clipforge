# settings-registry Specification

## Purpose
TBD - created by archiving change settings-field-refactor. Update Purpose after archive.
## Requirements
### Requirement: Settings field registry decision

ClipForge SHALL treat settings field registry work as a scoped design decision rather than a parallel replacement for the settings page redesign.

#### Scenario: Avoid duplicate settings redesign tracks

- **GIVEN** `settings-interface-redesign` is active
- **WHEN** `settings-field-refactor` is evaluated
- **THEN** overlapping Sidebar, Tabs, Tooltip, Code Tabs and semantic control mapping work is not implemented twice
- **AND** any accepted field registry decision is merged back into the settings redesign or settings service track

#### Scenario: Keep validation in Settings Service

- **GIVEN** a settings field registry is introduced
- **WHEN** a setting is rendered
- **THEN** the registry may describe UI placement and component type
- **AND** schema validation and write policy remain owned by the Settings Service

