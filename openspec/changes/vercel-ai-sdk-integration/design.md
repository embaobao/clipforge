# 设计：AI SDK 接入与智能摘要推荐

## 1. 当前状态

该 change 当前只有 `proposal.md`，且涉及 Vercel AI SDK。按项目规则，本轮已尝试使用 Context7 拉取当前文档，但返回月额度超限：

```text
Monthly quota exceeded. Create a free API key at https://context7.com/dashboard for more requests.
```

因此本设计不确认具体最新 API 签名、版本号或包名。进入实现前必须恢复 Context7 额度并重新确认 `ai`、`@ai-sdk/react`、OpenAI-compatible provider、structured output 和 tool calling 的当前文档。

## 2. 产品边界

- AI 摘要和推荐是增强能力，不进入剪贴板采集、搜索、复制、粘贴热路径。
- 默认不对所有历史自动生成摘要；第一阶段只允许手动触发或详情页明确触发。
- 所有 AI 输出都必须有 provenance，不能覆盖用户原始内容。
- 未配置 provider 时 UI 显示可用状态和配置入口，不报错、不阻塞主流程。
- 与 `ai-model-plugin-productization` 的长期能力包保持兼容，但本提案只做最小 AI SDK service 层和两个用户能力：摘要、相似推荐。

## 3. 架构分层

```text
UI surface
  Detail AI Summary
  Similar Clips Panel
  Batch Action Menu
    |
AI Service
  providerAdapter
  summaryService
  recommendationService
  aiJobQueue
    |
Provider boundary
  Settings Service provider profile
  OpenAI-compatible provider
  Local CLI fallback (later)
```

React UI 不直接持有 API key、baseURL 或 provider secret。Provider 配置从 `settings-service-unified-protocol` 的 redacted provider profile 读取；实际调用由 Tauri/Rust 或受控 service 层完成。

## 4. 数据模型

建议扩展 clip metadata：

```ts
type ClipAiSummary = {
  status: "idle" | "pending" | "ready" | "failed";
  oneLine?: string;
  keyPoints?: string[];
  tags?: string[];
  category?: string;
  providerId?: string;
  modelId?: string;
  generatedAt?: number;
  errorCode?: string;
};

type ClipAiEmbedding = {
  status: "idle" | "pending" | "ready" | "failed";
  modelId?: string;
  generatedAt?: number;
  vectorRef?: string;
  errorCode?: string;
};
```

第一阶段不建议把完整 embedding vector 直接塞进 localStorage 记录；如果没有 SQLite/vector store，就先只做同 session 或小规模最近记录推荐，或保存 `vectorRef` 为后续迁移留边界。

## 5. 任务执行

- AI job 必须异步执行。
- 每个 job 有 `jobId`、`clipId`、`providerId`、`purpose`、`createdAt`。
- UI 300ms 内显示 pending 状态，不等待网络模型完成。
- 同一个 clip 的重复摘要请求需要去重或允许用户显式重新生成。
- 失败只影响当前 AI 卡片，不影响详情页编辑、复制、保存。

## 5.1 相似推荐候选与降级

第一阶段推荐候选范围限定在用户当前上下文，不做全库后台扫描：

| 候选范围 | 触发条件 | 说明 |
|----------|----------|------|
| 最近历史 | 详情页打开当前 clip | 取最近 N 条本地历史，排除当前条目和已删除条目 |
| 收藏 | 当前 clip 有标签、host、sourceApp 或用户显式打开推荐区 | 收藏条目权重更高，但不自动读取文件正文 |
| 当前搜索结果 | 用户从搜索结果进入详情页 | 只在当前搜索结果集合内做重排，不扩大到完整历史 |

无 embedding store 时的降级策略：

1. 优先使用 AI summary 的 `tags`、`keyPoints`、`category` 做关键词匹配。
2. 同 `host`、`sourceApp`、`payloadKind`、`subKind` 加权。
3. 没有 AI summary 时使用现有 `plainText/searchText/title/tags` 做轻量匹配。
4. 所有推荐都只显示为详情页辅助区；失败或空结果不影响列表、搜索、复制、粘贴和详情编辑。

如果后续引入 SQLite/vector store，本提案只保存 `vectorRef` 或索引引用，不把完整 embedding vector 放进 React state 或 localStorage。

## 6. 安全与隐私

- 默认只发送当前用户明确选择的 clip。
- 批量摘要必须展示将处理的条目数量。
- 不发送完整历史、收藏、文件路径列表，除非用户明确选择并确认。
- 日志禁止记录 prompt/output 全文，只记录 jobId、providerId、modelId、durationMs、status 和错误码。

## 7. 与其他提案关系

- 依赖 `settings-service-unified-protocol` 提供 provider profile、redaction、health check。
- 与 `clipboard-agent-panel` 共享 provider 能力，但不要求重写 Agent 面板。
- 与 `ai-model-plugin-productization` 的 AI 能力包、插件化和 MCP 工具面保持上位兼容；本提案是更小的可交付切片。
- 与 `app-internationalization-en-support` 共享所有可见文案 key。

## 8. 验证策略

- Context7 恢复后先验证依赖 API 与安装命令。
- 使用 mock provider 或本地 fake service 验证 UI 状态。
- 使用真实 OpenAI-compatible provider 做手动 smoke，但不把外部服务可用性作为构建门禁。
