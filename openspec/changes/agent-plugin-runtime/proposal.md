# 提案:agent-plugin-runtime(插件化 Agent 能力运行时)

> 前身:agent-self-evolution(2026-10-09 起草,2026-10-10 经 grilling 评审重构为提案)。
> 核心结论变更:脚本化插件 ✓;接口照搬 cordis 概念但不搬 cordis 库;引擎一步到位 rquickjs;
> 插件工具走动态注册口,不并入宿主 specs.rs。
> 配套文档:[docs/PLUGIN_DEV_GUIDE.md](docs/PLUGIN_DEV_GUIDE.md)(插件开发指南)、[docs/API_REFERENCE.md](docs/API_REFERENCE.md)(ctx/powerpack/错误码 API 参考)、[docs/EXTENSION_MODEL.md](docs/EXTENSION_MODEL.md)(信任分层与命名空间)、[docs/architecture.html](docs/architecture.html)(整体架构图·全中文标注 + 白话拆解 + 打标场景步进预演)。

## Why

ClipForge 的 Agent 能力已沉淀三层(L1 内嵌动作、L2 MCP 工具、L3 智能标签),但用户与 Agent 无法在运行期扩展能力:想加一个悬浮窗按钮、一个 Agent 面板 tab、一段提示词模板或一个新工具,只能改源码重编。本提案引入插件化运行时:Agent 在受控沙箱里生成、验证、安装插件包,用户确认后生效,全程可审计、可回滚。

## What Changes

- **宿主生命周期骨架:cordis-rs**(crates.io 包名 `cordis-rs`、lib 名 `cordis`,dshbox 维护;Koishi cordis 血统的 Rust 移植,2026-10-10 调研+实测)。插件实例=cordis Fiber(六态状态机 Loading/Active/Pending/Unloading/Failed/Disposed,Failed 非终态可 restart;`Context::spawn` 准入、`FiberHandle::dispose` 确定性清理、Service 迟到自动收敛),宿主能力注入=typed Service,域事件=typed Event(与 seams 事件面契约同构)。质量证据:171 个测试文件/loom 专用测试道/16 ADR;本机 rustc 1.94.1 实测 6.6s 全量编译、spawn→emit→dispose 全链路跑通、依赖仅 tokio/parking_lot/thiserror/futures、与现有 Cargo.lock 无冲突。
- **插件 JS 引擎:rquickjs 0.14**(quickjs-ng 的 Rust 绑定;一插件=一线程+一 Runtime,句柄默认 !Send 由类型系统钉死)。选型依据:二进制增量 strip 后约 +1~3MB(引擎本体 0.7–1.2MB;对比 Bun +67.7MB / Node +102MB),引擎随应用分发,零外部运行时依赖;插件编排型负载瓶颈在 Rust 域层,引擎吞吐差异(QuickJS vs Bun ~40x)对用户无感;每 MB 内存性能分 899 vs Bun 762。
- **接口层(cordis 概念,原生件+薄桥)**:插件面对的唯一全局对象 `ctx`——能力按命名空间属性暴露(manifest 声明决定存在性,`ctx.clipf.search` 等)、`ctx.on`(订阅已声明事件)、`ctx.register.{tool,ui,template}`、`ctx.log`;由 plugin_runtime 模块把 cordis-rs 的 Service/Event/Fiber 语义桥接为 QuickJS 内可见的 JS 对象。完整接口契约见 [design.md](design.md),四件套(ctx 方法集/manifest schema/事件信封/能力分级边界)进 golden 冻结。自研面收窄为这一层桥,生命周期/清理/收敛不再自研。
- **能力沙箱(接口不可见即无能力)**:manifest `capabilities` 声明所需宿主能力(如 `clipf.search`),宿主按声明注入接口对象;未声明的能力对象在插件全局中不存在(拿不到 ≠ 被拒绝)。无豁免概念,面向接口即沙箱边界。**能力分级授权**:读=启用即可用;元数据写(打标)=安装时一次性授权,无逐次 confirm;内容写/删除/粘贴回写=逐次 confirm。
- **双层工具口(与宿主 MCP 解耦,双消费者面)**:宿主 `mcp/specs.rs`(40 条稳定契约,golden 冻结)一行不动;新增**插件工具注册口**——动态命名空间 `plugin.<包名>.<工具名>`,装包注册/卸包注销,MCP `tools/list` 聚合时拼接并带来源标记(聚合只读宿主侧注册表快照,不 round-trip 插件线程),坏插件可单独禁用不伤宿主契约;**前端 pi Agent 经 `list_plugin_tools`/`invoke_plugin_tool` 两个 additive Tauri 命令消费同一快照**(pi 侧 clipForgeTools() 动态合并),三类消费者能力面对齐(design §7 消费者矩阵)。插件管理与调试(powerpack.list/install/uninstall/logs)走宿主 MCP 暴露。
- **插槽=注册类型,非插件类型**:插件只有一种——一个包一个功能一条生命周期;四类注册类型=工具(注册 MCP 工具)、事件(订阅 capture.finished 等,走 agent-extension-seams 事件面契约)、UI(悬浮窗底部按钮 / Agent 面板 tab)、提示词模板(独立注册类型),同一插件在 activate 内任意组合。接口先定;**tag 场景(规则自动打标)作为首个端到端验证场景随附示例插件**,兼作接口活文档(见 design.md §13)。
- **Agent 自迭代回路**:MCP 工具 `powerpack.scaffold`(生成脚手架)→ `powerpack.validate`(manifest schema + 宿主 dry-run)→ 用户交互确认安装(逐次审批,无信任豁免)→ 生效/回滚。安装完全由 Agent 发起、用户交互确认。
- **提示词模板管理**:内置模板 + 插件模板统一注册表,用户覆盖层,设置页查看/编辑/导入导出。
- **插件配置与自检**:manifest `config`(JSON Schema 子集)驱动——设置页「插件」分区 schema 驱动表单 + `powerpack.config.get/set`(set 逐次 confirm);config.json 原子写、损坏自愈回退 default;`powerpack.doctor` 自检修复注册表漂移(孤儿条目/暂存区残留)。
- **开发与调试契约**:`powerpack.scaffold` 返回骨架 + 当前能力/事件清单(能力面唯一事实,Agent 不猜接口);错误码 `PLUGIN_<域>_<原因>` 稳定前缀表(design §15,进 golden),MCP error data 带 JSON Pointer/JS 栈,Agent 凭错误码+pointer+stack 自闭环修复;调试三板斧=错误码+栈+日志(quickjs-ng 无源码级调试器,不承诺)。
- **日志排查**:插件边界事件全落现有 `clipforge.jsonl`(context=`plugin:<id>`,复用异步通道与截断清理);`powerpack.logs` 按 pluginId 精确过滤(`query_app_logs` 增可选 context 参数,additive);症状→查法手册进 design §16.3。
- **发布与分发(v1)**:本地包 tar.gz + blake3 校验和(复用现有依赖),install 校验和不符拒绝(`PLUGIN_CHECKSUM_MISMATCH`);无中心 registry,远程来源留 manifest `source` 字段(additive)不实现。
- **内存与资源管理细则**:一插件=一线程+一 AsyncRuntime+一 Context(!Send 纪律,parallel feature 禁用);内存三层强制链(set_memory_limit——禁 rust-alloc/allocator,否则失效 + memory_usage 巡检兜底 + 超限强制回收,Fiber 停靠 failed、重启=显式 enable;状态语义单一化:degraded 仅指事件预算降级位);双层看门狗(interrupt handler 管 CPU 循环 + tokio timeout 管 await 挂起);Context 必须先于 Runtime 销毁;**能力返回方向同受上限**(read 默认截断 256KB、opt-in ≤ min(memoryLimit/4, 2MB),事件信封带 bytes/payloadKind 供插件预过滤);启用插件数(≤16)与聚合内存(≤128MB)设门禁。
- **全链路预演**:design §19 固化「开发定义→调试报错→日志排查→发布→安装生效→生命周期→内存管理」的 Agent 视角时序图与七个可验收断点,作 §13 示例插件之外的第二验收参照。

