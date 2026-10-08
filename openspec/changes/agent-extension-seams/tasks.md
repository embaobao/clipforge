# Tasks:agent-extension-seams

> dormant 提案:以下任务在 proposal 判据三项全满足后才开工;登记用途见 Spec「dormant 维持」。

## Phase A 注册表(实施期第一步)

- [ ] `McpToolSpec` 增 `version` 字段,`tools/list` 按名稳定排序,金样快照测试冻结输出
- [ ] 各域导出 `tool_specs()` + `dispatch()`,`mcp/mod.rs` 改路由(依赖 modularity-refactor Phase 4 的 `mcp/mod.rs` 抽取)
- [ ] confirm 令牌绑定参数哈希 + TTL,覆盖式写回统一走该门禁

## Phase B 事件面(实施期第二步)

- [ ] 事件 bus trait + 有界 channel 实现(发布 <1ms,后台消费,分类型×订阅者丢弃计数进 get_diagnostics)
- [ ] 域层发布点接入:capture.finished/clip.updated/clip.trashed/clip.restored(仅 DB 提交后)
- [ ] 全量对账兜底命令 + trash/restore 成对语义
- [ ] 限速告警日志(每事件类型每分钟一条)

## Phase C 清单生成断言(实施期第三步)

- [ ] TS 工具清单生成脚本(读 Rust specs,check-in 生成物)
- [ ] test:unit 漂移断言(重新生成比对)

## dormant 期登记(现在就生效)

- [ ] L2/L3 同源重复实现计数登记(当前 2 处:clipboard 域、settings 域;每新增一处在此追加并评估判据 3)
