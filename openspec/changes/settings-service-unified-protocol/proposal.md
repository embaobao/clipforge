# 提案：统一 Settings Service、MCP 设置协议与 Agent 配置入口

## 优先级

P0.65。该提案应先于或并行于 `settings-interface-redesign` 推进，但首批实现只接入设置窗口和 MCP，不迁移主面板，避免影响现有快速剪贴板能力。

## 背景

当前设置能力分散在多个入口：

- 设置窗口直接调用 `get_clipforge_settings` / `update_clipforge_settings`。
- 主面板使用 `read_user_settings` 初始化，并 debounce 调用 `write_user_settings` 写回整份设置。
- Agent 面板直接调用 `agent_get_config` / `agent_detect` / `agent_check_provider`。
- MCP 目前主要暴露剪贴板工具，不能读取设置 schema，也不能安全初始化 Agent provider。

这会导致四类风险：

- 一致性风险：同一个字段在设置页、主面板、Agent 面板和 MCP 之间可能有不同默认值、校验和错误提示。
- 实时性风险：MCP 或设置窗口更新后，其他前端 surface 需要轮询或重启才能看到新值。
- 安全风险：Agent provider 的 key、baseUrl、model 等配置如果散落实现，容易出现明文回传或覆盖整份配置。
- 扩展风险：后续 Agent 插件集成需要稳定读取设置、schema、provider 状态和模型能力。如果没有统一服务，会变成多个临时 command。

## 目标

1. 建立单一 Settings Service，作为设置读取、校验、写入、重置、事件通知和 Agent provider 配置的唯一业务入口。
2. 前端设置页、Tauri command 和 MCP 工具使用同一设置协议和同一个 Rust Settings Service，不再各自定义配置语义。
3. MCP 支持读取全量设置、读取每项 JSON Schema、执行部分更新、显式全量替换、显式 reset，并默认推荐部分更新。
4. Agent 配置纳入统一服务：
   - OpenAI-compatible: `baseUrl`、`apiKeyEnv` 或 `apiKey`、`modelId`、`timeoutSeconds`。
   - Local CLI: `command`、`args`。
   - 默认 provider: `agent.defaultProviderId`。
   - 测试连接和模型列表拉取通过同一服务能力暴露。
5. 保证协议层具备实时性、性能稳定和原子性：
   - 写入成功后发布统一 `settings_changed` 事件。
   - 写入前 schema 校验，写入过程原子落盘。
   - patch 默认只更新局部字段，replace/reset 需要显式确认。
   - 所有本地设置操作和可见 UI 操作必须在 300ms 内给出确定反馈，不能让用户感知到无响应。
6. 首批实现不迁移主面板读写，只让设置窗口、Agent 配置面和 MCP 试点统一服务。
7. 明确“统一服务”只覆盖设置/Agent 配置控制面，不进入快速面板快捷键触发、剪贴板监听、列表滚动、复制回写等热路径。

## 非目标

- 不重构主面板设置生命周期；主面板迁移列为后续阶段。
- 不让主面板每次打开、每次滚动、每次选中或每次复制都同步调用 Settings Service。
- 不把 MCP stdio 工具调用放到前端设置页或主面板的交互链路中；MCP 只是 Settings Service 的外部适配器。
- 不把 ClipForge 做成 Agent 管理平台；只提供默认 Agent provider 和插件集成所需的基础配置能力。
- 不改变剪贴板 MCP 工具语义，不扩大剪贴板读写权限。
- 不把 MCP 作为唯一入口；Tauri command 和前端服务仍是桌面 UI 的主通道。

## 用户价值

- 用户可在设置页完成 Agent provider 配置，不再手动复制 JSON 模板。
- Agent 可通过 MCP 获取 schema 并写入最小 patch，快速完成初始化。
- 配置错误能在服务层统一返回，而不是每个 UI/Agent 入口各自猜测。
- 后续插件能力可依赖标准设置协议，减少重复接入成本。

## 方案必要性

必要。原因不是“为了架构漂亮”，而是已经出现多入口配置：

- 设置窗口、主面板、Agent 面板、MCP 都需要读设置。
- Agent 初始化需要写设置。
- Provider key/model/baseUrl 具有安全和校验要求。
- 后续插件集成会继续扩大配置面。

如果继续保留多入口直写，短期实现会快，但中期会造成字段漂移、实时性不可控和安全边界不清。统一服务是后续 Agent/MCP 能力继续扩展前必须补上的底座。

## 前端和 MCP 是否统一

应该统一，但统一的是“协议、schema、校验、redaction、写入策略和事件语义”，不是把所有前端交互都改成 MCP 调用。

推荐边界：

