# 任务

- [x] 新增 OpenSpec 提案、设计说明和任务清单。
- [x] 新增独立 `workbenches/remotion` workspace package。
- [x] 配置根项目 motion 转发脚本。
- [x] 实现 `FeatureIntro` 横版功能介绍 composition。
- [x] 实现 `OnboardingGuide` 竖版引导 composition。
- [x] 为首页介绍、三大功能场景、安装引导分别提供中英文场景配置。
- [x] 确认所有默认全局唤起快捷键文案统一为 `Control + V`，其他快捷键仅作为面板内操作说明。
- [x] 编写工作台 README，记录预览、渲染、单帧检查和 Remotion skills 命令。
- [x] 安装依赖并更新 `pnpm-lock.yaml`。
- [x] 执行 TypeScript、Remotion still 和主项目构建验证。

## 验证边界

- 已通过：`pnpm --filter @clipforge/remotion-workbench typecheck`。
- 已通过：`pnpm motion:still`，生成 `workbenches/remotion/out/feature-intro-frame30.png` 后清理渲染产物。
- 已通过：`pnpm build`；仅保留既有 Vite chunk size warning、Rust unused/dead_code warnings 和未配置签名的本地构建提示。
- 已通过：`cd src-tauri && cargo check`；仅保留既有 Rust unused/dead_code warnings。
- Context7 / Remotion 官方文档刷新：主线程已遇到 `Monthly quota exceeded`，本切片不重复消耗配额，保持未完成。
