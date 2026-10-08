# Delta:自动打标机制调研(automated-tagging-eval)

> 调研类提案(P2,dormant)。本 delta 固化「tag 自动来源的分层边界」与「何时转实施」的判据,不引入任何新依赖、不改现有采集与打标行为。

## ADDED Requirements

### Requirement: tag 自动来源分层

自动打标 SHALL 分层执行:配置式规则为第一层(采集后异步、确定性),pi LLM 标签建议为第二层(仅显式触发),MCP 工具写回为第三层(外部集成);SHALL NOT 引入用户自定义脚本运行时作为打标执行体。

#### Scenario: 规则层默认行为

- **WHEN** 条目采集完成
- **THEN** 规则层在后台异步产出自动 tag,采集热路径耗时无可感知回退,规则失败静默降级为无自动 tag

#### Scenario: LLM 层触发边界

- **WHEN** 用户未发起显式打标动作(单条或批量回填)
- **THEN** 不调用 provider 做 tag 建议;AI 调用不进采集热路径

### Requirement: 人工 tag 权威性

自动打标(SHOULD)只追加或写入独立自动字段,SHALL NOT 静默覆盖人工打标值;合并展示时人工值优先。

#### Scenario: 自动不覆盖人工

- **WHEN** 某条目已有人工 tag,任一自动来源产出与之冲突的 tag 集合
- **THEN** 人工值保留,自动值以追加/并集方式合并,详情可区分来源

### Requirement: MCP 写回工具边界

若暴露 MCP `set_clip_tags` 工具,SHALL 复用 `normalize_tags` 白名单清洗,SHALL 提供 `append` 模式且对覆盖式写入施加确认或限制;不新增 MCP 配置面板。

#### Scenario: 外部 agent 追加 tag

- **WHEN** MCP 客户端调用 `set_clip_tags`(mode=append)
- **THEN** tags 经白名单清洗去重后并入该条目,响应返回更新后的 tag 集合

### Requirement: 转实施判据

本提案 SHALL 在「pi-sdk L3 smart-tag 完成、出现批量回填真实诉求、出现 MCP 写 tag 集成方」三项全部满足后才转实施;实施顺序为规则层 → MCP 层 → LLM 层。

#### Scenario: dormant 维持

- **WHEN** 三项判据未全部满足
- **THEN** 不实施任何自动打标编排,现有 `default_tags` 行为保持不变
