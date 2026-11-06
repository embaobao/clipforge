# plugin-runtime 规格增量

## ADDED Requirements

### Requirement: 插件引擎为内嵌 QuickJS

系统 SHALL 使用 rquickjs(QuickJS 的 Rust 绑定)作为插件 JS 引擎,每插件一个独立 Runtime 实例,随应用二进制分发,不依赖用户侧任何外部 JS 运行时。

#### Scenario: 零外部依赖即用

- **WHEN** 用户机器上不存在任何 Node/Bun/Deno 运行时
- **THEN** 插件功能完整可用,引擎随 ClipForge 二进制分发

### Requirement: 插件实例隔离

每个插件 SHALL 持有独立引擎实例与独立全局作用域;一方崩溃或超限 SHALL NOT 影响其他插件与宿主进程。

#### Scenario: 坏插件不伤宿主

- **WHEN** 插件 A 执行死循环或触发引擎崩溃
- **THEN** 插件 B 与宿主面板、剪贴板采集不受影响,A 被标记失败并可单独卸载

### Requirement: 插件状态语义单一

宿主插件状态面 SHALL 单一语义:`failed`(activate 抛异常/内存超限/引擎崩溃,Fiber 停靠,重启=显式启用)与 `degraded`(事件预算超限降级,插件仍 Active、工具仍可调,队列清空自动回升)SHALL NOT 混用;状态字符串 SHALL NOT 携带原因字段,原因 SHALL 经日志查询。该状态迁移 SHALL 进 golden。

#### Scenario: 内存超限停靠 failed

- **WHEN** 插件内存消耗超过 memoryLimit 触发三层链处置
- **THEN** 插件标记 failed(非 degraded),不自动重启;用户显式重新启用后新 spawn 恢复

#### Scenario: 事件降级不影响工具

- **WHEN** 插件事件回调超预算处于 degraded
- **THEN** 该插件事件被丢弃降级,但其注册的工具仍可正常调用

### Requirement: 单包组合多注册类型

插件 SHALL 为唯一种类:一个包=一个功能=一条 Fiber 生命周期;工具/事件/UI/模板 SHALL 为可组合的注册类型,同一插件 SHALL 允许在 activate 内注册任意多类并在 dispose 时一并回收;manifest `slots` SHALL 为声明索引,允许为空(纯事件/能力插件)。

#### Scenario: 单插件组合注册

- **WHEN** 插件同时声明 tools、ui 与 events 并在 activate 内全部注册
- **THEN** 单包单生命周期承载全部注册,dispose 时一并回收,无需按注册类型拆包

### Requirement: 宿主生命周期运行时经门面隔离

宿主侧插件生命周期(准入、收敛、确定性清理)SHALL 采用 cordis-rs 作为骨架,并收敛于 plugin_runtime 门面模块内:cordis-rs 类型 SHALL NOT 泄漏到模块之外;依赖版本 SHALL 精确锁定( cargo `=` pin),升级走显式评审。桥接闸门(cordis Fiber 内嵌 rquickjs、ctx 方法桥、dispose 清理、内存上限)失败时,SHALL 在门面内部降级为自研等价实现,门面对上层暴露的接口保持不变。

#### Scenario: 闸门失败不推翻上层设计

- **WHEN** Phase 1 桥接闸门在时间盒内未通过
- **THEN** plugin_runtime 门面接口不变,内部切换自研生命周期实现,Phase 2+ 任务继续

### Requirement: 内存上限强制

系统 SHALL 按 manifest 声明的 memoryLimit 对每个插件 Runtime 强制内存上限;超限 SHALL 中断该插件并使宿主进程保持稳定;启用插件数量与聚合内存 SHALL 设门禁,超出门禁的 install/enable SHALL 被拒绝。

#### Scenario: 超限中断不崩宿主

- **WHEN** 插件内存消耗超过其声明上限
- **THEN** Runtime 中断执行,该插件标记 failed 并停靠(不自动重启),宿主与其他插件正常运行

#### Scenario: 启用数量门禁

