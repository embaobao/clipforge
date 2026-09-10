# ClipForge 视觉重构 · 交接摘要

## 会话背景

用户要求按 `docs/Kimi_Agent_设计系统草图.zip` 中的设计稿，将 ClipForge 从旧 CSS 架构全面迁移到 Tailwind CSS v3 + shadcn/ui 新视觉体系。设计稿对应文档为 `docs/DESIGN_SYSTEM.md`（本次会话新建）。

## 已完成工作

### 基础设施（完成）
- `package.json`：Tailwind v4 → v3.4.19，新增 postcss、autoprefixer、sonner、cmdk、tailwindcss-animate
- `tailwind.config.js`：zinc 色系 + HSL token 映射 + 自定义字号/动画
- `postcss.config.js`：标准 PostCSS 流程
- `components.json`：shadcn new-york / zinc / CSS variables
- shadcn 组件已安装：button、dropdown-menu、switch、slider、select、toggle-group、separator、scroll-area、tooltip、tabs、accordion、sonner
- `src/index.css`：全量 token + `.material` / `.panel-shadow` / `.window-shadow` / `.mono` / `.thin-scroll` / `.panel-in` / `.row-in`

### 主面板（完成）
- `src/App.tsx`：480px 面板容器 `w-[480px] rounded-[14px] material panel-shadow overflow-hidden panel-in`
- `src/clipboard/components/TopToolbar.tsx`：52px 搜索栏 + 28px scope 圆钮（Clock/Star/Scissors/MoreHorizontal）
- `src/clipboard/components/ClipboardRow.tsx`：行高 44/40/34px、28×28 图标块、选中态 `bg-black/[0.045]`
- `src/clipboard/components/ClipboardRowActions.tsx`：序号/⏎/已复制/hover 动作
- `src/clipboard/components/ClipboardContentPreview.tsx`：13px 主文本 + 11px muted meta
- `src/clipboard/components/QuickPreviewCard.tsx`：空格预览卡（新建）
- `src/clipboard/components/QuickCommandMenu.tsx`：⌘K 菜单（新建）
- `src/clipboard/components/MultiSelectBottomBar.tsx`：多选底栏（新建）
- `src/clipboard/components/TrashRow.tsx` / `TrashContextMenu.tsx`：回收站（新建）
- `src/clipboard/components/ClipboardEmptyState.tsx`：空状态
- `src/clipboard/components/PanelStatusFeedback.tsx`：底栏状态
- 键盘映射已补：空格开关快速预览（非多选模式下）

### 设置窗口（大部分完成）
- `src/settings/components/SettingsShell.tsx`：680px 外壳（红绿灯标题栏 + 172px 侧栏 + 内容区 + 底部）
- `src/settings/components/SettingsStatusPanel.tsx`：已重写为 shadcn + Tailwind
- `src/settings/components/SettingsErrorBoundary.tsx`：已重写
- `src/settings/components/SettingsCodeTabs.tsx`：已重写为 shadcn Tabs
- `src/settings/controls.tsx`：已重写（SegmentSetting/NumberSetting/SliderSetting/ToggleSetting/ReadonlyField/CheckItem）
- `src/settings.tsx`：已接入 SettingsShell，旧类已清理

### 旧样式清理（完成）
已删除：`src/App.css`、`src/settings.css`、`src/theme/tokens.css`、`src/clipboard/styles/clipboard-panel.css`、`src/workspace/styles/detail-page.css`、`src/dsh/dsh-panel.css`、`src/onboarding/onboarding.css`、`src/clipboard/components/ClipboardRow.module.css`

### 验证（2026-09-07 夜间全套复验通过）
- `pnpm build:web`：通过
- `pnpm test:boundaries`：通过（已更新 `verify-surface-boundaries.mjs`、`verify-settings-surface.mjs`、`verify-onboarding-surface.mjs`）
- `pnpm test:unit`：通过（`verify-settings-surface.mjs` 的 CodeTabs 过期断言已按 shadcn 新实现修复：改锁本地封装/复制回调/dev probe 标记）
- `cargo check`：本轮未触碰 src-tauri，未重跑

## 基线提交（2026-09-07 夜间批次 1）

