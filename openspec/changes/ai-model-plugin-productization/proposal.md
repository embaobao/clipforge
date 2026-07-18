# 提案：模型配置、AI 能力增强与插件标品化

## 背景

ClipForge 当前已经有三条相关规划：

- [detail-rich-editor-agent-bridge](../detail-rich-editor-agent-bridge/proposal.md)：详情页紧凑编辑、Tiptap 富文本编辑、AI 建议回填。
- [context-plugin-agent-runtime](../context-plugin-agent-runtime/proposal.md)：上下文快照、插件边界、Agent 运行时、MCP 工具面。
- [clipboard-agent-panel](../clipboard-agent-panel/proposal.md)：悬浮面板里的极简 Agent 调用页。

这些提案已经覆盖“能不能编辑、能不能调用 Agent、能不能安全读取上下文”，但还缺少一个面向产品化和标品化的总方案：

- 用户配置好模型以后，ClipForge 应该提供哪些稳定 AI 能力。
- Tiptap Content AI / AI Toolkit 在详情页里承担什么角色，哪些能力必须自建兜底。
- 插件体系如何把内置动作、脚本、MCP 工具、详情页 AI 能力、Agent Provider 统一成同一种能力模型。
- Agent 是否只是聊天页，还是也应作为插件体系的一种能力形态。
- 这些能力如何拆成可发布、可降级、可收费、可配置、可审计的标准产品包。

本提案只做方案和规划讨论，不进入实现。

## 调研依据

### Context7 状态

按项目规则已先调用 `npx ctx7@latest library Tiptap "<用户完整问题>"`，但当前 Context7 返回：

```text
Monthly quota exceeded. Create a free API key at https://context7.com/dashboard for more requests.
```

因此本轮方案不能声称已通过 Context7 拉取完整当前文档。后续进入实现前必须用 Context7 重新拉取 Tiptap、AI SDK、Tauri、MCP 等库文档。

### Tiptap 官方文档方向

用户指定参考：

- Tiptap GitHub: <https://github.com/ueberdosis/tiptap>
- Tiptap Content AI / AI Toolkit overview: <https://tiptap.dev/docs/content-ai/capabilities/ai-toolkit/overview>

基于官方文档页面的产品语义，本提案暂按以下事实设计，后续实现前需要用 Context7 或官方文档再确认版本细节：

- Tiptap 是基于 ProseMirror 的编辑器框架，适合作为详情页富文本编辑壳。
- Tiptap Content AI / AI Toolkit 面向编辑器内 AI 能力，适合承载编辑器上下文读取、选区操作、生成/改写、工具调用和编辑器动作编排。
- AI Toolkit 属于需要单独接入和配置的增强能力，不应成为 ClipForge 基础剪贴板主路径的硬依赖。
- ClipForge 必须保留自建的紧凑纯文本编辑器、patch preview、权限确认、保存回填和系统剪贴板写回链路，不能把业务真实源交给第三方编辑器实例。

## 目标

1. 定义“配置好模型以后”的标准 AI 能力包：摘要、改写、翻译、标签建议、结构化提取、格式修复、内容生成、详情页编辑建议、剪贴板结果保存。
2. 定义模型配置方案：本地 CLI、OpenAI-compatible、AI SDK provider、本地模型服务、Tiptap AI provider 的统一抽象和优先级。
3. 定义详情页 AI 增强方案：紧凑编辑为基础，Tiptap AI Toolkit 为富文本增强，所有 AI 输出先进入 preview patch。
4. 定义插件体系总模型：内置插件、脚本插件、MCP 插件、面板插件、Agent 插件、Tiptap editor tool 插件共享同一 manifest、权限和调用链。
5. 明确 Agent 是插件体系的一部分：Agent Provider、Agent Skill、Agent Run、Agent 生成插件草稿都作为 plugin capability，而不是独立平台。
6. 定义标品化分层：基础剪贴板工具、AI 编辑增强包、Agent 调用包、插件开发包、MCP 集成包、企业/团队治理包。
7. 明确安全与隐私边界：模型密钥不进前端，默认不发完整历史，危险动作必须预览确认，所有外部能力可禁用、可审计、可回滚。
8. 给出讨论清单，方便先评审产品边界，再进入实现提案拆分。

## 非目标

