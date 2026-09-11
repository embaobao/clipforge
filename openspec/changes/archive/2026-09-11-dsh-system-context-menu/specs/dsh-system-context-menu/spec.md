# dsh-system-context-menu Spec Delta

## ADDED Requirements

### Requirement: System file-manager copy path

ClipForge SHALL provide a system file-manager (Finder / Explorer) context-menu action that copies the plain POSIX/absolute path of the target file or folder to the system clipboard.

#### Scenario: Copy path from Finder/Explorer

- **GIVEN** a file selected in macOS Finder or Windows Explorer
- **WHEN** the user selects "复制地址" (copy path) from the system context menu
- **THEN** ClipForge writes the plain absolute path to the system clipboard
- **AND** it does not launch the full app UI unless needed

### Requirement: System file-manager start DSH conversation

ClipForge SHALL provide a system file-manager context-menu action that opens the running ClipForge and starts a DSH conversation scoped to the target file or folder.

#### Scenario: Open DSH conversation from Finder/Explorer

- **GIVEN** a file selected in macOS Finder or Windows Explorer
- **WHEN** the user selects "用 ClipForge 分析" / "在此文件开始对话" from the system context menu
- **THEN** ClipForge (already running, or launched) switches to the `dsh` surface
- **AND** it seeds the conversation with the file path as context
- **AND** it triggers a file-aware analysis via the persistent DSH daemon

#### Scenario: App not running

- **GIVEN** ClipForge is not currently running
- **WHEN** the user invokes the system context-menu action
- **THEN** the system launches ClipForge and delivers the path to the running instance
- **AND** the corresponding action (copy path / start conversation) still executes

### Requirement: Reuse in-app capabilities

The system context menu SHALL reuse the existing in-app copy-path and file-context conversation logic; it MUST NOT reimplement DSH analysis or clipboard writing.

#### Scenario: No duplicated logic

- **GIVEN** the system context menu is invoked
- **WHEN** ClipForge handles it
- **THEN** it routes through the same `filesAsPaths` copy logic and the same `dsh-file-context-conversation` file-aware analysis as the in-app right-click
