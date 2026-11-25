import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const appPath = path.join(root, "src/App.tsx");
// 详情页溢出菜单已拆分至独立文件（插件动作失败边界在其中）。
const overflowMenuPath = path.join(root, "src/workspace/components/DetailOverflowMenu.tsx");
const shortcutSectionPath = path.join(root, "src/settings/sections/ShortcutLanguageSection.tsx");
const displayPanelSectionPath = path.join(root, "src/settings/sections/DisplayPanelSection.tsx");
const settingsPath = path.join(root, "src/settings.tsx");
const settingsActionsPath = path.join(root, "src/settings/settings-actions.ts");
const settingsCatalogPath = path.join(root, "src/settings/settings-field-catalog.ts");
const zhLocalePath = path.join(root, "src/i18n/locales/zh-CN.json");

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function assert(condition, message) {
  if (!condition) {
    console.error(`Runtime boundary verification failed: ${message}`);
    process.exitCode = 1;
  }
}

function sliceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) return "";
  return source.slice(startIndex, endIndex);
}

const app = read(appPath);
const overflowMenu = read(overflowMenuPath);
const settings = read(settingsPath);
const settingsActions = read(settingsActionsPath);
// S1 动作切片后 update/accessibility/reset 动作落在 settings-actions.ts;
// 合并两文件再切 anchor,断言本身不弱化(bootstrap 的负向断言仍只看 settings.tsx,
// 因为 check_update 的 invoke 已随动作移入 hook,合并会误报)。
const settingsMerged = settings + "\n" + settingsActions;
const shortcutSection = read(shortcutSectionPath);
const displayPanelSection = read(displayPanelSectionPath);
const settingsCatalog = read(settingsCatalogPath);
const zhLocale = read(zhLocalePath);

assert(app.includes("class PanelContentBoundary"), "Panel content boundary is missing");
assert(app.includes("<PanelContentBoundary") && app.includes("resetKey={`workspace:"), "Workspace router is not wrapped in the panel boundary");

const primaryAction = sliceBetween(app, "async function runPrimaryOpenAction", "async function deleteClips");
assert(primaryAction.includes("try {"), "Primary plugin action has no failure boundary");
assert(primaryAction.includes("resolvePrimaryPluginAction"), "Primary plugin action resolver is not covered");
assert(primaryAction.includes('logAppError("warn", "quick-action: plugin action failed"'), "Primary plugin action failure is not logged");
assert(primaryAction.includes('setNativeStatus(tr("main.status.pluginActionUnavailable"))'), "Primary plugin action failure does not degrade to status");
assert(zhLocale.includes('"main.status.pluginActionUnavailable": "插件动作暂时不可用，剪贴板列表仍可继续使用"'), "Primary plugin action failure copy is missing from zh-CN locale");

const detailActions = sliceBetween(overflowMenu, "<DropdownMenuContent", "</DropdownMenuContent>");
assert(detailActions.includes("try {"), "Workspace action strip has no per-action failure boundary");
assert(detailActions.includes("workspace-plugin-action-failed"), "Workspace action failures are not logged");
assert(!detailActions.includes("throw error"), "Workspace action strip rethrows plugin failures");

assert(settings.includes("async function safeInvokeUpdateCheck"), "Settings update check is not isolated");
assert(shortcutSection.includes('tr("settings.accessibility.title")'), "Settings accessibility title is not wired to i18n");
assert(settingsCatalog.includes('labelKey: "settings.section.shortcutLanguage"'), "Settings section navigation is not wired to i18n keys");
assert(settings.includes('tr(item.labelKey)'), "Settings section navigation labels are not translated at render time");
assert(shortcutSection.includes('tr("settings.shortcut.quickOpen")'), "Settings shortcut copy is not wired to i18n");
assert(displayPanelSection.includes('tr("settings.display.density")'), "Settings display density copy is not wired to i18n");
assert(shortcutSection.includes('tr("settings.accessibility.status.granted")'), "Settings accessibility granted state is not wired to i18n");
assert(shortcutSection.includes('tr("settings.accessibility.action.request")'), "Settings accessibility request action is not wired to i18n");
assert(settingsMerged.includes('status: tr("settings.accessibility.status.reset")'), "Settings accessibility reset status is not wired to i18n");
assert(zhLocale.includes('"settings.accessibility.title": "macOS 辅助功能权限"'), "Settings accessibility copy is missing from zh-CN locale");
const safeUpdate = sliceBetween(settingsMerged, "async function safeInvokeUpdateCheck", "async function runUpdateAction");
assert(safeUpdate.includes('errorCode: "UPDATE_CHECK_FAILED"'), "Failed update checks do not expose a stable error code");
const settingsBootstrap = sliceBetween(settings, "Promise.all([", "]);");
assert(!settingsBootstrap.includes('"check_update"'), "Settings bootstrap still calls check_update directly");
assert(settings.includes("void safeInvokeUpdateCheck().then"), "Settings update check is not deferred after bootstrap");
// S2 窗口/面板域切片：核心符号必须落在 window/ 模块，lib.rs 只保留注册与 mod 声明。
const windowDirPath = path.join(root, "src-tauri/src/window");
const windowModPath = path.join(windowDirPath, "mod.rs");
const windowPositionPath = path.join(windowDirPath, "position.rs");
const libRsPath = path.join(root, "src-tauri/src/lib.rs");
assert(fs.existsSync(windowModPath), "window/mod.rs module is missing");
assert(fs.existsSync(windowPositionPath), "window/position.rs module is missing");
const windowMod = fs.existsSync(windowModPath) ? read(windowModPath) : "";
const windowPosition = fs.existsSync(windowPositionPath) ? read(windowPositionPath) : "";
const windowDomain = windowMod + "\n" + windowPosition;
for (const symbol of [
    "fn open_panel",
    "fn hide_panel",
    "fn show_quick_panel",
    "fn toggle_quick_panel",
    "fn hide_panel_with_native_fade",
]) {
    assert(windowDomain.includes(symbol), `window module lost core symbol: ${symbol}`);
}
const libRs = fs.existsSync(libRsPath) ? read(libRsPath) : "";
assert(libRs.includes("mod window;"), "lib.rs no longer declares the window module");
assert(!libRs.includes("fn open_panel<"), "lib.rs still holds open_panel implementation");
assert(!libRs.includes("fn hide_panel_with_native_fade<"), "lib.rs still holds the native fade implementation");
// 注册面：13 条面板/窗口命令必须在 lib.rs generate_handler! 以 window:: 路径注册。
const handlerSlice = sliceBetween(libRs, "generate_handler![", "]");
for (const command of [
    "window::set_panel_mode",
    "window::open_settings_window",
    "window::open_settings_window_with_section",
    "window::open_onboarding_window",
    "window::focused_input_bounds",
    "window::show_quick_panel_command",
    "window::hide_quick_panel_command",
    "window::toggle_quick_panel_command",
    "window::focus_quick_panel_command",
    "window::release_focus_command",
    "window::get_panel_trigger_status",
    "window::set_panel_pinned_command",
    "window::is_panel_pinned_command",
]) {
    assert(handlerSlice.includes(command), `generate_handler is missing registration: ${command}`);
}

if (!process.exitCode) {
  console.log("Runtime boundary verification passed");
}