- 不在本提案里实现 Tiptap、AI Toolkit、Agent Provider 或插件运行时。
- 不把 ClipForge 改造成 AI 工作台、Agent 管理平台、模型网关或插件市场。
- 不默认让 AI 后台自动处理每条剪贴板历史。
- 不允许模型、Agent 或插件绕过 preview/confirm 直接写历史、删历史、执行命令或打开外部目标。
- 不承诺第一版接入 Tiptap Cloud 或任何云端协作能力。
- 不把用户 API key、base URL、provider secret、agent token 暴露给 React UI。
- 不在第一版做复杂计费系统，只定义可产品化的能力边界和开关。

## 用户价值

- 普通用户配置一次模型后，可以在详情页和 Agent 页直接完成“总结、改写、翻译、提取、修复、保存、复制、粘贴”闭环。
- 剪贴板条目可以被 AI 整理为更可用的片段，但所有写回都由用户确认，不破坏快速剪贴板体验。
- 高级用户可以把常用 AI 动作保存为插件，例如“把错误日志整理成 issue 模板”“把 JSON 转成 TypeScript 类型”“把会议纪要改成英文邮件”。
- Agent 不只是聊天框，也可以成为插件能力：一个 Agent plugin 可以读取受控上下文、调用模型、返回 patch、渲染面板、生成新插件草稿。
- 外部 Agent 或 MCP 客户端可以调用 ClipForge 的标准工具，但权限、日志和用户确认由 ClipForge 统一控制。
- 团队或企业用户可以禁用某些 provider、限制网络模型、只允许本地模型、审计插件调用，并保持基础剪贴板功能可用。

## 成功标准

- 有清晰的 `ModelProviderConfig`、`AIModelProfile`、`CapabilityPolicy`、`PluginManifest` 扩展模型。
- 详情页可以区分“本地紧凑编辑能力”和“Tiptap AI 富文本增强能力”，并且后者失败不影响前者。
- Agent Provider、Agent Skill、MCP Tool、Tiptap Tool、脚本动作都能以统一插件 capability 描述。
- 所有 AI 输出都能落到四类结果之一：`previewPatch`、`newClipDraft`、`copyResult`、`renderPanel`。
- 模型配置完成后，用户至少能使用一套默认 AI 能力：总结、改写、翻译、标签建议、结构化提取、保存为新条目。
- 标品化分层能回答“免费版能用什么、AI 增强包是什么、插件体系是什么、企业治理是什么”。
- 后续实现前有明确待讨论问题，不把未决产品策略伪装成已确认需求。

## 与现有提案的关系

| 提案 | 本提案如何补充 |
|------|----------------|
| `detail-rich-editor-agent-bridge` | 增加模型配置、Tiptap AI Toolkit、富文本 AI 能力分层和标品边界 |
| `context-plugin-agent-runtime` | 扩展插件体系，把 Agent Provider / Tiptap Tool / 模型能力纳入统一 capability |
| `clipboard-agent-panel` | 明确 Agent 页只是一个使用插件能力的 UI surface，Agent 本身也可作为 plugin runtime |
| `settings-interface-redesign` | 后续模型配置、provider profile、权限策略应落到设置页信息架构中 |
| `search-filter-tags-filetypes` | AI 生成的 tags、`AI` tag、结构化提取字段应服务于搜索增强 |

## 建议优先级

本提案建议作为 P4.5 或 P5，排在基础剪贴板、详情页编辑、上下文插件运行时和 Agent 面板之后，但在正式接入多个模型 provider 和第三方插件之前完成。

原因：

- 没有稳定剪贴板、详情页编辑、上下文快照和插件权限，模型能力会变成孤立聊天入口。
- 没有模型和插件标品边界，后续很容易把 ClipForge 做成重型 AI 工作台。
- 先讨论完整标品方案，再拆实现，可以避免 Tiptap、AI SDK、MCP、Agent runtime 各自扩张。

## 方案评审结论（2026-07-16）

