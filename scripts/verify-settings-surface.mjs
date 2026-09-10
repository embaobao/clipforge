import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

const files = {
  app: "src/App.tsx",
  topToolbar: "src/clipboard/components/TopToolbar.tsx",
  onboarding: "src/onboarding/components/OnboardingWizard.tsx",
  onboardingShared: "src/onboarding/components/onboarding-wizard-shared.ts",
  settings: "src/settings.tsx",
  settingsModel: "src/settings/settings-model.ts",
  controls: "src/settings/controls.tsx",
  settingsShell: "src/settings/components/SettingsShell.tsx",
  codeTabs: "src/settings/components/SettingsCodeTabs.tsx",
  statusPanel: "src/settings/components/SettingsStatusPanel.tsx",
  animateTooltip: "src/components/animate-ui/primitives/animate/tooltip.tsx",
};

function read(relativePath) {
  const filePath = path.join(root, relativePath);
  if (!fs.existsSync(filePath)) {
    throw new Error(`${relativePath} not found`);
  }
  return fs.readFileSync(filePath, "utf8");
}

function compact(source) {
  return source.replace(/\s+/g, " ").trim();
}

function assert(condition, message) {
  if (!condition) {
    console.error(`Settings surface verification failed: ${message}`);
    process.exitCode = 1;
  }
}

function include(source, needle, message) {
  assert(compact(source).includes(compact(needle)), message);
}

function match(source, pattern, message) {
  assert(pattern.test(source), message);
}

function exclude(source, needle, message) {
  assert(!compact(source).includes(compact(needle)), message);
}

function extractList(source, name) {
  const start = source.indexOf(`const ${name}`);
  assert(start >= 0, `${name} block is missing`);
  const end = source.indexOf("];", start);
  assert(end >= 0, `${name} block is not terminated`);
  const body = source.slice(start, end + 2);
  return [...body.matchAll(/key:\s*"([^"]+)"/g)].map((match) => match[1]);
}

const app = read(files.app);
const topToolbar = read(files.topToolbar);
const onboarding = read(files.onboarding);
const onboardingShared = read(files.onboardingShared);
const settings = read(files.settings);
const panelShared = read("src/clipboard/panel-shared.ts");
const panelKeyboard = read("src/clipboard/use-panel-keyboard.ts");
const shortcutSection = read("src/settings/sections/ShortcutLanguageSection.tsx");
const storageSection = read("src/settings/sections/CaptureStorageSections.tsx");
const settingsModel = read(files.settingsModel);
const mcpAgentSection = read("src/settings/sections/AgentUpdateTagSections.tsx");
const controls = read(files.controls);
const settingsShell = read(files.settingsShell);
const codeTabs = read(files.codeTabs);
const statusPanel = read(files.statusPanel);
const animateTooltip = read(files.animateTooltip);

