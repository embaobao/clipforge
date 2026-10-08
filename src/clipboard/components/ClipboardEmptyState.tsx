// 主面板列表空态组件（design-spec 视觉层重构）
// 搜索无结果 / 回收站空态，提供新建片段入口。
import { SearchX } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { TranslationKey } from "../../i18n";

export type ClipboardEmptyStateVariant = "history" | "trash";

export interface ClipboardEmptyStateProps {
  variant: ClipboardEmptyStateVariant;
  emptySummary: string | null;
  /** 点击「新建片段」回调；未提供时按钮不可用。 */
  onCreateSnippet?: () => void;
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

/** 剪贴板列表空态。 */
export function ClipboardEmptyState({ variant, emptySummary, onCreateSnippet, tr }: ClipboardEmptyStateProps) {
  const isTrash = variant === "trash";
  const title = isTrash
    ? tr("main.empty.trashTitle")
    : emptySummary
      ? tr("main.empty.noMatchesTitle")
      : tr("main.empty.noClipboardTitle");
  const body = emptySummary ?? tr(isTrash ? "main.empty.trashBody" : "main.empty.noClipboardBody");

  return (
    <div className="flex flex-col items-center justify-center gap-2.5 py-12 text-center animate-in fade-in-0 duration-fast ease-enter">
      <div className="grid h-10 w-10 place-items-center rounded-full bg-black/[0.04] text-muted-foreground dark:bg-white/[0.07]">
        <SearchX className="h-4 w-4" strokeWidth={1.8} />
      </div>
      <div className="space-y-1">
        <h2 className="text-[13px] font-medium text-foreground">{title}</h2>
        <p className="max-w-[280px] text-[12px] text-muted-foreground">{body}</p>
      </div>
      {!isTrash ? (
        <Button
          className="mt-1 h-7 rounded-lg text-[12px]"
          disabled={!onCreateSnippet}
          onClick={onCreateSnippet}
          size="sm"
          variant="outline"
        >
          {tr("main.empty.createSnippet")} <span className="mono ml-1 text-muted-foreground">⌘N</span>
        </Button>
      ) : null}
    </div>
  );
}

export default ClipboardEmptyState;
