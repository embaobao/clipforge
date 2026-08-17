# 提案：文件（文件夹）上下文的 DSH 对话集成

## 优先级

P4.x（AI 能力延伸）。依赖 `deepseek-harness-embedding`（DSH 运行时底座，Phase 0–5 已落地，Phase 6–7 转向常驻守护进程 + 悬浮对话）与 `file-image-clipboard-support`（文件/图片剪贴板采集）。本提案不新建运行时，只在既有 DSH 集成之上补「文件上下文」这一用户场景。

## 背景

盟哥 2026-08-17 指示：参考 `anywhere-labs/deepseek-harness-desktop` 的 DSH 集成思路（Host-Service Separation：宿主常驻管理 DSH 守护进程，UI 对话），ClipForge 是**悬浮剪贴板工具**，AI 入口收敛为悬浮 DSH 面板（`PanelSurface = "clipboard" | "dsh"`）。诉求：右键菜单增加「复制文件（文件夹）地址到剪贴板」与「在此文件（文件夹）开始对话」。

经核查，能力雏形已存在：

- **复制地址**：`ClipContextMenu.tsx` 已有 `payloadKind === "file"` 专属「复制路径」（`filesAsPaths`，第 160–173 行），仅待验收。
- **文件采集**：`read.rs::read_files()` 已实现从系统剪贴板抓 `file://` URL，落为 `payloadKind === "file"`；`clipboard-domain.ts::getFilePathsFromClip` 可解析路径。
- **AI 分析入口**：右键「AI 分析」已存在（第 174–185 行），调用 `onAnalyzeClipboard?.(item)`。
- **DSH 面板**：`dsh-panel.tsx` 是独立 surface，Phase 6–7 后将重构为对话式客户端（见 `deepseek-harness-embedding`）。

## 目标

- 文件（文件夹）类剪贴板条目右键支持「复制地址」（验收既有项）与「在此文件开始对话」（新增文件作用域对话入口）。
- 「在此文件开始对话」把文件路径（及限大小内容/元数据）作为上下文注入 DSH 守护进程对话，产出对该文件的分析，而非路径文本分析。
- 支持文件夹：列子项、按类型聚合、对重点文件抽样。
- **多轮对话由 `deepseek-harness-embedding` 的常驻守护进程原生支持**（按 `conversationId` 持会话态），本提案不再实现「重发历史」模拟多轮。
- 系统级文件管理器右键（Finder/资源管理器内直接出菜单）见独立提案 [`dsh-system-context-menu`](./dsh-system-context-menu/proposal.md)，不在本提案。
- 全程遵守红线：headless 只读、隐私默认仅发元数据（全文需授权）、降级不破坏剪贴板主流程。

## 非目标

- **系统级文件管理器右键**：需 Finder Sync Extension / Shell 扩展等重原生工作，跨平台成本高，与「悬浮剪贴板工具」定位有张力 → 不在本提案，见 `dsh-system-context-menu`。
- 文件内容预览 / Office / PDF 内嵌渲染（属 `file-image-clipboard-support` 非目标）。
- 让 DSH 直接读写用户文件（仅读取用于分析，由宿主侧注入）。
- 重构 DSH 运行时底座（那是 `deepseek-harness-embedding` 的事）。

## 与现有提案关系

- `deepseek-harness-embedding`：本提案的运行时底座。常驻守护进程（Phase 6）+ 对话客户端（Phase 7）使「在此文件开始对话」天然多轮；本提案只新增「文件上下文」调用场景与文件读取工具。
- `dsh-system-context-menu`：系统级右键原生扩展，消费本提案的「复制地址 / 在此文件开始对话」能力，但入口在 Finder/资源管理器而非应用内。
- `file-image-clipboard-support`：提供文件类剪贴板条目采集与存储，本提案消费其产物。

## 用户价值

- 复制文件后，一键把路径发到剪贴板，或在悬浮 DSH 面板里直接「问」这个文件（这是什么、怎么改、摘要、抽字段），并围绕它多轮追问。
- 开发者/运维可对日志、配置、代码文件做即时 AI 解读，无需离开剪贴板工作流。

## 风险与待拍板

- **大文件 / 二进制**：读取须限大小、判文本、跳二进制；超限降级为「仅元数据」。
- **macOS 沙盒路径访问**：打包后需确认 entitlements 含相应文件访问权限，否则读取失败走降级。
- **系统级右键范围**：明确不在 v1（见 `dsh-system-context-menu`），应用内右键已覆盖等效能力。
