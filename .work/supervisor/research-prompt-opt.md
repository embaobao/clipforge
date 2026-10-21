# 调研: ClipForge「快速优化提示词」能力路径

日期: 2026-10-21 · 只读调研, 未改任何业务代码。
盟哥原话: 『还有这个快速优化提示词的能力』。

---

## 1. 现状 (src/ 实装盘点)

### 1.1 模板/提示词相关已落地的件

| 件 | 位置 | 实装程度 |
|---|---|---|
| `clipboard.editor.render_template` MCP | `src-tauri/src/mcp/dispatch_agent_editor.rs:290` | ✓ 已上线。`{{key}}` 变量替换, 纯字符串 replace, 无校验无注册表 |
| `clipboard.editor.suggest_update` MCP | 同上 `:314` | ✓ 已上线。纯本地规则 (extract_hash_tags + smart-format 修复), contentPatch 可为 null, **不经过 LLM** |
| `clipboard.skill.save_draft` MCP | 同上 `:23` | ✓ 半上线。草案信封带 `promptTemplate` 字段; `skill.list` 恒返回空数组 (frontend-local-private 契约, 前端存储侧未实装) |
| `ClipboardPrivateSkill` 契约 | `src/services/contracts/agent-contracts.ts:106` | 仅类型定义: `{ name, promptTemplate, defaultContextMode, outputActions }`。无 UI、无注册表、无消费方 |
| pi 单次补全 | `src/agent/pi/provider-config.ts:50` `piComplete`; `stream.ts:21` `piStream` | ✓ 可用。system+prompt→助手消息, provider 经 `agent_resolve_pi_provider` 运行时解析 (key 不落前端明文) |
| AI 分析条 (摘要+标签) | `src/agent/pi/analysis.ts:55` `analyzeClipWithPi`; UI `src/workspace/components/PiAnalysisBar.tsx` | ✓ 端到端跑通的范本: 按钮→piComplete→JSON 解析→「应用标签」走 `update_clip_record` 写回。这是「复制→AI→回写」链路的现成模板 |
| 详情页插件区 | `src/workspace/components/detail/plugin-zone.tsx` | ✓ 落位在 tags 行右侧 ⌕ 下拉, AI 功能内置第一项, 队列并发 2, 草稿产出路由已定 |
| 写回链 | `src/clipboard/use-clip-writeback.ts:267` `updateClipContent`、`:309` `pasteClip` | ✓ 条目内容改写 + 复制 + 粘贴回原应用, 全部现成 |
| 本地建议生成器 | `src/editor/suggestions.ts` `buildLocalEditorSuggestion` | ✓ contentPatch(preview+replacement)+tagPatch+riskLevel 的建议信封形状, 应用前不写库 |

### 1.2 没有的东西

- **没有任何提示词模板注册表**: 内置/插件/用户三层覆盖结构只存在于提案, 代码为零 (`src-tauri/src/` 下无 `plugin_runtime/`, 无 `templates/`)。
- **没有任何提示词优化逻辑**: 全仓 `rg '优化提示'` 仅命中一处设计 mock (`openspec/changes/detail-page-information-architecture/docs/layout-v4-compare.html:266`, 「AI 插件支持配置: …优化提示词…」含 `{{content}}/{{kind}}/{{tags}}` 变量编辑)——且该 v4 边界工具条形态在 proposal 里已被否决删除, 未实装。
- MCP 40 条工具 (`src-tauri/src/mcp/mod.rs:293` golden 断言 `specs.len() == 40`) 中无 optimize 类工具。
- pi 侧 Agent 工具 (`src/agent/pi/tools.ts`) 刻意只读 (`clipboard_search` / `clipboard_read_latest`), 写回类不进 Agent 工具面。

### 1.3 MCP `clipboard.agent.run` 现状

`dispatch_agent_run` (`dispatch_agent_editor.rs:177`) 是 **prepare-only**: 返回 `status: "prepared"` + `execution: "not-started"` + `requiresConfirmation`, 不自动起 run。外部 Agent 想「优化一段文本」现在只能把结果经 `editor.apply_patch/save` 逐次 confirm 写回——链路通, 但没有针对提示词的工具臂。

