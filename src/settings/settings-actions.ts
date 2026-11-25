// Settings 页动作切片(codebase-modularity-refactor 还债):
// 把 data/log/cleanup/update/accessibility/MCP 等写路径动作从 settings.tsx 整组平移到本 hook。
// 纪律:外部服务(Tauri invoke/settingsService 写入/窗口标题/揭示文件)通过 SettingsActionsContext 注入,
// 内部工具(settings-log、settings-model)与浏览器 API(navigator.clipboard)直接使用;
// 宿主(settings.tsx)只负责装配;行为零变化,函数每次渲染重建(与原内联函数闭包语义一致)。
import { type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { setDocumentLocale, t, resolveAppLocale, normalizeLanguagePreference, type AppLocale } from "../i18n";
import { type SettingsStatusPanelState } from "./components/SettingsStatusPanel";
import { logSettingsEvent } from "./settings-log";
import {
  localizeBackendMessage,
  type AccessibilityDiagnosticsPayload,
  type AccessibilityPermissionPayload,
  type DataStatsPayload,
  type DiagnosticsExportPayload,
  type LaunchAtLoginPayload,
  type LogStatsPayload,
  type PanelTriggerPayload,
  type SettingsAppState,
  type UpdateCheckState,
  normalizeAppSettings,
} from "./settings-model";

/** settings 保存补丁返回形状,与 settingsService.patch 的 resolve 值同构。 */
export interface SettingsPatchResult {
  settings: unknown;
  revision: string;
  durationMs?: number;
}

type Translator = (key: Parameters<typeof t>[1], params?: Record<string, string | number>) => string;

/** 外部能力与宿主状态注入面:唯一入口,新增能力必须从这里进,禁止在模块内 import 外部服务。 */
export interface SettingsActionsContext {
  state: SettingsAppState;
  locale: AppLocale;
  setState: Dispatch<SetStateAction<SettingsAppState>>;
  tr: Translator;
  formatSettingsError: (error: unknown) => string;
  saveRequestSeq: MutableRefObject<number>;
  lastSettingsRevision: MutableRefObject<string | null>;
  setDangerConfirmation: Dispatch<SetStateAction<"cleanupLogs" | "cleanupData" | "resetAccessibility" | null>>;
  setLogActionStatus: Dispatch<SetStateAction<{ message: string; state: SettingsStatusPanelState }>>;
  setDataActionStatus: Dispatch<SetStateAction<{ message: string; state: SettingsStatusPanelState }>>;
  /** invoke 透传(宿主传 @tauri-apps/api/core 的 invoke)。 */
  invokeFn: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
  /** settingsService.patch 包装:宿主固定 actor/reason。 */
  patchSettings: (patch: Record<string, unknown>) => Promise<SettingsPatchResult>;
  revealItem: (path: string) => Promise<void>;
  frontendEnvSnapshot: () => unknown;
  setWindowTitle: (title: string) => void;
}

export function useSettingsActions(ctx: SettingsActionsContext) {
  const { state, setState, tr, formatSettingsError, saveRequestSeq, lastSettingsRevision } = ctx;

  function updateSettings(next: Partial<SettingsAppState["settings"]>) {
    const normalizedNext = {
      ...next,
      ...(next.language ? { language: normalizeLanguagePreference(next.language) } : {}),
    };
    const requestId = saveRequestSeq.current + 1;
    saveRequestSeq.current = requestId;
    const feedbackLocale = normalizedNext.language ? resolveAppLocale(normalizedNext.language) : ctx.locale;
    if (normalizedNext.language) {
      setDocumentLocale(feedbackLocale);
      ctx.setWindowTitle(t(feedbackLocale, "window.settings.title"));
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
    ctx
      .patchSettings(normalizedNext as Record<string, unknown>)
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
          settings: normalizeAppSettings(result.settings as SettingsAppState["settings"]),
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
    ctx.setDangerConfirmation(null);
    try {
      const stats = await ctx.invokeFn<LogStatsPayload>("get_log_stats");
      setState((prev) => ({ ...prev, logStats: stats }));
      ctx.setLogActionStatus({ message: tr("settings.diagnostics.logStatsRefreshed"), state: "good" });
    } catch (error) {
      const message = formatSettingsError(error);
      ctx.setLogActionStatus({ message, state: "danger" });
      setState((prev) => ({ ...prev, status: message }));
    }
  }

  // ===== 数据存储统计/清理/打开(data tab)=====
  /** 重新统计数据占用;轻量只读 command,失败在面板内提示。 */
  async function refreshDataStats() {
    try {
      const stats = await ctx.invokeFn<DataStatsPayload>("get_clipforge_data_stats");
      setState((prev) => ({ ...prev, dataStats: stats }));
      ctx.setDataActionStatus({ message: tr("settings.data.statsRefreshed"), state: "good" });
    } catch (error) {
      ctx.setDataActionStatus({ message: formatSettingsError(error), state: "danger" });
    }
  }

  /** 立即执行一次清理:硬删过期回收站,并把超出「历史数量上限」的最旧历史移入回收站,完成后刷新统计。 */
  async function cleanupDataNow() {
    ctx.setDangerConfirmation(null);
    ctx.setDataActionStatus({ message: tr("settings.data.cleaning"), state: "pending" });
    setState((prev) => ({ ...prev, status: tr("settings.data.cleaning") }));
    try {
      const result = await ctx.invokeFn<{ hardDeleted: number; overflowSoftDeleted: number }>(
        "cleanup_clip_records",
        { retentionDays: state.settings.softDeletedRetentionDays, maxActiveItems: state.settings.maxStoredItems },
      );
      await refreshDataStats();
      const message = tr("settings.data.cleaned", {
        hardDeleted: result.hardDeleted,
        trashed: result.overflowSoftDeleted,
      });
      ctx.setDataActionStatus({ message, state: "good" });
      setState((prev) => ({ ...prev, status: message }));
    } catch (error) {
      const message = formatSettingsError(error);
      ctx.setDataActionStatus({ message, state: "danger" });
      setState((prev) => ({ ...prev, status: message }));
    }
  }

  /** 在系统文件管理器中显示数据库文件(macOS=Finder 中的 ClipForge 数据目录)。 */
  async function revealDataFolder() {
    try {
      await ctx.revealItem(state.databasePath);
    } catch (error) {
      ctx.setDataActionStatus({ message: formatSettingsError(error), state: "danger" });
    }
  }

  async function cleanupLogsNow() {
    ctx.setDangerConfirmation(null);
    ctx.setLogActionStatus({ message: tr("settings.diagnostics.cleaning"), state: "pending" });
    setState((prev) => ({ ...prev, status: tr("settings.diagnostics.cleaning") }));
    try {
      const result = await ctx.invokeFn<string>("cleanup_app_logs");
      await refreshLogStats();
      ctx.setLogActionStatus({ message: result, state: "good" });
      setState((prev) => ({ ...prev, status: result }));
    } catch (error) {
      const message = formatSettingsError(error);
      ctx.setLogActionStatus({ message, state: "danger" });
      setState((prev) => ({ ...prev, status: message }));
    }
  }

  async function exportDiagnosticsBundle() {
    ctx.setDangerConfirmation(null);
    ctx.setLogActionStatus({ message: tr("settings.diagnostics.exporting"), state: "pending" });
    setState((prev) => ({ ...prev, status: tr("settings.diagnostics.exporting") }));
    try {
      const result = await ctx.invokeFn<DiagnosticsExportPayload>("export_diagnostics_bundle", {
        frontend: ctx.frontendEnvSnapshot(),
      });
      await refreshLogStats();
      const message = tr("settings.diagnostics.exportedPath", { summary: result.summary, path: result.path });
      ctx.setLogActionStatus({ message, state: "good" });
      setState((prev) => ({
        ...prev,
        status: message,
      }));
    } catch (error) {
      const message = formatSettingsError(error);
      ctx.setLogActionStatus({ message, state: "danger" });
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
    ctx.setDangerConfirmation(null);
    try {
      const [accessibility, accessibilityDiagnostics] = await Promise.all([
        ctx.invokeFn<AccessibilityPermissionPayload>("check_accessibility_permission"),
        ctx.invokeFn<AccessibilityDiagnosticsPayload>("get_accessibility_diagnostics"),
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
    ctx.setDangerConfirmation(null);
    try {
      await ctx.invokeFn("open_accessibility_settings");
      const [accessibility, accessibilityDiagnostics] = await Promise.all([
        ctx.invokeFn<AccessibilityPermissionPayload>("check_accessibility_permission"),
        ctx.invokeFn<AccessibilityDiagnosticsPayload>("get_accessibility_diagnostics"),
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
    ctx.setDangerConfirmation(null);
    try {
      const accessibility = await ctx.invokeFn<AccessibilityPermissionPayload>("reset_accessibility_permission");
      const accessibilityDiagnostics = await ctx.invokeFn<AccessibilityDiagnosticsPayload>("get_accessibility_diagnostics");
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
      const launchAtLogin = await ctx.invokeFn<LaunchAtLoginPayload>("set_launch_at_login", { enabled });
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
      const panel = await ctx.invokeFn<PanelTriggerPayload>("get_panel_trigger_status");
      setState((prev) => ({ ...prev, panel, status: localizeBackendMessage(panel.message, tr) }));
    } catch (error) {
      setState((prev) => ({ ...prev, status: formatSettingsError(error) }));
    }
  }

  async function testFloatingPanel() {
    try {
      const panel = await ctx.invokeFn<PanelTriggerPayload>("show_quick_panel_command", { source: "settings-test" });
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
      const update = await ctx.invokeFn<UpdateCheckState>(command, action === "ignore" ? { version } : undefined);
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

  return {
    updateSettings,
    refreshLogStats,
    refreshDataStats,
    cleanupDataNow,
    revealDataFolder,
    cleanupLogsNow,
    exportDiagnosticsBundle,
    addTagRule,
    updateTagRule,
    deleteTagRule,
    refreshAccessibilityStatus,
    openAccessibilitySettings,
    resetAccessibilityPermission,
    setLaunchAtLoginEnabled,
    refreshPanelStatus,
    testFloatingPanel,
    getMcpCommand,
    getConfiguredAgentProviderCount,
    getAgentInstallPrompt,
    copyToClipboard,
    checkUpdateNow,
    downloadUpdateNow,
    installUpdateNow,
    ignoreCurrentUpdate,
  };
}
