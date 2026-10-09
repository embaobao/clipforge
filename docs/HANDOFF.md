# ClipForge 视觉重构 · 交接摘要

## 2026-10-09 会话增量（收起丝滑化 + 面板"点不开"诊断）

### ① 面板收起丝滑化 ✅（未提交）
- **Rust** `src-tauri/src/lib.rs`：新增 `hide_panel_with_native_fade`——NSWindow animator 原生 alpha 淡出（160ms，对齐原 CSS `--motion-panel-out`），动画完成后主线程 `resign_key + hide + set_alpha(1.0)`；轮询 1ms 粒度、400ms 兜底瞬切。**动机**：CSS opacity 动画下 backdrop-filter material 层每帧强制重新栅格化，是失焦自动收起卡顿的根源；原生淡出走 WindowServer 合成路径，WKWebView 零重绘。
- **前端** `src/clipboard/use-panel-blur-hide.ts`：失焦收起改调原生淡出命令，不再走 CSS `panel-out`。
- **验证**：cargo check ✓ / pnpm build:web ✓ / tauri dev 实机 show→blur→淡出收起无感 ✓；连按两轮开收进程稳定无崩溃（此前的 `NSWMWindowCoordinator` EXC_BREAKPOINT 崩溃已消除——orderOut/hide 全部经 `run_on_main_thread` 回主线程）。

### ② 淡出竞态修复 ✅（未提交，lib.rs ~8320-8470）
- **问题**：160ms 淡出窗口期内 `is_visible()` 仍为 true,连按 Ctrl+V 被 toggle 误判成第二次 hide → 面板被彻底藏没（is_visible=true 但 alpha=0 的"隐形窗口"），再按也"出不来"。
- **修复**：`PANEL_FADE_ACTIVE: AtomicBool`（hide 发起时置位、show 抢占/收尾完成复位）+ `PANEL_FADE_GENERATION: AtomicI64` 代际号（hide 抢占递增、show 复位，迟到的轮询/收尾闭包校验代际号不匹配即弃权）。`toggle_quick_panel` 判定改为 `visible && !is_panel_fading()`——淡出中再按=唤起。
- **验证**：cargo check ✓；实机 show→hide→160ms 内再按→正确走 show（决策日志 `show/hide/show`）。

### ③ 面板"点不开"诊断结论（2026-10-09 晚）：系统会话故障，非 app bug ⚠️ 需用户重启/注销
- **现象**：Ctrl+V 全局快捷键完全失效（托盘菜单「打开快捷面板」仍可用）。
- **排查**：日志 `registered shortcuts` 成功但无 `pressed`；进程/主线程/托盘/面板链路全部健康（AX+sample 抓栈证实）；**决定性实验：独立 Swift Carbon 探针注册同组合键，RegisterEventHotKey 返回 0 但回调 0 次（HID 级 CGEvent 注入 + 用户物理按键均无反应）** → macOS 登录会话的全局热键派发故障，与 ClipForge 无关。时间点约 20:59（同时段 Dock 重启、出现 `IMKCFRunLoopWakeUpReliable` 报错）。
- **恢复手段**：注销重登或重启系统。重登后 ClipForge autostart 自启，Ctrl+V 即恢复。应急入口：菜单栏 ClipForge 图标 → 「打开快捷面板」。
- 诊断工具与套路已入长期记忆（Carbon 探针 + CGEvent HID 注入 + AX 托盘定位，注意 clipforge 是 background only 进程）。

### ④ pi-sdk-agent-foundation 收官（2026-10-08 已记录，24/26）
L2 key redaction + provider UI + L3 智能标签已完成并勾选（见 4c+ 条）；剩 Phase 4 全量回归与归档两项。

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
已删除：`src/App.css`、`src/settings.css`、`src/theme/tokens.css`、`src/clipboard/styles/clipboard-panel.css`、`src/workspace/styles/detail-page.css`、旧 AI 面板样式文件、`src/onboarding/onboarding.css`、`src/clipboard/components/ClipboardRow.module.css`

