# 任务：本地模型快速接入与 Agent 面板重构评审

## Phase 0：提案补齐

- [x] 保留 `local-model-quick-integration` proposal 作为 AI/Agent 后置候选
- [x] 明确删除 local-cli 运行时、优先 OpenAI-compatible provider 的方向
- [x] 新增 spec delta，避免 active change 缺少规范约束
- [x] 在 roadmap/project 中标记为后置候选，不能插队影响剪贴板热路径

## Phase 1：边界复审

- [ ] 复审与 `ai-model-plugin-productization` 的重复范围
- [ ] 复审与 `vercel-ai-sdk-integration` 的替代/合并关系
- [ ] 复审与 `mastra-agent-runtime-evaluation` 的 runtime 决策关系
- [ ] 决定是否拆分为 provider import、Agent chat UI、AI summary 三个独立 change

## Phase 2：POC 前置验证

- [ ] Context7 确认 Vercel AI SDK 当前版本在 Tauri WebView 的 API 与浏览器兼容边界
- [ ] 设计第三方工具配置导入的显式确认 UI 与 redaction 规则
- [ ] 设计 OpenAI-compatible provider 检测 timeout 与 settings changed 订阅策略
- [ ] 定义 quick panel P95 baseline 与回归门槛

## Phase 3：实现决策（未批准前不开发）

- [ ] 若保留本提案，补完整 design.md
- [ ] 若并入 `ai-model-plugin-productization`，归档或标记 superseded
- [ ] 若被 Mastra runtime POC 替代，更新 proposal 状态并拆 runtime POC change
- [ ] 任何实现都不得把 provider check、model list 或 chat runtime 接进 quick panel 热路径
