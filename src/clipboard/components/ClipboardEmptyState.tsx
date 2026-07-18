// 主面板列表空态组件（frontend-surface-architecture-refactor Phase B）
// 合并历史/收藏/搜索无结果 与 回收站 两处重复的空态 JSX，按 variant 切换图标与文案。
// 纯展示：不持有状态、不调用 handler；类名保持 `.empty-list` 不变以兼容 App.css，视觉零变化。
import { Inbox, Trash2 } from "lucide-react";
import type { TranslationKey } from "../../i18n";

/** 空态类型：history 覆盖历史/收藏/搜索无结果，trash 覆盖回收站。 */
export type ClipboardEmptyStateVariant = "history" | "trash";

export interface ClipboardEmptyStateProps {
  /** 空态类型。 */
  variant: ClipboardEmptyStateVariant;
  /** 搜索摘要文案；非空时历史态展示「无结果」标题，回收站态展示该摘要为正文。 */
  emptySummary: string | null;
  /** i18n 翻译函数。 */
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

/**
 * 剪贴板列表空态。
 * - history：有搜索摘要 → noMatchesTitle；否则 noClipboardTitle。正文优先用 emptySummary，否则 noClipboardBody。
 * - trash：固定 trashTitle，正文优先用 emptySummary，否则 trashBody。
 */
export function ClipboardEmptyState({ variant, emptySummary, tr }: ClipboardEmptyStateProps) {
  const isTrash = variant === "trash";
  const title = isTrash
    ? tr("main.empty.trashTitle")
    : emptySummary
      ? tr("main.empty.noMatchesTitle")
      : tr("main.empty.noClipboardTitle");
  const body = emptySummary ?? tr(isTrash ? "main.empty.trashBody" : "main.empty.noClipboardBody");
  return (
    <div className="empty-list">
      {isTrash ? <Trash2 size={30} /> : <Inbox size={30} />}
      <h2>{title}</h2>
      <p>{body}</p>
    </div>
  );
}

export default ClipboardEmptyState;
