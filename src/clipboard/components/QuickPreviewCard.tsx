// 快速预览卡片：空格触发，悬浮于列表上方展示当前选中项完整内容。
// 图片条目渲染真实图像（文件名无意义），元信息改为尺寸/体积。
import { FileText, Image, Link2, Table2, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { ClipItem } from "../../App";
import { getClipImageSrc } from "../clipboard-domain";

export interface QuickPreviewCardProps {
  item: ClipItem;
  onPaste: (item: ClipItem, source?: string) => void;
  onCopyPlain: (item: ClipItem) => void;
  onFavorite: (item: ClipItem) => void;
  onClose: () => void;
}

function kindIcon(payloadKind: string) {
  switch (payloadKind) {
    case "image":
      return <Image className="h-3.5 w-3.5" strokeWidth={1.8} />;
    case "link":
      return <Link2 className="h-3.5 w-3.5" strokeWidth={1.8} />;
    case "table":
    case "chart":
      return <Table2 className="h-3.5 w-3.5" strokeWidth={1.8} />;
    case "file":
      return <FileText className="h-3.5 w-3.5" strokeWidth={1.8} />;
    default:
      return <Type className="h-3.5 w-3.5" strokeWidth={1.8} />;
  }
}

function formatTime(timestamp: number) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

/** 快速预览卡片：符合 design.md 规格 2。 */
export function QuickPreviewCard({ item, onPaste, onCopyPlain, onFavorite, onClose }: QuickPreviewCardProps) {
  const content = item.plainText || item.content || "";
  const imageSrc = getClipImageSrc(item);
  const dims = item.width && item.height ? `${item.width} × ${item.height}` : null;
  const sizeKb = item.size ? `${Math.round(item.size / 1024)} KB` : null;
  const meta = [
    item.sourceApp?.name || item.source,
    formatTime(item.createdAt),
    ...(imageSrc ? [dims, sizeKb].filter(Boolean) : [`${content.length.toLocaleString()} 字符`]),
  ].join(" · ");
  return (
    <div className="row-in mx-2 mt-2 rounded-[10px] bg-black/[0.03] p-3.5 dark:bg-white/[0.05]">
      <div className="flex items-start gap-3">
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] bg-black/[0.05] dark:bg-white/[0.08]">
          <span className="text-muted-foreground">{kindIcon(item.payloadKind)}</span>
        </div>
        <div className="min-w-0 flex-1">
          {imageSrc ? (
            <div className="flex max-h-56 items-center justify-center overflow-hidden rounded-[8px] bg-black/[0.03] dark:bg-white/[0.05]">
              <img
                alt={item.analysis.title || "Clipboard image"}
                className="max-h-56 max-w-full object-contain"
                draggable={false}
                src={imageSrc}
              />
            </div>
          ) : (
            <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-foreground">{content}</p>
          )}
          <p className="mono mt-1.5 text-[11px] text-muted-foreground/80">
            {meta}
          </p>
        </div>
      </div>
      <Separator className="mt-3 bg-black/[0.05] dark:bg-white/[0.07]" />
      <div className="mt-2.5 flex items-center gap-1.5">
        <Button
          className="h-6 rounded-md px-2 text-[11.5px]"
          size="sm"
          onClick={() => {
            onPaste(item, "preview");
            onClose();
          }}
        >
          粘贴 <span className="mono ml-1 opacity-60">⏎</span>
        </Button>
        <Button
          className="h-6 rounded-md px-2 text-[11.5px] text-muted-foreground"
          size="sm"
          variant="ghost"
          onClick={() => {
            onCopyPlain(item);
            onClose();
          }}
        >
          纯文本 <span className="mono ml-1 opacity-60">⇧⏎</span>
        </Button>
        <Button
          className="h-6 rounded-md px-2 text-[11.5px] text-muted-foreground"
          size="sm"
          variant="ghost"
          onClick={() => {
            onFavorite(item);
            onClose();
          }}
        >
          收藏 <span className="mono ml-1 opacity-60">⌘D</span>
        </Button>
      </div>
    </div>
  );
}

export default QuickPreviewCard;
