# Delta:设置页底部状态信息栏与死残留清理(settings-status-bar-and-dead-ai-cleanup)

> 设置页体验修复:底部常驻状态信息栏、伪 toast 转 transient、旧 AI 线死残留清理。

## ADDED Requirements

### Requirement: 设置页底部状态信息栏

设置页底部栏 SHALL 常驻展示应用身份与运行状态:版本号、发布 channel、更新状态徽标(状态+悬停详情)。徽标状态 SHALL 由 Rust 侧 update 检查结果驱动(failed→destructive 色调,checking→muted,available→foreground,默认→muted),悬停详情 SHALL 包含最近检查时间与错误码/错误信息。SettingsShell SHALL 保持无业务状态,徽标数据由 settings.tsx 计算后经 props 传入。

#### Scenario: 更新检查失败时徽标可见

- **WHEN** 更新检查失败(如远端不可达)
- **THEN** 底部栏显示 `v{version} · {channel} · {失败徽标}`,徽标为 destructive 色调,悬停显示 errorCode/errorMessage 与最近检查时间

#### Scenario: 保存提示不再常驻

- **WHEN** 用户保存设置成功
- **THEN** 状态条显示同步提示约 2.5s 后自动清除并回落当前 section 名,不再出现「配置已同步到 JSON5」永久停留在内容区左下角的现象

### Requirement: 旧 AI 线死残清除

旧 AI 侧车删除后,用户可见的死亡入口 SHALL 全部清除:快速面板右键菜单「AI 分析」项(无调用方传 prop、永久 disabled)、Onboarding「Agent」功能卡片(承诺已删除的悬浮面板能力)、以及 zh/en 对称的 i18n 死键簇。新 pi 线入口(PiAnalysisBar、设置「MCP 与 Agent」、clipf.* MCP 工具)SHALL 保留。

#### Scenario: 右键菜单无死入口

- **WHEN** 用户在快速面板任意条目上右键
- **THEN** 菜单不出现「AI 分析」项,其余项(粘贴/复制 Rich/Plain/Path/详情/收藏/删除/多选)行为不变

#### Scenario: 引导不承诺不存在的能力

- **WHEN** 新用户走 Onboarding 向导
- **THEN** 功能卡片不含「Agent」项,不出现无法兑现的「唤起 Agent 协助」文案
