/** 设置窗口「MCP/Agent」「更新与分发」「标签规则」三个 section（从 settings.tsx 切出的展示组件）。
 *  边界：状态与动作经 props 注入；MCP code tabs 的三条过滤断言锚定本文件。 */
import { FileDown, Plus, RefreshCw, Trash2, UploadCloud } from "lucide-react";
import type { ReactNode } from "react";
import type { TranslationKey } from "../../i18n";
import { SegmentSetting, SettingGroup } from "../controls";
import type { ChangeEvent } from "react";
import { Input } from "@/components/ui/input";
import { SettingsCodeTabs } from "../components/SettingsCodeTabs";
import { SettingsStatusPanel } from "../components/SettingsStatusPanel";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { AppSettings, UpdateCheckState } from "../settings-model";
import type { BuildInfoPayload } from "../settings-model";
import type { SettingsTabId } from "../settings-field-catalog";
import type { SettingsCodeTab } from "../components/SettingsCodeTabs";
import { MCP_TOOL_CATALOG } from "../mcp-tool-catalog";

type McpState = {
  mcp: { enabled: boolean; running: boolean; transport: string; command: string; tools: string[]; message: string } | null;
};

export type McpAgentSectionProps = {
  state: McpState;
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
  mcpAgentCodeTabs: SettingsCodeTab[];
  copyMcpAgentCodeTab: (tab: SettingsCodeTab) => void;
  getConfiguredAgentProviderCount: () => number;
  renderTabs: (panels: Partial<Record<SettingsTabId, ReactNode>>) => ReactNode;
};

