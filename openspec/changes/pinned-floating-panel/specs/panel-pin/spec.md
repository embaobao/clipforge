# Delta:固定悬浮面板（panel-pin）

## ADDED Requirements

### Requirement: 固定态只抑制自动隐藏

面板固定（pinned）时，SHALL 抑制由焦点变化引发的自动隐藏路径（窗口失焦、点击面板外、幻影 blur 自愈），并保持面板在当前位置可见；SHALL NOT 因固定态改变面板位置、层级或窗口属性。

#### Scenario: 固定态下切到其他应用

- **WHEN** 面板处于固定态且用户切到其他应用或点击面板外部
- **THEN** 面板保持可见、不进入原生淡出流程，位置不发生变化

#### Scenario: 非固定态失焦仍自动隐藏

- **WHEN** 面板未固定且窗口失焦
- **THEN** 沿用既有 60ms 延迟 → 权威状态查询 → 原生 alpha 淡出的隐藏链路，行为不回退

### Requirement: 显式收起在固定态一律生效

全局快捷键 toggle、Esc、显式 `hide_quick_panel_command`、托盘或菜单收起均属显式收起；固定态 SHALL NOT 拦截任何显式收起路径，且各类显式收起的可见性判断 SHALL 使用同一口径。

#### Scenario: 固定态按 Esc

- **WHEN** 面板处于固定态且用户按 Esc
- **THEN** 面板立即收起，行为与全局快捷键 toggle 一致，且位置按既有 `save_panel_position` 记忆

#### Scenario: 固定态按全局快捷键

- **WHEN** 面板处于固定态且用户按下全局唤起快捷键
- **THEN** toggle 判定为当前可见并收起面板，不因 `panelPinned` 为真而误判或空转

#### Scenario: 淡出在途的可见性判定

- **WHEN** 原生淡出尚在进行（约 110ms 窗口）且用户触发 toggle
- **THEN** 命令侧与原生侧可见性判定口径一致（均考虑 `is_panel_fading`），不出现「显示着却判为已隐藏」的误判

### Requirement: 固定状态单一权威源

Rust 的 `PANEL_PINNED` SHALL 作为固定状态的唯一权威源；所有隐藏决策、可见性判断与自动化探针 SHALL 读取该权威源，前端 settings 快照 SHALL NOT 参与隐藏或收起决策，只用于菜单勾选态与设置页展示。

#### Scenario: 前端与 Rust 状态漂移

- **WHEN** 前端 settings 快照尚未同步而用户已切换固定状态
- **THEN** 失焦隐藏、Esc、toggle 均以 Rust 权威源为准，不出现「按钮显示已固定但仍被隐藏」或「Esc 收不起」的分裂行为

#### Scenario: 权威查询失败

- **WHEN** 失焦链路查询权威状态失败或超时
- **THEN** 按既有降级策略（视为未固定）继续隐藏流程，不新增重试或轮询，也不把前端快照当作替代真相

### Requirement: 固定状态切换可靠持久化

固定状态切换 SHALL 采用「Rust 确认 → 前端提交」的事务顺序，经既有 Settings Service 写入并返回 revision；写盘失败时 SHALL NOT 更新内存状态或前端显示，且 SHALL 给出可理解的错误反馈。应用重启后 SHALL 从设置文件恢复固定状态。

#### Scenario: 写盘失败

- **WHEN** 用户切换固定状态但设置写入失败
- **THEN** `PANEL_PINNED` 保持原值、前端勾选态保持原值、显示错误提示，不产生「半切换」脏状态

#### Scenario: 重启恢复

- **WHEN** 用户在固定态下退出并重新启动应用
- **THEN** `panelPinned` 从设置文件恢复，Rust 权威源、菜单勾选态与设置页显示三者一致

#### Scenario: 跨窗口同步

- **WHEN** 固定状态在任一窗口被切换
- **THEN** 经 `settings_changed` 事件同步到其他窗口展示态，且不产生写回回环或重复写盘

### Requirement: 固定态不改变显隐性能基线

固定态的判定与切换 SHALL NOT 在面板 show/hide 热路径新增同步等待、轮询或额外 IPC；`pnpm test:perf-panel` 的 show/hide 端到端 ≤180ms 与四项探针（幻影 blur 自愈、动画可打断、透明鬼影）SHALL NOT 回退。

#### Scenario: 固定态性能回归

- **WHEN** 在固定态下复跑 `pnpm test:perf-panel`
- **THEN** show/hide 端到端仍 ≤180ms，既有四项探针结论不变，固定态专用场景（失焦不隐藏、显式收起）可独立断言

#### Scenario: 探针状态隔离

- **WHEN** 固定态专用探针场景执行完毕
- **THEN** `panelPinned` 还原为进入前的值，沙箱 settings 不被污染

### Requirement: 固定态入口文案与状态可理解

固定面板的菜单文案 SHALL 准确描述「固定 / 取消固定面板」，SHALL NOT 与条目置顶（`clips.pinned`）混淆；文案 SHALL 走 i18n，中英文案 SHALL 对齐，固定态 SHALL 有可辨识的状态反馈。

#### Scenario: 菜单文案

- **WHEN** 用户打开快捷菜单查看固定入口
- **THEN** 文案为「固定面板」或「取消固定面板」，不使用「固定到顶部」，且切换语言后文案同步变化

#### Scenario: 条目置顶不误接

- **WHEN** 用户触发剪贴板行上的「置顶」占位入口
- **THEN** 提示明确指向条目置顶功能（尚未实现），不触发、不修改窗口固定状态
