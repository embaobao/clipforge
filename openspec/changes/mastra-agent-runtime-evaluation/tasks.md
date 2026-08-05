# 任务：Mastra Agent Runtime 评估

## Phase 0：评估边界

- [x] 建立 `mastra-agent-runtime-evaluation` change
- [x] 明确 Mastra 只作为 Agent runtime 候选，不直接引入依赖
- [x] 明确 quick panel 热路径隔离要求
- [x] 明确与 `ai-model-plugin-productization` / `vercel-ai-sdk-integration` / `local-model-quick-integration` 的关系

## Phase 1：文档与规范

- [x] 编写 `proposal.md`
- [x] 编写 `design.md`
- [x] 编写 `tasks.md`
- [x] 新增 `agent-runtime` spec delta
- [x] 更新 `docs/PROPOSAL_ROADMAP.md`
- [x] 更新 `openspec/project.md`
- [x] `openspec validate mastra-agent-runtime-evaluation --strict`

## Phase 2：POC 前置测量设计

- [ ] 记录无 Mastra baseline：`panel.open` / `quick.scroll` / `quick.select` / `quick.copy` / `quick.paste` P95
- [ ] 定义 sidecar cold start / warm start / first token / provider timeout 测量脚本
- [ ] 定义 idle RSS / workflow RSS 对比方法
- [ ] 定义 release bundle 体积、签名、离线启动检查清单
- [ ] 定义 tool allowlist 与 Settings Service redaction 检查清单

## Phase 3：POC 决策（后置，未批准前不实现）

- [ ] 确认是否创建独立 POC change
- [ ] 如果批准，只允许可选 sidecar / workbench runtime 形态
- [ ] POC 不得修改 quick panel 热路径
- [ ] POC 不得把 API key、prompt/output 或剪贴板正文写入日志
- [ ] POC 失败时必须能完全旁路，不影响剪贴板监听、搜索、复制、粘贴

## Phase 4：结论归档

- [ ] 输出 yes/no/条件性结论
- [ ] 若不引入，更新 AI/Agent proposal，保留现有 Settings Service + MCP + provider 架构
- [ ] 若进入 POC，拆出单独 change，不在本评估 change 内直接开发
- [ ] 完成后归档本评估 change
