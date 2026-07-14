# 任务：统一 Settings Service 与 MCP 设置协议

## Phase 1：协议与现状确认

- [ ] 审计前端所有设置读写入口：设置窗口、主面板、Agent 面板
- [ ] 审计 native 设置读写入口：`read_user_settings`、`write_user_settings`、`get_clipforge_settings`、`update_clipforge_settings`
- [ ] 审计 MCP 工具列表，确认新增 `clipf.settings.*` 和 `clipf.agent.*` 不破坏现有工具
- [ ] 固化 `SettingsDocument`、`SettingsPatchRequest`、`SettingsChangedEvent` 类型
- [ ] 明确第一阶段不迁移主面板
- [ ] 固化控制面与热路径边界：Settings Service 只进设置窗口、Agent 配置面和 MCP，不进入主面板快捷键/滚动/复制链路
- [ ] 明确前端设置页不通过 MCP stdio 调本机服务，而是和 MCP 共享同一 Rust Settings Service
- [ ] 定义主面板保护验收：打开面板不拉 schema、不跑 provider check、不拉 models、不等待 settings patch
- [ ] 固化 300ms 性能预算：主面板打开、选中、滚动、复制/粘贴反馈 P95 <= 300ms；设置页切换和本地设置操作反馈 P95 <= 300ms
- [ ] 明确网络类操作不阻塞同步链路：provider check、models、updater、导出诊断包只要求 300ms 内显示状态反馈

## Phase 2：Rust Settings Service

- [ ] 新增 Settings Service 模块，集中实现 get / patch / replace / reset
- [ ] 实现 JSON Schema 生成或静态 schema
- [ ] 实现 patch schema 校验和错误路径返回
- [ ] 实现 replace/reset 显式确认校验
- [ ] 实现 revision / expectedRevision 冲突检测
- [ ] 实现 temp file + atomic rename 写入
- [ ] 写入成功后发出 `settings_changed`
- [ ] `settings_changed` 只携带 revision、changedPaths、actor、mode、updatedAt，不携带完整 schema
- [ ] `get(includeSchema=false)` 支持省略 schema，供后续轻量刷新使用
- [ ] Settings Service get/patch/replace/reset 记录 durationMs，超过 300ms 写入 app log
- [ ] MCP settings handler 记录 durationMs，超过 300ms 返回或记录 slow-call hint

## Phase 3：Agent Provider 能力

- [ ] 将 provider 解析收敛到 Settings Service
- [ ] 读取兼容旧 `agentProviders`，新写入使用 `agent.providers`
- [ ] 支持 `agent.defaultProviderId`
- [ ] Provider 响应 redacted，不回传明文 `apiKey`
- [ ] 实现 provider readiness check
- [ ] 实现 OpenAI-compatible models 拉取
- [ ] local CLI provider 对 models 返回 `not-supported`
- [ ] readiness/models 必须按需触发，不能随主面板打开自动串行执行
- [ ] readiness/models 必须有 timeout 和错误摘要，不阻塞剪贴板主流程
- [ ] readiness/models 300ms 内必须有 loading/pending 状态，真实网络完成可异步返回
- [ ] readiness/models 结果必须支持忽略过期请求，避免慢返回覆盖新状态

## Phase 4：Tauri 与前端服务适配

- [ ] 新增 `settings_service_get`
- [ ] 新增 `settings_service_patch`
- [ ] 新增 `settings_service_replace`
- [ ] 新增 `settings_service_reset`
- [ ] 新增 `settings_service_agent_providers`
- [ ] 新增 `settings_service_agent_check`
- [ ] 新增 `settings_service_agent_models`
- [ ] 新增 `src/services/settings.ts`
- [ ] 设置窗口改用 `settingsService`
- [ ] 主面板保持现状，不迁移
- [ ] `src/services/settings.ts` 缓存 schema，同 revision 刷新不重复拉完整 schema
- [ ] Agent 配置区改用 `settingsService.agent.*` 时保持手动测试/刷新触发，不做首屏串行网络检查
- [ ] `src/services/settings.ts` 记录调用 durationMs，开发环境超过 300ms 输出 warn
- [ ] 设置页 sidebar/tab 切换不等待 settings get/schema；慢刷新必须后台完成
- [ ] 设置页表单操作 300ms 内给出 pending/saved/error 可见反馈
- [ ] 主面板代码中禁止同步调用 `settings_service_*`、`clipf.settings.*`、provider check 或 models

## Phase 5：MCP 工具适配

- [ ] 新增 `clipf.settings.get`
- [ ] 新增 `clipf.settings.patch`
- [ ] 新增 `clipf.settings.replace`
- [ ] 新增 `clipf.settings.reset`
- [ ] 新增 `clipf.agent.providers`
- [ ] 新增 `clipf.agent.check`
- [ ] 新增 `clipf.agent.models`
- [ ] 所有 MCP 写入响应包含 revision、changedPaths、nextActions
- [ ] replace/reset 缺少 confirmed 时返回明确错误和修复提示
- [ ] MCP settings 工具复用 Settings Service，不直接写 settings 文件
- [ ] MCP settings 工具异常不影响已有 `clipf.list`、`clipf.get`、`clipf.copy`
- [ ] MCP `clipf.settings.get` 支持 `includeSchema=false`，用于 300ms 内轻量读取
- [ ] MCP 写入返回包含 durationMs，便于 Agent 判断是否需要降级为后台刷新

## Phase 6：验证

- [ ] `pnpm exec tsc --noEmit` 通过
- [ ] `cd src-tauri && cargo check` 通过
- [ ] 增加或运行性能 smoke：主面板打开路径 P95 <= 300ms
- [ ] 增加或运行性能 smoke：主面板选中、滚动、复制/粘贴反馈 P95 <= 300ms
- [ ] 增加或运行性能 smoke：设置页 sidebar/tab 切换 P95 <= 300ms
- [ ] 增加或运行性能 smoke：settings get(includeSchema=false) / patch 本地响应 P95 <= 300ms
- [ ] MCP `tools/list` 能看到新增 schema
- [ ] MCP `clipf.settings.get` 返回 settings + schema + writePolicy
- [ ] MCP `clipf.settings.patch` 可局部更新设置
- [ ] MCP `clipf.settings.patch` schema 错误返回路径和 hint
- [ ] MCP `clipf.settings.replace` 未确认时拒绝
- [ ] MCP `clipf.settings.reset` 未确认或缺 scope 时拒绝
- [ ] 设置窗口写入后收到 `settings_changed`
- [ ] 主面板现有能力不受影响
- [ ] 验证主面板打开路径没有新增 `settings_service_get` / schema / provider check / models 调用
- [ ] 验证快速列表滚动和选中态不因 `settings_changed` 产生整页重渲染
- [ ] 验证复制/粘贴回写不等待 Settings Service 或 MCP 工具
- [ ] 验证 provider check/models 超过 300ms 时不阻塞面板和设置页切换，只显示 loading/pending