全部未提交改动已按逻辑单元分 6 批提交，工作区干净：
`e82cf95` 基础设施 → `d4e1b1b` 主面板 → `20b7773` 设置窗口 → `6812db6` workspace/onboarding/dsh 过渡态 → `b9625a0` 删除旧 CSS → `8f76cc1` 文档与提案。

## 批次 2：Workspace 详情页拆分（2026-09-07 夜间，待办#1 完成）

- `986bf09` 修复 tailwind.config.js 字体名尾部多余右引号（消除 vite css-syntax-error 警告）
- `2e06530` 详情页从 workspace-panels.tsx（1831 行）拆分至 `src/workspace/components/`：
  workspace-detail-shared / DetailPreview / DetailQuickEditor / DetailDshPanel / DetailMeta / DetailOverflowMenu / ClipDetailWorkspace（外壳 498 行）；
  workspace-panels.tsx 重写为聚合页 + re-export（173 行），**已移出 file-size 豁免清单（剩 4 项）**。
- 旧 `detail-*` / `aggregate-*` 无样式类全部替换为 Tailwind 语义类；行为与 props 签名不变（App.tsx import 路径不变）。
- DSH 分析面板移出标题栏行（改渲染在 Crumb 下方），分析状态收敛进 `useDshQuickAnalysis` hook。
- 3 个 verify 脚本（editor-agent-bridge / runtime-boundaries / surface-boundaries）读取路径随拆分同步更新，断言语义不变。
- 验证：build:web ✓ / test:unit ✓ / test:boundaries ✓；cargo check 未重跑（未触碰 src-tauri）；tauri dev 视觉走查跳过（无人值守）。

## 批次 3：聚合页拆分 + Onboarding 向导拆分（2026-09-07 夜间，待办#2/#3 完成）

- `d7fb9a5` 聚合页拆分：`MultiAggregateWorkspace.tsx`（118 行）+ `AggregateItem.tsx`（63 行）；`workspace-panels.tsx` 缩为纯 re-export（5 行）；verify-surface-boundaries 聚合页 marker 检查随迁。
- `5890d76` onboarding 向导拆分：`settings/onboarding-wizard.tsx`（422 行旧类）迁移至 `src/onboarding/components/`（shared 153 行 + OnboardingWizard 268 行 + Step/FeatureCard 小组件），全部换 Tailwind 语义类；键盘导航、快捷键录制、探针、写入路径行为不变；verify-settings-surface 断言路径随迁。
- 验证：build:web ✓ / test:unit ✓ / test:boundaries ✓（两项拆分各验证一轮）；cargo check 未重跑（未触碰 src-tauri）；tauri dev 视觉走查跳过。

## 批次 4：openspec 对账 + AGENTS.md 对齐（2026-09-07 夜间，待办#5/#6 完成）

- `a4d519b` deepseek-harness-embedding/tasks.md 逐项 grep 核验：Phase 6/7 勾选状态与代码一致（09-02 已对齐，无脱节）；Phase 5「详情页/右键入口/历史复用」三个 UI 入口确认落地并勾选；补记对账核验。结论：**该提案剩余项全部为（后置），无可立即推进项**（动 DSH 须先过基座取舍决策——盟哥拍板项）。
- `8674df9` AGENTS.md 两处过时描述更新：技术栈 UI 行、样式按功能拆分章节（旧 CSS 架构 → Tailwind v3 现实）。
- 验证：build:web ✓ / test:unit ✓（纯文档改动，快速回归）。

## 批次 5：全量回归（自动化部分）+ roadmap 对账（2026-09-07 夜间）

- `a4b923c` PROPOSAL_ROADMAP 补记 09-07 进展。**全量回归可自动化部分全部通过**：
  `build:web` / `test:unit` / `test:boundaries` / `cargo check` 全绿（15 个存量 dead_code 警告非阻塞）；
  `pnpm tauri dev` 后台冒烟通过（编译+启动+运行 70 秒无 error/panic，dev 实例已清理，未影响正式 release 实例）。
- 核对 `file-image-clipboard-support` / `clipboard-multi-format-fidelity`：剩余 7+4 项全部需要真实系统剪贴板证据，**确认无法自动化勾选**，只能实机验收。
- 记录无害告警：vendored 组件（message-scroller / animate-ui sidebar）4 个 `ease-[...]` 类的 Tailwind v3 歧义警告，暂不修改。

