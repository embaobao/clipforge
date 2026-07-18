# 提案：引入 Vercel AI SDK + 智能摘要与推荐

## 优先级

P4.1。该提案是 AI 能力产品化之后的实现候选切片，必须排在基础剪贴板、设置服务、设置页、主面板减负、多格式剪贴板和 Agent 面板收尾之后。当前只保留方向性方案与边界定义，Context7 文档恢复前不进入 SDK 实装。

## 当前状态

本轮已按项目规则尝试用 Context7 拉取当前文档，但命中月额度超限，暂时不能把具体 API 签名、安装命令或版本号写成已确认事实。这个提案当前只保留方向性方案，进入实现前必须补拉文档并校准依赖版本。

## 背景

当前 ClipForge 在 AI 能力上面临以下问题：

1. **分析能力薄弱**：现有 `analyze_clip()` 基于规则做截断和类型检测，`summary` 只是「前 180 个字符」，没有真正的语义理解。

2. **Agent 架构自研**：当前 Agent 功能通过 Tauri 事件（`agent_ui_message` / `agent_message_delta`）自研流式协议，虽然能跑，但维护成本高，且与社区生态脱节。

3. **缺乏智能推荐**：用户只能通过搜索和收藏找到历史内容，没有「基于当前内容推荐相似剪贴」的能力。

4. **未来扩展受限**：自研协议难以快速接入社区的新能力（工具调用、结构化输出、多模态等）。

同时，ClipForge 已经有了：
- 完整的 Agent Provider 配置体系（CLI / OpenAI-compatible）
- 基于 Tauri 的桌面端架构
- shadcn/ui 风格的 UI 组件体系

引入 Vercel AI SDK 可以：
- 复用现有 Provider 配置，不浪费已有投入
- 用 `useChat` / `streamText` 等标准封装快速开发新功能
- 为未来的工具调用、多模态、Agent 等能力打好基础
- 与 `@shadcn/helpers` 配合实现高质量的开发调试体验

## 目标

1. **引入 Vercel AI SDK**：建立标准化的 AI 能力接入层，兼容现有 Agent Provider 配置。
2. **实现智能摘要**：对剪贴内容生成语义摘要和智能标签，替代现有规则式 summary。
3. **实现相似推荐**：基于向量相似度推荐相关的历史剪贴内容。
4. **保持架构清晰**：AI 能力封装在独立 service 层，UI 不直接依赖 SDK 细节。

## 非目标

- 不重写现有 Agent 面板（保持现有功能可用，逐步迁移）
- 不改变 Provider 的配置格式（向后兼容）
- 不引入服务端，所有 AI 调用仍在本地通过 Provider 完成
- 不做全量自动摘要（默认手动触发，避免成本和性能问题）
- 不做端侧向量数据库（第一阶段用简单的相似度计算或调用 Provider embedding API）

## 技术选型

### 为什么选 Vercel AI SDK 而不是 TanStack AI

| 维度 | Vercel AI SDK | TanStack AI |
|------|--------------|-------------|
| 生态成熟度 | 高，社区最大，GitHub 7k+ star | 中，较新 |
| React 集成 | `useChat` / `useObject` / `useCompletion` 全面 | `useChat` 基础能力 |
| Provider 生态 | 官方支持 OpenAI/Anthropic/Groq 等 10+ | 相对少 |
| 流式协议 | 标准 streamText / streamObject | AG-UI 事件流 |
| 工具调用 | 成熟，`streamText` 原生支持 | 支持但生态较弱 |
| 结构化输出 | `generateObject` / `streamObject` | 有但较新 |
| 与 shadcn 配合 | `@shadcn/helpers/ai-sdk` 官方适配 | 也有适配但功能较少 |

**结论**：Vercel AI SDK 生态更成熟，功能更全面，适合作为 ClipForge 长期的 AI 基础设施。

### 依赖清单（待确认）

```json
{
  "dependencies": {
    "ai": "^4.0.0",
    "@ai-sdk/openai": "^1.0.0",
    "@ai-sdk/react": "^1.0.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@shadcn/helpers": "^1.0.0"
  }
}
```