### 验证（2026-09-07 夜间全套复验通过）
- `pnpm build:web`：通过
- `pnpm test:boundaries`：通过（已更新 `verify-surface-boundaries.mjs`、`verify-settings-surface.mjs`、`verify-onboarding-surface.mjs`）
- `pnpm test:unit`：通过（`verify-settings-surface.mjs` 的 CodeTabs 过期断言已按 shadcn 新实现修复：改锁本地封装/复制回调/dev probe 标记）
- `cargo check`：本轮未触碰 src-tauri，未重跑

## 基线提交（2026-09-07 夜间批次 1）

全部未提交改动已按逻辑单元分 6 批提交，工作区干净：
`e82cf95` 基础设施 → `d4e1b1b` 主面板 → `20b7773` 设置窗口 → `6812db6` workspace/onboarding/旧 AI 面板过渡态 → `b9625a0` 删除旧 CSS → `8f76cc1` 文档与提案。

## 批次 2：Workspace 详情页拆分（2026-09-07 夜间，待办#1 完成）

- `986bf09` 修复 tailwind.config.js 字体名尾部多余右引号（消除 vite css-syntax-error 警告）
- `2e06530` 详情页从 workspace-panels.tsx（1831 行）拆分至 `src/workspace/components/`：
  workspace-detail-shared / DetailPreview / DetailQuickEditor / 旧 AI 分析面板 / DetailMeta / DetailOverflowMenu / ClipDetailWorkspace（外壳 498 行）；
  workspace-panels.tsx 重写为聚合页 + re-export（173 行），**已移出 file-size 豁免清单（剩 4 项）**。
- 旧 `detail-*` / `aggregate-*` 无样式类全部替换为 Tailwind 语义类；行为与 props 签名不变（App.tsx import 路径不变）。
- 旧 AI 分析面板移出标题栏行（改渲染在 Crumb 下方），分析状态收敛进专用 quick-analysis hook。
- 3 个 verify 脚本（editor-agent-bridge / runtime-boundaries / surface-boundaries）读取路径随拆分同步更新，断言语义不变。
- 验证：build:web ✓ / test:unit ✓ / test:boundaries ✓；cargo check 未重跑（未触碰 src-tauri）；tauri dev 视觉走查跳过（无人值守）。

## 批次 3：聚合页拆分 + Onboarding 向导拆分（2026-09-07 夜间，待办#2/#3 完成）

- `d7fb9a5` 聚合页拆分：`MultiAggregateWorkspace.tsx`（118 行）+ `AggregateItem.tsx`（63 行）；`workspace-panels.tsx` 缩为纯 re-export（5 行）；verify-surface-boundaries 聚合页 marker 检查随迁。
- `5890d76` onboarding 向导拆分：`settings/onboarding-wizard.tsx`（422 行旧类）迁移至 `src/onboarding/components/`（shared 153 行 + OnboardingWizard 268 行 + Step/FeatureCard 小组件），全部换 Tailwind 语义类；键盘导航、快捷键录制、探针、写入路径行为不变；verify-settings-surface 断言路径随迁。
- 验证：build:web ✓ / test:unit ✓ / test:boundaries ✓（两项拆分各验证一轮）；cargo check 未重跑（未触碰 src-tauri）；tauri dev 视觉走查跳过。

## 批次 4：openspec 对账 + AGENTS.md 对齐（2026-09-07 夜间，待办#5/#6 完成）

- `a4d519b` deepseek-harness-embedding/tasks.md 逐项 grep 核验：Phase 6/7 勾选状态与代码一致（09-02 已对齐，无脱节）；Phase 5「详情页/右键入口/历史复用」三个 UI 入口确认落地并勾选；补记对账核验。结论：**该提案剩余项全部为（后置），无可立即推进项**（动旧 AI 侧车须先过基座取舍决策——盟哥拍板项）。
- `8674df9` AGENTS.md 两处过时描述更新：技术栈 UI 行、样式按功能拆分章节（旧 CSS 架构 → Tailwind v3 现实）。
- 验证：build:web ✓ / test:unit ✓（纯文档改动，快速回归）。

