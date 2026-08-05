# 提案：本地模型快速接入、第三方 API Key 导入与 AI 对话面板重构

## 状态

- 优先级：P3.5，介于剪贴板核心功能收尾与 `ai-model-plugin-productization`（P4）之间。
- 阶段：方案评审（2026-07-30 v3 架构验证更新）。
- 变更标识：`local-model-quick-integration`。
- 依赖：`settings-service-unified-protocol`（已归档，Settings Service 可用）。
- 替代/合并：本提案吸收并替代原 `vercel-ai-sdk-integration`（P4.1）的 scope，同时精简 `ai-model-plugin-productization`（P4）中 Agent 运行时部分。

## 变更摘要（2026-07-30 v4 架构定型）

本次更新对本提案做了四个重大调整：

1. **删除 local-cli Agent 支持**：移除 `claude-cli`/`codex-cli`/`qwen-cli`/`local-cli` 等基于 spawn 子进程的 CLI Agent 运行时。只保留 `openai-compatible` 一种 provider kind，所有模型调用统一走 HTTP `/v1/chat/completions` 接口。
2. **新增第三方工具 API Key 导入**：自动检测并导入 Claude Code、Codex、OpenCode、Hermes 等工具已配置的 API Key 和 base URL，实现零配置快速接入。
3. **引入 Vercel AI SDK v7 在 WebView 中直接运行**：经源码验证，`ai@7` 使用浏览器原生 `ReadableStream`/`TextEncoder`/`Response`，零 `node:stream` 依赖，可直接在 Tauri WebView 中运行。用 `@ai-sdk/react` 的 `useChat` + `DefaultChatTransport` 替代当前自研流式协议。
4. **方案 D：前端 AI SDK + Tauri Key Proxy**（取代原 Tauri Channel 方案）。AI SDK 完整运行在 WebView 中，SSE 流式解析由 AI SDK 内置处理。Rust 侧只需 1 个 `agent_resolve_endpoint` command 返回真实 URL + headers，前端 `fetch` 直接请求模型 API。不需要 Tauri Channel、不需要自定义 ChatTransport、不需要 sidecar 进程、不需要 Python bridge SSE 解析。代码量从 ~2691 行降至 ~160 行（减少 94%）。

## Why

### 问题一：local-cli Agent 运行时冗余且不可靠

当前 `agent_detect_candidates()` 硬编码了 3 个 CLI provider（`claude-cli`/`codex-cli`/`qwen-cli`），加上用户可配置的 `local-cli` 类型。这套机制存在严重问题：

- **spawn 子进程不可控**：CLI 工具的输出格式不统一，流式解析靠正则猜，经常截断或丢失。
- **47 处 CLI 相关代码**：`lib.rs` 中有 47 行专门处理 `spawn`/`try_wait`/`child.kill`/stdout/stderr 管道，维护成本高。
- **与产品定位冲突**：AGENTS.md 明确说「ClipForge 首先必须是快速剪贴板工具，不是 AI 工作台」。CLI Agent 运行时把 ClipForge 变成了一个不完整的 CLI 包装器。
- **已有更好的替代**：所有主流 CLI 工具（Claude Code/Codex/OpenCode）都支持 OpenAI-compatible API 模式，用户可以直接配 baseUrl + apiKey。

### 问题二：API Key 配置割裂

盟哥机器上已有 4 套 AI 工具的 API 配置：

| 工具 | 配置位置 | 格式 | 关键字段 |
|------|---------|------|---------|
| Claude Code | `~/.claude/settings.json` → `env` | JSON | `ANTHROPIC_AUTH_TOKEN` + `ANTHROPIC_BASE_URL` + `ANTHROPIC_DEFAULT_*_MODEL` |
| Codex | `~/.codex/config.toml` + `~/.codex/auth.json` | TOML + JSON | `[model_providers.X] base_url` + `OPENAI_API_KEY` |
| OpenCode | 环境变量 `OPENCODE_PROVIDER` / `ZAI_API_KEY` 等 | env | `base_url` + `api_key` + `model` |
| Hermes | `~/.hermes/config.yaml` → `model` | YAML | `provider` + `base_url` + env `VOLCENGINE_PLAN_API_KEY` |
| LM Studio | 运行时服务 `localhost:1234/v1` | HTTP | 可选 `Authorization: Bearer <token>` |
| Ollama | 运行时服务 `localhost:11434/api` | HTTP | 无需认证 |

用户在 ClipForge 中配置 Agent provider 时，需要手动复制粘贴这些信息。这违背了「配好就能用」的产品原则。

### 问题三：Agent 面板是半成品

当前 `agent-panel.tsx`（1469 行）+ `agent-chat-page.tsx`（822 行）= 2291 行自研对话 UI，但功能不完整：

