import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const appPath = path.join(root, "src/App.tsx");
const workspacePath = path.join(root, "src/workspace/workspace-panels.tsx");
const settingsPath = path.join(root, "src/settings.tsx");
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
const workspace = read(workspacePath);
const settings = read(settingsPath);
const zhLocale = read(zhLocalePath);

assert(app.includes("class PanelContentBoundary"), "Panel content boundary is missing");
assert(app.includes("<PanelContentBoundary") && app.includes("resetKey={`workspace:"), "Workspace router is not wrapped in the panel boundary");
assert(app.includes("class AgentPanelBoundary"), "Agent panel boundary is missing");
assert(app.includes("<AgentPanelBoundary"), "Agent overlay is not wrapped in the Agent boundary");
assert(app.includes('agentTitle: tr("main.errorBoundary.agentTitle")'), "Agent boundary fallback title is not wired to i18n");
assert(app.includes('agentMessage: tr("main.errorBoundary.agentMessage")'), "Agent boundary isolated failure copy is not wired to i18n");
assert(zhLocale.includes('"main.errorBoundary.agentTitle": "Agent 面板暂时不可用"'), "Agent boundary fallback copy is missing from zh-CN locale");
assert(zhLocale.includes('"main.errorBoundary.agentMessage": "错误已写入日志，剪贴板列表和详情页不会受影响。"'), "Agent boundary isolated failure copy is missing from zh-CN locale");
const agentOverlay = sliceBetween(app, '<div className="agent-overlay-scrim" />', "</div>\n      </div>");
assert(agentOverlay.includes("<AgentPanelBoundary"), "Agent boundary is not scoped to the overlay");
assert(!agentOverlay.includes("<PanelContentBoundary"), "Agent failure boundary is mixed with the workspace boundary");

const primaryAction = sliceBetween(app, "async function runPrimaryOpenAction", "function updateClip");
assert(primaryAction.includes("try {"), "Primary plugin action has no failure boundary");
assert(primaryAction.includes("resolvePrimaryPluginAction"), "Primary plugin action resolver is not covered");
assert(primaryAction.includes('logAppError("warn", "quick-action: plugin action failed"'), "Primary plugin action failure is not logged");
assert(primaryAction.includes('setNativeStatus(tr("main.status.pluginActionUnavailable"))'), "Primary plugin action failure does not degrade to status");
assert(zhLocale.includes('"main.status.pluginActionUnavailable": "插件动作暂时不可用，剪贴板列表仍可继续使用"'), "Primary plugin action failure copy is missing from zh-CN locale");

const detailActions = sliceBetween(workspace, '<DropdownMenuContent className="detail-action-menu"', "</DropdownMenuContent>");
assert(detailActions.includes("try {"), "Workspace action strip has no per-action failure boundary");
assert(detailActions.includes("workspace-plugin-action-failed"), "Workspace action failures are not logged");
assert(!detailActions.includes("throw error"), "Workspace action strip rethrows plugin failures");

assert(settings.includes("async function safeInvokeUpdateCheck"), "Settings update check is not isolated");
assert(settings.includes('tr("settings.accessibility.title")'), "Settings accessibility title is not wired to i18n");
assert(settings.includes('labelKey: "settings.section.shortcut"'), "Settings section navigation is not wired to i18n keys");
assert(settings.includes('tr(item.labelKey)'), "Settings section navigation labels are not translated at render time");
assert(settings.includes('tr("settings.shortcut.quickOpen")'), "Settings shortcut copy is not wired to i18n");
assert(settings.includes('tr("settings.display.density")'), "Settings display density copy is not wired to i18n");
assert(settings.includes('tr("settings.accessibility.status.granted")'), "Settings accessibility granted state is not wired to i18n");
assert(settings.includes('tr("settings.accessibility.action.request")'), "Settings accessibility request action is not wired to i18n");
assert(settings.includes('status: tr("settings.accessibility.status.reset")'), "Settings accessibility reset status is not wired to i18n");
assert(zhLocale.includes('"settings.accessibility.title": "macOS 辅助功能权限"'), "Settings accessibility copy is missing from zh-CN locale");
const safeUpdate = sliceBetween(settings, "async function safeInvokeUpdateCheck", "const tagModeLabels");
assert(safeUpdate.includes('status: "failed"'), "Failed update checks do not return a failed state");
assert(safeUpdate.includes('errorCode: "UPDATE_CHECK_FAILED"'), "Failed update checks do not expose a stable error code");
const settingsBootstrap = sliceBetween(settings, "const [settings, configPath", "]);");
assert(settingsBootstrap.includes("safeInvokeUpdateCheck()"), "Settings bootstrap still calls check_update directly");

if (!process.exitCode) {
  console.log("Runtime boundary verification passed");
}
