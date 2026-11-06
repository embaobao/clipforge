/** 设置页「MCP/Agent → provider」tab 的 provider 增删改表单（pi-sdk L2）。
 *  边界：读路径列表来自脱敏后的 settings（apiKey 恒为 "[redacted]" 占位或缺失，占位即「已配置」）；
 *  写路径整表经 updateSettings → settings_service_patch 落到 agent.providers（数组整表替换语义）；
 *  key 输入框 password 型只写不回显，未改动时传回占位符由 Rust 侧按 id 回填真实值
 *  （settings_service/write.rs preserve 逻辑），清除 key 只能删除 provider 条目。 */
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState, type ChangeEvent } from "react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { SettingGroup } from "../controls";
import type { AppSettings } from "../settings-model";
import type { TranslationKey } from "../../i18n";

/** settings.agent.providers 的条目形状（脱敏读取后，apiKey 只可能是 "[redacted]" 占位或缺失）。 */
type ProviderEntry = Record<string, unknown>;
type ProviderKind = "openai-compatible" | "local-cli";

/** 表单草稿：apiKey 留空表示「不改已配置的 key」；apiKeyEnv 留空表示不落该字段。 */
type ProviderDraft = {
  id: string;
  label: string;
  kind: ProviderKind;
  baseUrl: string;
  modelId: string;
  command: string;
  apiKey: string;
  apiKeyEnv: string;
  enabled: boolean;
};

export type AgentProviderManagerProps = {
  /** 脱敏后的 provider 列表（settings.agent.providers ?? settings.agentProviders）。 */
  providers: ProviderEntry[];
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
  updateSettings: (next: Partial<AppSettings>) => void;
};

/** 读条目里的字符串字段（缺省/非字符串返回空串）。 */
function readString(entry: ProviderEntry, key: string): string {
  return typeof entry[key] === "string" ? (entry[key] as string) : "";
}

/** 读路径脱敏语义下「已配置 key」的判定：存在非空 apiKey 字符串（含 "[redacted]" 占位）。 */
function hasStoredApiKey(entry: ProviderEntry): boolean {
  return readString(entry, "apiKey").trim() !== "";
}

/** 条目 → 草稿：apiKey 永不回填（只写不回显）；kind 收敛为表单支持的两种。 */
function draftFromEntry(entry: ProviderEntry): ProviderDraft {
  return {
    id: readString(entry, "id") || `agent-${Date.now().toString(36)}`,
    label: readString(entry, "label") || readString(entry, "name"),
    kind: readString(entry, "kind") === "local-cli" ? "local-cli" : "openai-compatible",
    baseUrl: readString(entry, "baseUrl") || readString(entry, "baseURL") || readString(entry, "endpoint"),
    modelId: readString(entry, "modelId") || readString(entry, "model"),
    command: readString(entry, "command"),
    apiKey: "",
    apiKeyEnv: readString(entry, "apiKeyEnv") || readString(entry, "apiKeyRef"),
    enabled: entry.enabled !== false,
  };
}

/** 必填校验：名称恒必填；openai-compatible 需 baseUrl + 模型 ID；local-cli 需命令。 */
function draftValid(draft: ProviderDraft): boolean {
  if (!draft.label.trim()) return false;
  if (draft.kind === "openai-compatible") {
    return Boolean(draft.baseUrl.trim() && draft.modelId.trim());
  }
  return Boolean(draft.command.trim());
}

/** 草稿 → 可落库条目：key 输入为空但原条目已配置时传回 "[redacted]" 占位（Rust 侧按 id 回填），
 *  新 key 原样落库；apiKeyEnv 留空时省略字段（不覆盖为空）。 */
