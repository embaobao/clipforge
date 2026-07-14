# 设计：设置页信息架构与组件映射

## 1. 设计读取

设置页是桌面剪贴板工具的偏好设置，不是营销页，也不是 AI 工作台。目标视觉语言为克制的工具型产品：轻侧边栏、清晰分组、稳定控件、低噪音动效、可扫描的信息密度。

建议设计参数：

- 视觉变化：4。保持成熟工具感，不做夸张布局。
- 动效强度：3。只用于 Sidebar 当前态、Tabs 切换、Tooltip 出入和控件反馈。
- 信息密度：7。保留设置页效率，但通过分组和控件映射降低混乱。

## 2. 页面骨架

```text
SettingsWindow
  Header
    Title
    ConfigSyncStatus
  SidebarLayout
    Sidebar
      快捷键与语言
      显示与面板
      采集与内容
      存储与日志
      MCP 与 Agent
      更新与诊断
      Tag 规则
    Content
      SectionHeader
      AnimateTabs
      SectionPanel
      StickyStatusBar
```

主导航从当前 `.settings-window-sidebar button` 迁移到 Animate UI Radix Sidebar：

- Sidebar 宽度建议 168-188px，保持轻量，不做大色块。
- 每个导航项保留图标和文本，当前项使用左侧细条或低饱和背景，不使用粗重按钮态。
- Sidebar 自身只负责一级分类，不承载动作按钮。
- 侧边栏可折叠作为后续能力，本阶段不强制。

## 3. 分类重组

当前 `SECTIONS` 可重组为：

| 新分类 | 来源 | 内部 Tabs |
| --- | --- | --- |
| 快捷键与语言 | `shortcut` | `快捷键`、`语言`、`权限` |
| 显示与面板 | `display`、部分 `integration` | `密度`、`尺寸`、`定位`、`测试` |
| 采集与内容 | `content`、`capture` | `搜索`、`预览`、`采集类型`、`大小限制` |
| 存储与日志 | `storage` | `数据`、`清理`、`日志`、`诊断` |
| MCP 与 Agent | `integration`、`manual` | `状态`、`安装提示`、`JSON-RPC`、`Provider` |
| 更新与分发 | `update` | `版本`、`更新流程`、`构建信息` |
| Tag 规则 | `tags` | `生成模式`、`规则列表` |

## 4. 表单控件映射

所有配置项按数据类型映射，不再只用 `setting-row`。

| 数据类型 | 示例字段 | 推荐控件 |
| --- | --- | --- |
| 单选枚举 | `language`、`panelDensity`、`contentDisplayMode`、`tagMode`、`positionStrategy` | Animate UI Radix Toggle Group，必要时使用 Tabs |
| 布尔开关 | `cleanupEnabled`、`enableMarkdownPreview`、`fuzzySearchEnabled`、采集类型开关 | Switch；互斥布尔可转 Toggle Group |
| 数值范围 | `panelWidth`、`panelHeight`、`quickItemLimit`、`panelBackgroundOpacity` | Slider + Number Input，显示单位、最小值、最大值 |
| 大范围数值 | `maxStoredItems`、`logMaxLines` | Number Input + 辅助文案，不用窄输入框孤立展示 |
| 路径 | `configPath`、`databasePath`、日志路径 | Readonly Field + Copy Button + Tooltip |
| 状态 | `accessibility`、`mcp`、`panel`、`update` | Status Panel，含刷新动作和错误恢复 |
| 代码与命令 | MCP 命令、JSON-RPC 示例、Agent provider 模板 | Animate UI Code Tabs |
| 动作 | 清理日志、导出诊断包、检查更新、复制模板 | Action Row，按主要、辅助、诊断、危险分层 |

## 5. Toggle Group 策略

Animate UI Radix Toggle Group 用于短枚举：

- `language`: 跟随系统 / 中文 / English。
- `panelDensity`: 紧凑 / 标准 / 舒适。
- `contentDisplayMode`: 摘要 / 中段 / 原文。
- `tagMode`: 仅类型 / 类型加规则 / 关闭。
- `capture types`: 可保留 Switch，也可在采集类型 Tab 中使用多选 Toggle Group 展示文本、HTML、RTF、图片、文件。

Toggle Group 必须具备：

- `aria-label` 或可见 label。
- 选中态不只依赖颜色，还要有边框、背景或图标变化。
- 键盘方向键可切换。
- 44px 以上点击高度或等效点击区域。