## Capabilities

### 新增 specs

- `plugin-runtime`:插件发现、manifest 校验、安装/卸载/回滚生命周期、rquickjs 沙箱契约、能力注入、双层工具口聚合。
- `plugin-slots`:工具/事件/UI 三插槽的渲染与分发契约。
- `prompt-template-management`:提示词模板注册、覆盖、导入导出(自 agent-self-evolution 迁入)。

## Impact

- 代码:`src-tauri/src/`(新增 plugin_runtime 门面模块 + Cargo.toml 加 `cordis-rs = "=0.11.1"` 精确 pin、`rquickjs = "0.14"`(features 取 loader/futures/classes/properties,**禁** rust-alloc/allocator/parallel)与 `rquickjs-serde`(版本锁齐;勿混入同名第三方 `cordis-rs-core` 生态)、**tokio 显式直依赖**(design §18.3 timeout 用,与 tauri 内部 tokio 版本对齐声明))、`query_app_logs` 增可选 context 参数、powerpack.* 登记 specs.rs + mcp/mod.rs golden 计数 + verify-mcp-dispatch 三处同步、`list_plugin_tools`/`invoke_plugin_tool` 两个 additive Tauri 命令(前端 pi Agent 插件工具通道)、`src/agent/`(插槽渲染 + 工具动态合并)、`src/settings/`(提示词分区 + 插件分区)。cordis-rs 类型不出 plugin_runtime 模块边界。
- 与 `agent-extension-seams`:插件事件名对齐 seams 已发布事件清单,载荷信封以本提案 design §6 自持定义(seams 落地后对齐);插件工具走独立动态注册口,**不消耗** seams 同源计数(seams 管的是宿主域工具的两面同源,插件工具是动态第三方)。seams 提案补边界说明。
- 与既有扩展轨的边界(「插件」一词澄清):仓库已有内建内容动作(`src/plugin-actions.ts` ClipForgePluginManifest + MCP `clipboard.plugin.list/call`,已发布)与 dormant 的 external-hook-plugin-runtime(Hook manifest V2);本提案的 power-pack 是第三轨——不可信 QuickJS 沙箱。统一信任分层、命名空间表与归化路径见 [docs/EXTENSION_MODEL.md](docs/EXTENSION_MODEL.md);`plugin.<包名>.*` 与 `clipboard.plugin.*` 字符串不同、无运行时冲突,归化决策走独立提案。
- 性能红线:插件初始化、事件分发、工具调用全部异步于热路径;AI/插件调用永不阻塞剪贴板采集与面板唤起;单插件内存上限(manifest 声明,rquickjs memory_limit 强制)。
- 风险与护栏:(1) cordis-rs 为 pre-1.0 单人维护项目(反向依赖 3 个均为第一方仓,无第三方下游;SLoC 核实 core 约 15.5K),护栏=plugin_runtime 门面隔离(cordis 类型不出模块)+ `=0.11.1` 精确 pin(升级走显式评审)+ 最坏可 fork(MIT、测试厚);spike 出口判据:无论过闸与否,先把门面内生命周期 trait(六态/dispose/收敛)编译期落位,使降级是「换实现」而非「补接口」;(2) Fiber×rquickjs 桥接是本提案最薄也最险的一层,Phase 1 spike 为**验收闸门**:一个 Fiber 内嵌 rquickjs、桥接 ctx 四组接口、dispose 确定性清理、memory_limit 超限,**时间盒 1 周,打架或超时即降级为门面内自研等价实现**(上层接口不变,退路是设计出来的)。**闸门结论(2026-10-27,过闸)**:cordis 0.11.1 + rquickjs 0.14 路线可行,不触发降级——`bridge_spike_gate` 测试四断言全绿(四组接口桥通、dispose 回收观测达标、64KB 上限强制中断、超限 Fiber 收敛 Failed 可 dispose),另验证 `update(输入替换)` 同 Fiber 换代成功。两条实测约束落进 design §18.1/§18.2:①cordis `apply` future 强制 `Send`,与 rquickjs 句柄 `!Send` 的组合方式 = QuickJS episode 在 apply 内 `block_on` 单次 poll 同步收敛;②裸 QuickJS Context 创建分配 >64KB,`set_memory_limit` 必须在 Context 建成后设置(上限语义=运行期分配记账);空 Runtime 固定基线 27808 字节。(3) Agent 生成插件的代码质量靠 validate 门禁兜底,生成即用不等于免测;(4) rquickjs 绑定 quickjs-ng(C 构建),本仓首次引入 C 编译面,交叉编译/CI 工具链 Phase 1 spike 实测;set_memory_limit 在 rust-alloc/allocator feature 下为 Noop、parallel feature 实验性——两者已列禁用。

