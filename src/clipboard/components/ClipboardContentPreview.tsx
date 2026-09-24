// 主面板历史行内容预览（design-spec 视觉层重构）
// 仅渲染主文案与来源/时间元信息；事件冒泡保留在行级 article。
import type { ClipItem } from "../../App";
import {
  getClipboardLine,
  getItemTooltip,
  splitLineForMiddleEllipsis,
  type TrFunction,
} from "../clipboard-domain";
import { AppTooltip } from "./AppTooltip";

export interface ClipboardContentPreviewProps {
  item: ClipItem;
  /** 文件类条目是否缺失。 */
  fileMissing: boolean;
  /** 当前密度；compact 时隐藏元信息以节省高度。 */
  density?: "dense" | "normal" | "comfortable";
  tr: TrFunction;
}

function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  const rtf = new Intl.RelativeTimeFormat(document.documentElement.lang || "zh-CN", {
    numeric: "auto",
  });
  if (seconds < 60) return rtf.format(-Math.max(1, seconds), "second");
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return rtf.format(-minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return rtf.format(-hours, "hour");
  const days = Math.floor(hours / 24);
  if (days < 7) return rtf.format(-days, "day");
  const date = new Date(timestamp);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

/** 历史行内容预览：主文案 + 来源/时间元信息（带 tooltip）。 */
export function ClipboardContentPreview({ item, fileMissing, density, tr }: ClipboardContentPreviewProps) {
  const parts = splitLineForMiddleEllipsis(getClipboardLine(item));
  const showMeta = density !== "dense";
  const meta = [
    fileMissing ? "文件缺失" : item.source || item.analysis.sourceName,
    formatRelativeTime(item.createdAt),
  ].join(" · ");

  return (
    <div className="flex min-w-0 flex-col justify-center leading-tight">
      {parts.split ? (
        <AppTooltip content={getItemTooltip(item, tr)} portal>
          <p className="truncate text-[13px] leading-tight tracking-[-0.005em] text-foreground" aria-label={parts.full}>
            <span>{parts.head}</span>
            <span className="text-muted-foreground">{parts.tail}</span>
          </p>
        </AppTooltip>
      ) : (
        <AppTooltip content={getItemTooltip(item, tr)} portal>
          <p className="truncate text-[13px] leading-tight tracking-[-0.005em] text-foreground" aria-label={parts.text}>
            {parts.text}
          </p>
        </AppTooltip>
      )}
      {showMeta ? (
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground/70" aria-label={meta}>
          {meta}
        </p>
      ) : null}
    </div>
  );
}

export default ClipboardContentPreview;
