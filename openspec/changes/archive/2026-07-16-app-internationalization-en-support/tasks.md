# 任务：应用国际化与英文支持

## Phase 1：基础设施

- [x] 新建 `src/i18n/` 目录和字典结构
- [x] 定义 `AppLanguagePreference` 与 `AppLocale`
- [x] 实现 `t()` 和 `useI18n()`
- [x] 支持简单参数替换
- [x] 缺失 key 在开发环境输出 warning
- [x] 增加 `zh-CN` / `en-US` key 对齐检查

## Phase 2：设置与启动

- [x] settings JSON 增加 `language`
- [x] 设置页新增语言选择：跟随系统 / 中文 / English
- [x] 启动时解析系统语言并确定实际 locale
- [x] 切换语言后刷新 UI
- [x] 重启后保持用户选择
- [x] 设置 `document.documentElement.lang`
- [x] 设置主窗口和设置窗口标题

## Phase 3：前端 UI 文案迁移

- [x] 快速面板文案接入 i18n
- [x] 设置页文案接入 i18n
- [x] 详情页基础动作接入 i18n
- [x] 空状态、错误状态、toast 接入 i18n
- [x] 按钮 tooltip 和菜单项接入 i18n
- [x] 检查英文文案长度不破坏快速面板布局

## Phase 4：原生菜单与系统提示

- [x] 托盘菜单文案接入语言设置
- [x] 暂停/恢复监听文案随语言刷新
- [x] 权限提示文案接入 i18n
- [x] 更新检查相关文案预留 key
- [x] 前端新增 `CODE: detail` 原生命令错误解析与 i18n 格式化，详情编辑保存错误已接入
- [x] Rust command 错误保留错误码，UI 层负责翻译可读提示

## Phase 5：收口检查

- [x] 新增硬编码用户文案扫描脚本
- [x] 白名单排除日志字段、错误码、测试、文档和用户内容
- [x] 新增 key 引用存在性检查
- [x] 在发版 checklist 中加入 i18n 检查
- [x] 文档化新增功能必须同步补中文和英文文案

## Phase 6：验证

- [x] `pnpm build` 通过
- [x] `cd src-tauri && cargo check` 通过
- [x] 验证默认跟随系统
- [x] 验证中文切换
- [x] 验证英文切换
- [x] 验证重启后语言保持
- [x] 验证托盘菜单语言刷新
- [x] 验证英文长文案不导致按钮、列表、设置表单溢出

### Phase 6 验证记录（2026-07-16）

- 已用 Vite preview + Playwright 静态检查 `settings.html`，浏览器 locale 为 `en-US`，720x640 与 900x640 下 `document.documentElement.lang === "en-US"`，页面和 body 横向溢出均为 0，按钮、输入、设置侧边栏、Tabs、Setting Row 和 Code Tabs 未发现非滚动型横向溢出。
- 主面板英文快速面板/列表布局未勾选：当前浏览器预览主入口依赖 Tauri runtime fallback，Playwright 主入口检查不稳定，不能作为 `pnpm tauri dev` 或真实主面板布局证据。

### Phase 6 复跑记录（2026-07-16）

- 已复跑 `pnpm check:i18n`：通过；`zh-CN.json` / `en-US.json` 共 763 个 key 对齐，引用检查覆盖 582 个 key。
- `scripts/scan-hardcoded-copy.mjs` 仍输出 208 个 hardcoded user-copy candidates，但按当前白名单/候选报告策略退出成功；这些候选不能单独证明 UI 已无硬编码文案。
- 当前 Node 依赖无法 `require("playwright")`，本轮未复现上一轮浏览器布局检查。
- 因未取得真实 Tauri 主面板、托盘菜单和重启持久化证据，本轮不勾选剩余 Phase 3/6 验收项。

### Phase 6 契约验证补充（2026-07-16）

- 新增并运行 `pnpm check:i18n-runtime`：通过；覆盖字典 key 对齐、`system`/`zh-CN`/`en-US` 解析、`document.documentElement.lang`、主窗口/设置窗口标题更新、设置页语言切换即时刷新、主窗口 legacy settings 持久化、Rust `current_native_locale()` 设置/环境变量回退、`native_tr()` 托盘文案、`build_tray_menu()` 使用翻译以及 `update_clipforge_settings()` 写入后重建托盘菜单。
- 已复跑 `pnpm check:i18n`：通过；`zh-CN.json` / `en-US.json` 共 776 个 key 对齐，引用检查覆盖 595 个 key；硬编码候选为 211 个，仍按候选报告处理。
- 已复跑 `node scripts/verify-runtime-boundaries.mjs`：通过，确认设置窗口启动时不阻塞 `check_update`。
- 以上是静态/契约证据，不能替代真实 `pnpm tauri dev` 的系统语言、语言切换、重启持久化、托盘菜单刷新和主快速面板英文布局验收，因此剩余 Phase 3/6 项继续保持未勾选。

