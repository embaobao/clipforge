# frontend-architecture Spec Delta

## ADDED Requirements

### Requirement: Frontend surfaces are isolated by domain

ClipForge SHALL organize frontend UI by product surface instead of accumulating unrelated UI in a single application file.

#### Scenario: Quick panel remains a clipboard surface

- **GIVEN** the quick panel is open
- **WHEN** history, favorites, search, trash, detail entry or Agent entry is available
- **THEN** the clipboard list remains the primary visual and interaction surface
- **AND** Agent, settings and rich detail code are not required for rendering the initial list rows

#### Scenario: Surface styles do not leak

- **GIVEN** settings, clipboard, workspace and Agent surfaces all exist
- **WHEN** one surface changes its layout or component styling
- **THEN** its selectors are scoped to that surface root
- **AND** it does not override unrelated quick-row, dropdown, toolbar or sidebar behavior in another surface

#### Scenario: Surface roots expose a stable identity marker

- **GIVEN** a clipboard, settings, workspace or Agent surface renders
- **WHEN** its root element is mounted
- **THEN** the root carries a stable `data-surface="<domain>"` marker that identifies the surface
- **AND** the marker does not change with transient UI state such as active surface, view mode or selection
- **AND** a boundary verifier asserts each expected surface root marker is present so the identity anchor cannot silently regress

### Requirement: Mature component primitives are reused

ClipForge SHALL prefer existing shadcn/Radix/Animate UI primitives for common controls.

#### Scenario: New common control is required

- **GIVEN** a feature needs a button, input, dropdown, tooltip, tabs, sidebar, separator, skeleton or toggle group
- **WHEN** the UI is implemented
- **THEN** it reuses the existing component-library primitive or a thin wrapper around it
- **AND** it does not introduce a second hand-written primitive with overlapping behavior

#### Scenario: Domain-specific performance component is required

- **GIVEN** the clipboard list needs virtual scrolling, fixed row height and keyboard selection
- **WHEN** the component-library primitives are not sufficient for that domain behavior
- **THEN** ClipForge MAY keep a custom domain component
- **AND** that component consumes shared theme tokens rather than defining an isolated visual system

### Requirement: Route boundaries support code splitting

ClipForge SHALL use the existing TanStack Router approach for page and surface route boundaries.

#### Scenario: Settings surface opens

- **GIVEN** the user opens the settings window or settings route
- **WHEN** the settings surface renders
- **THEN** settings shell, section navigation and tab content are loaded through the settings route boundary
- **AND** quick-panel list state is not coupled to settings tab rendering

#### Scenario: Agent surface opens

- **GIVEN** the user opens Agent from the quick panel
- **WHEN** the Agent surface renders
- **THEN** Agent conversation UI loads through the Agent surface boundary
- **AND** closing Agent returns focus intent to the quick panel without resetting clipboard selection

#### Scenario: Workspace detail opens

- **GIVEN** a clipboard item is selected
- **WHEN** the user enters detail
- **THEN** the workspace detail route renders the detail surface
- **AND** rich preview, editor and AI summary modules can be loaded outside the initial clipboard list path

### Requirement: Quick panel layout has stable functional regions

ClipForge SHALL implement the quick panel as stable functional regions.

#### Scenario: Main list state

- **GIVEN** the quick panel is in normal history or favorites mode
- **WHEN** the panel renders
- **THEN** it contains TopCommandBar, optional ModeBar, ClipboardList, StatusFeedback and OverlayLayer regions
- **AND** the ClipboardList receives the largest usable area

#### Scenario: Quick reuse draft layout

- **GIVEN** the quick panel follows the 2026-07-16 quick reuse panel draft
- **WHEN** the panel renders in normal history mode
- **THEN** the header contains a stable SearchBox and PanelMoreMenu trigger
- **AND** ClipboardViewTabs only switches clipboard list views such as history, favorites or trash
- **AND** pinned items render in a bounded PinnedClipboardSection above the main AllClipboardSection
- **AND** pin controls do not change row height, list scroll position or keyboard selection behavior

