# Spec: deepseek-harness-embedding

## 能力要求

- ClipForge 必须能把 DSH 作为可选 AI 运行时底座内嵌，承载快速分析与常驻会话。
- 内嵌必须 localhost-only、headless、常驻守护进程（Host-Service Separation）；禁止暴露到局域网（`--host 0.0.0.0` 拒绝）。
- 分析 profile 必须只读：禁用 filesystem-write、shell、danger-full-access。
- 工具管线 pre-execute 必须接入 CapabilityPolicy 与脱敏。
- 模型路由必须支持 DeepSeek 与 OpenAI 兼容端点（用户配置）。
- 缺失 Node / dsh / 模型配置时，基础剪贴板功能必须不受影响（AI 入口禁用或降级）。

## 守护进程生命周期要求

- ClipForge 必须在应用启动后在后台常驻拉起 DSH host 服务（localhost），并在应用退出时清理子进程（无孤儿进程）。
- ClipForge 必须提供守护进程健康检查（轮询 `/health`），就绪后通知前端；未就绪时 AI 入口必须降级而非崩溃。
- ClipForge 必须支持守护进程重启（kill + respawn + 重置健康检查）。

## 悬浮对话客户端要求

- ClipForge 必须以悬浮 DSH 面板（`PanelSurface = "dsh"`）作为对话客户端，支持多轮、流式、四类结果展示与写回。
- 会话态必须由 DSH 守护进程持有（按 `conversationId`）；前端不得靠「重发历史」模拟多轮。

## 快速唤起要求

- ClipForge 必须提供至少一种直达 DSH surface 的快速唤起路径（全局快捷键 / 托盘菜单 / 快捷面板入口之一即可，三者俱备更佳），复用既有全局快捷键与托盘基座。

## 剪贴板打通要求

- ClipForge 必须允许把选中剪贴板条目的内容或文件上下文注入 DSH 对话首条；DSH 结果必须能写回标签/分组到该条目（经 preview/confirm）。

## 结果契约

- DSH 输出必须映射为四类之一：previewPatch / newClipDraft / copyResult / renderPanel。
- 任何写回必须经由 preview / confirm（WritebackGuard），不得静默直写。

## 降级契约

- 守护进程崩溃 / 健康检查失败 / 超时 / 非法输出不得影响剪贴板监听、搜索、复制、粘贴。
- 隐私默认值：只发送 summary/metadata，全文需用户授权。
