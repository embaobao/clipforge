# 提案：Mastra Agent Runtime 评估

## 状态

- 优先级：P4.x（AI/Agent 后置候选，不进入剪贴板热路径）。
- 阶段：评估提案；不直接引入依赖、不改运行时。
- 变更标识：`mastra-agent-runtime-evaluation`。
- 前置依赖：`frontend-surface-architecture-refactor`（热路径边界）、`ai-model-plugin-productization`、`vercel-ai-sdk-integration`、`local-model-quick-integration`。

## Why

ClipForge 已经具备 Agent provider 配置、MCP 工具暴露、详情页 AI 摘要候选和本地模型接入候选，但这些 proposal 的运行时边界仍然分散。用户提出评估 **Mastra** 作为 Agent runtime，需要先确认它是否真正适合 ClipForge，而不是把一个 TypeScript Agent 框架直接塞进 Tauri 快速剪贴板工具里。

Mastra 提供 Agent、tools、memory、workflows、evaluations、storage、standalone/serverless 等能力，适合构建独立 Agent 服务或应用后端。但 ClipForge 的第一目标仍是快速剪贴板工具：面板打开、滚动选中、复制/粘贴反馈和剪贴板监听不能被 Node/Agent runtime、网络 provider 检测、memory storage 或 workflow 调度拖慢。

本提案把 Mastra 限定为评估对象：先做架构、性能、打包和权限边界验证，再决定是否作为可选 sidecar 或开发期 Agent runtime，而不是默认接入主进程或 WebView。

## What Changes

1. 新增 Mastra runtime 评估 change，明确它与当前 AI/Agent proposal 的关系。
2. 定义评估矩阵：启动/常驻内存、首次响应、工具权限映射、settings/provider secret 边界、离线行为、打包签名、日志与诊断。
3. 定义候选集成形态：
   - **不推荐**：把 Mastra 直接打进主 WebView 或主 Tauri 热路径。
   - **可评估**：Mastra 作为可选 sidecar / dev runtime / Agent workbench runtime。
   - **保留现状**：继续使用现有 Settings Service + MCP tools + OpenAI-compatible provider 边界。
4. 增加 `agent-runtime` spec delta，要求任何 Mastra 集成都必须和 quick panel 热路径隔离。

## 非目标

- 不安装 `@mastra/core` 或相关依赖。
- 不实现 Mastra Agent、tool、workflow 或 storage。
- 不替换现有 MCP 工具协议。
- 不把 Mastra provider 检测、memory 或 workflow 调度接入主面板打开、滚动、选中、复制、粘贴链路。
- 不在设置页增加复杂 Agent 控制台；设置页只保留轻量 provider 配置与状态反馈。

## 成功标准

1. 明确 Mastra 是否值得进入 POC，并给出 yes/no/条件性结论。
2. 如果进入 POC，必须限定为可关闭、可卸载、可旁路的 sidecar/workbench 集成。
3. POC 前必须定义性能门槛：主面板 hot path P95 不退化；Mastra runtime 冷启动、常驻内存、首次响应、provider failure timeout 都有数据。
4. POC 前必须定义安全边界：API key 不出 Settings Service redaction 边界；工具调用必须走 capability 白名单；日志不记录 prompt/output/剪贴板正文/API key。
5. `openspec validate mastra-agent-runtime-evaluation --strict` 通过。
