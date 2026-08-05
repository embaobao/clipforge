# onboarding-window Specification

## Purpose

定义 ClipForge 引导页从设置页 tab 拆为独立窗口后的首次体验、设置页入口、首启动展示、设置页 sidebar 常驻，以及后续兜底与日志边界。本 change 首期只交付独立引导窗口链路；sidebar、兜底和日志按后续 phase 推进。

## ADDED Requirements

### Requirement: Standalone onboarding window

ClipForge SHALL present onboarding in a dedicated `onboarding` Tauri window with an isolated frontend entry, fixed layout size, and no dependency on the settings page sidebar, header, or scroll container.

#### Scenario: User opens onboarding

- **GIVEN** onboarding is opened automatically or from settings
- **WHEN** the window is created
- **THEN** ClipForge shows a dedicated `onboarding` window
- **AND** the window renders the onboarding steps without embedding the settings page frame
- **AND** the main panel, tray menu, and global shortcut remain available

### Requirement: Settings onboarding entry

ClipForge SHALL remove the full onboarding wizard from the settings page and replace it with a lightweight status summary and an explicit "open onboarding" action.

#### Scenario: User revisits onboarding from settings

- **GIVEN** the settings page is open
- **WHEN** the user navigates to the onboarding tab or section
- **THEN** the page shows whether onboarding is complete
- **AND** it provides a button that opens the dedicated onboarding window
- **AND** it does not render the full onboarding wizard inline

### Requirement: First-run onboarding display

ClipForge SHALL show onboarding automatically only when onboarding is incomplete, has not already been shown for the current installation state, and the startup permission check finds a missing required permission.

#### Scenario: First launch shows onboarding once

- **GIVEN** `onboardingCompleted` is `false`
- **AND** `onboardingShownAt` is empty
- **AND** the startup Accessibility permission check reports a missing permission
- **WHEN** the application starts
- **THEN** ClipForge opens the dedicated onboarding window
- **AND** records `onboardingShownAt`
- **AND** subsequent launches do not auto-open onboarding unless the user reopens it from settings

### Requirement: Persistent settings sidebar

ClipForge SHALL keep the settings sidebar fully visible instead of collapsing it to an icon-only rail once the onboarding window no longer depends on the settings page frame.

#### Scenario: User navigates settings

- **GIVEN** the settings page is open
- **WHEN** the user switches between settings sections
- **THEN** all top-level settings categories remain readable in the sidebar
- **AND** no sidebar trigger is required to reveal category names
- **AND** the sidebar does not float over or obscure settings content

### Requirement: Settings and onboarding fallbacks

ClipForge SHALL provide visible fallback states for loading, read errors, missing permissions, empty data, and narrow windows in settings and onboarding surfaces.

#### Scenario: Permission check fails during onboarding

- **GIVEN** the user reaches a permission-related onboarding step
- **WHEN** the permission check fails or the permission is missing
- **THEN** ClipForge shows a clear next action to open system settings
- **AND** provides a way to refresh the permission check
- **AND** does not show a blank or broken layout

### Requirement: Settings and onboarding observability

ClipForge SHALL emit standardized JSONL diagnostic events for onboarding navigation, completion, settings section changes, fallbacks, render errors, and performance samples without recording sensitive values.

#### Scenario: User completes onboarding

- **GIVEN** the user finishes or skips onboarding
- **WHEN** ClipForge records the completion result
- **THEN** it emits an `onboarding.complete` diagnostic event
- **AND** the event includes only summary fields such as source, completed/skipped state, step, and duration
- **AND** it does not include clipboard content, setting values, permission tokens, API keys, or user secrets