## 批次 5：全量回归（自动化部分）+ roadmap 对账（2026-09-07 夜间）

- `a4b923c` PROPOSAL_ROADMAP 补记 09-07 进展。**全量回归可自动化部分全部通过**：
  `build:web` / `test:unit` / `test:boundaries` / `cargo check` 全绿（15 个存量 dead_code 警告非阻塞）；
  `pnpm tauri dev` 后台冒烟通过（编译+启动+运行 70 秒无 error/panic，dev 实例已清理，未影响正式 release 实例）。
- 核对 `file-image-clipboard-support` / `clipboard-multi-format-fidelity`：剩余 7+4 项全部需要真实系统剪贴板证据，**确认无法自动化勾选**，只能实机验收。
- 记录无害告警：vendored 组件（message-scroller / animate-ui sidebar）4 个 `ease-[...]` 类的 Tailwind v3 歧义警告，暂不修改。

## 白天批次（2026-09-08）：提案补档 + 还债开发

- `9f51816` 补立 `tailwind-v3-style-refactor` 提案（proposal/tasks + styling-architecture spec delta，validate --strict ✓）并登记 ROADMAP；旧 AI 面板核验为已完成（修正 HANDOFF 过时状态）。
- `8f50df7` contracts.ts 按域拆分：`contracts/{clipboard,editor,agent,service}-contracts.ts`（≤317 行）+ barrel re-export（6 行），引用方零改动；**豁免清单 4 → 3 项**。
- `a847591` App.tsx 第一刀：切出 `src/clipboard/clip-model.ts`（438 行，Clip 数据模型 + 内容分析纯函数），4051 → 3658 行，外部引用零改动。

### 剩余拆分方案（夜间接力，按序执行）

1. **App.tsx 第二刀 ✅（夜间批次 6，`605de5a`）**：GlassSearchBar（192 行，含 SearchAutocomplete）/ VirtualList（181 行，ROW_HEIGHT/OVERSCAN 随迁）/ TrashPanel（132 行）/ QuickPastePanel（199 行）切至 `src/clipboard/components/`，panel-shared.ts（24 行）承载 logAppError + 剪贴板 AI 分析入口；App.tsx 3658 → **2967 行**，新增导出 PanelDensity/AppSettings。
2. **settings.tsx 第一刀 ✅（夜间批次 7，`bb10ec7`）**：切出 `src/settings/settings-model.ts`（347 行：AppSettings/各 payload 契约/导航常量/getInitialNavigationFromUrl），settings.tsx 1864 → **1566 行**；safeInvokeUpdateCheck/UpdateCheckState 本地保留（verify-runtime-boundaries 断言锚定）；verify-settings-surface 三条导航常量断言已随迁 model 文件。
3. **settings.tsx 第二刀（下一步）**：主体 SettingsApp（约 1170 行）按 section 渲染函数切片（display/capture/storage/mcp-agent/update/tag-rules 各 section 的 JSX 块切为 `src/settings/sections/*.tsx`），每切一个跑全套。
4. **settings.tsx section 切片（批次 33-34，1398 → 872 行）**：五个 section 全部组件化（`4bbe4ff`）——ShortcutLanguage/DisplayPanel/CaptureContent/StorageLogs/McpAgent+UpdateDistribution+TagRules，全部 props 注入。剩余 872 行为主体状态/handler/组装层，性质同 App.tsx（进一步压缩需 store 化，待拍板）。verify-settings-surface 的 3 条 mcpAgentCodeTabs 断言已随迁 McpAgentSection。
4. **App.tsx 主体（批次 30 后 1334 行，战役 B 实质完成）**：主体 return 已全部组件化（TopToolbar/GlassSearchBar/TrashPanel/QuickPastePanel/PanelStatusFeedback/QuickCommandMenu/WorkspaceRouterProvider 均为独立组件），剩余内容为「状态声明 + handler + props 组装」的粘合层。**进一步压缩到 500 行需要把状态整体迁入 zustand store（架构级改动，有行为风险）——超出「纯平移」安全边界，需盟哥拍板是否继续**。可选方案：① 维持现状（1334 行，功能内聚，门禁豁免保留）；② 状态 store 化分批迁（建议白天会话执行）。零风险剩余项已清零。
   - **A. 全局 keydown 键盘导航 effect**（约 300 行）：依赖清单已盘——switchClipboardView/togglePanelPinned/favoriteSelectedClips/runPrimaryOpenAction/copySelectedClips/handlePanelArrowNavigation/applySearchSuggestion/exportSelectedTextFiles + selectedId/activeView/multiSelectMode/filteredClips/selectedInList/searchRef/settingsRef + 十余个 setter。参数注入对象约 25 项；注意 verify-runtime-boundaries 锚定 runPrimaryOpenAction..updateClip 切片、verify-settings-surface 锚定拖拽排除断言（已在 panel-shared）。
   - **B. UI 渲染 JSX**（主体 return，约 800 行）：按 TopCommandBar/ModeBar/ClipboardList/StatusBar/Overlay 区块切展示组件，props 由现有 state/handler 直接传递。
   另剩零散：markClipCopied/updateClip/updateClipContent/exportSelectedTextFiles/copyStandardTextClip 等写回域函数（依赖 state 较多，建议随 B 一起走）。每切一个跑全套；切走前先 grep verify 脚本断言。
