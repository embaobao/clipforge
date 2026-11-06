# snip-capture Spec Delta

## ADDED Requirements

### Requirement: Global snip hotkey and mask-first flow

ClipForge SHALL provide a global hotkey (default F1, configurable) that starts a snip session by immediately showing a full-screen mask overlay, then replacing it with the frozen screen capture once the base image is ready.

#### Scenario: Hotkey to mask within budget

- **GIVEN** ClipForge is running with the snip hotkey registered
- **WHEN** the user presses the snip hotkey
- **THEN** a full-screen mask overlay becomes visible on the target display within 120ms
- **AND** the frozen base image replaces the mask within 600ms
- **AND** the overlay covers exactly the display the cursor is on (multi-display: one overlay per display, snip starts on cursor display)

#### Scenario: Screen recording permission missing

- **GIVEN** the app lacks screen recording permission
- **WHEN** the user presses the snip hotkey
- **THEN** ClipForge shows a permission guidance surface instead of a silent failure
- **AND** after granting permission, the next hotkey press starts a normal snip session without app restart

### Requirement: Region selection with pixel precision

ClipForge SHALL let the user select a rectangular region on the frozen base image with pointer drag, keyboard pixel nudging, and window snapping.

#### Scenario: Drag to select and confirm

- **GIVEN** the frozen base image is shown
- **WHEN** the user drags a rectangle and presses Enter (or releases on quick mode)
- **THEN** the region is cropped from the base image and dispatched to the configured output target
- **AND** the overlay closes within 150ms after confirmation

#### Scenario: Keyboard pixel adjustments

- **GIVEN** a region is selected
- **WHEN** the user presses arrow keys (move), Shift+arrow or `[`/`]` (resize edges by 1px)
- **THEN** the region adjusts by exactly 1 logical pixel per keypress

#### Scenario: Window snap highlight

- **GIVEN** the base image with window rectangles from CGWindowList
- **WHEN** the cursor moves over a window region before dragging starts
- **THEN** that window's rectangle is highlighted
- **AND** clicking confirms the whole-window region; pressing Tab cycles to the next window beneath

#### Scenario: Reuse last region

- **GIVEN** a previous successful snip exists in this session
- **WHEN** the user invokes the "repeat last region" hotkey
- **THEN** the same region is captured again from a fresh base image without showing the overlay

### Requirement: Magnifier color pick

ClipForge SHALL provide a magnifier while snipping that shows pixels around the cursor with zoom and the color value under the cursor in RGB and HEX formats.

#### Scenario: Pick color to clipboard history

- **GIVEN** the magnifier is visible
- **WHEN** the user triggers the pick action (click with pick mode, or dedicated hotkey)
- **THEN** the color under the cursor is copied as text (HEX) to the system clipboard
- **AND** a color clip (payloadKind `color`) is appended to ClipForge clipboard history
- **AND** HEX letter case follows the existing setting from `clipboard/detect.rs` color semantics integration

### Requirement: Output targets for snip result

ClipForge SHALL dispatch the confirmed snip region to one or more configured targets: clipboard, paste-as-image-window, or quick-save file.

#### Scenario: Copy to clipboard by default

- **GIVEN** the user confirms a region with the copy action (Enter / double-click, per settings)
- **WHEN** the crop completes
- **THEN** the PNG image is written to the system clipboard through the existing writeback path with loop suppression
- **AND** the image is offered to clipboard history capture according to the auto-save-to-history setting (default off)

#### Scenario: Snip then paste directly

- **GIVEN** the user confirms with the paste action
- **WHEN** the crop completes
- **THEN** the image becomes a new paste window (paster domain) at the snipped screen position
- **AND** the system clipboard is also updated to the same image

#### Scenario: Quick save folder

- **GIVEN** quick save is enabled with a configured folder and naming pattern
- **WHEN** the user confirms with the quick-save action
- **THEN** the PNG is written to the folder with the pattern-expanded file name
- **AND** a non-intrusive notification shows the file path