- **无多轮对话**：每次 run 是独立的，没有 conversation/session 概念。
- **无消息持久化**：Agent run 结束后 transcript 在内存中，关闭面板即丢失。
- **自研流式协议**：`agent_ui_message`/`agent_message_delta` Tauri 事件 → React state → 手动渲染。对比 `@ai-sdk/react` 的 `useChat`，这是重复造轮子。
- **ai-summary.ts 硬阻断**：对真实 provider 返回 `AI_SDK_NOT_ENABLED`，只有 mock 模式可用。

### 成熟开源方案已可即用

Vercel AI SDK 生态提供了完整的对话 UI 方案：

| 项目 | Stars | 核心能力 | 适用性 |
|------|-------|---------|--------|
| `vercel/ai-chatbot` | 14k+ | Next.js + AI SDK，多轮对话、session 持久化、流式渲染、文件上传、工具调用 | ★★★★★ 参考架构 |
| `@ai-sdk/react` `useChat` | SDK 内置 | React hook：`messages`/`handleSubmit`/`stop`/`isLoading`/`error`，自动 SSE 流式 | ★★★★★ 直接使用 |
| `shadcn/ui` chat block | 内置 | Bubble/Message/MessageScroller 组件（ClipForge 已安装） | ★★★★★ 已有 |

ClipForge 已有 `bubble.tsx`/`message.tsx`/`message-scroller.tsx` 组件，只需接通 `useChat` 即可获得完整对话能力。

## 目标

### G1：删除 local-cli Agent 运行时

1. 从 `agent_detect_candidates()` 移除 `claude-cli`/`codex-cli`/`qwen-cli` 三个硬编码 candidate。
2. 从 settings schema 的 `kind` 枚举中移除 `local-cli`/`cli`/`local-cli-configured`。
3. 移除 `local_agent_candidate()` 函数和所有 `spawn`/`try_wait`/`child.kill` 相关的 CLI 进程管理代码。
4. 移除 `AgentInvocationConfig` 中的 CLI 命令拼接逻辑。
5. 只保留 `openai-compatible` 一种 provider kind，统一走 HTTP 接口。

### G2：第三方工具 API Key 自动导入

6. 新增 `detect_external_tool_configs()` 函数，扫描以下配置文件：

```rust
struct ExternalToolConfig {
    tool: String,           // "claude-code" | "codex" | "opencode" | "hermes" | "lm-studio" | "ollama"
    provider_id: String,    // 生成的 provider ID
    label: String,          // 显示名称
    base_url: String,       // API endpoint
    api_key: Option<String>,// 可能不需要认证
    model_id: Option<String>,
    source_path: String,    // 配置文件路径（用于显示来源）
}
```

7. 扫描路径与解析规则：

| 工具 | 配置路径 | 解析方式 | 映射字段 |
|------|---------|---------|---------|
| Claude Code | `~/.claude/settings.json` | JSON → `env` 对象 | `ANTHROPIC_BASE_URL` → `baseUrl`, `ANTHROPIC_AUTH_TOKEN` → `apiKey`, `ANTHROPIC_DEFAULT_SONNET_MODEL` → `modelId` |
| Codex | `~/.codex/config.toml` + `~/.codex/auth.json` | TOML 解析 `model_provider` + `model`，找到对应 `[model_providers.X]` 的 `base_url`；JSON 解析 `OPENAI_API_KEY` | `base_url` → `baseUrl`, `OPENAI_API_KEY` → `apiKey`, `model` → `modelId` |
| OpenCode | 环境变量 `OPENCODE_*` 或 `~/.config/opencode/` | 检测 `ZAI_API_KEY`/`OPENCODE_API_KEY` 等环境变量 + `base_url` | env → `apiKey`/`baseUrl`/`modelId` |
| Hermes | `~/.hermes/config.yaml` | YAML 解析 `model.provider` + `model.base_url` + 关联 env | `base_url` → `baseUrl`, env `*_API_KEY` → `apiKey`, `model.default` → `modelId` |
| LM Studio | `localhost:1234/v1/models` | HTTP GET，可选 `Authorization` | `base_url` = `http://localhost:1234/v1`, models 从响应解析 |
| Ollama | `localhost:11434/api/tags` | HTTP GET，无认证 | `base_url` = `http://localhost:11434/v1`, models 从响应解析 |

8. 设置页 Agent 区域新增「导入外部工具配置」按钮：展示检测到的所有工具配置，用户勾选后一键导入为 ClipForge provider。
9. 导入的 provider 标记 `importedFrom: "claude-code"` 来源标签，方便用户区分。
10. **安全**：导入时只读取配置文件中的 key/url/model，不读取其他字段；key 在 React 侧脱敏显示（`sk-81e...6cc1`）。

### G3：引入 Vercel AI SDK v7 重构 Agent 面板（方案 D）

