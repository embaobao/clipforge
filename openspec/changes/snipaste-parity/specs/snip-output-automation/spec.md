# snip-output-automation Spec Delta

## ADDED Requirements

### Requirement: File naming variable engine

ClipForge SHALL expand a user-defined file naming pattern with variables when saving snips to files.

#### Scenario: Pattern expansion

- **GIVEN** a naming pattern such as `snip_{YYYY}{MM}{DD}_{hh}{mm}{ss}` is configured
- **WHEN** a snip is saved to file
- **THEN** the file name contains the expanded values in the local timezone
- **AND** characters illegal on the target filesystem are replaced per the sanitizer rules
- **AND** name collisions are resolved by appending an incrementing suffix

#### Scenario: Supported variables

- **GIVEN** the naming settings surface
- **WHEN** the user views available variables
- **THEN** the surface lists date/time (to milliseconds), weekday, window title of the frontmost app at snip time, and an optional literal suffix field
- **AND** each variable shows its expansion preview

### Requirement: Quick save flow

ClipForge SHALL support saving snips to a configured quick-save folder with one action, without a file dialog.

#### Scenario: Quick save with notification

- **GIVEN** quick save is enabled and the folder is writable
- **WHEN** the user triggers quick save on a snip
- **THEN** the PNG lands in the folder with the expanded name
- **AND** a toast shows the resolved file path with a reveal action

#### Scenario: Unwritable folder fallback

- **GIVEN** the quick-save folder is missing or unwritable
- **WHEN** quick save is triggered
- **THEN** ClipForge shows an actionable error naming the folder
- **AND** the snip result remains on the clipboard so no capture is lost

### Requirement: Snip CLI protocol

ClipForge SHALL expose a command-line interface equivalent to the hotkey flows for automation.

#### Scenario: CLI fullscreen snip to clipboard

- **GIVEN** ClipForge is running
- **WHEN** the user executes `clipforge snip --full -o clipboard`
- **THEN** a fullscreen capture is taken without UI and written to the clipboard
- **AND** the CLI exits 0 on success with a machine-readable one-line JSON result on stdout

#### Scenario: CLI region snip to file

- **GIVEN** ClipForge is running
- **WHEN** the user executes `clipforge snip --area X Y W H -o /path/out.png`
- **THEN** the region is captured and saved to the file path
- **AND** parent directories are created if missing

#### Scenario: CLI paste command

- **GIVEN** the clipboard contains text
- **WHEN** the user executes `clipforge paste --plain "hello"`
- **THEN** a paster window renders the text at the cursor position

#### Scenario: CLI when app not running

- **GIVEN** ClipForge is not running
- **WHEN** any CLI snip/paste command executes
- **THEN** the CLI prints a clear error and exits non-zero without launching the app

### Requirement: Hotkey command table

ClipForge SHALL manage snip/paster related global hotkeys in the existing settings hotkey surface, with per-command enablement and conflict degradation consistent with the current panel hotkey behavior.

#### Scenario: Conflict degradation

- **GIVEN** another app holds the F1 hotkey
- **WHEN** ClipForge starts and tries to register the snip hotkey
- **THEN** registration failure is logged as a warning and surfaced in settings
- **AND** the app continues running with the remaining hotkeys functional
