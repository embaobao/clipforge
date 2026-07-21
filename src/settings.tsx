import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { settingsService } from "./services/settings";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  ExternalLink,
  Eye,
  FileDown,
  FileCode,
  FileImage,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Settings,
  Tag,
  Terminal,
  Trash2,
  UploadCloud,
  type LucideIcon,
} from "lucide-react";
import { getFrontendEnvironmentSnapshot } from "./frontend-diagnostics";
import { recordNextFramePerf } from "./performance-smoke";
import {
  formatCommandError,
  normalizeLanguagePreference,
  resolveAppLocale,
  setDocumentLocale,
  t,
  type AppLanguagePreference,
  type TranslationKey,
} from "./i18n";
import {
  SettingGroup,
  SegmentSetting,
  NumberSetting,
  SliderSetting,
  ToggleSetting,
  CheckItem,
  ReadonlyField,
} from "./settings/controls";
import { OnboardingWizard } from "./settings/onboarding-wizard";
import { SettingsSidebar } from "./settings/components/SettingsSidebar";
import { SettingsSectionHeader } from "./settings/components/SettingsSectionHeader";
import { SettingsStickyStatusBar } from "./settings/components/SettingsStickyStatusBar";
import { SettingsCodeTabs, type SettingsCodeTab } from "./settings/components/SettingsCodeTabs";
import { SettingsStatusPanel, type SettingsStatusPanelState } from "./settings/components/SettingsStatusPanel";
import { SettingsFieldRow } from "./settings/components/SettingsFieldRow";
import {
  SETTINGS_INFORMATION_ARCHITECTURE,
  type SettingsSectionId,
  type SettingsTabId,
} from "./settings/settings-field-catalog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/animate-ui/primitives/radix/tooltip";
import {
  Tabs,
  TabsContent,
  TabsContents,
  TabsList,
  TabsTrigger,
} from "@/components/animate-ui/components/radix/tabs";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/animate-ui/components/radix/sidebar";

interface AppSettings {
  language: AppLanguagePreference;
  globalShortcut: string;
  panelDensity: "dense" | "normal" | "comfortable";
  contentDisplayMode: "summary" | "middle" | "raw";
  quickItemLimit: number;
  maxStoredItems: number;
  clipboardPollMs: number;
  cleanupEnabled: boolean;
  cleanupIntervalHours: number;
  softDeletedRetentionDays: number;
  enableMarkdownPreview: boolean;
  fuzzySearchEnabled: boolean;
  pinyinSearchEnabled: boolean;
  tagMode: "similar" | "rules" | "off";
  tagRules: Array<{ id: string; label: string; query: string }>;
  positionStrategy: "trayCenter" | "followCursor" | "center" | "windowCenter" | "lastPosition" | "focusInput";
  panelBackgroundOpacity: number;
  enableScrollCollapse: boolean;
  panelWidth: number;
  panelHeight: number;
  onboardingCompleted: boolean;
  logMaxSizeMb: number;
  logKeepRatio: number;
  logMaxLines: number;
  logRetentionDays: number;
  logAutoCleanup: boolean;
  logCleanupIntervalMin: number;
  captureTextEnabled: boolean;
  captureHtmlEnabled: boolean;
  captureRtfEnabled: boolean;
  captureImageEnabled: boolean;
  captureFileEnabled: boolean;
  captureSensitiveEnabled: boolean;
  imageMaxSizeMb: number;
  textMaxSizeMb: number;
  agentProviders?: Array<Record<string, unknown>>;
  agent?: {
    providers?: Array<Record<string, unknown>>;
  };
}

interface AccessibilityPermissionPayload {
  canReadFocusedInput: boolean;
  status: "granted" | "missing" | "denied" | "unsupported";
  message: string;
}

interface TccAccessibilityRecordPayload {
  database: string;
  client: string;
  clientType: number;
  authValue: number;
  authLabel: string;
  csreqSummary: string;
  lastModified: string;
}

interface AccessibilityDiagnosticsPayload {
  trusted: boolean;
  expectedBundleIdentifier: string;
  executablePath: string;
  appBundlePath: string;
  codeSignatureIdentifier: string;
  signatureKind: string;
  teamIdentifier: string;
  cdHash: string;
  designatedRequirement: string;
  tccRecords: TccAccessibilityRecordPayload[];
  tccQueryError?: string | null;
  message: string;
}

interface PanelTriggerPayload {
  visible: boolean;
  focused: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  source: string;
  positionSource: string;
  focusedInputSource: string;
  usedFocusedInput: boolean;
  accessibilityStatus: string;
  message: string;
}

interface McpStatusPayload {
  enabled: boolean;
  running: boolean;
  transport: string;
  command: string;
  tools: string[];
  message: string;
}

interface UpdateCheckState {
  status: "idle" | "checking" | "available" | "latest" | "downloading" | "ready" | "failed";
  currentVersion: string;
  availableVersion?: string;
  channel: "stable" | "prerelease";
  lastCheckedAt?: number;
  ignoredVersion?: string;
  releaseNotes?: string;
  downloadProgress?: number;
  errorCode?: string;
  errorMessage?: string;
}

interface BuildInfoPayload {
  productName: string;
  currentVersion: string;
  bundleIdentifier: string;
  targetOs: string;
  targetArch: string;
  updaterEndpoint: string;
}

async function safeInvokeUpdateCheck(): Promise<UpdateCheckState> {
  try {
    return await invoke<UpdateCheckState>("check_update");
  } catch (error) {
    return {
      status: "failed",
      currentVersion: "0.1.0",
      channel: "stable",
      lastCheckedAt: Date.now(),
      errorCode: "UPDATE_CHECK_FAILED",
      errorMessage: String(error),
    };
  }
}

const DEFAULT_SHORTCUT = "Control+V";

interface SettingsAppState {
  accessibility: AccessibilityPermissionPayload | null;
  accessibilityDiagnostics: AccessibilityDiagnosticsPayload | null;
  configPath: string;
  configStatus: string;
  databasePath: string;
  mcp: McpStatusPayload | null;
  panel: PanelTriggerPayload | null;
  settings: AppSettings;
  saveFeedback: SettingsSaveFeedback;
  status: string;
  logStats: LogStatsPayload | null;
  update: UpdateCheckState | null;
  buildInfo: BuildInfoPayload | null;
}

interface SettingsSaveFeedback {
  state: "idle" | "pending" | "saved" | "error";
  message: string;
  requestId: number;
}

interface LogStatsPayload {
  path: string;
  sizeBytes: number;
  lineCount: number;
  oldestTsMs: number;
  maxSizeMb: number;
  keepRatio: number;
  retentionDays: number;
  autoCleanup: boolean;
  intervalMin: number;
}

