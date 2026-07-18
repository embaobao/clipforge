import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

const files = {
  app: "src/App.tsx",
  topToolbar: "src/clipboard/components/TopToolbar.tsx",
  appCss: "src/App.css",
  onboarding: "src/settings/onboarding-wizard.tsx",
  settings: "src/settings.tsx",
  controls: "src/settings/controls.tsx",
  sidebar: "src/settings/components/SettingsSidebar.tsx",
  codeTabs: "src/settings/components/SettingsCodeTabs.tsx",
  animateSidebar: "src/components/animate-ui/components/radix/sidebar.tsx",
  animateCodeTabs: "src/components/animate-ui/components/animate/code-tabs.tsx",
  statusPanel: "src/settings/components/SettingsStatusPanel.tsx",
  tooltip: "src/components/animate-ui/primitives/animate/tooltip.tsx",
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
const appCss = read(files.appCss);
const onboarding = read(files.onboarding);
const settings = read(files.settings);
const controls = read(files.controls);
const sidebar = read(files.sidebar);
const codeTabs = read(files.codeTabs);
const animateSidebar = read(files.animateSidebar);
const animateCodeTabs = read(files.animateCodeTabs);
const statusPanel = read(files.statusPanel);
const tooltip = read(files.tooltip);

// Onboarding surface: 只验证可重复的源代码语义，不碰真实系统权限或剪贴板回写。
include(
  onboarding,
  'type OnboardingStepKey = "welcome" | "accessibility" | "capture" | "shortcut" | "tour";',
  "onboarding wizard should expose the five-step flow",
);
assert(
  JSON.stringify(extractList(onboarding, "STEPS")) === JSON.stringify(["welcome", "accessibility", "capture", "shortcut", "tour"]),
  "onboarding wizard steps should stay ordered as welcome/accessibility/capture/shortcut/tour",
);
assert(
  JSON.stringify(extractList(onboarding, "CAPTURE_FIELDS")) ===
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
include(onboarding, "settings.onboarding.feature.search.title", "onboarding feature overview should still include search");
include(onboarding, "settings.onboarding.feature.favorite.title", "onboarding feature overview should still include favorites");
include(onboarding, "settings.onboarding.feature.trash.title", "onboarding feature overview should still include trash");
include(onboarding, "settings.onboarding.feature.agent.title", "onboarding feature overview should still include agent");

// App shell: top navigation and first-launch onboarding handoff.
match(topToolbar, /<header[^>]*className="top-toolbar"[^>]*data-tauri-drag-region[^>]*onPointerDown=\{onDrag\}/, "top toolbar should remain the drag region");
match(topToolbar, /<TabsList[^>]*className="top-view-actions"[^>]*onPointerDown=\{\(event\) => event\.stopPropagation\(\)\}/, "top view tabs should block drag on pointer down");
match(topToolbar, /<div[^>]*className="top-toolbar-search-slot"[^>]*onPointerDown=\{\(event\) => event\.stopPropagation\(\)\}/, "search slot should block drag on pointer down");
match(topToolbar, /<div[^>]*className="top-toolbar-action-slot"[^>]*onPointerDown=\{\(event\) => event\.stopPropagation\(\)\}/, "action slot should block drag on pointer down");
match(app, /target\.closest\("button, input, textarea, select, a, \[role='menuitem'\]"\)/, "interactive targets should stay exempt from window dragging");
include(topToolbar, 'value="history"', "top nav should keep the history tab");
include(topToolbar, 'value="favorites"', "top nav should keep the favorites tab");
include(topToolbar, 'onSelect={() => onViewChange("trash")}', "top nav menu should still switch to trash");
include(topToolbar, "onSelect={onOpenSettings}", "top nav menu should still open settings");
include(topToolbar, "<kbd>T</kbd>", "top nav shortcut hint should keep T for trash");
include(topToolbar, "<kbd>,</kbd>", "top nav shortcut hint should keep Cmd/Ctrl+, for settings");
match(app, /if \(!editable && !event\.ctrlKey && !event\.metaKey && !event\.altKey && key === "t"\)/, "T shortcut should still switch to trash");
match(app, /if \(\(event\.metaKey \|\| event\.ctrlKey\) && !event\.altKey && key === ","\)/, "Cmd/Ctrl+, shortcut should still open settings");
exclude(app, "main.dock.onboarding", "top nav menu should not expose an onboarding entry");
include(app, 'if (!merged.onboardingCompleted) {', "startup onboarding gate should still guard the first-run settings open");
include(app, 'invoke("open_settings_window_with_section", { section: "onboarding" })', "startup onboarding should still jump into the onboarding section");
include(app, 'setActiveSurface("clipboard");', "top view changes should return to clipboard surface");

// Settings surface: section routing, re-open onboarding, save path, copy path, tooltip and diagnostics.
include(settings, 'const SECTION_LEGACY_ALIASES: Record<string, { section: SettingsSectionId; tab: SettingsTabId }> = {', "settings legacy aliases should remain explicit");
include(settings, 'onboarding: { section: "shortcut-language", tab: "onboarding" },', "settings should still deep-link onboarding");
include(settings, 'onboarding: "settings.tab.onboarding"', "settings should keep the onboarding tab label");
include(settings, 'onboarding: (', "settings should still render onboarding inside shortcut-language tabs");
include(settings, "<OnboardingWizard", "settings should still mount the onboarding wizard");
include(settings, '<SettingsSidebar', "settings should still render the sidebar");
include(settings, 'collapsible="icon"', "settings sidebar should use component-library icon collapse mode");
include(settings, '<SidebarTrigger', "settings content should expose the component-library sidebar trigger");
include(settings, 'className="flex h-[calc(100dvh-56px)] min-h-0 w-full overflow-hidden bg-slate-50"', "settings shell should use Tailwind layout classes");
include(settings, 'className="grid w-full max-w-[820px] content-start gap-3"', "settings tabs should use Tailwind layout classes");
include(settings, 'aria-label={tr("settings.navigation.toggle")}', "settings sidebar trigger should use localized aria text");
include(settings, 'recordNextFramePerf("settings.section"', "settings sidebar changes should stay observable");
include(settings, '<TooltipProvider closeDelay={120} openDelay={300}>', "settings page should keep the shared tooltip provider");
include(settings, 'data-dev-probe={`settings-section-tab:${tab}`}', "settings section tabs should stay keyboard-native");
include(settings, 'className="h-7 rounded-md border-0 bg-transparent px-3 text-xs font-semibold shadow-none data-[state=active]:text-slate-950"', "settings section tabs should use Tailwind trigger classes");
match(settings, /settingsService\s*\.\s*patch\s*\(/, "settings updates should keep the patch save path");
include(settings, 'saveFeedback: { state: "pending"', "settings save should publish pending feedback");
include(settings, 'state: "saved"', "settings save should publish saved feedback");
include(settings, 'state={logActionStatus.state}', "diagnostic actions should expose a status state");
include(settings, 'tooltip: tr("settings.diagnostics.exportBundle")', "diagnostics export should keep tooltip metadata");
include(settings, 'tooltip: tr("settings.diagnostics.cleanupTooltip")', "diagnostics cleanup should keep tooltip metadata");
include(settings, 'tooltip: tr("settings.diagnostics.refreshLogStats")', "diagnostics refresh should keep tooltip metadata");
include(settings, 'onClick: () => void exportDiagnosticsBundle()', "diagnostics export should remain wired");
include(settings, 'onClick: () => { if (dangerConfirmation === "cleanupLogs") { void cleanupLogsNow(); return; }', "cleanup confirmation should remain two-step");
include(settings, 'onClick: () => void refreshLogStats()', "diagnostics refresh should remain wired");
include(settings, 'tabs={mcpAgentCodeTabs.filter((tab) => tab.value === "install" || tab.value === "command")}', "MCP code tabs should still include install/command");
include(settings, 'tabs={mcpAgentCodeTabs.filter((tab) => tab.value === "tools" || tab.value === "json-rpc")}', "MCP code tabs should still include tools/json-rpc");
include(settings, 'tabs={mcpAgentCodeTabs.filter((tab) => tab.value === "provider")}', "MCP code tabs should still include provider");

// Settings controls and helpers: save behavior and keyboard/tooltip accessibility surfaces.
include(controls, "export function SegmentSetting", "segment setting control should remain available");
include(controls, "ToggleGroup", "segment setting should stay on ToggleGroup");
include(controls, "export function ToggleSetting", "toggle control should remain available");
include(controls, "export function SliderSetting", "slider control should remain available");
include(controls, "export function NumberSetting", "number control should remain available");
include(controls, "export function ReadonlyField", "readonly field should remain available");
include(controls, "TooltipTrigger asChild", "readonly field should keep tooltip affordances");
include(sidebar, "<SidebarMenuButton", "settings sidebar should stay button-based through SidebarMenuButton");
include(sidebar, "isActive={active}", "settings sidebar should keep active page state");
include(sidebar, "tooltip={item.label}", "settings sidebar should use component-library collapsed tooltip");
include(sidebar, 'className="h-8 rounded-md border-0 bg-transparent px-2 text-[13px] font-medium text-muted-foreground shadow-none data-[active=true]:bg-accent data-[active=true]:text-accent-foreground data-[active=true]:shadow-sm"', "settings sidebar items should use Tailwind classes");
include(sidebar, "<SidebarMenuBadge", "settings sidebar badges should use component-library badge");
include(animateSidebar, "<button", "Animate UI sidebar should render keyboard-native buttons");
include(animateSidebar, "function SidebarTrigger", "Animate UI sidebar should expose SidebarTrigger");
include(animateSidebar, "function SidebarRail", "Animate UI sidebar should expose SidebarRail");
include(animateSidebar, "tooltip?: string | React.ComponentProps<typeof TooltipContent>", "Animate UI sidebar menu button should expose tooltip");
include(animateSidebar, "const SIDEBAR_KEYBOARD_SHORTCUT = 'b';", "Animate UI sidebar should keep its keyboard shortcut");
include(codeTabs, "<CodeTabs", "settings code tabs should stay on the local CodeTabs component");
include(animateCodeTabs, 'onClick={() => onCopy(tab)}', "settings code tabs should keep copy wiring");
include(animateCodeTabs, "TooltipTrigger asChild", "settings code tabs should keep tooltip affordances");
include(statusPanel, "SettingsStatusPanel", "status panel should remain the diagnostic wrapper");
include(statusPanel, "aria-label={title}", "status panel should stay accessible");
include(statusPanel, 'className={`settings-status-panel ${state}`}', "status panel should expose state styling");
include(statusPanel, "tooltip ? (", "status panel actions should stay tooltip-aware");
include(tooltip, 'if (e.key === \'Escape\') hideImmediate();', "tooltips should still close on Escape");

if (!process.exitCode) {
  console.log("Settings surface verification passed");
}