- 优先级：本提案保留为 P4 / P5 级产品化总方案，不前置到 P0-P3；后续实现必须拆为独立 change，不把模型、Tiptap、插件 V2 和企业治理揉进一次大改。
- 拆分方式：模型 provider / AI 摘要推荐可继续由 `vercel-ai-sdk-integration` 承接；详情页富文本与 Tiptap AI 另拆编辑器增强 change；插件 manifest V2 / Agent capability 另拆插件运行时 change；产品包与企业策略先保持文档化能力门禁。
- 长期原则：Agent 是 plugin capability，不是独立平台。Agent 页、详情页 AI 建议、插件草稿生成都只是调用 Agent capability 的不同 UI surface。
- 第一版标品包：保留 Core Clipboard、AI Edit Pack、Agent Clip Pack、Plugin Builder Pack、Local Privacy Pack、Team Governance Pack 六层；第一版只做 capability gate 和策略解释，不做计费系统。
- 第一版模型接入范围：沿用本地 CLI、OpenAI-compatible、AI SDK provider、本地模型服务、Tiptap AI provider 五类；其中 AI SDK / Tiptap 细节必须等 Context7 恢复后再进入实现。
- Tiptap AI Toolkit：定位为可选增强依赖，不是基础剪贴板和紧凑编辑的硬依赖；未配置、授权失败或加载失败时必须降级到 `CompactClipEditor`。
- 隐私默认值：默认只发送 summary / metadata / selection 摘要；完整正文、文件内容、图片 OCR、跨条目集合和网络模型调用都需要用户显式授权或策略允许。

---

## v2 增量：内部智能推荐与外部 Agent 依赖弱化

> 评估依据：[pi-runtime-evaluation 报告](../archive/2026-07-15-pi-runtime-evaluation/report.md)
> 增量目标：减少对外部 Agent CLI 的依赖，把高频低风险能力优先内化

### 背景

当前 ClipForge 的 Agent 能力依赖外部 CLI（`claude -p`、`codex` 等），存在两个问题：

1. **启动延迟**：每次用户操作都启动外部进程，用户感知延迟
2. **能力不足**：外部 Agent 只能看到当前 clip + 用户输入，无法访问 ClipForge 内部状态

本增量不引入 Pi runtime，而是把"高频能力本地化 + 内部智能推荐"作为过渡方案。

### v2 新增目标

| ID | 目标 | 边界 |
|---|---|---|
| AI-V2-01 | 把摘要、改写、翻译、标签建议、结构化提取、格式修复 6 个能力标记为**可本地化能力** | 优先用本地 LLM / 轻量模型 |
| AI-V2-02 | 引入"内部 provider 优先"策略：高频能力用内部 provider；低频长任务保留外部 CLI adapter | 内部能力失败时可降级到外部 |
| AI-V2-03 | 引入"内部智能推荐"面板：基于场景感知 + 内容分析，在 settings 或主面板给出"建议"列表 | 只读建议，一键应用 |
| AI-V2-04 | 内部推荐结果可直接保存为 snippet / 收藏 / 归档 / 标签，但保存动作走用户显式确认 | 与原提案"四类结果"保持一致 |

### 保持的 hard constraint

- ❌ 模型密钥不进前端
- ❌ 危险动作必须预览确认
- ❌ 不把 ClipForge 改造成 AI 工作台
- ❌ 不允许模型、Agent 或插件绕过 preview/confirm 直接写历史

### 技术要点

1. **Provider 优先级链**：
   ```
   内部 provider（本地 LLM）
   → 内部 provider（云端模型，用户配置）
   → 外部 CLI adapter（fallback）
   ```

2. **延迟预算**：
   - 内部 provider 必须 < 500ms 返回首 token
   - 超过则自动降级到下一级 provider

3. **能力适配层**：
   - 把外部 CLI 的能力（claude -p, codex）映射成 ClipForge 内部 capability
   - 不绑定具体 CLI，后续可替换

### 与其他提案的协同

| 提案 | 协同点 |
|---|---|
| [context-plugin-agent-runtime v2](../context-plugin-agent-runtime/proposal.md) | 场景感知能力作为内部推荐的输入源 |
| [clipboard-agent-panel v2](../clipboard-agent-panel/proposal.md) | Agent 页使用内部 provider 优先策略 |

### 推进顺序

- 本增量在 **P5** 阶段推进
- 前置依赖：
  - P3.5 context-plugin-agent-runtime v2（场景感知能力）
  - P4 clipboard-agent-panel v1 + v2（Agent 页基础设施）
  - P4.5 ai-model-plugin-productization v1（模型配置框架）
