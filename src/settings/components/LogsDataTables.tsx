/** 设置页「数据查看」双表：应用日志（query_app_logs）与采集历史（search_clip_records）。
 *  动态加载：应用日志按级别/关键词过滤后拉取（上限 300 条），采集历史按 nextCursor 键集分页逐页加载。
 *  边界：只读展示，不提供编辑/删除入口；浏览器预览经 tauri-web-mock 返回样例数据；
 *  两个数据源都是既有 Rust command，本组件不新增命令。 */
import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { TranslationKey } from "../../i18n";

export type LogsDataTablesProps = {
  /** 设置页 i18n 翻译函数（与 sections 共用同一实例）。 */
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
};

/** 单条应用日志（对齐 Rust AppLogEntryPayload，camelCase 序列化）。 */
type AppLogEntry = { tsMs: number; level: string; message: string; context: string };

type QueryAppLogPayload = { path: string; items: AppLogEntry[]; limit: number };

/** 采集历史行的最小展示字段（对齐 ClipItemPayload 的子集，缺失字段宽容降级）。 */
type ClipRowPayload = {
  id: string;
  content: string;
  source?: string;
  kind?: string;
  payloadKind?: string;
  tags?: string[];
  createdAt?: number;
  lastSeenAt?: number;
};

type QueryClipPayload = { items: ClipRowPayload[]; nextCursor: string | null; limit: number };

/** 日志级别筛选项（"" 表示全部）。 */
const LOG_LEVELS = ["", "error", "warn", "info", "debug"] as const;

/** 级别 → 文本色（静态查表；语义 token 映射，debug 用降透明度弱化）。 */
const LEVEL_CLASS: Record<string, string> = {
  error: "text-destructive font-medium",
  warn: "text-foreground font-medium",
  info: "text-muted-foreground",
  debug: "text-muted-foreground/60",
};