## 备选方案否决记录

**2026-10-10 调研否决:外部「Wails(Go)+ Node.js sidecar 悬浮 Agent 架构」**(经 6 路子代理调研 + 对抗复核核验)。

- 论据一「Tauri 跑 Node 插件避不开 sidecar,多一层 IPC」:前半成立、结论反向。sidecar 机制 **Tauri 有官方背书**(`externalBin` + `tauri-plugin-shell` + 官方《Node.js as a sidecar》指南),Wails 无等价物(维护者答复仅 `go:embed`,discussion #3021)。真需要 Node 生态时在现壳内走 sidecar 即可,不构成换壳理由。
- 论据二「穿透 JS API 受限,必须写 Rust 调 Win32/Cocoa;Wails 更直接」:**错误且方向相反**。`@tauri-apps/api` v2(本项目实装 2.11.1)有三平台 `setIgnoreCursorEvents`,tao 0.35.3 底层即 `WS_EX_TRANSPARENT|WS_EX_LAYERED` / `NSWindow.setIgnoresMouseEvents`;Wails 稳定版 v2 无该 API(#2969 以「等 v3」关闭),v3 至 beta.28 且 Windows「逐像素透明+穿透」互斥为 open bug #6088。
- 论据三「三套环境维护成本高」:对 ClipForge 不成立。现役 Agent 运行时(pi SDK)跑在 WebView 前端 JS,零 Node 依赖;换壳 = Rust 侧 19,047 行全部重写(约 10,300 行平台胶水零复用,含 NSPanel 淡出/幻影 blur 自愈/AX 焦点/粘贴时序等已修复 bug 累积),全功能对等估 16-30 人周。
- 与本提案的关系:rquickjs 选型(二进制 +1.3MB vs Node sidecar +102MB)经此调研再次确认;项目 2026-09 已有一次「Node sidecar 过重 → 改 WebView 内 pi SDK」的决策(pi-sdk-agent-foundation),重开子进程路线需正面回应该记录。若未来启用点击穿透:capabilities 加 `core:window:allow-set-ignore-cursor-events` 一行 + 前端一次 JS 调用即可,与换壳无关。