// Onboarding surface: 只验证可重复的源代码语义，不碰真实系统权限或剪贴板回写。
// 向导已拆分至 src/onboarding/components/：类型与常量在 onboarding-wizard-shared，交互在 OnboardingWizard。
include(
  onboardingShared,
  'type OnboardingStepKey = "welcome" | "accessibility" | "capture" | "shortcut" | "tour";',
  "onboarding wizard should expose the five-step flow",
);
assert(
  JSON.stringify(extractList(onboardingShared, "STEPS")) === JSON.stringify(["welcome", "accessibility", "capture", "shortcut", "tour"]),
  "onboarding wizard steps should stay ordered as welcome/accessibility/capture/shortcut/tour",
);
assert(
  JSON.stringify(extractList(onboardingShared, "CAPTURE_FIELDS")) ===
    JSON.stringify([
      "captureTextEnabled",
      "captureHtmlEnabled",
      "captureRtfEnabled",
      "captureImageEnabled",
      "captureFileEnabled",
      "captureSensitiveEnabled",
    ]),
  "onboarding capture fields should stay tied to the six capture toggles",
);
include(onboarding, "handleWizardKeyDown", "onboarding wizard should keep keyboard navigation");
include(onboarding, "ArrowRight", "onboarding wizard should advance with ArrowRight");
include(onboarding, "ArrowLeft", "onboarding wizard should go back with ArrowLeft");
include(onboarding, 'event.key === "Enter"', "onboarding wizard should advance from Enter on the root container");
include(onboarding, 'updateSettings({ onboardingCompleted: true });', "onboarding completion should persist onboardingCompleted");
match(onboarding, /updateSettings\(\{\s*\[field\.key\]: checked\s*\}\)/, "capture toggles should write through updateSettings immediately");
match(onboarding, /updateSettings\(\{\s*globalShortcut:\s*event\.currentTarget\.value\s*\}\)/, "shortcut input should save through updateSettings");
include(onboardingShared, "settings.onboarding.feature.search.title", "onboarding feature overview should still include search");
include(onboardingShared, "settings.onboarding.feature.favorite.title", "onboarding feature overview should still include favorites");
include(onboardingShared, "settings.onboarding.feature.trash.title", "onboarding feature overview should still include trash");
include(onboardingShared, "settings.onboarding.feature.agent.title", "onboarding feature overview should still include agent");

// App shell: top navigation and first-launch onboarding handoff.
match(topToolbar, /data-dev-probe="top-toolbar"[^>]*data-tauri-drag-region[^>]*onPointerDown=\{onDrag\}/, "top toolbar should remain the drag region");
match(topToolbar, /data-dev-probe="top-search-slot"[^>]*onPointerDown=\{\(event\) => event\.stopPropagation\(\)\}/, "search slot should block drag on pointer down");
match(topToolbar, /data-dev-probe="top-action-slot"[^>]*onPointerDown=\{\(event\) => event\.stopPropagation\(\)\}/, "action slot should block drag on pointer down");
match(panelShared, /target\.closest\("button, input, textarea, select, a, \[role='menuitem'\]"\)/, "interactive targets should stay exempt from window dragging");
include(topToolbar, 'activeView === "history"', "top nav should keep the history scope");
include(topToolbar, 'activeView === "favorites"', "top nav should keep the favorites scope");
include(topToolbar, 'onSelect={() => onViewChange("trash")}', "top nav menu should still switch to trash");
include(topToolbar, "onSelect={onOpenSettings}", "top nav menu should still open settings");
include(topToolbar, "<DropdownMenuShortcut className=\"mono\">T</DropdownMenuShortcut>", "top nav shortcut hint should keep T for trash");
include(topToolbar, "getShortcutModLabel()", "top nav shortcut hint should use platform modifier label");
match(panelKeyboard, /if \(!editable && !event\.ctrlKey && !event\.metaKey && !event\.altKey && key === "t"\)/, "T shortcut should still switch to trash");
match(panelKeyboard, /if \(\(event\.metaKey \|\| event\.ctrlKey\) && !event\.altKey && key === ","\)/, "Cmd/Ctrl+, shortcut should still open settings");
exclude(app, "main.dock.onboarding", "top nav menu should not expose an onboarding entry");
include(app, 'setActiveSurface("clipboard");', "top view changes should return to clipboard surface");

