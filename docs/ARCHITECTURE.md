# 架构说明

ClipForge 采用 **统一服务层 + 内置 MCP 常驻** 架构，分为四层：前端交互层、Tauri IPC 层、Service 层、数据与平台层。

当前 OpenSpec 主规范已经吸收：

- `openspec/specs/agent-runtime/spec.md`
- `openspec/specs/search-filters/spec.md`

历史完成提案统一保存在 `openspec/changes/archive/`，active change 的优先级和接手顺序见 `docs/PROPOSAL_ROADMAP.md`。

```text
┌─────────────────────────────────────────────────────────┐
│                   React UI (前端交互层)                  │
│  ┌─────────────┬─────────────┬─────────────────────┐   │
│  │ 快速面板    │ 设置窗口     │ 虚拟列表 / 搜索      │   │
│  └──────┬──────┴──────┬──────┴──────────┬──────────┘   │
└─────────┼─────────────┼─────────────────┼──────────────┘
          │             │                 │
          ▼             ▼                 ▼
┌─────────────────────────────────────────────────────────┐
│                  Tauri IPC 层                           │
│  ┌───────────────────────┬─────────────────────────┐   │
│  │  tauri::command       │  In-Process MCP Server   │   │
│  │  (前端 invoke)        │  (JSON-RPC 进程内调用)    │   │
│  └───────────┬───────────┴─────────────┬───────────┘   │
└──────────────┼─────────────────────────┼───────────────┘
               │                         │
               ▼                         ▼
┌─────────────────────────────────────────────────────────┐
│              Service Layer (统一服务层)                  │
│  ┌─────────────┬─────────────┬─────────────────────┐   │
│  │Clipboard    │   Window    │    Log / Settings   │   │
│  │Service      │   Service   │    Service          │   │
│  ├─ capture()  │ ├─ show()   │ ├─ append()         │   │
│  ├─ search()   │ ├─ hide()   │ ├─ query()          │   │
│  ├─ copy()     │ ├─ position │ └─ cleanup()        │   │
│  ├─ update()   │ └─ ...      │                     │   │
│  ├─ delete()   │             │                     │   │
│  └─ ...        │             │                     │   │
│  └─────────────┴─────────────┴─────────────────────┘   │
└─────────────────────────────────────────────────────────┘
          │             │                 │
          ▼             ▼                 ▼
┌─────────────────────────────────────────────────────────┐
│              数据与平台层                                │
│  ┌─────────────┬─────────────┬─────────────────────┐   │
│  │ SQLite      │ NSPanel     │ 系统能力             │   │
│  │ (WAL+FTS5)  │ (macOS)     │ • 剪贴板 API        │   │
│  │             │ WebviewWin  │ • 全局快捷键        │   │
│  │             │ (Windows)   │ • Accessibility     │   │
│  └─────────────┴─────────────┴─────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

## 前端

前端使用 React + TypeScript + Vite。UI 不是营销页，而是工具型应用界面，重点是：

- 快速面板默认高密度。
- 主列表使用虚拟滚动，避免历史记录变大后卡顿。
- 搜索和类型 Tag 直接作用于主列表。
- 设置窗口与快速面板分离，避免设置表单影响快捷唤起性能。

Zustand 只用于跨组件 UI 状态，例如当前预览项、关闭动画状态。业务数据仍由 Tauri command 和本地数据库驱动。

## Service Layer（统一服务层）

Service Layer 是业务逻辑的唯一实现位置，Tauri command 和 MCP handler 都调用同一套服务：

### ClipboardService

| 方法 | 功能 | 参数 | 返回 |
|------|------|------|------|
| `capture` | 采集剪贴板内容入库 | `content: &str`, `source_label: Option<&str>` | `Result<ClipItem>` |
| `search` | 搜索剪贴板历史 | `query: &str`, `bucket: Option<&str>`, `limit: i64` | `Result<Vec<ClipItem>>` |
| `copy` | 写回剪贴板 | `id: &str` | `Result<()>` |
| `update` | 更新条目属性 | `id: &str`, `updates: ClipUpdate` | `Result<ClipItem>` |
| `delete` | 软删除条目 | `ids: &[String]` | `Result<()>` |

### WindowService

| 方法 | 功能 | 参数 | 返回 |
|------|------|------|------|
| `show_panel` | 显示面板并定位 | `strategy: PositionStrategy`, `source: &str` | `Result<()>` |
| `hide_panel` | 隐藏面板并保存位置 | - | `Result<()>` |
| `toggle_panel` | 切换面板显示状态 | `source: &str` | `Result<()>` |
| `position_panel` | 仅定位面板 | `strategy: PositionStrategy` | `Result<()>` |

### LogService

| 方法 | 功能 | 参数 | 返回 |
|------|------|------|------|
| `append` | 写入日志 | `level: &str`, `module: &str`, `message: &str` | `Result<()>` |
| `query` | 查询日志 | `text: Option<&str>`, `level: Option<&str>`, `limit: i64` | `Result<Vec<LogEntry>>` |
| `cleanup` | 清理日志（超过 10MB） | - | `Result<String>` |

### SettingsService（规划中）

SettingsService 是设置控制面的单一服务入口，供设置窗口、Agent 配置区和 MCP 设置工具复用。第一阶段只进入控制面，不迁移主面板热路径。

| 方法 | 功能 | 参数 | 返回 |
|------|------|------|------|
| `get` | 读取设置文档，可按需包含 schema | `include_schema: bool` | `Result<SettingsDocument>` |
| `patch` | 局部更新设置 | `SettingsPatchRequest` | `Result<SettingsWriteResult>` |
| `replace` | 全量替换设置，必须确认 | `SettingsReplaceRequest` | `Result<SettingsWriteResult>` |
| `reset` | 按 scope 重置设置，必须确认 | `SettingsResetRequest` | `Result<SettingsWriteResult>` |
| `agent_providers` | 读取 redacted provider 列表 | - | `Result<Vec<AgentProvider>>` |
| `agent_check` | 按需检测 provider 可用性 | `provider_id: &str` | `Result<AgentProviderCheck>` |
| `agent_models` | 按需拉取模型列表 | `provider_id: &str` | `Result<AgentModelList>` |

统一的是 Rust domain service、JSON schema、revision、redaction、错误码、事件和写入策略；不是强制所有调用方共用同一个传输层。

## MCP 服务（应用托管 + stdio）

当前实现以 `clipforge --mcp` stdio server 为稳定外部入口。应用启动时会自动托管一个 MCP 子进程用于状态检测和应用内展示；外部 MCP Client 仍按 MCP 规范启动自己的 stdio server 进程。

- **启动时机**：应用启动时自动托管；设置页可查看状态。
- **通信方式**：MCP 子进程通过同一套 Rust 服务函数访问 SQLite、剪贴板和分析能力。
- **传输层**：stdio。
- **生命周期**：托管子进程随应用启动和退出；外部客户端进程由客户端管理。
- **追溯字段**：工具调用返回 `traceId`、`source`、`businessChain`、`permissionDecision`，失败返回 `error.data.hint`。

### MCP Tools

| 工具名 | 对应 Service | 功能 |
|--------|-------------|------|
| `clipf.capture` | ClipboardService.capture | 采集剪贴板内容 |
| `clipf.get` | ClipboardService.get | 读取单项 |
| `clipf.list` | ClipboardService.search | 读取列表 |
| `clipf.search` | ClipboardService.search | 搜索历史 |
| `clipf.analyze` | ContentAnalysisService.analyze | 只分析内容 |
| `clipf.copy` | ClipboardService.copy | 写回剪贴板 |
| `clipf.update` | ClipboardService.update | 更新条目 |
| `clipf.delete` | ClipboardService.delete | 删除条目 |
| `clipf.export` | ClipboardService.export | 导出历史 |
| `clipf.import` | ClipboardService.import | 导入历史 |

SettingsService 落地后会新增 `clipf.settings.*` 和 `clipf.agent.*` 工具。MCP handler 必须调用 SettingsService，不直接写设置文件，也不能影响已有 `clipf.list`、`clipf.get`、`clipf.copy` 等剪贴板工具。

## 控制面与热路径

ClipForge 的低延迟体验依赖控制面和主面板热路径隔离：

```text
Control Plane
  Settings window
  Agent provider config
  MCP settings tools
  schema / validation / revision / redaction / provider check / model list

