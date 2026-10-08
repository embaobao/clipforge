# 任务：ClipForge 全面迁移 Tailwind CSS v3 + shadcn/ui 视觉重构

> 状态（2026-09-07）：主体实现已完成（夜间批次 1–5，全部验证通过并提交），
> 剩余项为盟哥人工视觉走查与走查问题修复。进度 24/27。

## Phase 0：方向决策 ✅

- [x] 废弃契约 v2（tokens.css 单源 / App.css 冻结 / Tailwind 仅限 shadcn 层 / 零 DOM 改动），改为按 Kimi 设计草图全面迁移（盟哥拍板，2026-09-07 执行）
- [x] 视觉契约固化为 `docs/DESIGN_SYSTEM.md`（zinc 色系 + HSL token + 组件尺寸规范）

## Phase 1：基础设施 ✅（批次 1）

- [x] Tailwind v4 → v3.4.19，新增 postcss / autoprefixer / sonner / cmdk / tailwindcss-animate
- [x] `tailwind.config.js`：zinc 色系 + HSL token 映射 + 自定义字号/动画（含修复 7 处字体名尾引号笔误 `986bf09`）
- [x] `src/index.css`：全量语义 token + `.material`/`.panel-shadow`/`.mono`/`.thin-scroll` 等工具类；四个窗口入口统一 import
- [x] shadcn 组件安装/对齐：button、dropdown-menu、switch、slider、select、tabs、accordion、scroll-area、tooltip、separator、toggle-group、sonner 等

## Phase 2：主面板 + 设置窗口重构 ✅（批次 1）

- [x] 主面板：480px 面板容器、TopToolbar、ClipboardRow 系列、QuickPreviewCard / QuickCommandMenu / MultiSelectBottomBar / TrashRow 等新组件，键盘映射保留
- [x] 设置窗口：SettingsShell（680px 外壳）+ StatusPanel / ErrorBoundary / CodeTabs / controls 全部重写
- [x] `verify-settings-surface.mjs` CodeTabs 过期断言按 shadcn 新实现修复（锁本地封装 / 复制回调 / dev probe 标记）

## Phase 3：workspace / onboarding 拆分 ✅（批次 2、3）

- [x] 详情页：`workspace-panels.tsx`（1831 行）→ `ClipDetailWorkspace.tsx`（498 行外壳）+ workspace-detail-shared / DetailPreview / DetailQuickEditor / DetailDshPanel / DetailMeta / DetailOverflowMenu（全部 ≤500 行）
- [x] 聚合页：`MultiAggregateWorkspace.tsx`（118 行）+ `AggregateItem.tsx`（63 行），`workspace-panels.tsx` 缩为纯 re-export
- [x] onboarding：`settings/onboarding-wizard.tsx`（422 行旧类）→ `src/onboarding/components/` 下 shared（153 行）+ OnboardingWizard（268 行）+ OnboardingStep / OnboardingFeatureCard；键盘导航、快捷键录制、探针、写入路径行为不变
- [x] 4 个 verify 脚本读取路径随拆分同步更新，断言语义不变（saveDraftContent 契约 / 插件动作失败边界 / surface marker / 五步流程 / 六个采集开关）
- [x] `file-size-exemptions.json` 移除 `workspace-panels.tsx`（7 → 4 项，只减不增）

## Phase 4：旧样式清理 + 文档对账 ✅（批次 1、4）

- [x] 删除 8 个旧 CSS 文件：App.css / settings.css / theme/tokens.css / clipboard-panel.css / ClipboardRow.module.css / detail-page.css / dsh-panel.css / onboarding.css
- [x] 全仓清除 `detail-*` / `aggregate-*` / `onboarding-*` 等无主样式类，新样式全部 Tailwind 语义类
- [x] `AGENTS.md` 技术栈与「样式按功能拆分」章节对齐 Tailwind v3 现实
- [x] `deepseek-harness-embedding/tasks.md` 对账核验（与样式无关但属同批文档治理）

## Phase 5：验证与验收 🟡

- [x] `pnpm build:web` / `pnpm test:unit` / `pnpm test:boundaries` 全绿（每批次复验）
- [x] `cargo check` 通过（15 个存量 dead_code 警告非阻塞）
- [x] `pnpm tauri dev` 后台冒烟：编译 + 启动 + 运行 70 秒无 error/panic（批次 5，dev 实例已清理）
- [ ] **盟哥人工视觉走查**：详情页 / 聚合页 / onboarding 三个 surface（重写样式的实际视觉效果）--DSH 面板 iframe 细节项作废:DSH 已全链删除（批次 36-38 前端 -528 行 + Rust -553 行，`a020068` 拍板 pi 接管），AI 面交互区域由 pi-sdk 线的 PiAnalysisBar 承接，走查随其交付面另行安排
- [ ] 走查问题清单修复（如有，逐项验证后提交）

## Phase 6：收尾 🟡

- [ ] 视觉走查通过后，本提案按 openspec 流程归档
- [ ] `docs/HANDOFF.md` 移除样式相关待办，保留视觉契约指向 `docs/DESIGN_SYSTEM.md`

## 注意事项

- 不恢复任何已删除的 CSS 文件；新样式只用 `hsl(var(--token))` 或 Tailwind 语义类。
- 保持 `data-surface="clipboard"/"settings"/"workspace"/"dsh"/"onboarding"` marker 与 `data-dev-probe` 探针。
- 再拆任何文件时先检查 4 个 verify 脚本的读取路径与切片断言。