**说明**：以下包名和版本范围来自早期方向性草案，当前未通过 Context7 或官方文档重新确认，不能作为安装命令或实现依据。进入实现前必须重新拉取 Vercel AI SDK、OpenAI-compatible provider、React hooks、structured output 和 tool calling 文档，并更新本节。

- `ai`：Vercel AI SDK 核心
- `@ai-sdk/openai`：OpenAI-compatible 适配层（用于对接现有 OpenAI-compatible provider）
- `@ai-sdk/react`：React hooks（`useChat` / `useCompletion` 等）
- `zod`：结构化输出的 schema 定义
- `@shadcn/helpers`：开发时的 mock 对话工具（dev only）

## 架构设计

### 整体分层

```
┌─────────────────────────────────────────────────┐
│  UI 层（React 组件）                              │
│  - 摘要展示组件                                    │
│  - 推荐列表组件                                    │
│  - Agent 面板（现有，逐步迁移）                     │
└─────────────┬───────────────────────────────────┘
              │
┌─────────────▼───────────────────────────────────┐
│  AI Service 层（src/services/ai/）                │
│  - aiClient.ts         AI SDK 客户端封装           │
│  - summaryService.ts   摘要生成服务                │
│  - recommendService.ts 推荐服务                    │
│  - providerAdapter.ts  Provider 配置适配           │
└─────────────┬───────────────────────────────────┘
              │
┌─────────────▼───────────────────────────────────┐
│  Vercel AI SDK（ai / @ai-sdk/react）              │
│  - streamText / generateText                      │
│  - streamObject / generateObject                  │
│  - useChat / useCompletion                        │
└─────────────┬───────────────────────────────────┘
              │
┌─────────────▼───────────────────────────────────┐
│  Provider 层（现有 Agent Provider）               │
│  - OpenAI-compatible HTTP                        │
│  - CLI 子进程                                     │
└─────────────────────────────────────────────────┘
```

### Provider 适配策略

**复用现有配置**：用户已配置的 Agent Provider 直接复用，不需要重新配置。

**适配方式**：
1. **OpenAI-compatible 类型**：直接用 `@ai-sdk/openai` 的 `createOpenAI`，传入 baseURL 和 apiKey
2. **CLI 类型**：封装为自定义 Provider，通过 Tauri command 调用 CLI

**自定义 CLI Provider 示例（概念）**：
```typescript
// src/services/ai/providerAdapter.ts
// 注意：这是概念伪代码，API 名称需 Context7 恢复后重新确认。
import { createLanguageModel } from "ai";
import { invoke } from "@tauri-apps/api/core";

export function createCliProvider(providerConfig) {
  return createLanguageModel({
    async doGenerate(options) {
      // 通过 Tauri command 调用现有 CLI provider
      return invoke('agent_generate', {
        providerId: providerConfig.id,
        prompt: options.prompt,
        // ...
      });
    },
    async doStream(options) {
      // 通过 Tauri 事件流式接收
      // ...
    },
  });
}
```

**注意**：第一阶段优先支持 OpenAI-compatible，CLI 类型保持现有 Agent 架构不变，后续逐步适配。

### 数据模型扩展

在 `ClipRecord.metadata` 中新增 AI 相关字段：

```typescript
interface ClipRecord {
  // ... 现有字段
  metadata: {
    // ... 现有字段
    aiSummary?: {
      text: string;           // AI 生成的语义摘要
      tags: string[];         // AI 提取的智能标签
      keyPoints?: string[];   // 关键点列表（可选）
      generatedAt: number;    // 生成时间戳
      model: string;          // 使用的模型
      providerId: string;     // 使用的 provider
      status: 'generating' | 'success' | 'failed';
      error?: string;         // 失败原因
    };
    aiEmbedding?: {
      vector: number[];       // 向量嵌入
      model: string;
      generatedAt: number;
    };
  };
}
```

## 功能设计

### 功能一：智能摘要（Smart Summary）

#### 触发方式

