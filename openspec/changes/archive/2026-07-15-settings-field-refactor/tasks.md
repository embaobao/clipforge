# 任务：设置字段注册表方案收敛

## Phase 1：重叠范围审计

- [x] 对比 `settings-field-refactor` 与 `settings-interface-redesign` 的目标、非目标和任务
- [x] 标记重复内容：Sidebar、Tabs、Toggle Group、Code Tabs、Tooltip、动作分层
- [x] 标记新增内容：field catalog、registry、schema-driven renderer、Dev 模式
- [x] 明确本 change 不单独实施设置页视觉重构

## Phase 2：字段注册表决策

- [x] 评估是否需要 `SettingFieldConfig` catalog
- [x] 确认 schema 校验仍归 `settings-service-unified-protocol`
- [x] 确认 React registry 不重复定义写入策略
- [x] 确认不引入重型 json-render runtime
- [x] 输出采用 / 不采用的决策记录

## Phase 3：合并或作废

- [x] 若采用，将最小 catalog 决策合并到 `settings-interface-redesign/design.md`
- [x] 若采用，将相关任务合并到 `settings-interface-redesign/tasks.md`
- [x] 若不采用，在 `proposal.md` 标记为 superseded
- [x] 更新 `docs/PROPOSAL_ROADMAP.md`，移除独立实现队列

## Phase 4：验证

- [x] `openspec validate settings-field-refactor --strict` 通过
- [x] 验证 `openspec list` 不再显示本 change 为无任务草案
