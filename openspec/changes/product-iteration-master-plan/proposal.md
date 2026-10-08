# 提案:产品持续迭代总纲(Agent 范式 + 功能规划 + 交互区域)

## 优先级

P0 治理类(2026-09-30 盟哥指示:建立整体开发方案的目标,支撑后续功能持续迭代)。本提案不实现新功能,只确立:Agent 范式基座与三层形态、功能规划波次、功能点交互区域矩阵、推进门禁。所有活跃 change 的推进顺序以本提案波次表为单一事实源;`docs/PROPOSAL_ROADMAP.md` 与本提案保持同步。

## 背景

现状:15 个活跃 change 各自携带 tasks 推进,缺乏统一叙事——「下一批做什么」散落在 ROADMAP 的迭代 A-E(2026-09-07 写就,部分前提已过时)与各提案的依赖声明里。三条新事实要求重排:

1. **旧 AI 侧车全链删除完成,pi-sdk 确立为 Agent 基座**(`a020068` 拍板,Phase 1 删除手术 21/26 收口,Phase 2 最小集成大半落地:src/agent/pi/ 五模块 + clipboard_search/clipboard_read_latest 工具 + PiAnalysisBar 详情页入口)。Agent 能力从此有了确定范式,不再有「旧 AI 侧车 vs pi vs Vercel AI SDK vs Mastra」并行的叙事负担。
2. **基建提前在位**:SQLite 已建 `clips/folders/snippets/clip_semantic_index` 表(lib.rs,user_version=2,semantic_index 含 model='local-keyword' + vector BLOB + keywords 列);MCP 已有 `run_mcp_stdio` + 33 个 `clipf.*` 工具(context.get/compose/live、capture/update/copy/search、settings.get/patch/replace/reset、agent.providers/check 等)。AGENTS.md 里「规划持久化:SQLite + 小型向量索引」「后续 MCP 标准工具接口」两项已具骨架,功能规划应基于这些真实地基,而非假设从零开始。
3. **核心闭环接近收口**:file-image-clipboard-support 75/83、clipboard-multi-format-fidelity 22/26、interaction-animation-polish 25/25(待归档)、tailwind-v3-style-refactor 21/25(剩人工走查)。剩余项高度集中在「实机验收矩阵」,这是 W1 的自然边界。

## Agent 范式(pi sdk 为基座的三层形态)

承接 pi-sdk-agent-foundation,后续所有 Agent 能力按三层归位,**不新立第四种形态**:

| 层 | 形态 | 载体 | 状态 |
|---|------|------|------|
| L1 嵌入式分析 | 详情页条目级分析/摘要/历史/标签建议 | `PiAnalysisBar` + `src/agent/pi/analysis.ts` + analysis-history | 已落地,剩智能标签接线 |
| L2 工具化助手 | 会话 + 工具调用(检索/读条目),流式输出 | `src/agent/pi/agent.ts` + tools.ts(clipboard_search/clipboard_read_latest) + stream.ts | 骨架在位,剩 API Key redaction/keyRef 边界、provider 极简配置 UI、助手面板形态评估 |
| L3 外部接口 | MCP stdio 标准工具面,供外部 Agent/宿主调用 | `run_mcp_stdio` + `clipf.*` 工具族(lib.rs:11385+) | 已落地,随 W2/W3 能力扩展 |

**同源原则**:L2 的 pi 工具与 L3 的 MCP 工具消费同一领域命令层,禁止双轨实现;新增剪贴板领域能力先落领域命令,再分别暴露。

**红线(承 AGENTS.md,verify-hot-path 已有否定断言)**:AI/网络调用不进剪贴板热路径(主面板搜索/列表/复制/粘贴);API Key 走 settings redaction/keyRef,不落盘前端;AI 设置不做复杂面板,provider 配置保持极简表单;助手面板形态(独立窗口/详情侧栏)在 pi 集成稳定后单独评估,当前不排期。

## 功能规划(五波次)

波次只约定**推进顺序与依赖**,不改变各 change 自身验收标准:

### W1 剪贴板核心闭环收口(P0,当前主战场)
- `file-image-clipboard-support`(75/83):文本/HTML/图片/文件 复制-展示-粘贴-磁盘清理实机矩阵。
- `clipboard-multi-format-fidelity`(22/26):多 representation 写回 + 监听去重实机矩阵。
- `onboarding-standalone-page`(25/52):正式 .app 验证开机启动、Accessibility 权限引导只弹一次、托盘/快捷键不阻塞。
- `interaction-animation-polish`(25/25):完成,走归档流程。
- `tailwind-v3-style-refactor`(21/25):盟哥三 surface 人工走查 + 走查修复。
- 退出条件:实机矩阵全绿 + 两个格式提案归档;性能基线 `quick.scroll/select/copy/paste` P95 ≤ 300ms(`window.__clipforgePerf.summary()`)。

