# agent-runtime Specification Delta

## ADDED Requirements

### Requirement: Mastra runtime evaluation isolation

ClipForge SHALL evaluate Mastra only as an optional Agent runtime candidate and SHALL keep it isolated from clipboard hot paths until measured proof shows no regression.

#### Scenario: Quick panel remains independent

- **GIVEN** Mastra is being evaluated or prototyped
- **WHEN** the user opens the quick panel, scrolls the clipboard list, changes selection, copies, or pastes
- **THEN** those interactions do not synchronously start, query, or wait for Mastra runtime, workflows, memory, provider detection, or model listing
- **AND** failure of the Mastra runtime affects only Agent workbench surfaces
- **AND** clipboard monitoring, search, copy, paste, tray, and global shortcut behavior remain available

#### Scenario: Runtime POC is gated

- **GIVEN** a Mastra POC is proposed
- **WHEN** the POC is reviewed
- **THEN** it defines cold start, warm start, first response, resident memory, package size, signing, offline startup, tool allowlist, Settings Service redaction, and logging checks before implementation
- **AND** it does not log API keys, prompts, model outputs, clipboard content, or sensitive settings values