4b. **旧 AI 侧车全链删除（批次 36-38）✅**：前端 -528 行（`6275653`，删除旧 AI 面板前端入口、分析服务层、详情页面板组件及全部引用链，AI 分析入口暂缺位待 pi 恢复）+ Rust -553 行（`d7c7bd2`/`8fc1dcb`，删守护进程模块 484 行、lib.rs 命令注册/守护进程/退出清理、tauri 旧 AI 窗口 4→3）；旧 AI 侧车三提案归档至 archive/2026-09-11-*（`0c694e7`）。前端零残留（grep 复查）。**pi-sdk-agent-foundation 提案接管 Agent 能力**（Phase 1 删除 ✅ / Phase 2 集成 ✅，见 4c 条）。
4c. **pi sdk Phase 2 完成 ✅ + Phase 3 首项 ✅（批次 39-40 + 44-50）**：依赖引入、适配层（provider-config/analysis/stream/history）、AI 分析入口恢复（PiAnalysisBar）、工具（clipboard_search/read_latest）、provider 配置 UI 确认已存在（catalog 驱动）；分析历史持久化 ✅（`32c1e9e`，localStorage）。Phase 3 待办：stream 流式接入 UI、provider 结构化表单（可选）。
4c+. **pi sdk L2/L3 收官（2026-10-08，24/26）**：L2 Key redaction/keyRef ✅（settings 读路径恒 "[redacted]" 占位、写路径 apiKeyEnv 环境变量引用 + write.rs preserve 回填；真机走查 settings.json5 仅落 apiKeyEnv，`clipf.agent.providers` 返回 `apiKey:"not-sent-to-react"`）+ provider 表单 ✅（AgentProviderManager.tsx，增删改 + 双 kind + enabled 开关，真机新建 → `clipf.agent.check` status=ready）+ L3 智能标签 ✅（PiAnalysisBar 建议 chip 点击检索 + 「应用标签」合并去重走 onApplyTags 通道）。端到端链路验证：本地 new-api 网关（127.0.0.1:20140，glm-5.3-flash）chat/completions 200 且正常返回；`clipf.agent.check` ready。剩 Phase 4 两项：全量回归（test:unit/tsc/vite/cargo check 本轮已过，待盟哥真机视觉/功能验收）+ 本条文档收官。
4d2. **lib.rs 拆分序②（SETTINGS_WRITE_LOCK 接管）侦察（批次 48）**：settings 写盘链分布——
   - **紧凑组**（命令层相邻，纯平移候选）：log_slow_settings_operation(2374)/sync_launch_at_login_from_settings(2511)/emit_settings_changed(2633)/settings_write_response(2655)/refresh_tray_menu_after_settings_write(2672)；SETTINGS_WRITE_LOCK(2362, 已 pub(crate))。
   - **分散组**：read_user_settings(5327, **主体 27 处引用**)/write_user_settings(5418, 7 处)/sync_global_shortcut_registration(8146, 快捷键域深处)。
   - 评估：紧凑组五函数可先随命令层迁（迁后经 crate:: 反向引用或 re-export）；read_user_settings 引用面巨大，迁出收益低（其本体依赖 settings_path/DB 连接），建议**留主体**、命令层经 crate:: 调用即可。refresh_tray_menu 仅命令层 1 处使用 ✓ 随迁无阻力。
   - 结论：拆分序② 的可安全迁移量为「紧凑组五函数」（约 150 行），lib.rs 预计 13813→13650；read/write_user_settings 与快捷键域留主体。每段过 cargo check + 冒烟。