#### Scenario: Menu trigger remains an app action menu

- **GIVEN** the user opens the logo/menu trigger from the quick panel header
- **WHEN** the dropdown menu renders
- **THEN** it exposes ClipForge app actions such as settings, trash, shortcuts, diagnostics or quit
- **AND** it does not introduce account, billing or team navigation unless a future product proposal explicitly adds those domains

#### Scenario: Multi-select state

- **GIVEN** multi-select mode is active
- **WHEN** one or more rows are selected
- **THEN** ModeBar or an equivalent stable action region shows selection count and batch actions
- **AND** row height and scroll position do not jump because of the action region

### Requirement: Product function areas have fixed interaction contracts

ClipForge SHALL preserve distinct interaction contracts for quick clipboard, detail, settings, Agent and system feedback areas.

#### Scenario: Detail does not replace quick clipboard behavior

- **GIVEN** the user enters a clipboard item detail view
- **WHEN** the user returns to the quick panel
- **THEN** the original list context and focus intent are restored
- **AND** detail-specific previews, editor actions and AI summary panels do not change row height or list selection behavior

#### Scenario: Settings remains outside the quick path

- **GIVEN** the user opens settings
- **WHEN** settings sections, tabs, diagnostics or provider templates render
- **THEN** they render inside the settings surface
- **AND** the quick panel does not synchronously load or wait on settings diagnostics, update checks or provider state

#### Scenario: Agent writes back only through explicit actions

- **GIVEN** Agent generates or transforms clipboard content
- **WHEN** the result is ready
- **THEN** ClipForge offers explicit copy, save or paste actions
- **AND** it does not silently modify clipboard history or current user content

#### Scenario: Feedback is short and non-blocking

- **GIVEN** copy, delete, restore, save, permission or provider feedback is shown
- **WHEN** the feedback appears
- **THEN** it does not obscure the active list row or reset scroll position
- **AND** failure feedback names the next available action

### Requirement: Settings fields are catalog-driven where possible

ClipForge SHALL render ordinary settings fields from a field catalog and reserve custom panels for complex workflows.

#### Scenario: Ordinary setting

- **GIVEN** a setting is an enum, boolean, bounded number, slider, readonly path or code example
- **WHEN** it is rendered in the settings surface
- **THEN** its field type maps to a standard SettingsField renderer
- **AND** save feedback continues through the existing settings update flow

#### Scenario: Complex settings workflow

- **GIVEN** a settings area handles permissions, diagnostics, update flow, provider templates or tag rules
- **WHEN** the area is rendered
- **THEN** it may use a custom panel component
- **AND** the custom panel is still placed inside the settings shell, tabs and status feedback contract

### Requirement: Theme tokens are centralized

ClipForge SHALL centralize visual decisions in shared theme and semantic tokens.

#### Scenario: Surface needs active state styling

- **GIVEN** a row, menu item, tab, sidebar item or action enters active state
- **WHEN** it is styled
- **THEN** it uses semantic tokens for active background, border, text and focus ring
- **AND** it does not hard-code a new unrelated color palette inside the component

#### Scenario: Legacy global CSS remains during migration

- **GIVEN** legacy `App.css` rules still exist during staged migration
- **WHEN** a new UI change is implemented
- **THEN** new styles are added under the destination surface style file
- **AND** no new global `P-FINAL` override block is added to `App.css`

### Requirement: Superseded proposal cleanup is explicit

ClipForge SHALL not keep multiple active frontend layout proposals with conflicting interaction definitions.

#### Scenario: New architecture baseline supersedes historical layout notes

- **GIVEN** the frontend surface architecture proposal is accepted
- **WHEN** older layout, visual recovery or component-shell proposals overlap with its decisions
- **THEN** the roadmap marks those proposals as superseded, archived or still active
- **AND** historical files are deleted only after their remaining spec value is merged into current specs or this proposal
