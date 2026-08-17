# dsh-file-context Spec Delta

## ADDED Requirements

### Requirement: Copy file path from context menu

ClipForge SHALL offer a context-menu action on `payloadKind === "file"` clipboard items that copies the plain POSIX path string(s) to the system clipboard.

#### Scenario: Copy single file path

- **GIVEN** a clipboard item with `payloadKind === "file"` containing one path
- **WHEN** the user selects "复制地址" (copy path) from its context menu
- **THEN** ClipForge writes the plain POSIX path (e.g. `/Users/x/foo.txt`) to the clipboard as text
- **AND** it does not write a `file://` URL or a file object

#### Scenario: Copy multiple file paths

- **GIVEN** a clipboard item with `payloadKind === "file"` containing multiple paths
- **WHEN** the user copies the path
- **THEN** ClipForge writes the newline-separated plain paths as text

### Requirement: Start file-scoped DSH conversation

ClipForge SHALL let the user start a DSH conversation scoped to a file or folder directly from that item's context menu.

#### Scenario: Open DSH panel scoped to a file

- **GIVEN** a clipboard item with `payloadKind === "file"`
- **WHEN** the user selects "在此文件开始对话" (start conversation on this file)
- **THEN** ClipForge switches to the `dsh` surface with the file path as context
- **AND** it triggers a file-aware analysis instead of analyzing the raw path text

#### Scenario: Folder conversation lists children

- **GIVEN** a clipboard item that is a directory
- **WHEN** the user starts a conversation on it
- **THEN** ClipForge analyzes the directory by listing top-level entries and aggregating by type
- **AND** it does not recursively read deep file contents in v1

### Requirement: File-content-aware analysis

ClipForge SHALL read the file on the host side (read-only, size-bounded) and inject its content or metadata into the DSH task, not merely the path string.

#### Scenario: Analyze readable text file

- **GIVEN** a file clip pointing to a small text/code file within the size limit
- **WHEN** the user starts a conversation and grants full-content (or default metadata)
- **THEN** ClipForge reads the file bounded by `max_bytes`
- **AND** constructs a task including the file path and either a content snippet or metadata (size/type)
- **AND** DSH returns the four-class structured result for that file

#### Scenario: Oversized or binary file degrades to metadata

- **GIVEN** a file clip that is too large or not text-decodable
- **WHEN** analysis is requested
- **THEN** ClipForge analyzes using path + metadata only
- **AND** does not inject raw binary into the prompt

### Requirement: Privacy default for file analysis

ClipForge SHALL default to sending only file path and metadata to DSH; full file content requires explicit user authorization.

#### Scenario: No full content without grant

- **GIVEN** a file clip
- **WHEN** the user starts a conversation without enabling full-content
- **THEN** ClipForge sends only path and metadata
- **AND** does not read or transmit the full file body

### Requirement: Persistent multi-turn file conversation

ClipForge SHALL support follow-up questions about a file within the DSH panel via the persistent DSH daemon session (keyed by `conversationId`), without re-submitting the prior transcript.

#### Scenario: Follow-up question

- **GIVEN** a file conversation that already produced a result
- **WHEN** the user asks a follow-up question
- **THEN** ClipForge sends the new question with the same `conversationId` to the daemon
- **AND** the daemon returns the follow-up using the retained session context
- **AND** the DSH panel shows the conversation grouped by `conversationId`

### Requirement: Degradation preserves clipboard core

File-context DSH failures SHALL NOT affect clipboard capture, search, copy, or paste.

#### Scenario: Missing file or no model

- **GIVEN** a file clip whose path no longer exists, or no node/key configured
- **WHEN** the user starts a conversation
- **THEN** ClipForge shows a degraded result or disables the entry
- **AND** the clipboard main flow remains fully functional