- 前端设置页调用 `settingsService.*`，底层是 Tauri command。
- MCP 工具调用同一组 Rust Settings Service 方法，作为外部 Agent 的适配器。
- 两者返回同一类 `SettingsDocument`、`SettingsChangedEvent`、错误码、`revision`、`changedPaths` 和 `nextActions`。
- 主面板第一阶段继续使用现有本地状态和现有 command，只接收必要的设置变更事件或等后续专门迁移。

不推荐边界：

- 前端设置页通过 MCP stdio 调自己。
- 主面板打开或列表滚动时实时 `settings.get`。
- 剪贴板监听、快捷键触发、复制回写等待 schema 校验、模型拉取或 provider health check。

## 主面板性能与触发机制保护

快速面板是 ClipForge 的主路径，设置统一服务不能破坏它的低延迟体验。第一阶段必须遵守：

- 快捷键触发、面板定位、列表虚拟滚动、选中态、复制/粘贴回写不依赖 Settings Service 同步请求。
- `settings.get` 的 schema 默认只用于设置页和 MCP；前端服务可缓存 schema，后续读取可 `includeSchema=false`。
- `settings_changed` 是异步通知，写入成功后发出；主面板第一阶段不强制订阅，不引入重渲染风暴。
- Agent provider readiness 和 model list 是按需调用，必须有 timeout/cache/refresh 控制，不能在面板打开时自动串行执行。
- MCP 写设置只能影响配置文件和事件，不直接调用主面板 UI 操作。
- 后续若迁移主面板，只允许在初始化阶段读取轻量 snapshot，并用 debounce/idle 刷新，不能进入每帧交互路径。

性能验收：

- 主面板快捷键触发到可交互目标：P95 <= 300ms，本地热缓存命中目标 <= 150ms。
- 主面板内选中、滚动、复制、粘贴回写的可见反馈：P95 <= 300ms。
- 设置页 tab/sidebar 切换、开关/输入保存反馈：P95 <= 300ms。
- 本地 `settings.get(includeSchema=false)`、`settings.patch`、`settings.reset` 的服务响应目标：P95 <= 300ms。
- 设置服务接入后，主面板快捷键打开路径不新增网络调用。
- 设置服务接入后，主面板打开不默认拉取 schema、provider health 或 models。
- 设置服务写入失败不得影响剪贴板监听、历史列表和复制回写。
- MCP settings 工具异常不得影响已有 `clipf.list`、`clipf.get`、`clipf.copy` 等剪贴板工具。
- provider health、model list、网络模型调用不纳入同步交互 300ms 链路；必须异步执行，并在 300ms 内显示“检测中/加载中/后台刷新”状态。

## 方案优劣

### 优点

- 一致性好：schema、默认值、错误码、redaction 和写入策略统一。
- 安全性更好：服务层统一控制 `apiKey` 不明文回传，推荐 `apiKeyEnv`。
- 实时性可控：统一事件通知替代轮询和重启。
- 原子性更明确：所有写入经过同一事务式落盘路径。
- 易扩展：Agent 插件、模型配置、MCP 初始化都复用同一协议。

### 缺点

- 初始实现成本更高，需要抽服务、schema、事件和 MCP 适配层。
- 如果一次性迁移主面板，风险较高，可能影响当前剪贴板主流程。
- JSON Schema 需要持续维护，否则 schema 与真实设置会漂移。
- MCP 写设置会引入权限边界，需要严格确认、日志和 redaction。

### 权衡结论

采用分阶段方案：先做 Settings Service + 设置窗口 + MCP，不迁移主面板。这样能验证协议一致性和 Agent 初始化能力，同时把对现有应用主流程的风险降到最低。

## 成功标准

- `clipf.settings.get` 返回全量设置、schema、writePolicy、redaction 和 revision。
- `clipf.settings.patch` 可只更新局部字段，校验失败返回明确路径和修复建议。
- `clipf.settings.replace` 必须 `confirmed=true`，否则拒绝。
- `clipf.settings.reset` 必须 `scope` + `confirmed=true`，否则拒绝。
- 设置窗口和 MCP 都通过同一 Settings Service 读写。
- 写入成功后发布 `settings_changed`，设置窗口可实时刷新。
- Agent provider 配置支持默认 provider、连接测试、模型拉取和 key redaction。
- 前端设置页和 MCP 不再各自维护设置 schema/错误语义，但前端不通过 MCP 调用自己。
- 主面板热路径不新增同步 settings/schema/model/provider 调用。
- 主面板与设置页关键操作有性能埋点或测试证据，证明 P95 300ms 预算未被统一服务破坏。
- 主面板不在首批迁移范围内，现有能力不受影响。
