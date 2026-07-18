# clipboard-fidelity Spec Delta

## ADDED Requirements

### Requirement: Rich and plain writeback modes

ClipForge SHALL provide explicit rich and plain writeback behavior for clips that contain multiple clipboard representations.

#### Scenario: Rich HTML writeback

- **GIVEN** a clip contains HTML and plain-text representations
- **WHEN** the user copies or pastes it in rich mode
- **THEN** ClipForge writes `text/html` together with `text/plain`
- **AND** the original clip representations remain unchanged

#### Scenario: Plain HTML writeback

- **GIVEN** a clip contains HTML and plain-text representations
- **WHEN** the user copies or pastes it in plain mode
- **THEN** ClipForge writes only the plain-text representation
- **AND** hidden rich representations do not affect the target paste result

#### Scenario: Rich RTF writeback

- **GIVEN** a clip contains RTF and plain-text representations
- **WHEN** the user copies or pastes it in rich mode
- **THEN** ClipForge writes RTF together with `text/plain` when supported by the platform

### Requirement: File and image degradation paths

ClipForge SHALL provide explicit, explainable behavior when file or image clips cannot be written in the requested mode.

#### Scenario: Files as paths

- **GIVEN** a clip contains a file-list representation
- **WHEN** the user chooses the files-as-paths mode
- **THEN** ClipForge writes the file paths as plain text
- **AND** rich file-list metadata remains stored on the clip

#### Scenario: Image plain mode unavailable

- **GIVEN** a clip contains an image representation
- **WHEN** the user requests a plain-text writeback mode that has no meaningful text fallback
- **THEN** ClipForge disables the action or shows a clear unavailable reason
- **AND** the failure does not modify the system clipboard

### Requirement: Format-aware actions and logging

ClipForge SHALL expose copy actions according to available representations and log writeback decisions for diagnosis.

#### Scenario: Show available format actions

- **GIVEN** a clip has available format metadata
- **WHEN** the user opens the context menu or detail action list
- **THEN** ClipForge shows actions that match the available formats
- **AND** unavailable actions are disabled with an explanation rather than hidden ambiguously

#### Scenario: Log writeback result

- **GIVEN** a writeback operation completes or fails
- **WHEN** ClipForge records the operation
- **THEN** the log includes clip id, primary format, available formats, selected paste mode, written formats, and guard metadata
- **AND** prompt, user content, or unrelated clipboard history is not logged as part of the diagnostic metadata

### Requirement: No duplicate recapture after writeback

ClipForge SHALL prevent its own writeback operations from creating duplicate history entries.

#### Scenario: Guard rich writeback

- **GIVEN** ClipForge writes a clip back to the system clipboard
- **WHEN** clipboard monitoring observes the resulting clipboard change
- **THEN** the writeback guard identifies the operation as self-originated
- **AND** ClipForge does not create a duplicate clip record
