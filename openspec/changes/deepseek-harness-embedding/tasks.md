# 任务：DeepSeek Harness 内嵌

## Phase 0：Spike 验证（macOS）

- [ ] 安装 Node ^22.19 并 `npx @deepseek-ai/dsh --profile headless "总结这段剪贴板内容"` 跑通
- [ ] 用一段大文本剪贴板内容测 summary，记录 P95 延迟
- [ ] 验证 Rust 以 sidecar 拉起 dsh 常驻 + localhost JSON-RPC 调用
- [ ] 确认 stdout / JSON-RPC 结果可被解析为四类结果

## Phase 1：只读分析 Profile

- [ ] 编写 `clipforge-analysis` Cordis profile（禁用 fs-write / shell）
- [ ] 自定义分析工具：summarize / classify / extract / auto-tag / suggest-folder
- [ ] `pre-execute` 钩子接入 `CapabilityPolicy` + 脱敏
- [ ] 模型路由指向用户配置的 provider（DeepSeek / OpenAI 兼容）

## Phase 2：内嵌运行时（Rust sidecar）

- [ ] Tauri sidecar 打包 Node 运行时 + dsh
- [ ] Rust command：起/停 dsh headless 常驻，localhost JSON-RPC 客户端
- [ ] 缺失 Node/dsh/模型时优雅降级（AI 入口禁用，基础功能不受影响）

## Phase 3：快速分析入口

- [ ] 详情页 / 快速面板「分析」按钮 → Rust command → DSH
- [ ] 结果映射到四类（previewPatch / newClipDraft / copyResult / renderPanel）
- [ ] 写回前 preview / confirm（WritebackGuard）

## Phase 4：管理与审计

- [ ] AI 操作历史复用 DSH session store
- [ ] agent 极简调用页展示历史 + trajectory 回放
- [ ] 自动标签 / 建议分组技能接入剪贴板归管

## Phase 5：标品化收口

- [ ] `ai-model-plugin-productization` 门禁 + 隐私默认（只发 summary/metadata）
- [ ] `mastra-agent-runtime-evaluation` 归档（结论 no / 后置）
- [ ] `local-model-quick-integration` / `vercel-ai-sdk-integration` 标记 superseded
- [ ] `pnpm build` + `cd src-tauri && cargo check` + openspec validate 通过
