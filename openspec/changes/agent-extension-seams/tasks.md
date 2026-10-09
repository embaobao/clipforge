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
  - [x] 第 3 处:面板显隐域(2026-10-09 登记)——show_quick_panel/toggle_quick_panel/hide_quick_panel/panel_trigger_payload 在 lib.rs 与 L2 面板工具、MCP `clipf.panel.*` 各写一份;判定见「评估判据 3」→ 已满足,本提案触发实施(注册表→事件面→清单生成断言 顺序落地)
- [x] 面板显隐类问题诊断方法论登记(2026-10-09)——「面板自己消失/不丝滑」两步定位:(a) clipforge.jsonl 看 `window-event blurred` 的 front= 字段,blur 瞬间前台 app 切换=外部抢 key,没变=内部;(b) 用 Python Quartz CGEventTap(kCGSessionEventTap,ListenOnly) 监听会话级输入事件流验证静默;再以 CGEventSourceSecondsSinceLastEventType(CombinedSessionState,-1) 做运行时判据。淡出 stutter 的日志指纹:`blur detected` 与 `fade hide dispatched` 每 ~62ms 成对连续出现=连环 fade 重启。
