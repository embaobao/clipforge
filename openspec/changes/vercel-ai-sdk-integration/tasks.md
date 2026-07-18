# 任务：AI SDK 接入与智能摘要推荐

## Phase 0：文档与依赖确认

- [ ] Context7 额度恢复后重新执行 `npx ctx7@latest library "Vercel AI SDK" "<完整问题>"`
- [ ] 拉取 AI SDK 当前 install、React hooks、`generateText` / `streamText`、structured output、tool calling 文档
- [ ] 拉取 OpenAI-compatible provider 当前配置文档
- [ ] 确认 `ai`、`@ai-sdk/react`、provider 包和 `zod` 的实际版本范围
- [x] 更新 `proposal.md` 中未确认或过时的 API/版本假设

## Phase 1：边界与数据模型

- [x] 定义 `ClipAiSummary`
- [x] 定义 `ClipAiEmbedding` 或 `vectorRef` 边界
- [x] 定义 AI job 状态：idle / pending / ready / failed
- [x] 定义 provenance 字段：providerId、modelId、generatedAt、jobId
- [x] 明确第一阶段不全量自动摘要、不扫描完整历史

## Phase 2：Provider 适配

- [x] 从 Settings Service 读取 redacted provider profile
- [x] 明确前端不接触明文 API key
- [ ] 实现 OpenAI-compatible provider 调用边界
- [x] 未配置 provider 时返回可解释状态
- [x] provider 调用日志只记录 metadata，不记录 prompt/output 全文

## Phase 3：摘要服务

- [x] 新增 summary service
- [x] 支持单条 clip 手动生成摘要
- [x] 支持详情页重新生成摘要
- [x] 支持摘要失败状态和重试
- [x] 摘要结果不覆盖原始内容

## Phase 4：相似推荐

- [x] 定义推荐候选范围：最近历史 / 收藏 / 当前搜索结果
- [x] 定义无 embedding store 时的降级策略
- [x] 支持基于当前 clip 推荐相似条目
- [x] 推荐 UI 显示依据和跳转入口
- [x] 推荐失败不影响详情页和主列表

## Phase 5：UI 集成

- [x] 详情页新增 AI 摘要区
- [x] 列表项显示 AI 摘要状态图标或 tag
- [x] 右键或动作菜单提供生成摘要入口
- [x] 相似推荐显示为详情页辅助区，不挤占主列表
- [x] 所有可见文案接入 i18n

## Phase 6：验证

- [x] `pnpm exec tsc --noEmit` 通过
- [x] `pnpm run check:i18n` 通过
- [x] `pnpm build` 通过
- [x] `cd src-tauri && cargo check` 通过
- [x] 使用 mock provider 验证 pending / ready / failed 状态
- [ ] `pnpm tauri dev` 验证未配置 provider 不影响主面板
- [ ] `pnpm tauri dev` 验证真实 OpenAI-compatible provider 可生成摘要
- [ ] 验证日志不包含 prompt/output 全文

### 状态记录（2026-07-16）

- 已将 `proposal.md` 优先级收敛为 P4.1，并把依赖清单、版本范围和 AI SDK API 示例标记为待 Context7 / 官方文档确认，不能作为安装命令或实现依据。
- 已重新执行 `npx ctx7@latest library "Vercel AI SDK" "ClipForge vercel-ai-sdk-integration: need current install packages, React hooks, generateText, streamText, structured output, tool calling, OpenAI-compatible provider configuration, logging boundaries for metadata-only logs"`：失败，Context7 返回 `Monthly quota exceeded. Create a free API key at https://context7.com/dashboard for more requests.`；因此 Phase 0 文档拉取和真实 SDK/provider 调用继续保持未完成。
- 已在 `design.md` 明确定义 `ClipAiSummary`、`ClipAiEmbedding` / `vectorRef`、AI job 状态、provenance、第一阶段不全量自动摘要和不扫描完整历史。
- 已在 `design.md` 明确定义相似推荐候选范围为最近历史 / 收藏 / 当前搜索结果，并补充无 embedding store 时基于 tags、keyPoints、category、host、sourceApp、payloadKind、plainText/searchText 的降级策略。
- Phase 0 的 Context7 文档拉取、依赖版本确认仍被 quota 阻塞；真实 OpenAI-compatible provider 调用、真实 provider 和 Tauri dev 验证仍未实现，本轮不勾选。

### 实现记录（2026-07-16）

