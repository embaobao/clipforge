# Tasks:agent-plugin-runtime

## Phase 1:桥接 spike(验收闸门,时间盒 1 周)

- [x] 1.0 引入 `cordis-rs = "=0.11.1"` 精确 pin + rquickjs,搭 plugin_runtime 门面模块骨架(cordis 类型不出模块)
- [x] 1.1 桥接闸门:一个 cordis Fiber 内嵌 rquickjs Runtime,`ctx.clipf.*` 能力对象、`ctx.on`、`ctx.register.*`、`ctx.log` 四组桥为 JS 可见对象(与 design §4 一一对应),dispose 确定性回收 Runtime 与全部监听
- [x] 1.2 内存上限:rquickjs memory_limit 按 manifest 声明强制,超限中断不崩宿主、Fiber 收敛为 Failed 可 dispose;顺带实测每插件 Runtime 固定内存基线(memory_usage),结论回写 design §18.2(8MB 默认值据此复核)——基线 27808 字节,8MB 维持;实测 set_memory_limit 必须在 Context 建成后设置
- [x] 1.3 闸门裁决:全链路通且不超时间盒→进 Phase 2;打架/超时→降级门面内自研等价实现(接口不变),结论回写本提案风险节;出口判据:无论过闸与否,先把门面内生命周期 trait(六态/dispose/收敛)编译期落位(降级=换实现而非补接口);顺带验证 cordis `update`(输入替换)可行性,结论回写 design §12(不可行则配置变更维持重启语义)——**2026-10-27 过闸**:四断言全绿 + update 换代成功;apply Send 组合方式与两条内存约束已回写提案风险节/design §12/§18.1/§18.2;v1 维持 dispose→spawn 重启语义

## Phase 2:插件核心(plugin-runtime)

> 门面内按子模块拆分(单文件 ≤500 行门禁):`plugin_runtime/{manifest,lifecycle,bridge,budget,registry,io}.rs`;落地时各自守行数预算,禁止把本 Phase 全部收进单文件。

- [ ] 2.1 plugin-pack manifest schema:id/version/capabilities/slots/memoryLimit/config(JSON Schema 子集,属性必须带 default)(serde + zod 双侧校验;TS 侧校验器拍板:新增 zod 或复用 pi-ai Type.Object(零新依赖),起步时定并回写 design §14 依赖注)
- [ ] 2.2 落盘生命周期:发现→校验→安装→停用→卸载,安装原子写+失败回滚(复用 settings_service 模式);registry.json 状态注册表(enabled/version,唯一运行事实);宿主启动排程:enabled 插件首帧就绪后 spawn(并发上限 4,每插件记 spawn 耗时日志,不阻塞 app-ready);启用插件数(≤16)与聚合内存(≤128MB)门禁,超限 install/enable 报 PLUGIN_TOO_MANY_PLUGINS;运行期准入/收敛/清理由 cordis-rs Fiber 承担(FiberHandle::dispose,失败收敛 Failed)
- [ ] 2.3 能力注入桥:manifest capabilities → ctx 对象按声明注入,未声明能力对象不存在;首批能力含 `clipf.read`(默认截断 256KB,返回 contentLength/truncated,显式 opt-in ≤ min(memoryLimit/4, 2MB))/`clipf.search`(items 带 bytes)/`clipf.tag.write`(元数据写级,安装即授权,分级边界进 golden)
- [ ] 2.4 事件分发:宿主域事件桥接为 cordis Event,插件经 `ctx.on` 订阅(事件名对齐 seams 事件清单;信封带 bytes/payloadKind 供插件预过滤;seams 事件面若仍 dormant,以 design §6 信封自持实现,seams 落地后对齐,不阻塞),有界队列,慢插件不反压热路径(采集线程仅 try_send 到 dispatcher,丢弃计数走原子变量,不持锁不内联序列化)
- [ ] 2.5 插件工具注册口:plugin.<包名>.<工具名> 动态注册/注销,MCP tools/list 聚合 + 来源标记 + 单插件禁用;聚合只读宿主侧注册表快照(activate 时与 runtime register 同源落入,带版本计数器),不 round-trip 插件线程
- [ ] 2.6 powerpack.* 宿主 MCP 工具(Agent 操作插件的唯一入口):scaffold/validate/pack/install/uninstall/list/logs/config.get/config.set/doctor;走 specs.rs 表登记 + mcp/mod.rs golden 计数字面量 + scripts/verify-mcp-dispatch.mjs 三处同步(漏一处 test:unit 红);宿主自有工具、v1 仅 MCP 面(pi 侧不做对偶、前端用户面走设置页——消费者矩阵拍板,见 design §7),不计 seams 同源计数(见 seams 提案边界注)
- [ ] 2.7 插件配置:manifest.config JSON Schema 宿主侧校验 + config.json 原子写(非法拒绝带 JSON Pointer 路径)+ activate(ctx, config) 注入(默认值填充)+ 变更重启生效 + 损坏自愈回退 default;设置页「插件」分区 schema 驱动表单
- [ ] 2.8 插件 I/O 硬边界与日志(design §14):桥上序列化边界(JSON 值副本,循环引用=该次调用报错)+ 大小上限(事件 64KB/工具入参 256KB/handler 返回 1MB/能力返回默认 256KB-opt-in ≤ min(memoryLimit/4, 2MB),超限仅该次失败)+ ctx.log 每插件限流(100 行/分,突发 1000)+ 插件边界事件统一落 clipforge.jsonl(context=plugin:<id>,schema 对齐 {tsMs,level,message,context})+ 阶段门(activate 内能力调用报 PLUGIN_ACTIVATE_READONLY)+ JS 异常栈提取(Exception::from_value 的 message/stack 透传)+ unhandled rejection tracker
- [ ] 2.9 插件诊断契约(design §15/§16):错误码 PLUGIN_* 稳定前缀表落地(进 golden)+ MCP error data 结构(pluginId/JSON Pointer/stack)+ mcp_error_hint 扩展 PLUGIN_* 分类(golden 同步)+ `query_app_logs` 增可选 context 参数(additive,向后兼容)+ powerpack.logs 按 pluginId 过滤 + 症状排查手册五条路径用例
- [ ] 2.10 发布打包(design §17):powerpack.pack 暂存区/插件目录 → tar.gz + blake3 校验和(复用现有 blake3 依赖);install 校验和不符拒绝(PLUGIN_CHECKSUM_MISMATCH);manifest 预留 source 字段(additive 不实现拉取);版本升级 dispose→新 spawn 语义落 registry

