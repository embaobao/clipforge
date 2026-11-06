# paster-windows Spec Delta

## ADDED Requirements

### Requirement: Paste clipboard content as image windows

ClipForge SHALL create a floating always-on-top window ("paster") from the current clipboard content when the paste hotkey (default F3) is invoked, supporting image, plain text, color value, and image file sources.

#### Scenario: Paste image from clipboard

- **GIVEN** the clipboard contains an image
- **WHEN** the paste hotkey is invoked
- **THEN** a native panel appears at the cursor position showing the image at natural size
- **AND** the panel does not activate (steal focus from the current app)

#### Scenario: Paste text as image

- **GIVEN** the clipboard contains plain text
- **WHEN** the paste hotkey is invoked
- **THEN** the text is rendered to an image (hidden webview, system font fallback for CJK) and shown in a paster window
- **AND** the source text remains available via the paster context menu (copy plain text)

#### Scenario: Paste color value

- **GIVEN** the clipboard contains a recognized color value (per `clipboard/detect.rs` color semantics)
- **WHEN** the paste hotkey is invoked
- **THEN** a color swatch image with the HEX text is rendered and shown in a paster window

#### Scenario: Paste image file path

- **GIVEN** the clipboard contains a file path pointing to a supported image file
- **WHEN** the paste hotkey is invoked
- **THEN** the file's image content is shown in a paster window
- **AND** the context menu exposes "reveal source file"

### Requirement: Paster window transforms

ClipForge SHALL support per-window zoom, rotate, flip, opacity, and click-through controls.

#### Scenario: Wheel zoom

- **GIVEN** a paster window is visible
- **WHEN** the user scrolls the wheel over it
- **THEN** the window scales around the cursor position in discrete steps within bounded limits

#### Scenario: Rotate and flip

- **GIVEN** a paster window is visible
- **WHEN** the user presses the rotate/flip shortcuts (per keybinding settings)
- **THEN** the image rotates by 90° steps or mirrors horizontally/vertically without quality loss relative to source pixels

#### Scenario: Opacity adjustment

- **GIVEN** a paster window is visible
- **WHEN** the user adjusts opacity (Ctrl+wheel or menu)
- **THEN** the window alpha changes continuously within 10%-100%
- **AND** the value persists across restart for that window

#### Scenario: Click-through toggle

- **GIVEN** a paster window is visible
- **WHEN** the user toggles click-through (menu or shortcut)
- **THEN** mouse events pass through to the content beneath
- **AND** the window remains visually unchanged and recoverable via the paster management surface

### Requirement: Paster lifecycle and edge snapping

ClipForge SHALL persist paster windows across app restarts, enforce a bounded window pool, and snap windows to screen edges.

#### Scenario: Restore after restart

- **GIVEN** paster windows exist when ClipForge quits
- **WHEN** the app relaunches
- **THEN** all paster windows are restored to their last position, transform, and opacity
- **AND** windows landing off-screen (display topology changed) are pulled back to the nearest visible area

#### Scenario: Window pool limit

- **GIVEN** the paster count reaches the pool limit (default 50)
- **WHEN** a new paster is created
- **THEN** the oldest paster is closed automatically
- **AND** a log entry records the eviction

#### Scenario: Edge snap

- **GIVEN** a paster window is dragged near a screen edge (within the snap threshold)
- **WHEN** the drag ends
- **THEN** the window aligns flush to that edge

### Requirement: Paster context menu

ClipForge SHALL provide a native context menu on paster windows with copy variants, save, transform, click-through, and close actions.

#### Scenario: Copy actions match source kind

- **GIVEN** a paster created from text
- **WHEN** the user opens the context menu
- **THEN** copy actions include "copy image", "copy plain text", and for HTML-sourced text "copy HTML"
- **AND** for image-file pasters, "copy source file path" is available

#### Scenario: Hide and show all

- **GIVEN** multiple paster windows are visible
- **WHEN** the user invokes "hide all pasters" (hotkey or tray)
- **THEN** all paster windows hide without closing
- **AND** invoking the action again restores them to their prior positions