- 已新增 `src/services/ai-summary.ts`：摘要服务先读取 `settingsService.agent.providers()` 的 redacted provider 摘要，前端不接触明文 API key、prompt 或完整输出；未配置 provider、provider 类型不支持、SDK 未启用都会返回可解释 failed 状态。
- 已新增详情页 `DetailAiSummaryPanel`：用户可手动触发摘要任务，UI 先进入 pending，再显示失败原因和重试入口；摘要状态只保存在组件状态或读取已有 `clip.metadata.aiSummary`，不覆盖原始剪贴内容。
- 已补齐中英文 i18n 文案，`pnpm exec tsc --noEmit`、`pnpm check:i18n`、`pnpm build` 与 `cd src-tauri && cargo check` 已通过；`pnpm build` 生成本地未签名 DMG，`cargo check` 仅保留既有 unused/dead_code warnings。
- 由于 Context7 quota 仍阻塞，当前没有安装或调用 Vercel AI SDK，也没有真实 OpenAI-compatible provider 调用；因此不勾选真实 provider 调用、真实 provider 和 Tauri dev 验证项。

### 实现记录（2026-07-16，mock provider / 本地推荐）

- 已在 `src/services/ai-summary.ts` 增加 `VITE_CLIPFORGE_AI_MOCK=1` 本地 mock provider：可返回 `pending -> ready` 摘要结果，`VITE_CLIPFORGE_AI_MOCK_FAILURE=1` 可覆盖 failed 状态；真实 SDK 仍未安装、未调用。
- 已实现 `findSimilarClipRecommendations()`：只基于当前详情上下文候选、tags、host、payloadKind、source、关键词和收藏权重做本地推荐，不扫描完整历史、不读取文件正文。
- 已在详情页 AI 摘要区内展示“相关剪贴”辅助列表，并复用详情页导航回调跳转；该 UI 不进入主列表，不影响搜索、复制、粘贴和详情编辑。
- 已在列表行显示 `metadata.aiSummary` 状态图标，并在右键菜单增加“生成 AI 摘要”入口；生成动作写入 `metadata.aiSummary`，不覆盖原始剪贴内容。
- 已新增 `scripts/verify-ai-summary.mjs` 并接入 `pnpm test:unit`，验证 mock provider、pending/ready/failed 渲染、推荐 UI、列表状态标识、右键生成入口、i18n key 和无真实 AI SDK 调用边界；已通过 `node scripts/verify-ai-summary.mjs`、`pnpm check:i18n`、`pnpm exec tsc --noEmit`、`pnpm openspec validate vercel-ai-sdk-integration --strict`。
- 仍未勾选：Context7 文档拉取、真实 OpenAI-compatible provider 调用、provider 日志 metadata-only 的真实链路、真实 provider Tauri dev 验证。

### 实现记录（2026-07-16，OpenAI-compatible metadata-only boundary）

- 已在 `src/services/ai-summary.ts` 增加 OpenAI-compatible provider 调用准备边界：只基于 Settings Service 的 redacted provider profile 生成 metadata-only 状态，字段包含 `jobId`、`providerId`、`providerKind`、`modelId`、`status`、`errorCode`、`blockedReason`、`createdAt`、`durationMs`；不接收 prompt、clip 正文、输出正文或明文 apiKey，不发起网络请求。
- 真实 AI SDK 仍未安装、未调用；SDK 缺失路径继续返回 `AI_SDK_NOT_ENABLED`。因此不勾选 Context7、依赖版本确认、真实 provider 调用、真实 provider Tauri dev 验证，也不勾选“实现 OpenAI-compatible provider 调用边界”作为完整真实调用。
- 已更新 `scripts/verify-ai-summary.mjs`：源码断言 `generateText` / `streamText` / `fetch` 不存在，runtime 断言 OpenAI-compatible boundary 和 SDK blocked 摘要结果均为 metadata-only，且替换后的 `fetch` 未被调用；已通过 `node scripts/verify-ai-summary.mjs`、`pnpm exec tsc --noEmit`。
- “provider 调用日志只记录 metadata”仍暂不勾选：本轮可证明 SDK-blocked boundary 与现有摘要完成日志不包含 prompt/output 正文，但真实 provider 全链路日志尚未实现和验证。

### 实现记录（2026-07-16，详情摘要信息增强）

- 已增强 `src/workspace/ai-summary-panel.tsx`：详情页摘要区现在会展示 key points、category、provider/model provenance 和 generatedAt，避免摘要结果只停留在一行文本。
- 已同步 `src/workspace/ai-summary-panel.css` 与中英文 i18n 文案；`scripts/verify-ai-summary.mjs` 已补齐对 key points 与 provenance 元素的断言。

### 实现记录（2026-07-16，metadata-only 日志边界）

- 已新增 `getClipAiSummaryLogMetadata()` / `getClipAiSummaryErrorLogMetadata()`，AI 摘要完成、失败和失败态写入失败日志只记录 `clipId/jobId/status/provider/model/errorCode/blockedReason/generatedAt/durationMs/errorName`。
- `generateAiSummaryForClip()` 不再把 `String(error)` 写入 `ai-summary:*` 日志；`scripts/verify-ai-summary.mjs` 已覆盖 ready、SDK blocked 和 error 三类日志元数据，断言不泄露 prompt、output、clip 正文、URL 或 API key 字段。
