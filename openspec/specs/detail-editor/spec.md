# detail-editor Specification

## Purpose
TBD - created by archiving change detail-rich-editor-agent-bridge. Update Purpose after archive.
## Requirements
### Requirement: Compact detail editing

ClipForge SHALL provide a compact editing mode in the detail page before loading any rich text editor dependency.

#### Scenario: Edit text without rich editor

- **GIVEN** a user opens a text, markdown, code, or command clip detail page
- **WHEN** the user selects the edit action
- **THEN** the detail page enters a compact editor with source text editing, tag editing, save actions, cancel, and the existing copy/paste/back actions
- **AND** the editor does not require Tiptap to be loaded in the first implementation phase

#### Scenario: Save compact draft

- **GIVEN** a user changed the clip content in compact edit mode
- **WHEN** the user saves the draft
- **THEN** ClipForge updates the clip content, tags, analysis summary, and search index through the editor save command
- **AND** the current detail view refreshes without losing the selected clip context

### Requirement: Detail tag editing

ClipForge SHALL let users edit clip tags directly in the detail page.

#### Scenario: Add tag from tag input

- **GIVEN** a user is editing a clip detail page
- **WHEN** the user enters `#客户A`, `客户A`, or `tag:客户A` in the tag input and confirms
- **THEN** the draft contains the normalized `客户A` tag exactly once
- **AND** the tag chip remains in a compact single-line region

#### Scenario: Suggest tag from inline hashtag

- **GIVEN** a user types text containing `#项目A` in the editor body
- **WHEN** ClipForge detects the inline hashtag
- **THEN** ClipForge shows `项目A` as a suggested tag chip
- **AND** the tag is not saved until the user confirms the suggestion

### Requirement: AI suggestion return flow

ClipForge SHALL treat Agent edits as suggestions that must be previewed before changing a draft or saved clip.

#### Scenario: Agent suggests update

- **GIVEN** a user is editing a clip
- **WHEN** the user asks for an AI suggestion
- **THEN** the Agent returns an `EditorSuggestionResult` with optional content patch, optional tag patch, explanation, and risk level
- **AND** ClipForge displays the suggested changes without writing to SQLite or the system clipboard

#### Scenario: Apply Agent suggestion

- **GIVEN** an Agent suggestion is visible
- **WHEN** the user applies the suggestion to the draft
- **THEN** ClipForge updates only the local editor draft
- **AND** saving still uses the normal editor save command with actor metadata

#### Scenario: Agent-saved clip receives AI tag

- **GIVEN** a user saves a draft after applying an Agent suggestion
- **WHEN** the save succeeds
- **THEN** the saved clip contains the `AI` tag unless the user explicitly removed it before saving