### Phase 6 Tauri 语言切换验证补充（2026-07-16）

- 已运行 `CLIPFORGE_DEV_OPEN=settings CLIPFORGE_DEV_I18N_PROBE=1 pnpm tauri dev`：通过。`zh-CN` patch 后快照为 `title="ClipForge 设置"`、`lang="zh-CN"`、正文为中文；`en-US` patch 后快照为 `title="ClipForge Settings"`、`lang="en-US"`、正文包含 `ClipForge Settings`、`Config synced to JSON5`、`Shortcuts & language` 等英文文案。
- Settings Service 每次语言 patch 都输出 `[tray] rebuilt menu after settings write reason=settings-service-patch`，确认托盘菜单刷新链路已由真实 Tauri dev probe 覆盖。
- i18n probe 会恢复原始设置，复核 `settings.json5` 仍为 `"language": "system"`。
- `system` 仍未勾选：本机 `current_native_locale()` 返回 `en-US`，但 WebView `navigator.language` 在 `system` 下解析为 `zh-CN`，两者来源不一致；需后续明确系统语言 canonical source 后再收口。
- 重启持久化和主面板英文快速面板/列表长文案仍未取得真实运行证据，继续保持未勾选。

### Phase 6 默认系统语言验证补充（2026-07-16）

- 已确认 macOS GUI 语言为 `defaults read -g AppleLanguages => zh-Hans-CN`，WebView `navigator.language` 在 Tauri 设置窗口下解析为 `zh-CN`；此前 Rust native 使用 shell `LANG=C.UTF-8`，导致 `current_native_locale()` 在 `system` 下误判为 `en-US`。
- 已修复 Rust native system locale：macOS 下优先读取 `AppleLanguages` / `AppleLocale`，失败时再 fallback 到 `LANG` / `LC_ALL` / `LC_MESSAGES`。
- 已复跑 `CLIPFORGE_DEV_OPEN=settings CLIPFORGE_DEV_I18N_PROBE=1 pnpm tauri dev`：`i18n probe started original=system nativeLocale=zh-CN`，`system` patch 后 `nativeLocale=zh-CN`，设置窗口快照为 `title="ClipForge 设置"`、`lang="zh-CN"`、正文中文，native 和 WebView 已对齐。
- 重启持久化和主面板英文快速面板/列表长文案仍未取得真实运行证据，继续保持未勾选。

### Phase 6 重启持久化验证补充（2026-07-16）

- 已给 debug i18n probe 增加 `initial` 启动快照：在任何语言 patch 前记录设置窗口当前 `title`、`document.documentElement.lang` 和正文片段，用于验证进程启动时读取的持久化语言。
- 已备份真实 `settings.json5`，临时将 `"language"` 置为 `"en-US"` 后重新启动 `CLIPFORGE_DEV_OPEN=settings CLIPFORGE_DEV_I18N_PROBE=1 pnpm tauri dev`：启动日志为 `i18n probe started original=en-US nativeLocale=en-US`，`initial` 快照为 `title="ClipForge Settings"`、`lang="en-US"`、正文包含 `ClipForge Settings` 和 `Config synced to JSON5`。
- probe 完成后已恢复原始设置文件，复核 `settings.json5` 回到 `"language": "system"`。
- 主面板英文快速面板/列表长文案仍未取得真实运行证据，继续保持未勾选。

### Phase 6 主面板英文布局验证补充（2026-07-16）

- 已扩展 debug `perf_probe`，在主面板打开后记录 `documentLang`、窗口标题、页面横向 overflow、可见元素越界数量和文本控件溢出数量。
- 已备份真实 `settings.json5`，临时将 `"language"` 置为 `"en-US"` 后运行 `CLIPFORGE_DEV_OPEN=panel CLIPFORGE_DEV_PERF_REPEAT=1 pnpm tauri dev`：日志显示 `documentLang="en-US"`、`documentOverflowX=0`、`bodyOverflowX=0`、`escapedCount=0`、`controlOverflowCount=0`，`panel.open p95=60ms`。
- probe 完成后已恢复原始设置文件，复核 `settings.json5` 回到 `"language": "system"`。
