# 设计：启动剪贴板捕获闭环

## 交互设计

- 默认入口仍为“快速”。
- 默认启动窗口是小面板形态，优先像快捷调用面板，而不是完整管理窗口。
- 小面板下隐藏详情栏和批量管理按钮，只保留搜索、读取剪贴板、快速粘贴列表和片段。
- 小面板顶部只保留关键 icon，不展示品牌标题和系统窗口标题视觉；默认宽度收窄，高度保留，并提供顶部细拖拽带。
- 窗体与页面视觉统一为小圆角；macOS 使用透明窗口让整体面板圆角和页面容器一致。
- 小面板提供显式多选模式：数字键位切换为小号选择框，支持当前快速列表全选、批量软删除、按当前列表顺序聚合复制。
- 用户放大窗口后恢复完整功能面板，显示导航、列表、详情和批量管理能力。
- 快捷键或系统状态栏触发同一个快速面板；面板默认置顶，二次触发隐藏，失焦后延迟自动隐藏。
- 快捷键唤起必须尽量贴近当前输入位置：原生层在显示面板前读取当前焦点输入控件坐标；读取失败时使用鼠标所在屏幕；仍失败时使用当前屏幕右侧兜底。
- macOS 下快捷面板必须使用 NSPanel 承载，避免普通 Tauri window 无法覆盖原生全屏 Space。
- 小面板支持 tag 快速筛选，tag 与搜索条件叠加作用于当前快速列表。
- 启动时调用 `read_clipboard_text`。
- 若返回文本为空，状态栏展示“剪贴板为空或不是文本”。
- 若返回新文本：
  - 创建 `ClipItem`。
  - 插入列表顶部。
  - 自动选中详情面板。
  - 状态栏展示“已记录当前系统剪贴板”。
- 若返回文本已存在：
  - 不重复创建。
  - 将已有项提升到列表顶部。
  - 自动选中详情面板。
  - 状态栏展示“当前系统剪贴板已置顶”。
- 工具栏提供“读取剪贴板”按钮，用于手动触发同一流程。

## 技术设计

- 保持 Rust 命令不变，继续使用：
  - `read_clipboard_text`
  - `write_clipboard_text`
- 新增快速粘贴命令 `paste_clipboard_text`：
  - 先写入系统剪贴板。
  - macOS 下隐藏或释放 NSPanel key window。
  - 延迟约 60ms 后模拟系统粘贴快捷键。
  - macOS 使用 CoreGraphics 投递 `Cmd+V`，Windows/Linux 使用平台命令兜底。
- 存储模型：SQLite 是唯一长期事实源，数据库文件放在系统用户目录，不依赖服务端保存。
- 配置模型：配置保持单个用户目录 `settings.json5` 文件，UI 每个配置项映射到该文件并实时写回。
- 日志模型：运行错误写入用户目录 `clipforge.jsonl`，每行是 `{tsMs, level, message, context}`，并通过 Tauri command 提供按 level/text/limit 查询。
- 检索模型：
  - SQLite 使用 WAL + NORMAL synchronous。
  - 内容检索使用 FTS5。
  - 列表接口使用 `limit + cursor`，UI 不全量拉 10W 数据。
  - 快速面板只消费窗口化结果，列表使用虚拟滚动减少 DOM 渲染压力。
- 已新增服务契约，后续实现必须走统一服务，不允许 UI、同步、导入导出、外部工具各自写一套数据路径：
  - `ClipboardRepository`：负责剪贴板项持久化、去重、时间字段更新。
  - `SearchIndex`：负责 tag、来源、内容全文检索。
  - `SettingsStore`：负责 JSON5 配置读写与默认值合并。
  - `SyncAdapter`：负责导入导出、实时同步或远程同步，不改变本地 SQLite 主存储地位。
  - `ExternalToolBridge`：负责后续 MCP/外部工具调用，输入输出复用同一套契约。
- Tauri 默认窗口调整为 360x560，隐藏原生标题栏并启用置顶；macOS 打开透明窗口能力以匹配整体圆角，用户仍可放大窗口进入完整管理面板。
- macOS 快捷面板接入 `tauri-nspanel`：
  - 现有 `main` webview window 在启动时转换为 typed NSPanel，避免双渲染实例导致状态不同步。
  - Panel 使用 `PanelLevel::Floating`、`StyleMask::nonactivating_panel()`、`CollectionBehavior::full_screen_auxiliary().can_join_all_spaces()`。
  - Panel `hides_on_deactivate(false)`，隐藏由前端失焦延迟和快捷键二次触发控制。
  - 如果后续仍存在 Dock/Space 激活问题，可在设置中暴露 `ActivationPolicy::Accessory` 作为 macOS 专用增强开关。
- 当前技术调研不建议把 `tauri-plugin-positioner` 放入热路径：它更适合固定屏幕位置和托盘相对定位，不能替代 Accessibility focused input bounds。
- 默认快捷键在 macOS 使用 `Control+V`，由 Rust 原生侧注册并直接调用窗口显示逻辑，避免前端 WebView 生命周期导致快捷键失效。
- 快捷键和托盘入口的热路径只做原生位置探测、定宽高、NSPanel/窗口显示和事件通知；前端收到事件后只做轻量状态复位、搜索框聚焦和剪贴板刷新。
- 快捷面板键盘访问：
  - `ArrowUp/ArrowDown` 在当前筛选结果内移动选中项。
  - `Enter` 将当前选中项粘贴到此前活动应用。
  - `1-9` 对应可见列表项快速粘贴。
  - 鼠标点击仍保留复制行为，避免改变已有验证习惯。
- 小面板拖拽不只依赖 `data-tauri-drag-region`，前端在拖拽区域显式调用 `startDragging()` 作为兜底。
- Tauri 托盘使用 `TrayIconBuilder` 暴露“打开快捷面板”和“退出”菜单项，左键点击托盘图标也触发同一面板事件。
- `focused_input_bounds` 是快捷面板打开热路径的一部分，但必须在 `show/set_focus` 之前执行，避免 ClipForge 抢焦点后丢失外部输入控件坐标。
- Agent 快速访问：
  - 对外只暴露标准工具契约，不暴露 UI 内部状态。
  - 标准工具复用同一 SQLite/FTS 服务，不允许绕过 `ClipboardRepository` 直接写数据库。
  - P1 目标是毫秒级本地读写和有限条数检索，MCP server 可以后续作为薄适配层挂载到 `ExternalToolBridge`。
- 前端新增稳定的剪贴板捕获函数：
  - 通过 `clipsRef` 读取最新列表，避免轮询闭包拿到旧状态。
  - 通过 `lastSeenClipboard` 避免轮询重复处理同一文本。
  - 手动读取不受 `lastSeenClipboard` 阻断，方便用户验证。
- 快速粘贴面板继续展示当前过滤结果的前 8 条。
- 前端内存列表按 `maxStoredItems` 保留，快速粘贴面板只窗口化展示 `quickItemLimit` 条，避免每次捕获新剪贴板后把可见历史截到 10 条。
- tag 列表从当前剪贴板数据提取并按出现次数排序。

## 边界

- 当前只处理文本。
- 浏览器预览模式下继续降级为状态提示，真实剪贴板捕获在 Tauri App 中验证。
