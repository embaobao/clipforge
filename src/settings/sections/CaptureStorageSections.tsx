/** 设置窗口「采集与内容」「存储与日志」两个 section（从 settings.tsx 切出的展示组件）。
 *  边界：状态与动作经 props 注入；diagnostics 的 tooltip/两步确认探针受 verify 断言锁定。 */
import { Eye, ExternalLink, FileCode, FileDown, FolderOpen, RefreshCw, Terminal, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { TranslationKey } from "../../i18n";
import { CheckItem, NumberSetting, ReadonlyField, SettingGroup, ToggleSetting } from "../controls";
import { LogsDataTables } from "../components/LogsDataTables";
import { SettingsFieldRow } from "../components/SettingsFieldRow";
import { SettingsStatusPanel } from "../components/SettingsStatusPanel";
import type { SettingsStatusPanelState } from "../components/SettingsStatusPanel";
import type { AppSettings, DataStatsPayload, LogStatsPayload } from "../settings-model";
import type { SettingsTabId } from "../settings-field-catalog";

export type CaptureContentSectionProps = {
  settings: AppSettings;
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
  updateSettings: (next: Partial<AppSettings>) => void;
  renderTabs: (panels: Partial<Record<SettingsTabId, ReactNode>>) => ReactNode;
};

/** 采集与内容 section（search/preview/capture-types/limits 四个 tab）。 */
export function CaptureContentSection({ settings, tr, updateSettings, renderTabs }: CaptureContentSectionProps) {
  return renderTabs({
    search: (
      <SettingGroup>
        <ToggleSetting
          checked={settings.fuzzySearchEnabled}
          label={tr("settings.content.fuzzySearch")}
          onChange={(fuzzySearchEnabled) => updateSettings({ fuzzySearchEnabled })}
        />
        <ToggleSetting
          checked={settings.pinyinSearchEnabled}
          label={tr("settings.content.pinyinSearch")}
          onChange={(pinyinSearchEnabled) => updateSettings({ pinyinSearchEnabled })}
        />
        <div className="grid gap-2">
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
      <SettingGroup>
        <ToggleSetting
          checked={settings.enableMarkdownPreview}
          label={tr("settings.content.markdownPreview")}
          onChange={(enableMarkdownPreview) => updateSettings({ enableMarkdownPreview })}
        />
        <div className="grid gap-2">
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
      <SettingGroup>
        <SettingsFieldRow
          section="capture-content"
          tab="capture-types"
          values={settings as unknown as Record<string, unknown>}
          onChange={(key, value) => updateSettings({ [key]: value } as Partial<AppSettings>)}
          tr={tr}
          extraNodes={[
            <div className="rounded-lg bg-black/[0.03] p-4 dark:bg-white/[0.05]" key="capture-multi-type">
              <span>{tr("settings.capture.multiType.title")}</span>
              <strong>{tr("settings.capture.multiType.summary")}</strong>
              <p>{tr("settings.capture.multiType.description")}</p>
            </div>,
          ]}
        />
      </SettingGroup>
    ),
    limits: (
      <SettingGroup>
        <NumberSetting
          label={tr("settings.capture.imageMaxSize")}
          max={1024}
          min={1}
          onChange={(imageMaxSizeMb) => updateSettings({ imageMaxSizeMb })}
          value={settings.imageMaxSizeMb}
        />
        <NumberSetting
          label={tr("settings.capture.textMaxSize")}
          max={100}
          min={1}
          onChange={(textMaxSizeMb) => updateSettings({ textMaxSizeMb })}
          value={settings.textMaxSizeMb}
        />
      </SettingGroup>
    ),
  });
}

export type StorageLogsSectionProps = {
  settings: AppSettings;
  configPath: string;
  databasePath: string;
  logStats: LogStatsPayload | null;
  dangerConfirmation: string | null;
  logActionStatus: { message: string; state: SettingsStatusPanelState };
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
  updateSettings: (next: Partial<AppSettings>) => void;
  formatBytes: (bytes: number) => string;
  copySettingsSnippet: (label: string, value: string) => Promise<void> | void;
  exportDiagnosticsBundle: () => Promise<void> | void;
  cleanupLogsNow: () => Promise<void> | void;
  refreshLogStats: () => Promise<void> | void;
  setDangerConfirmation: (v: "cleanupLogs" | "cleanupData" | null) => void;
  renderTabs: (panels: Partial<Record<SettingsTabId, ReactNode>>) => ReactNode;
  /** 数据存储统计（数据库/设置/图片缓存大小与记录数）。 */
  dataStats: DataStatsPayload | null;
  /** 数据 tab 动作反馈状态。 */
  dataActionStatus: { message: string; state: SettingsStatusPanelState };
  refreshDataStats: () => Promise<void> | void;
  cleanupDataNow: () => Promise<void> | void;
  revealDataFolder: () => Promise<void> | void;
};

/** 调试模式实时指标面板：仅当 diagnostics tab 挂载时存在（TabsContent 懒渲染），
 *  轮询随挂载/卸载自动起停——没人看时零开销（对应提案「采样默认关闭」的 UI 侧落点）。
 *  数据源：diagnostics_get_metrics 命令（Rust 按需采集，无后台线程）。 */
function DiagnosticsMetricsPanel({ tr, formatBytes }: { tr: (key: TranslationKey) => string; formatBytes: (bytes: number) => string }) {
  const [metrics, setMetrics] = useState<Record<string, never> | null>(null);
  // 上一次快照:用于「内存持续增长」告警(连续 3 次单调增长才高亮,避免单次波动误报)。
  const growthRef = useRef<number[]>([]);

  useEffect(() => {
    let disposed = false;
    const poll = async () => {
      try {
        const next = await invoke<Record<string, never>>("diagnostics_get_metrics");
        if (!disposed) setMetrics(next);
      } catch {
        /* 单次采集失败不打断面板,下个周期重试 */
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, []);

  const memory = (metrics as unknown as { memory?: { physFootprintBytes?: number } } | null)?.memory;
  const physFootprint = memory?.physFootprintBytes ?? 0;
  useEffect(() => {
    if (!physFootprint) return;
    const history = [...growthRef.current, physFootprint].slice(-3);
    growthRef.current = history;
  }, [physFootprint]);
  const growing =
    growthRef.current.length === 3 && growthRef.current[0] < growthRef.current[1] && growthRef.current[1] < growthRef.current[2];

  const data = (metrics as unknown as { data?: { dbBytes?: number; imagesBytes?: number; clipCount?: number } } | null)?.data;
  const log = (metrics as unknown as { log?: { lastEntryAgeMs?: number; bytes?: number } } | null)?.log;
  const logStalled = (log?.lastEntryAgeMs ?? 0) > 5000;
  const uptimeMs = (metrics as unknown as { uptimeMs?: number } | null)?.uptimeMs ?? 0;

  const rows: Array<{ label: string; value: string; warn?: boolean }> = [
    { label: tr("settings.diagnostics.metric.memory"), value: physFootprint ? formatBytes(physFootprint) : "—", warn: growing },
    { label: tr("settings.diagnostics.metric.database"), value: data?.dbBytes ? formatBytes(data.dbBytes) : "—" },
    { label: tr("settings.diagnostics.metric.images"), value: data?.imagesBytes ? formatBytes(data.imagesBytes) : "—" },
    { label: tr("settings.diagnostics.metric.clipCount"), value: String(data?.clipCount ?? 0) },
    { label: tr("settings.diagnostics.metric.logAge"), value: log?.lastEntryAgeMs != null && log.lastEntryAgeMs >= 0 ? `${log.lastEntryAgeMs} ms` : "—", warn: logStalled },
    { label: tr("settings.diagnostics.metric.uptime"), value: uptimeMs ? `${Math.round(uptimeMs / 1000)} s` : "—" },
  ];

  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 py-1 sm:grid-cols-3" data-dev-probe="settings-diagnostics-metrics">
      {rows.map((row) => (
        <div className="flex items-baseline justify-between gap-2 text-[12px]" key={row.label}>
          <span className="text-muted-foreground">{row.label}</span>
          <span className={row.warn ? "mono text-destructive" : "mono text-foreground/90"}>{row.value}</span>
        </div>
      ))}
    </div>
  );
}

/** 存储与日志 section（data/cleanup/logs/diagnostics 四个 tab）；清理确认保持两步式。 */
export function StorageLogsSection({
  settings,
  configPath,
  databasePath,
  logStats,
  dangerConfirmation,
  logActionStatus,
  tr,
  updateSettings,
  formatBytes,
  copySettingsSnippet,
  exportDiagnosticsBundle,
  cleanupLogsNow,
  refreshLogStats,
  setDangerConfirmation,
  renderTabs,
  dataStats,
  dataActionStatus,
  refreshDataStats,
  cleanupDataNow,
  revealDataFolder,
}: StorageLogsSectionProps) {
  return renderTabs({
    data: (
      <SettingGroup title={tr("settings.storage.data.title")}>
        <SettingsStatusPanel
          actions={[
            {
              label: tr("settings.diagnostics.refresh"),
              onClick: () => void refreshDataStats(),
              icon: RefreshCw,
              variant: "secondary",
              tooltip: tr("settings.data.refreshTooltip"),
              probeId: "settings-action:data.refresh",
            },
            {
              label: tr("settings.data.reveal"),
              onClick: () => void revealDataFolder(),
              icon: FolderOpen,
              variant: "diagnostic",
              tooltip: tr("settings.data.revealTooltip"),
              probeId: "settings-action:data.reveal",
            },
            {
              label:
                dangerConfirmation === "cleanupData"
                  ? tr("settings.diagnostics.confirmAgain")
                  : tr("settings.data.cleanupNow"),
              onClick: () => {
                if (dangerConfirmation === "cleanupData") {
                  void cleanupDataNow();
                  return;
                }
                setDangerConfirmation("cleanupData");
              },
              icon: Trash2,
              variant: "destructive",
              tooltip: tr("settings.data.cleanupTooltip"),
              probeId: "settings-action:data.cleanup",
              ariaLabel:
                dangerConfirmation === "cleanupData"
                  ? tr("settings.data.confirmCleanup")
                  : tr("settings.data.cleanupTooltip"),
            },
          ]}
          description={
            dataStats
              ? tr("settings.data.summary", {
                  db: formatBytes(dataStats.dbBytes),
                  settings: formatBytes(dataStats.settingsBytes),
                  images: formatBytes(dataStats.imagesBytes),
                  count: dataStats.clipCount,
                  trash: dataStats.trashCount,
                })
              : tr("settings.status.loading")
          }
          state={dataActionStatus.state}
          status={dataActionStatus.message || tr("settings.data.statusIdle")}
          title={tr("settings.data.title")}
          probeId="settings-status:data"
        />
        <ReadonlyField
          copyLabel={tr("settings.action.copy")}
          label={tr("settings.storage.configPath")}
          onCopy={(label, value) => void copySettingsSnippet(label, value)}
          value={configPath}
        />
        <ReadonlyField
          copyLabel={tr("settings.action.copy")}
          label={tr("settings.storage.databasePath")}
          onCopy={(label, value) => void copySettingsSnippet(label, value)}
          value={databasePath}
        />
        <NumberSetting
          label={tr("settings.storage.maxItems")}
          value={settings.maxStoredItems}
          min={50}
          max={5000}
          onChange={(maxStoredItems) => updateSettings({ maxStoredItems })}
        />
        <NumberSetting
          label={tr("settings.storage.pollInterval")}
          value={settings.clipboardPollMs}
          min={500}
          max={5000}
          onChange={(clipboardPollMs) => updateSettings({ clipboardPollMs })}
        />
      </SettingGroup>
    ),
    cleanup: (
      <SettingGroup>
        <ToggleSetting
          checked={settings.cleanupEnabled}
          label={tr("settings.storage.cleanupEnabled")}
          onChange={(cleanupEnabled) => updateSettings({ cleanupEnabled })}
        />
        <NumberSetting
          label={tr("settings.storage.cleanupInterval")}
          value={settings.cleanupIntervalHours}
          min={1}
          max={720}
          onChange={(cleanupIntervalHours) => updateSettings({ cleanupIntervalHours })}
        />
        <NumberSetting
          label={tr("settings.storage.retentionDays")}
          value={settings.softDeletedRetentionDays}
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
            logStats
              ? tr("settings.logs.lineCount", {
                  size: formatBytes(logStats.sizeBytes),
                  count: logStats.lineCount,
                })
              : tr("settings.status.loading")
          }
          label={tr("settings.logs.file")}
          onCopy={(label, value) => void copySettingsSnippet(label, value)}
          value={logStats?.path ?? ""}
        />
        <NumberSetting
          label={tr("settings.logs.maxSize")}
          value={settings.logMaxSizeMb}
          min={1}
          max={1024}
          onChange={(logMaxSizeMb) => updateSettings({ logMaxSizeMb })}
        />
        <NumberSetting
          label={tr("settings.logs.keepRatio")}
          value={Math.round(settings.logKeepRatio * 100)}
          min={10}
          max={95}
          onChange={(percent) => updateSettings({ logKeepRatio: percent / 100 })}
        />
        <NumberSetting
          label={tr("settings.logs.maxLines")}
          value={settings.logMaxLines}
          min={1000}
          max={1000000}
          onChange={(logMaxLines) => updateSettings({ logMaxLines })}
        />
        <div className="flex items-center justify-between gap-8 py-3">
          <span>{tr("settings.logs.retentionPolicy")}</span>
          <strong>{tr("settings.logs.retentionPolicyValue")}</strong>
        </div>
        <ToggleSetting
          checked={settings.logAutoCleanup}
          label={tr("settings.logs.autoCleanup")}
          onChange={(logAutoCleanup) => updateSettings({ logAutoCleanup })}
        />
        <NumberSetting
          label={tr("settings.logs.cleanupInterval")}
          value={settings.logCleanupIntervalMin}
          min={60}
          max={1440}
          onChange={(logCleanupIntervalMin) =>
            updateSettings({ logCleanupIntervalMin })
          }
        />
        <ToggleSetting
          checked={settings.debugLogsEnabled}
          label={tr("settings.logs.debugLogs")}
          onChange={(debugLogsEnabled) => updateSettings({ debugLogsEnabled })}
        />
        {/* 数据查看双表：应用日志 + 采集历史（只读、动态加载，见 LogsDataTables）。 */}
        <div className="mt-2 border-t border-border/50 pt-3">
          <p className="mb-2 text-[12px] font-medium text-foreground">{tr("settings.logs.dataTitle")}</p>
          <LogsDataTables tr={tr} />
        </div>
      </SettingGroup>
    ),
    diagnostics: (
      <SettingGroup title={tr("settings.diagnostics.title")}>
        <DiagnosticsMetricsPanel formatBytes={formatBytes} tr={tr} />
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
            logStats
              ? tr("settings.logs.lineCount", {
                  size: formatBytes(logStats.sizeBytes),
                  count: logStats.lineCount,
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
  });
}