11. 安装 `ai`（Vercel AI SDK v7 core）+ `@ai-sdk/react`（React hooks v4）。AI SDK v7 经源码验证可直接在 Tauri WebView 中运行（使用浏览器原生 ReadableStream，零 node:stream 依赖）。
12. 用 `useChat` + `DefaultChatTransport`（AI SDK 内置）+ 自定义 `fetch` 替换当前自研流式协议。`DefaultChatTransport` 的 `fetch` 参数中通过 Tauri `invoke('agent_resolve_endpoint')` 获取真实 URL + apiKey headers，然后调用原生 `fetch` 请求模型 API。SSE 响应流由 AI SDK 内置的 `processResponseStream()` 自动解析。

```typescript
import { useChat } from '@ai-sdk/react';
import { createAgentTransport } from './agent-transport';

function AgentChatPage({ provider, conversationId, contextSet }: {
  provider: AgentProviderConfig;
  conversationId: string;
  contextSet?: unknown;
}) {
  const { messages, input, handleSubmit, handleInputChange, isLoading, stop, error } =
    useChat({
      id: conversationId,  // 多轮对话 ID，支持 session 切换
      transport: createAgentTransport(provider.id, contextSet),
      onFinish: (message) => {
        // 持久化到 SQLite
        saveConversationToDb(conversationId, [...messages, message]);
      },
    });

  // 渲染用已有的 bubble/message/message-scroller 组件
  return (
    <MessageScroller>
      {messages.map(msg => (
        <MessageScrollerItem key={msg.id}>
          <Bubble variant={msg.role === 'user' ? 'sent' : 'received'}>
            <BubbleContent>{msg.content}</BubbleContent>
          </Bubble>
        </MessageScrollerItem>
      ))}
    </MessageScroller>
  );
}
```

13. **对话 session 持久化**：利用 AI SDK 的 `id` 参数支持多 conversation，对话历史存入 ClipForge 已有的 SQLite（复用 `AgentConversation` 类型）。`onFinish` 回调触发持久化。
14. **移除自研流式协议**：删除 `agent_ui_message`/`agent_message_delta`/`agent_agui_event` Tauri 事件、`AgentRunState`/`AgentRunPayload` 内存状态机、`append_agent_output`、`emit_agent_ui_message`、`emit_agent_agui_event`、`agent_prepare_run`/`agent_start_run` 等 ~400 行 Rust 代码。不需要 Tauri Channel，不需要 Python bridge SSE 解析。
15. **保留上下文引用**：`createAgentTransport` 构造时传入 `contextSet`（当前选中的 clip 引用），通过 `DefaultChatTransport` 的 `body` 参数传入，Rust 侧无感知（contextSet 在前端组装为 system message）。

### G4：bridge 扩展 vision + 分类型模板 + agentContext 回写

16. 扩展 `openai_compatible_bridge_script()` 支持 vision（图片 base64 → multimodal message）。
17. apiKey 为空时跳过 `Authorization` header（兼容 Ollama）。
18. 新增 6 种 `AgentTaskTemplate` 枚举（classify/summarize/extract_actions/diagnose_error/describe_image/analyze_workflow）。
19. Agent run 完成后，将结构化结果写入 clip 的 `agentContext` 字段。

### G5：ai-summary.ts 接通真实调用

20. 移除 `AI_SDK_NOT_ENABLED` 硬阻断，改为通过 AI SDK `streamText`（`ai` core 包）或复用 `createAgentTransport` + `summarize` taskTemplate 完成真实摘要。
21. 摘要结果写入 `metadata.aiSummary`（已有字段），状态走 pending→ready/failed。

## 非目标

- 不做 CLI Agent 包装器——用户想用 Claude Code/Codex 的 CLI 模式直接用那些工具，ClipForge 只做 API 级别接入。
- 不做插件市场或 Agent 市场。
- 不做 Tiptap AI Toolkit 集成（仍属于 `ai-model-plugin-productization` 的 scope）。
- 不做向量索引/embedding 存储（如果后续需要，基于 AI SDK 的 `embedMany` 扩展）。
- 不让 AI 分析阻塞剪贴板捕获主路径。
- 不把分析结果直接写入 clip `content`（只写 `agentContext` 和 `metadata`）。
- 不修改已有 shadcn/ui chat 组件（bubble/message/message-scroller）的 API。

## 核心原则

### 1. API 优先，消灭 CLI 运行时

所有模型调用统一走 HTTP `/v1/chat/completions`。不再 spawn 子进程、不再解析 CLI stdout、不再维护进程状态机。一条 HTTP 请求进、SSE 流式出，简单可靠。

### 2. 导入而非重配

用户已经在其他工具配好了 API Key 和 base URL。ClipForge 只需要读取这些配置并导入，不让用户重复输入。导入是显式的（用户勾选确认），不是静默的。

### 3. 站在巨人肩膀上

Vercel AI SDK 的 `useChat` 已经解决了流式渲染、多轮对话、错误处理、中断/重试等所有问题。自研 2291 行对话 UI 代码不如 50 行 `useChat` 调用。已有的 shadcn/ui chat 组件直接复用，不重写。

