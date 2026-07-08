## ADDED Requirements

### Requirement: Monochrome Stable Selection

主快捷面板 MUST 使用黑白灰作为默认主题，并且 active、hover、selected 状态 MUST 使用黑色直角虚线边框表达，不得使用彩色 target cursor、倾斜角标、pulse 动画或厚重背景。

#### Scenario: Active item is visible

- **WHEN** 用户通过鼠标或键盘移动 active item
- **THEN** 目标行显示黑色虚线边框
- **AND** 该边框与行内容对齐
- **AND** 不出现蓝色、青色或橙色选中装饰

### Requirement: Multi-select Top Command Bar

多选模式 MUST 在顶部显示固定操作台，并提供返回、路径、选中数量、全选、聚合详情、复制、删除和关闭入口。

#### Scenario: User starts multi-select from row index

- **WHEN** 用户点击行数字块进入多选
- **THEN** 顶部操作台显示 `列表 / 多选`
- **AND** 显示当前选中数量
- **AND** 底部 dock 仍只显示导航和状态

### Requirement: Dev Verification Must Avoid Stale Bundle

开发验证 MUST 避免误用旧生产 bundle。

#### Scenario: Before visual verification

- **WHEN** 开始真实应用视觉验证
- **THEN** 进程列表不得存在 `target/debug/bundle/macos/ClipForge.app/Contents/MacOS/clipforge`
- **AND** 只允许当前 `pnpm tauri dev` 相关进程参与验证

