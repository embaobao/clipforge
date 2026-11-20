# Delta: 剪贴板监听可靠性（clipboard-listener-reliability）

> 纯 `ADDED Requirements`（本仓 `openspec/specs/` 无对应基线，MODIFIED/REMOVED 在归档合并时有静默丢失风险）。
> 本 delta 描述修复后的目标行为；不改 DB schema、不改 `content_hash` / fingerprint 算法、不引入无关改动。

## ADDED Requirements

### Requirement: 监听状态与采集事件可观测

应用 SHALL 以结构化日志记录监听生命周期与采集判定：暂停/恢复、环境变量禁用、watcher 启动/退出原因与重连、写回抑制窗口起止（带序号与截止时间）、detected 时同时记录原始与处理后指纹、capture/emit 失败与 read error 恢复。日志 SHALL 带实例标识，足以把「内容未变」与「没有采到」区分开。

#### Scenario: 静默期归因

- **WHEN** 出现一段没有 `detected change` 的静默期，盟哥查阅该时段日志
- **THEN** 能明确看到期间是「剪贴板内容未变」「监听被暂停」「抑制窗口生效」「watcher 退出并重连」或「采集失败」中的哪一种，而不需要猜测用户是否按过复制

#### Scenario: 抑制窗口可追溯

- **WHEN** 450 ms 与 700 ms 两次写回抑制在时间上重叠
- **THEN** 日志能看出每次窗口的开始、截止与序号，且窗口不会因另一窗口结束而被提前解除

### Requirement: 采集指纹只在成功后提交

watcher SHALL 在 capture **成功之后**才更新内存指纹；采集被设置过滤（Ok(None)）或 capture / emit 失败时 SHALL NOT 提交指纹，使下一次轮询可以重试而非永久跳过该内容。

#### Scenario: 单次采集失败可自愈

- **WHEN** 某次 `capture_clip_payload` 返回错误（如 `unexpected end of file`）
- **THEN** 该内容在下一次轮询被重新检测到并成功入库，不因一次失败而永久丢失

### Requirement: 启动不产生伪变化事件

应用启动时的剪贴板 priming SHALL NOT 在内容未变的情况下产生 `detected change` 日志、`clipboard-changed` 事件或 promoted 记录。连续多次启动且剪贴板内容不变时，detected 增量 SHALL 为 0。

#### Scenario: 连续启动

- **WHEN** 剪贴板内容保持不变，应用连续启动 10 次
- **THEN** 不产生 10 次强制 detected，日志与事件数不随启动次数线性增长

### Requirement: 写回抑制无竞态且不吞真实复制

写回抑制 SHALL 使用带截止时间/代际的单一守护，SHALL NOT 因多次调用叠加而提前解除，SHALL NOT 让应用自己写回的内容被当成新剪贴板内容采集（回环）；抑制窗口内用户真实复制的内容 SHALL NOT 被永久丢弃。

#### Scenario: 重叠窗口

- **WHEN** 连续触发两次写回（450 ms、700 ms 窗口重叠）
- **THEN** 保护持续到较晚的截止时间，期间不出现回环条目

#### Scenario: 窗口内用户复制

- **WHEN** 用户在抑制窗口内复制了与写回内容不同的新内容
- **THEN** 窗口结束后该内容仍能被轮询采集，历史中不缺该条

### Requirement: watcher 退出可恢复

`start_watch()` 意外返回或初始化失败时，应用 SHALL 记录退出原因并按退避策略重启监听，SHALL NOT 在无人察觉的情况下永久停止采集；连续失败达到阈值时 SHALL 以 error 级日志暴露状态。

#### Scenario: 故障注入

- **WHEN** 测试钩子让 watcher 线程退出
- **THEN** 日志出现退出原因与重连记录，监听在约定时限内恢复，后续复制可正常入库

### Requirement: 前端事件去重与刷新收敛

`clipboard-changed` SHALL 携带单调递增序号；前端 listener SHALL 用该序号丢弃乱序/重复事件，并 SHALL 具备节流与 in-flight 闸门。搜索/过滤视图刷新时 SHALL NOT 强制把选中态跳回首条，多个并发刷新 SHALL NOT 互相覆盖。

#### Scenario: 事件风暴

- **WHEN** dev 自动化探针以约 1.5 s 间隔触发大量 manual capture，持续 5 分钟
- **THEN** 前端 `search_clip_records` 调用次数低于事件数（有节流），列表选中态保持稳定，不出现可见抖动

#### Scenario: 内容未变但 promoted

- **WHEN** 同一内容被反复 promoted 并连续 emit
- **THEN** 前端不会因每个事件都做一次全量 200+ 行刷新

### Requirement: 暂停语义统一

监听暂停状态 SHALL 对前端可查询、可感知，且 SHALL 对全部采集入口生效：watcher 轮询、面板显示前补采、`capture_current_clipboard` manual/startup 采集。托盘暂停后 SHALL NOT 出现「后台停了但前端仍入库」的不一致。

#### Scenario: 托盘暂停

- **WHEN** 用户从托盘暂停监听后，前端触发 startup/manual 采集或唤起面板
- **THEN** 所有入口都不入库，且设置/状态栏能显示当前处于暂停态

### Requirement: 不改变既有数据契约

本修复 SHALL NOT 改动 `content_hash` / `clipboard_payload_fingerprint` 算法、DB schema、软删复活语义、设置项默认值或 `clipboard-data-integrity` 已裁决的哈希口径。「重复复制相同内容不置顶」（缺口 2）与「格式漂移多行」（缺口 3/4）SHALL 继续由该提案承接，本提案只提供日志证据与回归检查项。

#### Scenario: 回归既有行为

- **WHEN** 删除条目后重新复制相同内容
- **THEN** 条目按既有复活语义回到列表（`status=promoted`），不新增重复行、不报 UNIQUE 冲突

#### Scenario: 格式漂移

- **WHEN** 同一可见文本分别从富文本与纯文本来源复制
- **THEN** 行为与修复前一致（当前为两条独立记录），本提案不引入哈希口径变更

### Requirement: 验证可证伪

修复验收 SHALL 提供针对两类异常的量化证据：A 类需构造「内容确已改变」的配对场景，B 类需构造「同一内容反复 detected/promoted」并对比事件数与 DB 行数。SHALL NOT 以「静默期没有日志」「当前 DB 无重复行」「watcher 没打 stopped」单独充当结论。

#### Scenario: 验收审查

- **WHEN** 盟哥按 `tasks.md` 第 5 节逐条核对
- **THEN** 每条完成项都有日志时间戳、计数或命令输出，且明确区分【证】/【验】/【反】
