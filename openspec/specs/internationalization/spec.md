# internationalization Specification

## Purpose
TBD - created by archiving change app-internationalization-en-support. Update Purpose after archive.
## Requirements
### Requirement: Language preference and locale resolution

ClipForge SHALL support a persisted language preference with system, Chinese, and English options, and SHALL resolve that preference to the active application locale at startup.

#### Scenario: Resolve system language

- **GIVEN** the language preference is `system`
- **WHEN** ClipForge starts
- **THEN** ClipForge resolves the active locale from the operating system language
- **AND** Chinese system languages resolve to `zh-CN`
- **AND** non-Chinese system languages resolve to `en-US`

#### Scenario: Persist explicit language choice

- **GIVEN** the user selects `zh-CN` or `en-US` in settings
- **WHEN** ClipForge saves settings and restarts
- **THEN** ClipForge keeps the explicit language preference
- **AND** the active locale matches the saved choice

### Requirement: Localized user interface copy

ClipForge SHALL render user-visible application copy through aligned `zh-CN` and `en-US` dictionaries.

#### Scenario: Render translated UI copy

- **GIVEN** the active locale is `en-US`
- **WHEN** the quick panel, settings window, detail actions, empty states, errors, tooltips, or menus render user-visible copy
- **THEN** the copy is read from the English dictionary
- **AND** matching Chinese dictionary keys exist for the same copy

#### Scenario: Detect missing translation keys

- **GIVEN** source code references a translation key
- **WHEN** the i18n key check runs
- **THEN** the check reports missing referenced keys
- **AND** the `zh-CN` and `en-US` dictionaries must remain key-aligned

### Requirement: Native and document language surfaces

ClipForge SHALL apply the active locale to document metadata and native user-visible surfaces where supported.

#### Scenario: Update document language and title

- **GIVEN** ClipForge resolves an active locale
- **WHEN** a main or settings webview starts
- **THEN** `document.documentElement.lang` matches the active locale
- **AND** the window title is localized

#### Scenario: Refresh native menu copy

- **GIVEN** the user changes language preference
- **WHEN** ClipForge refreshes tray or native menu copy
- **THEN** open panel, settings, pause or resume listening, and quit actions display localized labels

### Requirement: Internationalization release gate

ClipForge SHALL provide release checks that keep translation keys aligned and expose hardcoded user-copy candidates before distribution.

#### Scenario: Run i18n checks

- **GIVEN** a release candidate is prepared
- **WHEN** the i18n check command runs
- **THEN** dictionary keys are compared across locales
- **AND** referenced keys are validated
- **AND** hardcoded user-copy candidates are reported for review

#### Scenario: Preserve non-translated content

- **GIVEN** logs, error codes, command names, MCP tool names, file names, user tags, or clipboard content contain text
- **WHEN** i18n checks and UI translation logic run
- **THEN** those values are not treated as required translation copy