- **WHEN** 启用插件数超过 16 或聚合 memoryLimit 之和超过 128MB
- **THEN** install/enable 被拒绝并报 `PLUGIN_TOO_MANY_PLUGINS`,已启用插件不受影响

### Requirement: 插件输入输出隔离主进程

插件与宿主间全部数据交换 SHALL 经序列化边界(JSON 值副本)与大小上限约束(含能力调用返回方向:read 默认截断、显式 opt-in 设上限);任一插件的超限/超时/序列化失败 SHALL 仅使其自身调用失败,SHALL NOT 影响主进程与其他插件;插件日志 SHALL 限流并写入统一 jsonl(带 pluginId);工具入参 SHALL 在进入 handler 前经宿主侧最终校验;事件信封 SHALL 携带条目体积信息供插件预过滤。

#### Scenario: 超大返回值不伤宿主

- **WHEN** 插件 handler 返回 10MB 字符串
- **THEN** 桥接层序列化超限,该次调用报错返回,宿主内存与调用方不受影响

#### Scenario: 超大条目读取被截断

- **WHEN** 插件 read 不带 maxLen 读取 5MB 剪贴板条目
- **THEN** 返回默认截断(256KB)+ contentLength/truncated 字段,插件可按需 opt-in 分页,单次调用不触发内存超限

#### Scenario: 非法入参到不了 handler

- **WHEN** 工具调用入参不符合其注册的 inputSchema
- **THEN** 宿主侧最终闸门拒绝并返回错误,handler 未被执行

#### Scenario: 日志疯写不拖垮主进程

- **WHEN** 插件以每秒万条频率调用 ctx.log
- **THEN** 限流生效,溢出丢弃并计数,主日志通道与其他插件不受影响

### Requirement: 能力按声明注入

系统 SHALL 依据 manifest `capabilities` 声明向插件注入宿主能力接口对象;未声明的能力对象 SHALL NOT 存在于插件全局作用域(不可见即无能力),无任何豁免通道。

#### Scenario: 未声明能力不可见

- **WHEN** 插件 manifest 声明 `clipf: ["read"]` 而代码访问 `ctx.clipf.search`
- **THEN** `ctx.clipf.search` 为 undefined;未声明任何 clipf 能力时 `ctx.clipf` 整体为 undefined;均不产生错误回执泄漏宿主能力存在性

### Requirement: 能力按风险分级授权

宿主能力 SHALL 按风险分级授权:读类启用即可调用;元数据写类(如打标)SHALL 在安装确认时一次性授权,不逐次 confirm;内容写/删除/粘贴回写类 SHALL 逐次请求用户 confirm。分级边界 SHALL 进 golden 用例。

#### Scenario: 打标写入不逐次确认

- **WHEN** 已安装插件在事件回调中调用 `clipf.tag.write`
- **THEN** 写入直接执行(安装时已授权),不弹 confirm;该分级被 golden 用例固化

### Requirement: 插件配置经 schema 校验后写入

插件用户配置 SHALL 以 manifest `config` 字段的 JSON Schema(draft-07 子集,属性必须带 default)为唯一契约;写入 SHALL 经宿主侧校验并原子落盘,非法配置 SHALL 拒绝且不改动原文件;生效配置 SHALL 填充默认值后经 `activate(ctx, config)` 第二参注入;配置变更 SHALL 以重启该插件方式生效。

#### Scenario: 非法配置写入被拒绝

- **WHEN** Agent 经 powerpack.config.set 提交不符合 schema 的配置(缺必填/类型错误)
- **THEN** 宿主校验失败并返回 JSON Pointer 错误路径,config.json 保持原样

#### Scenario: 配置损坏时自愈

- **WHEN** 插件 config.json 被外部改坏(非法 JSON 或不合 schema)
- **THEN** 插件以 schema default 启动,日志记录 warn,不拒绝启动

### Requirement: 插件工具走动态注册口

