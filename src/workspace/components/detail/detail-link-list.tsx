/** 详情页链接尾部区块（设计 §1 层④附属）：浏览态列出安全 HTTP 链接（最多 12 条），编辑/diff 态隐藏。
 *  独立组件便于外壳保持 ≤500 行与复用安全链接渲染。 */
import type { TranslationKey } from "../../../i18n";

export type DetailLinkListProps = {
  links: Array<{ href: string; label: string }>;
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
};

export function DetailLinkList({ links, tr }: DetailLinkListProps) {
  if (!links.length) return null;
  return (
    <div className="mt-3 shrink-0">
      <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        {tr("main.detail.linkList")}
        <span className="mono">{links.length}</span>
      </p>
      <div aria-label={tr("main.detail.linkList")} className="flex flex-wrap gap-1.5">
        {links.slice(0, 12).map((url) => (
          <button
            className="flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-md border border-black/[0.06] bg-black/[0.02] px-2 text-[12px] text-foreground transition-colors hover:bg-black/[0.05] dark:border-white/[0.09] dark:bg-white/[0.04] dark:hover:bg-white/[0.08]"
            key={url.href}
            onClick={() => window.open(url.href, "_blank", "noopener,noreferrer")}
            title={url.href}
            type="button"
          >
            <span className="truncate">{url.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
