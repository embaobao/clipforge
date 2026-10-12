/** 采集原数据弹窗（设计 §2 弹窗两处之一）：来源 app / 来源地址 / 应用上下文 / 采集上下文 JSON。
 *  由来源 app chip 触发；overlay 点击 / Esc / ✕ 关闭，进出同路径（fade+scale，reduced-motion 退化 fade）。 */
import { AppWindow, Copy, ExternalLink, FileJson, X } from "lucide-react";
import { useEffect } from "react";
import type { ClipItem } from "../../../App";
import type { TranslationKey } from "../../../i18n";

export type CaptureOverlayProps = {
  clip: ClipItem;
  applicationContextSummary: string | null;
  sourceAddress: string;
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
  onClose: () => void;
  onCopyText: (text: string, source: string, context?: Record<string, unknown>) => void;
};

export function CaptureOverlay({
  clip,
  applicationContextSummary,
  sourceAddress,
  tr,
  onClose,
  onCopyText,
}: CaptureOverlayProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  const captureContextJson = JSON.stringify(clip.captureContext, null, 2);
  const fieldCount = Object.keys(clip.captureContext ?? {}).length;

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/20 p-6 transition-opacity duration-150 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none dark:bg-black/40"
      data-overlay="capture"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        aria-label={tr("main.detail.capture.title")}
        className="flex max-h-full w-full max-w-md flex-col overflow-hidden rounded-xl border border-border/60 bg-background shadow-xl transition-[opacity,transform] duration-150 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none"
        data-overlay-panel="capture"
        role="dialog"
      >
        <header className="flex items-center justify-between gap-2 border-b border-black/[0.05] px-4 py-2.5 dark:border-white/[0.07]">
          <h2 className="text-[13px] font-medium text-foreground">{tr("main.detail.capture.title")}</h2>
          <button
            aria-label={tr("main.detail.close")}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.08]"
            onClick={onClose}
            type="button"
          >
            <X size={14} />
          </button>
        </header>
        <div className="min-h-0 flex-1 space-y-3 overflow-auto p-4 text-[12px]">
          <section>
            <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {tr("main.detail.capture.sourceApp")}
            </p>
            <div className="flex items-center gap-2">
              {clip.sourceApp?.iconBase64 ? (
                <img alt="" className="h-4 w-4 rounded-[4px]" src={clip.sourceApp.iconBase64} />
              ) : (
                <AppWindow size={14} />
              )}
              <span className="min-w-0 flex-1 truncate">{clip.sourceApp?.name || tr("main.detail.capture.unknownSource")}</span>
            </div>
            {clip.sourceApp?.executablePath ? (
              <p className="mono mt-1 truncate text-[11px] text-muted-foreground" title={clip.sourceApp.executablePath}>
                {clip.sourceApp.executablePath}
              </p>
            ) : null}
          </section>
          <section>
            <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {tr("main.detail.capture.sourceAddress")}
            </p>
            {sourceAddress ? (
              <div className="flex items-center gap-2">
                <ExternalLink aria-hidden="true" className="shrink-0 text-muted-foreground" size={12} />
                <span className="min-w-0 flex-1 break-all" title={sourceAddress}>{sourceAddress}</span>
                <button
                  className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-border/60 px-1.5 text-[11px] transition-colors hover:bg-black/[0.05] dark:hover:bg-white/[0.08]"
                  onClick={() => onCopyText(sourceAddress, `detail:copy-source-address:${clip.id}`, { clipId: clip.id, sourceAddress })}
                  type="button"
                >
                  <Copy size={11} />
                  {tr("main.detail.action.copy")}
                </button>
              </div>
            ) : (
              <p className="text-muted-foreground">{tr("main.detail.clipContentFallback")}</p>
            )}
          </section>
          <section>
            <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {tr("main.detail.appContext")}
            </p>
            <p className="break-all" title={applicationContextSummary ?? undefined}>
              {applicationContextSummary || tr("main.detail.captureContextUnavailable")}
            </p>
          </section>
          <section>
            <div className="mb-1 flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                <FileJson size={11} />
                {tr("main.detail.captureContext")}
                <span className="mono normal-case">{fieldCount}</span>
              </p>
              <button
                className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-border/60 px-1.5 text-[11px] transition-colors hover:bg-black/[0.05] dark:hover:bg-white/[0.08]"
                onClick={() =>
                  onCopyText(captureContextJson, `detail:capture-context:${clip.id}`, {
                    businessChain: "workspace-router -> detail-route -> capture-context-json -> copy",
                    clipId: clip.id,
                    contextSchema: "ClipboardCaptureContext.v2",
                    chars: captureContextJson.length,
                  })
                }
                type="button"
              >
                <Copy size={11} />
                {tr("main.detail.copyCaptureContext")}
              </button>
            </div>
            <pre
              aria-label={tr("main.detail.captureContext")}
              className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/[0.03] p-3 text-[11px] leading-relaxed dark:bg-white/[0.05]"
            >
              <code>{captureContextJson}</code>
            </pre>
          </section>
        </div>
      </div>
    </div>
  );
}
