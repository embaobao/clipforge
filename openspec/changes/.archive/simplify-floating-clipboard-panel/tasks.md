# 任务：简化高密度悬浮剪贴板面板

## Phase 1：提案整合与参考借鉴

- [x] 梳理 `design-style-upgrade`、`nspanel-floating-panel`、`numeric-shortcut-paste`、`clipboard-listener-upgrade`
- [x] 明确当前阶段以悬浮快捷面板为主体验
- [x] 重新评估并引入 TanStack Router memory router，仅用于面板内部列表/详情/聚合工作台层级
- [x] 基于成熟开源项目补充借鉴矩阵和取舍规则
- [x] 明确 Maccy/CopyQ/Ditto/Espanso/EcoPaste/Power Paste 的采纳与暂缓能力

## Phase 2：Style Token 与设计系统

- [x] 定义 shadcn 语义 token
- [x] 定义 ClipForge 产品 token：玻璃、像素、密度、动效、状态、内容类型、集成状态
- [x] 明确亮色/暗色映射规则
- [x] 明确 token 到组件的使用映射
- [x] 明确中文注释和 raw value 禁止规则
- [x] 将 token 落到前端全局 CSS
- [x] 移除旧变量兼容层，避免维护两套命名
- [x] 清理组件内散落颜色、阴影、圆角、高度值

## Phase 3：框架与组件拆分

- [x] 提取 `WorkspaceRouterProvider`，用 TanStack Router code-based memory route 管理 `/`、`/clip/$clipId`、`/aggregate`
- [x] 提取 `useWorkspaceStore`，用 Zustand 维护工作台下钻状态
- [x] 提取 `ClipForgeShell`
- [x] 提取 `GlassSearchBar` 与 `FilterChips`
- [x] 提取 `PreviewBand`
- [x] 提取 `ClipDetailWorkspace`
- [x] 提取 `MultiAggregateWorkspace`
- [x] 提取 `ClipboardList` 与 `ClipboardRow`
- [x] 提取 `ShortcutIndexButton`
- [x] 提取 `BottomDock`
- [x] 提取 `AggregatePreviewSheet`
- [x] 提取 `TrashPanel`
- [x] 提取 `TargetFocusRing` 与 `StatusLine`
- [x] 提取 `useClipboardPanelState`、`useKeyboardShortcuts`、`useTargetCursor`

## Phase 4：结构重排

- [x] 紧凑模式隐藏右侧 rail，底部承载历史、收藏、垃圾箱、设置入口
- [x] 快捷面板默认尺寸调整为低矮比例，避免旧窄高工作台形态
- [x] 快捷面板尺寸调整为更窄更高的快速列表比例
- [x] 取消独立刷新按钮，把状态与采集合并到底部
- [x] 顶部工具栏改为搜索 + 筛选 + 预览触发
- [x] 顶部搜索改为悬浮液态玻璃层，激活后显示搜索和筛选
- [x] 单条快速预览改为 `Space` 触发的固定区域
- [x] 单条预览从悬浮层改为固定顶部区域并增加可读高度
- [x] 多选改为底部固定透明玻璃操作栏，聚合预览改为 `/aggregate` 工作台显式触发
- [x] 右方向键下钻到单条详情或多选聚合工作台，左方向键/`Esc` 返回列表

## Phase 5：列表高密度化

- [x] 列表主文本改为原始剪贴板一行内容
- [x] 使用中间省略保留头尾内容感知
- [x] 数字块点击进入/切换多选
- [x] 普通数字输入保留给搜索，条目快捷复制改为 `Cmd+数字`
- [x] 行主体点击默认复制
- [x] 行内删除/归档从主列表中移除，保留收藏和链接打开
- [x] 多选入口只保留行内数字块触发，底部 dock 不再放多选按钮
- [x] 搜索支持包含匹配、轻量模糊匹配和汉语拼音英文匹配
- [x] 搜索能力提供设置项：模糊搜索、拼音英文搜索

## Phase 6：悬浮窗与焦点检测

- [x] 统一 `openPanel(source)` 入口
- [x] 面板打开后检测 visible/focused/search focus/active item
- [x] 焦点失败时显示底部状态并保留键盘路径
- [x] 输入法组合输入期间不抢快捷键
- [x] 普通数字键不直接选择 item，避免搜索歧义
- [x] 窗口定位保留输入区域/光标、托盘、上次位置、居中四级 fallback

## Phase 7：快捷聚焦动效

- [x] hover/active 使用同一移动目标聚焦框，不再使用每行背景色 hover
- [x] 键盘 active 行显示同一移动聚焦框
- [x] 键盘选择超出可视区时自动平滑滚动到目标行
- [x] 键盘长按方向键时加速移动，并自动滚动到 active item；鼠标 hover 不触发自动滚动
- [x] 复制成功显示短暂确认状态
- [x] 支持 `prefers-reduced-motion`

## Phase 8：内容类型与扩展槽

- [x] 定义前端 `ClipboardContentKind`
- [x] 文本、链接、图片、文件、表格/图表使用统一摘要接口
- [x] 详情预览区支持链接罗列
- [x] 预留内容解析插件接口
- [x] 预留动作插件接口
- [x] 单条详情工作台预留 Markdown/JSON/图片/链接渲染和插件动作槽
- [x] 多选聚合工作台预留聚合复制、TSV 表格导出和批量插件动作槽
- [x] 底部状态线预留 Agent/插件状态

## Phase 9：垃圾箱与恢复

- [x] 垃圾箱入口下沉到底部
- [x] 垃圾箱列表保留恢复和彻底删除
- [x] 删除动作默认从当前项/多选底部动作触发

## Phase 10：验证

- [x] `pnpm build`
- [x] `cd src-tauri && cargo check`
- [x] `pnpm tauri dev` 启动真实应用
- [x] 真实应用窗口视觉回归检查
- [x] 验证 Web 预览和 Tauri 应用样式一致，以应用为准
- [x] 验证鼠标、键盘、IME、多选聚合、垃圾箱恢复、reduced-motion

## 实现说明

- `stabilize-monochrome-panel` 覆盖了本提案早期“多选底部透明操作栏”的设计，最终实现为顶部多选操作台，底部 dock 只保留状态和导航。
- 早期 `TargetFocusRing` 动效已被黑白直角虚线行态替代，原因是虚拟列表下移动框对齐不稳定。
- 悬浮触发检测已提升为原生命令 payload：visible、focused、bounds、positionSource、focusedInputSource 均可在设置页查看。