---

## 2. 提案覆盖度 (agent-plugin-runtime Phase 4)

来源: `openspec/changes/agent-plugin-runtime/{proposal,tasks,design}.md` + `specs/prompt-template-management/spec.md` (前身 `archive/2026-10-10-agent-self-evolution/` 同 spec 迁入, 3.1/3.2 任务未勾选)。

Phase 4 定义 (tasks.md 32–35 行):
- 4.1 模板注册表 (内置+插件) 与用户覆盖层, Agent 对话模板选择器接入
- 4.2 设置页「提示词模板」分区: 查看/编辑 (含变量占位符校验)/导出/导入

接口面 (design §4/§7, API_REFERENCE §4):
- `ctx.register.template({ name, text, variables? })`, 命名空间 `plugin.<包名>.<名>`
- manifest `slots.templates[]`; 独立注册类型, 不属 UI 插槽
- 消费者矩阵: 对话模板选择器 (前端 pi) + 模板分区 (设置页)
- spec 场景: 用户覆盖内置模板可恢复; 插件卸载后引用降级为默认模板

**覆盖度判定: Phase 4 管的是「模板放哪、谁能改」, 不是「谁来改写提示词」。** 它提供注册表/覆盖层/变量校验/选择器四件地基, 但整个提案族 (含前身 agent-self-evolution) 都没有定义优化引擎本身——「快速优化提示词」作为端到端用户能力, **目前无任何提案覆盖**, 只在被否决的 v4 mock 里出现过一次字样。结论: 落地此能力 = Phase 4 的模板槽位 (可后置) + 一个尚未立项的「重写引擎」切片, 后者才是本体。

---

## 3. 业界做法与剪贴板场景适配

场景约束: 复制一段提示词 → 一键优化 → 粘贴回去。交互路径秒级、单次、人在环确认。

### 3.1 四种主流做法

| 做法 | 代表 | 机制 | 适配 ClipForge? |
|---|---|---|---|
| **模板变量槽位** | VAPO 的 prompt template、各类 prompt registry | 结构化模板 + `{{var}}` 填充 | ✓ 高。Phase 4 正是这个; `render_template` 臂已有一半。适合「优化风格/目标模型」可复现, 但单独不构成「优化」 |
| **单次 AI 重写** | Anthropic Console prompt improver、OpenAI Playground optimizer | 元提示词 (角色/明确化/格式约束) 一次改写 | ✓✓ 最高。`piComplete` + 内置优化元提示 = 一次调用, 延迟可接受, 与 PiAnalysisBar 交互完全同构 |
| **规则引擎评分+重写混合** | mcp-prompt-optimizer (GitHub) | Layer1 确定性规则 (模糊词替换/角色注入/格式强制) 打分, 过阈值直接返回, 不过才 LLM 补弱项 | ✓ 中高。零 API、<5ms, 与 `buildLocalEditorSuggestion` 的本地规则先例同形; 但 v1 可省, 作为「无 provider 配置时的降级层」 |
| **Eval 驱动迭代循环 (darwin 式)** | EvalGuard (4 变异策略+meta-LLM 打分)、DSPy MIPRO、Vertex VAPO 数据驱动模式 | 需 50–200 条 eval 集, 多变体×多轮评测, 成本封顶 | ✗ 不适配交互剪贴板路径。这是离线批处理, 单任务 10 轮×N 评测的 token/时延量级与「复制→粘贴回去」矛盾。可留作二期插件/后台任务 |

### 3.2 适配结论

剪贴板场景的最优组合 = **单次 AI 重写为主 + 槽位模板为载体 + 确认式写回为出口**:
1. 优化元提示词按「5-slot brief」骨架内置 (目标/约束/验收/上下文/输出格式, 参考 claude-prompt-optimizer 的槽位法)——它本身就是一段模板, Phase 4 注册表落地后自然迁入, 用户可改可覆盖。
2. 重写走 `piComplete` 单次调用, 结果走已有 `contentPatch` 建议信封 (preview→diff→确认→`updateClipContent`/复制)。
3. 评分循环不进交互链路; 若日后要, 挂到插件运行时 (Phase 2 工具插槽) 做异步任务, 不占热路径——与提案性能红线一致。

