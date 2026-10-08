# 提案:自动打标机制调研(automated-tagging-eval)

> 关联:[pi-sdk-agent-foundation](../pi-sdk-agent-foundation/proposal.md)(L3 smart-tag 接线是其剩余项)。

## 状态

调研类提案(P2,独立切片)。**不阻塞**剪贴板主线;回答「tag 的自动来源有哪些、各自边界在哪、何时启用」,不直接实现。

## 背景

当前 tag 有三个来源,全部已存在但互不编排:

| 来源 | 位置 | 现状 |
|------|------|------|
| Rust 启发式规则 | `src-tauri/src/lib.rs` `default_tags()` | 采集时同步执行:URL→链接、Markdown→Markdown、多行→多行、`#tag` 提取 |
| pi LLM 标签建议 | `src/agent/pi/analysis.ts`(对应 `clipboard_analyze` 命令) | 摘要+标签建议已产出;**建议未自动写回**,由用户在分析面板看结果 |
| 人工打标 | `update_clip_record(tags)` 命令 + 主面板/详情编辑 | 已有;人工值是权威值 |

用户侧诉求(本轮提出):自定义 tag 函数/钩子、经 MCP 打标签。即:规则可配置化、外部 agent 可写 tag。

## 调研问题

### 1. 执行体选型(核心)

| 候选 | 能力 | 成本/风险 | 初判 |
|------|------|-----------|------|
| A. 配置式规则(现有 `default_tags` 泛化:来源映射、正则、内容前缀) | 确定性、零延迟 | 需要规则 schema + 设置 UI(挂 Tag 规则分区) | **第一层,默认启用** |
| B. pi LLM 打标(复用 `clipboard_analyze` 标签建议) | 语义级准确 | provider 配置前置;成本与延迟;**AI 不进热路径**红线 | **第二层,仅显式触发**(手动单条/批量回填),不自动 |
| C. MCP 工具 `set_clip_tags` | 外部 agent 写回 | 写操作需确认边界;tags 白名单(normalize 已有) | **暴露,但只写 `metadata.autoTags` 或走追加语义** |
| D. 用户自定义函数(脚本运行时) | 任意逻辑 | 违反「不引入重型运行时」;安全面大 | **不做**,用 A 的规则 schema 覆盖 80% 场景 |

### 2. 触发时机

- A(规则):采集后异步执行,不阻塞采集热路径(现状已是)。
- B(LLM):仅用户显式动作(单条「AI 打标」/设置页批量回填),复用分析面板降级路径。
- C(MCP):外部调用即触发,写回走 `update_clip_record`。

### 3. 冲突与权威性

- 人工 tag 为权威:自动来源(SHOULD)只追加到独立字段(`auto_tags`)或合并去重,**禁止静默覆盖人工值**。
- 合并展示:主面板 tag 徽标 = 人工 ∪ 自动;详情区分来源(后续 UI 决策)。

### 4. MCP 边界

- `set_clip_tags` 按 MCP 标准工具 schema 暴露:`{ id, tags, mode: "replace" | "append" }`,`replace` 限人工确认链路(或仅允许 `append`),复用 `normalize_tags` 白名单清洗。
- 不新增 MCP 配置面板;沿用现有 mcpServers 接入。

## 评估判据(何时从调研转实施)

1. pi-sdk L3 smart-tag 接线完成(建议产出已稳定)。
2. 出现真实的批量回填诉求(用户手动打了 ≥N 条同类 tag,规则可表达)。
3. 出现外部 agent 写 tag 的真实集成方(MCP 使用者)。

三项全满足前本提案保持 dormant;满足后按 A → C → B 顺序实施,B 最后(成本最高)。

## 试点红线(实施时)

- 采集热路径 P50 不回退(`panel.open` perf span 与 capture 耗时为基线)。
- 规则执行在后台线程,失败静默降级为无自动 tag,不弹错。
- 自动 tag 总数上限(防正则爆炸),复用 `normalize_tags` 去重上限。
