# 任务：外部 Hook 插件运行时（Block A：读取侧收敛）

> 2026-07-30 精简：任务切为 Block A（可推进）与 Block B（冻结）。Block B 任务列出但标注冻结，不计入 Block A 完成度。原 90 项任务收敛为 Block A 的精简集。

## Phase 0：方案评审与边界冻结

- [ ] 确认 `External Hook Runtime` 作为采集器的上位概念，Block A 只收敛读取侧
- [ ] 确认默认关闭 `captureExternalContextOnClipboard`
- [ ] 确认第一阶段平台范围（建议：manifest 跨平台，runner 先 macOS）
- [ ] 确认熔断阈值（`3 次 / 5 分钟`）、恢复时间和 kill switch 范围（单 Hook 熔断 + 全局 kill switch）
- [ ] 确认节流上限取值（建议：单次捕获 N=8、总链路 1500ms、间隔跟随写回抑制窗口）
- [ ] 确认 `clipboard.context.*` 兼容入口 deprecation 时间表（建议 2 个 minor 版本）
- [ ] 确认 Block B 冻结，不在本 change 实现写入侧

## Block A：读取侧收敛（可推进）

### Phase 1：协议与类型契约

- [ ] 定义 `clipforge.application-hook.v1` 协议版本和兼容策略
- [ ] 定义 `HookManifest`、`HookCapability`（仅 `context.read/context.patch/response.emit`）、`HookTrigger`
- [ ] 定义 4 态 `HookLifecycleState`：`enabled/disabled/error/circuit-broken`
- [ ] 定义 `HookInput`、`HookOutput`、`ContextPatch`、`HookDiagnostic`
- [ ] 定义统一 `traceId/requestId/businessChain/permissionDecision/redactedFields` envelope
- [ ] 定义敏感字段递归脱敏、正文长度和字段访问策略（沿用现状 `redact_sensitive`）
- [ ] 为协议增加中文文档注释和 JSON fixtures

### Phase 2：Registry 与 4 态生命周期

- [ ] 新建 Hook Registry，支持 builtin/script manifest（mcp/agent adapter 后置）
- [ ] 复用现状 manifest schema、路径越界、版本校验（`load_manifest` / `resolve_executable`）
- [ ] 实现 `enabled <-> disabled`、`enabled/error -> circuit-broken` 状态转换
- [ ] 实现按应用、触发器、内容类型和权限的匹配（沿用 `collector_matches`）
- [ ] 实现 priority 排序（沿用现状）
- [ ] 实现启用、禁用、临时熔断和全局 kill switch 状态
- [ ] 为 Registry 增加 list、diagnostics 和 health 测试

### Phase 3：Sandbox Runner 与结果校验（现状收敛）

- [ ] 沿用独立子进程 Runner `run_json_command`，确认不经过 shell 拼接
- [ ] 确认 executable、cwd、环境变量、stdin、stdout、stderr 和 timeout 限制
- [ ] 沿用 JSON parse、schema、大小、MIME 校验（`validate_collector_output`）
- [ ] 沿用 context namespace allowlist 和敏感字段保护（`redact_sensitive`）
- [ ] 补未知 action、未知 MIME、路径越界的显式错误码
- [ ] 补超时、崩溃、非零退出和非法输出的统一错误码
- [ ] 增加单 Hook 隔离测试

### Phase 4：洋葱执行与兼容 Collector

- [ ] 沿用多 Hook 同应用匹配和 priority 顺序（`collect_external_contexts`）
- [ ] 沿用 `collectedContext` 前序上下文传递
- [ ] 补分层 provenance：最终 snapshot 保留每层 `hookResults` 和 `diagnostics`
- [ ] 沿用单层失败后继续后续层的策略
- [ ] 将 `clipforge.application-context.collector.v1` 接入 read-only adapter
- [ ] 迁移 Chrome 示例为 Hook manifest，同时保留 collector 示例
- [ ] 增加多 Hook fixture：Chrome active tab + workspace

### Phase 5：异步捕获、延迟补写、节流与熔断

