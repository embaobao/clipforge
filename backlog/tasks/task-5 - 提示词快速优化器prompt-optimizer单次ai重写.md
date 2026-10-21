---
id: TASK-5
title: 提示词快速优化器(单次AI重写+diff确认写回)
status: Done
assignee: []
created_date: '2026-10-21 22:00'
updated_date: '2026-10-21 23:50'
labels:
  - feature
  - agent
dependencies:
  - TASK-4
priority: high
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Scope / Changes

复制提示词 → 一键 AI 优化 → 确认 → 粘贴回去。零件已全在仓里，只缺「优化引擎」本体
（调研详见 `.work/supervisor/research-prompt-opt.md`）：

- 新增 `src/lib/prompt-optimizer.ts`：内置优化元提示（结构化的 5-slot brief：角色/任务/约束/输出格式/示例），
  经既有 `piComplete` 单次调用产出改写结果。不引入 eval 循环（darwin 式需评测集，与秒级交互矛盾，留二期）。
- 入口：Agent 面板/详情页提示词类条目操作加「优化」项；产出走既有
  `buildLocalEditorSuggestion` 建议信封 → contentPatch diff → 确认 → `updateClipContent` 写回。
- 无 provider 时降级：按钮禁用并提示去设置页配 provider（复用 AI 分析条的既有门控），不做规则引擎混合层。
- 范围红线：不碰 specs.rs / mcp 面（MCP 工具臂与 Phase 4 模板注册表后置另立任务）；不碰 src-tauri。

## Risks

- 依赖 TASK-4 迁移后的 pi 层接口稳定（`piComplete` 签名如变动先对齐）。
- 单次重写质量依赖元提示措辞，首版内置一套，留出迭代空间即可，不追求评测最优。

## Dependencies

- 前置：TASK-4（pi sdk 迁移）。
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `src/lib/prompt-optimizer.ts` 落地，元提示内置可配置（常量即可，不做持久化）。
- [ ] #2 对一个真实提示词条目走通：优化 → diff 展示 → 确认写回 → `pasteClip` 可用。
- [x] #3 `pnpm build:web` 绿；`cargo check` 不受影响。
- [ ] #4 无 provider 配置时降级路径有测试或冒烟记录。
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
验收(监工复跑, 非采信 omp 自述): build:web 4.35s 绿; test:unit 全绿(file-size/check-index/MCP 40 dispatch/editor-suggestion); src-tauri 零 diff; cargo check 不涉及. AC#2/AC#4 留开: 需真实 provider+解锁屏 UI 冒烟(复制提示词→插件区优化→diff→⌘S→确认内容已更新); 生产 settings.json5 无 agentProviders, 冒烟须用 pnpm dev:sandbox 配 provider 后补. 路径偏差已核准: prompt-optimizer.ts 落 src/agent/pi/ 而非 src/lib/, 派单任务书明确允许就近 pi 层优先. 裁决1: buildPromptOptimizerSuggestion 无调用方——保留(建议信封契约形状, 后续 MCP/editor 建议面接入), 不判死代码. 裁决2: markdown 围栏剥离——记 follow-up, 不阻塞.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
交付 6bae20a feat(prompt): 提示词快速优化器(单次 piComplete+diff 确认写回, 无新增写通道); 监工复跑门禁全绿; AC1/3 勾选, AC2/4 留待真机冒烟
<!-- SECTION:FINAL_SUMMARY:END -->

## Notes

- 元提示初版随实现一起进代码注释或独立常量文件，方便后续手动调。
