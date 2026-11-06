# TASK-4 开发指令：pi sdk 迁移至 @earendil-works/* 1.1.0

你只在 /Users/embaobao/workspace/idea/clipforge 工作。严格按 backlog 任务书执行：
先完整读 `backlog/tasks/task-4 - pi-sdk-依赖迁移至-earendil-works-1.1.0.md`，它定义全部范围与验收。

## 执行顺序（每步做完再下一步）

1. 先审计新包 API：`pnpm add @earendil-works/pi-agent-core@1.1.0 @earendil-works/pi-ai@1.1.0` 后读 node_modules 里的 .d.ts，确认 Agent 构造 streamFn、getApiKey 签名、completeSimple/getModel/getProviders 导出位置（主入口 or /compat）。以 d.ts 为真源，任务书描述仅参考。
2. 逐文件替换 `src/agent/pi/` import scope：agent.ts / tools.ts / stream.ts / provider-config.ts。最小改动优先；若 compat 入口也不可用，在 provider-config.ts 内封装 createModels()，不外溢。
3. 从 package.json 移除旧 `@mariozechner/*` 两包，全仓 grep 确认无 `@mariozechner` 残留（含 scripts/verify-surface-boundaries.mjs / verify-runtime-boundaries.mjs 的 scope 硬编码断言，有则同步改）。
4. 门禁全绿：`pnpm build:web` 通过（tsc 无错）；`cargo check` 不变。任何一步红 → 修到绿，不许跳过。
5. 冒烟：`CLIPFORGE_DISABLE_CAPTURE=1 pnpm tauri dev` 起不来就退回 `pnpm build:web` 级别验证，并在结论里如实说明哪条 AC 未覆盖及原因。

## 纪律

- 提交规范 Conventional Commits（`fix(pi):`/`refactor(pi):`）；完成即 commit，只 add 你改的文件，禁 `git add -A`
- 禁止把测试 key 写进仓库；禁止碰 src-tauri/（Rust 侧不动）；禁止改本任务范围外文件
- 遇 1.1.0 API 与适配层差异过大：不要 hack，在 `.work/supervisor/task4-findings.md` 记录阻塞点+降级方案，暂停等裁决
- 完成后把「已验证/未验证/风险」三段写入 `.work/supervisor/task4-report.md`