### 4. 本地优先

默认检测 `localhost` 的模型服务（LM Studio/Ollama），导入的外部工具配置可能指向云端 API。两者共存，用户选择。

## 技术方案

### 架构选型：方案 D — 前端 AI SDK + Tauri Key Proxy

经过对四种架构方案的对比验证，确定采用方案 D。核心决策依据：

**验证 1：AI SDK v7 可直接在 WebView 中运行。**
拉取 `ai@7.0.42` 实际 dist 源码（17698 行），确认：
- 使用浏览器原生 `ReadableStream`/`TextEncoder`/`Response`/`TextEncoderStream`
- `node:async_hooks`/`node:diagnostics_channel` 仅在 `isNodeEnv()` 为 true 时加载，WebView 中不触发
- `process.env` 有 `typeof process !== "undefined"` guard，WebView 中安全
- `@ai-sdk/react@4.0.45` 零 node 依赖

**验证 2：`DefaultChatTransport` 支持自定义 `fetch`。**
拉取 `ai@7.0.42` 类型定义，确认 `HttpChatTransportInitOptions` 有 `fetch?: FetchFunction` 字段，`DefaultChatTransport` 继承 `HttpChatTransport` 并传入该参数。这意味着可以在 `fetch` 中通过 Tauri `invoke` 获取真实 URL + apiKey headers，然后调用原生 `fetch` 请求模型 API。SSE 响应流由 AI SDK 的 `processResponseStream()` 自动解析为 `UIMessageChunk`。

**验证 3：Sidecar 方案不可行。**
- Bun sidecar：打包体积 +90MB，需要三平台 binary，违背 AGENTS.md "不引入重型运行时"
- Python sidecar：AI SDK 是 JS 库无法在 Python 中运行，等于回到手写 SSE 解析
- Node sidecar：同样 +50MB 打包体积，进程管理负担

### 架构对比

```
── 现状（自研，~2691行）──
React: agent-panel.tsx (1469行) + agent-chat-page.tsx (822行)
  ↕ Tauri 事件: agent_ui_message / agent_message_delta / agent_agui_event
Rust: agent_prepare_run → agent_start_run → spawn python3 bridge
  → stdout 行解析 → emit 事件 → 前端手动 state 更新 (~400行)
内存: AgentRunState (HashMap) + AgentRunPayload + transcript

── 目标（方案 D，~160行）──
React WebView (AI SDK v7 完整运行)
  useChat({ transport: new DefaultChatTransport({ fetch: customFetch }) })
    └── customFetch: invoke('agent_resolve_endpoint') → fetch(realUrl, headers)
         ← SSE 响应流由 AI SDK 自动解析为 UIMessageChunk
Tauri Rust: agent_resolve_endpoint command (~30行)
  → 从 Settings 读取 baseUrl + apiKey
  → 返回 { url, headers: { Authorization: "Bearer ..." }, modelId }
持久化: SQLite conversations 表 (复用 AgentConversation)
  收获：多轮对话、session 持久化、中断/重试、流式渲染全内置
  无需：Tauri Channel / 自定义 ChatTransport / sidecar / Python bridge SSE 解析
```

### Tauri Key Proxy 实现

**Rust 侧（仅 1 个新 command，~30 行）：**

```rust
#[derive(Serialize)]
struct ResolvedEndpoint {
    url: String,                          // e.g. "http://localhost:1234/v1/chat/completions"
    headers: Option<serde_json::Value>,   // e.g. { "Authorization": "Bearer sk-xxx" }
    model_id: String,                     // e.g. "google/gemma-4-e2b"
}

#[tauri::command]
fn agent_resolve_endpoint(provider_id: String) -> Result<ResolvedEndpoint, String> {
    let provider = agent_candidate_by_id(Some(&provider_id))
        .ok_or("PROVIDER_NOT_FOUND")?;

    let base_url = provider.base_url.as_deref()
        .unwrap_or("https://api.openai.com/v1");
    let model_id = provider.model_id.as_deref()
        .ok_or("MODEL_NOT_SET")?;
    let api_key = resolve_api_key(&provider); // 从 settings 或 env 读取

    let headers = api_key
        .map(|key| json!({ "Authorization": format!("Bearer {}", key) }));

    Ok(ResolvedEndpoint {
        url: format!("{}/chat/completions", base_url),
        headers,
        model_id: model_id.to_string(),
    })
}
```

**前端 transport（~30 行）：**