## 白天批次（2026-09-08）：提案补档 + 还债开发

- `9f51816` 补立 `tailwind-v3-style-refactor` 提案（proposal/tasks + styling-architecture spec delta，validate --strict ✓）并登记 ROADMAP；DSH 面板核验为已完成（修正 HANDOFF 过时状态）。
- `8f50df7` contracts.ts 按域拆分：`contracts/{clipboard,editor,agent,service}-contracts.ts`（≤317 行）+ barrel re-export（6 行），引用方零改动；**豁免清单 4 → 3 项**。
- `a847591` App.tsx 第一刀：切出 `src/clipboard/clip-model.ts`（438 行，Clip 数据模型 + 内容分析纯函数），4051 → 3658 行，外部引用零改动。

### 剩余拆分方案（夜间接力，按序执行）

1. **App.tsx 第二刀 ✅（夜间批次 6，`605de5a`）**：GlassSearchBar（192 行，含 SearchAutocomplete）/ VirtualList（181 行，ROW_HEIGHT/OVERSCAN 随迁）/ TrashPanel（132 行）/ QuickPastePanel（199 行）切至 `src/clipboard/components/`，panel-shared.ts（24 行）承载 logAppError + analyzeClipboardWithDsh；App.tsx 3658 → **2967 行**，新增导出 PanelDensity/AppSettings。
2. **settings.tsx 第一刀 ✅（夜间批次 7，`bb10ec7`）**：切出 `src/settings/settings-model.ts`（347 行：AppSettings/各 payload 契约/导航常量/getInitialNavigationFromUrl），settings.tsx 1864 → **1566 行**；safeInvokeUpdateCheck/UpdateCheckState 本地保留（verify-runtime-boundaries 断言锚定）；verify-settings-surface 三条导航常量断言已随迁 model 文件。
3. **settings.tsx 第二刀（下一步）**：主体 SettingsApp（约 1170 行）按 section 渲染函数切片（display/capture/storage/mcp-agent/update/tag-rules 各 section 的 JSX 块切为 `src/settings/sections/*.tsx`），每切一个跑全套。
4. **App.tsx 主体（批次 29 后 1334 行）**：写回域全部完成 ✅（`fc1758d`，use-clip-writeback.ts 459 行十函数：markClipCopied/copyClip/copyText/captureStandardTextClip/pasteClip/updateClip/exportSelectedTextFiles/favoriteSelectedClips/copySelectedClips/openClipTarget/openSystemPath/updateClipContent）。剩余：search 域 handler（handleSearchChange/applySearchSuggestion/closeSearchIfEmpty/removeSearchFilter/syncCaptured…）；markClipCopied 已迁、runPrimaryOpenAction 留主体（verify 锚定）；UI JSX 区块（最后大头）。每切一个跑全套；切走函数前先 grep verify 断言（教训×3）；App.tsx 手术删除区间用「下一个顶层声明」定位（教训×2）。
   - **A. 全局 keydown 键盘导航 effect**（约 300 行）：依赖清单已盘——switchClipboardView/togglePanelPinned/favoriteSelectedClips/runPrimaryOpenAction/copySelectedClips/handlePanelArrowNavigation/applySearchSuggestion/exportSelectedTextFiles + selectedId/activeView/multiSelectMode/filteredClips/selectedInList/searchRef/settingsRef + 十余个 setter。参数注入对象约 25 项；注意 verify-runtime-boundaries 锚定 runPrimaryOpenAction..updateClip 切片、verify-settings-surface 锚定拖拽排除断言（已在 panel-shared）。
   - **B. UI 渲染 JSX**（主体 return，约 800 行）：按 TopCommandBar/ModeBar/ClipboardList/StatusBar/Overlay 区块切展示组件，props 由现有 state/handler 直接传递。
   另剩零散：markClipCopied/updateClip/updateClipContent/exportSelectedTextFiles/copyStandardTextClip 等写回域函数（依赖 state 较多，建议随 B 一起走）。每切一个跑全套；切走前先 grep verify 脚本断言。
