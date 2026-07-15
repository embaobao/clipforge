import { useEffect, useRef, useState } from "react";
import { settingsService } from "./services/settings";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  BookOpen,
  Copy,
  Database,
  ExternalLink,
  Eye,
  FileDown,
  FileCode,
  FileImage,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Settings,
  Tag,
  Terminal,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { getFrontendEnvironmentSnapshot } from "./frontend-diagnostics";
import {
  formatCommandError,
  normalizeLanguagePreference,
  resolveAppLocale,
  setDocumentLocale,
  t,
  type AppLanguagePreference,
} from "./i18n";
import {
  Tabs,
  TabsContent,
  TabsContents,
  TabsList,
  TabsTrigger,
} from "./components/animate-ui/components/animate/tabs";

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

const tagModeLabels: Record<AppSettings["tagMode"], string> = {
  similar: "仅类型",
  rules: "类型 + 自定义搜索",
  off: "关闭",
};

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
  status: string;
  logStats: LogStatsPayload | null;
  update: UpdateCheckState | null;
  buildInfo: BuildInfoPayload | null;
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

function SettingGroup({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <div className="setting-group">
      <h3>{title}</h3>
      <div className="setting-group-body">{children}</div>
    </div>
  );
}

function SegmentSetting<T extends string>({
  label,
  options,
  selected,
  onChange,
}: {
  label?: string;
  options: Array<{ value: T; label: string }>;
  selected: T;
  onChange: (value: T) => void;
}) {
  // 键盘方向键在组内循环切换（design：Toggle Group 键盘方向键可切换）+ roving tabindex
  // （只有当前选中项 tabIndex=0，符合 radiogroup 焦点模式）。DOM 与类名不变，零视觉回归。
  const selectByOffset = (offset: number) => {
    const currentIndex = options.findIndex((option) => option.value === selected);
    if (currentIndex < 0) return;
    const nextIndex = (currentIndex + offset + options.length) % options.length;
    onChange(options[nextIndex].value);
  };
  return (
    <div
      aria-label={label}
      className="setting-toggle-group"
      role="radiogroup"
      onKeyDown={(event) => {
        if (event.key === "ArrowRight" || event.key === "ArrowDown") {
          event.preventDefault();
          selectByOffset(1);
        } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
          event.preventDefault();
          selectByOffset(-1);
        }
      }}
    >
      {options.map((option) => {
        const isActive = selected === option.value;
        return (
          <button
            className={isActive ? "active" : ""}
            aria-checked={isActive}
            key={option.value}
            onClick={() => onChange(option.value)}
            role="radio"
            tabIndex={isActive ? 0 : -1}
            type="button"
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function CodeTabsSetting({
  tabs,
  onCopy,
}: {
  tabs: Array<{ value: string; label: string; language: string; content: string }>;
  onCopy: (label: string, content: string) => void;
}) {
  const defaultValue = tabs[0]?.value ?? "";

  return (
    <Tabs className="settings-code-tabs" defaultValue={defaultValue}>
      <TabsList className="settings-code-tabs-list">
        {tabs.map((tab) => (
          <TabsTrigger className="settings-code-tabs-trigger" key={tab.value} value={tab.value}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContents className="settings-code-tabs-contents">
        {tabs.map((tab) => (
          <TabsContent className="settings-code-tab-panel" key={tab.value} value={tab.value}>
            <div className="settings-code-tab-toolbar">
              <span>{tab.language}</span>
              <button className="secondary-button" onClick={() => onCopy(tab.label, tab.content)} type="button">
                <Copy size={13} />
                复制
              </button>
            </div>
            <pre>{tab.content}</pre>
          </TabsContent>
        ))}
      </TabsContents>
    </Tabs>
  );
}

function NumberSetting({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="setting-row">
      <span>{label}</span>
      <input
        max={max}
        min={min}
        onChange={(event) => {
          const next = Number(event.currentTarget.value);
          if (Number.isFinite(next)) onChange(next);
        }}
        type="number"
        value={value}
      />
    </div>
  );
}

function SliderSetting({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="setting-row">
      <span>{label}</span>
      <div className="slider-setting">
        <input
          max={max}
          min={min}
          step={step ?? 1}
          type="range"
          value={value}
          onChange={(event) => {
            const next = Number(event.currentTarget.value);
            if (Number.isFinite(next)) onChange(next);
          }}
        />
        <span>
          {value}
          {suffix}
        </span>
      </div>
    </div>
  );
}

function ToggleSetting({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="setting-row">
      <span>{label}</span>
      <button
        className={checked ? "toggle-button active" : "toggle-button"}
        onClick={() => onChange(!checked)}
        type="button"
      >
        <span />
      </button>
    </div>
  );
}

function CheckItem({ body, icon, title }: { body: string; icon: React.ReactNode; title: string }) {
  return (
    <div className="check-item">
      <span className="check-item-icon">{icon}</span>
      <div>
        <strong>{title}</strong>
        <p>{body}</p>
      </div>
    </div>
  );
}

const SECTIONS = [
  { key: "shortcut", labelKey: "settings.section.shortcut", icon: Terminal },
  { key: "display", labelKey: "settings.section.display", icon: Eye },
  { key: "integration", labelKey: "settings.section.integration", icon: Terminal },
  { key: "manual", labelKey: "settings.section.manual", icon: BookOpen },
  { key: "content", labelKey: "settings.section.content", icon: FileCode },
  { key: "capture", labelKey: "settings.section.capture", icon: FileImage },
  { key: "storage", labelKey: "settings.section.storage", icon: Database },
  { key: "update", labelKey: "settings.section.update", icon: UploadCloud },
  { key: "tags", labelKey: "settings.section.tags", icon: Tag },
] as const;

type SectionKey = (typeof SECTIONS)[number]["key"];

export function SettingsApp() {
  const [section, setSection] = useState<SectionKey>("shortcut");
  const [recording, setRecording] = useState(false);
  const [state, setState] = useState<SettingsAppState>({
    accessibility: null,
    accessibilityDiagnostics: null,
    configPath: "",
    configStatus: "加载中…",
    databasePath: "",
    mcp: null,
    panel: null,
    settings: DEFAULT_SETTINGS,
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
        const [settings, configPath, databasePath, accessibility, accessibilityDiagnostics, panel, mcp, logStats, update, buildInfo] = await Promise.all([
          invoke<AppSettings>("get_clipforge_settings"),
          invoke<string>("get_clipforge_config_path"),
          invoke<string>("get_clipforge_database_path"),
          invoke<AccessibilityPermissionPayload>("check_accessibility_permission"),
          invoke<AccessibilityDiagnosticsPayload>("get_accessibility_diagnostics"),
          invoke<PanelTriggerPayload>("get_panel_trigger_status"),
          invoke<McpStatusPayload>("get_mcp_status"),
          invoke<LogStatsPayload>("get_log_stats"),
          safeInvokeUpdateCheck(),
          invoke<BuildInfoPayload>("get_build_info"),
        ]);
        const mergedSettings = {
          ...DEFAULT_SETTINGS,
          ...settings,
          language: normalizeLanguagePreference((settings as Partial<AppSettings>).language),
        };
        const locale = resolveAppLocale(mergedSettings.language);
        setDocumentLocale(locale);
        void getCurrentWindow().setTitle(t(locale, "window.settings.title"));
        setState({
          accessibility,
          accessibilityDiagnostics,
          configPath,
          configStatus: "配置已同步到 JSON5",
          databasePath,
          mcp,
          panel,
          settings: mergedSettings,
          logStats,
          update,
          buildInfo,
          status: "",
        });
      } catch (error) {
        setState((prev) => ({
          ...prev,
          configStatus: "加载失败：使用本地兜底",
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
        lastSettingsRevision.current = event.revision;
        invoke<AppSettings>("get_clipforge_settings")
          .then((next) => {
            if (!active) return;
            setState((prev) => ({ ...prev, settings: next }));
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
    if (normalizedNext.language) {
      const locale = resolveAppLocale(normalizedNext.language);
      setDocumentLocale(locale);
      void getCurrentWindow().setTitle(t(locale, "window.settings.title"));
    }
    setState((prev) => ({ ...prev, settings: { ...prev.settings, ...normalizedNext } }));
    invoke("update_clipforge_settings", { input: normalizedNext }).catch((error) =>
      setState((prev) => ({ ...prev, status: formatSettingsError(error) })),
    );
  }

  async function refreshLogStats() {
    try {
      const stats = await invoke<LogStatsPayload>("get_log_stats");
      setState((prev) => ({ ...prev, logStats: stats }));
    } catch (error) {
      setState((prev) => ({ ...prev, status: formatSettingsError(error) }));
    }
  }

  async function cleanupLogsNow() {
    setState((prev) => ({ ...prev, status: "正在清理日志…" }));
    try {
      const result = await invoke<string>("cleanup_app_logs");
      await refreshLogStats();
      setState((prev) => ({ ...prev, status: result }));
    } catch (error) {
      setState((prev) => ({ ...prev, status: formatSettingsError(error) }));
    }
  }

  async function exportDiagnosticsBundle() {
    setState((prev) => ({ ...prev, status: "正在导出排查包…" }));
    try {
      const result = await invoke<DiagnosticsExportPayload>("export_diagnostics_bundle", {
        frontend: getFrontendEnvironmentSnapshot(),
      });
      await refreshLogStats();
      setState((prev) => ({
        ...prev,
        status: `${result.summary} 路径：${result.path}`,
      }));
    } catch (error) {
      setState((prev) => ({ ...prev, status: formatSettingsError(error) }));
    }
  }

  function addTagRule() {
    const newRule = { id: `r-${Date.now()}`, label: "新规则", query: "" };
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
      setState((prev) => ({ ...prev, panel, status: `悬浮检测：${panel.positionSource}` }));
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
      "请帮我安装 ClipForge MCP 接入。",
      "使用 stdio transport，server command 如下：",
      getMcpCommand(),
      "安装后优先使用 clipf.list / clipf.get / clipf.copy / clipf.search 工具读取和操作剪贴板。",
    ].join("\n");
  }

  async function copySettingsSnippet(label: string, content: string) {
    try {
      await navigator.clipboard.writeText(content);
      setState((prev) => ({ ...prev, status: `${label} 已复制` }));
    } catch (error) {
      setState((prev) => ({ ...prev, status: formatSettingsError(error) }));
    }
  }

  async function copyAgentProviderTemplate() {
    try {
      await navigator.clipboard.writeText(getAgentProviderTemplateText());
      setState((prev) => ({ ...prev, status: "Agent provider JSON 模板已复制，可粘贴到设置文件后按需改名。" }));
    } catch (error) {
      setState((prev) => ({ ...prev, status: formatSettingsError(error) }));
    }
  }

  async function copyMcpCommand(source: string) {
    const command = getAgentInstallPrompt();
    try {
      await navigator.clipboard.writeText(command);
      setState((prev) => ({ ...prev, status: `${source} MCP 安装提示已复制，发送给相关 Agent 即可接入` }));
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

  return (
    <div className="settings-window-shell">
      <header className="settings-window-header">
        <div className="settings-title">
          <Settings size={20} />
          <h1>设置</h1>
        </div>
        <p className="settings-subtitle">{state.configStatus}</p>
      </header>

      <div className="settings-window-body">
        <nav className="settings-window-sidebar" aria-label="设置分类">
          {SECTIONS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                className={section === item.key ? "active" : ""}
                key={item.key}
                onClick={() => setSection(item.key)}
                type="button"
              >
                <Icon size={15} />
                <span>{tr(item.labelKey)}</span>
              </button>
            );
          })}
        </nav>

        <main className="settings-window-content">
          {section === "shortcut" && (
            <SettingGroup title={tr("settings.section.shortcut")}>
              <div className="setting-row">
                <span>{tr("settings.language.current")}</span>
                <SegmentSetting
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
                <span>{tr("settings.shortcut.manual")}</span>
                <input
                  onChange={(event) =>
                    updateSettings({ globalShortcut: event.currentTarget.value })
                  }
                  value={state.settings.globalShortcut}
                />
              </div>
              <div className="setting-card permission-card">
                <span>{tr("settings.accessibility.title")}</span>
                <strong>
                  {state.accessibility?.canReadFocusedInput
                    ? tr("settings.accessibility.status.granted")
                    : tr("settings.accessibility.status.missing")}
                </strong>
                <p>
                  {state.accessibility?.message ??
                    tr("settings.accessibility.description")}
                </p>
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
                <div className="button-row">
                  <button className="secondary-button" onClick={openAccessibilitySettings} type="button">
                    <ShieldCheck size={13} />
                    {tr("settings.accessibility.action.request")}
                  </button>
                  <button className="secondary-button" onClick={refreshAccessibilityStatus} type="button">
                    <RefreshCw size={13} />
                    {tr("settings.accessibility.action.refresh")}
                  </button>
                  <button className="secondary-button" onClick={resetAccessibilityPermission} type="button">
                    <RotateCcw size={13} />
                    {tr("settings.accessibility.action.reset")}
                  </button>
                </div>
              </div>
            </SettingGroup>
          )}

          {section === "display" && (
            <SettingGroup title={tr("settings.section.display")}>
              <div className="setting-row">
                <span>{tr("settings.display.density")}</span>
                <SegmentSetting
                  options={(["dense", "normal", "comfortable"] as AppSettings["panelDensity"][]).map((v) => ({
                    value: v,
                    label: densityCopy[v],
                  }))}
                  selected={state.settings.panelDensity}
                  onChange={(panelDensity) => updateSettings({ panelDensity })}
                />
              </div>
              <div className="setting-row">
                <span>{tr("settings.display.contentMode")}</span>
                <SegmentSetting
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
                onChange={(quickItemLimit) => updateSettings({ quickItemLimit })}
              />
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
                onChange={(value) => updateSettings({ panelBackgroundOpacity: value / 100 })}
              />
              <ToggleSetting
                label={tr("settings.display.autoHideDock")}
                checked={state.settings.enableScrollCollapse}
                onChange={(enableScrollCollapse) => updateSettings({ enableScrollCollapse })}
              />
            </SettingGroup>
          )}

          {section === "integration" && (
            <SettingGroup title="悬浮触发与 MCP">
              <div className="setting-card permission-card">
                <span>悬浮窗触发检测</span>
                <strong>
                  {state.panel?.visible ? "窗口可见" : "窗口隐藏"} · {state.panel?.focused ? "已聚焦" : "未聚焦"}
                </strong>
                <p>
                  来源 {state.panel?.source ?? "-"}，定位 {state.panel?.positionSource ?? "-"}，
                  输入控件 {state.panel?.focusedInputSource || "未命中"}。
                </p>
                <p>
                  {state.panel
                    ? `x=${Math.round(state.panel.x)} y=${Math.round(state.panel.y)} ${Math.round(state.panel.width)}x${Math.round(state.panel.height)}`
                    : "尚未检测"}
                </p>
                <div className="button-row">
                  <button className="secondary-button" onClick={testFloatingPanel} type="button">
                    测试唤起
                  </button>
                  <button className="secondary-button" onClick={refreshPanelStatus} type="button">
                    刷新状态
                  </button>
                </div>
              </div>
              <div className="setting-card permission-card">
                <span>MCP Server</span>
                <strong>{state.mcp?.running ? "常驻运行中" : "常驻状态未确认"} · {state.mcp?.transport ?? "stdio"}</strong>
                <p>ClipForge 启动时自动托管 MCP 状态；这里不提供停止入口，避免测试用户误关常驻服务。</p>
                <div className="command-copy-row">
                  <button className="secondary-button" onClick={() => void copyMcpCommand("MCP")} type="button">
                    <Copy size={13} />
                    复制给 Agent 的安装提示
                  </button>
                </div>
                <p className="mcp-tool-list">{state.mcp?.tools.join(" / ") || "刷新后显示当前工具列表"}</p>
                <div className="button-row">
                  <button className="secondary-button" onClick={() => void refreshMcpStatus()} type="button">
                    <RefreshCw size={13} />
                    刷新
                  </button>
                </div>
              </div>
              <div className="setting-card permission-card">
                <span>Agent Provider JSON</span>
                <strong>{getConfiguredAgentProviderCount()} 个自定义 provider · CLI 与 OpenAI-compatible 分开配置</strong>
                <p>OpenAI-compatible、OpenAPI 兼容网关和本地 CLI 都写入 settings.json5；可以直接编辑名称、baseUrl、modelId、apiKeyEnv 或 command。</p>
                <div className="button-row">
                  <button className="secondary-button" onClick={() => void copyAgentProviderTemplate()} type="button">
                    <Copy size={13} />
                    复制 JSON 模板
                  </button>
                </div>
              </div>
            </SettingGroup>
          )}

          {section === "manual" && (
            <SettingGroup title="使用手册与 MCP 接入">
              <div className="setting-card permission-card mcp-doc-card">
                <span>Agent 快速接入</span>
                <strong>工具命名统一使用 clipf.*，不保留测试期旧别名。</strong>
                <p>应用启动时会自动托管 MCP 服务状态；外部 Agent / MCP Client 使用 stdio 命令接入。</p>
                <CodeTabsSetting
                  tabs={[
                    { value: "install", label: "安装提示", language: "text", content: agentInstallPrompt },
                    { value: "command", label: "MCP 命令", language: "bash", content: mcpCommand },
                    { value: "tools", label: "工具示例", language: "text", content: toolExamples },
                    { value: "json-rpc", label: "JSON-RPC", language: "json", content: jsonRpcExample },
                    { value: "provider", label: "Provider JSON", language: "json", content: getAgentProviderTemplateText() },
                  ]}
                  onCopy={(label, content) => void copySettingsSnippet(label, content)}
                />
                <p>成功返回固定包含 ok、traceId、tool、source、businessChain、permissionDecision、nextActions、result。</p>
                <p>失败返回 JSON-RPC error.data，包含 ok=false、traceId、hint、expected，方便 Agent 自动修正参数。</p>
              </div>
              <div className="setting-card permission-card mcp-doc-card">
                <span>当前工具</span>
                <p>{state.mcp?.tools.join(" / ") || "加载中…"}</p>
              </div>
            </SettingGroup>
          )}

          {section === "content" && (
            <SettingGroup title="内容识别">
              <div className="setting-row">
                <span>模糊搜索</span>
                <label className="switch">
                  <input
                    checked={state.settings.fuzzySearchEnabled}
                    onChange={(event) =>
                      updateSettings({ fuzzySearchEnabled: event.currentTarget.checked })
                    }
                    type="checkbox"
                  />
                  <span className="switch-track" />
                </label>
              </div>
              <div className="setting-row">
                <span>拼音英文搜索</span>
                <label className="switch">
                  <input
                    checked={state.settings.pinyinSearchEnabled}
                    onChange={(event) =>
                      updateSettings({ pinyinSearchEnabled: event.currentTarget.checked })
                    }
                    type="checkbox"
                  />
                  <span className="switch-track" />
                </label>
              </div>
              <div className="setting-row">
                <span>Markdown 详情预览</span>
                <label className="switch">
                  <input
                    checked={state.settings.enableMarkdownPreview}
                    onChange={(event) =>
                      updateSettings({ enableMarkdownPreview: event.currentTarget.checked })
                    }
                    type="checkbox"
                  />
                  <span className="switch-track" />
                </label>
              </div>
              <div className="check-grid">
                <CheckItem
                  icon={<ExternalLink size={15} />}
                  title="链接"
                  body="识别 GitHub / GitLab / 普通链接。"
                />
                <CheckItem
                  icon={<Terminal size={15} />}
                  title="命令"
                  body="识别 pnpm、cargo、git、curl 等命令。"
                />
                <CheckItem
                  icon={<Eye size={15} />}
                  title="Markdown"
                  body="详情面板预览，原文仍可复制。"
                />
                <CheckItem
                  icon={<FileCode size={15} />}
                  title="代码"
                  body="识别代码片段，保留等宽查看。"
                />
              </div>
            </SettingGroup>
          )}

          {section === "capture" && (
            <SettingGroup title="采集设置">
              <ToggleSetting
                checked={state.settings.captureTextEnabled}
                label="文本"
                onChange={(captureTextEnabled) => updateSettings({ captureTextEnabled })}
              />
              <ToggleSetting
                checked={state.settings.captureHtmlEnabled}
                label="HTML"
                onChange={(captureHtmlEnabled) => updateSettings({ captureHtmlEnabled })}
              />
              <ToggleSetting
                checked={state.settings.captureRtfEnabled}
                label="RTF"
                onChange={(captureRtfEnabled) => updateSettings({ captureRtfEnabled })}
              />
              <ToggleSetting
                checked={state.settings.captureImageEnabled}
                label="图片"
                onChange={(captureImageEnabled) => updateSettings({ captureImageEnabled })}
              />
              <ToggleSetting
                checked={state.settings.captureFileEnabled}
                label="文件"
                onChange={(captureFileEnabled) => updateSettings({ captureFileEnabled })}
              />
              <ToggleSetting
                checked={state.settings.captureSensitiveEnabled}
                label="敏感内容"
                onChange={(captureSensitiveEnabled) => updateSettings({ captureSensitiveEnabled })}
              />
              <NumberSetting
                label="图片上限 MB"
                max={1024}
                min={1}
                onChange={(imageMaxSizeMb) => updateSettings({ imageMaxSizeMb })}
                value={state.settings.imageMaxSizeMb}
              />
              <NumberSetting
                label="文本上限 MB"
                max={100}
                min={1}
                onChange={(textMaxSizeMb) => updateSettings({ textMaxSizeMb })}
                value={state.settings.textMaxSizeMb}
              />
              <div className="setting-card permission-card">
                <span>多类型模型</span>
                <strong>每条记录都保存格式、上下文和扩展 JSON。</strong>
                <p>当前字段已为图片、文件、HTML/RTF 与 AI 生成内容统一预留，不再走旧纯文本模型。</p>
              </div>
            </SettingGroup>
          )}

          {section === "storage" && (
            <>
            <SettingGroup title="数据存储">
              <div className="setting-row">
                <span>JSON5 配置文件</span>
                <strong className="path">{state.configPath || "加载中…"}</strong>
              </div>
              <div className="setting-row">
                <span>SQLite 永久数据库</span>
                <strong className="path">{state.databasePath || "加载中…"}</strong>
              </div>
              <NumberSetting
                label="最大存储条数"
                value={state.settings.maxStoredItems}
                min={50}
                max={5000}
                onChange={(maxStoredItems) => updateSettings({ maxStoredItems })}
              />
              <NumberSetting
                label="剪贴板检查间隔 ms"
                value={state.settings.clipboardPollMs}
                min={500}
                max={5000}
                onChange={(clipboardPollMs) => updateSettings({ clipboardPollMs })}
              />
              <div className="setting-row">
                <span>启用定期清理</span>
                <label className="switch">
                  <input
                    checked={state.settings.cleanupEnabled}
                    onChange={(event) =>
                      updateSettings({ cleanupEnabled: event.currentTarget.checked })
                    }
                    type="checkbox"
                  />
                  <span className="switch-track" />
                </label>
              </div>
              <NumberSetting
                label="清理间隔小时"
                value={state.settings.cleanupIntervalHours}
                min={1}
                max={720}
                onChange={(cleanupIntervalHours) => updateSettings({ cleanupIntervalHours })}
              />
              <NumberSetting
                label="软删除保留天数"
                value={state.settings.softDeletedRetentionDays}
                min={1}
                max={365}
                onChange={(softDeletedRetentionDays) =>
                  updateSettings({ softDeletedRetentionDays })
                }
              />
            </SettingGroup>

            <SettingGroup title="日志">
              <div className="setting-row">
                <span>日志文件</span>
                <strong className="path">
                  {state.logStats
                    ? `${state.logStats.path} · ${formatBytes(state.logStats.sizeBytes)} / ${state.logStats.lineCount} 行`
                    : "加载中…"}
                </strong>
              </div>
              <NumberSetting
                label="体积阈值 (MB)"
                value={state.settings.logMaxSizeMb}
                min={1}
                max={1024}
                onChange={(logMaxSizeMb) => updateSettings({ logMaxSizeMb })}
              />
              <NumberSetting
                label="超阈值保留比例 (%)"
                value={Math.round(state.settings.logKeepRatio * 100)}
                min={10}
                max={95}
                onChange={(percent) => updateSettings({ logKeepRatio: percent / 100 })}
              />
              <NumberSetting
                label="最大日志行数"
                value={state.settings.logMaxLines}
                min={1000}
                max={1000000}
                onChange={(logMaxLines) => updateSettings({ logMaxLines })}
              />
              <div className="setting-row">
                <span>分级保留策略</span>
                <strong>错误/警告 7 天 · 详情日志 3 天</strong>
              </div>
              <div className="setting-row">
                <span>自动周期清理</span>
                <label className="switch">
                  <input
                    checked={state.settings.logAutoCleanup}
                    onChange={(event) =>
                      updateSettings({ logAutoCleanup: event.currentTarget.checked })
                    }
                    type="checkbox"
                  />
                  <span className="switch-track" />
                </label>
              </div>
              <NumberSetting
                label="自动清理间隔 (分钟)"
                value={state.settings.logCleanupIntervalMin}
                min={1}
                max={1440}
                onChange={(logCleanupIntervalMin) =>
                  updateSettings({ logCleanupIntervalMin })
                }
              />
              <div className="setting-row">
                <span>手动清理</span>
                <div className="footer-actions" style={{ gap: 8 }}>
                  <button onClick={() => void exportDiagnosticsBundle()} type="button">
                    <FileDown size={13} />
                    导出排查包
                  </button>
                  <button onClick={() => void cleanupLogsNow()} type="button">
                    立即清理
                  </button>
                  <button onClick={() => void refreshLogStats()} type="button">
                    刷新
                  </button>
                </div>
              </div>
              {state.status ? (
                <div className="setting-row">
                  <span>结果</span>
                  <strong className="path">{state.status}</strong>
                </div>
              ) : null}
            </SettingGroup>
            </>
          )}

          {section === "update" && (
            <SettingGroup title={tr("settings.update.title")}>
              <div className="setting-card permission-card">
                <span>{tr("settings.update.currentVersion")}</span>
                <strong>{state.update?.currentVersion ?? "0.1.0"} · {state.update?.channel ?? "stable"}</strong>
                <p>{updateStatusCopy}</p>
                <div className="button-row">
                  <button className="secondary-button" onClick={() => void checkUpdateNow()} type="button">
                    <RefreshCw size={13} />
                    {tr("settings.update.action.check")}
                  </button>
                  <button
                    className="secondary-button"
                    disabled={state.update?.status !== "available"}
                    onClick={() => void downloadUpdateNow()}
                    type="button"
                  >
                    <FileDown size={13} />
                    {tr("settings.update.action.download")}
                  </button>
                  <button
                    className="secondary-button"
                    disabled={state.update?.status !== "ready"}
                    onClick={() => void installUpdateNow()}
                    type="button"
                  >
                    <UploadCloud size={13} />
                    {tr("settings.update.action.install")}
                  </button>
                  <button
                    className="secondary-button"
                    disabled={!state.update?.availableVersion}
                    onClick={() => void ignoreCurrentUpdate()}
                    type="button"
                  >
                    {tr("settings.update.action.ignore")}
                  </button>
                </div>
              </div>
              <div className="setting-row">
                <span>{tr("settings.update.status")}</span>
                <strong className="path">
                  {state.update?.status ?? "idle"}
                  {typeof state.update?.downloadProgress === "number"
                    ? ` · ${Math.round(state.update.downloadProgress * 100)}%`
                    : ""}
                </strong>
              </div>
              {state.update?.releaseNotes ? (
                <div className="setting-row">
                  <span>{tr("settings.update.releaseNotes")}</span>
                  <strong className="path">{state.update.releaseNotes}</strong>
                </div>
              ) : null}
              {state.update?.errorCode ? (
                <div className="setting-row">
                  <span>{tr("settings.update.error")}</span>
                  <strong className="path">
                    {state.update.errorCode}
                    {state.update.errorMessage ? ` · ${state.update.errorMessage}` : ""}
                  </strong>
                </div>
              ) : null}
              {state.update?.ignoredVersion ? (
                <div className="setting-row">
                  <span>{tr("settings.update.ignoredVersion")}</span>
                  <strong className="path">{state.update.ignoredVersion}</strong>
                </div>
              ) : null}
              {state.update?.lastCheckedAt ? (
                <div className="setting-row">
                  <span>{tr("settings.update.lastChecked")}</span>
                  <strong className="path">{new Date(state.update.lastCheckedAt).toLocaleString()}</strong>
                </div>
              ) : null}
              <div className="setting-row">
                <span>构建信息</span>
                <strong className="path">
                  {state.buildInfo
                    ? `${state.buildInfo.productName} ${state.buildInfo.currentVersion} · ${state.buildInfo.targetOs}-${state.buildInfo.targetArch}`
                    : "加载中"}
                </strong>
              </div>
              <div className="setting-row">
                <span>Bundle ID</span>
                <strong className="path">{state.buildInfo?.bundleIdentifier ?? "app.clipforge.desktop"}</strong>
              </div>
              <div className="setting-row">
                <span>{tr("settings.update.endpoint")}</span>
                <strong className="path">{state.buildInfo?.updaterEndpoint ?? "latest.json"}</strong>
              </div>
            </SettingGroup>
          )}

          {section === "tags" && (
            <SettingGroup title="Tag 规则">
              <div className="setting-row">
                <span>Tag 生成</span>
                <SegmentSetting
                  options={(["similar", "rules", "off"] as AppSettings["tagMode"][]).map((v) => ({
                    value: v,
                    label: tagModeLabels[v],
                  }))}
                  selected={state.settings.tagMode}
                  onChange={(tagMode) => updateSettings({ tagMode })}
                />
              </div>
              <div className="tag-rule-list">
                {state.settings.tagRules.map((rule) => (
                  <div className="tag-rule-row" key={rule.id}>
                    <input
                      aria-label="Tag 名称"
                      className="rule-label"
                      onChange={(event) => updateTagRule(rule.id, { label: event.currentTarget.value })}
                      value={rule.label}
                    />
                    <input
                      aria-label="Tag 关键词"
                      className="rule-query"
                      onChange={(event) => updateTagRule(rule.id, { query: event.currentTarget.value })}
                      value={rule.query}
                    />
                    <button
                      aria-label="删除 Tag 规则"
                      className="icon-button subtle"
                      onClick={() => deleteTagRule(rule.id)}
                      type="button"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
              <button className="secondary-button" onClick={addTagRule} type="button">
                <Plus size={14} />
                添加规则
              </button>
            </SettingGroup>
          )}
        </main>
      </div>
    </div>
  );
}
