import { Copy, ExternalLink, FileJson } from "lucide-react";
import type { ClipItem } from "../../App";
import { getPayloadKindIcon, getPayloadKindLabel, isLikelyMarkdown, safeHttpUrls, type WorkspaceTr } from "./workspace-detail-shared";
import { MarkdownPreview } from "./DetailPreview";

export type AggregateItemProps = {
  item: ClipItem;
  index: number;
  count: number;
  tr: WorkspaceTr;
  onOpenItem: (clip: ClipItem) => void;
  onCopyItem: (clip: ClipItem) => void;
};

/** 聚合页单条目卡片：序号 + 类型 chip + 标题 + 打开/复制动作 + 正文（链接/Markdown/纯文本）。 */
export function AggregateItem({ item, index, count, tr, onOpenItem, onCopyItem }: AggregateItemProps) {
  const Icon = getPayloadKindIcon(item.payloadKind);
  const links = safeHttpUrls([item.analysis.url ?? "", item.analysis.attachment?.target ?? ""]);
  return (
    <article className="space-y-2 rounded-lg border border-border/60 p-3" data-order={index + 1}>
      <header className="flex flex-wrap items-center gap-2">
        <span aria-label={tr("main.aggregate.itemPosition", { index: index + 1, count })} className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-black/[0.05] text-[10px] dark:bg-white/[0.09]">{index + 1}</span>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-black/[0.04] px-2 py-0.5 text-[10px] dark:bg-white/[0.07]">
          <Icon size={11} />
          {getPayloadKindLabel(item.payloadKind, tr)}
        </span>
        <strong className="min-w-0 flex-1 truncate text-[12px]" title={item.analysis.title}>{item.analysis.title || item.analysis.sourceName || tr("main.detail.clipContentFallback")}</strong>
        <div className="flex shrink-0 items-center gap-1">
          <button className="inline-flex h-6 items-center gap-1 rounded px-1.5 text-[11px] text-muted-foreground hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.08]" onClick={() => onOpenItem(item)} type="button">
            <FileJson size={12} />
            {tr("main.detail.title")}
          </button>
          <button className="inline-flex h-6 items-center gap-1 rounded px-1.5 text-[11px] text-muted-foreground hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.08]" onClick={() => onCopyItem(item)} type="button">
            <Copy size={12} />
            {tr("agent.action.copy")}
          </button>
        </div>
      </header>
      <div className="min-w-0">
        {item.analysis.url || item.kind === "link" ? (
          <div className="space-y-1">
            {links[0] ? (
              <a className="inline-flex items-center gap-1 text-[11px] text-primary underline underline-offset-2" href={links[0].href} onClick={(event) => event.preventDefault()} title={links[0].href}>
                <ExternalLink size={12} />
                {links[0].label}
              </a>
            ) : null}
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-black/[0.03] p-2 text-[11px] leading-relaxed dark:bg-white/[0.05]">{item.content}</pre>
          </div>
        ) : isLikelyMarkdown(item) ? (
          <MarkdownPreview
            clip={item}
            content={item.content}
            onCopyCode={(text) => navigator.clipboard.writeText(text)}
            onPasteCode={(text) => navigator.clipboard.writeText(text)}
          />
        ) : (
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-black/[0.03] p-2 text-[11px] leading-relaxed dark:bg-white/[0.05]">{item.content}</pre>
        )}
      </div>
    </article>
  );
}