function draftToEntry(draft: ProviderDraft, previous: ProviderEntry | undefined): ProviderEntry {
  const entry: ProviderEntry = {
    id: draft.id,
    label: draft.label.trim(),
    kind: draft.kind,
    enabled: draft.enabled,
  };
  if (draft.kind === "openai-compatible") {
    entry.baseUrl = draft.baseUrl.trim();
    entry.modelId = draft.modelId.trim();
  } else {
    entry.command = draft.command.trim();
  }
  if (draft.apiKey.trim()) {
    entry.apiKey = draft.apiKey.trim();
  } else if (previous && hasStoredApiKey(previous)) {
    entry.apiKey = "[redacted]";
  }
  if (draft.apiKeyEnv.trim()) entry.apiKeyEnv = draft.apiKeyEnv.trim();
  return entry;
}

/** 条目副标题：openai 兼容显示 baseUrl · 模型，本地 CLI 显示命令。 */
function entrySubtitle(entry: ProviderEntry): string {
  const kind = readString(entry, "kind");
  if (kind === "local-cli") {
    return readString(entry, "command") || "—";
  }
  const baseUrl = readString(entry, "baseUrl") || readString(entry, "baseURL") || readString(entry, "endpoint");
  const modelId = readString(entry, "modelId") || readString(entry, "model");
  return [baseUrl, modelId].filter(Boolean).join(" · ") || "—";
}

