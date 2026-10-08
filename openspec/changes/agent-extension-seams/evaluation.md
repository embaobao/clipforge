# ClipForge 维护性深化与扩展性边界方案(主稿 v1,2026-10-08)

> 论证流程:本文为模型主笔初稿,经 GLM-5.3(newapi 网关)与 Kimi(kimi-cli)只读对抗评审、整合裁决后,codex 终审,落地为提案。

## 0. 目标与红线

**目标**:lib.rs(13410 行,76 command)持续收敛;前端两巨石(App.tsx 1373、settings.tsx 887)清零;L2/L3 工具同源接缝;异步 Agent 接入的事件钩子空间(设计态);全程可测试、性能不回退。

**红线(不可破)**:AI 不进热路径;不引入重型运行时;外部写回走 preview/confirm;豁免清单只减不增;每批实拆后 `cargo check` + `cargo fmt` + `pnpm test:unit` 全绿才勾任务。

## 1. 模块拆分深化(并入 codebase-modularity-refactor,W5)

### 1.1 现状地基(2026-10-08 实测)

| 域 | command 数 | 现状 |
|---|---|---|
| clip/capture 读写改 | 18 | 已有 `clipboard/` mod(mod.rs+payload+read+detect+storage+ingest+write 498+watcher) |
| settings 类 | 14 | `settings_service.rs`(484)+`settings_service/commands.rs`(329),**辅助函数链仍在 lib.rs** |
| 面板/窗口 | 13 | 全在 lib.rs |
| agent_* | 11 | 全在 lib.rs(provider 解析+run 状态机) |
| 日志/诊断 | 6 | 全在 lib.rs |
| accessibility / 更新 / mcp | 5/5/3 | 全在 lib.rs(`run_mcp_stdio`+`call_mcp_tool`+specs) |

### 1.2 Phase 3 收尾(本次实拆,~590 行出 lib.rs)

- `settings_service/mod.rs`:Service 门面——get/patch/replace/reset 公共流程(锁获取→validate→prepare→write→副作用同步→emit),替换散落在 commands.rs 的重复编排;**锁内规则:持锁期间不 emit、不跨 await、不做网络/子进程 I/O**,emit 一律在锁释放后(防订阅者重入死锁)。
- `settings_service/write.rs`:原子写 + `SETTINGS_WRITE_LOCK` **所有权迁入**;锁不对外暴露,**写路径唯一入口 = mod.rs 门面**(commands.rs/mcp.rs 均不得自行取锁),poisoned 语义收敛:返回 `SETTINGS_LOCK_POISONED` 并标记进程级 degraded(写禁用,读可用),需重启恢复;**锁层级表**:持 `SETTINGS_WRITE_LOCK` 期间仅允许再取 DB 写连接,禁止嵌套任何其他锁(§2.2a MCP dispatch 同样遵守,防慢 dispatch 拖垮面板写)。
- `settings_service/commands.rs`:七个 `settings_service_*` 薄壳保留,依赖引用从 `crate::` 切到 `super::`。
- `settings_service/mcp.rs`:`clipf.settings.*`/`clipf.agent.*` 的 MCP dispatch 分支迁入。
- 验收:lib.rs 净减 ≥550 行;settings_service 四文件各 ≤500;`verify-file-size` 还债提醒不变;命令签名零变化;**MCP dispatch 与错误路径 golden 用例先行**(迁移前后逐字节比对错误码/返回结构)。

### 1.3 Phase 4:agent/ 与 mcp/(下一批,**排在 pi-sdk L2 收尾之后**,两者同改 provider 解析/run 状态机,文件所有权写入任务卡串行防冲突)

- `agent/mod.rs`:provider 解析(含 redaction/keyRef)+ run 状态机 + 11 个 agent_* command;纯函数(解析/校验)与 command 壳分离。
- `mcp/mod.rs`:`run_mcp_stdio`+`call_mcp_tool`+**工具注册表化**——静态 `McpToolSpec` 数组改为每域 `fn tool_specs() + fn dispatch()`,mcp/mod.rs 只路由(见 §2.2)。
- 依赖:Phase 3 的门面模式先行,agent 复用同一锁与原子写设施。

### 1.4 Phase 5b/6(随后批次)

- App.tsx(1373):余量为状态粘合层,按既有 4 切片任务推进(useClipWriteback 接线/写回深链二批/search 域/UI JSX);settings.tsx(887)按 `sections/` 既有模式拆。
- Phase 6:`window.rs`(13 面板/窗口 command)、`logs.rs`(6)、tray/setup 收敛。
- 收敛纪律:**lib.rs 行数只减不增**——新 command 一律进域文件;tasks 逐批勾销;豁免清单 3→0 后门禁切全文件 fail 模式(既有任务)。

## 2. 工具面同源与异步 Agent 钩子(新提案 agent-extension-seams,W3)

### 2.1 问题

L2(pi 工具)与 L3(`clipf.*`)对同一领域能力各写一份;新增工具改两处;未来的异步 Agent 能力(自动打标规则层、语义索引增量、外部 hook Block A)没有统一的事件接入面,容易长成第三种运行时形态。

### 2.2 设计(接口态;实施受 dormant 判据约束)

