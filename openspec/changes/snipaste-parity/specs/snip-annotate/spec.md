# snip-annotate Spec Delta

## ADDED Requirements

### Requirement: Annotation tools on snip canvas

ClipForge SHALL provide an annotation tool set on the snip overlay before confirming output: pen, marker, rectangle, ellipse, arrow, line, text, sequence numbers, mosaic, and blur.

#### Scenario: Draw and layer annotations

- **GIVEN** a region is selected on the snip overlay
- **WHEN** the user draws multiple annotations with different tools
- **THEN** each annotation renders as an independent layer in creation order
- **AND** annotations never alter the base image pixels until export

#### Scenario: Mosaic and blur cover content

- **GIVEN** the user applies mosaic or blur over an area
- **WHEN** the result is exported
- **THEN** the covered pixels are irrecoverable in the exported image
- **AND** the export renders effects at native image resolution (no visible seams between the affected region and untouched area)

#### Scenario: Sequence numbers

- **GIVEN** the sequence-number tool is active
- **WHEN** the user clicks on the canvas repeatedly
- **THEN** numbered badges (1, 2, 3…) are placed at the click points in order

### Requirement: Undo and redo

ClipForge SHALL support undo and redo of annotation edits with a bounded history.

#### Scenario: Undo restores previous state

- **GIVEN** the user has drawn at least one annotation
- **WHEN** undo is triggered (Ctrl/Cmd+Z)
- **THEN** the last annotation edit is removed from the canvas
- **AND** the base image and selection rectangle are unaffected

#### Scenario: Redo after undo

- **GIVEN** the user has undone at least one edit
- **WHEN** redo is triggered (Ctrl/Cmd+Shift+Z)
- **THEN** the undone edit is reapplied in its original order

### Requirement: Brush width via wheel

ClipForge SHALL let the user adjust the active brush width with the mouse wheel while an annotation tool is active, without leaving the canvas.

#### Scenario: Wheel adjusts width

- **GIVEN** a drawing tool is active
- **WHEN** the user scrolls the wheel
- **THEN** the brush width changes in discrete steps within a bounded range
- **AND** the current width is visible on the toolbar

### Requirement: Export annotated result

ClipForge SHALL flatten annotations onto the cropped region at export time and dispatch the flattened image to the chosen output target.

#### Scenario: Copy annotated image

- **GIVEN** annotations exist on the canvas
- **WHEN** the user confirms with the copy action
- **THEN** the exported PNG contains the flattened result at the region's native resolution
- **AND** the system clipboard receives the flattened image, not the base crop

#### Scenario: Cancel keeps nothing

- **GIVEN** annotations exist on the canvas
- **WHEN** the user cancels the snip (Esc per settings)
- **THEN** no image is written to clipboard or disk
- **AND** the annotation session state is discarded
