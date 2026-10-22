---
id: TASK-6
title: 多项拼接格式可定制+MCP merge能力面
status: In Progress
assignee: []
created_date: '2026-10-21 22:00'
updated_date: '2026-10-22 02:54'
labels:
  - feature
dependencies:
  - TASK-4
priority: high
ordinal: 6000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Scope / Changes

多条剪贴板内容拼接：前端链路已 90%（多选/⌘C 聚合复制/`copySelectedClips` join/聚合工作区），
缺格式定制与对外能力面（调研详见 `.work/supervisor/research-merge-join.md`）。

- A（纯前端）：抽 `formatAggregate` helper 消两处硬编码 join（`use-clip-writeback.ts` 与
  `MultiAggregateWorkspace`）；`MultiSelectBottomBar`/聚合工作区加格式弹出菜单：
  分隔符、编号开关、条目顺序显式化（默认按选中顺序，可选时间序）；顺带激活
  「模板/结构化」两个 disabled 占位之一（模板 = 前缀/分隔符/编号的可存组合）。
- B（Rust + MCP）：新增 `clipboard.merge` MCP 工具——入参 ids[]+format 选项，出参拼接文本
  （不入库不写回，纯产出）。**必须同 PR 三处同步**：`mcp/specs.rs` 表登记 +
  `mcp/mod.rs` golden 计数字面量 + `scripts/verify-mcp-dispatch.mjs`，漏一处 `test:unit` 红。
- 范围红线：富格式（RTF/HTML）合并不做（依赖多格式保真线，另立提案）；
  文件/图片条目拼接明确降级为路径字符串并在 UI 说明。

## Risks

- B 动 specs.rs，与 TASK-3 Phase 2（同文件登记）存在排队冲突：TASK-6 先行则 TASK-3
  开工时 golden 计数已含 merge，派发 TASK-3 需按最新计数写任务书。
- Set 插入序 = 点击序的隐含约定被显式化后，注意老用户习惯（默认保持点击序不变）。

## Dependencies

- 前置：无硬依赖，但与 TASK-5 排队（都动 src/）；A 可与 TASK-5 同批派给 omp。
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 多选 ≥2 条 → 格式菜单改分隔符/编号 → 复制结果与预览一致。
- [ ] #2 `clipboard.merge` MCP 冒烟：真实调用返回拼接文本，golden/verify 脚本全绿。
- [ ] #3 `pnpm build:web` + `cargo check` + `pnpm test:unit` 绿。
- [x] #4 拼接顺序在 UI 与 helper 中显式一致（点击序/时间序二选一可见）。
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
TASK-6-A 监工验收通过(commit aaee18f): pnpm build:web 绿、pnpm test:unit 全绿(监工复跑)、formatAggregate 8例冒烟PASS、复制/预览同源。AC1 复制==预览未做真实UI端到端(待解锁手测); TASK-6-B(clipboard.merge MCP)与本任务书AC2/3相关, 已派单进行中。
<!-- SECTION:NOTES:END -->

## Notes

- 本任务由盟哥 10-21 指名「多项拼接到底最快的方式」调研转化而来。
