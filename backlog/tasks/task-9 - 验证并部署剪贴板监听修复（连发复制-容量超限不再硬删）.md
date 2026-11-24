---
id: TASK-9
title: 验证并部署剪贴板监听修复（连发复制 + 容量超限不再硬删）
status: To Do
assignee: []
created_date: '2026-11-24 10:24'
labels: []
dependencies: []
references:
  - openspec/changes/clipboard-listener-reliability/tasks.md
priority: high
type: bug
ordinal: 9000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
2026-11-24 用户反馈「监听剪切板总是丢数据」。排查结论：采集本身没漏，已发生的丢失来自历史数量上限（500）把最旧的非收藏条目直接物理删除；另有实测存在的阻塞缺陷——采集在轮询回调里同步执行（331–807ms），期间连发复制的中间内容读不到。修复已提交 86483ba（超限改移入回收站；采集移到独立工作线程），但只在隔离数据目录做过启动探针，没有在真实应用上验证，也没有部署。正在运行的 /Applications/ClipForge.app 仍是旧二进制，下次启动仍会硬删超限历史。
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 实机连发复制 5 条不同内容（间隔约 120ms）后 5 条全部出现在历史列表（需用户同意写系统剪贴板）
- [ ] #2 历史数量超过上限时，最旧的非收藏、未置顶条目出现在回收站而不是被物理删除；收藏与置顶不被移入
- [ ] #3 pnpm tauri build 通过并部署到 /Applications/ClipForge.app，旧实例全部退出后新实例在跑（需用户同意覆盖正式版）
- [ ] #4 openspec/changes/clipboard-listener-reliability/tasks.md 第 7 节按实际结果登记
<!-- AC:END -->
