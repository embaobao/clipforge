/** 来源路径行（浏览态）：等宽路径 chip + 复制钮 + ⇧⌘C；无路径整行隐藏（设计 §1 层②）。
 *  复制成功后就地置换「已复制」反馈（reduced-motion 安全，无位移动画）。 */
import { FolderDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { TranslationKey } from "../../../i18n";

export type DetailPathRowProps = {
  path: string;
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
  onCopyPath: (path: string) => void;
};

const COPIED_FEEDBACK_MS = 900;

export function DetailPathRow({ path, tr, onCopyPath }: DetailPathRowProps) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
  }, []);

  const handleCopy = () => {
    onCopyPath(path);
    setCopied(true);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
  };

  return (
    <div className="flex items-center gap-1.5 px-4 pt-2" data-surface="detail-path-row">
      <FolderDown aria-hidden="true" className="shrink-0 text-muted-foreground" size={12} />
      <button
        className="mono min-w-0 flex-1 truncate rounded-md bg-black/[0.03] px-2 py-0.5 text-left text-[11px] text-muted-foreground transition-colors hover:bg-black/[0.06] hover:text-foreground dark:bg-white/[0.05] dark:hover:bg-white/[0.09]"
        onClick={handleCopy}
        title={path}
        type="button"
      >
        {path}
      </button>
      <button
        aria-label={tr("main.detail.action.copyPathTitle")}
        className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] text-muted-foreground transition-[color,background-color,border-color,transform] hover:bg-black/[0.05] hover:text-foreground active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 dark:hover:bg-white/[0.08]"
        data-tooltip={tr("main.detail.action.copyPathTitle")}
        onClick={handleCopy}
        title={tr("main.detail.action.copyPathTitle")}
        type="button"
      >
        {copied ? tr("main.detail.pathCopied") : tr("main.detail.action.copyPath")}
      </button>
    </div>
  );
}
