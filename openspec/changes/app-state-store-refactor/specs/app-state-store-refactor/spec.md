# Delta

## ADDED Requirements

### Requirement: Store 化必须先获得明确授权

App 面板状态 store 化 SHALL 保持为 dormant，直到用户在审核中明确选择授权实施；未授权时 MUST NOT 修改 `src/App.tsx`、新增状态 store 文件、新增任务或勾选 TASK-11 验收项 6。方案细化、静态校验和送审不构成实施授权。

#### Scenario: 未授权时保持冻结

- **WHEN** `app-state-store-refactor` 提案已提交审核但用户未选择授权实施
- **THEN** 代码仓库不包含该提案的实施变更
- **AND** TASK-11 验收项 6 保持未勾选

#### Scenario: 授权窄范围后进入实施

- **WHEN** 用户明确选择授权窄范围实施
- **THEN** 才能为该变更添加任务与实施代码
- **AND** 本提案实施顺序在其他功能提案之后；未获授权前只保留方案文档。

### Requirement: Store 不得承载业务数据

若未来获授权实施，新增的面板会话 store MUST NOT 持有剪贴板条目、设置、搜索请求、分页游标或导出路径状态；这些状态 SHALL 继续由 Tauri command 与现有 hooks 管理。

#### Scenario: 业务数据边界

- **WHEN** 实施面板会话 store
- **THEN** store 文件和类型中不出现 `ClipItem`、`AppSettings`、`SearchClipsRequest` 等业务类型
- **AND** `clips`、`settings`、`searchRequest`、`nextCursor`、`filePathStatuses` 保持在现有位置
- **AND** `nativeStatus` 保持本地 React state，不纳入 store 接口与实现。