5. **lib.rs（14284 行）**：按 codebase-modularity 提案顺序拆 settings/agent/mcp 模块（Rust 端改动必须 `cargo check` + `pnpm tauri dev` 冒烟）。

## 待办事项（按优先级，批次 5 后更新）

**夜间任务的可自动化待办已清零**。剩余事项全部需要盟哥人工参与：

1. **视觉走查**（最重要）：`pnpm tauri dev` 人工过一遍详情页/聚合页/onboarding 三个 surface（批次 2/3 重写的 Tailwind 样式未经人眼确认）；DSH 面板 iframe 细节一并看
2. **7 场景实机验收矩阵**：`file-image-clipboard-support` + `clipboard-multi-format-fidelity` 剩余项（复制/粘贴/显示/清理证据），完成后两提案可归档
3. **DSH 基座取舍决策**（盟哥拍板项）：pi 等候选评估结论出来前，DSH 后置项不推进
4. **grilling 会话 Q1–Q4**：产品方向问题待回答

夜间任务至此进入「无事可做秒退」状态：工作区干净、可自动化验证全绿、可推进提案项清零。后续夜晚的触发若仍无新待办（盟哥白天未新增），会话将直接退出。若确认不再需要，可删除定时任务 automation-7b5269b1。

## 当前状态

- **主面板**：视觉重构完成，功能保留
- **设置窗口**：Shell + 控件完成，内容区功能保留
- **Workspace（详情页）**：已拆分完成，全部 Tailwind 语义类（批次 2）
- **Workspace（聚合页）**：已拆分完成（批次 3），`workspace-panels.tsx` 仅剩 re-export
- **Onboarding**：向导已拆分至 `src/onboarding/components/` 并清理旧类（批次 3）；`OnboardingApp.tsx` 根容器已 Tailwind
- **DSH 面板**：已完成 Tailwind 化（核验：header/iframe/状态提示全为语义类，无旧类残留），无需再对齐。

## 关键文件清单

| 文件 | 状态 | 备注 |
|---|---|---|
| `src/index.css` | 完成 | 全局 token + 工具类 |
| `tailwind.config.js` | 完成 | zinc + HSL 映射 |
| `src/App.tsx` | 完成 | 4051 行，主面板已重构 |
| `src/settings.tsx` | 完成 | 1865 行，Shell 已接入 |
| `src/settings/controls.tsx` | 完成 | 控件已重写 |
| `src/settings/components/SettingsShell.tsx` | 完成 | 新建 |
| `src/settings/components/SettingsStatusPanel.tsx` | 完成 | 已重写 |
| `src/settings/components/SettingsErrorBoundary.tsx` | 完成 | 已重写 |
| `src/settings/components/SettingsCodeTabs.tsx` | 完成 | 已重写 |
| `src/workspace/workspace-panels.tsx` | 完成 | 5 行纯 re-export（详情页/聚合页均已拆出） |
| `src/workspace/components/WorkspaceCrumb.tsx` | 完成 | 新建 |
| `src/workspace/components/ClipDetailWorkspace.tsx` | 完成 | 498 行外壳 + 6 个子组件（批次 2） |
| `src/workspace/components/MultiAggregateWorkspace.tsx` | 完成 | 118 行 + AggregateItem（批次 3） |
| `src/onboarding/components/OnboardingWizard.tsx` | 完成 | 268 行 + shared/Step/FeatureCard（批次 3） |
| `src/onboarding/OnboardingApp.tsx` | 完成 | 独立引导窗口，复用 components/OnboardingWizard |
| `src/dsh/dsh-panel.tsx` | 完成 | 已核验全 Tailwind 语义类（批次 6 复核） |

## 建议技能

- `shadcn`：用于继续添加/更新 shadcn 组件
- `tailwind`：用于 Tailwind 配置和类名调试
- `frontend-design`：用于视觉规范参考
- `code-review`：用于完成后自查

## 注意事项

- 不要恢复任何已删除的 CSS 文件。
- 所有新样式必须使用 `hsl(var(--token))` 或 Tailwind 语义类。
- 保持 `data-surface="clipboard"` / `"settings"` / `"workspace"` / `"dsh"` / `"onboarding"` marker。
- 每完成一个子组件即跑 `pnpm build:web`。
