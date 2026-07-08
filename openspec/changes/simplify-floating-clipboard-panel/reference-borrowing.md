# 成熟项目借鉴与取舍

## 调研目标

本变更借鉴成熟开源项目和公开产品，不是为了堆功能，而是为了回答四个核心问题：

1. 悬浮窗如何稳定、准确、快速地出现并接管输入。
2. 键盘选择和快捷复制如何做到低延迟、可预期、不中断。
3. 文本之外的图片、文件、HTML、表格/图表等内容如何展示、复制和打开。
4. 插件、Agent、AI 能力如何从第一天就有边界，而不是后期推翻重做。

## 参考项目

| 项目 | 类型 | 关键借鉴 | ClipForge 取舍 |
|---|---|---|---|
| Maccy | macOS 轻量剪贴板 | 键盘优先、快速搜索、菜单栏/悬浮入口、忽略敏感类型、轻量原生体验 | 采纳键盘优先和轻量面板；不照搬 macOS-only 架构 |
| CopyQ | 跨平台高级剪贴板 | tabs、脚本、命令、直接粘贴、内容编辑、扩展能力 | 采纳命令/动作槽和多内容组织；暂不做完整脚本 IDE |
| Ditto | Windows 成熟剪贴板 | 多格式历史、搜索、快捷键、数据库备份、图片/HTML/custom format 支持 | 采纳多格式内容模型和搜索/恢复思路；不做 Windows-only 体验 |
| Espanso | 跨平台文本扩展 | 触发器、包、脚本、表单、应用级配置、本地隐私优先 | 采纳插件包和触发器思路；不把 ClipForge 改成文本扩展器 |
| EcoPaste | Tauri 剪贴板 | Tauri v2、SQLite、写回防护、哈希去重、窗口定位 | 采纳架构思路；注意 AGPL 项目只能借鉴，不能复制代码 |
| Power Paste | Tauri 快速粘贴 | 按住快捷键循环选择、目标感知粘贴、payload 降级链 | 采纳快速粘贴范式和 payload 降级链；目标感知粘贴放到 P2 |
| tauri-plugin-positioner | Tauri 定位插件 | 托盘相对定位、窗口边界约束 | P1 用于托盘入口；光标/输入框定位仍需自研补齐 |
| CliperX | macOS 剪贴板公开产品 | 顶部“灵动岛”悬停展开、AI 推荐、自动 OCR、智能分类、全文搜索、导出、买断定价 | 只借鉴体验和功能分层；不作为代码来源，不改变 ClipForge 当前悬浮面板主线 |

## P1 采纳决策

### 1. 悬浮窗与输入焦点

采纳来源：Maccy、EcoPaste、tauri-plugin-positioner。

落地策略：

- `openPanel(source)` 统一入口：global-shortcut、tray、quick-menu、agent-trigger 都必须走同一入口。
- 定位策略按优先级执行：输入区域/光标锚点、托盘锚点、上次归一化位置、当前屏幕居中。
- 面板打开后必须执行焦点检测：窗口可见、窗口 focused、搜索框可输入、active item 已建立。
- 焦点失败时降级：底部状态提示“聚焦恢复中”，同时保留 `Cmd+数字` 快捷和方向键路径。
- Tauri 层使用 global-shortcut 插件作为全局唤起基础，clipboard-manager 插件作为当前写回基础；后续需要原生能力时封装在 Rust command。

不采纳：

- 不把 NSPanel 细节暴露到前端组件。
- 不把托盘定位当成唯一定位方案；托盘无法覆盖输入框/光标跟随场景。

### 2. 键盘极速选择

采纳来源：Maccy、Power Paste、CopyQ。

落地策略：

- 数字块是第一视觉锚点：鼠标点击数字块进入/切换多选；键盘普通数字默认输入搜索，只有 `Cmd+数字` 作用于对应条目。
- 方向键移动 active item，目标光标跟随 active item。
- Enter 复制 active item；多选模式下复制聚合预览结果。
- Esc 采用明确优先级：关闭聚合预览、退出多选、关闭单条预览、清空搜索、关闭面板。
- IME 组合输入和普通数字输入期间禁止抢快捷键，避免中文搜索和数字搜索被打断。
- 目标光标只渲染一个浮动 focus ring，不给每行添加复杂 hover 动画。

不采纳：

- P1 不做“按住快捷键循环选择松手粘贴”，它需要目标窗口追踪和辅助功能权限，放入 P2。
- 不做可编程快捷键编辑器；先提供固定且稳定的核心快捷键。

### 3. 多格式内容模型

采纳来源：Ditto、CopyQ、Power Paste、Espanso。

落地策略：

- 内容统一为 `ClipboardContentKind`：text、link、image、file、table、chart、richText、unknown。
- payload 采用降级链：richText/html/table/chart 可以降级为 text；image/file 保留原始引用和摘要。
- 列表行只显示一行摘要，详情和预览放到固定高度区域。
- 链接在详情里独立罗列，支持打开；不要把一条长文本里的多个链接挤在主列表行。
- 图片、文件、表格/图表先做“摘要 + 预览槽 + 复制原 payload”设计，具体采集落到 SQLite/原生能力阶段。

不采纳：

- P1 不做复杂内容编辑器。
- P1 不做跨设备同步、二维码互传和云备份。

### 4. 插件、Agent、AI 扩展边界

采纳来源：CopyQ、Espanso、现有 `agent-mcp-service` 提案。

落地策略：

