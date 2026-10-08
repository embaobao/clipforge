# 提案:Agent 扩展接缝(agent-extension-seams)

> 所属波次:W3(pi-sdk-agent-foundation 收尾之后的工具面工程化),见 [product-iteration-master-plan](../product-iteration-master-plan/proposal.md)。
> 论证与评审记录:[evaluation.md](./evaluation.md)(GLM-5.3 + Kimi k2.7 对抗评审,2026-10-08;Codex 终审经用户指示跳过)。

## 状态

接口设计类提案(P1)。**当前 dormant**:固化「L2/L3 工具同源注册表」与「异步 Agent 事件钩子」的接缝契约,不实现运行时;转实施受 §判据 约束。

## Why

- L2(pi 工具)与 L3(`clipf.*`)对同一领域能力各写一份,新增工具要改两处,总纲「工具同源」Requirement 缺工程载体;
- 未来的异步 Agent 能力(自动打标规则层、语义索引增量、external-hook Block A)没有统一事件接入面,放任会长成第三种 Agent 运行时形态(总纲红线);
- 本提案把「接缝」先于「实现」固定下来,后续任何订阅方按同一契约接入。

## What Changes

- **同源注册表**:Rust 每域导出 `tool_specs()` + `dispatch()`,`mcp/mod.rs` 只路由与 preview/confirm 门禁;`McpToolSpec` 增 `version`、`tools/list` 按名稳定排序、schema additive-only;confirm 令牌绑定参数哈希 + TTL;L2 TS 清单由 Rust specs 生成(check-in + test:unit 漂移断言,不引构建期 codegen)。
- **异步事件钩子**:域层在 DB 提交成功后发布 `capture.finished`/`clip.updated`/`clip.trashed`/`clip.restored`;有界 channel,发布 <1ms,消费在后台线程;满载丢弃 + 分类型×订阅者计数 + 限速告警日志 + 全量对账兜底命令;订阅者失败静默降级。AI 调用永不进热路径。
- **可测试性**:域文件分纯函数层(`&Connection`)+ command 薄壳;事件 bus trait 注入;跨进程(Block A)载荷加版本信封。
- **不做**:插件沙箱、动态加载、Block B 写侧解冻(external-hook-plugin-runtime 冻结线不变)。

## 判据(dormant → 实施,三项全满足)

1. W1 实机矩阵收口,`quick.*` P95 ≤300ms 基线稳;
2. 出现第二个事件订阅方(语义索引增量或 automated-tagging-eval 转实施);
3. L2/L3 同源重复实现出现第 3 处(当前 2 处)。

满足后按「注册表 → 事件面 → 清单生成断言」顺序实施;实施含 Phase 4(mcp/ 抽取)同步落地,排期在 pi-sdk L2 收尾之后(文件所有权串行)。

## 风险

- 注册表分散后 schema 漂移 → 金样快照测试冻结 `tools/list` 输出;
- 慢订阅者反压热路径 → 有界丢弃 + 对账兜底,绝不反压;
- 事件语义被滥用成 RPC → 契约限定「通知型、无返回值」,请求-响应一律走 MCP 工具面。
