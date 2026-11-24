---
id: TASK-10
title: 检索与标签质量修复：中文部分词、关键词联想、标签垃圾治理
status: In Progress
assignee: []
created_date: '2026-11-24 10:25'
updated_date: '2026-11-24 14:28'
labels: []
dependencies: []
references:
  - openspec/changes/clipboard-search-and-tag-quality/proposal.md
priority: medium
type: enhancement
ordinal: 10000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
2026-11-24 用户反馈「检索很鸡肋 不会自动提示」「标签全是垃圾」。实测：汉字两字部分词在真实库上 0/183 命中（全文索引把整段汉字当成一个词）；输入普通文本没有任何提示；标签列 181 条里有 14 条是 #编号/色值/会议号之类的垃圾，157 条是自动打的「链接」「Markdown」类型标签。提案已提交 a3dcae4，等用户审阅通过后再实施，提案里的默认值变更（类型标签默认关闭）需要用户确认。
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 英文输入 4 字母前缀能匹配以它开头的单词
- [ ] #2 输入普通文本时下拉出现关键词联想（最多 6 条，含拼音），↑/↓/Enter 可选；@ 与 # 命令行为不变
- [x] #3 #数字、色值片段、会议号不再作为自动标签入库；链接与 Markdown 类型标签默认不再写入标签列
- [x] #4 存量垃圾标签一次性清理，被移除的标签记录在 metadata.tags_retired 可恢复；手打标签不受影响
- [x] #5 pnpm test:unit、pnpm build:web、cargo check、openspec validate --all --strict 通过
- [ ] #6 中文两字部分词（如「平台」在「插件化平台启动接线」中）能在主列表搜到；中文标签（如「聚合」）也能被全文搜索命中
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-11-24：第 2–4 节代码已完成并提交（1de51e9、5ea9075、b9f23ca），门禁全过；正式版尚未更新，等盟哥定部署时机；面板走查因屏幕锁定未做。

2026-11-24 22:23：按盟哥「直接部署」已部署正式版（d00d3d4）。启动日志 schema upgraded 2 -> 3，退役标签 158 行 173 条，reindexed=669；正式库 fts rows=669。用正式版二进制在隔离数据目录验证：连发 5/5 入库、含链接的行 tags=[周报]。#1 #2 #6（主列表界面表现）等面板走查后勾选。
<!-- SECTION:NOTES:END -->