插件注册的工具 SHALL 落入动态命名空间 `plugin.<包名>.<工具名>`,由 MCP 网关层聚合进 `tools/list` 并带来源标记(聚合只读宿主侧注册表快照);前端 pi Agent SHALL 经 `list_plugin_tools`/`invoke_plugin_tool` Tauri 命令消费同一注册表快照(additive),复用与 MCP 面同一最终校验闸门与预算;宿主 `mcp/specs.rs` 稳定契约 SHALL NOT 被插件安装/卸载修改。

#### Scenario: 坏插件单独禁用

- **WHEN** 某插件被用户禁用,或因超限/崩溃被标记 failed
- **THEN** 仅该插件命名空间从聚合结果移除,宿主 40 条工具契约不变(golden 清单不受影响)

#### Scenario: 面板 Agent 调用插件工具

- **WHEN** 已安装插件注册了 tag-stats 工具,前端 pi Agent 发起调用
- **THEN** 经 invoke_plugin_tool 走同一校验闸门与超时预算执行,结果与外部 MCP Agent 调用同构

### Requirement: 安装生命周期原子且可回滚

安装/卸载 SHALL 原子完成(临时目录写入 + 校验 + 原子改名),失败即回滚不留半成品。

#### Scenario: 安装中断不留脏数据

- **WHEN** 安装过程中途崩溃或校验失败
- **THEN** 重启后插件目录状态与安装前一致,无部分注册条目残留

### Requirement: 状态注册表可自检

系统 SHALL 维护插件状态注册表(enabled/版本)作为运行状态的唯一事实;注册表与磁盘的漂移(目录被手动删除、暂存区残留、注册表落后)SHALL NOT 导致宿主异常,SHALL 可经 powerpack.doctor 检出并修复。

#### Scenario: 目录被手动删除后自愈

- **WHEN** 用户手动删除某插件目录而注册表仍有其条目
- **THEN** 宿主启动跳过该插件并记 warn,powerpack.doctor 清理孤儿条目,其余插件不受影响

### Requirement: Agent 自迭代安装门禁

插件安装 SHALL 由 Agent 通过 powerpack.scaffold/validate 发起,经用户逐次交互确认后生效;系统 SHALL NOT 提供静默安装或信任豁免路径。

#### Scenario: 未经确认不生效

- **WHEN** Agent 调用 powerpack.install 而用户拒绝确认
- **THEN** 插件包仅存于暂存区,任何插槽与工具注册不生效

### Requirement: 插件故障可诊断

插件桥错误 SHALL 以稳定错误码前缀(`PLUGIN_<域>_<原因>`)返回并进 golden(新增 additive、不改既有);错误载荷 SHALL 携带结构化上下文(插件 id、JSON Pointer 路径或 JS 异常栈);插件日志 SHALL 写入统一 jsonl(context=`plugin:<id>`)且 SHALL 可按 pluginId 精确过滤查询;JS 异常的 message 与 stack SHALL 原样透传给调用方。

#### Scenario: Agent 凭错误码自愈

- **WHEN** powerpack.validate 返回 `PLUGIN_SLOTS_MISMATCH` 且 data 指明差异项
- **THEN** Agent 无需读日志、仅凭错误码与 data 定位并修复,再跑 validate 直至通过

#### Scenario: 按插件过滤日志

- **WHEN** powerpack.logs 以 pluginId 查询
- **THEN** 仅返回该插件 context 的日志行(按时间倒序),不含其他插件与宿主日志

#### Scenario: JS 异常栈透传

- **WHEN** 插件工具 handler 抛出 JS 异常
- **THEN** 调用方收到的错误 data 含原始 message 与 stack 字符串,未被桥改写

### Requirement: 发布包完整性校验

v1 发布物 SHALL 为本地包(目录或 tar.gz)附 blake3 校验和;powerpack.install SHALL 重算校验和,不符 SHALL 拒绝(`PLUGIN_CHECKSUM_MISMATCH`)且不落盘不登记;远程来源 SHALL 仅预留 manifest 字段,SHALL NOT 实现网络拉取。

#### Scenario: 篡改包被拒

- **WHEN** 安装包内容与提供的 blake3 校验和不符
- **THEN** install 拒绝,暂存区不留该包,registry 无条目
