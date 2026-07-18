// 主面板历史行内容预览（frontend-surface-architecture-refactor Phase B）
// 渲染行主文案 + AI 摘要/图片/文件徽标。纯展示：从 item 派生文案，事件冒泡不在此处理（行级 onClick 在 article）。
// 类名保持 .quick-content / .quick-line / .quick-media-* 不变以兼容 App.css，视觉零变化。
import { FileJson, Image as ImageIcon, Sparkles } from "lucide-react";
import type { ClipItem } from "../../App";
import type { ClipAiSummary } from "../../services/ai-summary";
import {
  getAiSummaryStatusLabel,
  getClipboardLine,
  getItemTooltip,
  splitLineForMiddleEllipsis,
  type TrFunction,
} from "../clipboard-domain";
import { AppTooltip } from "./AppTooltip";

export interface ClipboardContentPreviewProps {
  item: ClipItem;
  /** 文件类条目是否缺失（行级 isFileClipMissing 计算后传入）。 */
  fileMissing: boolean;
  /** 已存储的 AI 摘要，无则 null。 */
  aiSummary: ClipAiSummary | null;
  tr: TrFunction;
}

/** 历史行内容预览：AI 摘要徽标 + 图片/文件缩略 + middle-ellipsis 主文案（带 tooltip）。 */
export function ClipboardContentPreview({ item, fileMissing, aiSummary, tr }: ClipboardContentPreviewProps) {
  const parts = splitLineForMiddleEllipsis(getClipboardLine(item));
  return (
    <div className="quick-content">
      {aiSummary ? (
        <span className={`quick-ai-summary-badge ${aiSummary.status}`} title={getAiSummaryStatusLabel(aiSummary, tr)}>
          <Sparkles size={11} />
        </span>
      ) : null}
      {item.payloadKind === "image" ? (
        <span className="quick-media-thumb" title={item.imageFile ?? tr("main.searchSuggestion.image")}>
          <ImageIcon size={13} />
        </span>
      ) : item.payloadKind === "file" ? (
        <span className="quick-media-file" title={fileMissing ? tr("main.list.fileMissing") : (item.fileTypes ?? tr("main.searchSuggestion.file"))}>
          <FileJson size={13} />
          <em>{Math.max(1, item.content.split(/\r?\n/).filter(Boolean).length)}</em>
        </span>
      ) : null}
      {parts.split ? (
        <AppTooltip content={getItemTooltip(item, tr)}>
          <p className="quick-line quick-line-mid" aria-label={parts.full}>
            <span className="ql-head">{parts.head}</span>
            <span className="ql-tail">{parts.tail}</span>
          </p>
        </AppTooltip>
      ) : (
        <AppTooltip content={getItemTooltip(item, tr)}>
          <p className="quick-line" aria-label={parts.text}>{parts.text}</p>
        </AppTooltip>
      )}
    </div>
  );
}

export default ClipboardContentPreview;
