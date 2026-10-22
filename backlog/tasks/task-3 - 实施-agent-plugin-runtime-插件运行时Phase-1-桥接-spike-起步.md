---
id: TASK-3
title: 实施 agent-plugin-runtime 插件运行时(Phase 1 桥接 spike 起步)
status: In Progress
assignee: []
created_date: '2026-10-10 05:46'
updated_date: '2026-10-22 05:09'
labels:
  - feature
  - agent
dependencies: []
priority: high
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
按 openspec/changes/agent-plugin-runtime/ 提案实施插件化 Agent 能力运行时。入口:Phase 1 桥接 spike(任务 1.0-1.3,时间盒 1 周):cordis-rs ="=0.11.1" 精确 pin + rquickjs,plugin_runtime 门面模块(cordis 类型不出模块),闸门=一个 Fiber 内嵌 QuickJS Runtime 跑通 ctx 四组接口桥(clipf/on/register/log,对齐 tasks 1.1)+dispose 回收+内存上限;失败按 1.3 降级门面内自研(接口不变)。1.3 收口时三个回写勿漏:闸门结论回写提案风险节、cordis update 可行性回写 design §12、每实例内存基线(memory_usage)回写 design §18.2。完整计划/接口契约/验收见 proposal.md、design.md(20 节,含 §15 错误码契约/§16 开发调试/§17 发布分发/§18 内存细则/§19 全链路预演)、tasks.md(5 Phase)、specs/ 三份 spec;openspec validate --strict 已绿(改动后需重跑)。纪律:golden 冻结 ctx 方法集/manifest schema/事件信封/能力分级/PLUGIN_* 错误码;宿主 mcp/specs.rs 40 条不动;门禁 pnpm build + cargo check。
<!-- SECTION:DESCRIPTION:END -->