interface DiagnosticsExportPayload {
  path: string;
  createdAt: number;
  logCount: number;
  summary: string;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

const DEFAULT_SETTINGS: AppSettings = {
  language: "system",
  globalShortcut: DEFAULT_SHORTCUT,
  panelDensity: "normal",
  contentDisplayMode: "summary",
  quickItemLimit: 12,
  maxStoredItems: 500,
  clipboardPollMs: 200,
  cleanupEnabled: true,
  cleanupIntervalHours: 24,
  softDeletedRetentionDays: 30,
  enableMarkdownPreview: true,
  fuzzySearchEnabled: true,
  pinyinSearchEnabled: true,
  tagMode: "rules",
  tagRules: [
    { id: "r1", label: "GitHub", query: "github.com gh repo pull request" },
    { id: "r2", label: "GitLab", query: "gitlab.com merge request" },
    { id: "r3", label: "命令", query: "pnpm npm npx cargo git tauri brew" },
    { id: "r4", label: "文档", query: "readme openspec markdown docs md" },
  ],
  positionStrategy: "followCursor",
  panelBackgroundOpacity: 0.72,
  enableScrollCollapse: true,
  panelWidth: 420,
  panelHeight: 400,
  onboardingCompleted: false,
  logMaxSizeMb: 10,
  logKeepRatio: 0.6,
  logMaxLines: 20000,
  logRetentionDays: 0,
  logAutoCleanup: true,
  logCleanupIntervalMin: 10,
  captureTextEnabled: true,
  captureHtmlEnabled: true,
  captureRtfEnabled: true,
  captureImageEnabled: true,
  captureFileEnabled: true,
  captureSensitiveEnabled: false,
  imageMaxSizeMb: 25,
  textMaxSizeMb: 5,
};

function normalizeAppSettings(settings: Partial<AppSettings> | Record<string, unknown>): AppSettings {
  const partial = settings as Partial<AppSettings>;
  return {
    ...DEFAULT_SETTINGS,
    ...partial,
    language: normalizeLanguagePreference(partial.language),
  };
}

const SECTION_ICON_BY_ID: Record<SettingsSectionId, LucideIcon> = {
  "shortcut-language": Terminal,
  "display-panel": Eye,
  "capture-content": FileImage,
  "storage-logs": Database,
  "mcp-agent": Terminal,
  "update-distribution": UploadCloud,
  "tag-rules": Tag,
};

const SECTION_LEGACY_ALIASES: Record<string, { section: SettingsSectionId; tab: SettingsTabId }> = {
  shortcut: { section: "shortcut-language", tab: "shortcut" },
  onboarding: { section: "shortcut-language", tab: "onboarding" },
  display: { section: "display-panel", tab: "density" },
  content: { section: "capture-content", tab: "search" },
  capture: { section: "capture-content", tab: "capture-types" },
  storage: { section: "storage-logs", tab: "data" },
  integration: { section: "mcp-agent", tab: "status" },
  manual: { section: "mcp-agent", tab: "install" },
  update: { section: "update-distribution", tab: "version" },
  tags: { section: "tag-rules", tab: "tag-mode" },
};

const DEFAULT_SECTION_TABS: Record<SettingsSectionId, SettingsTabId> = {
  "shortcut-language": "shortcut",
  "display-panel": "density",
  "capture-content": "search",
  "storage-logs": "data",
  "mcp-agent": "status",
  "update-distribution": "version",
  "tag-rules": "tag-mode",
};

const SECTIONS = SETTINGS_INFORMATION_ARCHITECTURE.map((item) => ({
  ...item,
  key: item.id,
  icon: SECTION_ICON_BY_ID[item.id],
}));

type SectionKey = SettingsSectionId;

const SETTINGS_TAB_LABEL_KEYS: Record<SettingsTabId, TranslationKey> = {
  onboarding: "settings.tab.onboarding",
  shortcut: "settings.tab.shortcut",
  language: "settings.tab.language",
  permissions: "settings.tab.permissions",
  density: "settings.tab.density",
  size: "settings.tab.size",
  position: "settings.tab.position",
  test: "settings.tab.test",
  search: "settings.tab.search",
  preview: "settings.tab.preview",
  "capture-types": "settings.tab.captureTypes",
  limits: "settings.tab.limits",
  data: "settings.tab.data",
  cleanup: "settings.tab.cleanup",
  logs: "settings.tab.logs",
  diagnostics: "settings.tab.diagnostics",
  status: "settings.tab.status",
  install: "settings.tab.install",
  "json-rpc": "settings.tab.jsonRpc",
  provider: "settings.tab.provider",
  version: "settings.tab.version",
  "update-flow": "settings.tab.updateFlow",
  build: "settings.tab.build",
  "tag-mode": "settings.tab.tagMode",
  rules: "settings.tab.rules",
};

function hasSettingsTab(tabs: readonly SettingsTabId[], requestedTab: string | null): requestedTab is SettingsTabId {
  return Boolean(requestedTab && tabs.some((tab) => tab === requestedTab));
}

function getInitialNavigationFromUrl(): { section: SectionKey; tab: SettingsTabId } {
  const params = new URLSearchParams(window.location.search);
  const requested = params.get("section") ?? params.get("tab");
  const requestedTab = params.get("tab");
  const directSection = SECTIONS.find((item) => item.key === requested);
  if (directSection) {
    const directTabs = [...directSection.tabs] as SettingsTabId[];
    const tab = hasSettingsTab(directTabs, requestedTab)
      ? requestedTab
      : DEFAULT_SECTION_TABS[directSection.key];
    return { section: directSection.key, tab };
  }
  if (requested && SECTION_LEGACY_ALIASES[requested]) return SECTION_LEGACY_ALIASES[requested];
  return { section: "shortcut-language", tab: "shortcut" };
}

export function SettingsApp() {
  const manualShortcutId = useId();
  const initialNavigation = useRef(getInitialNavigationFromUrl());
  const [section, setSection] = useState<SectionKey>(() => initialNavigation.current.section);
  const [recording, setRecording] = useState(false);
  const [dangerConfirmation, setDangerConfirmation] = useState<"cleanupLogs" | "resetAccessibility" | null>(null);
  const [logActionStatus, setLogActionStatus] = useState<{ message: string; state: SettingsStatusPanelState }>({
    message: "",
    state: "neutral",
  });
  const saveRequestSeq = useRef(0);
  const [state, setState] = useState<SettingsAppState>({
    accessibility: null,
    accessibilityDiagnostics: null,
    configPath: "",
    configStatus: t(resolveAppLocale(DEFAULT_SETTINGS.language), "settings.status.loading"),
    databasePath: "",
    mcp: null,
    panel: null,
    settings: DEFAULT_SETTINGS,
    saveFeedback: { state: "idle", message: "", requestId: 0 },
    status: "",
    logStats: null,
    update: null,
    buildInfo: null,
  });
  const locale = resolveAppLocale(state.settings.language);
  const tr = (key: Parameters<typeof t>[1], params?: Record<string, string | number>) => t(locale, key, params);
  const formatSettingsError = (error: unknown) => formatCommandError(tr, error);

  useEffect(() => {
    void (async () => {
      try {
        const [settingsDocument, configPath, databasePath, accessibility, accessibilityDiagnostics, panel, mcp, logStats, buildInfo] = await Promise.all([
          settingsService.get(true),
          invoke<string>("get_clipforge_config_path"),
          invoke<string>("get_clipforge_database_path"),
          invoke<AccessibilityPermissionPayload>("check_accessibility_permission"),
          invoke<AccessibilityDiagnosticsPayload>("get_accessibility_diagnostics"),
          invoke<PanelTriggerPayload>("get_panel_trigger_status"),
          invoke<McpStatusPayload>("get_mcp_status"),
          invoke<LogStatsPayload>("get_log_stats"),
          invoke<BuildInfoPayload>("get_build_info"),
        ]);
        lastSettingsRevision.current = settingsDocument.revision;
        const mergedSettings = normalizeAppSettings(settingsDocument.settings);
        const locale = resolveAppLocale(mergedSettings.language);
        setDocumentLocale(locale);
        window.document.title = t(locale, "window.settings.title");
        void getCurrentWindow().setTitle(t(locale, "window.settings.title"));
        setState({
          accessibility,
          accessibilityDiagnostics,
          configPath,
          configStatus: t(locale, "settings.status.configSynced"),
          databasePath,
          mcp,
          panel,
          settings: mergedSettings,
          saveFeedback: { state: "idle", message: "", requestId: 0 },
          logStats,
          update: null,
          buildInfo,
          status: "",
        });
        void safeInvokeUpdateCheck().then((update) => {
          setState((prev) => ({ ...prev, update }));
        });
      } catch (error) {
        const fallbackLocale = resolveAppLocale(DEFAULT_SETTINGS.language);
        setDocumentLocale(fallbackLocale);
        window.document.title = t(fallbackLocale, "window.settings.title");
        setState((prev) => ({
          ...prev,
          configStatus: t(fallbackLocale, "settings.status.configFallback"),
          status: formatSettingsError(error),
        }));
      }
    })();
  }, []);

  // B5：订阅 settings_changed，跨窗口/跨进程设置变更时轻量重读 settings（revision 去重）。
  // 不重跑 accessibility/mcp/logStats/update 等无关加载；自身写入触发的同 revision 事件会被去重跳过。
  const lastSettingsRevision = useRef<string | null>(null);
  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | null = null;
    settingsService
      .subscribe((event) => {
        if (!active) return;
        if (lastSettingsRevision.current === event.revision) return;
        recordNextFramePerf("settings.changed", { changedPaths: event.changedPaths.length });
        lastSettingsRevision.current = event.revision;
        settingsService
          .get(false)
          .then((document) => {
            if (!active) return;
            lastSettingsRevision.current = document.revision;
            const nextSettings = normalizeAppSettings(document.settings);
            const locale = resolveAppLocale(nextSettings.language);
            setDocumentLocale(locale);
            window.document.title = t(locale, "window.settings.title");
            void getCurrentWindow().setTitle(t(locale, "window.settings.title"));
            setState((prev) => ({
              ...prev,
              configStatus: t(locale, "settings.status.configSynced"),
              settings: nextSettings,
            }));
          })
          .catch(() => {
            /* 单次刷新失败不打断设置页主流程，下次事件再试 */
          });
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  function updateSettings(next: Partial<AppSettings>) {
    const normalizedNext = {
      ...next,
      ...(next.language ? { language: normalizeLanguagePreference(next.language) } : {}),
    };
    const requestId = saveRequestSeq.current + 1;
    saveRequestSeq.current = requestId;
    const feedbackLocale = normalizedNext.language ? resolveAppLocale(normalizedNext.language) : locale;
    if (normalizedNext.language) {
      setDocumentLocale(feedbackLocale);
      window.document.title = t(feedbackLocale, "window.settings.title");
      void getCurrentWindow().setTitle(t(feedbackLocale, "window.settings.title"));
    }
    setState((prev) => ({
      ...prev,
      settings: { ...prev.settings, ...normalizedNext },
      configStatus: t(feedbackLocale, "settings.status.configSynced"),
      saveFeedback: {
        state: "pending",
        message: t(feedbackLocale, "settings.save.pending"),
        requestId,
      },
    }));
    settingsService
      .patch({
        patch: normalizedNext as Record<string, unknown>,
        actor: "settings-window",
        reason: "settings-page-update",
      })
      .then((result) => {
        if (saveRequestSeq.current !== requestId) return;
        lastSettingsRevision.current = result.revision;
        const durationMs = Math.max(0, Math.round(result.durationMs ?? 0));
        setState((prev) => ({
          ...prev,
          settings: normalizeAppSettings(result.settings),
          configStatus: t(feedbackLocale, "settings.status.configSynced"),
          saveFeedback: {
            state: "saved",
            message: t(feedbackLocale, "settings.save.saved", { durationMs }),
            requestId,
          },
        }));
      })
      .catch((error) => {
        if (saveRequestSeq.current !== requestId) return;
        const message = formatSettingsError(error);
        setState((prev) => ({
          ...prev,
          saveFeedback: {
            state: "error",
            message,
            requestId,
          },
          status: message,
        }));
      });
  }

  async function refreshLogStats() {
    setDangerConfirmation(null);
    try {
      const stats = await invoke<LogStatsPayload>("get_log_stats");
      setState((prev) => ({ ...prev, logStats: stats }));
      setLogActionStatus({ message: tr("settings.diagnostics.logStatsRefreshed"), state: "good" });
    } catch (error) {
      const message = formatSettingsError(error);
      setLogActionStatus({ message, state: "danger" });
      setState((prev) => ({ ...prev, status: message }));
    }
  }

  async function cleanupLogsNow() {
    setDangerConfirmation(null);
    setLogActionStatus({ message: tr("settings.diagnostics.cleaning"), state: "pending" });
    setState((prev) => ({ ...prev, status: tr("settings.diagnostics.cleaning") }));
    try {
      const result = await invoke<string>("cleanup_app_logs");
      await refreshLogStats();
      setLogActionStatus({ message: result, state: "good" });
      setState((prev) => ({ ...prev, status: result }));
    } catch (error) {
      const message = formatSettingsError(error);
      setLogActionStatus({ message, state: "danger" });
      setState((prev) => ({ ...prev, status: message }));
    }
  }

  async function exportDiagnosticsBundle() {
    setDangerConfirmation(null);
    setLogActionStatus({ message: tr("settings.diagnostics.exporting"), state: "pending" });
    setState((prev) => ({ ...prev, status: tr("settings.diagnostics.exporting") }));
    try {
      const result = await invoke<DiagnosticsExportPayload>("export_diagnostics_bundle", {
        frontend: getFrontendEnvironmentSnapshot(),
      });
      await refreshLogStats();
      const message = tr("settings.diagnostics.exportedPath", { summary: result.summary, path: result.path });
      setLogActionStatus({ message, state: "good" });
      setState((prev) => ({
        ...prev,
        status: message,
      }));
    } catch (error) {
      const message = formatSettingsError(error);
      setLogActionStatus({ message, state: "danger" });
      setState((prev) => ({ ...prev, status: message }));
    }
  }

  function addTagRule() {
    const newRule = { id: `r-${Date.now()}`, label: tr("settings.tags.newRule"), query: "" };
    const next = [...state.settings.tagRules, newRule];
    updateSettings({ tagRules: next });
  }

  function updateTagRule(id: string, patch: Partial<{ label: string; query: string }>) {
    const next = state.settings.tagRules.map((rule) =>
      rule.id === id ? { ...rule, ...patch } : rule,
    );
    updateSettings({ tagRules: next });
  }

  function deleteTagRule(id: string) {
    const next = state.settings.tagRules.filter((rule) => rule.id !== id);
    updateSettings({ tagRules: next });
  }

  async function refreshAccessibilityStatus() {
    setDangerConfirmation(null);
    try {
      const [accessibility, accessibilityDiagnostics] = await Promise.all([
        invoke<AccessibilityPermissionPayload>("check_accessibility_permission"),
        invoke<AccessibilityDiagnosticsPayload>("get_accessibility_diagnostics"),
      ]);
      setState((prev) => ({
        ...prev,
        accessibility,
        accessibilityDiagnostics,
        status: accessibilityDiagnostics.message,
      }));
    } catch (error) {
      setState((prev) => ({ ...prev, status: formatSettingsError(error) }));
    }
  }

  async function openAccessibilitySettings() {
    setDangerConfirmation(null);
    try {
      const accessibility = await invoke<AccessibilityPermissionPayload>("request_accessibility_permission");
      const accessibilityDiagnostics = await invoke<AccessibilityDiagnosticsPayload>("get_accessibility_diagnostics");
      setState((prev) => ({
        ...prev,
        accessibility,
        accessibilityDiagnostics,
        status: accessibilityDiagnostics.message,
      }));
    } catch (error) {
      setState((prev) => ({ ...prev, status: formatSettingsError(error) }));
    }
  }

  async function resetAccessibilityPermission() {
    setDangerConfirmation(null);
    try {
      const accessibility = await invoke<AccessibilityPermissionPayload>("reset_accessibility_permission");
      const accessibilityDiagnostics = await invoke<AccessibilityDiagnosticsPayload>("get_accessibility_diagnostics");
      setState((prev) => ({
        ...prev,
        accessibility,
        accessibilityDiagnostics,
        status: tr("settings.accessibility.status.reset"),
      }));
    } catch (error) {
      setState((prev) => ({ ...prev, status: formatSettingsError(error) }));
    }
  }

  async function refreshPanelStatus() {
    try {
      const panel = await invoke<PanelTriggerPayload>("get_panel_trigger_status");
      setState((prev) => ({ ...prev, panel, status: panel.message }));
    } catch (error) {
      setState((prev) => ({ ...prev, status: formatSettingsError(error) }));
    }
  }

  async function testFloatingPanel() {
    try {
      const panel = await invoke<PanelTriggerPayload>("show_quick_panel_command", { source: "settings-test" });
      setState((prev) => ({ ...prev, panel, status: tr("settings.integration.floating.status", { positionSource: panel.positionSource }) }));
    } catch (error) {
      setState((prev) => ({ ...prev, status: formatSettingsError(error) }));
    }
  }

  function getMcpCommand() {
    return state.mcp?.command || "/Applications/ClipForge.app/Contents/MacOS/clipforge --mcp";
  }

  function getConfiguredAgentProviderCount() {
    return (state.settings.agent?.providers ?? state.settings.agentProviders ?? []).length;
  }

  function getAgentProviderTemplateText() {
    return JSON.stringify(
      {
        agent: {
          providers: [
            {
              id: "openai-main",
              name: "OpenAI compatible",
              kind: "openai-compatible",
              enabled: true,
              baseUrl: "https://api.openai.com/v1",
              modelId: "gpt-4.1-mini",
              apiKeyEnv: "OPENAI_API_KEY",
              timeoutSeconds: 120,
            },
            {
              id: "local-codex",
              name: "Codex CLI",
              kind: "local-cli",
              enabled: false,
              command: "codex",
              args: [],
            },
          ],
        },
      },
      null,
      2,
    );
  }

  function getAgentInstallPrompt() {
    return [
      tr("settings.manual.installPrompt.line1"),
      tr("settings.manual.installPrompt.line2"),
      getMcpCommand(),
      tr("settings.manual.installPrompt.line3"),
    ].join("\n");
  }

  async function copySettingsSnippet(label: string, content: string) {
    try {
      await navigator.clipboard.writeText(content);
      setState((prev) => ({ ...prev, status: tr("settings.status.copied", { label }) }));
    } catch (error) {
      setState((prev) => ({ ...prev, status: formatSettingsError(error) }));
    }
  }

  async function copyAgentProviderTemplate() {
    try {
      await navigator.clipboard.writeText(getAgentProviderTemplateText());
      setState((prev) => ({ ...prev, status: tr("settings.agent.providerTemplateCopied") }));
    } catch (error) {
      setState((prev) => ({ ...prev, status: formatSettingsError(error) }));
    }
  }

  async function copyMcpCommand(source: string) {
    const command = getAgentInstallPrompt();
    try {
      await navigator.clipboard.writeText(command);
      setState((prev) => ({ ...prev, status: tr("settings.manual.installPromptCopied", { source }) }));
    } catch (error) {
      setState((prev) => ({ ...prev, status: formatSettingsError(error) }));
    }
  }

  async function refreshMcpStatus() {
    try {
      const mcp = await invoke<McpStatusPayload>("get_mcp_status");
      setState((prev) => ({ ...prev, mcp, status: mcp.message }));
    } catch (error) {
      setState((prev) => ({ ...prev, status: formatSettingsError(error) }));
    }
  }

  async function checkUpdateNow() {
    setState((prev) => ({
      ...prev,
      update: prev.update ? { ...prev.update, status: "checking" } : prev.update,
      status: tr("settings.update.status.checking"),
    }));
    try {
      const update = await invoke<UpdateCheckState>("check_update");
      setState((prev) => ({ ...prev, update, status: update.errorMessage || tr("settings.update.status.refreshed") }));
    } catch (error) {
      setState((prev) => ({ ...prev, status: formatSettingsError(error) }));
    }
  }

  async function downloadUpdateNow() {
    setState((prev) => ({
      ...prev,
      update: prev.update ? { ...prev.update, status: "downloading", downloadProgress: 0 } : prev.update,
      status: tr("settings.update.status.downloading"),
    }));
    try {
      const update = await invoke<UpdateCheckState>("download_update");
      setState((prev) => ({ ...prev, update, status: update.errorMessage || tr("settings.update.status.ready") }));
    } catch (error) {
      setState((prev) => ({ ...prev, status: formatSettingsError(error) }));
    }
  }

  async function installUpdateNow() {
    try {
      const update = await invoke<UpdateCheckState>("install_update");
      setState((prev) => ({ ...prev, update, status: update.errorMessage || tr("settings.update.status.installing") }));
    } catch (error) {
      setState((prev) => ({ ...prev, status: formatSettingsError(error) }));
    }
  }

  async function ignoreCurrentUpdate() {
    const version = state.update?.availableVersion;
    if (!version) return;
    try {
      const update = await invoke<UpdateCheckState>("ignore_update_version", { version });
      setState((prev) => ({ ...prev, update, status: tr("settings.update.status.ignored", { version }) }));
    } catch (error) {
      setState((prev) => ({ ...prev, status: formatSettingsError(error) }));
    }
  }

  const updateStatusCopy =
    state.update?.status === "latest"
      ? tr("settings.update.status.latest")
      : state.update?.status === "available"
        ? tr("settings.update.status.available", { version: state.update.availableVersion ?? "" })
        : state.update?.status === "checking"
          ? tr("settings.update.status.checking")
          : state.update?.status === "downloading"
            ? tr("settings.update.status.downloading")
            : state.update?.status === "ready"
              ? tr("settings.update.status.ready")
              : state.update?.errorMessage || tr("settings.update.status.idle");
  const densityCopy: Record<AppSettings["panelDensity"], string> = {
    dense: tr("settings.display.density.dense"),
    normal: tr("settings.display.density.normal"),
    comfortable: tr("settings.display.density.comfortable"),
  };
  const displayModeCopy: Record<AppSettings["contentDisplayMode"], string> = {
    summary: tr("settings.display.contentMode.summary"),
    middle: tr("settings.display.contentMode.middle"),
    raw: tr("settings.display.contentMode.raw"),
  };
  const positionStrategyCopy: Record<AppSettings["positionStrategy"], string> = {
    trayCenter: tr("settings.display.positionStrategy.trayCenter"),
    followCursor: tr("settings.display.positionStrategy.followCursor"),
    center: tr("settings.display.positionStrategy.center"),
    windowCenter: tr("settings.display.positionStrategy.windowCenter"),
    lastPosition: tr("settings.display.positionStrategy.lastPosition"),
    focusInput: tr("settings.display.positionStrategy.focusInput"),
  };
  const tagModeLabels: Record<AppSettings["tagMode"], string> = {
    similar: tr("settings.tags.mode.similar"),
    rules: tr("settings.tags.mode.rules"),
    off: tr("settings.tags.mode.off"),
  };
  const mcpCommand = getMcpCommand();
  const agentInstallPrompt = getAgentInstallPrompt();
  const jsonRpcExample =
    '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"clipf.copy","arguments":{"id":"clip_xxx","client":"agent","requestId":"req_001"}}}';
  const toolExamples = [
    "use clipf.list limit=9",
    "use clipf.get id=clip_xxx",
    "use clipf.copy id=clip_xxx",
    'use clipf.search text="github" limit=20',
    'use clipf.analyze content="https://github.com/embaobao/clipforge"',
  ].join("\n");
  const mcpAgentCodeTabs: SettingsCodeTab[] = [
    { value: "install", label: tr("settings.mcp.agentInstallPrompt"), language: "text", content: agentInstallPrompt },
    { value: "command", label: tr("settings.mcp.command"), language: "bash", content: mcpCommand },
    { value: "tools", label: tr("settings.mcp.toolExamples"), language: "text", content: toolExamples },
    { value: "json-rpc", label: tr("settings.mcp.jsonRpc"), language: "json", content: jsonRpcExample },
    { value: "provider", label: tr("settings.agent.providerTemplate"), language: "json", content: getAgentProviderTemplateText() },
  ];
  function copyMcpAgentCodeTab(tab: SettingsCodeTab) {
    if (tab.value === "install") {
      void copyMcpCommand(tab.label);
      return;
    }
    if (tab.value === "provider") {
      void copyAgentProviderTemplate();
      return;
    }
    void copySettingsSnippet(tab.label, tab.content);
  }
  const saveFeedbackIcon =
    state.saveFeedback.state === "pending" ? (
      <Loader2 className="settings-save-feedback-icon spinning" size={14} />
    ) : state.saveFeedback.state === "saved" ? (
      <CheckCircle2 className="settings-save-feedback-icon" size={14} />
    ) : state.saveFeedback.state === "error" ? (
      <AlertTriangle className="settings-save-feedback-icon" size={14} />
    ) : null;
  const activeSection = SECTIONS.find((item) => item.key === section) ?? SECTIONS[0];
  const stickyStatusPrimary =
    state.status || state.saveFeedback.message || state.configStatus || tr(activeSection.labelKey);
  const stickyStatusSecondary =
    state.saveFeedback.state !== "idle" && state.status
      ? state.saveFeedback.message
      : state.configStatus;
  function renderSectionTabs(panels: Partial<Record<SettingsTabId, ReactNode>>) {
    const sectionTabs = [...activeSection.tabs] as SettingsTabId[];
    const tabs = sectionTabs.filter((tab) => panels[tab]);
    const defaultValue =
      initialNavigation.current.section === section && hasSettingsTab(tabs, initialNavigation.current.tab)
        ? initialNavigation.current.tab
        : tabs[0];
    if (!defaultValue) return null;
    return (
      <Tabs className="grid w-full max-w-[820px] content-start gap-3" data-dev-probe={`settings-section-tabs:${section}`} defaultValue={defaultValue} key={section}>
        <TabsList className="relative z-10 inline-flex w-max max-w-full gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-slate-100 p-1 text-slate-500 shadow-none" data-dev-probe="settings-section-tabs-list">
          {tabs.map((tab) => (
            <TabsTrigger
              className="h-7 rounded-md border-0 bg-transparent px-3 text-xs font-semibold shadow-none data-[state=active]:text-slate-950"
              data-dev-probe={`settings-section-tab:${tab}`}
              key={tab}
              value={tab}
            >
              {tr(SETTINGS_TAB_LABEL_KEYS[tab])}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContents>
          {tabs.map((tab) => (
            <TabsContent className="outline-none" key={tab} value={tab}>
              {panels[tab]}
            </TabsContent>
          ))}
        </TabsContents>
      </Tabs>
    );
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className="settings-surface min-h-dvh bg-white text-slate-900" data-surface="settings">
        <header className="flex h-14 items-center justify-between gap-4 border-b border-slate-200 bg-white px-6">
        <div className="flex min-w-0 items-center gap-2">
          <Settings size={20} />
          <h1 className="truncate text-lg font-bold">{tr("window.settings.title")}</h1>
        </div>
        <div className="flex min-w-0 items-center justify-end">
          <p className="max-w-[420px] truncate text-xs text-slate-500">{state.configStatus}</p>
        </div>
      </header>

      <SidebarProvider
        className="flex h-[calc(100dvh-56px)] min-h-0 w-full overflow-hidden bg-slate-50"
      >
        <SettingsSidebar
          activeId={section}
          className="!absolute !inset-y-0 !h-full border-r border-slate-200 bg-white"
          collapsible="icon"
          items={SECTIONS.map((item) => ({
            id: item.key,
            label: tr(item.labelKey),
            icon: item.icon,
          }))}
          label={tr("settings.navigation.label")}
          onChange={(nextSection) => {
            const typedSection = nextSection as SectionKey;
            recordNextFramePerf("settings.section", { section: typedSection });
            setDangerConfirmation(null);
            setSection(typedSection);
          }}
        />

        <SidebarInset className="min-w-0 flex-1 overflow-auto bg-white px-6 py-5">
          <SettingsSectionHeader
            icon={activeSection.icon}
            leading={
              <SidebarTrigger
                aria-label={tr("settings.navigation.toggle")}
                className="size-8 rounded-md border border-slate-200 bg-white text-slate-600 shadow-sm hover:bg-slate-50 hover:text-slate-950"
                title={tr("settings.navigation.toggle")}
              />
            }
            title={tr(activeSection.labelKey)}
          >
            {state.saveFeedback.state !== "idle" ? (
              <span className={`settings-section-save-chip ${state.saveFeedback.state}`} data-dev-probe="settings-section-save-chip">
                {saveFeedbackIcon}
                {state.saveFeedback.message}
              </span>
            ) : null}
          </SettingsSectionHeader>

          {section === "shortcut-language" &&
            renderSectionTabs({
              onboarding: (
                <OnboardingWizard
                  accessibility={state.accessibility}
                  openAccessibilitySettings={openAccessibilitySettings}
                  refreshAccessibilityStatus={refreshAccessibilityStatus}
                  settings={state.settings}
                  tr={tr}
                  updateSettings={updateSettings}
                />
              ),
              shortcut: (
                <SettingGroup title={tr("settings.section.shortcut")}>
                  <div className="setting-row">
                    <span>{tr("settings.shortcut.quickOpen")}</span>
                    <div className="kbd-row">
                      {state.settings.globalShortcut.split("+").map((part) => (
                        <kbd key={part}>{part}</kbd>
                      ))}
                    </div>
                  </div>
                  <div className="setting-row">
                    <span>{tr("settings.shortcut.record")}</span>
                    <button
                      className={recording ? "primary-button" : "secondary-button"}
                      onClick={() => setRecording((v) => !v)}
                      onKeyDown={(event) => {
                        if (!recording) return;
                        event.preventDefault();
                      }}
                      type="button"
                    >
                      {recording ? tr("settings.shortcut.recording") : tr("settings.shortcut.startRecording")}
                    </button>
                  </div>
                  <div className="setting-row">
                    <label htmlFor={manualShortcutId}>{tr("settings.shortcut.manual")}</label>
                    <input
                      id={manualShortcutId}
                      onChange={(event) =>
                        updateSettings({ globalShortcut: event.currentTarget.value })
                      }
                      value={state.settings.globalShortcut}
                    />
                  </div>
                </SettingGroup>
              ),
              language: (
                <SettingGroup title={tr("settings.language.title")}>
                  <div className="setting-row">
                    <span>{tr("settings.language.current")}</span>
                    <SegmentSetting
                      label={tr("settings.language.current")}
                      options={(["system", "zh-CN", "en-US"] as AppLanguagePreference[]).map((value) => ({
                        value,
                        label:
                          value === "system"
                            ? tr("settings.language.system")
                            : value === "zh-CN"
                              ? tr("settings.language.zh")
                              : tr("settings.language.en"),
                      }))}
                      selected={state.settings.language}
                      onChange={(language) => updateSettings({ language })}
                    />
                  </div>
                </SettingGroup>
              ),
              permissions: (
                <SettingGroup title={tr("settings.accessibility.title")}>
                  <SettingsStatusPanel
                    actions={[
                      {
                        label: tr("settings.accessibility.action.request"),
                        onClick: openAccessibilitySettings,
                        icon: ShieldCheck,
                        variant: "primary",
                        tooltip: tr("settings.accessibility.action.request"),
                      },
                      {
                        label: tr("settings.accessibility.action.refresh"),
                        onClick: refreshAccessibilityStatus,
                        icon: RefreshCw,
                        variant: "secondary",
                        tooltip: tr("settings.accessibility.action.refresh"),
                      },
                      {
                        label:
                          dangerConfirmation === "resetAccessibility"
                            ? tr("settings.confirm.again")
                            : tr("settings.accessibility.action.reset"),
                        onClick: () => {
                          if (dangerConfirmation === "resetAccessibility") {
                            void resetAccessibilityPermission();
                            return;
                          }
                          setDangerConfirmation("resetAccessibility");
                        },
                        icon: RotateCcw,
                        variant: "destructive",
                        tooltip: tr("settings.accessibility.action.reset"),
                        ariaLabel:
                          dangerConfirmation === "resetAccessibility"
                            ? tr("settings.confirm.actionAgain", { action: tr("settings.accessibility.action.reset") })
                            : tr("settings.accessibility.action.reset"),
                      },
                    ]}
                    description={state.accessibility?.message ?? tr("settings.accessibility.description")}
                    state={state.accessibility?.canReadFocusedInput ? "good" : "warning"}
                    status={
                      state.accessibility?.canReadFocusedInput
                        ? tr("settings.accessibility.status.granted")
                        : tr("settings.accessibility.status.missing")
                    }
                    title={tr("settings.accessibility.title")}
                  >
                    {state.accessibilityDiagnostics ? (
                      <div className="permission-diagnostics">
                        <div>
                          <span>{tr("settings.accessibility.currentProcess")}</span>
                          <strong>{state.accessibilityDiagnostics.trusted ? "trusted" : "missing"}</strong>
                        </div>
                        <div>
                          <span>Bundle ID</span>
                          <code>{state.accessibilityDiagnostics.expectedBundleIdentifier}</code>
                        </div>
                        <div>
                          <span>{tr("settings.accessibility.signatureId")}</span>
                          <code>{state.accessibilityDiagnostics.codeSignatureIdentifier || "unknown"}</code>
                        </div>
                        <div>
                          <span>{tr("settings.accessibility.signatureKind")}</span>
                          <code>{state.accessibilityDiagnostics.signatureKind || "unknown"}</code>
                        </div>
                        <p className="path">{state.accessibilityDiagnostics.appBundlePath || state.accessibilityDiagnostics.executablePath}</p>
                        {state.accessibilityDiagnostics.tccRecords.length > 0 ? (
                          <div className="tcc-records">
                            {state.accessibilityDiagnostics.tccRecords.map((record) => (
                              <p key={`${record.client}:${record.lastModified}`}>
                                <span>{record.database}</span>
                                <code>{record.client}</code>
                                <span>{record.authLabel}</span>
                                <span>{record.csreqSummary}</span>
                                <span>{record.lastModified}</span>
                              </p>
                            ))}
                          </div>
                        ) : (
                          <p>{tr("settings.accessibility.noTccRecord")}</p>
                        )}
                        {state.accessibilityDiagnostics.tccQueryError ? (
                          <p>{tr("settings.accessibility.tccQueryFailed", { error: state.accessibilityDiagnostics.tccQueryError })}</p>
                        ) : null}
                      </div>
                    ) : null}
                  </SettingsStatusPanel>
                </SettingGroup>
              ),
            })}

          {section === "display-panel" &&
            renderSectionTabs({
              density: (
                <SettingGroup title={tr("settings.tab.density")}>
                  <div className="setting-row">
                    <span>{tr("settings.display.density")}</span>
                    <SegmentSetting
                      label={tr("settings.display.density")}
                      options={(["dense", "normal", "comfortable"] as AppSettings["panelDensity"][]).map((v) => ({
                        value: v,
                        label: densityCopy[v],
                      }))}
                      probeId="settings-control:panelDensity"
                      selected={state.settings.panelDensity}
                      onChange={(panelDensity) => updateSettings({ panelDensity })}
                    />
                  </div>
                  <div className="setting-row">
                    <span>{tr("settings.display.contentMode")}</span>
                    <SegmentSetting
                      label={tr("settings.display.contentMode")}
                      options={(["summary", "middle", "raw"] as AppSettings["contentDisplayMode"][]).map((v) => ({
                        value: v,
                        label: displayModeCopy[v],
                      }))}
                      selected={state.settings.contentDisplayMode}
                      onChange={(contentDisplayMode) => updateSettings({ contentDisplayMode })}
                    />
                  </div>
                  <NumberSetting
                    label={tr("settings.display.quickItemLimit")}
                    value={state.settings.quickItemLimit}
                    min={4}
                    max={30}
                    probeId="settings-control:quickItemLimit"
                    onChange={(quickItemLimit) => updateSettings({ quickItemLimit })}
                  />
                </SettingGroup>
              ),
              size: (
                <SettingGroup title={tr("settings.tab.size")}>
                  <NumberSetting
                    label={tr("settings.display.panelWidth")}
                    value={state.settings.panelWidth}
                    min={320}
                    max={600}
                    onChange={(panelWidth) => updateSettings({ panelWidth })}
                  />
                  <NumberSetting
                    label={tr("settings.display.panelHeight")}
                    value={state.settings.panelHeight}
                    min={300}
                    max={1000}
                    onChange={(panelHeight) => updateSettings({ panelHeight })}
                  />
                  <SliderSetting
                    label={tr("settings.display.backgroundOpacity")}
                    min={20}
                    max={100}
                    step={1}
                    suffix="%"
                    value={Math.round(state.settings.panelBackgroundOpacity * 100)}
                    probeId="settings-control:panelBackgroundOpacity"
                    onChange={(value) => updateSettings({ panelBackgroundOpacity: value / 100 })}
                  />
                </SettingGroup>
              ),
              position: (
                <SettingGroup title={tr("settings.tab.position")}>
                  <div className="setting-row">
                    <span>{tr("settings.display.positionStrategy")}</span>
                    <SegmentSetting
                      label={tr("settings.display.positionStrategy")}
                      options={(["trayCenter", "followCursor", "center", "windowCenter", "lastPosition", "focusInput"] as AppSettings["positionStrategy"][]).map((v) => ({
                        value: v,
                        label: positionStrategyCopy[v],
                      }))}
                      selected={state.settings.positionStrategy}
                      onChange={(positionStrategy) => updateSettings({ positionStrategy })}
                    />
                  </div>
                </SettingGroup>
              ),
              test: (
                <SettingGroup title={tr("settings.tab.test")}>
                  <ToggleSetting
                    label={tr("settings.display.autoHideDock")}
                    checked={state.settings.enableScrollCollapse}
                    probeId="settings-control:enableScrollCollapse"
                    onChange={(enableScrollCollapse) => updateSettings({ enableScrollCollapse })}
                  />
                  <div className="setting-card permission-card">
                    <span>{tr("settings.integration.floating.title")}</span>
                    <strong>
                      {state.panel?.visible ? tr("settings.integration.floating.visible") : tr("settings.integration.floating.hidden")} · {state.panel?.focused ? tr("settings.integration.floating.focused") : tr("settings.integration.floating.unfocused")}
                    </strong>
                    <p>
                      {tr("settings.integration.floating.sourceDetail", {
                        source: state.panel?.source ?? "-",
                        positionSource: state.panel?.positionSource ?? "-",
                        inputSource: state.panel?.focusedInputSource || tr("settings.integration.floating.inputMiss"),
                      })}
                    </p>
                    <p>
                      {state.panel
                        ? `x=${Math.round(state.panel.x)} y=${Math.round(state.panel.y)} ${Math.round(state.panel.width)}x${Math.round(state.panel.height)}`
                        : tr("settings.integration.floating.notChecked")}
                    </p>
                    <div className="button-row">
                      <button className="settings-action-button diagnostic" onClick={testFloatingPanel} type="button">
                        {tr("settings.integration.floating.test")}
                      </button>
                      <button className="settings-action-button secondary" onClick={refreshPanelStatus} type="button">
                        {tr("settings.integration.floating.refresh")}
                      </button>
                    </div>
                  </div>
                </SettingGroup>
              ),
            })}

          {section === "mcp-agent" &&
            renderSectionTabs({
              status: (
                <SettingGroup title={tr("settings.tab.status")}>
                  <div className="setting-card permission-card">
                    <span>{tr("settings.integration.mcp.title")}</span>
                    <strong>{state.mcp?.running ? tr("settings.integration.mcp.running") : tr("settings.integration.mcp.unknown")} · {state.mcp?.transport ?? "stdio"}</strong>
                    <p>{tr("settings.integration.mcp.description")}</p>
                    <p className="mcp-tool-list">{state.mcp?.tools.join(" / ") || tr("settings.integration.mcp.emptyTools")}</p>
                    <div className="button-row">
                      <button className="settings-action-button secondary" onClick={() => void refreshMcpStatus()} type="button">
                        <RefreshCw size={13} />
                        {tr("settings.diagnostics.refresh")}
                      </button>
                    </div>
                  </div>
                  <div className="setting-card permission-card">
                    <span>{tr("settings.integration.provider.title")}</span>
                    <strong>{tr("settings.integration.provider.summary", { count: getConfiguredAgentProviderCount() })}</strong>
                    <p>{tr("settings.integration.provider.description")}</p>
                  </div>
                  <div className="setting-card permission-card mcp-doc-card">
                    <span>{tr("settings.manual.currentTools")}</span>
                    <p>{state.mcp?.tools.join(" / ") || tr("settings.status.loading")}</p>
                  </div>
                </SettingGroup>
              ),
              install: (
                <SettingGroup title={tr("settings.tab.install")}>
                  <div className="setting-card permission-card mcp-doc-card">
                    <span>{tr("settings.manual.agentQuickStart")}</span>
                    <strong>{tr("settings.manual.agentSummary")}</strong>
                    <p>{tr("settings.manual.agentDescription")}</p>
                    <SettingsCodeTabs
                      copyLabel={tr("settings.action.copy")}
                      tabs={mcpAgentCodeTabs.filter((tab) => tab.value === "install" || tab.value === "command")}
                      onCopy={copyMcpAgentCodeTab}
                    />
                    <p>{tr("settings.manual.successContract")}</p>
                    <p>{tr("settings.manual.errorContract")}</p>
                  </div>
                </SettingGroup>
              ),
              "json-rpc": (
                <SettingGroup title={tr("settings.tab.jsonRpc")}>
                  <div className="setting-card permission-card mcp-doc-card">
                    <span>{tr("settings.integration.examples.title")}</span>
                    <strong>{tr("settings.integration.examples.summary")}</strong>
                    <SettingsCodeTabs
                      copyLabel={tr("settings.action.copy")}
                      tabs={mcpAgentCodeTabs.filter((tab) => tab.value === "tools" || tab.value === "json-rpc")}
                      onCopy={copyMcpAgentCodeTab}
                    />
                  </div>
                </SettingGroup>
              ),
              provider: (
                <SettingGroup title={tr("settings.tab.provider")}>
                  <div className="setting-card permission-card mcp-doc-card">
                    <span>{tr("settings.integration.provider.title")}</span>
                    <strong>{tr("settings.integration.provider.summary", { count: getConfiguredAgentProviderCount() })}</strong>
                    <p>{tr("settings.integration.provider.description")}</p>
                    <SettingsCodeTabs
                      copyLabel={tr("settings.action.copy")}
                      tabs={mcpAgentCodeTabs.filter((tab) => tab.value === "provider")}
                      onCopy={copyMcpAgentCodeTab}
                    />
                  </div>
                </SettingGroup>
              ),
            })}

          {section === "capture-content" &&
            renderSectionTabs({
              search: (
                <SettingGroup title={tr("settings.tab.search")}>
                  <ToggleSetting
                    checked={state.settings.fuzzySearchEnabled}
                    label={tr("settings.content.fuzzySearch")}
                    onChange={(fuzzySearchEnabled) => updateSettings({ fuzzySearchEnabled })}
                  />
                  <ToggleSetting
                    checked={state.settings.pinyinSearchEnabled}
                    label={tr("settings.content.pinyinSearch")}
                    onChange={(pinyinSearchEnabled) => updateSettings({ pinyinSearchEnabled })}
                  />
                  <div className="check-grid">
                    <CheckItem
                      icon={<ExternalLink size={15} />}
                      title={tr("settings.content.link.title")}
                      body={tr("settings.content.link.body")}
                    />
                    <CheckItem
                      icon={<Terminal size={15} />}
                      title={tr("settings.content.command.title")}
                      body={tr("settings.content.command.body")}
                    />
                  </div>
                </SettingGroup>
              ),
              preview: (
                <SettingGroup title={tr("settings.tab.preview")}>
                  <ToggleSetting
                    checked={state.settings.enableMarkdownPreview}
                    label={tr("settings.content.markdownPreview")}
                    onChange={(enableMarkdownPreview) => updateSettings({ enableMarkdownPreview })}
                  />
                  <div className="check-grid">
                    <CheckItem
                      icon={<Eye size={15} />}
                      title={tr("settings.content.markdown.title")}
                      body={tr("settings.content.markdown.body")}
                    />
                    <CheckItem
                      icon={<FileCode size={15} />}
                      title={tr("settings.content.code.title")}
                      body={tr("settings.content.code.body")}
                    />
                  </div>
                </SettingGroup>
              ),
              "capture-types": (
                <SettingGroup title={tr("settings.tab.captureTypes")}>
                  <SettingsFieldRow
                    section="capture-content"
                    tab="capture-types"
                    values={state.settings as unknown as Record<string, unknown>}
                    onChange={(key, value) => updateSettings({ [key]: value } as Partial<AppSettings>)}
                    tr={tr}
                    extraNodes={[
                      <div className="setting-card permission-card" key="capture-multi-type">
                        <span>{tr("settings.capture.multiType.title")}</span>
                        <strong>{tr("settings.capture.multiType.summary")}</strong>
                        <p>{tr("settings.capture.multiType.description")}</p>
                      </div>,
                    ]}
                  />
                </SettingGroup>
              ),
              limits: (
                <SettingGroup title={tr("settings.tab.limits")}>
                  <NumberSetting
                    label={tr("settings.capture.imageMaxSize")}
                    max={1024}
                    min={1}
                    onChange={(imageMaxSizeMb) => updateSettings({ imageMaxSizeMb })}
                    value={state.settings.imageMaxSizeMb}
                  />
                  <NumberSetting
                    label={tr("settings.capture.textMaxSize")}
                    max={100}
                    min={1}
                    onChange={(textMaxSizeMb) => updateSettings({ textMaxSizeMb })}
                    value={state.settings.textMaxSizeMb}
                  />
                </SettingGroup>
              ),
            })}

          {section === "storage-logs" &&
            renderSectionTabs({
              data: (
                <SettingGroup title={tr("settings.storage.data.title")}>
                    <ReadonlyField
                      copyLabel={tr("settings.action.copy")}
                      label={tr("settings.storage.configPath")}
                      onCopy={(label, value) => void copySettingsSnippet(label, value)}
                      value={state.configPath}
                    />
                    <ReadonlyField
                      copyLabel={tr("settings.action.copy")}
                      label={tr("settings.storage.databasePath")}
                      onCopy={(label, value) => void copySettingsSnippet(label, value)}
                      value={state.databasePath}
                    />
                    <NumberSetting
                      label={tr("settings.storage.maxItems")}
                      value={state.settings.maxStoredItems}
                      min={50}
                      max={5000}
                      onChange={(maxStoredItems) => updateSettings({ maxStoredItems })}
                    />
                    <NumberSetting
                      label={tr("settings.storage.pollInterval")}
                      value={state.settings.clipboardPollMs}
                      min={500}
                      max={5000}
                      onChange={(clipboardPollMs) => updateSettings({ clipboardPollMs })}
                    />
                </SettingGroup>
              ),
              cleanup: (
                <SettingGroup title={tr("settings.tab.cleanup")}>
                    <ToggleSetting
                      checked={state.settings.cleanupEnabled}
                      label={tr("settings.storage.cleanupEnabled")}
                      onChange={(cleanupEnabled) => updateSettings({ cleanupEnabled })}
                    />
                    <NumberSetting
                      label={tr("settings.storage.cleanupInterval")}
                      value={state.settings.cleanupIntervalHours}
                      min={1}
                      max={720}
                      onChange={(cleanupIntervalHours) => updateSettings({ cleanupIntervalHours })}
                    />
                    <NumberSetting
                      label={tr("settings.storage.retentionDays")}
                      value={state.settings.softDeletedRetentionDays}
                      min={1}
                      max={365}
                      onChange={(softDeletedRetentionDays) =>
                        updateSettings({ softDeletedRetentionDays })
                      }
                    />
                </SettingGroup>
              ),
              logs: (
                <SettingGroup title={tr("settings.logs.title")}>
                    <ReadonlyField
                      copyLabel={tr("settings.action.copy")}
                      description={
                        state.logStats
                          ? tr("settings.logs.lineCount", {
                              size: formatBytes(state.logStats.sizeBytes),
                              count: state.logStats.lineCount,
                            })
                          : tr("settings.status.loading")
                      }
                      label={tr("settings.logs.file")}
                      onCopy={(label, value) => void copySettingsSnippet(label, value)}
                      value={state.logStats?.path ?? ""}
                    />
                    <NumberSetting
                      label={tr("settings.logs.maxSize")}
                      value={state.settings.logMaxSizeMb}
                      min={1}
                      max={1024}
                      onChange={(logMaxSizeMb) => updateSettings({ logMaxSizeMb })}
                    />
                    <NumberSetting
                      label={tr("settings.logs.keepRatio")}
                      value={Math.round(state.settings.logKeepRatio * 100)}
                      min={10}
                      max={95}
                      onChange={(percent) => updateSettings({ logKeepRatio: percent / 100 })}
                    />
                    <NumberSetting
                      label={tr("settings.logs.maxLines")}
                      value={state.settings.logMaxLines}
                      min={1000}
                      max={1000000}
                      onChange={(logMaxLines) => updateSettings({ logMaxLines })}
                    />
                    <div className="setting-row">
                      <span>{tr("settings.logs.retentionPolicy")}</span>
                      <strong>{tr("settings.logs.retentionPolicyValue")}</strong>
                    </div>
                    <ToggleSetting
                      checked={state.settings.logAutoCleanup}
                      label={tr("settings.logs.autoCleanup")}
                      onChange={(logAutoCleanup) => updateSettings({ logAutoCleanup })}
                    />
                    <NumberSetting
                      label={tr("settings.logs.cleanupInterval")}
                      value={state.settings.logCleanupIntervalMin}
                      min={1}
                      max={1440}
                      onChange={(logCleanupIntervalMin) =>
                        updateSettings({ logCleanupIntervalMin })
                      }
                    />
                </SettingGroup>
              ),
              diagnostics: (
                <SettingGroup title={tr("settings.diagnostics.title")}>
                    <SettingsStatusPanel
                      actions={[
                        {
                          label: tr("settings.diagnostics.exportBundle"),
                          onClick: () => void exportDiagnosticsBundle(),
                          icon: FileDown,
                          variant: "diagnostic",
                          tooltip: tr("settings.diagnostics.exportBundle"),
                          probeId: "settings-action:diagnostics.export",
                        },
                        {
                          label: dangerConfirmation === "cleanupLogs" ? tr("settings.diagnostics.confirmAgain") : tr("settings.diagnostics.cleanupNow"),
                          onClick: () => {
                            if (dangerConfirmation === "cleanupLogs") {
                              void cleanupLogsNow();
                              return;
                            }
                            setDangerConfirmation("cleanupLogs");
                          },
                          icon: Trash2,
                          variant: "destructive",
                          tooltip: tr("settings.diagnostics.cleanupTooltip"),
                          probeId: "settings-action:diagnostics.cleanup",
                          ariaLabel:
                            dangerConfirmation === "cleanupLogs"
                              ? tr("settings.diagnostics.confirmCleanup")
                              : tr("settings.diagnostics.cleanupTooltip"),
                        },
                        {
                          label: tr("settings.diagnostics.refresh"),
                          onClick: () => void refreshLogStats(),
                          icon: RefreshCw,
                          variant: "secondary",
                          tooltip: tr("settings.diagnostics.refreshLogStats"),
                          probeId: "settings-action:diagnostics.refresh",
                        },
                      ]}
                      description={
                        state.logStats
                          ? tr("settings.logs.lineCount", {
                              size: formatBytes(state.logStats.sizeBytes),
                              count: state.logStats.lineCount,
                            })
                          : tr("settings.status.waitingLogStats")
                      }
                      state={logActionStatus.state}
                      status={logActionStatus.message || tr("settings.diagnostics.statusIdle")}
                      title={tr("settings.diagnostics.title")}
                      probeId="settings-status:diagnostics"
                    />
                </SettingGroup>
              ),
            })}

          {section === "update-distribution" &&
            renderSectionTabs({
              version: (
                <SettingGroup title={tr("settings.tab.version")}>
                  <SettingsStatusPanel
                    description={updateStatusCopy}
                    items={[
                      {
                        label: tr("settings.update.status"),
                        value: (
                          <span className="path">
                            {state.update?.status ?? "idle"}
                            {typeof state.update?.downloadProgress === "number"
                              ? ` · ${Math.round(state.update.downloadProgress * 100)}%`
                              : ""}
                          </span>
                        ),
                      },
                      ...(state.update?.releaseNotes
                        ? [
                            {
                              label: tr("settings.update.releaseNotes"),
                              value: <span className="path">{state.update.releaseNotes}</span>,
                            },
                          ]
                        : []),
                      ...(state.update?.errorCode
                        ? [
                            {
                              label: tr("settings.update.error"),
                              value: (
                                <span className="path">
                                  {state.update.errorCode}
                                  {state.update.errorMessage ? ` · ${state.update.errorMessage}` : ""}
                                </span>
                              ),
                            },
                          ]
                        : []),
                      ...(state.update?.ignoredVersion
                        ? [
                            {
                              label: tr("settings.update.ignoredVersion"),
                              value: <span className="path">{state.update.ignoredVersion}</span>,
                            },
                          ]
                        : []),
                      ...(state.update?.lastCheckedAt
                        ? [
                            {
                              label: tr("settings.update.lastChecked"),
                              value: <span className="path">{new Date(state.update.lastCheckedAt).toLocaleString()}</span>,
                            },
                          ]
                        : []),
                    ]}
                    state={state.update?.status === "failed" ? "danger" : state.update?.status === "checking" || state.update?.status === "downloading" ? "pending" : state.update?.status === "available" || state.update?.status === "ready" ? "warning" : "neutral"}
                    status={`${state.update?.currentVersion ?? "0.1.0"} · ${state.update?.channel ?? "stable"}`}
                    title={tr("settings.update.currentVersion")}
                  />
                </SettingGroup>
              ),
              "update-flow": (
                <SettingGroup title={tr("settings.tab.updateFlow")}>
                  <SettingsStatusPanel
                    actions={[
                      {
                        label: tr("settings.update.action.check"),
                        onClick: () => void checkUpdateNow(),
                        icon: RefreshCw,
                        variant: "primary",
                        tooltip: tr("settings.update.action.check"),
                        probeId: "settings-action:update.check",
                      },
                      {
                        label: tr("settings.update.action.download"),
                        onClick: () => void downloadUpdateNow(),
                        icon: FileDown,
                        variant: "secondary",
                        disabled: state.update?.status !== "available",
                        tooltip: tr("settings.update.action.download"),
                        probeId: "settings-action:update.download",
                      },
                      {
                        label: tr("settings.update.action.install"),
                        onClick: () => void installUpdateNow(),
                        icon: UploadCloud,
                        variant: "secondary",
                        disabled: state.update?.status !== "ready",
                        tooltip: tr("settings.update.action.install"),
                        probeId: "settings-action:update.install",
                      },
                      {
                        label: tr("settings.update.action.ignore"),
                        onClick: () => void ignoreCurrentUpdate(),
                        variant: "secondary",
                        disabled: !state.update?.availableVersion,
                        tooltip: tr("settings.update.action.ignore"),
                        probeId: "settings-action:update.ignore",
                      },
                    ]}
                    description={updateStatusCopy}
                    state={state.update?.status === "failed" ? "danger" : state.update?.status === "checking" || state.update?.status === "downloading" ? "pending" : state.update?.status === "available" || state.update?.status === "ready" ? "warning" : "neutral"}
                    status={state.update?.status ?? "idle"}
                    title={tr("settings.update.actions")}
                    probeId="settings-status:update-flow"
                  />
                </SettingGroup>
              ),
              build: (
                <SettingGroup title={tr("settings.tab.build")}>
                  <SettingsStatusPanel
                    items={[
                      {
                        label: tr("settings.update.buildInfo"),
                        value: (
                          <span className="path">
                            {state.buildInfo
                              ? `${state.buildInfo.productName} ${state.buildInfo.currentVersion} · ${state.buildInfo.targetOs}-${state.buildInfo.targetArch}`
                              : tr("settings.update.buildLoading")}
                          </span>
                        ),
                      },
                      {
                        label: tr("settings.update.bundleId"),
                        value: <span className="path">{state.buildInfo?.bundleIdentifier ?? "app.clipforge.desktop"}</span>,
                      },
                      {
                        label: tr("settings.update.endpoint"),
                        value: <span className="path">{state.buildInfo?.updaterEndpoint ?? "latest.json"}</span>,
                      },
                    ]}
                    state="neutral"
                    status={state.buildInfo?.currentVersion ?? state.update?.currentVersion ?? "0.1.0"}
                    title={tr("settings.update.buildInfo")}
                  />
                </SettingGroup>
              ),
            })}

          {section === "tag-rules" &&
            renderSectionTabs({
              "tag-mode": (
                <SettingGroup title={tr("settings.tab.tagMode")}>
                  <div className="setting-row">
                    <span>{tr("settings.tags.generation")}</span>
                    <SegmentSetting
                      label={tr("settings.tags.generation")}
                      options={(["similar", "rules", "off"] as AppSettings["tagMode"][]).map((v) => ({
                        value: v,
                        label: tagModeLabels[v],
                      }))}
                      selected={state.settings.tagMode}
                      onChange={(tagMode) => updateSettings({ tagMode })}
                    />
                  </div>
                </SettingGroup>
              ),
              rules: (
                <SettingGroup title={tr("settings.tab.rules")}>
                  <div className="tag-rule-list">
                    {state.settings.tagRules.map((rule) => (
                      <div className="tag-rule-row" key={rule.id}>
                        <label className="tag-rule-field tag-rule-label-field" htmlFor={`tag-rule-${rule.id}-label`}>
                          <span>{tr("settings.tags.name")}</span>
                          <input
                            className="rule-label"
                            id={`tag-rule-${rule.id}-label`}
                            onChange={(event) => updateTagRule(rule.id, { label: event.currentTarget.value })}
                            value={rule.label}
                          />
                        </label>
                        <label className="tag-rule-field tag-rule-query-field" htmlFor={`tag-rule-${rule.id}-query`}>
                          <span>{tr("settings.tags.keyword")}</span>
                          <input
                            className="rule-query"
                            id={`tag-rule-${rule.id}-query`}
                            onChange={(event) => updateTagRule(rule.id, { query: event.currentTarget.value })}
                            value={rule.query}
                          />
                        </label>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              aria-label={tr("settings.tags.deleteRule")}
                              className="settings-action-button destructive icon-only"
                              onClick={() => deleteTagRule(rule.id)}
                              type="button"
                            >
                              <Trash2 size={14} />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent className="settings-tooltip-content" side="top" sideOffset={8}>{tr("settings.tags.deleteRule")}</TooltipContent>
                        </Tooltip>
                      </div>
                    ))}
                  </div>
                  <button className="settings-action-button secondary" onClick={addTagRule} type="button">
                    <Plus size={14} />
                    {tr("settings.tags.addRule")}
                  </button>
                </SettingGroup>
              ),
            })}
          <SettingsStickyStatusBar
            primary={stickyStatusPrimary}
            secondary={stickyStatusSecondary}
            state={state.saveFeedback.state}
          />
        </SidebarInset>
      </SidebarProvider>
    </div>
  </TooltipProvider>
  );
}
