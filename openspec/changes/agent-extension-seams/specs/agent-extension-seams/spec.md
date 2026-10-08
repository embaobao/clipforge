# Delta:Agent 扩展接缝(agent-extension-seams)

> 接口设计类提案(dormant)。固化工具同源注册表与异步事件钩子的契约,不引入运行时。

## ADDED Requirements

### Requirement: 工具同源注册表

L2 与 L3 暴露的每个剪贴板领域能力 SHALL 消费同一 Rust 域层 dispatch;`McpToolSpec` SHALL 携带 version 字段,`tools/list` 输出 SHALL 按工具名稳定排序且 schema 仅做 additive 演进;L2 TS 工具清单 SHALL 由 Rust specs 生成物比对校验(生成物 check-in,门禁断言一致)。

#### Scenario: 新工具单点登记

- **WHEN** 开发者在某域新增一个能力并登记进该域 `tool_specs()`
- **THEN** L3 `tools/list` 自动包含该工具,L2 TS 清单在门禁断言失败时提示重新生成,无需手改两处

#### Scenario: 输出稳定

- **WHEN** 未增删工具的代码变更重建后
- **THEN** `tools/list` 输出与金样快照逐字节一致(排序稳定、schema 无漂移)

### Requirement: preview/confirm 令牌防重放

覆盖式 MCP 写回的确认令牌 SHALL 绑定请求参数哈希并设 TTL;令牌与参数不匹配或过期 SHALL 拒绝落库。

#### Scenario: 陈旧确认被拒

- **WHEN** 外部调用方持旧 confirm 令牌请求已变更参数的写回
- **THEN** 拒绝并返回需重新 preview 的错误,不产生任何写入

### Requirement: 异步事件钩子热路径契约

域层 SHALL 仅在数据库提交成功后发布内部事件;发布 SHALL 为有界入队(<1ms),消费 SHALL 在后台线程;满载 SHALL 丢弃并按事件类型×订阅者计数、限速告警,SHALL 提供全量对账兜底;订阅者失败 SHALL 静默降级;AI 推理 SHALL NOT 经由事件面进入采集热路径。

#### Scenario: 热路径不受订阅者拖累

- **WHEN** 某订阅者消费缓慢或挂起
- **THEN** 采集/更新/删除的 P95 不回退,事件按契约丢弃并计数,数据最终一致由对账兜底保证

#### Scenario: 事件不丢最终一致

- **WHEN** 回收站删除与恢复事件在满载期被部分丢弃
- **THEN** 订阅方执行全量对账后状态与数据库一致(trash/restore 成对语义保持)

### Requirement: dormant 维持

三项转实施判据(W1 收口、第二订阅方出现、第 3 处同源重复)未全部满足前,SHALL NOT 实现注册表路由改造、事件 bus 或清单生成脚本;现有 MCP 静态 specs 与 pi 工具实现保持不变。

#### Scenario: dormant 期间新增工具

- **WHEN** dormant 期间需要新增一个 L3 工具
- **THEN** 按现状在静态 specs 与 pi 侧分别登记,并在本提案 tasks 登记重复计数;达第 3 处即触发判据 3
