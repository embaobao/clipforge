# 提案：外部 Hook 插件运行时与受控内容回写（精简版）

## 状态

- 优先级：P3，排在剪贴板核心、多格式回写、详情编辑和基础 Agent 能力之后。
- 阶段：方案评审（2026-07-30 精简）。提案切为两块：
  - **Block A（读取侧收敛，可推进）**：把现有只读 collector 统一收敛到 Hook manifest V2、洋葱 priority、4 态生命周期、单个 MCP 试运行工具、节流约束和 spec 校验。
  - **Block B（写入侧，冻结）**：Proposal Store、Host Apply Service、`content.propose`、`clipboard.hook.apply`、`clipboard.content.write`。在出现“外部脚本需要改写剪贴板内容”的真实用户故事之前不实现，仅保留设计记录。
- 变更标识：`external-hook-plugin-runtime`。

## Why

现状的 `clipforge.application-context.collector.v1` 已经是一个**只读**外部脚本采集器：JSON stdio、路径越界校验、priority 串行、`collectedContext` 前序传递、敏感字段递归脱敏、延迟异步补写都已落地（见 `src-tauri/src/context_collectors.rs`、`context_collector_runtime.rs`）。它**没有直接写入能力**，当前也没有人要求加。

因此本提案的真正价值不是“防止 collector 被滥用写入”（原 Why 的这一表述不准确，已更正），而是两件具体的事：

1. **Block A**：把已存在的读取能力统一收敛为 Hook 上位概念（统一 manifest、生命周期、诊断、MCP 试运行），消除“collector”与未来“hook”两套并行命名带来的概念漂移，并把节流、4 态生命周期等现状缺失的护栏补齐。
2. **Block B（冻结记录）**：如果未来确实需要外部脚本改写剪贴板内容，预先定义“只提议、宿主执行、revision 校验”的安全回写边界，避免届时临时设计出错。在有真实场景前不实现。

## 背景

ClipForge 已经具备应用上下文、MCP、Agent 和外部采集器的部分基础，当前能力存在两个边界问题（原提案列了三个，其中“写入分裂”在现状中尚未发生，降级为 Block B 的预防性记录）：

1. “采集器”已经能读取上下文，但缺少统一的 Hook 命名、生命周期状态机和可观测诊断；现状是 collector 一套、未来 hook 又一套，容易概念漂移。
2. 外部脚本的节流、熔断和失败可观测性还没有统一宿主协议：当前有单脚本超时和敏感字段脱敏，但没有“单次捕获最多触发多少 Hook / 多久不能再次触发 / 连续失败熔断”的显式约束。
3. （冻结）若未来允许内容回写，直接写数据库或系统剪贴板会缺少提案、确认、版本校验和幂等边界——此项暂不实现。

Block A 把采集器收敛为外部 Hook 的一种 read-only capability，补齐节流、4 态生命周期和诊断；Block B 保留写入侧设计，冻结到有真实需求。

## 目标

### Block A（可推进）

1. 定义统一的 `External Hook Runtime` 概念，承接内置 Hook 和脚本 Hook 的只读采集生命周期。
2. 支持同一前台应用匹配多个 Hook，按 `priority` 串行执行（现状已实现核心链路，补诊断）。
3. 为外部脚本明确 manifest V2、JSON stdio 协议、沙盒限制、输入输出校验和错误隔离（大部分现状已具备，做命名与字段收敛）。
4. 补齐节流、连续失败熔断和 kill switch。
5. 提供单个 MCP 试运行工具 `clipboard.hook.run`，保留现有 `clipboard.context.*` 兼容入口并给出 deprecation 时间表。
6. 兼容现有 `clipforge.application-context.collector.v1`，通过 read-only adapter 接入，旧脚本无需重写。

### Block B（冻结，仅记录设计）

7. 定义内容 Proposal / Host Apply / revision-safe writeback / `clipboard.hook.apply` / `clipboard.content.write` 的安全边界。**不实现**，等真实用户故事触发后再立独立 change 解冻。

## 非目标

- 不把 ClipForge 改造成任意代码执行平台或插件市场。
- 不允许外部脚本直接访问 SQLite、React state、Tauri AppHandle 或系统剪贴板写接口。
- 不默认执行 shell、网络请求、打开应用、执行命令或自动粘贴。
- 不读取 Codex/ChatGPT 的 prompt、transcript、token、cookie、密码或内部 session 文件。
- 不在本提案中实现第三方模型 SDK、Tiptap AI 或远程插件市场。
- 不让异步 Hook 成为剪贴板捕获成功的前置条件。
- **不在 Block A 实现任何内容写入、Proposal、Apply 或 `clipboard.content.write`。**