/** provider 增删改表单：列表行（编辑/删除）+ 内联草稿表单（新增/编辑共用），整表回写。 */
export function AgentProviderManager({ providers, tr, updateSettings }: AgentProviderManagerProps) {
  const [draft, setDraft] = useState<ProviderDraft | null>(null);

  const patchDraft = (patch: Partial<ProviderDraft>) =>
    setDraft((current) => (current ? { ...current, ...patch } : current));

  /** 整表替换语义：所有增删改都重写完整 agent.providers 数组（数组 patch 即整表替换）。 */
  const saveDraft = () => {
    if (!draft || !draftValid(draft)) return;
    const id = draft.id;
    const previous = providers.find((entry) => readString(entry, "id") === id);
    const nextEntry = draftToEntry(draft, previous);
    const nextList = previous
      ? providers.map((entry) => (readString(entry, "id") === id ? nextEntry : entry))
      : [...providers, nextEntry];
    updateSettings({ agent: { providers: nextList } });
    setDraft(null);
  };

  const deleteProvider = (id: string) => {
    updateSettings({ agent: { providers: providers.filter((entry) => readString(entry, "id") !== id) } });
    if (draft?.id === id) setDraft(null);
  };

  const previousEntry = draft ? providers.find((entry) => readString(entry, "id") === draft.id) : undefined;

  return (
    <SettingGroup>
      {draft ? (
        <div className="mb-2 grid gap-2.5 rounded-lg border border-black/[0.06] bg-black/[0.02] p-3 dark:border-white/[0.08] dark:bg-white/[0.03]">
          <div className="grid grid-cols-[1fr_auto] items-end gap-2.5">
            <label htmlFor="agent-provider-label">
              <span className="mb-1 block text-[11px] text-muted-foreground">{tr("settings.agentProvider.field.name")}</span>
              <Input
                className="h-7 rounded-md text-[13px]"
                id="agent-provider-label"
                onChange={(event: ChangeEvent<HTMLInputElement>) => patchDraft({ label: event.currentTarget.value })}
                value={draft.label}
              />
            </label>
            <div>
              <span className="mb-1 block text-[11px] text-muted-foreground">{tr("settings.agentProvider.field.kind")}</span>
              <div className="flex h-7 overflow-hidden rounded-md border border-black/[0.08] dark:border-white/[0.1]">
                {(["openai-compatible", "local-cli"] as ProviderKind[]).map((kind) => (
                  <button
                    aria-pressed={draft.kind === kind}
                    className={`flex h-7 items-center px-2.5 text-[12px] transition-colors ${
                      draft.kind === kind
                        ? "bg-black/[0.06] font-medium dark:bg-white/[0.1]"
                        : "text-muted-foreground hover:bg-black/[0.03] dark:hover:bg-white/[0.06]"
                    }`}
                    data-settings-probe="agent-provider-kind"
                    key={kind}
                    onClick={() => patchDraft({ kind })}
                    type="button"
                  >
                    {tr(
                      kind === "openai-compatible"
                        ? "settings.agentProvider.kind.openaiCompatible"
                        : "settings.agentProvider.kind.localCli",
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {draft.kind === "openai-compatible" ? (
            <div className="grid grid-cols-[3fr_2fr] gap-2.5">
              <label htmlFor="agent-provider-base-url">
                <span className="mb-1 block text-[11px] text-muted-foreground">{tr("settings.agentProvider.field.baseUrl")}</span>
                <Input
                  className="h-7 rounded-md text-[13px]"
                  id="agent-provider-base-url"
                  onChange={(event: ChangeEvent<HTMLInputElement>) => patchDraft({ baseUrl: event.currentTarget.value })}
                  placeholder="https://api.example.com/v1"
                  value={draft.baseUrl}
                />
              </label>
              <label htmlFor="agent-provider-model">
                <span className="mb-1 block text-[11px] text-muted-foreground">{tr("settings.agentProvider.field.model")}</span>
                <Input
                  className="h-7 rounded-md text-[13px]"
                  id="agent-provider-model"
                  onChange={(event: ChangeEvent<HTMLInputElement>) => patchDraft({ modelId: event.currentTarget.value })}
                  value={draft.modelId}
                />
              </label>
            </div>
          ) : (
            <label htmlFor="agent-provider-command">
              <span className="mb-1 block text-[11px] text-muted-foreground">{tr("settings.agentProvider.field.command")}</span>
              <Input
                className="h-7 rounded-md text-[13px]"
                id="agent-provider-command"
                onChange={(event: ChangeEvent<HTMLInputElement>) => patchDraft({ command: event.currentTarget.value })}
                value={draft.command}
              />
            </label>
          )}
          <label className="flex items-center justify-between gap-2" htmlFor="agent-provider-enabled">
            <span className="text-[12.5px]">{tr("settings.agentProvider.field.enabled")}</span>
            <Switch
              checked={draft.enabled}
              id="agent-provider-enabled"
              onCheckedChange={(enabled: boolean) => patchDraft({ enabled })}
            />
          </label>
          <label htmlFor="agent-provider-api-key">
            <span className="mb-1 block text-[11px] text-muted-foreground">{tr("settings.agentProvider.field.apiKey")}</span>
            <Input
              className="h-7 rounded-md text-[13px]"
              id="agent-provider-api-key"
              onChange={(event: ChangeEvent<HTMLInputElement>) => patchDraft({ apiKey: event.currentTarget.value })}
              placeholder={
                previousEntry && hasStoredApiKey(previousEntry)
                  ? tr("settings.agentProvider.apiKeyConfigured")
                  : undefined
              }
              type="password"
              value={draft.apiKey}
            />
            <span className="mt-1 block text-[10.5px] text-muted-foreground/70">
              {tr("settings.agentProvider.field.apiKeyHint")}
            </span>
          </label>
          <label htmlFor="agent-provider-api-key-env">
            <span className="mb-1 block text-[11px] text-muted-foreground">{tr("settings.agentProvider.field.apiKeyEnv")}</span>
            <Input
              className="h-7 rounded-md text-[13px]"
              id="agent-provider-api-key-env"
              onChange={(event: ChangeEvent<HTMLInputElement>) => patchDraft({ apiKeyEnv: event.currentTarget.value })}
              placeholder="KIMI_API_KEY"
              value={draft.apiKeyEnv}
            />
            <span className="mt-1 block text-[10.5px] text-muted-foreground/70">
              {tr("settings.agentProvider.field.apiKeyEnvHint")}
            </span>
          </label>
          {!draftValid(draft) ? (
            <p className="text-[11px] text-destructive/80">{tr("settings.agentProvider.requiredHint")}</p>
          ) : null}
          <div className="flex items-center gap-2">
            <button
              className="flex h-7 items-center gap-1.5 rounded-md bg-black/[0.06] px-2.5 text-[12px] text-foreground transition-colors hover:bg-black/[0.09] disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white/[0.1] dark:hover:bg-white/[0.15]"
              data-settings-probe="agent-provider-save"
              disabled={!draftValid(draft)}
              onClick={saveDraft}
              type="button"
            >
              {tr("settings.agentProvider.save")}
            </button>
            <button
              className="flex h-7 items-center rounded-md px-2.5 text-[12px] text-muted-foreground transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.06]"
              onClick={() => setDraft(null)}
              type="button"
            >
              {tr("settings.agentProvider.cancel")}
            </button>
          </div>
        </div>
      ) : null}
      {providers.length === 0 && !draft ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-black/[0.08] py-10 text-center dark:border-white/[0.1]">
          <p className="text-[12.5px] text-muted-foreground">{tr("settings.agentProvider.empty")}</p>
          <p className="text-[11px] text-muted-foreground/70">{tr("settings.agentProvider.emptyHint")}</p>
          <button
            className="mt-1 flex h-7 items-center gap-1.5 rounded-md bg-black/[0.04] px-2.5 text-[12px] text-foreground transition-colors hover:bg-black/[0.06] dark:bg-white/[0.07] dark:hover:bg-white/[0.1]"
            data-settings-probe="agent-provider-add"
            onClick={() => setDraft(draftFromEntry({ id: `agent-${Date.now().toString(36)}` }))}
            type="button"
          >
            <Plus size={14} />
            {tr("settings.agentProvider.add")}
          </button>
        </div>
      ) : (
        <>
          <div className="grid gap-1.5">
            {providers.map((entry) => {
              const id = readString(entry, "id") || readString(entry, "label");
              return (
                <div
                  className="flex items-center gap-2 rounded-lg border border-black/[0.05] px-2.5 py-2 dark:border-white/[0.07]"
                  key={id}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`truncate text-[12.5px] ${entry.enabled === false ? "text-muted-foreground/70" : ""}`}
                      >
                        {readString(entry, "label") || readString(entry, "name") || id}
                      </span>
                      <span className="shrink-0 rounded bg-black/[0.05] px-1 py-0.5 text-[10px] text-muted-foreground dark:bg-white/[0.08]">
                        {readString(entry, "kind") === "local-cli"
                          ? tr("settings.agentProvider.kind.localCli")
                          : tr("settings.agentProvider.kind.openaiCompatible")}
                      </span>
                      {hasStoredApiKey(entry) ? (
                        <span className="shrink-0 rounded bg-emerald-500/10 px-1 py-0.5 text-[10px] text-emerald-600 dark:text-emerald-400">
                          {tr("settings.agentProvider.apiKeyConfigured")}
                        </span>
                      ) : null}
                    </div>
                    <div className="truncate text-[11px] text-muted-foreground">{entrySubtitle(entry)}</div>
                  </div>
                  <button
                    aria-label={tr("settings.agentProvider.edit")}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.07]"
                    data-settings-probe="agent-provider-edit"
                    onClick={() => setDraft(draftFromEntry(entry))}
                    type="button"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    aria-label={tr("settings.agentProvider.delete")}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-destructive transition-colors hover:bg-destructive/10"
                    data-settings-probe="agent-provider-delete"
                    onClick={() => deleteProvider(readString(entry, "id"))}
                    type="button"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })}
          </div>
          {!draft ? (
            <button
              className="mt-2 flex h-7 items-center gap-1.5 rounded-md bg-black/[0.04] px-2.5 text-[12px] text-foreground transition-colors hover:bg-black/[0.06] dark:bg-white/[0.07] dark:hover:bg-white/[0.1]"
              data-settings-probe="agent-provider-add"
              onClick={() => setDraft(draftFromEntry({ id: `agent-${Date.now().toString(36)}` }))}
              type="button"
            >
              <Plus size={14} />
              {tr("settings.agentProvider.add")}
            </button>
          ) : null}
        </>
      )}
    </SettingGroup>
  );
}
