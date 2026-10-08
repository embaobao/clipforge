# Delta:自动打标机制调研(automated-tagging-eval)

> 调研类提案(P2,dormant)。本 delta 固化「tag 自动来源的分层边界」与「何时转实施」的判据,不引入任何新依赖、不改现有采集与打标行为。

## ADDED Requirements

### Requirement: tag 自动来源分层

自动打标 SHALL 分层执行:配置式规则为第一层(采集事务外异步、确定性),pi LLM 标签建议为第二层(仅显式触发),MCP 工具写回为第三层(外部集成);SHALL NOT 引入用户自定义脚本运行时作为打标执行体。

#### Scenario: 规则层默认行为

- **WHEN** 实施后某条目采集完成
- **THEN** 规则层在采集事务外异步产出自动 tag,采集热路径 P95(P50 观察)不回退,规则失败静默降级为无自动 tag

#### Scenario: LLM 层触发边界

- **WHEN** 用户未发起显式打标动作(单条或批量回填)
- **THEN** 不调用 provider 做 tag 建议;AI 调用不进采集热路径

### Requirement: 人工 tag 权威性

自动打标 SHALL 只追加或写入独立自动字段,SHALL NOT 覆盖人工打标值;合并写入 SHALL 原子完成且携带来源标记(实施期验收项)。

#### Scenario: 自动不覆盖人工

- **WHEN** 某条目已有人工 tag,任一自动来源产出与之冲突的 tag 集合
- **THEN** 人工值全保留,自动值以追加/并集方式合并

#### Scenario: 容量上限内人工优先

- **WHEN** 合并后 tag 总数超过上限(12)
- **THEN** 截断只作用于自动值(按来源时间,新者保留),人工值不被挤出

### Requirement: MCP 写回工具边界

若暴露 MCP `set_clip_tags` 工具,任何外部 tag 写回(含现有 `clipf.update` 的 `tags` 参数)SHALL 复用 `normalize_tags` 清洗并经与 product-iteration-governance「写回安全」一致的 preview/confirm 通道;不新增 MCP 配置面板。

#### Scenario: 外部 agent 追加 tag

- **WHEN** MCP 客户端调用 `set_clip_tags`(mode=append)
- **THEN** 响应返回白名单清洗去重后的 preview tag 集合与确认载荷;未二次确认前不落库

#### Scenario: 直写旁路收口

- **WHEN** 外部调用方经 `clipf.update` 传入 `tags`
- **THEN** 走与 `set_clip_tags` 相同的确认门禁,或该参数已移除并引导至 `set_clip_tags`

### Requirement: 转实施判据

本提案 SHALL 在以下三项全部满足后才转实施,三项均以仓库内证据核验:(1) `pi-sdk-agent-foundation/tasks.md` 的 L3 smart-tag 应用接线任务完成;(2) 设置页 tag 使用记录显示 ≥20 条同类条目被人工打了规则可表达的同类 tag;(3) 应用日志存在外部来源的 `clipf.update`/`set_clip_tags` 写调用记录。实施顺序为规则层 → MCP 层 → LLM 层。

#### Scenario: dormant 维持

- **WHEN** 三项判据未全部满足
- **THEN** 不实施任何自动打标编排,现有 `default_tags` 行为保持不变
