# 提案：代码可维护性地基重构

## 优先级

横切（与功能提案并行，不独占优先级序列）。最早的两块拆分（lib.rs settings 模块、前端 settings 组件）直接服务 [settings-service-unified-protocol](../settings-service-unified-protocol/proposal.md) 和 [settings-interface-redesign](../settings-interface-redesign/proposal.md)，应先于或并行于它们推进。

## 背景

当前主文件普遍远超可维护规模，且 CLAUDE.md / 文档对规模的描述已严重失实：

| 文件 | 实际行数 | 说明 |
|------|----------|------|
| `src-tauri/src/lib.rs` | 11,062 | IPC + Service + 数据/平台 + 后台监听 + 写回抑制 + 面板定位 + MCP stdio 全塞一个文件 |
| `src/App.tsx` | 4,869 | CLAUDE.md 仍写「~2,800 行」；快速面板单体 |
| `src/settings.tsx` | 1,520 | 设置页单体（settings-interface-redesign 已规划拆 `src/settings/`） |
| `src/agent-panel.tsx` | 1,277 | Agent 面板单体 |
| `src/agent-chat-page.tsx` | 809 | Agent 聊天页单体 |

校验脚本现状放大了这个债务：`scripts/verify-agent-panel.mjs` 等用 ~150 条源码子串（`app.includes(...)`）断言不变量。这种写法在组件拆分后会大面积误报，等于把重构和校验锁死在一起。

## 目标

1. 立**开发规范**并落地为可执行门禁：单文件 ≤ 500 行、公共类型/命令/复杂逻辑必须有中文注释、按域组件化、样式随组件拆。
2. 把 verify 脚本从「源码子串断言」升级为「结构化 / 契约 / data-marker 断言」，让拆分不再触发误报。
3. 分阶段、**非 big-bang** 地拆分主文件，每个切片可独立验证、独立合并、不阻塞功能线。
4. 优先拆「能解锁功能」的模块：lib.rs 的 settings/agent/mcp 模块（服务 MCP dispatch 复用）、前端的 settings 组件目录（服务设置页重构）。
5. 建立长期门禁：新增/改动文件超 500 行由脚本拦截；存量按域逐步还债，不要求一次性达标。

## 非目标

- 不做一次性大规模重写（big-bang rewrite）；每个切片必须保持行为不变、verify 通过。
- 不改变任何对外行为、命令名、配置字段语义。
- 不在本提案内迁移主面板设置生命周期（仍由 settings-service-unified-protocol 第三阶段处理）。
- 不引入新的运行时框架或状态管理库；Zustand 仅维持现状用于跨组件 UI 状态。
- 不追求「所有文件立刻 ≤500 行」；存量债务按切片还，门禁先拦新增。

## 500 行门禁的边界

硬门禁范围（必须 ≤500 行，否则 verify 失败）：

- 所有**新增**源文件。
- 所有**被本次改动触碰**的文件（改了就必须达标或在本切片内拆到达标）。

存量豁免（带「待还债」标记，不在本提案一次性拆）：

- `lib.rs`、`App.tsx`、`settings.tsx`、`agent-panel.tsx`、`agent-chat-page.tsx` 按各自功能提案的切片逐步拆。

豁免清单写进 `tasks.md`，门禁脚本读取豁免清单，对清单内文件只 warn 不 fail，对清单外超 500 行的文件 fail。

## 用户价值

- 新接手者能在一个文件内读懂一个域，不必在 4000 行单体里搜索。
- 重构不再触发校验脚本误报，校验和重构可以独立推进。
- 设置服务、设置页、Agent 面板的功能改动落地在更小的组件里，回归面更小。
- 中文注释让 Rust 命令、契约类型、复杂逻辑对中文协作者可读，与提案/设计文档语言一致。

## 成功标准

- `AGENTS.md` 明确写下四条开发规范。
- `scripts/verify-file-size.mjs` 落地：对豁免清单外文件超 500 行 fail，清单内只 warn。
- 至少完成一个 lib.rs 模块拆分切片（settings）和一个前端组件拆分切片（settings 页局部），且 `pnpm build` + `cargo check` + 全部 verify 脚本通过。
- 至少一个 verify 脚本从源码子串断言升级为结构化断言。
- 新增公共类型、`#[tauri::command]`、复杂业务函数带中文注释。

## 与现有提案的关系

| 提案 | 本提案如何配合 |
|------|----------------|
| settings-service-unified-protocol | 先拆 lib.rs settings 模块，让 Tauri command 和 MCP dispatch 共用同一 SettingsService 实现（B3 前置） |
| settings-interface-redesign | 提供设置页组件目录拆分骨架（design.md §10） |
| clipboard-agent-panel | 拆 agent-panel.tsx / agent-chat-page.tsx 时升级 verify-agent-panel.mjs |
| 全部 | 500 行门禁 + 中文注释规范全局生效 |
