---
id: TASK-7
title: 面板 hide 延迟 190ms 超阈值(180ms) + 幻影 blur 自愈探针失败
status: To Do
assignee: []
created_date: '2026-10-27 14:05'
updated_date: '2026-10-27 14:07'
labels:
  - bug
  - performance
dependencies: []
ordinal: 7000
---

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-10-27 实测(pnpm test:perf-panel, 稳定版 /Applications 构建): show 平均 3-8ms(阈 180 达标), hide 平均 190-196ms/最差 311-361ms 超阈; 幻影 blur 自愈失败; 重启稳定版+清场(停沙箱/vite/llama-server)后仍复现。同日改动未触碰面板路径(write.rs filesAsPaths、spike 测试、docs), 判定既有问题。T16/T17 hover 抖动为 headless 环境性, 复跑全绿, 另案。下一步: hide 路径耗时分解(动画 settle vs 事件), 幻影 blur 探针依赖的抢 key 流程核对。

更正(2026-10-27 深夜): 复查截图发现会话期间机器已锁屏——AGENTS.md 已明示探针在锁屏/息屏下必然超时。hide 190ms/blur 失败/show 打断后保持失败均为锁屏污染读数,不构成产品回归证据(此前解锁时段 round1 show=34ms 正常)。任务改为:解锁后重跑 pnpm test:perf-panel 取有效基线;若解锁后仍超阈再查 hide 路径。今日改动未触碰面板路径。
<!-- SECTION:NOTES:END -->
