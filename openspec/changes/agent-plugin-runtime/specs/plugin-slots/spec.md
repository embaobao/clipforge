# plugin-slots 规格增量

## ADDED Requirements

### Requirement: 插槽注册契约

插件 SHALL 经 `ctx.register.tool/ui/template` 声明插槽项(工具=MCP 工具、UI=悬浮窗按钮与 Agent 面板 tab、模板=提示词模板),经 `ctx.on` 订阅 manifest `capabilities.events` 声明的域事件——事件订阅不是插槽项,不占 slots 索引。UI 插槽项 SHALL 携带渲染声明(标题/图标/排序)与行为声明(`action`:自有工具名或 url),点击由宿主代调;插件 SHALL NOT 直接操作 DOM 或携带任意 JS 点击回调。

#### Scenario: 插件贡献悬浮窗按钮

- **WHEN** 插件注册 UI 插槽项 surface=quick-panel-button,action 指向自有工具
- **THEN** 悬浮窗底部出现该按钮,点击由宿主代调该工具,宿主面板交互不阻塞

### Requirement: 事件订阅有界不反压

插件事件订阅 SHALL 以 manifest `capabilities.events` 为限;事件名对齐 agent-extension-seams 已发布事件清单,载荷信封以本提案 design §6 为准(seams 事件面落地后对齐,差异走 api 版本);分发 SHALL 异步且有界队列,慢插件消费 SHALL NOT 反压剪贴板采集与面板热路径。

#### Scenario: 慢插件不拖慢热路径

- **WHEN** 某插件事件回调耗时超过预算(默认 100ms)
- **THEN** 该插件队列积压按策略丢弃/降级,剪贴板采集与面板唤起耗时无可测退化

### Requirement: 插槽可审计、按插件停用

全部生效插槽项 SHALL 可在设置页「插件」分区查看来源(插件包名/注册类型);停用粒度为插件整体(registry enabled 位),停用后宿主 SHALL 摘除该插件全部注册项并 dispose 其 Fiber。

#### Scenario: 用户审计与停用

- **WHEN** 用户在设置页停用某插件
- **THEN** 该插件全部插槽项与工具命名空间立即摘除,宿主应用不重启,其他插件不受影响