## 6. Tabs 策略

Animate UI Tabs 用作分类内部的二级导航：

- 每个一级分类默认最多 4 个 Tab。
- Tab 只承载同一分类内的子项，不跨功能跳转。
- 切换动效只表达状态变化，不移动整个窗口布局。
- Tab 面板内部保持稳定宽度，避免切换时内容横跳。
- Reduced Motion 下关闭位移动效，仅保留即时切换或淡入。

## 7. Code Tabs 策略

`manual` 和 `integration` 区域改成 Code Tabs：

```text
MCP 与 Agent
  CodeTabs
    Agent 安装提示
    MCP 命令
    JSON-RPC 调用
    Provider JSON
```

规则：

- 每个 tab 有明确语言标记：`text`、`bash`、`json`。
- 复制按钮贴近代码块，不混入普通配置按钮。
- 长代码内部滚动，外层页面不因代码长度撑开。
- 代码文案继续使用当前 `copyMcpCommand`、`copyAgentProviderTemplate` 的语义，但模板展示改为可读片段。

## 8. Tooltip 策略

当前已有 Animate UI Tooltip primitive，可作为全局 TooltipProvider 的基础。

迁移原则：

- 保留现有 tooltip 内容、延迟、触发策略和位置语义。
- 所有 icon-only 操作必须有 Tooltip。
- 路径截断、危险动作、诊断导出、MCP 命令复制处补 Tooltip，但不增加额外解释文本堆在页面上。
- Tooltip 不替代可见 label；关键设置仍必须有可见文字。

## 9. 动作语义

将动作分为四类：

| 动作类别 | 示例 | 视觉策略 |
| --- | --- | --- |
| 主要动作 | 检查更新、安装更新、请求辅助功能权限 | Primary 或强调 secondary |
| 辅助动作 | 刷新状态、复制安装提示、复制 JSON 模板 | Secondary |
| 诊断动作 | 导出排查包、刷新日志状态 | Quiet secondary，放在诊断 Tab |
| 危险动作 | 重置辅助功能授权、清理日志 | Destructive 或确认态，和普通按钮分开 |

命名要求：

- `导出排查包` 保留为诊断语义，不使用打印、打印报告等表述。
- `复制给 Agent 的安装提示` 可缩短为 `复制安装提示`，Tooltip 说明目标。
- `复制 JSON 模板` 可放入 Provider Code Tab 的复制按钮。
- `立即清理` 标记为日志维护动作，必要时增加确认。

## 10. 组件边界

建议拆分：

```text
src/settings/
  SettingsApp.tsx
  settings-model.ts
  settings-sections.ts
  components/
    SettingsSidebar.tsx
    SettingsTabs.tsx
    SettingField.tsx
    SettingToggleGroup.tsx
    SettingSwitch.tsx
    SettingNumberField.tsx
    SettingSliderField.tsx
    SettingReadonlyField.tsx
    SettingsCodeTabs.tsx
    SettingsStatusPanel.tsx
```

第一阶段可在 `src/settings.tsx` 内局部抽组件，避免一次性迁移过大。完成后再把组件拆目录。

## 11. 服务依赖边界

设置页 UI 后续应消费 `settings-service-unified-protocol` 提案提供的统一设置服务，但本提案不定义服务协议。

第一阶段为了降低风险：

- 不迁移主面板设置读写，避免影响当前快速面板能力。
- 设置窗口可以先接入统一服务，作为新协议的试点入口。
- MCP / Agent 相关配置区域只展示服务返回的 schema、provider 状态和模型测试结果，不直接维护另一套 provider 解析逻辑。
- 统一服务未完成前，设置页重构不得扩大配置字段语义。

## 12. 兼容与验证

- 不能改变 `AppSettings` 字段名和 `update_clipforge_settings` 调用语义。
- 保持 `settings.html` 独立入口。
- 所有新增文案接入 `src/i18n`。
- 视觉验证至少覆盖 900x640、1200x760、窄窗口 720x640。
- 必须验证键盘 Tab 顺序、Sidebar 当前态、Tabs 方向键、Tooltip Escape 关闭、Code Tabs 复制成功反馈。
- 若设置页接入统一服务，只验证设置窗口内部读写和事件刷新；主面板同步迁移留给服务协议提案的后续阶段。