- 插件不是 UI 面板堆叠，而是三类扩展点：内容解析器、动作提供者、触发器。
- Agent Bridge 只暴露稳定工具接口：search、getSelected、copy、favorite、deleteToTrash、restoreFromTrash。
- 默认权限最小化：Agent 只能读取用户选中或搜索返回的有限内容；全量历史需要显式开关。
- Agent/插件状态收到底部状态线和更多菜单，不进入主列表。
- AI 功能作为动作槽存在，例如“总结选中内容”“转换格式”“提取链接”，不改变剪贴板工具主定位。

不采纳：

- P1 不做 AI 工作台、聊天面板、复杂配置中心。
- 不允许 Agent 自动读取全部历史作为默认行为。

## P2/P3 暂缓能力

| 能力 | 阶段 | 暂缓原因 |
|---|---|---|
| 目标感知粘贴 | P2 | 需要记录原目标窗口和处理系统权限 |
| 按住快捷键循环粘贴 | P2 | 依赖更强的快捷键状态机和目标粘贴 |
| 富文本/HTML 完整编辑 | P2 | 需要稳定的 payload 模型和编辑器边界 |
| 顶部悬停岛常驻入口 | P2 | 对悬浮窗定位、全屏空间、误触和平台一致性要求更高，P1 先做好快捷唤起面板 |
| 自动 OCR 和图片文字化 | P2 | 需要图片采集、OCR 管线和权限/性能边界 |
| AI 智能推荐动作 | P2 | 需要内容分类、动作槽、隐私授权和 Agent/AI 状态设计先稳定 |
| 应用忽略与敏感过滤 | P2 | 需要原生采集层参与，不能只在前端做 |
| 脚本/命令市场 | P3 | 会明显增加安全和维护复杂度 |
| 云同步/跨端传输 | P3 | 不是当前替代 Clipy 核心闭环 |

## CliperX 的借鉴意义

CliperX 对 ClipForge 的价值不在代码，而在产品功能组织和快捷入口表达：

- 顶部悬停展开：证明“常驻但低占用”的剪贴板入口有市场感知。ClipForge 可借鉴其零干扰目标，但 P1 仍优先全局快捷键/托盘/光标定位，避免过早绑定 macOS 顶部岛交互。
- 复制后动作推荐：CliperX 按内容类型推荐翻译、总结、代码分析、OCR。ClipForge 应把这类能力抽象成动作槽，由内容类型和插件/Agent Bridge 提供动作，而不是把 AI 面板做成主界面。
- 自动 OCR：图片剪贴板不是只存缩略图，最终应能提取文字进入搜索索引。ClipForge 的内容模型需要保留 `image -> ocrText -> searchableText` 的链路。
- 智能分类和全文搜索：公开产品把“7 种内容类型自动识别”和“毫秒响应全文检索”作为卖点，支持 ClipForge 后续推进 SQLite + FTS5 + 内容类型摘要，而不是长期停留在前端过滤。
- AI 清理：按语义识别重复、临时验证码、一次性链接等内容。ClipForge 可以先用规则化清理和垃圾箱恢复打底，AI 清理放在用户确认后的 P2/P3 能力，避免误删。
- 多格式导出：TXT、JSON、Markdown 导出是用户掌控数据的明确价值。ClipForge 后续导出能力应和 Agent 工具接口共用数据模型。
- 本地隐私叙事：CliperX 明确强调本地存储、AI 需主动点击才发送。ClipForge 的 Agent/AI 入口也必须保持“用户显式触发、最小读取、状态可见”的原则。

### 对当前规划的影响

- 不改变 P1 的开发范围：仍以高密度悬浮面板、token、键盘路径、底部状态、多选聚合预览为主。
- 强化 P2/P3 路线：图片/OCR、AI 动作推荐、智能清理、导出需要进入后续能力池。
- 强化隐私规则：AI/Agent 不默认后台扫描剪贴板，不默认读取全量历史。
- 强化入口策略：顶部悬停岛可以作为后续入口模式研究，但不能替代当前全局快捷键和稳定窗口焦点检测。

## 对当前 UI 的直接约束

- 主面板不能像 CopyQ 一样先暴露 tabs/脚本/编辑器；这些是后续管理能力。
- 主面板必须像 Maccy 一样让搜索、方向键、显式快捷键成为第一路径；普通数字键归搜索，条目快捷使用 `Cmd+数字`。
- 内容类型必须像 Ditto 一样从设计上支持 text/image/html/custom format，但 P1 UI 先用摘要和预览槽承载。
- 插件能力借鉴 Espanso 的包和触发器思路，但以 ClipForge 动作槽呈现，不做单独脚本产品。
- Agent 能力只在状态和接口层预留，不在视觉上抢主面板空间。
- CliperX 的 AI 推荐、OCR、智能清理和顶部岛入口只进入后续路线，不抢 P1 主面板空间。

## 参考链接

- Maccy: https://github.com/p0deje/Maccy
- Maccy 官网: https://maccy.app/
- CopyQ 文档: https://copyq.readthedocs.io/
- CopyQ GitHub: https://github.com/hluk/copyq
- Ditto: https://sabrogden.github.io/Ditto/
- Espanso GitHub: https://github.com/espanso/espanso
- Espanso Extensions: https://espanso.org/docs/matches/extensions/
- Tauri v2 clipboard-manager: https://v2.tauri.app/plugin/clipboard/
- CliperX: https://cliperx.com/#features