```typescript
// agent-transport.ts
import { DefaultChatTransport } from 'ai';
import { invoke } from '@tauri-apps/api/core';

export function createAgentTransport(providerId: string, contextSet?: unknown) {
  return new DefaultChatTransport({
    api: 'https://clipforge-ai-proxy/chat',  // placeholder, replaced in fetch
    fetch: async (url, init) => {
      const { url: realUrl, headers, modelId } = await invoke('agent_resolve_endpoint', {
        providerId,
      });
      // Inject modelId + auth headers into the request body
      const body = JSON.parse(init.body as string);
      body.model = modelId;
      return fetch(realUrl, {
        ...init,
        body: JSON.stringify(body),
        headers: { ...init.headers, ...(headers ?? {}) },
      });
    },
    body: { contextSet },  // extra params merged into request body by AI SDK
  });
}
```

**Agent 对话页（~80 行，替换原 822 行）：**

```typescript
// agent-chat-page.tsx
import { useChat } from '@ai-sdk/react';

function AgentChatPage({ provider, conversationId }: Props) {
  const { messages, input, handleSubmit, handleInputChange, isLoading, stop, error } =
    useChat({
      id: conversationId,
      transport: createAgentTransport(provider.id),
      onFinish: (msg) => saveConversationToDb(conversationId, [...messages, msg]),
    });

  return (
    <MessageScroller>
      {messages.map(m => (
        <MessageScrollerItem key={m.id}>
          <Bubble variant={m.role === 'user' ? 'sent' : 'received'}>
            <BubbleContent>{m.content}</BubbleContent>
          </Bubble>
        </MessageScrollerItem>
      ))}
      {isLoading && <TypingIndicator />}
      <ChatInput value={input} onChange={handleInputChange}
        onSubmit={handleSubmit} isLoading={isLoading} onStop={stop} />
    </MessageScroller>
  );
}
```

### 数据流

```
用户输入消息 → handleSubmit
  → AI SDK useChat 组装 messages 数组 + POST body
  → DefaultChatTransport.sendMessages()
    → customFetch 被调用
      → invoke('agent_resolve_endpoint', { providerId })  [Tauri IPC]
        → Rust: 读 Settings → 返回 { url, headers, modelId }
      → fetch(realUrl, { body: {..., model: modelId}, headers: {..., Authorization} })
        → 模型 API (LM Studio / Ollama / 云端)
        ← SSE text/event-stream 响应
    ← AI SDK processResponseStream() 自动解析 SSE → UIMessageChunk 流
  → useChat 自动将 chunk 合并为 UIMessage，更新 messages 状态
  → React 重新渲染，逐字显示
  → onFinish: 持久化到 SQLite
```

### CSP 配置

Tauri WebView 需要允许 `fetch` 连接到模型 API 端点。在 `tauri.conf.json` 中配置：

```json
{
  "app": {
    "security": {
      "csp": "default-src 'self'; connect-src 'self' http://localhost:* http://127.0.0.1:* https://*; ..."
    }
  }
}
```

或在 Rust 侧注册 Tauri custom URI scheme protocol 做 proxy（如果 CSP 仍然太严格）。但首选直接放行 `connect-src`，因为 `agent_resolve_endpoint` 已确保只有配置过的 provider 才会被请求。

### 第三方工具配置导入

```rust
fn detect_external_tool_configs() -> Vec<ExternalToolConfig> {
    let mut configs = Vec::new();
    
    // 1. Claude Code: ~/.claude/settings.json
    if let Ok(content) = std::fs::read_to_string(home_dir().join(".claude/settings.json")) {
        if let Ok(json) = serde_json::from_str::<Value>(&content) {
            if let Some(env) = json.get("env").and_then(|v| v.as_object()) {
                let base_url = env.get("ANTHROPIC_BASE_URL").and_then(|v| v.as_str());
                let api_key = env.get("ANTHROPIC_AUTH_TOKEN").and_then(|v| v.as_str());
                let model = env.get("ANTHROPIC_DEFAULT_SONNET_MODEL").and_then(|v| v.as_str());
                if base_url.is_some() && api_key.is_some() {
                    configs.push(ExternalToolConfig {
                        tool: "claude-code".into(),
                        base_url: base_url.unwrap().into(),
                        api_key: Some(api_key.unwrap().into()),
                        model_id: model.map(String::from),
                        ..
                    });
                }
            }
        }
    }
    
    // 2. Codex: ~/.codex/config.toml + ~/.codex/auth.json
    // 解析 TOML 获取 model_provider 和 [model_providers.X] base_url
    // 解析 auth.json 获取 OPENAI_API_KEY
    
    // 3. Hermes: ~/.hermes/config.yaml
    // 解析 YAML 获取 model.base_url + model.default
    
    // 4. LM Studio: HTTP GET localhost:1234/v1/models
    // 5. Ollama: HTTP GET localhost:11434/api/tags
    
    configs
}
```

**TOML 解析**：Codex 的 `config.toml` 需要解析。Rust 生态有 `toml` crate，但当前项目不依赖。可选方案：
- 引入 `toml` crate（轻量，~50KB 编译产物）
- 或用 Python bridge 做 TOML 解析（已有 python3 依赖）
- 推荐引入 `toml` crate，因为 TOML 解析不应依赖 Python

