# 提案：上下文驱动的插件与 Agent 运行时边界

## 背景

ClipForge 的产品主线仍然是快速、稳定、低延迟的剪贴板工具。后续插件、Agent、MCP、AG-UI、详情页富文本编辑都必须服务于这个主线，不能把应用改造成重型 AI 工作台。

当前项目已经具备一部分基础能力：

- 剪贴板条目已经保存内容、时间、分类、摘要、URL、来源应用等上下文。
- 详情页已经展示内容类型、来源应用和渲染器，并记录渲染业务链路日志。
- Rust 侧已经有最小 MCP stdio 工具入口。
- 详情页 Tiptap 编辑器与 Agent/MCP 扩展桥已有独立提案。

但这些能力还缺少统一边界：

- 插件、Agent、MCP tools、AG-UI 面板容易混在同一层。
- 当前详情页“打开链接”等动作仍是 UI 特判，应该收敛为标准内置插件，作为后续插件系统的最小可用样例。
- 当前上下文字段有“代码已预留”和“真实稳定采集”两种状态，需要显式分级。
- 当前输入环境、编辑器 draft、selection、插件权限、Agent 可读范围还没有统一契约。
- 插件和 Agent 的能力升级缺少版本、兼容性、回滚、禁用和审计机制。

## 目标

1. 定义 `ClipboardContextSnapshot`，作为插件和 Agent 读取当前剪贴板上下文的唯一入口。
2. 定义插件 manifest、权限模型、触发点和输出动作，明确“什么是插件”。
3. 将现有“打开链接”标准化为 `builtin.open-link` 插件：插件 icon、名称、触发条件、权限、执行动作都走统一插件链路。
4. 将普通文本默认“下钻详情页”标准化为 `builtin.open-detail` 插件，让 `Ctrl/Cmd+J` 始终走统一动作解析器。
5. 定义受控脚本插件：支持变量渲染、打开应用、打开终端、执行白名单命令或 `claude -p` 这类本地 Agent 命令，但默认需要用户确认。
6. 定义 Agent Provider 与 AG-UI 面板桥，明确“什么是 Agent 能力”。
7. 支持智能内容解析：从当前 clip 中提取用户最可能想复制、打开或下钻的候选内容，但不做长期学习和自动改优先级。
8. 保持 MCP tools 是对外稳定接口，不直接绑定 React/Tiptap UI 状态。
9. 定义 Tiptap Editor Session 边界，让编辑态上下文可用但受控。
10. 规划自动升级能力：应用、插件、Agent adapter、能力 manifest 的版本协商、灰度、回滚、禁用和审计。
11. 保证快速面板主路径不被 OCR、识别、Agent 调用、插件加载阻塞。

## 非目标

- 不在第一阶段实现远程插件市场。
- 不允许插件直接访问 SQLite、React state、localStorage 或系统剪贴板原生 API。
- 不允许 Agent 后台直接改写剪贴板历史或系统剪贴板。
- 不允许 Agent 静默创建并自动执行本地脚本；Agent 只能生成插件 manifest / 脚本草稿，保存和执行必须经过权限校验与用户确认。
- 不默认把完整剪贴板历史、完整正文、可执行路径、输入框坐标暴露给外部 Agent。
- 不在第一阶段实现任意远程代码执行或未签名插件自动安装。
- 不把 AG-UI 当成插件发现协议；AG-UI 只负责 Agent 与页面之间的运行事件。

## 用户价值