Hot Path
  global shortcut trigger
  quick panel show/hide/position
  clipboard listener
  virtual list scroll/selection
  copy/paste writeback
  search/filter in current panel
```

第一阶段 SettingsService 只进入 Control Plane。Hot Path 继续保留现有低延迟链路，禁止在快捷键打开、滚动、选中、搜索、复制/粘贴反馈中同步等待 settings schema、MCP、provider check 或 models。

可见交互预算：

- 主面板打开、选中、滚动、复制/粘贴反馈：P95 <= 300ms。
- 设置页 sidebar/tab 切换、开关和局部保存反馈：P95 <= 300ms。
- 网络 provider check、models、updater、诊断导出等异步任务：300ms 内显示 pending/loading/error 状态，真实完成可异步返回。

## 定位策略（聚合 EcoPaste/Maccy/TieZ）

### 策略枚举

```rust
enum PositionStrategy {
    TrayCenter,       // 托盘图标下方居中（tauri-plugin-positioner）
    FollowCursor,     // 跟随鼠标光标（EcoPaste 方案）
    Center,           // 居中当前显示器
    WindowCenter,     // 居中当前窗口（Maccy 方案）
    LastPosition,     // 恢复上次位置（归一化坐标，Maccy 方案）
    FocusInput,       // 跟随焦点输入框（macOS Accessibility）
}
```

### 多层回退机制

每种策略都有完整的回退链路，确保定位始终可用：

| 策略 | 回退链路 | 说明 |
|------|----------|------|
| TrayCenter | TrayCenter → Center → FollowCursor | 托盘定位失败时回退到屏幕居中，再回退到光标 |
| FollowCursor | FollowCursor → Center → TrayCenter | 光标定位失败时回退到屏幕居中，再回退到托盘 |
| Center | Center → FollowCursor → TrayCenter | 屏幕居中失败时回退到光标，再回退到托盘 |
| WindowCenter | WindowCenter → Center → FollowCursor | 窗口居中失败时回退到屏幕居中，再回退到光标 |
| LastPosition | LastPosition → Center → FollowCursor | 上次位置失效时回退到屏幕居中，再回退到光标 |
| FocusInput | FocusInput → Center → TrayCenter | 焦点定位失败时回退到屏幕居中，再回退到托盘 |

### 策略优先级

| 唤起方式 | 默认策略 |
|----------|----------|
| 托盘点击 | TrayCenter |
| 快捷键 | FollowCursor |
| 命令行 | Center |
| 脚本调用 | WindowCenter |

### 归一化坐标存储

位置存储为相对于显示器的 [0,1] 比例坐标，支持跨分辨率/多显示器适配：

```rust
struct NormalizedPosition {
    x: f64,           // 0.0 ~ 1.0
    y: f64,           // 0.0 ~ 1.0
    monitor_id: Option<String>,
}
```

### 定位性能优化

1. **缓存机制**：最近一次的定位结果缓存到内存，避免重复计算
2. **异步获取**：跨进程的定位信息（如焦点输入框、前台窗口）通过后台线程获取，不阻塞主线程
3. **快速失败**：每种策略设置超时时间，超时自动触发回退
4. **延迟保存**：面板关闭时延迟 100ms 保存位置，避免频繁写盘
5. **防抖机制**：快速多次唤起只执行一次定位，避免抖动（50ms 防抖窗口）
6. **异步定位调度**：非托盘策略的定位在后台线程执行，面板先显示再异步调整位置

## 数据

当前数据目标：

- SQLite 永久保存剪贴板历史。
- WAL 日志模式 + FTS5 全文搜索。
- blake3 哈希去重，重复内容只累加 `use_count`。
- 软删除优先，按配置定期硬删除。
- 查询使用分页 cursor，默认限制返回条数。
- 长期目标支持 100,000 条记录仍保持快速检索。

## 配置与日志

用户配置映射到系统用户目录下的 JSON5 文件。日志写入本地文件（最大 10MB，自动清理），便于定位剪贴板采集、快捷键、窗口和数据库问题。

设置页展示配置路径和数据库路径，后续每个配置项都应该能在 UI 中直接修改。

## 技术栈

- 桌面壳：Tauri v2
- 原生能力：Rust command + Service Layer
- 前端：React + TypeScript + Vite
- UI：shadcn/ui 风格组件和语义 token
- 持久化：SQLite (rusqlite) + WAL + FTS5
- 面板：tauri-nspanel (macOS) / WebviewWindow (Windows)
- 定位：tauri-plugin-positioner + 自研 FollowCursor
- MCP：进程内常驻 JSON-RPC 服务

## 面板定位与交互（统一逻辑点空间）

所有面板定位计算统一在**全局逻辑点空间**（主屏左上原点）下进行，避免物理/逻辑混用导致 Retina/混合 DPI 偏移与错屏：

- **光标**：macOS 用 `CGEvent.location()`（`cursor_logical_point`），绕开 tao `cursor_position()` 用主屏 scale 转物理、再被 `monitor_from_point`(期望逻辑) 误判屏的连锁错误。
- **选屏**：`monitor_for_logical_point` = `monitor_from_point`(逻辑) → 自行用 work_area 逻辑边界做命中 → primary；**绝不回退 `current_monitor()`**（面板隐藏时指向上次所在屏，是多屏错位根因）。
- **尺寸**：默认 420×488；`open_panel` 同步定位 → 显示 → 异步 AX 精修（仅当焦点屏==光标屏才覆盖）。

交互模型：

- **快捷键**：全局 Ctrl+V 走 `toggle_quick_panel`（可见即隐藏），保证可重复触发。
- **点击**：点击条目 = 粘贴并关闭（`paste_clipboard_text` 已含写入+隐藏+模拟 Cmd+V）。
- **失焦关闭**：前端 `onFocusChanged` 失焦后 180ms 隐藏（pinned 时跳过）。
- **分组快捷键**：列表每 10 项一组，激活组由视口中心决定；`Cmd+0-9` 触发激活组内第 N 项，`Cmd+↑/↓` 切组并焦点跟随新组第一项；纯 `↑/↓` 仍逐项移动。序号 0-9 仅在激活组内显示。
- **pin 固定**：`PANEL_PINNED` 标志位（对齐 EcoPaste）；所有自动隐藏路径（hide_panel / hide_panel_before_paste / 前端 Escape / 前端失焦）在 pinned 时跳过，面板保持在当前位置。
- **完成提示**：`completionToast` 状态，聚合复制/删除/批量收藏后 1.2s 短时浮现。