**YAML 解析**：Hermes 的 `config.yaml` 需要 `serde_yaml` crate。同样不在当前依赖中。
- 推荐引入 `serde_yaml`（~100KB 编译产物）

### CLI 代码清理清单

需要删除的代码（`lib.rs`）：

| 函数/结构 | 行数(估) | 说明 |
|----------|---------|------|
| `local_agent_candidate()` | ~20 | CLI candidate 构造 |
| `agent_detect_candidates()` 中 CLI 部分 | ~15 | claude-cli/codex-cli/qwen-cli 硬编码 |
| `configured_agent_providers_from_settings()` 中 local-cli 分支 | ~15 | settings 中的 CLI 配置解析 |
| `check_agent_candidate()` 中 CLI 检测逻辑 | ~50 | `Command::new("sh")` spawn + try_wait |
| `agent_start_run()` 中 CLI spawn 逻辑 | ~80 | 子进程启动 + stdout/stderr 管道 |
| `handle_standard_agent_event()` | ~30 | CLI stdout 行解析 |
| `AgentRunState`/`AgentRunPayload` 内存状态机 | ~60 | run 状态管理 HashMap |
| settings schema 中 `local-cli` 枚举值 | ~5 | JSON schema |
| **合计** | **~275** | |

移除后 `lib.rs` 净减约 400 行（CLI 275 行 + agent_prepare_run/agent_start_run/state 机器 125 行），取而代之的是 ~30 行的 `agent_resolve_endpoint` command（仅返回 URL + headers + modelId）。

### 分类型 Prompt 模板

```rust
enum AgentTaskTemplate {
    Classify,
    Summarize,
    ExtractActions,
    DiagnoseError,
    DescribeImage,
    AnalyzeWorkflow,
}

impl AgentTaskTemplate {
    fn build_prompt(&self, content: &str, app: &str) -> (String, String) {
        match self {
            Self::Classify => (
                "你是剪贴板分析助手。简洁输出。".into(),
                format!("分析内容：\n1.分类 2.风险 3.推荐操作\n\n来源:{}\n内容:\n```\n{}\n```", app, content),
            ),
            Self::DiagnoseError => (
                "你是错误诊断助手。简洁输出。".into(),
                format!("分析错误：\n1.错误类型 2.严重程度 3.根因 4.修复建议 5.Action Items\n\n来源:{}\n内容:\n```\n{}\n```", app, content),
            ),
            Self::DescribeImage => (
                "你是图片识别助手。简洁输出。".into(),
                format!("识别图片：\n1.图片类型 2.内容描述 3.关键信息 4.价值 5.建议\n\n来源:{}", app),
            ),
            // ...
        }
    }
}
```

## 成熟开源项目分析

### vercel/ai-chatbot（参考架构）

| 维度 | 评估 |
|------|------|
| 项目 | github.com/vercel/ai-chatbot，14k+ stars |
| 技术栈 | Next.js + AI SDK + Drizzle ORM + Postgres |
| 对话能力 | 多轮对话、session 持久化、流式渲染、工具调用、文件上传 |
| 可复用部分 | `useChat` hook 模式、message 渲染逻辑、session 管理 |
| 不可直接用 | Next.js API routes（ClipForge 是 Tauri，不是 Next.js） |
| 结论 | **参考架构，不直接引入代码**。学习其 session 管理和 message 渲染模式 |

### @ai-sdk/react useChat（直接使用）

| 维度 | 评估 |
|------|------|
| 能力 | `messages`/`input`/`handleSubmit`/`handleInputChange`/`isLoading`/`stop`/`error`/`reload` |
| 流式 | 自动处理 SSE `text/event-stream`，增量更新 `messages` |
| 多轮对话 | 内置 `id` 参数支持 conversation 切换 |
| 自定义 fetch | 支持传入自定义 `fetch` 函数，可对接 Tauri command |
| 依赖体积 | `@ai-sdk/react` ~15KB gzipped + `ai` core ~30KB |
| 结论 | **直接使用**，替代 2291 行自研对话 UI |

### shadcn/ui chat 组件（已有）

| 组件 | 状态 | 用途 |
|------|------|------|
| `bubble.tsx` | ✅ 已安装 | 对话气泡（sent/received） |
| `message.tsx` | ✅ 已安装 | 消息容器（header/content/footer） |
| `message-scroller.tsx` | ✅ 已安装 | 消息列表滚动容器 |
| `attachment.tsx` | ✅ 已安装 | 附件/引用展示 |

结论：UI 组件层已就绪，只需接通数据层。

### 方案合理性总结