- 详情页能稳定展示“这段内容是什么、来自哪里、现在能做什么”。
- 插件按钮可以基于当前内容提供固定能力，例如打开链接、OCR、内容检查、模板渲染、格式转换。
- 用户可以把“根据当前详情内容打开终端并执行 `claude -p ...`”保存成一个可复用快捷指令插件。
- Agent 可以通过 MCP 生成插件名称、图标、脚本模板和触发条件，让用户在面板中预览、保存、调用。
- `Ctrl/Cmd+J` 对链接默认打开目标，对普通文本默认下钻详情页；对 JSON、命令、代码块、文件路径等内容先通过智能解析生成候选，再由内置动作或用户插件触发。
- Agent 可以通过 MCP 调用智能解析能力，生成“建议复制哪个字段 / 下钻哪个片段 / 用哪个插件处理”的候选，但第一阶段不学习、不自动调整插件优先级。
- Agent 可以作为详情页助手读取受控上下文，返回预览结果、智能建议反吐、patch 或自定义渲染面板。
- Agent 生成或 Agent 建议应用保存后的粘贴项自动带 `AI` tag，用户可在搜索栏用 `#AI` 快速找回。
- MCP tools 能把 ClipForge 的能力暴露给外部客户端，但不会破坏应用内部状态。
- 后续能力升级可以灰度、回滚、禁用和审计，不牺牲丝滑体验。

## 成功标准

- 能从详情页构造一个脱敏的只读 `ClipboardContextSnapshot`。
- 进入编辑态后能创建 `EditorSession`，并在 snapshot 中受控暴露 `selection/draft/version/dirty`。
- 插件 manifest 能声明读取哪些上下文字段、写入哪些动作、触发在哪些内容类型上。
- `builtin.open-link` 能替代当前详情页特判的打开链接动作，并通过同一套 `clipboard.plugin.call` 执行。
- `builtin.open-detail` 能作为普通文本 `Ctrl/Cmd+J` 的默认动作。
- `Ctrl/Cmd+J` 动作解析器能返回候选 action、智能解析出的目标片段、命中原因和是否需要确认。
- 智能解析能从 URL、文件路径、命令、JSON 字段、代码块、错误日志、Markdown 标题/链接中提取可复制/可下钻候选。
- Agent 能通过 MCP 创建或更新一个插件草稿，包含 `name/icon/script/triggers/contextFields/permissions`，但默认不自动执行。
- Agent Provider 能统一本地 Agent、远程 Agent、ACP adapter，并输出 AG-UI 事件。
- MCP 只暴露稳定工具，例如 `clipboard.context.get`、`clipboard.plugin.list`、`clipboard.plugin.create`、`clipboard.plugin.call`、`clipboard.editor.preview_patch`、`clipboard.editor.suggest_update`。
- Agent 生成内容进入剪贴板历史时必须写入来源元数据，并默认追加 `AI` tag。
- 自动升级能力先支持检查、兼容性判断、用户确认、回滚记录和 kill switch，不做静默全量升级。

---

## v2 增量：内部智能场景感知与规则沉淀

> 评估依据：[pi-runtime-evaluation 报告](../archive/2026-07-15-pi-runtime-evaluation/report.md)
> 增量目标：在现有智能解析基础上，加入场景感知能力，并支持用户确认后的规则沉淀

### 背景

v1 已经定义了"智能内容解析"（从当前 clip 提取候选内容），但还缺少：

1. **场景感知**：无法识别用户当前工作流场景（如"正在写代码""正在写文档""正在处理错误日志"）
2. **规则沉淀**：无法把用户确认后的场景关联保存为可复用规则

本增量在 v1 基础上加入"内部智能场景感知 + 规则沉淀"，不引入 Pi runtime。

### v2 新增目标

| ID | 目标 | 边界 |
|---|---|---|
| CTX-V2-01 | 定义 `ClipboardScenario`：场景 = 触发条件 + 检测函数 + 候选动作集合 | 只读检测，不自动执行 |
| CTX-V2-02 | 定义 `ScenarioRule`：场景规则 = 场景 ID + 用户确认历史 + 应用范围 | 用户可手动启用/禁用 |
| CTX-V2-03 | 新增 MCP 工具 `clipboard.scenario.detect`：基于当前上下文返回场景候选 | 只读，建议输出 |
| CTX-V2-04 | 新增 MCP 工具 `clipboard.scenario.suggest_rule`：基于历史数据推荐可沉淀的规则 | 用户确认后写入 |
| CTX-V2-05 | 在 settings 增加"场景感知"开关和已沉淀规则列表 | 默认关闭 |

