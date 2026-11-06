/** meta 单行（设计 §1 层③）：静态类型 chip + 来源 app chip（点击=采集原数据弹窗）
 *  + tags 横滚（四源色点 provenance）+ 右端插件区。编辑态 tags 行内编辑挂插件区左侧，路径行编辑态隐藏。 */
import { AppWindow, Tag, X } from "lucide-react";
import type { ReactNode } from "react";
import type { ClipItem } from "../../../App";
import type { TranslationKey } from "../../../i18n";
import { getPayloadKindIcon, getPayloadKindLabel, normalizeDetailTag, normalizeDetailTags } from "../workspace-detail-shared";
import { tagSourceDotClass, tagSourceLabelKey, type TagProvenanceMap } from "./tag-provenance";
export type DetailMetaRowProps = {
  clip: ClipItem;
  editing: boolean;
  draftTags: string[];
  suggestedTags: string[];
  provenance: TagProvenanceMap;
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
  onSearchTag: (tag: string) => void;
  onTagsChange: (tags: string[]) => void;
  onOpenCaptureDialog: () => void;
  /** 插件区（⌕ AI 下拉 + 队列角标）由外壳注入。 */
  pluginZone?: ReactNode;
};

export function DetailMetaRow({
  clip,
  editing,
  draftTags,
  provenance,
  suggestedTags,
  tr,
  onSearchTag,
  onTagsChange,
  onOpenCaptureDialog,
  pluginZone,
}: DetailMetaRowProps) {
  const KindIcon = getPayloadKindIcon(clip.payloadKind);
  const tagInputId = "detail-tag-input";
  const addTag = (value: string) => {
    const tag = normalizeDetailTag(value);
    if (!tag) return;
    onTagsChange(normalizeDetailTags([...draftTags, tag]));
  };
  return (
    <div
      aria-label={tr("main.detail.meta")}
      className="flex min-w-0 items-center gap-1.5 border-b border-black/[0.05] px-4 py-1.5 dark:border-white/[0.07]"
      data-surface="detail-meta-row"
    >
      {/* 静态类型 chip：只承担类型信息展示（下拉缓做，提案非目标） */}
      <span
        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-black/[0.04] px-2 py-0.5 text-[10px] dark:bg-white/[0.07]"
        data-meta-chip="kind"
        title={getPayloadKindLabel(clip.payloadKind, tr)}
      >
        <KindIcon size={10} />
        <span>{getPayloadKindLabel(clip.payloadKind, tr)}</span>
      </span>
      {/* 来源 app chip：点击 = 采集原数据弹窗（弹窗仅两处之一，设计 §2） */}
      <button
        className="inline-flex min-w-0 shrink-0 items-center gap-1 rounded-full bg-black/[0.04] px-2 py-0.5 text-[10px] transition-[color,background-color,border-color,transform] hover:bg-black/[0.08] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 dark:bg-white/[0.07] dark:hover:bg-white/[0.12]"
        data-meta-chip="source-app"
        onClick={onOpenCaptureDialog}
        title={clip.sourceApp?.executablePath || clip.sourceApp?.name || tr("main.detail.capture.title")}
        type="button"
      >
        {clip.sourceApp?.iconBase64 ? (
          <img alt="" className="h-3 w-3 rounded-[3px]" src={clip.sourceApp.iconBase64} />
        ) : (
          <AppWindow size={10} />
        )}
        <span className="max-w-32 truncate">{clip.sourceApp?.name || tr("main.detail.capture.unknownSource")}</span>
      </button>
      <span aria-hidden="true" className="h-3.5 w-px shrink-0 bg-black/[0.08] dark:bg-white/[0.12]" />
      {/* tags：浏览态点击=搜索；编辑态 × 删 + 回车加 + 建议 chips 点选 */}
      <div
        aria-label={tr("main.detail.tagList")}
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {editing ? (
          <>
            {draftTags.map((tag) => (
              <button
                aria-label={tr("main.detail.removeTag", { tag })}
                className="inline-flex shrink-0 items-center gap-1 rounded-full bg-black/[0.05] py-0.5 pl-2 pr-1.5 text-[11px] transition-[color,background-color,border-color,transform] hover:bg-black/[0.09] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 dark:bg-white/[0.09] dark:hover:bg-white/[0.15]"
                key={tag}
                onClick={() => onTagsChange(draftTags.filter((item) => item !== tag))}
                type="button"
              >
                <Tag size={10} />
                {tag}
                <X size={10} />
              </button>
            ))}
            <input
              aria-label={tr("main.detail.addTag")}
              className="h-6 w-20 shrink-0 bg-transparent text-[11px] outline-none placeholder:text-muted-foreground/60"
              data-tag-input
              id={tagInputId}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                addTag(event.currentTarget.value);
                event.currentTarget.value = "";
              }}
              placeholder="#tag"
              type="text"
            />
            {suggestedTags.map((tag) => (
              <button
                className="inline-flex shrink-0 items-center rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] text-muted-foreground transition-[color,background-color,border-color,transform] hover:bg-black/[0.04] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 dark:hover:bg-white/[0.07]"
                data-tag-suggestion={tag}
                key={tag}
                onClick={() => addTag(tag)}
                type="button"
              >
                #{tag}
              </button>
            ))}
          </>
        ) : (
          clip.tags.map((tag) => {
            const source = provenance[tag]?.source ?? "heuristic";
            return (
              <button
                className="inline-flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-[11px] text-muted-foreground transition-[color,background-color,border-color,transform] hover:bg-black/[0.05] hover:text-foreground active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 dark:hover:bg-white/[0.08]"
                data-tag-chip={tag}
                data-tag-source={source}
                key={tag}
                onClick={() => onSearchTag(tag)}
                title={`${tag} · ${tr(tagSourceLabelKey[source])}`}
                type="button"
              >
                <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${tagSourceDotClass[source]}`} data-tag-source-dot />
                #{tag}
              </button>
            );
          })
        )}
      </div>
      {/* 插件区：⌕ AI 下拉 + 队列角标（tags 行右侧，v7 定稿落位） */}
      {pluginZone}
    </div>
  );
}
