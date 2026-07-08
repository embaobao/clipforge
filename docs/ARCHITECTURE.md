# 架构说明

ClipForge 采用 **统一服务层 + 内置 MCP 常驻** 架构，分为四层：前端交互层、Tauri IPC 层、Service 层、数据与平台层。

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

## MCP 服务（进程内常驻）

MCP 服务不再通过子进程启动，而是作为线程内常驻服务运行：

- **启动时机**：应用启动时自动初始化
- **通信方式**：同进程调用，共享数据库连接
- **传输层**：支持 stdio（供外部 MCP 客户端）和 in-process（供内部使用）
- **生命周期**：应用退出时自动清理

### MCP Tools

| 工具名 | 对应 Service | 功能 |
|--------|-------------|------|
| `clipboard.capture` | ClipboardService.capture | 采集剪贴板内容 |
| `clipboard.search` | ClipboardService.search | 搜索历史 |
| `clipboard.copy` | ClipboardService.copy | 写回剪贴板 |
| `clipboard.update` | ClipboardService.update | 更新条目 |
| `clipboard.delete` | ClipboardService.delete | 删除条目 |
| `clipboard.export` | ClipboardService.export | 导出历史 |
| `clipboard.import` | ClipboardService.import | 导入历史 |

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