/** MCP/Agent section（status/install/json-rpc/provider 四个 tab）。 */
export function McpAgentSection({
  state,
  tr,
  mcpAgentCodeTabs,
  copyMcpAgentCodeTab,
  getConfiguredAgentProviderCount,
  renderTabs,
}: McpAgentSectionProps) {
  return renderTabs({
    status: (
      <>
        <SettingGroup title={tr("settings.tab.status")}>
          {/* MCP 状态：常驻服务由 Rust 托管、不会中途变化，只读展示即可，不放刷新入口。 */}
          <div className="flex items-center gap-1.5 text-[12.5px]">
            <span
              aria-hidden="true"
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${state.mcp?.running ? "bg-emerald-500" : "bg-zinc-400"}`}
            />
            <span className="font-medium">{tr("settings.integration.mcp.title")}</span>
            <span className="text-muted-foreground">
              {state.mcp?.running ? tr("settings.integration.mcp.running") : tr("settings.integration.mcp.unknown")} ·{" "}
              {state.mcp?.transport ?? "stdio"} · {tr("settings.integration.mcp.toolCount", { count: state.mcp?.tools.length ?? 0 })}
            </span>
          </div>
          <p className="mt-0.5 text-[12px] text-muted-foreground">{tr("settings.integration.mcp.description")}</p>
          {/* 工具目录：静态分组（与 Rust 端 MCP_TOOLS 同步维护），让 Agent 接入前能先看懂每个工具做什么。 */}
          <div className="mt-3 grid gap-3">
            {MCP_TOOL_CATALOG.map((group) => (
              <div className="grid gap-1.5" key={group.titleKey}>
                <span className="text-[12px] font-medium">{tr(group.titleKey)}</span>
                <ul className="grid gap-1">
                  {group.tools.map((entry) => (
                    <li className="flex items-baseline gap-2" key={entry.tool}>
                      <code className="mono shrink-0 rounded bg-black/[0.05] px-1.5 py-0.5 text-[11px] dark:bg-white/[0.08]">
                        {entry.tool}
                      </code>
                      <span className="min-w-0 text-[12px] text-muted-foreground">{tr(entry.descKey)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </SettingGroup>
        <SettingGroup title={tr("settings.integration.provider.title")}>
          <p className="text-[12px] text-muted-foreground">
            {tr("settings.integration.provider.summary", { count: getConfiguredAgentProviderCount() })}
          </p>
        </SettingGroup>
      </>
    ),
    install: (
      <SettingGroup title={tr("settings.tab.install")}>
        <div className="rounded-lg bg-black/[0.03] p-4 dark:bg-white/[0.05]">
          <span>{tr("settings.manual.agentQuickStart")}</span>
          <strong>{tr("settings.manual.agentSummary")}</strong>
          <p>{tr("settings.manual.agentDescription")}</p>
          <SettingsCodeTabs
            copyLabel={tr("settings.action.copy")}
            tabs={mcpAgentCodeTabs.filter((tab) => tab.value === "mcp-servers" || tab.value === "install" || tab.value === "command")}
            onCopy={copyMcpAgentCodeTab}
          />
          <p>{tr("settings.manual.successContract")}</p>
          <p>{tr("settings.manual.errorContract")}</p>
        </div>
      </SettingGroup>
    ),
    "json-rpc": (
      <SettingGroup title={tr("settings.tab.jsonRpc")}>
        <div className="rounded-lg bg-black/[0.03] p-4 dark:bg-white/[0.05]">
          <span>{tr("settings.integration.examples.title")}</span>
          <strong>{tr("settings.integration.examples.summary")}</strong>
          <SettingsCodeTabs
            copyLabel={tr("settings.action.copy")}
            tabs={mcpAgentCodeTabs.filter((tab) => tab.value === "json-rpc")}
            onCopy={copyMcpAgentCodeTab}
          />
        </div>
      </SettingGroup>
    ),
    provider: (
      <SettingGroup title={tr("settings.tab.provider")}>
        <div className="rounded-lg bg-black/[0.03] p-4 dark:bg-white/[0.05]">
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
  });
}

export type UpdateDistributionSectionProps = {
  update: UpdateCheckState | null;
  buildInfo: BuildInfoPayload | null;
  updateStatusCopy: string;
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
  checkUpdateNow: () => Promise<void> | void;
  downloadUpdateNow: () => Promise<void> | void;
  installUpdateNow: () => Promise<void> | void;
  ignoreCurrentUpdate: () => Promise<void> | void;
  renderTabs: (panels: Partial<Record<SettingsTabId, ReactNode>>) => ReactNode;
};

/** 更新与分发 section（version/update-flow/build 三个 tab）。 */
export function UpdateDistributionSection({
  update,
  buildInfo,
  updateStatusCopy,
  tr,
  checkUpdateNow,
  downloadUpdateNow,
  installUpdateNow,
  ignoreCurrentUpdate,
  renderTabs,
}: UpdateDistributionSectionProps) {
  return renderTabs({
    version: (
      <SettingGroup title={tr("settings.tab.version")}>
        <SettingsStatusPanel
          description={updateStatusCopy}
          items={[
            {
              label: tr("settings.update.status"),
              value: (
                <span className="mono text-[11px] text-muted-foreground">
                  {update?.status ?? "idle"}
                  {typeof update?.downloadProgress === "number"
                    ? ` · ${Math.round(update.downloadProgress * 100)}%`
                    : ""}
                </span>
              ),
            },
            ...(update?.releaseNotes
              ? [
                  {
                    label: tr("settings.update.releaseNotes"),
                    value: <span className="mono text-[11px] text-muted-foreground">{update.releaseNotes}</span>,
                  },
                ]
              : []),
            ...(update?.errorCode
              ? [
                  {
                    label: tr("settings.update.error"),
                    value: (
                      <span className="mono text-[11px] text-muted-foreground">
                        {update.errorCode}
                        {update.errorMessage ? ` · ${update.errorMessage}` : ""}
                      </span>
                    ),
                  },
                ]
              : []),
            ...(update?.ignoredVersion
              ? [
                  {
                    label: tr("settings.update.ignoredVersion"),
                    value: <span className="mono text-[11px] text-muted-foreground">{update.ignoredVersion}</span>,
                  },
                ]
              : []),
            ...(update?.lastCheckedAt
              ? [
                  {
                    label: tr("settings.update.lastChecked"),
                    value: <span className="mono text-[11px] text-muted-foreground">{new Date(update.lastCheckedAt).toLocaleString()}</span>,
                  },
                ]
              : []),
          ]}
          state={update?.status === "failed" ? "danger" : update?.status === "checking" || update?.status === "downloading" ? "pending" : update?.status === "available" || update?.status === "ready" ? "warning" : "neutral"}
          status={`${update?.currentVersion ?? "0.1.0"} · ${update?.channel ?? "stable"}`}
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
              disabled: update?.status !== "available",
              tooltip: tr("settings.update.action.download"),
              probeId: "settings-action:update.download",
            },
            {
              label: tr("settings.update.action.install"),
              onClick: () => void installUpdateNow(),
              icon: UploadCloud,
              variant: "secondary",
              disabled: update?.status !== "ready",
              tooltip: tr("settings.update.action.install"),
              probeId: "settings-action:update.install",
            },
            {
              label: tr("settings.update.action.ignore"),
              onClick: () => void ignoreCurrentUpdate(),
              variant: "secondary",
              disabled: !update?.availableVersion,
              tooltip: tr("settings.update.action.ignore"),
              probeId: "settings-action:update.ignore",
            },
          ]}
          description={updateStatusCopy}
          state={update?.status === "failed" ? "danger" : update?.status === "checking" || update?.status === "downloading" ? "pending" : update?.status === "available" || update?.status === "ready" ? "warning" : "neutral"}
          status={update?.status ?? "idle"}
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
                <span className="mono text-[11px] text-muted-foreground">
                  {buildInfo
                    ? `${buildInfo.productName} ${buildInfo.currentVersion} · ${buildInfo.targetOs}-${buildInfo.targetArch}`
                    : tr("settings.update.buildLoading")}
                </span>
              ),
            },
            {
              label: tr("settings.update.bundleId"),
              value: <span className="mono text-[11px] text-muted-foreground">{buildInfo?.bundleIdentifier ?? "app.clipforge.desktop"}</span>,
            },
            {
              label: tr("settings.update.endpoint"),
              value: <span className="mono text-[11px] text-muted-foreground">{buildInfo?.updaterEndpoint ?? "latest.json"}</span>,
            },
          ]}
          state="neutral"
          status={buildInfo?.currentVersion ?? update?.currentVersion ?? "0.1.0"}
          title={tr("settings.update.buildInfo")}
        />
      </SettingGroup>
    ),
  });
}

export type TagRulesSectionProps = {
  settings: Pick<AppSettings, "tagMode" | "tagRules">;
  tagModeLabels: Record<AppSettings["tagMode"], string>;
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
  updateSettings: (next: Partial<AppSettings>) => void;
  addTagRule: () => void;
  updateTagRule: (id: string, patch: Partial<{ label: string; query: string }>) => void;
  deleteTagRule: (id: string) => void;
  renderTabs: (panels: Partial<Record<SettingsTabId, ReactNode>>) => ReactNode;
};

/** 标签规则 section（tag-mode/rules 两个 tab）：自动打标模式与关键词规则编辑。 */
export function TagRulesSection({
  settings,
  tagModeLabels,
  tr,
  updateSettings,
  addTagRule,
  updateTagRule,
  deleteTagRule,
  renderTabs,
}: TagRulesSectionProps) {
  return renderTabs({
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
            selected={settings.tagMode}
            onChange={(tagMode) => updateSettings({ tagMode })}
          />
        </div>
      </SettingGroup>
    ),
    rules: (
      <SettingGroup title={tr("settings.tab.rules")}>
        <div className="space-y-2">
          {settings.tagRules.map((rule) => (
            <div className="flex items-center gap-2" key={rule.id}>
              <label className="flex-1" htmlFor={`tag-rule-${rule.id}-label`}>
                <span className="mb-1 block text-[11px] text-muted-foreground">{tr("settings.tags.name")}</span>
                <Input
                  className="h-7 rounded-md text-[13px]"
                  id={`tag-rule-${rule.id}-label`}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => updateTagRule(rule.id, { label: event.currentTarget.value })}
                  value={rule.label}
                />
              </label>
              <label className="flex-[2]" htmlFor={`tag-rule-${rule.id}-query`}>
                <span className="mb-1 block text-[11px] text-muted-foreground">{tr("settings.tags.keyword")}</span>
                <Input
                  className="h-7 rounded-md text-[13px]"
                  id={`tag-rule-${rule.id}-query`}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => updateTagRule(rule.id, { query: event.currentTarget.value })}
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
  });
}