| 触发方式 | 说明 | 默认 |
|---------|------|------|
| 详情页自动 | 打开详情页时，如果没有 AI 摘要，自动生成 | 开启 |
| 列表右键 | 右键菜单「生成摘要」 | 开启 |
| 批量生成 | 多选后批量生成 | 开启 |
| 采集时自动 | 新剪贴内容自动生成 | 关闭（可选） |

#### 摘要内容结构

使用 `generateObject` + zod schema 输出结构化摘要：

```typescript
const summarySchema = z.object({
  oneLine: z.string().describe('一句话概括，不超过 50 字'),
  keyPoints: z.array(z.string()).describe('3-5 个关键点'),
  tags: z.array(z.string()).describe('3-8 个智能标签'),
  category: z.string().describe('内容分类，如：代码/文档/链接/命令/笔记'),
});
```

#### 展示位置

1. **列表项**：
   - 有 AI 摘要的条目显示 ✨ 小图标
   - 悬停时 tooltip 显示一句话摘要
   - AI 标签显示在现有标签区域，用不同颜色区分

2. **详情页**：
   - 顶部增加「AI 摘要」卡片
   - 展示一句话概括、关键点、智能标签
   - 「重新生成」按钮

3. **设置页**（归入「高级 → AI 能力」分类，详见 settings-field-refactor 提案）：
   - `enableSmartSummary`：智能摘要开关（switch，默认关闭）
   - `enableSimilarRecommend`：相似推荐开关（switch，依赖 enableSmartSummary）
   - `enableSemanticSearch`：语义搜索开关（switch，默认关闭）
   - AI 能力状态卡片（status，显示 SDK 安装状态和 Provider 配置状态）
   - 摘要语言跟随系统 language 设置，不单独配置

### 功能二：相似推荐（Similar Recommendations）

#### 推荐逻辑

第一阶段用「AI 摘要 + 关键词匹配」做轻量推荐，不引入向量数据库：

1. 基于 AI 生成的 tags 和 keyPoints 做关键词匹配
2. 同来源（sourceApp / host）加权
3. 同分类（category）加权
4. 按综合相似度排序，取 Top 5

**第二阶段升级**：引入 embedding + 本地向量索引（如 `vectra` 或纯 JS 向量库），做真正的语义相似度。

#### 展示位置

1. **详情页底部**：「你可能还需要」区域，展示 3-5 条相似内容
2. **列表右键**：「查找相似内容」入口
3. **搜索时**：搜索结果底部增加「相关内容推荐」

#### 交互设计

- 点击推荐项直接跳转详情
- 悬停预览内容摘要
- 提供「不感兴趣」反馈（可选，用于未来个性化）

### 功能三：Agent 面板渐进迁移

现有 Agent 面板保持不变，新增的 AI Service 层为未来迁移打下基础：

- 新的 AI 功能（摘要、推荐）先走 AI Service
- 现有 Agent 面板继续用现有 Tauri 事件架构
- 后续逐步将 Agent 面板也迁移到 AI SDK

这样保证：
- 不破坏现有功能
- 新功能用新架构
- 逐步迭代，风险可控

## 开发工具链

### @shadcn/helpers 的使用

作为开发依赖引入，用于：

1. **UI 开发调试**：
   ```typescript
   // 开发时用 mock 数据，不用每次调真实模型
   import { createChat } from '@shadcn/helpers/ai-sdk';
   
   const demoChat = createChat()
     .user('帮我摘要这段代码')
     .assistant(({ writer }) => {
       writer.reasoning('这是一段 React 组件代码...');
       writer.text('这段代码实现了一个...');
     });
   ```

2. **组件测试**：
   - 摘要组件的快照测试
   - 推荐列表的渲染测试
   - 流式输出的动画测试

3. **产品演示**：
   - 预设演示对话，展示效果稳定
   - 录屏/截图时使用，不消耗 token

## 实施阶段

### Phase 1：基础层建设（P0）

**目标**：引入 Vercel AI SDK，打通 Provider 适配，建立 AI Service 层。

