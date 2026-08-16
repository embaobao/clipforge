# Spec: deepseek-harness-embedding

## 能力要求

- ClipForge 必须能把 DSH 作为可选 AI 运行时底座内嵌，承载快速分析与管理。
- 内嵌必须 localhost-only、headless、常驻 sidecar；禁止暴露到局域网。
- 分析 profile 必须只读：禁用 filesystem-write、shell、danger-full-access。
- 工具管线 pre-execute 必须接入 CapabilityPolicy 与脱敏。
- 模型路由必须支持 DeepSeek 与 OpenAI 兼容端点（用户配置）。
- 缺失 Node / dsh / 模型配置时，基础剪贴板功能必须不受影响（AI 入口禁用）。

## 结果契约

- DSH 输出必须映射为四类之一：previewPatch / newClipDraft / copyResult / renderPanel。
- 任何写回必须经由 preview / confirm（WritebackGuard），不得静默直写。

## 降级契约

- sidecar 崩溃 / 超时 / 非法输出不得影响剪贴板监听、搜索、复制、粘贴。
- 隐私默认值：只发送 summary/metadata，全文需用户授权。
