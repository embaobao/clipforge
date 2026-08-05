# 设计：Mastra Agent Runtime 评估

## 1. 当前 Agent 边界

ClipForge 当前 Agent 能力分为三层：

| 层 | 当前形态 | 边界 |
| --- | --- | --- |
| Settings Service | `agent.providers[]`、redaction、provider readiness | 只负责配置、schema、revision、脱敏与状态 |
| MCP tools | `clipf.agent.*`、剪贴板工具、设置工具 | 外部 Agent 的协议入口，不耦合 UI 状态 |
| UI surfaces | Agent panel、详情页 AI 摘要、Provider JSON 模板 | 辅助能力，不能阻塞 quick panel 热路径 |

Mastra 如果引入，只能成为 Agent runtime 的一层候选实现，不能替代 Settings Service / MCP tool / quick panel。

## 2. Mastra 能力映射

| Mastra 能力 | 可映射到 ClipForge | 风险 |
| --- | --- | --- |
| `Agent` | 详情页 AI 辅助、Agent workbench、上下文解释 | 不应接入 quick open / quick paste |
| `tools` | 调用现有 `clipf.*` MCP/Tauri 工具 | 需要 capability 白名单和审计日志 |
| `memory` | Agent 会话记忆、工作区上下文 | 不能存剪贴板正文或敏感 provider key |
| `workflows` | 离线摘要、批量整理、演示素材生成 | 调度失败不能影响剪贴板监听 |
| `evaluations` | Agent 输出质量评估 | 后置开发工具，不进用户热路径 |
| storage | LibSQL/SQLite 等 | 需和现有 SQLite/Settings Service 明确边界 |
| standalone/serverless | sidecar 或 dev runtime | 打包、签名、冷启动和常驻内存成本待测 |

## 3. 集成形态评估

### 3.1 不推荐：WebView 内直接运行

原因：

- 会增加主前端 bundle 与启动成本。
- runtime/memory/workflow 状态容易进入 React UI 热路径。
- Secret 与工具权限边界难以审计。

### 3.2 不推荐：Rust 主进程同步调用 Node runtime

原因：

- Node sidecar 的冷启动、IPC 和 provider timeout 都可能拖慢 Tauri command。
- 主进程职责会从剪贴板/窗口/权限扩展到 Agent orchestration，维护成本上升。

### 3.3 可评估：可选 sidecar / workbench runtime

候选结构：

```text
Quick panel ────────────────┐
Clipboard / Settings Service ├── Rust commands / MCP tools
Agent workbench ────────────┘
             │
             └── optional Mastra sidecar（可关闭、可旁路、失败可降级）
```

约束：

- sidecar 不随 quick panel 同步启动。
- provider readiness、model list、workflow 调度必须异步。
- 失败时只影响 Agent workbench，不影响剪贴板监听、搜索、复制、粘贴。
- 工具调用必须走 MCP/Tauri capability 白名单，不允许 runtime 直接读写任意文件或设置。

### 3.4 保留现状：不引入 Mastra

如果 POC 数据显示冷启动/内存/打包/签名成本过高，保持现有 OpenAI-compatible provider + MCP tools + Settings Service，继续把 Agent 能力做成轻量控制面。

## 4. POC 测量项

| 类别 | 指标 | 门槛 |
| --- | --- | --- |
| quick panel | `panel.open`、`quick.scroll`、`quick.select`、`quick.copy`、`quick.paste` P95 | 不允许因 Mastra POC 退化 |
| runtime | sidecar cold start、warm start、first token、provider failure timeout | 必须有可复现实测数据 |
| 内存 | idle RSS、一次 workflow 后 RSS | 必须和无 runtime baseline 对比 |
| 打包 | bundle 体积、签名/notarization、离线启动 | 不能破坏 Tauri release 包 |
| 安全 | API key redaction、tool allowlist、日志脱敏 | 不得记录 secret / prompt / output / 剪贴板正文 |
| UX | 设置页 provider 配置复杂度、失败状态 | 300ms 内给出 pending/error |

## 5. 与现有提案关系

| 提案 | 处理 |
| --- | --- |
| `ai-model-plugin-productization` | Mastra 只作为 runtime 候选，不替代 capability / provider / AIOutput 定义 |
| `vercel-ai-sdk-integration` | 继续作为模型调用 SDK 候选；Mastra 可能在更上层编排，但不能绕过 provider 边界 |
| `local-model-quick-integration` | 本提案可吸收其“本地 runtime / API key 导入 / 对话面板”评估部分，先补 tasks/spec 后再决定是否保留 |
| `external-hook-plugin-runtime` | Hook runtime 关注上下文 collector；Mastra tools 只能调用已允许的 hook/tool，不直接拥有写入能力 |

## 6. 决策门

进入 POC 前必须回答：

1. Mastra 是否作为可选 sidecar，而非主 WebView/主进程依赖？
2. POC 是否能证明 quick panel hot path 不退化？
3. 打包签名和离线启动是否能接受？
4. Settings Service 是否仍是 provider secret 的唯一写入/脱敏边界？
5. 工具调用是否能通过 MCP/Tauri capability 白名单审计？

任一答案为否，则不引入 Mastra，只保留本提案作为评估记录。