**(a) 同源注册表**:Rust 侧每域暴露 `tool_specs() -> Vec<McpToolSpec>` 与 `dispatch(name, args) -> Result<Value, String>`;`mcp/mod.rs` 仅做路由与 preview/confirm 门禁。`McpToolSpec` 增 `version` 字段,`tools/list` 按**工具名稳定排序**,schema **只增不改**(additive-only)。preview/confirm 令牌绑定**参数哈希 + TTL**,防陈旧确认重放。L2 清单机制(两评审同构,裁决):**Rust specs 为唯一源 → 脚本生成 TS 清单并 check-in → test:unit 内重新生成比对断言**,不引构建期 codegen 依赖。工具同源(总纲 Requirement)由此获得工程载体;新增领域能力必须同时在注册表登记(写入 AGENTS.md 检查项,防第 3 处重复)。

**(b) 异步事件钩子**:域层在**数据库提交成功后**发布内部事件(`capture.finished`、`clip.updated`、`clip.trashed`、`clip.restored`);订阅者(未来:打标规则层、语义索引、hook Block A)注册回调。热路径契约:
- 发布 = 同步入有界 channel(预算 <1ms,等价一次 mutex+enqueue);**先提交后发布**,订阅者永不读半态;
- 消费在后台线程,P95 预算独立计量;满载**丢弃+按事件类型计数递增**(不反压热路径),计数暴露进 `get_diagnostics`;丢弃对「全量型订阅者」(如语义索引)不可接受,提供**全量对账兜底命令**(订阅方周期比对 last_seen 游标),丢弃只影响实时性不破坏最终一致;
- 订阅者失败静默降级,不弹错、不阻塞采集(AGENTS.md 热路径红线);
- 满载时**限速告警日志**(每事件类型每分钟一条),不建采样管线。

**(c) 可测试性**:域文件分「纯函数层(`&Connection` 入参)+ command 薄壳」,纯函数层直接单测;事件 bus 以 trait 注入,fake bus 断言事件序;现有 `#[cfg(test)]` 模式推广到新 mod。

**(d) 与冻结线的关系**:external-hook-plugin-runtime 的 Block B(写侧)维持冻结;本提案只固化事件面 trait 与注册表,**不做**插件沙箱、不做动态加载。

### 2.3 转实施判据(dormant)

1. W1 实机矩阵收口,`quick.*` P95 ≤300ms 基线稳。
2. 出现第二个事件订阅方(语义索引增量或自动打标判据之一达成)。
3. L2/L3 同源重复实现出现第 3 处(当前 2 处)。
三项齐 → 按「注册表 → 事件面 → 清单生成」顺序实施。

## 3. 请评审模型重点找茬

1. `SETTINGS_WRITE_LOCK` 所有权迁入 write.rs 后,跨域(agent 同锁?)与 poisoned 恢复语义有无漏洞。
2. 注册表化后 MCP `tools/list` 输出稳定性(schema 漂移、版本化策略)。
3. 有界 channel 丢事件的可观测性是否足够(计数之外要不要采样日志)。
4. L2 清单「生成」的具体机制(构建期脚本 vs 手工同步 + 校验断言)哪个更符合 boring 原则。
5. Phase 4 agent/ 抽取与 pi-sdk L2 收尾并行,接缝冲突风险。
6. 事件命名/载荷版本化(capture.finished 载荷演进时订阅者兼容策略)。
7. 方案遗漏的边界(回收站恢复、多窗口并发 settings 写、MCP stdio 与面板并发)。

## 4. 三方评审裁决记录(2026-10-08)

评审人:GLM-5.3(newapi 网关)、Kimi k2.7-code(Kimi For Coding 端点)。Codex 终审经用户指示跳过(其 CLI 平台包损坏,未修复);两轮对抗评审 P0 已全部闭环,由模型按 AGENTS.md 约束终裁。

| # | 来源 | 问题 | 裁决 |
|---|---|---|---|
| 1 | GLM P0 / Kimi P0 | 锁语义矛盾、死锁、poisoned | ✅ 合并采纳:门面唯一入口;锁内不 emit/不跨 await/无 I/O;锁层级表;**poisoned 不自动重建**(重建掩盖半态,degraded+重启),已写入 §1.2 |
| 2 | Kimi P0 / GLM P1 | 丢事件永久漂移 | ✅ 采纳:先提交后发布、clip.restored 成对事件、分类型×订阅者计数、全量对账兜底、限速告警日志(不建采样管线),已写入 §2.2b |
| 3 | GLM P1 / Kimi P1 | tools/list 漂移 | ✅ 采纳:version 字段+按名稳定排序+additive-only+金样快照测试 |
| 4 | GLM P1 | 丢更新 | ◐ 已有机制:settings_service_patch 的 `expected_revision` 乐观并发(现网已实现);多窗口默认 LWW+显式 revision 拒绝,登记用例 |
| 5 | GLM P1 | confirm 重放 | ✅ 采纳:令牌绑定参数哈希+TTL |
| 6 | GLM P1 / Kimi P1 | Phase 4 并行冲突 | ✅ 采纳:串行化,pi-sdk L2 先行 |
| 7 | Kimi P1 | 行为零变化过强 | ✅ 采纳:错误路径 golden 用例先行 |
| 8 | GLM P2 / Kimi P1 | 清单同步机制 | ✅ 同构裁决:生成物 check-in + test:unit 断言,拒绝构建期 codegen |
| 9 | Kimi P2 | spawn_blocking / fsync 债 | ✅ 登记 Phase 4 检查项与原子写 fsync 债 |
| 10 | Kimi P2 | 防第 3 处重复护栏 | ✅ 采纳:AGENTS.md 检查项(不加 lint 工具) |
| 11 | Kimi P2 | 事件载荷版本 | ✅ 采纳:Rust 内类型编译期兼容;仅跨进程(Block A)加版本信封 |

**P0 全部闭环,无未决分歧。**
