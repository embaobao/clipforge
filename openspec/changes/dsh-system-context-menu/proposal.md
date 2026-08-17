# 提案：系统级文件管理器右键（Finder / 资源管理器）

## 优先级

P5（原生扩展，后置）。依赖 `dsh-file-context-conversation`（应用内「复制地址」「在此文件开始对话」能力）与 `deepseek-harness-embedding`（常驻守护进程 + 悬浮 DSH surface）。本提案把同等能力从「应用内右键」延伸到「系统文件管理器右键」，是重原生工作，不在 v1 悬浮 DSH 主线范围。

## 背景

`deepseek-harness-embedding` 转向 Host-Service Separation 后，ClipForge 是一个**常驻后台 + 悬浮 DSH 面板**的桌面助手。盟哥 2026-08-17 指示研究 `anywhere-labs/deepseek-harness-desktop` 的集成方式，其中一项诉求是**系统级文件管理器右键**：在 Finder / 资源管理器里直接对文件「复制地址」或「在此文件开始对话」。

应用内右键（`ClipContextMenu.tsx`）已覆盖等效能力；本提案把入口延伸到系统文件管理器，让用户在任意文件上右键即可唤起 ClipForge 的 DSH 对话。

## 目标

- 在 macOS Finder / Windows 资源管理器右键菜单，对文件（文件夹）提供：
  - **「复制地址」**：把纯路径写入系统剪贴板（复用 `dsh-file-context-conversation` 的复制逻辑）。
  - **「用 ClipForge 分析」/「在此文件开始对话」**：唤起已运行的 ClipForge，切到 `dsh` surface 并预填该文件上下文（复用常驻守护进程对话）。
- 通过原生扩展调用已运行的 ClipForge 主进程（不另起实例）；主进程未运行时先启动再处理。

## 集成方式（原生扩展）

- **macOS**：Finder Sync Extension（独立 `NSExtension` target，随包分发，系统注册）。点击菜单 → 经 URL Scheme（`clipforge://dsh?path=<encoded>`）或 XPC / 文件哨兵回传主进程。
- **Windows**：Explorer 上下文菜单 Shell 扩展（COM DLL，注册表挂 `HKCR\*\shell`）→ 调起 `clipforge.exe` 并传路径参数 / 协议。
- **共同桥接**：主进程注册 `clipforge://` URL Scheme（Tauri `deep-link` 插件）→ 解析 `path` → `setActiveSurface("dsh")` + 注入 `fileContext`（走 `dsh-file-context-conversation` 的文件感知分析）。

## 非目标

- 不在系统右键内渲染 DSH UI（只负责唤起主进程悬浮面板）。
- 不修改 DSH 运行时或分析逻辑（全部复用既有提案）。
- 不实现文件内容预览 / 编辑。

## 与现有提案关系

- `dsh-file-context-conversation`：本提案消费其「复制地址 / 在此文件开始对话」能力，仅把入口外移到系统文件管理器。
- `deepseek-harness-embedding`：提供常驻守护进程与 `dsh` surface，本提案的「开始对话」最终落到该 surface + 守护进程。
- `deepseek-harness-embedding` 的「常驻后台 + 托盘」是系统右键能「唤起已运行实例」的前提。

## 用户价值

- 在 Finder/资源管理器对任意文件右键即可让 ClipForge 分析/对话，无需先复制到剪贴板再回应用操作。
- 与 Raycast/Spotlight 式快速唤起互补：右键是「文件定点」，快捷键是「全局唤起」。

## 风险与待拍板

- **跨平台原生成本高**：macOS Finder Sync 需独立 extension target + 权限/签名；Windows Shell 扩展是 COM DLL，开发与签名更重。是否双平台都做，还是先 macOS，需拍板。
- **App Store / 公证**：macOS 公证与 Finder Sync 权限有合规成本；可能走开发者 ID 分发而非 App Store。
- **轻量替代**：若不想维护原生扩展，可用「复制地址」+ 应用内唤起作为 v1 折中（已在 `dsh-file-context-conversation` 覆盖），系统级菜单后置。
