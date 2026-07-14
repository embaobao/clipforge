# 任务：统一 Settings Service 与 MCP 设置协议

## Phase 1：协议与现状确认

- [ ] 审计前端所有设置读写入口：设置窗口、主面板、Agent 面板
- [ ] 审计 native 设置读写入口：`read_user_settings`、`write_user_settings`、`get_clipforge_settings`、`update_clipforge_settings`
- [ ] 审计 MCP 工具列表，确认新增 `clipf.settings.*` 和 `clipf.agent.*` 不破坏现有工具
- [ ] 固化 `SettingsDocument`、`SettingsPatchRequest`、`SettingsChangedEvent` 类型
- [ ] 明确第一阶段不迁移主面板

## Phase 2：Rust Settings Service

- [ ] 新增 Settings Service 模块，集中实现 get / patch / replace / reset
- [ ] 实现 JSON Schema 生成或静态 schema
- [ ] 实现 patch schema 校验和错误路径返回
- [ ] 实现 replace/reset 显式确认校验
- [ ] 实现 revision / expectedRevision 冲突检测
- [ ] 实现 temp file + atomic rename 写入
- [ ] 写入成功后发出 `settings_changed`

## Phase 3：Agent Provider 能力

- [ ] 将 provider 解析收敛到 Settings Service
- [ ] 读取兼容旧 `agentProviders`，新写入使用 `agent.providers`
- [ ] 支持 `agent.defaultProviderId`
- [ ] Provider 响应 redacted，不回传明文 `apiKey`
- [ ] 实现 provider readiness check
- [ ] 实现 OpenAI-compatible models 拉取
- [ ] local CLI provider 对 models 返回 `not-supported`

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

## Phase 6：验证

- [ ] `pnpm exec tsc --noEmit` 通过
- [ ] `cd src-tauri && cargo check` 通过
- [ ] MCP `tools/list` 能看到新增 schema
- [ ] MCP `clipf.settings.get` 返回 settings + schema + writePolicy
- [ ] MCP `clipf.settings.patch` 可局部更新设置
- [ ] MCP `clipf.settings.patch` schema 错误返回路径和 hint
- [ ] MCP `clipf.settings.replace` 未确认时拒绝
- [ ] MCP `clipf.settings.reset` 未确认或缺 scope 时拒绝
- [ ] 设置窗口写入后收到 `settings_changed`
- [ ] 主面板现有能力不受影响