// Settings surface: section routing, re-open onboarding, save path, copy path, tooltip and diagnostics.
include(settingsModel, 'const SECTION_LEGACY_ALIASES: Record<string, { section: SettingsSectionId; tab: SettingsTabId }> = {', "settings legacy aliases should remain explicit");
include(settingsModel, 'onboarding: { section: "shortcut-language", tab: "onboarding" },', "settings should still deep-link onboarding");
include(settingsModel, 'onboarding: "settings.tab.onboarding"', "settings should keep the onboarding tab label");
include(shortcutSection, 'onboarding: (', "settings should still render onboarding inside shortcut-language tabs");
include(shortcutSection, "<OnboardingEntryCard", "settings should still mount the onboarding entry card");
include(settings, "<SettingsShell", "settings should still render the shell");
include(settingsShell, 'data-surface="settings"', "settings shell should expose the settings surface marker");
include(settings, 'recordNextFramePerf("settings.section"', "settings sidebar changes should stay observable");
include(settings, '<TooltipProvider delayDuration={300}>', "settings page should keep the shared tooltip provider");
include(settings, 'data-dev-probe={`settings-section-tab:${tab}`}', "settings section tabs should stay keyboard-native");
match(settings, /settingsService\s*\.\s*patch\s*\(/, "settings updates should keep the patch save path");
include(settings, 'saveFeedback: { state: "pending"', "settings save should publish pending feedback");
include(settings, 'state: "saved"', "settings save should publish saved feedback");
include(storageSection, 'state={logActionStatus.state}', "diagnostic actions should expose a status state");
include(storageSection, 'tooltip: tr("settings.diagnostics.exportBundle")', "diagnostics export should keep tooltip metadata");
include(storageSection, 'tooltip: tr("settings.diagnostics.cleanupTooltip")', "diagnostics cleanup should keep tooltip metadata");
include(storageSection, 'tooltip: tr("settings.diagnostics.refreshLogStats")', "diagnostics refresh should keep tooltip metadata");
include(storageSection, 'onClick: () => void exportDiagnosticsBundle()', "diagnostics export should remain wired");
include(storageSection, 'onClick: () => { if (dangerConfirmation === "cleanupLogs") { void cleanupLogsNow(); return; }', "cleanup confirmation should remain two-step");
include(storageSection, 'onClick: () => void refreshLogStats()', "diagnostics refresh should remain wired");
include(mcpAgentSection, 'tabs={mcpAgentCodeTabs.filter((tab) => tab.value === "install" || tab.value === "command")}', "MCP code tabs should still include install/command");
include(mcpAgentSection, 'tabs={mcpAgentCodeTabs.filter((tab) => tab.value === "tools" || tab.value === "json-rpc")}', "MCP code tabs should still include tools/json-rpc");
include(mcpAgentSection, 'tabs={mcpAgentCodeTabs.filter((tab) => tab.value === "provider")}', "MCP code tabs should still include provider");

// Settings controls and helpers: save behavior and keyboard/tooltip accessibility surfaces.
include(controls, "export function SegmentSetting", "segment setting control should remain available");
include(controls, "ToggleGroup", "segment setting should stay on ToggleGroup");
include(controls, "export function ToggleSetting", "toggle control should remain available");
include(controls, "export function SliderSetting", "slider control should remain available");
include(controls, "export function NumberSetting", "number control should remain available");
include(controls, "export function ReadonlyField", "readonly field should remain available");
include(controls, "TooltipTrigger asChild", "readonly field should keep tooltip affordances");
// SettingsCodeTabs 已重写为 shadcn Tabs 本地封装（不再依赖 animate-ui CodeTabs）；
// 断言只锁定真实不变量：本地封装、复制回调和运行时探针标记。
include(codeTabs, "<Tabs", "settings code tabs should stay on the local shadcn Tabs wrapper");
include(codeTabs, "onCopy(tab)", "settings code tabs should keep copy wiring");
include(codeTabs, 'data-dev-probe="settings-code-tabs"', "settings code tabs should keep the dev probe marker");
include(statusPanel, "SettingsStatusPanel", "status panel should remain the diagnostic wrapper");
include(statusPanel, "aria-label={title}", "status panel should stay accessible");
include(statusPanel, "tooltip ? (", "status panel actions should stay tooltip-aware");
include(animateTooltip, 'if (e.key === \'Escape\') hideImmediate();', "tooltips should still close on Escape");

if (!process.exitCode) {
  console.log("Settings surface verification passed");
}