- [ ] 沿用基础剪贴板捕获先落库并返回（`schedule_delayed_collection`）
- [ ] 沿用 `captureExternalContextOnClipboard` 默认关闭策略
- [ ] 沿用 `not-requested/pending/complete/partial/failed/skipped` 状态
- [ ] **新增节流**：单次捕获 Hook 数上限、总链路预算、最小触发间隔
- [ ] **新增熔断**：连续失败计数、`circuit-broken` 状态、恢复窗口
- [ ] **新增全局 kill switch**
- [ ] 沿用按 `expectedRevision` 更新 `capture_context_json`（删除竞态处理）
- [ ] 记录每层 Hook 结果、诊断、耗时和 redaction 摘要（JSONL 标准格式）
- [ ] 验证延迟写入不改变剪贴板热路径 P95

### Phase 6：MCP Surface（单工具）

- [ ] 新增 `clipboard.hook.run`（试运行，返回上下文 + 诊断 + envelope）
- [ ] 保留 `clipboard.context.live`、`clipboard.context.collectors.list`、`clipboard.context.collector.debug` 兼容入口
- [ ] 为 `clipboard.hook.run` 提供 schema、错误 hint 和日志 trace
- [ ] 文档标注 `clipboard.context.*` 的 deprecation 时间表
- [ ] 增加 JSON-RPC tools/list、run、节流 skip fixtures

### Phase 7：UI、文档与开发者体验

- [ ] 详情页显示 Hook pending/partial/failed 状态，不阻塞内容查看
- [ ] 设置页提供外部 Hook 总开关、剪贴板延迟采集开关和权限诊断
- [ ] 增加 Hook 日志筛选、失败原因、熔断状态入口
- [ ] 更新 `docs/application-context-collectors.md` 为 Hook/collector 兼容指南
- [ ] 提供 Chrome、VS Code/Workspace、Terminal/Git 三个示例

### Phase 8：验证与发布门禁

- [ ] `pnpm openspec validate external-hook-plugin-runtime --strict`
- [ ] `pnpm openspec validate --changes --strict`
- [ ] `pnpm build`
- [ ] `cd src-tauri && cargo check`
- [ ] `cargo test --lib` 覆盖 Registry、Runner、Validator、Onion、Throttle、Circuit
- [ ] 验证 Hook 崩溃、超时、非法输出不影响主面板、监听、搜索、详情和复制
- [ ] 验证外部 Hook 不能直接访问 SQLite 或系统剪贴板写接口
- [ ] 验证 `prompt/transcript/token/cookie/password/secret/apiKey` 递归脱敏
- [ ] 验证基础捕获先返回，异步上下文最终按 revision 补写
- [ ] 验证节流：快速复制不 spawn 超量子进程
- [ ] 验证熔断：连续失败后 Hook 被 skip，其他 Hook 正常
- [ ] 验证 macOS Automation 权限缺失时内置上下文仍能安全降级
- [ ] 记录未完成的真实桌面权限、外部脚本和多应用实机验证，不虚报完成

## Block B：写入侧（冻结，不在本 change 实现）

> 以下任务列出仅为记录冻结的设计范围。解冻条件：出现“外部脚本需要改写剪贴板内容”的真实用户故事。解冻时另立 change，重新评审。

- [冻结] Proposal Store：短期 proposal 存储、TTL、client 绑定和状态机
- [冻结] representation allowlist、大小校验和 hash 重算
- [冻结] `clipforgeItem`、`systemClipboard`、`both` 三类 target
- [冻结] `confirmed`、`expectedRevision` 和幂等 `requestId`
- [冻结] Host Apply Service：历史条目更新、系统剪贴板写入和双写顺序
- [冻结] revision conflict、proposal expired、permission denied 错误
- [冻结] `content.propose` capability 解禁
- [冻结] MCP `clipboard.hook.proposals`、`clipboard.hook.apply`、`clipboard.content.write`
- [冻结] 详情页 proposal 预览、目标、差异、来源和确认结果 UI
