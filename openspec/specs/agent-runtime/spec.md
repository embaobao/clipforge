# agent-runtime Specification

## Purpose
定义 ClipForge 中插件、Agent、MCP 和详情页编辑会话之间的安全运行边界。该规范约束 Agent 输出必须先进入建议或预览流程，插件和 MCP 只能读取脱敏上下文，生成内容必须保留 provenance，并且任何插件、Agent 或升级能力都不能阻塞快速剪贴板主路径。

## Requirements
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
