import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Database,
  ExternalLink,
  Eye,
  FileCode,
  Plus,
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
  tagMode: "similar" | "rules" | "off";
  tagRules: Array<{ id: string; label: string; query: string }>;
}

interface AccessibilityPermissionPayload {
  canReadFocusedInput: boolean;
  status: "granted" | "missing" | "denied";
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

interface SettingsAppState {
  accessibility: AccessibilityPermissionPayload | null;
  configPath: string;
  configStatus: string;
  databasePath: string;
  settings: AppSettings;
  status: string;
}

const DEFAULT_SETTINGS: AppSettings = {
  globalShortcut: "Command+Shift+V",
  panelDensity: "normal",
  contentDisplayMode: "summary",
  quickItemLimit: 12,
  maxStoredItems: 500,
  clipboardPollMs: 200,
  cleanupEnabled: true,
  cleanupIntervalHours: 24,
  softDeletedRetentionDays: 7,
  enableMarkdownPreview: true,
  tagMode: "rules",
  tagRules: [
    { id: "r1", label: "GitHub", query: "github.com gh repo pull request" },
    { id: "r2", label: "GitLab", query: "gitlab.com merge request" },
    { id: "r3", label: "命令", query: "pnpm npm npx cargo git tauri brew" },
    { id: "r4", label: "文档", query: "readme openspec markdown docs md" },
  ],
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
    configPath: "",
    configStatus: "加载中…",
    databasePath: "",
    settings: DEFAULT_SETTINGS,
    status: "",
  });

  useEffect(() => {
    void (async () => {
      try {
        const [settings, configPath, databasePath, accessibility] = await Promise.all([
          invoke<AppSettings>("get_clipforge_settings"),
          invoke<string>("get_clipforge_config_path"),
          invoke<string>("get_clipforge_database_path"),
          invoke<AccessibilityPermissionPayload>("check_accessibility_permission"),
        ]);
        setState({
          accessibility,
          configPath,
          configStatus: "配置已同步到 JSON5",
          databasePath,
          settings,
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

  async function openAccessibilitySettings() {
    try {
      await invoke("request_accessibility_permission");
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
                {state.accessibility?.status === "missing" ? (
                  <button className="secondary-button" onClick={openAccessibilitySettings} type="button">
                    打开系统设置
                  </button>
                ) : null}
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
            </SettingGroup>
          )}

          {section === "content" && (
            <SettingGroup title="内容识别">
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
