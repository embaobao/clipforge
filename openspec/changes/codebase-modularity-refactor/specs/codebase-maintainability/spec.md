# codebase-maintainability Spec Delta

## ADDED Requirements

### Requirement: File size gate

ClipForge SHALL enforce a source-file size gate for new and touched source files while tracking temporary exemptions for existing large files.

#### Scenario: Touched non-exempt source exceeds limit

- **GIVEN** a source file is created or modified
- **AND** the file is not listed in the file-size exemption list
- **WHEN** the file-size verification script runs
- **THEN** the script fails if the file exceeds 500 lines
- **AND** the failure identifies the offending file

#### Scenario: Existing exempt source exceeds limit

- **GIVEN** an existing oversized source file is listed in the exemption list
- **WHEN** the file-size verification script runs
- **THEN** the script reports the file as exempt or warning-only
- **AND** the exemption list remains explicit so the file can be removed after modularization

### Requirement: Domain-oriented module boundaries

ClipForge SHALL split large Rust and frontend surfaces by domain without changing public behavior.

#### Scenario: Extract native settings module

- **GIVEN** settings commands and MCP settings handlers share the same behavior
- **WHEN** the native settings implementation is modularized
- **THEN** Settings Service logic is placed behind a settings domain module
- **AND** command registration and MCP dispatch reuse the same service behavior
- **AND** existing command names and settings field semantics remain unchanged

#### Scenario: Extract frontend surface components

- **GIVEN** a frontend surface is split into smaller files
- **WHEN** the split lands
- **THEN** each extracted component has an explicit responsibility
- **AND** shared state is lifted only to the nearest common owner or an existing approved store
- **AND** the user-visible workflow remains unchanged

### Requirement: Maintainable verification contracts

ClipForge SHALL prefer structural verification contracts over brittle source-substring assertions when refactoring large surfaces.

#### Scenario: Refactor-safe verifier

- **GIVEN** a verifier protects an important UI or service invariant
- **WHEN** a component or module is split
- **THEN** the verifier checks exported contracts, data markers, commands, or behavior-oriented evidence where practical
- **AND** any remaining source-substring assertion documents why it is still necessary

### Requirement: Chinese documentation comments for public boundaries

ClipForge SHALL document public commands, exported types, and complex business boundaries in Chinese.

#### Scenario: Add public command or exported type

- **GIVEN** a new `#[tauri::command]`, exported TypeScript type, public Rust type, or complex business helper is added
- **WHEN** the code is reviewed
- **THEN** it includes a concise Chinese comment describing what it does, why it exists, and important boundaries
