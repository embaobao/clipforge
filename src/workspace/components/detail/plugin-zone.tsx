/** 插件区（设计 §9，宿主侧落位）：tags 行右侧 ⌕ 钮 + 下拉（内置 AI 功能 + 队列 + 安装入口）。
 *  边界：AI 功能本体经 MCP 工具调用通道（PiAnalysisBar），插件运行时归 agent-plugin-runtime；
 *  本组件只交付落位、队列状态机（并发 2）与草稿产出路由的宿主 UI。 */
import { Plus, ScanSearch } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { TranslationKey } from "../../../i18n";

export type PluginQueueTask = {
  id: string;
  label: string;
  status: "running" | "queued" | "done";
};

export type PluginZoneProps = {
  runningCount: number;
  queue: PluginQueueTask[];
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
  /** AI 功能区（宿主内置第一个「插件」：pi 分析条精简形态）。 */
  aiSection: ReactNode;
};

/** 队列并发上限（提案定稿）。 */
export const PLUGIN_QUEUE_CONCURRENCY = 2;

export function PluginZone({ runningCount, queue, tr, aiSection }: PluginZoneProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  return (
    <div className="relative shrink-0" data-surface="detail-plugin-zone" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-label={tr("main.detail.plugin.zone")}
        className="relative inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-[color,background-color,border-color,transform] hover:bg-black/[0.05] hover:text-foreground active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 dark:hover:bg-white/[0.08]"
        data-plugin-trigger
        onClick={() => setOpen((current) => !current)}
        title={tr("main.detail.plugin.zone")}
        type="button"
      >
        <ScanSearch size={13} />
        {runningCount > 0 ? (
          <span
            className="absolute -right-0.5 -top-0.5 flex h-3 min-w-3 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] font-medium leading-none text-primary-foreground"
            data-plugin-queue-badge
          >
            {runningCount}
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          className="absolute right-0 top-7 z-40 w-72 origin-top-right rounded-lg border border-border/60 bg-background/95 p-2 shadow-lg backdrop-blur transition-[opacity,transform] duration-150 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-opacity plugin-popover-in"
          data-plugin-popover
          role="menu"
        >
          <p className="px-1.5 pb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {tr("main.detail.plugin.ai")}
          </p>
          {aiSection}
          <div className="my-1.5 h-px bg-black/[0.06] dark:bg-white/[0.08]" />
          <p className="px-1.5 pb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {tr("main.detail.plugin.queue")}
          </p>
          {queue.length ? (
            <ul className="max-h-32 space-y-0.5 overflow-auto" data-plugin-queue-list>
              {queue.map((task) => (
                <li className="flex items-center gap-2 px-1.5 py-1 text-[11px]" key={task.id}>
                  <span
                    aria-hidden="true"
                    className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                      task.status === "running"
                        ? "animate-pulse bg-primary"
                        : task.status === "queued"
                          ? "bg-muted-foreground/50"
                          : "bg-emerald-500"
                    }`}
                  />
                  <span className="min-w-0 flex-1 truncate">{task.label}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {task.status === "running"
                      ? tr("main.detail.plugin.running")
                      : task.status === "queued"
                        ? tr("main.detail.plugin.queued")
                        : tr("main.detail.plugin.done")}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-1.5 py-1 text-[11px] text-muted-foreground" data-plugin-queue-empty>
              {tr("main.detail.plugin.queueEmpty")}
            </p>
          )}
          <div className="my-1.5 h-px bg-black/[0.06] dark:bg-white/[0.08]" />
          <button
            className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-black/[0.04] hover:text-foreground dark:hover:bg-white/[0.07]"
            data-plugin-install
            disabled
            title={tr("main.detail.plugin.installHint")}
            type="button"
          >
            <Plus size={12} />
            {tr("main.detail.plugin.install")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