## 核心原则

### 1. Hook 只提议，宿主执行
外部进程只能返回结构化结果。读取侧由宿主合并；写入侧（Block B 解冻后）由 Host Apply Service 执行。

### 2. 主路径优先
剪贴板基础采集、列表、搜索、复制和详情打开不等待外部 Hook。Hook 超时、崩溃、输出非法或权限不足，只影响当前 Hook。

### 3. 能力最小化
manifest 必须声明触发器、上下文字段、输出类型、权限和资源限制。未声明的字段和动作不能通过输入输出绕过校验。

### 4. 结果可审计
每次执行带 `traceId`、`requestId`、`hookId`、`hookVersion`、`permissionDecision`、`redactedFields` 和 `status`，日志只记录摘要，不记录完整正文和敏感字段。

### 5. 失败可降级
外部能力始终是增强层。基础上下文、原始剪贴板内容和用户手动编辑必须保留可用。

## 用户价值

- Chrome、VS Code、终端、Finder 等应用可以通过小 Hook 提供页面、工作区、Git 和选区上下文。
- Hook 崩溃、超时或连续失败只熔断自身，不影响剪贴板监听和主面板。
- 现有 collector v1 脚本无需重写即可继续运行，并通过统一诊断被观测。
- （Block B 解冻后）外部 MCP Agent 可读取上下文、试运行 Hook、预览回写内容，并通过一次明确确认完成写回。

## 成功标准

1. 一个应用可以安全匹配多个 Hook，执行顺序和每层结果可诊断（保留分层 provenance，不强制 conflict 诊断）。
2. Hook lifecycle 收敛为 4 态：`enabled / disabled / error / circuit-broken`。
3. 外部进程不能直接写入宿主数据库或系统剪贴板（Block A 不开放任何写入 capability）。
4. 剪贴板基础记录先落库，延迟 Hook 结果以 `pending/complete/partial/failed/skipped` 状态补写。
5. 单次剪贴板捕获触发的 Hook 数量、总链路耗时和触发频率有显式上限（节流）。
6. MCP `clipboard.hook.run` 能试运行 Hook 并返回结构化结果和诊断；`clipboard.context.*` 兼容入口有明确 deprecation 时间表。
7. 现有 collector v1 脚本不需要重写，通过 read-only adapter 继续运行。
8. `pnpm build`、`cd src-tauri && cargo check`、OpenSpec strict 校验和 Hook 隔离测试通过。

## 与现有方案的关系

| 现有方案 | 关系 |
| --- | --- |
| `openspec/specs/agent-runtime/spec.md` | 继承“插件、Agent、MCP 不能绕过宿主直接写入”的基础边界 |
| archived `context-plugin-agent-runtime` / archived `onboarding-to-settings-proposal` | 继承 Context Snapshot、插件 manifest、降级原则 |
| `ai-model-plugin-productization` | 只复用 Agent capability 和 provenance 原则，不在本 change 实现模型 provider |
| 当前 `clipboard.context.*` | 保留为兼容入口，给出 deprecation 时间表后由 `clipboard.hook.*` 承载 |
| 当前 `clipforge.application-context.collector.v1` | 作为 read-only collector adapter 兼容接入 |

## 方案评审问题（进入 Block A 实现前确认）

- 第一阶段是否只支持 macOS 外部 Hook，还是先保持跨平台 manifest、按平台提供 runner。（建议：manifest 跨平台，runner 先 macOS）
- 熔断阈值和自动恢复时间是否固定为 `3 次 / 5 分钟`，以及 kill switch 是全局还是单 Hook。（建议：单 Hook 熔断，全局 kill switch）
- 节流上限取值：单次捕获最多 N 个 Hook、总链路 1500ms、最小触发间隔。（建议：N=8、链路 1500ms、间隔跟随剪贴板写回抑制窗口）
- `clipboard.context.*` 兼容入口的 deprecation 时间表（建议：Block A 落地后保留 2 个 minor 版本，之后只保留 `clipboard.hook.*`）

## 实施顺序（Block A）

1. 先锁定 manifest V2、4 态生命周期、节流和错误码。
2. 再实现 Registry、Runner 校验器和 collector v1 read-only adapter。
3. 再接入异步捕获补写的状态机和熔断。
4. 最后接入单个 MCP `clipboard.hook.run` 和诊断。

Block B 的实施顺序在解冻时另立 change 定义，本提案不排其时间线。
