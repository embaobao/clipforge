# 评估报告：是否需要内嵌 Pi runtime 替代外部 Agent

> 评估时间：2026-07-15
> 评估对象：[pi-computer-use](https://github.com/injaneity/pi-computer-use) 在 ClipForge 中的集成方式
> 评估结论：**不引入 Pi runtime**，但把真实需求拆为现有提案的增量任务

---

## 一、决策摘要

| 维度 | 结论 |
|---|---|
| **是否内嵌 Pi runtime** | ❌ 否 |
| **是否引入 pi-computer-use 作为依赖** | ❌ 否（仅借鉴设计模式） |
| **真实问题** | 减少对外部 Agent（Claude Code / Codex CLI 等）的依赖，把"快速、智能推荐、场景感知、工具自迭代"做成 ClipForge 内部能力 |
| **推荐路径** | 拆为 3 个现有提案的 v2 增量任务，不新建独立提案 |
| **是否需要修订现有 hard constraint** | **是**，需要在评审通过后显式修订 4 条硬约束 |

---

## 二、引入 Pi 想解决的问题与实际收益

### 2.1 问题澄清

原始动机是"解决外部 Agent 反应慢、能力不足"以及"期望内部智能推荐和场景感知"。拆开后是 5 个独立问题：

| 问题 | 真实原因 | 引入 Pi 能解决吗 |
|---|---|---|
| 外部 Agent 启动慢 | 每次用户操作都启动外部 CLI 进程 + stdin/stdout pipe | ❌ 不能。Pi 是宿主框架，不是延迟优化器。根因在"每次都启动进程" |
| 外部 Agent 能力不足 | 外部 Agent 只能看到当前 clip + 用户输入 | ⚠️ 有限。pi-computer-use 的 `observe_ui` 让 Agent 看到 ClipForge 内部 UI 状态，但 ClipForge 内部状态可由我们自己以 MCP 工具形式暴露，不需要 AX 抓取 |
| 期望内部智能推荐 | 当前缺少"剪贴板工具内置智能建议" | ❌ 不需要 Pi。可作为 `clipboard.content.suggest` MCP 工具 + 设置页"建议"面板实现 |
| 期望内部场景感知 | 当前缺少"自动检测用户工作流场景" | ❌ 不需要 Pi。可作为本地分析任务 + 规则沉淀机制 |
| 期望工具自迭代 | 当前工具/插件不会自动升级 | ❌ 不一定要 Pi。需要的是插件版本协商 + 灰度 + 回滚 + 审计机制，pi-computer-use 只是其中一个参考实现 |

### 2.2 pi-computer-use 能提供的实际价值

剥离 pi-computer-use 真正可借鉴的东西：

| 能力 | 对 ClipForge 的价值 | 是否需要 Pi |
|---|---|---|
| State-scoped 工具框架（stateId + ref + successor diff） | 中。ClipForge 内部已经是单向数据流 + Tauri command，可用 Pinia/Zustand + diff 库自行实现 | ❌ |
| 不可变资源调度器（同物理资源串行、跨资源并发） | 中。ClipForge 的 SQLite 串行化和 Tauri command 已经是这个模型 | ❌ |
| 配置分层（全局/项目/env 三层） | 高 | ❌ 只需要设计模式 |
| CDP 浏览器桥 | 零。ClipForge 不控制浏览器 | ❌ |
| macOS Swift helper / Windows UIA | 低。ClipForge 已经是 Tauri 跨平台，再加 native helper = 维护成本翻倍 | ❌ |

### 2.3 成本评估

如果走"完全内嵌 Pi runtime + pi-computer-use"路径：

| 成本项 | 估算 |
|---|---|
| Rust 层重写 state-scoped 工具框架 | 1 个 P 阶段（≥ 2 周） |
| macOS Swift helper 维护 | 持续。TCC 权限、签名、macOS 14+ ScreenCaptureKit、release certificate |
| Windows UIA helper 维护 | 持续。平台 accessibility API、session 生命周期 |
| 跨平台 native helper 兼容性测试 | 持续。需 Linux fallback |
| 治理能力（沙箱/回滚/audit） | 1 个 P 阶段（与"全自迭代"需求耦合） |
| 与现有 13 个活跃提案的边界冲突解决 | 需修订 4 个 hard constraint（见第四节） |

**总成本估算**：≥ 2 个 P 阶段推迟，等于 P0–P2 全部延后。

---

## 三、与现有提案的边界冲突

### 3.1 硬冲突（违反现有提案的明确边界）

| 冲突点 | 现有约束 | "完全内嵌 Pi + 全自迭代"需求 | 来源 |
|---|---|---|---|
| 静默改写历史 | "不允许 Agent 后台直接改写剪贴板历史或系统剪贴板" | 全自迭代需要后台自动改写 | [context-plugin-agent-runtime](../archive/2026-07-14-context-plugin-agent-runtime/proposal.md) 第 40 行 |
| 自动升级插件 | "应用、插件、Agent adapter、能力 manifest 的版本协商、灰度、回滚、禁用和审计……不做静默全量升级" | 全自迭代包含自升级插件/规则 | [context-plugin-agent-runtime](../archive/2026-07-14-context-plugin-agent-runtime/proposal.md) 第 72 行 |
| 完整历史暴露 | "不默认把完整剪贴板历史、完整正文、可执行路径、输入框坐标暴露给外部 Agent" | 智能场景感知需要历史沉淀 | [context-plugin-agent-runtime](../archive/2026-07-14-context-plugin-agent-runtime/proposal.md) 第 42 行 |
| 静默执行脚本 | "不允许 Agent 静默创建并自动执行本地脚本" | "工具的全链路迭代" | [context-plugin-agent-runtime](../archive/2026-07-14-context-plugin-agent-runtime/proposal.md) 第 41 行 |

### 3.2 战略级冲突

1. **与项目定位冲突**：[AGENTS.md](../../../../AGENTS.md) 明确"ClipForge 首先必须是快速剪贴板工具，不是平台、不是 AI 工作台"。完全内嵌 Pi + 全自迭代 = 把 ClipForge 改造成 AI 自动化平台。

2. **推进顺序冲突**：[project.md](../../../project.md) 当前 P0–P2 都是基础能力（分发、i18n、settings、格式支持、搜索增强），P3 才到智能格式解码，P4 才是 Agent 面板，P4.5/P5 才是 AI 标品化讨论。完全内嵌 Pi runtime 跨越了至少 4 个 P 阶段。

3. **复杂度跳跃**：Pi runtime 内嵌 + pi-computer-use native helper + 全自迭代治理层 = 至少 = 当前 ClipForge 全部提案的 1.5–2 倍工程量。

### 3.3 与现有提案的可合并点

如果要推进，新想法与以下提案方向高度重叠：

- **[context-plugin-agent-runtime](../archive/2026-07-14-context-plugin-agent-runtime/proposal.md)**：已经定义了"自动升级能力"和"智能内容解析"框架
- **[ai-model-plugin-productization](../ai-model-plugin-productization/proposal.md)**：已经定义 Agent Provider 统一抽象、CapabilityPolicy、标品化分层
- **[clipboard-agent-panel](../clipboard-agent-panel/proposal.md)**：Agent 是 plugin capability，不是独立运行时

---

## 四、需修订的 4 个 hard constraint

如要走"全自迭代"路径，需要先评审并显式修订以下 4 条 hard constraint（仅列出，不在本报告中决定是否修订）：

### 4.1 是否允许 Agent 后台自动改写剪贴板历史

> **现状**："不允许 Agent 后台直接改写剪贴板历史或系统剪贴板"
> **来源**：[context-plugin-agent-runtime](../archive/2026-07-14-context-plugin-agent-runtime/proposal.md) 第 40 行
> **修订方向（如适用）**：可改为"Agent 改写必须生成 patch，由用户确认或基于可审计规则执行；自动改写范围限定为 tag 追加、use_count 累加、重复条目合并；不修改内容正文、收藏、归档、snippet"

### 4.2 是否允许插件和工具自动升级

> **现状**："应用、插件、Agent adapter、能力 manifest 的版本协商、灰度、回滚、禁用和审计……不做静默全量升级"
> **来源**：[context-plugin-agent-runtime](../archive/2026-07-14-context-plugin-agent-runtime/proposal.md) 第 72 行
> **修订方向（如适用）**：可改为"支持自动检查、灰度、回滚、禁用和审计；自动应用范围限定为 builtin plugin 的 manifest 字段、tag 规则、Agent skill prompt 模板；自动升级必须写入 audit log 且可一键关停"

### 4.3 是否允许 Agent 访问完整剪贴板历史

> **现状**："不默认把完整剪贴板历史、完整正文、可执行路径、输入框坐标暴露给外部 Agent"
> **来源**：[context-plugin-agent-runtime](../archive/2026-07-14-context-plugin-agent-runtime/proposal.md) 第 42 行
> **修订方向（如适用）**：可改为"内部 Agent（同进程、用户授权）可访问受控快照；外部 Agent（跨进程、跨用户、远程）只暴露脱敏子集；完整正文只用于本地 LLM 或本地 CLI Agent，不上传到云端 provider"

### 4.4 是否允许 Agent 自动创建并执行本地脚本

> **现状**："不允许 Agent 静默创建并自动执行本地脚本；Agent 只能生成插件 manifest / 脚本草稿，保存和执行必须经过权限校验与用户确认"
> **来源**：[context-plugin-agent-runtime](../archive/2026-07-14-context-plugin-agent-runtime/proposal.md) 第 41 行
> **修订方向（如适用）**：可改为"允许 Agent 生成可审计的本地分析任务（如去重检测、tag 建议、过期条目扫描），任务执行需经过 capability policy 和显式用户开关；不允许 Agent 创建通用 shell 脚本并自动执行"

**注意**：上述 4 条修订方向仅作为评审候选，**不构成本报告的结论**。是否修订需在 P5 标品化阶段重新评估。

---

## 五、推荐路径：把真实需求拆为 3 个现有提案的 v2 增量

### 5.1 拆分原则

不新建独立提案。把"内部智能推荐 + 场景感知 + 工具自迭代 + 减少外部 Agent 依赖"拆为 3 个现有提案的 v2 增量任务：

- **context-plugin-agent-runtime**（[archive/2026-07-14-context-plugin-agent-runtime](../archive/2026-07-14-context-plugin-agent-runtime/proposal.md)）→ 需先从 archive 移回 changes/ 并补完 v2 章节
- **ai-model-plugin-productization** → 加 "内部智能推荐" 章节
- **clipboard-agent-panel** → 加 "外部 Agent 依赖弱化" 章节

### 5.2 增量任务清单

#### 5.2.1 context-plugin-agent-runtime v2 增量

**目标**：在现有"自动升级能力"和"智能内容解析"框架基础上，加入"内部智能场景感知 + 规则沉淀"。

**v2 新增任务**：

| 任务 ID | 任务 | 边界 |
|---|---|---|
| CTX-V2-01 | 定义 `ClipboardScenario`：场景 = 触发条件 + 检测函数 + 候选动作集合 | 只读检测，不自动执行 |
| CTX-V2-02 | 定义 `ScenarioRule`：场景规则 = 场景 ID + 用户确认历史 + 应用范围 | 用户可手动启用/禁用 |
| CTX-V2-03 | 新增 MCP 工具 `clipboard.scenario.detect`：基于当前上下文返回场景候选 | 只读，建议输出 |
| CTX-V2-04 | 新增 MCP 工具 `clipboard.scenario.suggest_rule`：基于历史数据推荐可沉淀的规则 | 用户确认后写入 |
| CTX-V2-05 | 在 settings 增加"场景感知"开关和已沉淀规则列表 | 默认关闭 |

**保持的 hard constraint**：

- ❌ 不允许后台自动改写历史
- ❌ 不允许静默升级插件
- ❌ 不允许暴露完整历史给外部 Agent
- ❌ 不允许静默执行脚本

**v2 在哪些方面强化而非突破**：

- "场景感知"在原提案"智能内容解析"基础上扩展，是**只读检测 + 用户确认后的规则沉淀**，不是自动改写
- "工具自迭代"在原提案"自动升级能力"基础上**只读审计日志 + 灰度建议**，不自动应用

#### 5.2.2 ai-model-plugin-productization v2 增量

**目标**：在现有 "配置好模型以后" 标准 AI 能力包基础上，**优先内化高频低风险能力**，减少对外部 Agent CLI 的调用。

**v2 新增任务**：

| 任务 ID | 任务 | 边界 |
|---|---|---|
| AI-V2-01 | 把"摘要、改写、翻译、标签建议、结构化提取、格式修复"6 个能力标记为**可本地化能力** | 优先用本地 LLM / 轻量模型 |
| AI-V2-02 | 引入"内部推荐 vs 外部 Agent"两档策略：高频能力用内部 provider；低频长任务保留外部 CLI adapter | 内部能力失败时可降级到外部 |
| AI-V2-03 | 引入"内部智能推荐"面板：基于场景感知 + 内容分析，在 settings 或主面板给出"建议"列表 | 只读建议，一键应用 |
| AI-V2-04 | 内部推荐结果可直接保存为 snippet / 收藏 / 归档 / 标签，但保存动作走用户显式确认 | 与原提案"四类结果"保持一致 |

**保持的 hard constraint**：

- ❌ 模型密钥不进前端
- ❌ 危险动作必须预览确认
- ❌ 不把 ClipForge 改造成 AI 工作台

#### 5.2.3 clipboard-agent-panel v2 增量

**目标**：明确"外部 Agent CLI 依赖"是过渡方案，长期目标是用内部 provider 替代。

**v2 新增任务**：

| 任务 ID | 任务 | 边界 |
|---|---|---|
| AGT-V2-01 | 引入"Agent Provider 优先级"：内部 provider > 本地 LLM > 外部 CLI adapter | 用户可手动覆盖 |
| AGT-V2-02 | 引入"延迟预算"机制：内部 provider 必须 < 500ms 返回首 token；超过则自动降级 | 不阻塞悬浮面板唤起 |
| AGT-V2-03 | 引入"能力适配"层：把外部 CLI 的能力（claude -p, codex）映射成 ClipForge 内部 capability，**不绑定具体 CLI** | 后续可替换 |
| AGT-V2-04 | 外部 CLI adapter 标记为"legacy"接口：保留向后兼容，但默认 UI 隐藏 | 不破坏现有用户 |

**保持的 hard constraint**：

- ❌ Agent 是 plugin capability，不是独立运行时
- ❌ 外部 CLI 失败不影响快速剪贴板主路径

### 5.3 优先级与推进顺序

| 阶段 | 内容 | 前置依赖 |
|---|---|---|
| P0 | github-release-update-distribution | 无 |
| P0.5 | app-internationalization-en-support | P0 |
| P0.65 | settings-service-unified-protocol | P0.5 |
| P0.7 | settings-interface-redesign | P0.65 |
| P1 | file-image-clipboard-support → clipboard-multi-format-fidelity | P0.7 |
| P2 | search-filter-tags-filetypes | P1 |
| P3 | content-smart-format-decoder | P2 |
| P3.5 | **context-plugin-agent-runtime v2 增量**（从 archive 移回，补完 v2 章节） | P3 |
| P4 | clipboard-agent-panel v1 + v2 增量 | P3.5 |
| P4.5 | ai-model-plugin-productization v1 | P4 |
| P5 | ai-model-plugin-productization v2 增量（内部推荐面板） | P4.5 |
| P5+ | 自迭代治理层（沙箱/回滚/audit）→ 评估 hard constraint 修订 | P5 |

**关键路径**：P3.5 必须先把 context-plugin-agent-runtime 从 archive 移回 changes/ 并补完 v2 章节；否则 P4 clipboard-agent-panel 仍然基于"外部 Agent 优先"设计，无法承接"内部智能"目标。

### 5.4 与本评估报告的对应

| 本报告核心问题 | 对应增量任务 |
|---|---|
| "减少外部 Agent 依赖" | AGT-V2-01, AGT-V2-02, AGT-V2-03, AGT-V2-04 |
| "内部智能推荐" | AI-V2-01, AI-V2-02, AI-V2-03, AI-V2-04 |
| "内部场景感知" | CTX-V2-01, CTX-V2-02, CTX-V2-03, CTX-V2-04, CTX-V2-05 |
| "工具自迭代" | 推迟到 P5+，需先评估 4 条 hard constraint 修订 |
| "能力不足" | AI-V2-01（高频能力本地化）+ AGT-V2-03（能力适配层） |
| "反应慢" | AGT-V2-01（内部 provider 优先）+ AGT-V2-02（延迟预算） |

---

## 六、可借鉴的 pi-computer-use 设计模式（不引入 runtime）

即使不引入 Pi，下面的设计模式可以在 ClipForge 中复用：

### 6.1 State-Scoped 工具框架（仅借鉴模式）

> 参考：[pi-computer-use architecture.md](https://raw.githubusercontent.com/injaneity/pi-computer-use/main/docs/architecture.md) 中的 `stateId` + `@e ref` 模型

**ClipForge 映射**：

- 现有 `ClipboardContextSnapshot` + Tauri command 可视为"弱 state-scoped"模型
- 可在 [detail-rich-editor-agent-bridge](../detail-rich-editor-agent-bridge/proposal.md) 的 `EditorSession` 中引入 `sessionId` + `patchId` 概念，支持撤销/重做和 patch diff
- 不需要在 Rust 层重写 Pi runtime，可用 Pinia/Zustand + diff 库实现

### 6.2 Successor Diff 模式

> 参考：pi-computer-use `act_ui` 返回"完整 successor state，但只渲染可信 diff"

**ClipForge 映射**：

- AI 建议反吐（[detail-rich-editor-agent-bridge](../detail-rich-editor-agent-bridge/proposal.md) 第 19 行）已经采用 patch 模式
- 可在 settings 和插件系统引入 "change budget" 概念：超过预算时返回完整视图，否则返回 diff
- 工具链：`state.ts` → `view.ts` 的两层抽象

### 6.3 配置分层

> 参考：pi-computer-use 的 `~/.pi/agent/extensions/pi-computer-use.json` + `.pi/computer-use.json` + 环境变量三层

**ClipForge 映射**：

- 当前 settings 存 localStorage；后续 SQLite 持久化（[sqlite-persistence](../.archive/sqlite-persistence/proposal.md)）可引入：
  - 用户级（SQLite）
  - 工作区级（`.clipforge/`，可选）
  - 环境变量（用于 CI/测试/调试）
- 优先级：环境变量 > 工作区 > 用户级

### 6.4 架构不变量检查

> 参考：pi-computer-use 的 `test:invariants`（如"旧工具不得重新出现"）

**ClipForge 映射**：

- 当前验证只有 `pnpm build` + `cargo check`
- 建议逐步引入：
  - 架构不变量检查（如"Agent 面板不得暴露完整剪贴板历史给前端"、"settings 入口必须在右下角"等 hard constraints）
  - MCP 工具 schema 自动校验
  - 并发检查（如"Agent run 不阻塞面板唤起"）

### 6.5 不借鉴的部分

| 能力 | 不借鉴原因 |
|---|---|
| 桌面 UI 自动化（点击/输入/滚动） | ClipForge 不是 RPA 工具 |
| CDP 浏览器控制 | 当前无浏览器自动化需求 |
| OCR 与视觉证据 | 剪贴板内容采集不需要视觉识别 |
| 坐标回退操作 | ClipForge 交互在自身 UI 内完成 |
| macOS Swift helper / Windows UIA | 已是 Tauri 跨平台，再加 helper = 维护成本翻倍 |

---

## 七、结论与下一步

### 7.1 结论

1. **不引入 Pi runtime**。解决"外部 Agent 反应慢、能力不足"根本不需要 Pi；引入 Pi 反而会带来 native helper 维护成本、跨平台兼容性测试和与现有 13 个提案的边界冲突。

2. **不引入 pi-computer-use 作为依赖**。仅借鉴其设计模式（state-scoped、successor diff、配置分层、架构不变量检查）。

3. **真实需求**（减少外部 Agent 依赖、内部智能推荐、场景感知、工具自迭代）拆为 3 个现有提案的 v2 增量：
   - context-plugin-agent-runtime v2（场景感知 + 规则沉淀）
   - ai-model-plugin-productization v2（内部推荐 + 能力本地化）
   - clipboard-agent-panel v2（外部 Agent 弱化路径）

4. **工具自迭代**（自动升级插件/规则）推迟到 P5+。需先评估 4 条 hard constraint 修订，并在治理能力（沙箱/回滚/audit）齐备后再开放。

5. **context-plugin-agent-runtime 当前位于 archive**，P3.5 阶段需先移回 changes/ 并补完 v2 章节，否则后续提案无法承接"内部智能"目标。

### 7.2 下一步动作

| 步骤 | 内容 | 责任 |
|---|---|---|
| 1 | 在 [project.md](../../../project.md) 中把 context-plugin-agent-runtime 从"提案中"标记为"P3.5 需从 archive 移回 + 补 v2" | 提案维护 |
| 2 | 在 [ai-model-plugin-productization/proposal.md](../ai-model-plugin-productization/proposal.md) 末尾加 "v2 内部推荐" 章节 | 提案维护 |
| 3 | 在 [clipboard-agent-panel/proposal.md](../clipboard-agent-panel/proposal.md) 末尾加 "v2 外部 Agent 弱化" 章节 | 提案维护 |
| 4 | 把本报告作为外部参考归档至 [archive/2026-07-15-pi-runtime-evaluation/](../archive/2026-07-15-pi-runtime-evaluation/) | 提案维护 |
| 5 | P5+ 阶段重新评估 4 条 hard constraint 修订决议 | 评审 |

### 7.3 不建议的下一步

| 不建议 | 原因 |
|---|---|
| 新建独立"内嵌 Pi runtime"提案 | 与现有 13 个活跃提案硬冲突；工程量 = 全部现有提案 1.5–2 倍 |
| 立即开放"全自迭代"（自动升级插件/规则） | 4 个 hard constraint 冲突；治理能力未到位 |
| 把 pi-computer-use 的 macOS Swift helper 引入 | 与"跨平台"定位冲突；Tauri 已统一跨平台 |
| 把 pi-computer-use 的 Windows UIA helper 引入 | 同上 |

---

## 八、附录

### 8.1 参考链接

- [pi-computer-use GitHub](https://github.com/injaneity/pi-computer-use)
- [pi-computer-use architecture.md](https://raw.githubusercontent.com/injaneity/pi-computer-use/main/docs/architecture.md)
- [pi-computer-use configuration.md](https://raw.githubusercontent.com/injaneity/pi-computer-use/main/docs/configuration.md)
- [pi-computer-use usage.md](https://raw.githubusercontent.com/injaneity/pi-computer-use/main/docs/usage.md)

### 8.2 现有相关提案

- [github-release-update-distribution](../github-release-update-distribution/proposal.md)
- [app-internationalization-en-support](../app-internationalization-en-support/proposal.md)
- [settings-service-unified-protocol](../settings-service-unified-protocol/proposal.md)
- [settings-interface-redesign](../settings-interface-redesign/proposal.md)
- [file-image-clipboard-support](../file-image-clipboard-support/proposal.md)
- [clipboard-multi-format-fidelity](../clipboard-multi-format-fidelity/proposal.md)
- [search-filter-tags-filetypes](../search-filter-tags-filetypes/proposal.md)
- [content-smart-format-decoder](../content-smart-format-decoder/proposal.md)
- [context-plugin-agent-runtime](../archive/2026-07-14-context-plugin-agent-runtime/proposal.md)（archive，需移回）
- [detail-rich-editor-agent-bridge](../detail-rich-editor-agent-bridge/proposal.md)
- [clipboard-agent-panel](../clipboard-agent-panel/proposal.md)
- [ai-model-plugin-productization](../ai-model-plugin-productization/proposal.md)
- [codebase-modularity-refactor](../codebase-modularity-refactor/proposal.md)

### 8.3 评估方法

- 读取 [pi-computer-use](https://github.com/injaneity/pi-computer-use) 的 README、architecture.md、configuration.md、usage.md、development.md、package.json
- 逐条对照 ClipForge 现有 13 个活跃提案的 hard constraints
- 与 [project.md](../../../project.md) 推进顺序对齐
- 与 [AGENTS.md](../../../../AGENTS.md) 项目定位对齐
