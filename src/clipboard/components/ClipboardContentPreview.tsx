// 主面板历史行内容预览（design-spec 视觉层重构）
// 仅渲染主文案与来源/时间元信息；事件冒泡保留在行级 article。
// 图片条目渲染真实缩略图（文件名对用户无意义），加载失败回退文件名文本。
import { useState } from "react";
import type { ClipItem } from "../../App";
import {
  getClipboardLine,
  getClipImageSrc,
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

// Intl.RelativeTimeFormat 构造昂贵（每行每次 render 都 new 一个是滚动/刷新卡顿来源之一），按 locale 缓存复用。
const rtfCache = new Map<string, Intl.RelativeTimeFormat>();
function getRelativeTimeFormat(locale: string): Intl.RelativeTimeFormat {
  let rtf = rtfCache.get(locale);
  if (!rtf) {
    rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    rtfCache.set(locale, rtf);
  }
  return rtf;
}

function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  const rtf = getRelativeTimeFormat(document.documentElement.lang || "zh-CN");
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

/** 行内图片缩略图：加载失败（文件已删/路径失效）时回退为文件名文本，不留破图占位。 */
function ClipRowThumb({
  density,
  src,
  text,
}: {
  density?: "dense" | "normal" | "comfortable";
  src: string;
  text: string;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <p className="truncate text-[13px] leading-tight tracking-[-0.005em] text-foreground">{text}</p>
    );
  }
  const heightClass = density === "comfortable" ? "h-8" : density === "dense" ? "h-6" : "h-7";
  return (
    <span className="flex min-w-0 items-center">
      <img
        alt={text}
        className={`${heightClass} w-auto max-w-[180px] rounded-[6px] bg-black/[0.03] object-cover ring-1 ring-black/[0.06] dark:bg-white/[0.06] dark:ring-white/[0.1]`}
        decoding="async"
        draggable={false}
        onError={() => setFailed(true)}
        src={src}
      />
    </span>
  );
}

/** 历史行内容预览：主文案 + 来源/时间元信息（带 tooltip）。 */
export function ClipboardContentPreview({ item, fileMissing, density, tr }: ClipboardContentPreviewProps) {
  const parts = splitLineForMiddleEllipsis(getClipboardLine(item));
  const showMeta = density !== "dense";
  const thumbSrc = getClipImageSrc(item, "thumb");
  const fullSrc = thumbSrc ? getClipImageSrc(item, "full") : null;
  const dims = item.width && item.height ? `${item.width}×${item.height}` : null;
  const meta = [
    fileMissing ? "文件缺失" : item.source || item.analysis.sourceName,
    ...(dims ? [dims] : []),
    formatRelativeTime(item.createdAt),
  ].join(" · ");
  const tooltip = getItemTooltip(item, tr);

  // 图片条目：缩略图为主（文件名无意义），单行布局「缩略图 + 元信息」，悬浮卡预览大图。
  if (thumbSrc) {
    const fallbackText = parts.split ? parts.full : parts.text;
    return (
      <div className="flex min-w-0 items-center gap-2.5">
        <AppTooltip
          content={tooltip}
          portal
          preview={<img alt={tooltip.title} decoding="async" draggable={false} src={fullSrc ?? thumbSrc} />}
        >
          <ClipRowThumb density={density} src={thumbSrc} text={fallbackText} />
        </AppTooltip>
        {showMeta ? (
          <p className="truncate text-[11px] text-muted-foreground/70" aria-label={meta}>
            {meta}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col justify-center leading-tight">
      {parts.split ? (
        <AppTooltip content={tooltip} portal>
          <p className="truncate text-[13px] leading-tight tracking-[-0.005em] text-foreground" aria-label={parts.full}>
            <span>{parts.head}</span>
            <span className="text-muted-foreground">{parts.tail}</span>
          </p>
        </AppTooltip>
      ) : (
        <AppTooltip content={tooltip} portal>
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
