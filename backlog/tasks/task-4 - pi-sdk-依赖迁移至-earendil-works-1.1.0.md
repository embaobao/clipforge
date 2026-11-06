---
id: TASK-4
title: pi sdk 依赖迁移至 @earendil-works/* 1.1.0
status: Done
assignee: []
created_date: '2026-10-10 16:10'
updated_date: '2026-10-21 20:32'
labels:
  - maintenance
  - agent
  - pi
dependencies: []
priority: high
ordinal: 4000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
旧 scope `@mariozechner/pi-agent-core` / `@mariozechner/pi-ai` 0.73.1 已 5 个月未发版，疑似冻结；pi 主仓已迁到新 scope `@earendil-works/*`，现行 1.1.0。本任务将 ClipForge 的 pi 适配层迁移到新 scope，保证 `src/agent/pi/` 功能等价、类型编译通过、provider 实流可用。

## Scope / Changes

- `package.json`：移除 `@mariozechner/pi-agent-core`、`@mariozechner/pi-ai`；新增 `@earendil-works/pi-agent-core@1.1.0`、`@earendil-works/pi-ai@1.1.0`。
- 更新 `src/agent/pi/` import scope：
  - `agent.ts`：`Agent`, `getModel`, `KnownProvider`
  - `tools.ts`：`Type`
  - `stream.ts`：`streamSimple`, `AssistantMessage`
  - `provider-config.ts`：`completeSimple`, `getModel`, `getProviders`, `AssistantMessage`, `KnownProvider`
- API 适配（以 1.1.0 d.ts 审计为准）：
  - `Agent` 构造现要求 `streamFn`（可用 `Models.streamSimple` 或 `compat` 顶层流式函数）。
  - `getApiKey` 签名改为 `(provider: string) => ...`，需调整 `agent.ts`。
  - `completeSimple` / `getModel` / `getProviders` 若不再从主入口导出，统一改为 `@earendil-works/pi-ai/compat` 或迁移到 `createModels()` 新 API；优先保持最小改动，必要时在 `provider-config.ts` 内封装。
- 若 `KnownProvider` 字面量有变，同步 `AgentProviderConfig["provider"]` 类型与设置页表单校验。
- `pnpm install` 后跑 `pnpm build:web`（tsc + vite build）。
- `cargo check` 不变（Rust 侧不依赖 pi）。
- `pnpm tauri dev` + `CLIPFORGE_DISABLE_CAPTURE=1` 冒烟，重点验证：
  - 设置页 Agent provider 检测返回 ready；
  - 详情页「AI 分析」正常出摘要/标签；
  - provider 真实网络流式输出不断链。

## Risks

- **未审计的 API 变更**：1.1.0 中 `Agent` 构造、`getApiKey`、流式/补全入口可能有破坏性变更；若 `compat` 入口也 deprecated，需切换到 `createModels()`，工作量大于预期。
- **Node 引擎**：新包要求 `node>=22.19.0`，CI/本地需确认版本。
- **Provider ID 变化**：`KnownProvider` 联合类型新增/重命名可能导致设置里已有 provider 失效，需回退或迁移配置。
- **Telemetry 依赖**：`@earendil-works/pi-ai` 依赖 `@earendil-works/pi-telemetry`，需确认可正常安装且无额外运行时配置。

## Dependencies

- 前置：本任务不阻塞 `pi-sdk-agent-foundation` 提案归档；归档后单独执行。
- 关联：settings 的 `agentProviders` 配置结构（`AgentProviderManager.tsx`）不变。
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `src/agent/pi/` 所有旧 scope import 全部替换为新 scope，无 `@mariozechner/*` 残留。
- [x] #2 `pnpm build:web` 通过（TypeScript 无错误）。
- [ ] #3 `pnpm tauri dev` 启动并带 `CLIPFORGE_DISABLE_CAPTURE=1` 完成冒烟。
- [x] #4 至少对一个已配置 provider 执行真实流式分析，确认 `piStream` / `piComplete` 返回正常文本。
- [x] #5 `verify-surface-boundaries.mjs` / `verify-runtime-boundaries.mjs` 中关于 pi 的断言若有 scope 硬编码则同步更新。
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
验收(监工 10-22 复跑): build:web ✓4.38s / test:unit ✓ / cargo check ✓0.84s / grep @mariozechner 零命中 / node_modules 无旧 scope, 新 scope 1.1.0 就位。AC-3(UI 冒烟)未勾: 机器锁屏(CSSessionScreenIsLocked=True) CGEvent 不派发, UI 点不动; 实质链路已由探针端到端验证(piComplete/piStream/analyzeClipWithPi 真实返回), 解锁后补点。AC-4 证据为探针直驱适配层(同代码路径)。
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
pi sdk 迁移完成(fa603a2): @mariozechner/* 0.73.1 → @earendil-works/* 1.1.0, compat 入口适配(piComplete/piStream/createClipForgeAgent 签名不变)。验证: pnpm build:web + test:unit + cargo check 全绿, 旧 scope grep 零残留, 探针直驱网关 newapi/zai 实测流式+摘要+标签正常。UI 级冒烟因锁屏未覆盖, AC-3 留开。
<!-- SECTION:FINAL_SUMMARY:END -->

## Notes

- 迁移期间若发现新 scope 1.1.0 与当前适配层差异过大，应在任务内补充「降级/分阶段」子任务，而不是临时 hack。
- 真实 provider 流验证必须在本地有可用 API key（`apiKeyEnv` 或 keyRef），禁止把测试 key 写入仓库。
