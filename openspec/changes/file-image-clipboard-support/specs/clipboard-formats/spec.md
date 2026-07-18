# clipboard-formats Spec Delta

## ADDED Requirements

### Requirement: Multi-format clipboard capture

ClipForge SHALL capture text, HTML, RTF, image, and file-list clipboard representations when enabled by capture settings.

#### Scenario: Capture rich clipboard item

- **GIVEN** the clipboard contains multiple representations such as `text/plain` and `text/html`
- **WHEN** ClipForge captures the clipboard
- **THEN** it stores all supported enabled representations for the same clipboard event
- **AND** it selects a `primaryFormat` without discarding fallback text used for search

#### Scenario: Capture image clipboard item

- **GIVEN** the clipboard contains an image representation
- **WHEN** image capture is enabled and the image is within configured limits
- **THEN** ClipForge stores the image as an application-managed resource
- **AND** the resulting clip includes image metadata such as size, dimensions, image file, and thumbnail path when available

#### Scenario: Capture file-list clipboard item

- **GIVEN** the clipboard contains one or more file or directory paths
- **WHEN** file capture is enabled
- **THEN** ClipForge stores a file-list representation
- **AND** search text includes useful file names or paths without requiring synchronous per-row disk access during list rendering

### Requirement: Structured storage for clipboard formats

ClipForge SHALL persist multi-format clips with structured fields that support display, search, de-duplication, and cleanup.

#### Scenario: Store multi-format clip

- **GIVEN** a captured clipboard item contains supported representations
- **WHEN** ClipForge writes it to storage
- **THEN** the record includes content hash, primary format, available formats, representations JSON, plain text, search text, and format-specific metadata
- **AND** de-duplication uses the primary format and preferred representation hash

#### Scenario: Remove image resource

- **GIVEN** an image clip owns stored image resources
- **WHEN** the clip is deleted or purged
- **THEN** ClipForge removes the associated original and thumbnail files
- **AND** empty resource shard directories may be cleaned up

### Requirement: Format-aware writeback

ClipForge SHALL write captured clips back to the system clipboard using the best supported representation for the selected paste mode.

#### Scenario: Write image clip

- **GIVEN** a stored image clip is selected
- **WHEN** the user copies or pastes it in rich mode
- **THEN** ClipForge writes an image representation to the system clipboard
- **AND** writeback guard metadata prevents the writeback from being re-captured as a duplicate history item

#### Scenario: Write file clip

- **GIVEN** a stored file-list clip is selected
- **WHEN** the user copies or pastes it in rich mode
- **THEN** ClipForge writes file-list clipboard data when the platform supports it
- **AND** path text remains available as a plain-text fallback mode

### Requirement: Format-aware quick panel display

ClipForge SHALL expose non-text clip formats in the quick panel and detail views without disrupting the dense clipboard workflow.

#### Scenario: Show image row

- **GIVEN** a clip has image metadata and a thumbnail path
- **WHEN** it appears in the quick panel
- **THEN** the row may show a compact thumbnail or icon
- **AND** the row height remains compatible with the dense quick-panel list

#### Scenario: Show file detail

- **GIVEN** a clip has a file-list representation
- **WHEN** the user opens detail view
- **THEN** ClipForge shows the file list and available formats
- **AND** unavailable files are visually distinguished without blocking list rendering