## Phase 3:插槽(plugin-slots)

- [ ] 3.1 工具插槽双面打通:MCP `tools/list` 聚合(外部 Agent,只读宿主侧注册表快照)+ 前端 pi Agent 通道(`list_plugin_tools`/`invoke_plugin_tool` 两个 additive Tauri 命令,pi 侧 clipForgeTools() 动态合并,复用同一最终校验闸门与 toolTimeout 预算;design §7 消费者矩阵)
- [ ] 3.2 事件插槽打通:插件订阅 capture.finished 等事件端到端
- [ ] 3.3 UI 三插槽:悬浮窗按钮 / Agent 面板 tab / 提示词模板注册与渲染
- [ ] 3.4 首个示例插件「规则自动打标」(tag 场景端到端):capture.finished → clipf.read → 规则匹配 → clipf.tag.write;验证事件/读/元数据写/配置四条链,随应用分发作接口活文档;内置 AI 智能标签暂保持内置,外移路径留 ai.invoke

## Phase 4:提示词模板(prompt-template-management)

- [ ] 4.1 模板注册表(内置+插件)与用户覆盖层,Agent 对话模板选择器接入
- [ ] 4.2 设置页「提示词模板」分区:查看/编辑(含变量占位符校验)/导出/导入

## Phase 5:验收与门禁

- [ ] 5.1 安装/回滚/超限 golden 用例;manifest 非法输入拒绝用例;能力越界不可见用例;能力分级授权边界用例;配置非法写入拒绝+损坏自愈用例;I/O 超限与日志限流用例;阶段门用例;zod↔JSON Schema 一致性对照用例;组合注册+dispose 一并回收用例;doctor 孤儿自愈用例;拒绝安装不生效用例;realpath 路径逃逸拒绝用例;模板占位符校验用例;错误码断言用例(PLUGIN_* 前缀+data 结构);checksum 不符拒绝用例;query_app_logs context 过滤用例;双层看门狗用例(CPU 死循环走 interrupt、await 挂起走 tokio timeout);unhandled rejection 记录用例;内存超限收敛 failed(非 degraded)状态语义用例;能力返回超限报错用例;插件数/聚合内存门禁用例;热路径性能回归用例(50 个订阅且处于 degraded 的插件在跑时,capture→入库耗时与 panel.open p95 波动 <5%);§19 七断点各一用例
- [ ] 5.2 插槽 surface 校验接入 verify-runtime-boundaries;BUSINESS_INDEX 登记 plugin 域
- [ ] 5.3 全量回归 + pnpm build + cargo check 门禁
