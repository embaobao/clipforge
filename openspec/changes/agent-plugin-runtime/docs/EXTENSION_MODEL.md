# ClipForge 扩展模型(信任分层与命名空间)

> 状态:随 agent-plugin-runtime 提案 draft(未实施)。回答一个问题:仓库里有几种「扩展/插件」,各信到什么程度,命名空间怎么分。
> 由来:2026-10-10 架构评审确认的动工前必补项——「插件」一词已被既有实现占用,需显式分层。

## 1. 信任分层(四档)

| 层 | 运行环境 | 信任级 | 现役例子 |
|---|---|---|---|
| 内建受信 | 宿主 Rust / 编译期 | 最高,随二进制分发 | 内置 AI 智能标签(L3)、内建内容动作 |
| WebView 内 TS(pi 扩展) | 前端进程,同源加载 | 受信(有 UI 与网络面,无任意 native) | pi Agent 运行时(src/agent/pi) |
| QuickJS power-pack(本提案) | Rust 沙箱,一插件一线程一 Runtime | 不可信(能力按声明注入、JSON 边界、预算+看门狗) | agent-plugin-runtime 插件 |
| 外部进程 Hook | 独立进程 | 不可信(进程边界) | external-hook-plugin-runtime(dormant) |

**Agent 本体(pi SDK)不并入插件沙箱**:它需要 provider 网络流式 UI 与交互,与沙箱的刻意剥夺(无 fetch、无定时器、JSON-only、8MB 内存顶)方向相反。收敛点是反向的:pi 扩展(受信 TS)与 power-pack(不可信 QuickJS)**共享同一套四插槽注册面**(见 §3);`ai.invoke` 是插件侧借宿主 AI 的桥。

## 2. 命名空间与现状

| 命名空间 | 归属 | 状态 |
|---|---|---|
| `clipboard.plugin.*`(MCP 工具) | 内建内容动作:src/plugin-actions.ts 的 ClipForgePluginManifest;builtin 槽位已发布,script/mcp/rpc/panel 槽位仅声明未实现 | 已冻结(specs.rs golden) |
| `plugin.<包名>.<工具名>` | QuickJS power-pack(本提案) | 本提案新增 |
| Hook 通道 | external-hook-plugin-runtime(Hook manifest V2 + 四态生命周期) | dormant(P3 冻结中) |

三者字符串不同,无运行时冲突。外部 Agent 在 `tools/list` 同时看到 `clipboard.plugin.*` 与 `plugin.<包名>.*` 时,靠条目 `source` 来源标记区分归属。

## 3. 统一注册面(四插槽 × 各 runtime)

| 注册类型 | 内建受信 | pi 扩展(TS) | power-pack(QuickJS) | 外部 Hook |
|---|---|---|---|---|
| 工具 | 直接进宿主 specs | pi Type.Object 工具(invoke 直调) | `ctx.register.tool` → `plugin.<包名>.*`(MCP + pi 双面) | 待定(Hook 提案) |
| 事件 | 宿主内部 | 前端事件桥 | `ctx.on`(有界队列,信封带 bytes/payloadKind) | 待定 |
| UI | 编译期 | React 组件(受信) | 声明式 surface 白名单(quick-panel-button/agent-tab) | 待定 |
| 提示词模板 | 内置注册表 | — | `ctx.register.template` | 待定 |

## 4. 归化路径与用词

- `clipboard.plugin.*`:v1 一行不动(golden 冻结面)。长期方向:内建动作保留在「内建受信层」作参照实现;若迁移为 power-pack 包,走独立提案 + 显式交接(golden 变更)。
- external-hook-plugin-runtime:与本提案正交(进程边界 vs 线程沙箱)。两者共用本文件的信任分层词汇;生命周期术语对齐(其四态 ↔ cordis 六态的映射)在 Hook 提案侧补。
- 面向用户文档的用词:本提案的 power-pack 称「插件」;`clipboard.plugin.*` 称「内建动作」;Hook 称「外部钩子」。避免裸用「plugin」一词指代多种机制。