### W2 搜索与语义检索(P1,W1 收口后启动)
- 基于 `clip_semantic_index` 演进:local-keyword 已建,向量列预留在位;本地索引优先,不引云端依赖。
- 搜索结果直接展示在主列表(AGENTS.md 红线,不进二级面板)。
- 语义能力先服务 L2 pi 工具与 L3 MCP `clipboard.search`,UI 增强其次。

### W3 Agent 能力补全(P1,依赖 W1 的稳定性基线)
- `pi-sdk-agent-foundation` 收尾:API Key redaction/keyRef、provider 极简 UI、智能标签建议(onApplyTags/onApplyFolder 通道)、Phase 4 验收。
- `ai-model-plugin-productization`(65/76):scope 复审后按 L1/L2 归位,重叠能力并入 pi 线,不并行开工。
- 助手面板形态评估结论(做/不做/以何形态)写入 pi-sdk tasks。

### W4 运行时与外部接口决策(P2)
- `vercel-ai-sdk-integration`(30/38)/`mastra-agent-runtime-evaluation`(11/25)/`local-model-quick-integration`(4/16)三案统一取舍:产出一份「引入/裁剪/归档」结论文档,结论前不新增重型依赖(承 AGENTS.md)。
- `external-hook-plugin-runtime`(0/67):只推进 Block A 读取侧,Block B 写入侧维持冻结。
- L3 MCP 工具面按 W2/W3 产物扩展(语义检索工具、标签写回工具走 preview/confirm)。

### W5 治理与演示(横切,不阻塞)
- `codebase-modularity-refactor`(11/26):随功能触碰渐进,豁免清单只减不增。
- `framer-motion-adoption-eval`:dormant,按其提案信号表触发。
- `project-demo-gif-pipeline`(0/30):W1 稳定后启动录制。

## 交互区域矩阵

新增任何功能点先对号入座;矩阵外区域需要新提案:

| 交互区域 | 定位 | AI 触点 | 关键约束 |
|---|------|---------|---------|
| 主面板(quick panel) | 高频粘贴热路径:搜索/列表/复制/删除 | **无** | P95 ≤ 300ms;AI/网络调用禁止 |
| workspace 详情/聚合页 | 整理与查看:编辑器/预览/meta | PiAnalysisBar(L1:分析/摘要/历史/标签建议) | 不阻塞详情页打开 |
| 设置窗口 | 配置面 | provider 极简表单 + MCP/Agent 状态(L2 配置) | 不做复杂 AI 面板 |
| 托盘/全局快捷键/快速菜单 | 唤起与快贴 | 无 | Clipy 等价能力优先级最高 |
| onboarding 独立窗口 | 首启动引导 | 无 | 权限引导只弹一次 |
| MCP stdio | 外部 Agent 接口 | clipf.* 工具族(L3) | 只读默认,写回走 preview/confirm |

## 非目标

- 不在本提案内实现 W1-W5 任何具体功能(由对应 change 承接)。
- 不新立 AI 对话主入口、不做复杂 AI 配置面板、不引入第四种 Agent 形态。
- 不修改现有 change 的验收标准;只约定顺序、依赖与归位关系。
- 不在本提案内裁决 W4 三案取舍(届时出独立结论文档)。

## 风险与对策

- **实机验收是 W1 瓶颈**:实机矩阵需要正式 .app + 盟哥配合项(走查/验收),自动化回归覆盖不了 WKWebView 实机差异 → W1 启动即预约走查窗口,不把实机项拖到波次末尾。
- **pi sdk 上游 API 演进**:适配层已隔离在 src/agent/pi/;W3 收尾时锁定版本号,升级走独立批次。
- **波次表腐化**:每次波次启动/收口在 pi 本提案 tasks 留一行备注;ROADMAP 月度对账 `openspec list` 实数。

## 成功标准

- `openspec list` 的推进顺序可由本提案波次表单点解释,无「不知道下一步做哪个」状态。
- `docs/PROPOSAL_ROADMAP.md` active 表与本提案波次一致。
- 每个功能点提案头部可标注所属波次;新增提案 PR 必须声明波次归位。
- 交互区域矩阵作为新 surface/AI 触点的门禁:矩阵外即新提案。

## 依赖关系

- 上游裁决:`a020068`(pi 确立/旧 AI 侧车废弃,2026-09-11)。
- 下游消费:全部活跃 change 的排期;docs/PROPOSAL_ROADMAP.md 为其文档视图。