4d. **lib.rs Phase 4 agent/mcp 域侦察（批次 44-45 补全）**：
   - **agent 域**：函数群分散于 1413-1810（约 400 行连续：agent_detect_candidates/local_agent_candidate/openai_compatible_agent_candidate/cached_readiness/agent_candidate_by_id/check_agent_candidate/check_openai_compatible_models/provider_configs_with_readiness/compact_agent_text/agent_context_summary 等）+ 2327-2361（resolve_agent_config/agent_check_provider/agent_list_provider_models）+ 2703（agent_detect）+ 640-680 三 struct。属 **Phase 4 级别大手术**（600+ 行、依赖链深），需新会话满上下文分批执行。
   - **mcp 域**：两块分布——① 5857-5920（start/stop_mcp_server/get_mcp_status 命令）；② 11710-12000 区（mcp_status_payload/mcp_tool_names/run_mcp_stdio——**pub，被 stdio 入口调用**/handle_mcp_request/mcp_error 系列/mcp_tools/mcp_tool_specs）；另有 608 McpStatusPayload/874 McpToolSpec struct。约 400+ 行，迁 mcp/mod.rs 时 run_mcp_stdio 须 pub 导出（main/stdio 入口调用）。
   - 侦察结论：agent/mcp 两域均属 Phase 4 级别，建议各自独立会话满上下文执行；每段过 cargo check + 带隔离开关冒烟。
5. **lib.rs（批次 49 后 13745 行）**：拆分序① ✅（schema 域）+ 拆分序② ✅（`96de00e`，写盘编排辅助四函数迁入 commands.rs，累计 329 行；sync_launch 主体两处调用经 re-export 零改动；refresh_tray 留主体经 crate:: 引用并补 Emitter trait），冒烟 ✓。拆分序③：agent/mcp 域（Phase 4 级别，侦察已入档 4d 条，需满上下文分批执行）。settings 写盘链剩余 read/write_user_settings 与快捷键域留主体（侦察结论：迁出收益低）。

## 批次 51-55（2026-09-24 白天）：交互规范 v1.0 + 自动化走查基线（视觉走查人工缺位问题的解法）

新增 `docs/INTERACTION_SPEC.md`（悬浮窗适配/反馈三件套/图标按钮/页面结构/快捷键/数据降级六章），并建了一套浏览器内可跑的走查基线，把「只能人眼过」的视觉走查变成可回归断言：

- `8545f3a` 基建：`tauri-web-mock.ts`（与 Rust 同名同参命令协议桥，dev-only，三入口第一行导入）+ `preview.html` 预览壳 + 种子数据 + ego-browser 驱动脚本 2 套（交互回归 14 用例 / 逐交互视觉走查 13 用例 + 性能采样，截图落 `/tmp/clipforge-visual/audit/`）。修复 networkidle 被 Vite HMR 长连接卡死：改 load + 显式轮询。`pnpm test:interaction` 入 package.json。
- `ee5b040` 反馈三件套对齐：toast 轻胶囊（12px/6×12/8px/1.4s，去 description）；tooltip portal 优先上方 + 首帧估计高度后 useLayoutEffect 校正；状态栏右侧 max-w-[58%] truncate；补 4 个 i18n key 清硬编码。
- `b74d370` 右键菜单受控常开（非受控永远弹不出的真 bug）+ `getCurrentWindowSafe`/`isTauriRuntime` 浏览器降级（同步抛错曾致 ErrorBoundary 重挂载死循环）+ `?lang=` URL 固定语言。
- `08c547a` 悬浮窗窄窗适配（w-[min(480px,100%)]，420/320 不再裁操作区）+ ClipDetailWorkspace 主内容直出重构（链接 chip、采集上下文默认折叠、底色透明）。
- `de2b180` Rust：`CLIPFORGE_DATA_DIR` 数据目录隔离（tauri dev 并行验证不碰正式数据）。

