# panel-layout Specification Delta

## ADDED Requirements

### Requirement: Main panel layout preserves clipboard hot paths

ClipForge SHALL keep the main quick panel organized around the clipboard list, search, selection, copy, paste, delete, favorite, detail, Agent entry, and status feedback areas without allowing secondary surfaces to block hot-path interactions.

#### Scenario: User works in the quick panel

- **GIVEN** the quick panel is open
- **WHEN** the user searches, scrolls, changes selection, copies, pastes, deletes, favorites, opens detail, or opens the Agent entry
- **THEN** the clipboard list remains the primary interaction surface
- **AND** search results render directly in the main list
- **AND** detail or Agent surfaces do not synchronously block selection, scrolling, copy, or paste feedback

### Requirement: Main panel layout work is superseded by frontend surface architecture

ClipForge SHALL treat this historical layout proposal as planning input now that `frontend-surface-architecture-refactor` owns the active implementation baseline.

#### Scenario: New panel work is planned

- **GIVEN** a new main-panel layout, style, component, or routing change is proposed
- **WHEN** engineers decide which OpenSpec change to update
- **THEN** implementation tasks and active source-of-truth updates go to `frontend-surface-architecture-refactor`
- **AND** this change remains a historical reference for main-panel hot-path and layout constraints only