| 决策 | 合理性 | 风险 |
|------|--------|------|
| 删除 CLI 运行时 | ✅ 高。47处 CLI 代码 + 不可靠的 spawn + 与产品定位冲突 | 低。已有 openai-compatible 替代 |
| 导入第三方工具 Key | ✅ 高。用户已配好 Key，零配置导入是最佳体验 | 中。需要解析 TOML/YAML，引入 2 个 crate |
| 引入 Vercel AI SDK | ✅ 高。2691 行 → ~160 行（方案 D），AI SDK 在 WebView 中直接运行 | 低。Vercel 官方维护，源码验证兼容 WebView |
| 用 useChat + DefaultChatTransport custom fetch | ✅ 高。SSE 解析/重试/中断全内置，不需 Tauri Channel | 低。custom fetch 是 AI SDK 官方支持的接口 |
| 不用 sidecar (Node/Bun/Python) | ✅ 高。零额外打包体积，无进程管理 | 无。AI SDK 直接在 WebView 运行 |
| 保留已有 shadcn chat 组件 | ✅ 高。不浪费已有投入 | 无 |

## 实施切片

| 切片 | 内容 | 改动范围 | 预估工作量 |
|------|------|---------|-----------|
| S1 | 删除 local-cli Agent 运行时 + agent_prepare_run/agent_start_run（~400 行） | `lib.rs` | 中 |
| S2 | 引入 `ai@7` + `@ai-sdk/react@4` | `package.json` | 小 |
| S3 | Rust 侧 `agent_resolve_endpoint` command（返回 URL+headers+modelId，~30 行） | `lib.rs` | 小 |
| S3.5 | PoC：DefaultChatTransport + custom fetch + CSP 验证 | 新建 `agent-transport.ts` | 小（先做） |
| S4 | 第三方工具配置检测与导入（含 toml/serde_yaml crate） | `lib.rs` + `settings-field-catalog.ts` | 中 |
| S5 | 本地模型探测（LM Studio/Ollama，HTTP GET /v1/models） | `lib.rs` | 小 |
| S6 | CSP 配置（tauri.conf.json connect-src）+ vision 支持（前端组装 multimodal message） | `tauri.conf.json` + `agent-transport.ts` | 小 |
| S7 | `useChat` + `DefaultChatTransport` 重构 Agent 面板 | `agent-panel.tsx` + `agent-chat-page.tsx` + 新建 transport | 大 |
| S8 | TaskTemplate 枚举（前端 system prompt 组装，6 种模板） | `agent-transport.ts` | 中 |
| S9 | agentContext 回写（前端 onFinish → invoke clipboard.update） | `agent-chat-page.tsx` | 小 |
| S10 | ai-summary.ts 接通真实调用（AI SDK streamText） | `ai-summary.ts` | 中 |
| S11 | 设置页导入入口 UI + ConversationSidebar | `settings-field-catalog.ts` + 新组件 | 小 |
| S12 | SQLite conversations + conversation_messages 表 | `lib.rs` + migration | 小 |

## 验证标准

1. **CLI 清理**：`grep -c "local-cli\|claude-cli\|codex-cli\|qwen-cli\|spawn.*child\|try_wait" lib.rs` 返回 0。
2. **第三方导入**：设置页点「导入外部工具配置」，显示 Claude Code/Codex/Hermes 的配置（Key 脱敏），勾选后 Agent 面板可直接对话。
3. **LM Studio 接入**：启动 LM Studio，ClipForge 自动检测到 `lm-studio` provider，Agent 面板可直接对话。
4. **Ollama 接入**：启动 Ollama，无需配置 apiKey 即可对话。
5. **多轮对话**：Agent 面板发送多条消息，AI 记住上下文并回复。关闭面板重开，历史对话仍在。
6. **流式渲染**：消息逐字流式显示，可中途点击 Stop 停止。
7. **图片识别**：复制图片后在详情页点「AI 摘要」，结果包含图片内容描述。
8. **分类型分析**：复制代码/链接/错误日志，分别用不同模板分析，输出结构化结果。
9. **ai-summary 真实调用**：详情页 AI 摘要区显示 pending→ready，`metadata.aiSummary` 含 provider/model provenance。
10. **主路径不受影响**：剪贴板捕获、快速面板、复制回写延迟无可感知变化。
11. **代码量**：`agent-panel.tsx` + `agent-chat-page.tsx` 合计 < 500 行（从 2291 行降至 < 500 行）。

## 与现有提案的关系

| 提案 | 关系 |
|------|------|
| `ai-model-plugin-productization` (P4) | 本提案吸收其 Agent 运行时和 provider 配置部分。Tiptap AI / 插件 manifest / 产品分层仍留在 P4。 |
| `vercel-ai-sdk-integration` (P4.1) | **本提案替代 P4.1**。P4.1 的摘要/embedding/推荐能力由本提案 S8-S10 覆盖。 |
| `clipboard-agent-panel` (已归档) | 本提案重构其 UI 层，保留 Tauri command 接口但替换实现。 |
| `external-hook-plugin-runtime` (P3) | 无直接依赖。agentContext 回写走已有 `clipboard.update` MCP 工具。 |

