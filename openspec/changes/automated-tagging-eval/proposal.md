# 提案:自动打标机制调研(automated-tagging-eval)

> 关联:[pi-sdk-agent-foundation](../pi-sdk-agent-foundation/proposal.md)(L3 smart-tag 接线是其剩余项)、[product-iteration-master-plan](../product-iteration-master-plan/proposal.md)(写回安全治理)。

## 状态

调研类提案(P2,独立切片)。**不阻塞**剪贴板主线;回答「tag 的自动来源有哪些、各自边界在哪、何时启用」,不直接实现。

## 背景

当前 tag 有三个来源,全部已存在但互不编排:

| 来源 | 位置 | 现状 |
|------|------|------|
| Rust 启发式规则 | `src-tauri/src/lib.rs` `default_tags()` | 采集路径内**同步**执行:URL→链接、Markdown→Markdown、多行→多行、`#tag` 提取 |
| pi LLM 标签建议 | `src/agent/pi/analysis.ts`(对应 `clipboard_analyze` 命令) | 摘要+标签建议已产出;**建议未自动写回**,由用户在分析面板看结果 |
| 人工打标 | `update_clip_record(tags)` 命令 + 主面板/详情编辑 | 已有;人工值是权威值;**现写回对 tags 为整体替换** |

用户侧诉求(本轮提出):自定义 tag 函数/钩子、经 MCP 打标签。即:规则可配置化、外部 agent 可写 tag。

### 现状缺口(实施前置,2026-10-08 codex 评审确认)

- `normalize_tags`(`lib.rs:6940`)是清洗而非白名单:去 `#`/`tag:` 前缀、截 32 字符、大小写去重、上限 12;不校验字符集。
- tags 以逗号拼接存储,读取与导出(`export_items`)均 `split(',')`:含逗号的 tag 存取不一致(读取即裂开)。
- `clipf.update` MCP 工具(`lib.rs:11899`)可直接写 `tags` 数组,无确认门禁——与总纲「写回安全」(preview/confirm 通道)冲突的外部旁路。

## 调研问题

### 1. 执行体选型(核心)

| 候选 | 能力 | 成本/风险 | 初判 |
|------|------|-----------|------|
| A. 配置式规则(现有 `default_tags` 泛化:来源映射、正则、内容前缀) | 确定性、零延迟 | 需要规则 schema + 设置 UI(挂 Tag 规则分区) | **第一层,默认启用** |
| B. pi LLM 打标(复用 `clipboard_analyze` 标签建议) | 语义级准确 | provider 配置前置;成本与延迟;**AI 不进热路径**红线 | **第二层,仅显式触发**(手动单条/批量回填),不自动 |
| C. MCP 工具 `set_clip_tags` | 外部 agent 写回 | 写操作需确认边界;tags 白名单(normalize 已有) | **暴露,但只写 `metadata.autoTags` 或走追加语义** |
| D. 用户自定义函数(脚本运行时) | 任意逻辑 | 违反「不引入重型运行时」;安全面大 | **不做**,用 A 的规则 schema 覆盖 80% 场景 |

### 2. 触发时机

- A(规则):**现状**为采集事务内同步执行(`lib.rs:3455`,O(内容长度) 成本极小);**实施目标**为移出采集事务异步执行,消除批量捕获与低配机下的 P95 尾部。
- B(LLM):仅用户显式动作(单条「AI 打标」/设置页批量回填),复用分析面板降级路径。
- C(MCP):外部调用即触发;写回必须经与总纲「写回安全」一致的 **preview/confirm 通道**——含现有 `clipf.update(tags)` 直写旁路的收口,不静默直写。

### 3. 冲突与权威性

- 人工 tag 为权威:自动来源只追加到独立字段(`auto_tags`)或合并去重,**禁止静默覆盖人工值**。
- 合并语义须原子(单事务):人工值全保留 → 自动值按来源时间填充剩余容量(合并后总上限仍为 `normalize_tags` 的 12)→ 超出时截断**只作用于自动值**;禁止「先整体截断后合并」。
- 检索与导出契约:tags 现进入 FTS(`clip_fts.tags`)与 `clipf.export` 载荷;若自动 tag 走独立字段,SHALL 同步扩 FTS 索引列与 export/import 载荷,否则自动 tag 搜不到、跨机迁移即丢。
- 合并写入时携带来源标记(人工/规则/LLM/MCP),详情可区分来源(实施期验收项)。

### 4. MCP 边界

- `set_clip_tags` 按 MCP 标准工具 schema 暴露:`{ id, tags, mode: "replace" | "append" }`;**append 与 replace 均走 preview/confirm**:响应返回清洗后的 preview tag 集合与确认载荷,二次确认才落库(对齐 product-iteration-governance「写回安全」Scenario)。
- 现有 `clipf.update` 的 `tags` 参数收口为同一门禁(或移除该参数,统一走 `set_clip_tags`)。
- 复用 `normalize_tags` 清洗,并前置修复其非白名单与逗号裂开问题(见「现状缺口」)。
- 不新增 MCP 配置面板;沿用现有 mcpServers 接入。

## 评估判据(何时从调研转实施;三项均为可客观核验)

1. **pi-sdk L3 完成口径**:`pi-sdk-agent-foundation/tasks.md` 中 L3 smart-tag 应用接线任务勾完(非仅「建议产出稳定」)。
2. **批量回填诉求量化**:设置页 tag 使用记录显示用户对 ≥20 条同类条目手动打了规则可表达的同类 tag。
3. **真实 MCP 集成方**:应用日志(`query_app_logs`)存在非本仓库开发调试来源的外部 `clipf.update`/`set_clip_tags` 写调用记录。

三项全满足前本提案保持 dormant;满足后按 A → C → B 顺序实施,B 最后(成本最高)。

## 试点红线(实施时)

- 采集热路径 P95 不回退(P50 同步观察):以 capture 耗时为基线,空载与 ≥10k 条历史负载各测一轮,容差 ±5%(`panel.open` perf span 照常采集)。
- 规则执行移出采集事务后在后台线程执行,失败静默降级为无自动 tag,不弹错。
- 删除后晚到的异步打标结果不得写入已删条目(保持 `deleted_at IS NULL` 约束);回收站恢复不回溯补标;未来语义向量索引须把 tag 变更纳入失效联动。
- 合并后 tag 总上限仍为 12;实施前先修 `normalize_tags` 逗号问题(清洗阶段过滤或替换逗号),避免存取不一致。
