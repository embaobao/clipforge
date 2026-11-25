---
id: TASK-11
title: 还债拆分：App.tsx / settings.tsx / lib.rs 按 TDD 切片清零
status: In Progress
assignee:
  - '@omp'
created_date: '2026-11-25 03:10'
updated_date: '2026-11-25 07:07'
labels: []
dependencies: []
documentation:
  - openspec/changes/codebase-modularity-refactor/execution-plan.md
modified_files:
  - src/App.tsx
  - src/settings.tsx
  - src-tauri/src/lib.rs
priority: medium
type: chore
ordinal: 11000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
500 行门禁仍豁免三个存量巨石文件（2026-11-25 实测 lib.rs 9787 / App.tsx 1643 / settings.tsx 830）。新增代码已被门禁拦住，但存量债持续拖慢定位与改动。按 codebase-modularity-refactor 的执行计划逐片拆分：每片先写失败断言（Rust #[cfg(test)] 或 test:unit 结构门禁），再平移代码，全门禁绿才勾账。执行计划见 openspec/changes/codebase-modularity-refactor/execution-plan.md。
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 settings.tsx ≤500 行，动作函数迁入 src/settings/；pnpm build:web 与 pnpm test:unit 全绿
- [x] #2 lib.rs 窗口/面板与日志/托盘 command 迁入域模块，命令名与 41 条 MCP 工具冻结；cargo check、cargo test --lib、verify-mcp-dispatch 全绿
- [ ] #3 App.tsx 写回域与搜索/UI JSX 按切片迁出，verify-runtime-boundaries 不退化；解锁空闲后面板走查通过
- [x] #4 每个切片先留失败断言输出再平移代码，openspec tasks.md 记录红/绿两次实测输出
- [ ] #5 达标文件从 scripts/file-size-exemptions.json 移除；三文件全达标后 file-size 门禁切全文件 fail 模式
- [ ] #6 App.tsx 状态 store 化须经盟哥明确授权；未授权则保持未勾选并说明只能拆到约 800 行
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-11-25 15:10：S1–S5 已交付并提交（8b8a8e5、46b62ff），settings.tsx 830→542、lib.rs 9787→8350、App.tsx 1643→785；全量门禁绿（test:unit 18 步、Rust 86 tests、openspec 43、索引 108 路径）。#1 因用户明确把存量目标放宽到 800，542 不再要求 500；#3 缺面板走查；#5 三文件未全达标；#6 未授权 store。
<!-- SECTION:NOTES:END -->
