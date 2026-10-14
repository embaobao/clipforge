import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { settingsService } from "./services/settings";
import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getFrontendEnvironmentSnapshot } from "./frontend-diagnostics";
import { recordNextFramePerf } from "./performance-smoke";
import { logSettingsEvent } from "./settings/settings-log";
import {
  formatCommandError,
  normalizeLanguagePreference,
  resolveAppLocale,
  setDocumentLocale,
  t,
} from "./i18n";
import { McpAgentSection, TagRulesSection, UpdateDistributionSection } from "./settings/sections/AgentUpdateTagSections";
import { ShortcutLanguageSection } from "./settings/sections/ShortcutLanguageSection";
import { CaptureContentSection, StorageLogsSection } from "./settings/sections/CaptureStorageSections";
import { DisplayPanelSection } from "./settings/sections/DisplayPanelSection";
import { SettingsErrorBoundary } from "./settings/components/SettingsErrorBoundary";
import { buildAgentProviderTemplateText, buildJsonRpcExamples, buildMcpServerConfigJson } from "./settings/settings-code-snippets";
import { SettingsShell } from "./settings/components/SettingsShell";
import { type SettingsCodeTab } from "./settings/components/SettingsCodeTabs";
import { type SettingsStatusPanelState } from "./settings/components/SettingsStatusPanel";
import { SettingsStickyStatusBar } from "./settings/components/SettingsStickyStatusBar";
import { type SettingsTabId } from "./settings/settings-field-catalog";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  DEFAULT_SETTINGS,
  DiagnosticsExportPayload,
  formatBytes,
  getInitialNavigationFromUrl,
  hasSettingsTab,
  LaunchAtLoginPayload,
  localizeBackendMessage,
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
  type DataStatsPayload,
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
  const [dangerConfirmation, setDangerConfirmation] = useState<"cleanupLogs" | "cleanupData" | "resetAccessibility" | null>(null);
  const [logActionStatus, setLogActionStatus] = useState<{ message: string; state: SettingsStatusPanelState }>({
    message: "",
    state: "neutral",
  });
  const [dataActionStatus, setDataActionStatus] = useState<{ message: string; state: SettingsStatusPanelState }>({
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
    dataStats: null,
    update: null,
    buildInfo: null,
  });
  const locale = resolveAppLocale(state.settings.language);
  const tr = (key: Parameters<typeof t>[1], params?: Record<string, string | number>) => t(locale, key, params);
  const formatSettingsError = (error: unknown) => formatCommandError(tr, error);

  useEffect(() => {
    void (async () => {
      try {
        const [settingsDocument, configPath, databasePath, accessibility, accessibilityDiagnostics, panel, launchAtLogin, mcp, logStats, dataStats, buildInfo] = await Promise.all([
          settingsService.get(true),
          invoke<string>("get_clipforge_config_path"),
          invoke<string>("get_clipforge_database_path"),
          invoke<AccessibilityPermissionPayload>("check_accessibility_permission"),
          invoke<AccessibilityDiagnosticsPayload>("get_accessibility_diagnostics"),
          invoke<PanelTriggerPayload>("get_panel_trigger_status"),
          invoke<LaunchAtLoginPayload>("get_launch_at_login"),
          invoke<McpStatusPayload>("get_mcp_status"),
          invoke<LogStatsPayload>("get_log_stats"),
          invoke<DataStatsPayload>("get_clipforge_data_stats"),
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
          dataStats,
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
        recordNextFramePerf("settings.changed", { changedPaths: event.changedPaths?.length ?? 0 });
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
        logSettingsEvent("settings.changed", {
          changedPaths: normalizedNext ? Object.keys(normalizedNext).length : 0,
          revision: result.revision,
        });
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

  // ===== 数据存储统计/清理/打开（data tab）=====
  /** 重新统计数据占用；轻量只读 command，失败在面板内提示。 */
  async function refreshDataStats() {
    try {
      const stats = await invoke<DataStatsPayload>("get_clipforge_data_stats");
      setState((prev) => ({ ...prev, dataStats: stats }));
      setDataActionStatus({ message: tr("settings.data.statsRefreshed"), state: "good" });
    } catch (error) {
      setDataActionStatus({ message: formatSettingsError(error), state: "danger" });
    }
  }

  /** 立即执行一次清理：清空过期回收站并按「保留条数上限」截断历史，完成后刷新统计。 */
  async function cleanupDataNow() {
    setDangerConfirmation(null);
    setDataActionStatus({ message: tr("settings.data.cleaning"), state: "pending" });
    setState((prev) => ({ ...prev, status: tr("settings.data.cleaning") }));
    try {
      const result = await invoke<{ hardDeleted: number; retentionHardDeleted: number; overflowHardDeleted: number }>(
        "cleanup_clip_records",
        { retentionDays: state.settings.softDeletedRetentionDays, maxActiveItems: state.settings.maxStoredItems },
      );
      await refreshDataStats();
      const message = tr("settings.data.cleaned", {
        count: result.hardDeleted,
        retention: result.retentionHardDeleted,
        overflow: result.overflowHardDeleted,
      });
      setDataActionStatus({ message, state: "good" });
      setState((prev) => ({ ...prev, status: message }));
    } catch (error) {
      const message = formatSettingsError(error);
      setDataActionStatus({ message, state: "danger" });
      setState((prev) => ({ ...prev, status: message }));
    }
  }

  /** 在系统文件管理器中显示数据库文件（macOS=Finder 中的 ClipForge 数据目录）。 */
  async function revealDataFolder() {
    try {
      await revealItemInDir(state.databasePath);
    } catch (error) {
      setDataActionStatus({ message: formatSettingsError(error), state: "danger" });
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
        status: localizeBackendMessage(accessibilityDiagnostics.message, tr),
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
        status: localizeBackendMessage(accessibilityDiagnostics.message, tr),
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
        status: localizeBackendMessage(launchAtLogin.message, tr),
      }));
      updateSettings({ launchAtLogin: enabled });
    } catch (error) {
      setState((prev) => ({ ...prev, status: formatSettingsError(error) }));
    }
  }

  async function refreshPanelStatus() {
    try {
      const panel = await invoke<PanelTriggerPayload>("get_panel_trigger_status");
      setState((prev) => ({ ...prev, panel, status: localizeBackendMessage(panel.message, tr) }));
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

  function getAgentInstallPrompt() {
    return [
      tr("settings.manual.installPrompt.line1"),
      tr("settings.manual.installPrompt.line2"),
      getMcpCommand(),
      tr("settings.manual.installPrompt.line3"),
    ].join("\n");
  }

  // 统一复制出口:所有代码 tab 与模板复制都走这里,差异只在成功文案 key。
  async function copyToClipboard(label: string, content: string, statusKey: Parameters<typeof tr>[0] = "settings.status.copied") {
    try {
      await navigator.clipboard.writeText(content);
      setState((prev) => ({ ...prev, status: tr(statusKey, { label }) }));
    } catch (error) {
      setState((prev) => ({ ...prev, status: formatSettingsError(error) }));
    }
  }

  // 更新流程四动作表驱动:check/download/install/ignore 只有 pending 文案、命令与
  // 成功分支不同;ignore 特殊:前置校验 availableVersion,成功文案带版本号参数。
  async function runUpdateAction(
    action: "check" | "download" | "install" | "ignore",
  ) {
    const version = state.update?.availableVersion;
    if (action === "ignore" && !version) return;
    const command = { check: "check_update", download: "download_update", install: "install_update", ignore: "ignore_update_version" }[action];
    setState((prev) => {
      const patch: Partial<UpdateCheckState> =
        action === "check"
          ? { status: "checking" }
          : action === "download"
            ? { status: "downloading", downloadProgress: 0 }
            : {};
      return {
        ...prev,
        update: prev.update ? { ...prev.update, ...patch } : prev.update,
        status:
          action === "ignore" && version
            ? tr("settings.update.status.installing")
            : tr(`settings.update.status.${action === "check" ? "checking" : action === "download" ? "downloading" : "installing"}` as const),
      };
    });
    try {
      const update = await invoke<UpdateCheckState>(command, action === "ignore" ? { version } : undefined);
      const successStatus =
        action === "ignore" && version
          ? tr("settings.update.status.ignored", { version })
          : update.status === "failed"
            ? tr("settings.update.status.failed")
            : action === "check"
              ? tr("settings.update.status.refreshed")
              : action === "download"
                ? tr("settings.update.status.ready")
                : tr("settings.update.status.installing");
      setState((prev) => ({ ...prev, update, status: successStatus }));
    } catch (error) {
      setState((prev) => ({ ...prev, status: formatSettingsError(error) }));
    }
  }
  const checkUpdateNow = () => runUpdateAction("check");
  const downloadUpdateNow = () => runUpdateAction("download");
  const installUpdateNow = () => runUpdateAction("install");
  const ignoreCurrentUpdate = () => runUpdateAction("ignore");

  // 更新状态文案:普通状态查表,available 需版本号参数,idle 兜底。
  const updateStatusCopy = (() => {
    const status = state.update?.status ?? "idle";
    if (status === "available") {
      return tr("settings.update.status.available", { version: state.update?.availableVersion ?? "" });
    }
    if (status === "idle") {
      return tr("settings.update.status.idle");
    }
    return tr(`settings.update.status.${status}` as const);
  })();
  const mcpCommand = getMcpCommand();
  const agentInstallPrompt = getAgentInstallPrompt();
  const mcpServerConfigJson = buildMcpServerConfigJson(mcpCommand);
  const jsonRpcExamples = buildJsonRpcExamples();
  const mcpAgentCodeTabs: SettingsCodeTab[] = [
    { value: "mcp-servers", label: tr("settings.mcp.serverConfig"), language: "json", content: mcpServerConfigJson },
    { value: "install", label: tr("settings.mcp.agentInstallPrompt"), language: "text", content: agentInstallPrompt },
    { value: "command", label: tr("settings.mcp.command"), language: "bash", content: mcpCommand },
    { value: "json-rpc", label: tr("settings.mcp.jsonRpc"), language: "json", content: jsonRpcExamples },
    { value: "provider", label: tr("settings.agent.providerTemplate"), language: "json", content: buildAgentProviderTemplateText() },
  ];
  function copyMcpAgentCodeTab(tab: SettingsCodeTab) {
    if (tab.value === "install") {
      void copyToClipboard(tab.label, getAgentInstallPrompt(), "settings.manual.installPromptCopied");
      return;
    }
    if (tab.value === "provider") {
      void copyToClipboard(tab.label, buildAgentProviderTemplateText(), "settings.agent.providerTemplateCopied");
      return;
    }
    void copyToClipboard(tab.label, tab.content);
  }
  const activeSection = SECTIONS.find((item) => item.key === section) ?? SECTIONS[0];
  // configStatus 降级为 transient 提示:写入/加载成功后 2.5s 自动清除。旧行为是它在
  // stickyStatusPrimary 兜底链里永久常驻,停在内容区左下角像一张不消失的 toast
  // (用户截图反馈丑陋)。清除后主位回落当前 section 名;失败态由 status/
  // saveFeedback 承担,不依赖 configStatus。
  const configStatusClearTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!state.configStatus) return;
    if (configStatusClearTimer.current) window.clearTimeout(configStatusClearTimer.current);
    configStatusClearTimer.current = window.setTimeout(() => {
      setState((prev) => (prev.configStatus ? { ...prev, configStatus: "" } : prev));
    }, 2500);
    return () => {
      if (configStatusClearTimer.current) window.clearTimeout(configStatusClearTimer.current);
    };
  }, [state.configStatus]);
  // 底部常驻信息栏数据:版本 + 渠道 + 更新状态徽标(替代原来只有一行版本号,
  // 用户要求「单独区域常驻显示状态/版本信息」)。徽标 detail 供悬停查看
  // 最近检查时间与错误码/错误信息。数据全部来自 state.update(Rust 权威)。
  const updateBadge = (() => {
    const update = state.update;
    if (!update) {
      return { tone: "idle" as const, label: tr("settings.update.badge.unknown"), detail: "" };
    }
    const checkedAt = update.lastCheckedAt ? new Date(update.lastCheckedAt).toLocaleString() : "";
    if (update.status === "checking") {
      return { tone: "checking" as const, label: tr("settings.update.badge.checking"), detail: checkedAt };
    }
    if (update.status === "failed") {
      const detail = [checkedAt, update.errorCode, update.errorMessage].filter(Boolean).join(" · ");
      return { tone: "error" as const, label: tr("settings.update.badge.failed"), detail };
    }
    if (update.availableVersion) {
      const detail = [checkedAt, `${update.currentVersion} → ${update.availableVersion}`].filter(Boolean).join(" · ");
      return { tone: "available" as const, label: tr("settings.update.badge.available"), detail };
    }
    return { tone: "ok" as const, label: tr("settings.update.badge.upToDate"), detail: checkedAt };
  })();
  const versionMeta = state.update?.channel ?? "stable";
  const stickyStatusPrimary =
    state.status || state.saveFeedback.message || state.configStatus || tr(activeSection.labelKey);
  // 次要位只展示与主位不同的保存反馈，避免左右两列渲染同一句状态。
  const stickyStatusSecondary =
    state.saveFeedback.state !== "idle" && state.saveFeedback.message !== stickyStatusPrimary
      ? state.saveFeedback.message
      : "";
  function renderSectionTabs(panels: Partial<Record<SettingsTabId, ReactNode>>) {
    const sectionTabs = [...activeSection.tabs] as SettingsTabId[];
    const tabs = sectionTabs.filter((tab) => panels[tab]);
    const defaultValue =
      initialNavigation.current.section === section && hasSettingsTab(tabs, initialNavigation.current.tab)
        ? initialNavigation.current.tab
        : tabs[0];
    if (!defaultValue) return null;
    return (
      <Tabs className="grid w-full min-w-0 max-w-[820px] content-start gap-3" data-dev-probe={`settings-section-tabs:${section}`} defaultValue={defaultValue} key={section}>
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
          <TabsContent className="min-w-0 outline-none" key={tab} value={tab}>
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
        exportLabel={tr("settings.action.exportData")}
        items={SECTIONS.map((item) => ({
          id: item.key,
          label: tr(item.labelKey),
          icon: item.icon,
        }))}
        resetLabel={tr("settings.action.resetDefaults")}
        onSelect={(nextSection) => {
          const typedSection = nextSection as SectionKey;
          recordNextFramePerf("settings.section", { section: typedSection });
          setDangerConfirmation(null);
          setSection(typedSection);
        }}
        version={`ClipForge v${state.update?.currentVersion ?? "0.1.0"}`}
        versionMeta={versionMeta}
        updateBadge={updateBadge}
        statusBar={
          <SettingsStickyStatusBar
            primary={stickyStatusPrimary}
            secondary={stickyStatusSecondary}
            state={state.saveFeedback.state}
          />
        }
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
              panel={state.panel}
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
              agentProviders={state.settings.agent?.providers ?? state.settings.agentProviders ?? []}
              copyMcpAgentCodeTab={copyMcpAgentCodeTab}
              getConfiguredAgentProviderCount={getConfiguredAgentProviderCount}
              mcpAgentCodeTabs={mcpAgentCodeTabs}
              updateSettings={updateSettings}
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
              copySettingsSnippet={copyToClipboard}
              databasePath={state.databasePath}
              dangerConfirmation={dangerConfirmation}
              formatBytes={formatBytes}
              logActionStatus={logActionStatus}
              logStats={state.logStats}
              refreshLogStats={refreshLogStats}
              renderTabs={renderSectionTabs}
              setDangerConfirmation={(v) => setDangerConfirmation(v as "cleanupLogs" | "cleanupData" | null)}
              settings={state.settings}
              tr={tr}
              updateSettings={updateSettings}
              cleanupLogsNow={cleanupLogsNow}
              exportDiagnosticsBundle={exportDiagnosticsBundle}
              dataStats={state.dataStats}
              dataActionStatus={dataActionStatus}
              refreshDataStats={refreshDataStats}
              cleanupDataNow={cleanupDataNow}
              revealDataFolder={revealDataFolder}
            />
          )}
      </SettingsShell>
    </TooltipProvider>
  );
}