---

## 4. 最快落地路径

**路线 A (推荐): 内置 AI 动作「优化提示词」, 纯前端 pi 面, 零 Rust 零 golden 变更。**

改动清单 (估 1–2 天工作量):
1. `src/agent/pi/` 新增 `prompt-optimizer.ts`: 内置优化元提示常量 + `optimizePromptWithPi(item, providerConfig)`, 照抄 `analysis.ts` 的 provider 解析/降级/截断形态 (内容截 4000 字符同款)。
2. `PiAnalysisBar.tsx` (或插件区下拉新条目) 加「优化提示词」按钮: 调上函数 → 产出 `EditorSuggestionResult` 形 contentPatch → 既有 diff 预览 → 确认后 `updateClipContent` 写回或一键复制。**所有出口件都是现成的, 不新增写通道。**
3. i18n 两个 key (zh-CN/en-US)。

为何最快: 不碰 `specs.rs` 40 条冻结契约 (加 MCP 工具须 specs.rs + `mcp/mod.rs` golden 计数 + `verify-mcp-dispatch.mjs` 三处同步); 不等 plugin_runtime (Phase 1 spike 尚未启动, tasks.md 全未勾选); provider 未配置/失败降级 UI 已有范式。

**路线 B (随后, 外部 Agent 可用): MCP 臂 `clipf.analyze` 扩展或新增 `clipboard.prompt.optimize`。** 走三处同步 + additive 门禁, 等 A 验证交互形态后再做。

**路线 C (二期): 优化模板迁入 Phase 4 注册表。** 用户可编辑优化元提示、覆盖内置、插件贡献「面向某模型的优化模板」; 变量校验由 4.2 承接。A 的内置常量届时改读注册表即可, 前端调用点不动。

**明确不做**: darwin 式评分循环进交互链路; 剪贴板热路径自动优化 (性能红线: AI 永不阻塞采集与面板唤起)。

---

## 5. 风险与缺口备忘

- Phase 4 与插件运行时绑定 (Phase 1–3 未完, spike 时间盒 1 周未起): 若盟哥要的是「模板管理」本体, 可先做「内置模板+用户覆盖层」最小注册表脱离插件面走 settings_service 原子写模式, 但这是第二切片, 不与 A 冲突。
- `ClipboardPrivateSkill` 契约悬空 (前端存储未实装): 若做 A 时顺手把「优化后模板存为私有技能」补上, 可激活这条已设计未通电的链, 但建议单独立项避免范围膨胀。
- 内容出境: 优化即把剪贴板全文送 provider 调用, 与既有 AI 分析同面同险, 无新增授权需求 (设置页 provider 已是闸)。

## 6. 证据索引

- 提案: `openspec/changes/agent-plugin-runtime/tasks.md:32-35`、`design.md:157,227,242`、`specs/prompt-template-management/spec.md`、`docs/API_REFERENCE.md:70-75,154`、`openspec/changes/archive/2026-10-10-agent-self-evolution/`
- 现状: `src-tauri/src/mcp/dispatch_agent_editor.rs:177,290,314`、`src-tauri/src/mcp/specs.rs:348,360`、`src-tauri/src/mcp/mod.rs:293` (40 条 golden)、`src/agent/pi/{tools,analysis,stream,provider-config}.ts`、`src/editor/suggestions.ts`、`src/workspace/components/{PiAnalysisBar.tsx,detail/plugin-zone.tsx}`、`src/clipboard/use-clip-writeback.ts:267,309`
- 业界: github.com/yusufkucukates/mcp-prompt-optimizer (规则+混合)、evalguard.ai (4 策略 eval 循环)、github.com/shinyay/claude-prompt-optimizer (5-slot brief)、cloud.google.com Vertex VAPO (零样本 vs 数据驱动两档)、Anthropic Console / OpenAI Playground (单次重写)
