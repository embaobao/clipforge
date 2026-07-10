# agent-runtime Spec Delta

## ADDED Requirements

### Requirement: Agent suggestion boundary

ClipForge SHALL expose Agent update output as a suggestion result, not as a direct content write.

#### Scenario: Agent suggests editor update

- **GIVEN** an active editor session exists
- **WHEN** an Agent returns a content patch or tag patch
- **THEN** ClipForge represents the output as a suggestion or preview patch
- **AND** no clip content, tag, SQLite record, or system clipboard value changes until the user confirms

### Requirement: Agent generated provenance

ClipForge SHALL mark Agent-generated clips and Agent-applied saves with provenance metadata.

#### Scenario: Save Agent-generated clip

- **GIVEN** a user saves a new clip from Agent output
- **WHEN** the save succeeds
- **THEN** the clip metadata includes Agent provenance such as provider id, run id, generated flag, and applied timestamp
- **AND** the clip receives the default `AI` tag

#### Scenario: Preserve user removal of AI tag

- **GIVEN** a user manually removed the `AI` tag from a clip
- **WHEN** the user performs a normal non-Agent edit save
- **THEN** ClipForge does not automatically add the `AI` tag back

### Requirement: Safe provenance in context snapshots

ClipForge SHALL expose only safe provenance summaries in context snapshots and MCP results.

#### Scenario: Context snapshot includes provenance summary

- **GIVEN** a clip has Agent provenance metadata
- **WHEN** a plugin, Agent, or MCP client requests the context snapshot
- **THEN** the response may include safe provenance fields and default tag summaries
- **AND** the response does not include full clip body text unless the permission policy allows it
