import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { settingsService } from "./services/settings";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Plus,
  Trash2,
} from "lucide-react";
import { getFrontendEnvironmentSnapshot } from "./frontend-diagnostics";
import { recordNextFramePerf } from "./performance-smoke";
import {
  formatCommandError,
  normalizeLanguagePreference,
  resolveAppLocale,
  setDocumentLocale,
  t,
} from "./i18n";
import {
  SettingGroup,
  SegmentSetting,
} from "./settings/controls";
import { McpAgentSection, TagRulesSection, UpdateDistributionSection } from "./settings/sections/AgentUpdateTagSections";
import { ShortcutLanguageSection } from "./settings/sections/ShortcutLanguageSection";
import { CaptureContentSection, StorageLogsSection } from "./settings/sections/CaptureStorageSections";
import { DisplayPanelSection } from "./settings/sections/DisplayPanelSection";
import { SettingsErrorBoundary } from "./settings/components/SettingsErrorBoundary";
import { SettingsShell } from "./settings/components/SettingsShell";
import { type SettingsCodeTab } from "./settings/components/SettingsCodeTabs";
import { type SettingsStatusPanelState } from "./settings/components/SettingsStatusPanel";
import { SettingsStickyStatusBar } from "./settings/components/SettingsStickyStatusBar";
import { type SettingsTabId } from "./settings/settings-field-catalog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import {
  DEFAULT_SETTINGS,
  DiagnosticsExportPayload,
  formatBytes,
  getInitialNavigationFromUrl,
  hasSettingsTab,
  LaunchAtLoginPayload,
  LogStatsPayload,
  McpStatusPayload,
  normalizeAppSettings,
  PanelTriggerPayload,
  SECTIONS,
  SectionKey,
  SettingsAppState,
  SETTINGS_TAB_LABEL_KEYS,
  type AccessibilityDiagnosticsPayload,
  type AccessibilityPermissionPayload,
  type AppSettings,
  type BuildInfoPayload,
} from "./settings/settings-model";

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
    launchAtLogin: null,
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
        const [settingsDocument, configPath, databasePath, accessibility, accessibilityDiagnostics, panel, launchAtLogin, mcp, logStats, buildInfo] = await Promise.all([
          settingsService.get(true),
          invoke<string>("get_clipforge_config_path"),
          invoke<string>("get_clipforge_database_path"),
          invoke<AccessibilityPermissionPayload>("check_accessibility_permission"),
          invoke<AccessibilityDiagnosticsPayload>("get_accessibility_diagnostics"),
          invoke<PanelTriggerPayload>("get_panel_trigger_status"),
          invoke<LaunchAtLoginPayload>("get_launch_at_login"),
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
          launchAtLogin,
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
      await invoke("open_accessibility_settings");
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

  async function setLaunchAtLoginEnabled(enabled: boolean) {
    try {
      const launchAtLogin = await invoke<LaunchAtLoginPayload>("set_launch_at_login", { enabled });
      setState((prev) => ({
        ...prev,
        launchAtLogin,
        status: launchAtLogin.message,
      }));
      updateSettings({ launchAtLogin: enabled });
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
              id: "local-openai-compatible",
              name: "Local OpenAI-compatible gateway",
              kind: "openai-compatible",
              enabled: false,
              baseUrl: "http://127.0.0.1:1234/v1",
              modelId: "local-model",
              apiKeyEnv: "CLIPFORGE_AGENT_LOCAL_API_KEY",
              timeoutSeconds: 120,
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
        <TabsList className="inline-flex w-max max-w-full gap-1 overflow-x-auto rounded-lg bg-black/[0.04] p-0.5 text-muted-foreground dark:bg-white/[0.07]" data-dev-probe="settings-section-tabs-list">
          {tabs.map((tab) => (
            <TabsTrigger
              className="h-7 rounded-[7px] border-0 bg-transparent px-2.5 text-[12px] font-medium text-muted-foreground shadow-none transition-colors data-[state=active]:bg-white data-[state=active]:text-foreground data-[state=active]:shadow-sm dark:data-[state=active]:bg-white/[0.14]"
              data-dev-probe={`settings-section-tab:${tab}`}
              key={tab}
              value={tab}
            >
              {tr(SETTINGS_TAB_LABEL_KEYS[tab])}
            </TabsTrigger>
          ))}
        </TabsList>
        {tabs.map((tab) => (
          <TabsContent className="outline-none" key={tab} value={tab}>
            <SettingsErrorBoundary
              message={tr("settings.error.tabMessage")}
              resetKey={`${section}:${tab}:${locale}`}
              retryLabel={tr("settings.error.retry")}
              scope={`settings-tab:${section}:${tab}`}
              title={tr("settings.error.tabTitle")}
            >
              {panels[tab]}
            </SettingsErrorBoundary>
          </TabsContent>
        ))}
      </Tabs>
    );
  }

  return (
    <TooltipProvider delayDuration={300}>
      <SettingsShell
        activeId={section}
        items={SECTIONS.map((item) => ({
          id: item.key,
          label: tr(item.labelKey),
          icon: item.icon,
        }))}
        onSelect={(nextSection) => {
          const typedSection = nextSection as SectionKey;
          recordNextFramePerf("settings.section", { section: typedSection });
          setDangerConfirmation(null);
          setSection(typedSection);
        }}
        title={tr("window.settings.title")}
        version={`ClipForge v${state.update?.currentVersion ?? "0.1.0"}`}
      >

          {section === "shortcut-language" && (
            <ShortcutLanguageSection
              dangerConfirmation={dangerConfirmation}
              manualShortcutId={manualShortcutId}
              recording={recording}
              setDangerConfirmation={(v) => setDangerConfirmation(v as "resetAccessibility" | "cleanupLogs" | null)}
              setLaunchAtLoginEnabled={setLaunchAtLoginEnabled}
              setRecording={setRecording}
              state={{
                accessibility: state.accessibility,
                accessibilityDiagnostics: state.accessibilityDiagnostics,
                launchAtLogin: state.launchAtLogin,
                settings: state.settings,
              }}
              tr={tr}
              updateSettings={updateSettings}
              openAccessibilitySettings={openAccessibilitySettings}
              refreshAccessibilityStatus={refreshAccessibilityStatus}
              resetAccessibilityPermission={resetAccessibilityPermission}
              renderTabs={renderSectionTabs}
            />
          )}
          {section === "display-panel" && (
            <DisplayPanelSection
              densityCopy={densityCopy}
              displayModeCopy={displayModeCopy}
              panel={state.panel}
              positionStrategyCopy={positionStrategyCopy}
              refreshPanelStatus={refreshPanelStatus}
              settings={state.settings}
              testFloatingPanel={testFloatingPanel}
              tr={tr}
              updateSettings={updateSettings}
              renderTabs={renderSectionTabs}
            />
          )}
          {section === "mcp-agent" && (
            <McpAgentSection
              copyMcpAgentCodeTab={copyMcpAgentCodeTab}
              getConfiguredAgentProviderCount={getConfiguredAgentProviderCount}
              mcpAgentCodeTabs={mcpAgentCodeTabs}
              refreshMcpStatus={refreshMcpStatus}
              renderTabs={renderSectionTabs}
              state={state}
              tr={tr}
            />
          )}

          {section === "update-distribution" && (
            <UpdateDistributionSection
              buildInfo={state.buildInfo}
              checkUpdateNow={checkUpdateNow}
              downloadUpdateNow={downloadUpdateNow}
              ignoreCurrentUpdate={ignoreCurrentUpdate}
              installUpdateNow={installUpdateNow}
              renderTabs={renderSectionTabs}
              tr={tr}
              update={state.update}
              updateStatusCopy={updateStatusCopy}
            />
          )}

          {section === "tag-rules" && (
            <TagRulesSection
              addTagRule={addTagRule}
              deleteTagRule={deleteTagRule}
              renderTabs={renderSectionTabs}
              settings={state.settings}
              tagModeLabels={tagModeLabels}
              tr={tr}
              updateSettings={updateSettings}
              updateTagRule={updateTagRule}
            />
          )}

          {section === "capture-content" && (
            <CaptureContentSection
              renderTabs={renderSectionTabs}
              settings={state.settings}
              tr={tr}
              updateSettings={updateSettings}
            />
          )}

          {section === "storage-logs" && (
            <StorageLogsSection
              configPath={state.configPath}
              copySettingsSnippet={copySettingsSnippet}
              databasePath={state.databasePath}
              dangerConfirmation={dangerConfirmation}
              formatBytes={formatBytes}
              logActionStatus={logActionStatus}
              logStats={state.logStats}
              refreshLogStats={refreshLogStats}
              renderTabs={renderSectionTabs}
              setDangerConfirmation={(v) => setDangerConfirmation(v as "cleanupLogs" | null)}
              settings={state.settings}
              tr={tr}
              updateSettings={updateSettings}
              cleanupLogsNow={cleanupLogsNow}
              exportDiagnosticsBundle={exportDiagnosticsBundle}
            />
          )}

          {section === "tag-rules" &&
            renderSectionTabs({
              "tag-mode": (
                <SettingGroup title={tr("settings.tab.tagMode")}>
                  <div className="flex items-center justify-between gap-8 py-3">
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
                  <div className="space-y-2">
                    {state.settings.tagRules.map((rule) => (
                      <div className="flex items-center gap-2" key={rule.id}>
                        <label className="flex-1" htmlFor={`tag-rule-${rule.id}-label`}>
                          <span className="mb-1 block text-[11px] text-muted-foreground">{tr("settings.tags.name")}</span>
                          <Input
                            className="h-7 rounded-md text-[13px]"
                            id={`tag-rule-${rule.id}-label`}
                            onChange={(event) => updateTagRule(rule.id, { label: event.currentTarget.value })}
                            value={rule.label}
                          />
                        </label>
                        <label className="flex-[2]" htmlFor={`tag-rule-${rule.id}-query`}>
                          <span className="mb-1 block text-[11px] text-muted-foreground">{tr("settings.tags.keyword")}</span>
                          <Input
                            className="h-7 rounded-md text-[13px]"
                            id={`tag-rule-${rule.id}-query`}
                            onChange={(event) => updateTagRule(rule.id, { query: event.currentTarget.value })}
                            value={rule.query}
                          />
                        </label>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              aria-label={tr("settings.tags.deleteRule")}
                              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-destructive transition-colors hover:bg-destructive/10"
                              onClick={() => deleteTagRule(rule.id)}
                              type="button"
                            >
                              <Trash2 size={14} />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="top" sideOffset={8}>{tr("settings.tags.deleteRule")}</TooltipContent>
                        </Tooltip>
                      </div>
                    ))}
                  </div>
                  <button className="mt-2 flex h-7 items-center gap-1.5 rounded-md bg-black/[0.04] px-2.5 text-[12px] text-foreground transition-colors hover:bg-black/[0.06] dark:bg-white/[0.07] dark:hover:bg-white/[0.1]" onClick={addTagRule} type="button">
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
      </SettingsShell>
    </TooltipProvider>
  );
}
