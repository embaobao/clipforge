import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Database,
  ExternalLink,
  Eye,
  FileCode,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Settings,
  Tag,
  Terminal,
  Trash2,
} from "lucide-react";

interface AppSettings {
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

const densityLabels: Record<AppSettings["panelDensity"], string> = {
  dense: "紧凑",
  normal: "标准",
  comfortable: "舒适",
};

const displayModeLabels: Record<AppSettings["contentDisplayMode"], string> = {
  summary: "摘要",
  middle: "中等",
  raw: "原始",
};

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

function formatBytes(bytes: number): string {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

const DEFAULT_SETTINGS: AppSettings = {
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
  options,
  selected,
  onChange,
}: {
  options: Array<{ value: T; label: string }>;
  selected: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="segment-row">
      {options.map((option) => (
        <button
          className={selected === option.value ? "active" : ""}
          key={option.value}
          onClick={() => onChange(option.value)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
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
  { key: "shortcut", label: "快捷键", icon: Terminal },
  { key: "display", label: "面板显示", icon: Eye },
  { key: "integration", label: "集成", icon: Terminal },
  { key: "content", label: "内容识别", icon: FileCode },
  { key: "storage", label: "数据存储", icon: Database },
  { key: "tags", label: "Tag 规则", icon: Tag },
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
  });

  useEffect(() => {
    void (async () => {
      try {
        const [settings, configPath, databasePath, accessibility, accessibilityDiagnostics, panel, mcp, logStats] = await Promise.all([
          invoke<AppSettings>("get_clipforge_settings"),
          invoke<string>("get_clipforge_config_path"),
          invoke<string>("get_clipforge_database_path"),
          invoke<AccessibilityPermissionPayload>("check_accessibility_permission"),
          invoke<AccessibilityDiagnosticsPayload>("get_accessibility_diagnostics"),
          invoke<PanelTriggerPayload>("get_panel_trigger_status"),
          invoke<McpStatusPayload>("get_mcp_status"),
          invoke<LogStatsPayload>("get_log_stats"),
        ]);
        setState({
          accessibility,
          accessibilityDiagnostics,
          configPath,
          configStatus: "配置已同步到 JSON5",
          databasePath,
          mcp,
          panel,
          settings: { ...DEFAULT_SETTINGS, ...settings },
          logStats,
          status: "",
        });
      } catch (error) {
        setState((prev) => ({
          ...prev,
          configStatus: "加载失败：使用本地兜底",
          status: String(error),
        }));
      }
    })();
  }, []);

  function updateSettings(next: Partial<AppSettings>) {
    setState((prev) => ({ ...prev, settings: { ...prev.settings, ...next } }));
    invoke("update_clipforge_settings", { input: next }).catch((error) =>
      setState((prev) => ({ ...prev, status: String(error) })),
    );
  }

  async function refreshLogStats() {
    try {
      const stats = await invoke<LogStatsPayload>("get_log_stats");
      setState((prev) => ({ ...prev, logStats: stats }));
    } catch (error) {
      setState((prev) => ({ ...prev, status: String(error) }));
    }
  }

  async function cleanupLogsNow() {
    setState((prev) => ({ ...prev, status: "正在清理日志…" }));
    try {
      const result = await invoke<string>("cleanup_app_logs");
      await refreshLogStats();
      setState((prev) => ({ ...prev, status: result }));
    } catch (error) {
      setState((prev) => ({ ...prev, status: String(error) }));
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
      setState((prev) => ({ ...prev, status: String(error) }));
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
      setState((prev) => ({ ...prev, status: String(error) }));
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
        status: "已重置 ClipForge 辅助功能授权记录，请在系统设置中重新勾选当前应用。",
      }));
    } catch (error) {
      setState((prev) => ({ ...prev, status: String(error) }));
    }
  }

  async function refreshPanelStatus() {
    try {
      const panel = await invoke<PanelTriggerPayload>("get_panel_trigger_status");
      setState((prev) => ({ ...prev, panel, status: panel.message }));
    } catch (error) {
      setState((prev) => ({ ...prev, status: String(error) }));
    }
  }

  async function testFloatingPanel() {
    try {
      const panel = await invoke<PanelTriggerPayload>("show_quick_panel_command", { source: "settings-test" });
      setState((prev) => ({ ...prev, panel, status: `悬浮检测：${panel.positionSource}` }));
    } catch (error) {
      setState((prev) => ({ ...prev, status: String(error) }));
    }
  }

  async function updateMcp(action: "start" | "stop" | "refresh") {
    try {
      const command =
        action === "start"
          ? "start_mcp_server"
          : action === "stop"
            ? "stop_mcp_server"
            : "get_mcp_status";
      const mcp = await invoke<McpStatusPayload>(command);
      setState((prev) => ({ ...prev, mcp, status: mcp.message }));
    } catch (error) {
      setState((prev) => ({ ...prev, status: String(error) }));
    }
  }

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
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <main className="settings-window-content">
          {section === "shortcut" && (
            <SettingGroup title="快捷键">
              <div className="setting-row">
                <span>快速唤起</span>
                <div className="kbd-row">
                  {state.settings.globalShortcut.split("+").map((part) => (
                    <kbd key={part}>{part}</kbd>
                  ))}
                </div>
              </div>
              <div className="setting-row">
                <span>录入快捷键</span>
                <button
                  className={recording ? "primary-button" : "secondary-button"}
                  onClick={() => setRecording((v) => !v)}
                  onKeyDown={(event) => {
                    if (!recording) return;
                    event.preventDefault();
                  }}
                  type="button"
                >
                  {recording ? "按下组合键…" : "开始录入"}
                </button>
              </div>
              <div className="setting-row">
                <span>手动指定</span>
                <input
                  onChange={(event) =>
                    updateSettings({ globalShortcut: event.currentTarget.value })
                  }
                  value={state.settings.globalShortcut}
                />
              </div>
              <div className="setting-card permission-card">
                <span>macOS 辅助功能权限</span>
                <strong>
                  {state.accessibility?.canReadFocusedInput
                    ? "已授权：可贴近输入位置"
                    : "未授权：使用屏幕右侧兜底"}
                </strong>
                <p>
                  {state.accessibility?.message ??
                    "启动时自动检查，用于读取当前输入控件位置。"}
                </p>
                {state.accessibilityDiagnostics ? (
                  <div className="permission-diagnostics">
                    <div>
                      <span>当前进程</span>
                      <strong>{state.accessibilityDiagnostics.trusted ? "trusted" : "missing"}</strong>
                    </div>
                    <div>
                      <span>Bundle ID</span>
                      <code>{state.accessibilityDiagnostics.expectedBundleIdentifier}</code>
                    </div>
                    <div>
                      <span>签名 ID</span>
                      <code>{state.accessibilityDiagnostics.codeSignatureIdentifier || "unknown"}</code>
                    </div>
                    <div>
                      <span>签名类型</span>
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
                      <p>未找到当前 ClipForge 的 TCC 授权记录。</p>
                    )}
                    {state.accessibilityDiagnostics.tccQueryError ? (
                      <p>TCC 查询失败：{state.accessibilityDiagnostics.tccQueryError}</p>
                    ) : null}
                  </div>
                ) : null}
                <div className="button-row">
                  <button className="secondary-button" onClick={openAccessibilitySettings} type="button">
                    <ShieldCheck size={13} />
                    请求权限
                  </button>
                  <button className="secondary-button" onClick={refreshAccessibilityStatus} type="button">
                    <RefreshCw size={13} />
                    刷新状态
                  </button>
                  <button className="secondary-button" onClick={resetAccessibilityPermission} type="button">
                    <RotateCcw size={13} />
                    重置后重试
                  </button>
                </div>
              </div>
            </SettingGroup>
          )}

          {section === "display" && (
            <SettingGroup title="面板显示">
              <div className="setting-row">
                <span>面板密度</span>
                <SegmentSetting
                  options={(["dense", "normal", "comfortable"] as AppSettings["panelDensity"][]).map((v) => ({
                    value: v,
                    label: densityLabels[v],
                  }))}
                  selected={state.settings.panelDensity}
                  onChange={(panelDensity) => updateSettings({ panelDensity })}
                />
              </div>
              <div className="setting-row">
                <span>内容显示</span>
                <SegmentSetting
                  options={(["summary", "middle", "raw"] as AppSettings["contentDisplayMode"][]).map((v) => ({
                    value: v,
                    label: displayModeLabels[v],
                  }))}
                  selected={state.settings.contentDisplayMode}
                  onChange={(contentDisplayMode) => updateSettings({ contentDisplayMode })}
                />
              </div>
              <NumberSetting
                label="快捷列表条数"
                value={state.settings.quickItemLimit}
                min={4}
                max={30}
                onChange={(quickItemLimit) => updateSettings({ quickItemLimit })}
              />
              <NumberSetting
                label="面板宽度"
                value={state.settings.panelWidth}
                min={320}
                max={600}
                onChange={(panelWidth) => updateSettings({ panelWidth })}
              />
              <NumberSetting
                label="面板高度"
                value={state.settings.panelHeight}
                min={300}
                max={1000}
                onChange={(panelHeight) => updateSettings({ panelHeight })}
              />
              <SliderSetting
                label="面板背景透明度"
                min={20}
                max={100}
                step={1}
                suffix="%"
                value={Math.round(state.settings.panelBackgroundOpacity * 100)}
                onChange={(value) => updateSettings({ panelBackgroundOpacity: value / 100 })}
              />
              <ToggleSetting
                label="滚动时自动隐藏底部导航"
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
                <strong>{state.mcp?.running ? "运行中" : "未运行"} · {state.mcp?.transport ?? "stdio"}</strong>
                <p className="path">{state.mcp?.command ?? "加载中…"}</p>
                <p>{state.mcp?.tools.join(" / ")}</p>
                <div className="button-row">
                  <button className="secondary-button" onClick={() => updateMcp("start")} type="button">
                    启动
                  </button>
                  <button className="secondary-button" onClick={() => updateMcp("stop")} type="button">
                    停止
                  </button>
                  <button className="secondary-button" onClick={() => updateMcp("refresh")} type="button">
                    刷新
                  </button>
                </div>
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
