# 提案：DeepSeek Harness 内嵌为 AI 运行时底座

## 背景

ClipForge 主线聚焦 **AI 快速分析** 与 **剪贴板管理**。此前在 `mastra-agent-runtime-evaluation`、`local-model-quick-integration`、`vercel-ai-sdk-integration`、`ai-model-plugin-productization` 中分别探讨了自建/Mastra/Vercel AI SDK/本地模型等方向。

2026-08-13 DeepSeek 发布并开源 **DeepSeek Harness（dsh）v0.1 开发者预览**（MIT 协议），定位为「一切皆插件」的 Agent 运行时：模型、工具、技能、会话、沙箱、存储、循环、调度、UI 全部是可组合插件；模型无关，可接入 DeepSeek / OpenAI 兼容 / Anthropic / Bedrock / Azure / Vertex / 自定义端点。

决策（盟哥 2026-08-16 拍板）：**Mastra 等 AI 框架先不引入、后置**；采用 DSH 作为壳子内嵌的 AI 底座，替换原先「自建运行时 / Mastra / Vercel AI SDK 自集成」的方向。

## 目标

- 把 DSH 作为 ClipForge 的 AI 运行时底座，承载「快速分析」（摘要/分类/抽取/自动标签/建议分组）与「管理」（AI 操作历史 + trajectory 审计）。
- 以 **ACP / JSON-RPC sidecar（headless，localhost-only）** 方式常驻内嵌，避免每分析一次冷启。
- 安全红线：分析 profile 禁用 filesystem-write / shell（`danger-full-access` 永不启用）；工具管线 `pre-execute` 钩子挂 ClipForge 的 `CapabilityPolicy` + 脱敏。
- 隐私：沿用 `ai-model-plugin-productization` 默认（只发 summary/metadata，授权才发全文）；DSH「模型可见即记录」→ 控制入模内容。
- 优雅降级：Node/dsh 缺失或模型未配置时，基础剪贴板功能不受影响。

## 与现有提案的关系（归并）

- `mastra-agent-runtime-evaluation` → **结论 no / 后置，归档**（不引入 Mastra sidecar runtime）。
- `local-model-quick-integration` → **superseded**，并入本提案（DSH 模型无关，本地/OpenAI 兼容都覆盖）。
- `vercel-ai-sdk-integration` → **superseded**，DSH 已含模型适配 + tool calling + OpenAI 兼容；保留「provider 配置 UI」部分由设置页承载。
- `ai-model-plugin-productization` → **保留**为标品化 / 能力门禁 / 四类结果 / 隐私 spec，运行时改为本提案的 DSH。
- `external-hook-plugin-runtime` → 不动（剪贴板上下文采集，与 AI 运行时是两回事）。

## 非目标

- 不把 DSH 的 Web UI 替成 ClipForge 主界面；AI 操作历史复用现有极简 agent 调用页（`ClipboardAgentPanel`）。
- 不在 v1 引入 DSH 的 shell/file 编辑能力到用户机器（只读分析 profile）。
- 不把 DSH 用于非分析类自主执行（写文件、跑命令）。