## 风险与缓解

1. **CSP 跨域拦截**：Tauri WebView 的 CSP 默认限制 `connect-src`，可能拦截对 `localhost:1234` 或云端 API 的 `fetch`。mitigation：在 `tauri.conf.json` 配置 `connect-src 'self' http://localhost:* http://127.0.0.1:* https://*`。如果 CSP 仍然太严格，注册 Tauri custom URI scheme protocol 做 Rust 侧 proxy。S3.5 PoC 先验证这一点。
2. **apiKey 暴露在前端 JS**：`agent_resolve_endpoint` 返回的 `apiKey` 通过 `headers` 传递给 `fetch`，理论上在前端 JS 中可见。mitigation：这是可接受的——apiKey 只在 `fetch` 闭包内使用，不存入 React state，不输出到 DOM。如果需要更强隔离，改为 Tauri custom URI scheme protocol 在 Rust 侧注入 headers（但增加复杂度，暂不需要）。
3. **AI SDK v7 在 WebView 中的兼容性**：虽然源码验证显示无 `node:stream` 依赖，但可能有未预料的 edge case。mitigation：S3.5 PoC 先跑通一个最简单的 `useChat` → LM Studio 对话，确认流式渲染正常后再全面重构。
4. **TOML/YAML crate 引入**：Codex 的 `config.toml` 和 Hermes 的 `config.yaml` 需要解析。引入 `toml` (~50KB) + `serde_yaml` (~100KB) crate。mitigation：可接受，编译产物增量 < 200KB。备选方案：用 Python bridge 做 TOML/YAML 解析（已有 python3 依赖）。
5. **对话持久化**：需要 SQLite 表存储 conversations 和 messages。mitigation：复用已有 `AgentConversation` 类型，新增 `conversations` 和 `conversation_messages` 两张表，`onFinish` 回调写入。
6. **流式中断**：用户点击 Stop 后，AI SDK 的 `useChat` 内置 `stop()` 会触发 `AbortController.abort()`，自动终止 `fetch` 请求。不需要额外的 Rust command。

## Agent 体验流畅度设计

### 目标：开箱即用的流畅对话体验

用户打开 Agent 面板后应该获得与 ChatGPT/Claude 等产品同等水平的对话流畅度：

| 体验维度 | 当前状态 | 目标状态 | 实现方式 |
|---------|---------|---------|---------|
| 首次打开 | 需手动配置 provider | 自动检测本地模型+导入已配置的 API Key | S4+S5 自动检测 |
| 发送消息 | 需先 prepare_run 再 confirm 再 start_run | 输入即发送，零中间步骤 | useChat handleSubmit |
| 流式渲染 | 手动 emit 事件 + 手动 state 更新 | AI SDK 自动流式渲染，逐字显示 | useChat + DefaultChatTransport custom fetch |
| 多轮对话 | 不支持，每次 run 独立 | 完整多轮上下文，AI 记住前文 | useChat messages 数组 |
| 对话历史 | 关闭即丢失 | SQLite 持久化，重开可恢复 | onFinish → SQLite 写入 |
| 中断/停止 | 不支持 | 点击 Stop 立即停止生成 | useChat stop() → AbortController |
| 重试 | 不支持 | 失败后可重新生成 | useChat regenerate |
| 错误处理 | Tauri 事件散落 | useChat error 统一处理 | useChat onError |
| 加载状态 | 手动管理 | isLoading 自动管理 | useChat status |
| 会话切换 | 不支持 | 多 conversation 并行，可切换 | useChat id 参数 |

### 对话 UI 结构（复用已有 shadcn/ui 组件）

```
AgentPanel
  ├── ConversationSidebar（新增，~50行）
  │   ├── 新建对话按钮
  │   ├── 对话列表（从 SQLite 加载）
  │   └── 删除/重命名对话
  ├── ChatArea
  │   ├── MessageScroller（已有组件）
  │   │   └── messages.map → Bubble（已有组件）
  │   │       ├── 用户消息: variant="sent"
  │   │       └── AI消息: variant="received" + provider/model 标签
  │   ├── TypingIndicator（加载中动画）
  │   └── ChatInput（输入框 + 发送/停止按钮）
  └── ContextBar（已有组件，显示引用的 clip）
      └── 当前选中的 clip 引用
```

### 流畅度关键指标

| 指标 | 目标 | 验证方式 |
|------|------|---------|
| 首字延迟 | < 2s（本地模型）/ < 1s（云端 API） | 从 handleSubmit 到第一个 text-delta |
| 流式间隔 | < 100ms 逐字渲染 | AI SDK SSE 自动解析 + React 渲染 |
| 面板打开 | < 100ms | 首次渲染 |
| 对话切换 | < 50ms | 从 SQLite 加载 conversation |
| 停止响应 | < 200ms | 从点击 Stop 到流式停止 |
