import { AppWindow, ClipboardType, Copy, ExternalLink, Tag } from "lucide-react";
import type { ClipItem } from "../../App";
import { getPayloadKindIcon, getPayloadKindLabel, type WorkspaceTr } from "./workspace-detail-shared";

export type DetailMetaProps = {
  applicationContextSummary: string | null;
  clip: ClipItem;
  sourceAddress: string;
  tr: WorkspaceTr;
  onCopy: (clip: ClipItem) => void;
  onCopyPlain: (clip: ClipItem) => void;
  onCopyText: (text: string, source: string, context?: Record<string, unknown>) => void;
  onSearchTag: (tag: string) => void;
};

/** 详情页元信息区（只读态）：payload 类型/来源应用/标签摘要行、来源地址 + 快捷复制行、应用上下文摘要行。
 *  纯展示组件，动作通过回调上抛，由外壳统一处理。 */
export function DetailMeta({ applicationContextSummary, clip, sourceAddress, tr, onCopy, onCopyPlain, onCopyText, onSearchTag }: DetailMetaProps) {
  const KindIcon = getPayloadKindIcon(clip.payloadKind);
  const iconButtonClass = "inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-black/[0.05] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-white/[0.08]";
  return (
    <>
      <div aria-label={tr("main.detail.meta")} className="flex items-center justify-between gap-2 px-4 py-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-black/[0.04] px-2 py-0.5 text-[10px] dark:bg-white/[0.07]" title={getPayloadKindLabel(clip.payloadKind, tr)}>
            <KindIcon size={10} />
            <span>{getPayloadKindLabel(clip.payloadKind, tr)}</span>
          </span>
          {clip.sourceApp?.name ? (
            <span className="inline-flex min-w-0 items-center gap-1 rounded-full bg-black/[0.04] px-2 py-0.5 text-[10px] dark:bg-white/[0.07]" title={clip.sourceApp.executablePath}>
              {clip.sourceApp.iconBase64 ? (
                <img alt="" className="h-3 w-3 rounded-[3px]" src={clip.sourceApp.iconBase64} />
              ) : (
                <AppWindow size={10} />
              )}
              <span className="truncate">{clip.sourceApp.name}</span>
            </span>
          ) : null}
        </div>
        {clip.tags.length ? (
          <div aria-label={tr("main.detail.tagList")} className="flex shrink-0 items-center gap-1">
            {clip.tags.slice(0, 3).map((tag) => (
              <button className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[11px] text-muted-foreground hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.08]" key={tag} onClick={() => onSearchTag(tag)} type="button">
                <Tag size={10} />
                #{tag}
              </button>
            ))}
            {clip.tags.length > 3 ? <span className="text-[11px] text-muted-foreground">+{clip.tags.length - 3}</span> : null}
          </div>
        ) : null}
      </div>
      <div aria-label={tr("main.detail.meta")} className="flex items-center gap-2 border-y border-border/40 px-4 py-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 text-[12px] text-muted-foreground" title={sourceAddress || clip.analysis.sourceName}>
          <ExternalLink aria-hidden="true" className="shrink-0" size={12} />
          <span className="truncate">{sourceAddress || clip.analysis.sourceName || tr("main.detail.clipContentFallback")}</span>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            aria-label={tr("main.detail.copyContent")}
            className={iconButtonClass}
            data-tooltip={tr("main.detail.copyContent")}
            onClick={() => onCopy(clip)}
            title={tr("main.detail.copyContent")}
            type="button"
          >
            <Copy size={13} />
          </button>
          <button
            aria-label={tr("main.context.copyPlainTitle")}
            className={iconButtonClass}
            data-tooltip={tr("main.context.copyPlainTooltip")}
            disabled={clip.payloadKind === "image"}
            onClick={() => onCopyPlain(clip)}
            title={clip.payloadKind === "image" ? tr("main.context.copyPlainImageUnavailable") : tr("main.context.copyPlainTitle")}
            type="button"
          >
            <ClipboardType size={13} />
          </button>
          {sourceAddress ? (
            <button
              aria-label={tr("main.detail.copyAddress")}
              className={iconButtonClass}
              data-tooltip={tr("main.detail.copyAddress")}
              onClick={() =>
                onCopyText(sourceAddress, "detail:copy-source-address", {
                  clipId: clip.id,
                  sourceAddress,
                })
              }
              title={tr("main.detail.copyAddress")}
              type="button"
            >
              <ExternalLink size={13} />
            </button>
          ) : null}
        </div>
      </div>
      {applicationContextSummary ? (
        <div
          aria-label={tr("main.detail.appContext")}
          className="flex items-center gap-1.5 px-4 py-1 text-[11px] text-muted-foreground"
          title={applicationContextSummary}
        >
          <AppWindow aria-hidden="true" className="shrink-0" size={12} />
          <span className="truncate">{applicationContextSummary}</span>
        </div>
      ) : null}
    </>
  );
}