**验证（2026-09-24 全套）**：build:web ✓ / 交互回归 14/14 PASS / 视觉走查 13/13 PASS（320 窄窗零溢出）/ 性能：搜索 136ms、0 长任务 / cargo check ✓（21 存量警告非阻塞）。

## 待办事项（按优先级，批次 5 后更新）

**夜间任务的可自动化待办已清零**。剩余事项全部需要盟哥人工参与（2026-10-01 按总纲波次对账修订）：

1. **真机走查**（仍缺人眼，W1）：浏览器自动化基线（批次 51-55）已覆盖 14 交互 + 13 视觉断言，但 `pnpm tauri dev` 实机过一遍详情页/聚合页/onboarding 三个 surface 仍待盟哥执行；可用 `CLIPFORGE_DATA_DIR=$(mktemp -d) pnpm tauri dev` 隔离数据并行验证。走查后随 `tailwind-v3-style-refactor` Phase 5/6 收口（旧 AI 面板 iframe 细节项已作废——旧 AI 侧车全链删除，AI 面由 PiAnalysisBar 承接）
2. **7 场景实机验收矩阵**（W1）：`file-image-clipboard-support` + `clipboard-multi-format-fidelity` 剩余项（复制/粘贴/显示/清理证据），完成后两提案可归档
3. ~~旧 AI 侧车基座取舍决策~~ **已裁决**（2026-09-11 `a020068`）：pi sdk 确立为 Agent 基座，旧 AI 侧车全链删除完成；pi-sdk 剩余项见其 tasks.md（24/26，仅剩 Phase 4 真机验收 + 收官归档）
4. **grilling 会话 Q1–Q4**：产品方向问题待回答

夜间任务至此进入「无事可做秒退」状态：工作区干净、可自动化验证全绿、可推进提案项清零。后续夜晚的触发若仍无新待办（盟哥白天未新增），会话将直接退出。若确认不再需要，可删除定时任务 automation-7b5269b1。

## 当前状态

- **主面板**：视觉重构完成，功能保留
- **设置窗口**：Shell + 控件完成，内容区功能保留
- **Workspace（详情页）**：已拆分完成，全部 Tailwind 语义类（批次 2）
- **Workspace（聚合页）**：已拆分完成（批次 3），`workspace-panels.tsx` 仅剩 re-export
- **Onboarding**：向导已拆分至 `src/onboarding/components/` 并清理旧类（批次 3）；`OnboardingApp.tsx` 根容器已 Tailwind
- **旧 AI 面板**：已完成 Tailwind 化（核验：header/iframe/状态提示全为语义类，无旧类残留），无需再对齐。

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
| 旧 AI 面板组件（已删除） | 已删除 | 曾核验全 Tailwind 语义类（批次 6 复核），随全链删除移除 |

## 建议技能

- `shadcn`：用于继续添加/更新 shadcn 组件
- `tailwind`：用于 Tailwind 配置和类名调试
- `frontend-design`：用于视觉规范参考
- `code-review`：用于完成后自查

## 注意事项

- 不要恢复任何已删除的 CSS 文件。
- 所有新样式必须使用 `hsl(var(--token))` 或 Tailwind 语义类。
- 保持 `data-surface="clipboard"` / `"settings"` / `"workspace"` / `"onboarding"` marker。
- 每完成一个子组件即跑 `pnpm build:web`。