### 保持的 hard constraint

- ❌ 不允许后台自动改写历史
- ❌ 不允许静默升级插件
- ❌ 不允许暴露完整历史给外部 Agent
- ❌ 不允许静默执行脚本

### v2 在哪些方面强化而非突破

| v2 能力 | 强化方式 |
|---|---|
| 场景感知 | 在 v1 "智能内容解析"基础上扩展，是**只读检测 + 用户确认后的规则沉淀**，不是自动改写 |
| 工具自迭代 | 在 v1 "自动升级能力"基础上**只读审计日志 + 灰度建议**，不自动应用 |

### 技术要点

1. **ClipboardScenario 结构**：
   ```typescript
   interface ClipboardScenario {
     id: string;
     name: string;
     trigger: ScenarioTrigger; // 触发条件
     detector: ScenarioDetector; // 检测函数
     candidates: ScenarioCandidate[]; // 候选动作集合
   }
   ```

2. **ScenarioRule 结构**：
   ```typescript
   interface ScenarioRule {
     scenarioId: string;
     userId: string;
     confirmedAt: number; // 用户确认时间
     appliedCount: number; // 应用次数
     enabled: boolean; // 是否启用
     scope: 'global' | 'app-specific'; // 应用范围
   }
   ```

3. **场景检测流程**：
   ```
   当前上下文
   → 场景检测器
   → 候选场景列表（只读）
   → 用户选择/确认
   → 沉淀为 ScenarioRule（可选）
   ```

4. **MCP 工具接口**：
   - `clipboard.scenario.detect(context: ClipboardContextSnapshot): ScenarioCandidate[]`
   - `clipboard.scenario.suggest_rule(history: ClipHistoryQuery): RuleSuggestion[]`
   - `clipboard.scenario.save_rule(rule: ScenarioRule): void`
   - `clipboard.scenario.list_rules(): ScenarioRule[]`

### 与其他提案的协同

| 提案 | 协同点 |
|---|---|
| [ai-model-plugin-productization v2](../ai-model-plugin-productization/proposal.md) | 场景感知作为内部智能推荐的输入源 |
| [clipboard-agent-panel v2](../clipboard-agent-panel/proposal.md) | Agent 页可以调用场景检测能力 |

### 推进顺序

- 本增量在 **P3.5** 阶段推进
- 前置依赖：
  - P2 search-filter-tags-filetypes（标签和搜索基础）
  - P3 content-smart-format-decoder（智能内容解析）
- 后续依赖：
  - P4 clipboard-agent-panel v1 + v2（Agent 页使用场景感知）
  - P5 ai-model-plugin-productization v2（内部推荐使用场景感知）

### 预置场景（Builtin Scenarios）

| 场景 ID | 触发条件 | 候选动作 |
|---|---|---|
| `scenario.code-error` | 内容包含 `Error`、`Exception`、stack trace | 复制错误信息、搜索解决方案、创建 issue 模板 |
| `scenario.json-data` | 内容是 JSON | 格式化、提取字段、转 TypeScript 类型 |
| `scenario.url-link` | 内容是 URL | 打开链接、提取标题、保存为 snippet |
| `scenario.markdown-doc` | 内容是 Markdown | 渲染预览、提取标题、转 HTML |
| `scenario.file-path` | 内容是文件路径 | 打开文件、复制路径、在终端打开 |

### 未来扩展（P5+）

- **自迭代治理层**：沙箱、版本回滚、审计日志、kill switch
- **规则自动建议**：基于用户历史自动推荐可沉淀的规则（需评估 hard constraint 修订）
- **跨场景规则共享**：用户可选择共享规则给其他用户（需评估隐私边界）