/** 时间戳 → 「M/D HH:mm:ss」；缺省显示占位符。 */
function formatTime(tsMs?: number): string {
  if (!tsMs) return "—";
  const d = new Date(tsMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const TH_CLASS = "sticky top-0 z-10 bg-background px-2.5 py-1.5 text-left font-medium text-muted-foreground";
const TD_CLASS = "border-t border-border/50 px-2.5 py-1.5 align-top";

/** 应用日志表：级别筛选 + 关键词过滤 + 手动刷新。 */
function AppLogsTable({ tr }: LogsDataTablesProps) {
  const [items, setItems] = useState<AppLogEntry[]>([]);
  const [level, setLevel] = useState<string>("");
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(
    async (nextText: string, nextLevel: string) => {
      setLoading(true);
      setError("");
      try {
        const payload = await invoke<QueryAppLogPayload>("query_app_logs", {
          text: nextText.trim() || null,
          level: nextLevel || null,
          limit: 300,
        });
        setItems(payload.items);
      } catch (cause) {
        setError(String(cause));
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void load("", "");
  }, [load]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <select
          value={level}
          onChange={(event) => {
            setLevel(event.target.value);
            void load(text, event.target.value);
          }}
          className="h-7 rounded-md border border-border/60 bg-background px-2 text-[12px] text-foreground"
          aria-label={tr("settings.logs.colLevel")}
        >
          {LOG_LEVELS.map((value) => (
            <option key={value || "all"} value={value}>
              {value ? value : tr("settings.logs.filterLevelAll")}
            </option>
          ))}
        </select>
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void load(text, level);
          }}
          placeholder={tr("settings.logs.searchPlaceholder")}
          className="h-7 min-w-0 flex-1 rounded-md border border-border/60 bg-background px-2 text-[12px] text-foreground placeholder:text-muted-foreground"
        />
        <Button variant="outline" size="sm" className="h-7 gap-1 px-2 text-[12px]" disabled={loading} onClick={() => void load(text, level)}>
          <RefreshCw size={12} className={loading ? "animate-spin" : undefined} />
          {tr("settings.logs.refresh")}
        </Button>
      </div>
      {error ? <p className="text-[12px] text-destructive">{tr("settings.logs.errorPrefix")}{error}</p> : null}
      <div className="thin-scroll max-h-[360px] overflow-auto rounded-md border border-border/60">
        <table className="w-full table-fixed border-collapse text-[12px]">
          <thead>
            <tr>
              <th className={`${TH_CLASS} w-[104px]`}>{tr("settings.logs.colTime")}</th>
              <th className={`${TH_CLASS} w-[52px]`}>{tr("settings.logs.colLevel")}</th>
              <th className={TH_CLASS}>{tr("settings.logs.colMessage")}</th>
              <th className={`${TH_CLASS} w-[30%]`}>{tr("settings.logs.colContext")}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((entry, index) => (
              <tr key={`${entry.tsMs}-${index}`} className="hover:bg-black/[0.03] dark:hover:bg-white/[0.04]">
                <td className={`${TD_CLASS} text-muted-foreground`}>{formatTime(entry.tsMs)}</td>
                <td className={`${TD_CLASS} ${LEVEL_CLASS[entry.level] ?? "text-muted-foreground"}`}>{entry.level}</td>
                <td className={`${TD_CLASS} mono break-all`}>{entry.message}</td>
                <td className={`${TD_CLASS} truncate text-muted-foreground/80`} title={entry.context}>{entry.context}</td>
              </tr>
            ))}
            {items.length === 0 && !loading ? (
              <tr>
                <td className={`${TD_CLASS} text-center text-muted-foreground`} colSpan={4}>{tr("settings.logs.emptyLogs")}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** 采集历史表：bucket=all 键集分页（nextCursor），展示内容预览/来源/类型/Tag。 */
function ClipsTable({ tr }: LogsDataTablesProps) {
  const [items, setItems] = useState<ClipRowPayload[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [started, setStarted] = useState(false);

  const load = useCallback(async (cursor: string | null, replace: boolean) => {
    setLoading(true);
    setError("");
    try {
      const payload = await invoke<QueryClipPayload>("search_clip_records", {
        input: { bucket: "all", limit: 50, cursor: cursor ?? undefined },
      });
      setItems((current) => (replace ? payload.items : [...current, ...payload.items]));
      setNextCursor(payload.nextCursor ?? null);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(null, true).finally(() => setStarted(true));
  }, [load]);

  return (
    <div className="flex flex-col gap-2">
      {error ? <p className="text-[12px] text-destructive">{tr("settings.logs.errorPrefix")}{error}</p> : null}
      <div className="thin-scroll max-h-[360px] overflow-auto rounded-md border border-border/60">
        <table className="w-full table-fixed border-collapse text-[12px]">
          <thead>
            <tr>
              <th className={`${TH_CLASS} w-[104px]`}>{tr("settings.logs.colTime")}</th>
              <th className={TH_CLASS}>{tr("settings.logs.colContent")}</th>
              <th className={`${TH_CLASS} w-[15%]`}>{tr("settings.logs.colSource")}</th>
              <th className={`${TH_CLASS} w-[22%]`}>{tr("settings.logs.colTags")}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((clip) => (
              <tr key={clip.id} className="hover:bg-black/[0.03] dark:hover:bg-white/[0.04]">
                <td className={`${TD_CLASS} text-muted-foreground`}>{formatTime(clip.createdAt ?? clip.lastSeenAt)}</td>
                <td className={`${TD_CLASS} truncate`} title={clip.content}>{clip.content}</td>
                <td className={`${TD_CLASS} truncate text-muted-foreground`} title={clip.source}>{clip.source || "—"}</td>
                <td className={TD_CLASS}>
                  <span className="flex flex-wrap gap-1">
                    {(clip.tags ?? []).map((tag) => (
                      <span key={tag} className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-foreground">{tag}</span>
                    ))}
                    {(clip.tags ?? []).length === 0 ? <span className="text-muted-foreground/60">—</span> : null}
                  </span>
                </td>
              </tr>
            ))}
            {items.length === 0 && started && !loading ? (
              <tr>
                <td className={`${TD_CLASS} text-center text-muted-foreground`} colSpan={4}>{tr("settings.logs.emptyClips")}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {nextCursor ? (
        <Button variant="outline" size="sm" className="h-7 self-center px-3 text-[12px]" disabled={loading} onClick={() => void load(nextCursor, false)}>
          {loading ? tr("settings.logs.loading") : tr("settings.logs.loadMore")}
        </Button>
      ) : null}
    </div>
  );
}

/** 双表容器：Tabs 切换「应用日志 / 采集历史」，切换即挂载对应表（首取数据在各自 effect 内触发）。 */
export function LogsDataTables({ tr }: LogsDataTablesProps) {
  return (
    <Tabs defaultValue="app-logs" className="gap-2">
      <TabsList>
        <TabsTrigger value="app-logs" className="text-[12px]">{tr("settings.logs.tabAppLogs")}</TabsTrigger>
        <TabsTrigger value="clips" className="text-[12px]">{tr("settings.logs.tabClips")}</TabsTrigger>
      </TabsList>
      <TabsContent value="app-logs" className="mt-0">
        <AppLogsTable tr={tr} />
      </TabsContent>
      <TabsContent value="clips" className="mt-0">
        <ClipsTable tr={tr} />
      </TabsContent>
    </Tabs>
  );
}
