# Tasks:settings-status-bar-and-dead-ai-cleanup

## 1. 底部状态信息栏（用户核心诉求）

- [x] 1.1 SettingsShell 新增 props：`versionMeta?: string` + `updateBadge?: { tone: "idle"|"checking"|"ok"|"available"|"error"; label: string; detail?: string }`；底部栏（:123-132）渲染 `v{version} · {versionMeta} · {badge}`，badge 用语义 token（error→text-destructive，ok→text-emerald-700 dark:text-emerald-400），title=detail
- [x] 1.2 settings.tsx:767 传入 versionMeta（`state.update?.channel ?? "stable"`）+ updateBadge（按 state.update.status 映射；lastCheckedAt/errorCode/errorMessage 组 detail）
- [x] 1.3 i18n 补 5 键 `settings.update.badge.{unknown,checking,failed,available,upToDate}`，zh-CN.json/en-US.json 对称
- [x] 1.4 docs/DESIGN_SYSTEM.md §7.2 底部规范补状态信息栏条目 --2026-10-13:§7.2 重写对齐现状（侧栏 172px 固定常驻/背景色差分隔）+ 补底部状态条（2.5s 回落/错误态常驻）与兜底四态（SettingsSectionFallback）条目
- [ ] 1.5 沙箱实测（pnpm dev:sandbox 开 settings 窗口）：failed 态 badge 与截图场景一致、title 悬停显示错误详情、版本/channel 正确

## 2. 伪 toast 转 transient

- [x] 2.1 settings.tsx 加 configStatus 自动清除（useEffect + timer ref，2.5s；写中文注释说明为什么不能常驻）
- [ ] 2.2 验证：保存后提示出现 2.5s 后回落 section 名；启动加载同步文案同样淡出；失败态不受影响

## 3. 死残留清理（旧 AI 线）

- [x] 3.1 删 ClipContextMenu「AI 分析」菜单项（ClipContextMenu.tsx:170-177）+ props 接口两行（:43,:69-70）+ 解构一行；确认全仓无 onAnalyzeClipboard 传值后不留死 prop
- [x] 3.2 删 Onboarding Agent 功能卡片（onboarding-wizard-shared.ts:98-104）+ i18n 两键（settings.onboarding.feature.agent.title/body）+ Bot 图标 import（如无其他引用）
- [x] 3.3 清理 i18n 死键簇（部分完成:onboarding agent 键已删;sceneAi/detail.aiSummary 等旧键簇待专项）--2026-10-13 专项完成:zh/en 对称删 38×2 键（sceneAi.*/detail.aiSummary.*/detail.aiRecommend.*/status.aiSummary*/toast.aiSummaryReady/list.aiSummary*/joyride.*）+ sidebar 收起键 2×2（collapseSidebar/expandSidebar,随 SettingsShell 常驻化废弃）;逐键 grep 确认零引用,JSON 合法
- [x] 3.4 修正过期注释：panel-shared.ts:1「AI 分析入口」、ClipDetailWorkspace.tsx:72「AI 分析随 pi-sdk 迁移待恢复」、clipboard-domain.ts:2「AI 摘要状态文案」--2026-10-13:panel-shared.ts:1 改「模块级日志、窗口拖拽与 UI store」、clipboard-domain.ts:2 删「AI 摘要状态文案」;ClipDetailWorkspace.tsx 一处经先前 pi-sdk 插件区收敛批次已修,grep 无残留

## 4. 多选状态（待用户拍板，未确认不动）

- [ ] 4.1 [待定] 是否将 App.tsx:392-398 showQuickPanel 的无条件清空改为「跨唤起保留 selectedIds/multiSelectMode」——tradeoff：保留则重开面板可能面对陈旧选择（批量删除误触风险）；清空则每次全新（当前行为）。确认后实施并补交互验证

## 5. 收尾

- [ ] 5.1 门禁：pnpm build + pnpm test:unit（含 check:i18n、verify-file-size、locate --check-index）
- [ ] 5.2 沙箱实测：设置页底部信息栏 + 右键菜单无 AI 项 + 引导无 Agent 卡片
- [ ] 5.3 盟哥验收后归档