**任务**：
- [ ] 安装 `ai` / `@ai-sdk/react` / `@ai-sdk/openai` / `zod`
- [ ] 安装 `@shadcn/helpers`（dev）
- [ ] 创建 `src/services/ai/` 目录结构
- [ ] 实现 Provider 配置读取和适配（优先 OpenAI-compatible）
- [ ] 封装 `generateText` / `streamText` 基础调用
- [ ] 封装 `generateObject` 结构化输出
- [ ] 错误处理和重试机制
- [ ] 单元测试基础能力

### Phase 2：智能摘要（P1）

**目标**：实现剪贴内容的 AI 智能摘要功能。

**任务**：
- [ ] 定义摘要 schema（oneLine / keyPoints / tags / category）
- [ ] 实现摘要 prompt 模板（支持不同内容类型）
- [ ] 实现 `summaryService.generateSummary(clipId)`
- [ ] 摘要结果写入 clip.metadata
- [ ] 详情页 AI 摘要卡片组件
- [ ] 列表项 AI 摘要标识和 tooltip
- [ ] 右键菜单「生成摘要」
- [ ] 多选批量生成摘要
- [ ] 设置页「智能摘要」配置区
- [ ] 加载状态和错误处理 UI

### Phase 3：相似推荐（P1）

**目标**：基于 AI 摘要实现相似内容推荐。

**任务**：
- [ ] 实现关键词匹配推荐算法
- [ ] 实现 `recommendService.findSimilar(clipId, limit)`
- [ ] 详情页底部「你可能还需要」组件
- [ ] 右键「查找相似内容」入口
- [ ] 推荐项点击跳转
- [ ] 空状态和加载状态

### Phase 4：Agent 面板迁移（P2，可选）

**目标**：将现有 Agent 面板逐步迁移到 AI SDK。

**任务**：
- [ ] CLI Provider 适配到 AI SDK
- [ ] Agent 面板状态迁移到 `useChat`
- [ ] 工具调用适配
- [ ] 流式渲染对齐
- [ ] 逐步下线旧的 Tauri 事件架构

## 与现有架构的兼容性

### 向后兼容

- ✅ 现有 Agent Provider 配置完全复用
- ✅ 现有 Agent 面板功能不受影响
- ✅ 现有剪贴板数据结构不变，AI 数据存在 metadata 中
- ✅ 所有新功能默认开关可控，不强制开启

### 渐进式迁移

- 新功能（摘要、推荐）走 AI SDK
- 旧功能（Agent 面板）保持现有架构
- 后续按优先级逐步迁移

## 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| CLI Provider 适配难度大 | 部分用户无法使用新功能 | 第一阶段只支持 OpenAI-compatible，CLI 用户继续用旧 Agent |
| API Key 安全性 | 密钥泄露风险 | 复用现有 Provider 的安全存储机制（Tauri 安全存储），不新增存储方式 |
| 流式渲染与现有 UI 不一致 | 视觉体验不统一 | 封装统一的流式渲染 hook，新旧功能共用 |
| SDK 版本迭代快 | API 变更风险 | 锁定主版本，升级前做兼容性测试 |
| 摘要生成成本 | 用户 token 消耗 | 默认手动触发 + 详情页懒生成，提供用量提示 |
| 向量推荐性能 | 数据量大时卡顿 | 第一阶段用关键词匹配，不做全量向量计算 |

## 成功标准

1. Vercel AI SDK 成功引入，基础调用链路打通
2. 智能摘要功能可用：详情页展示、右键生成、批量生成
3. 相似推荐功能可用：详情页底部推荐列表
4. 复用现有 Provider 配置，用户不需要重新配置
5. 现有 Agent 面板功能不受影响
6. `pnpm build` 通过
7. `cd src-tauri && cargo check` 通过
8. 新功能有明确的开关和设置项

## 参考文档

- [Vercel AI SDK 官方文档](https://sdk.vercel.ai/docs)
- [Vercel AI SDK GitHub](https://github.com/vercel/ai)
- [shadcn/helpers AI SDK 适配](https://ui.shadcn.com/docs/helpers/ai-sdk)
- [现有 Agent 架构代码](../..//src/agent-panel.tsx)
- [现有 Provider 配置](../..//src/services/contracts.ts)
