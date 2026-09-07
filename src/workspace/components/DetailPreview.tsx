import { Clipboard, Copy, ExternalLink, FileJson, FileText, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { ClipItem } from "../../App";
import { getFileNameFromPath } from "../../clipboard/clipboard-domain";
import { analyzeSmartFormats } from "../../smart-format";
import type { FilePathStatus } from "../../services/clipboard";
import {
  clipImageSrc,
  fileRowsFromClip,
  formatJsonPreview,
  parseHttpUrl,
  type WorkspaceTr,
} from "./workspace-detail-shared";

/** 把 Markdown 文本切成块（代码/标题/引用/列表/表格行/段落/空行），供 MarkdownPreview 逐块渲染。 */
function splitMarkdownBlocks(content: string) {
  const blocks: Array<{ type: string; text: string; language?: string; level?: number; cells?: string[] }> = [];
  const lines = content.split(/\r?\n/);
  let code: string[] = [];
  let language = "";
  let inCode = false;
  for (const line of lines) {
    const fence = line.match(/^```(\w+)?\s*$/);
    if (fence) {
      if (inCode) {
        blocks.push({ type: "code", text: code.join("\n"), language });
        code = [];
        language = "";
        inCode = false;
      } else {
        inCode = true;
        language = fence[1] ?? "";
      }
      continue;
    }
    if (inCode) {
      code.push(line);
      continue;
    }
    if (!line.trim()) {
      blocks.push({ type: "space", text: "" });
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      blocks.push({ type: "heading", text: heading[2], level: heading[1].length });
      continue;
    }
    if (/^\|.+\|$/.test(line.trim())) {
      const cells = line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
      if (!cells.every((cell) => /^:?-{3,}:?$/.test(cell))) {
        blocks.push({ type: "table-row", text: line, cells });
      }
      continue;
    }
    if (/^>\s+/.test(line)) {
      blocks.push({ type: "quote", text: line.replace(/^>\s+/, "") });
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      blocks.push({ type: "list", text: line.replace(/^[-*]\s+/, "") });
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      blocks.push({ type: "list", text: line.replace(/^\d+\.\s+/, "") });
      continue;
    }
    blocks.push({ type: "paragraph", text: line });
  }
  if (code.length) blocks.push({ type: "code", text: code.join("\n"), language });
  return blocks;
}

/** 行内文本渲染：识别 [md 链接] 与裸 URL 并转成可点击（但阻止默认跳转、仅提示）的 a 标签。 */
function renderInlineText(text: string) {
  const parts = text.split(/(\[[^\]]+\]\([^)]+\)|https?:\/\/[^\s<>"')\]]+)/g).filter(Boolean);
  return parts.map((part, index) => {
    const mdLink = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (mdLink) {
      const url = parseHttpUrl(mdLink[2]);
      if (!url) return <span key={`${part}-${index}`}>{mdLink[1]}</span>;
      return (
        <a className="text-primary underline underline-offset-2" href={url.href} key={`${part}-${index}`} onClick={(event) => event.preventDefault()} title={url.href}>
          {mdLink[1]}
        </a>
      );
    }
    const url = parseHttpUrl(part);
    if (url) {
      return (
        <a className="text-primary underline underline-offset-2" href={url.href} key={`${part}-${index}`} onClick={(event) => event.preventDefault()} title={url.href}>
          {part}
        </a>
      );
    }
    return <span key={`${part}-${index}`}>{part}</span>;
  });
}

/** Markdown 渲染视图：按块渲染，代码块带「粘贴/复制」快捷动作。 */
export function MarkdownPreview({
  clip,
  content,
  onCopyCode,
  onPasteCode,
}: {
  clip: ClipItem;
  content: string;
  onCopyCode: (text: string, source: string, context?: Record<string, unknown>) => void;
  onPasteCode: (text: string, source: string, context?: Record<string, unknown>) => void;
}) {
  const blocks = splitMarkdownBlocks(content);
  return (
    <div className="space-y-2 text-[13px] leading-relaxed">
      {blocks.map((block, index) => {
        if (block.type === "space") return <div className="h-2" key={index} />;
        if (block.type === "heading") {
          const Tag = `h${Math.min(block.level ?? 2, 4)}` as "h1" | "h2" | "h3" | "h4";
          return <Tag className="font-semibold text-foreground" key={index}>{renderInlineText(block.text)}</Tag>;
        }
        if (block.type === "code") {
          const source = `md-code:${clip.id}:${index}`;
          const context = {
            businessChain: "quick-panel -> workspace-router -> detail-route -> markdown-preview -> code-block-quick-paste",
            clipId: clip.id,
            blockIndex: index,
            language: block.language || "",
            chars: block.text.length,
            lines: block.text ? block.text.split(/\r?\n/).length : 0,
          };
          return (
            <pre className="overflow-auto rounded-lg bg-black/[0.03] text-[12px] dark:bg-white/[0.05]" key={index}>
              <span className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-1.5 text-[11px] text-muted-foreground">
                <span>{block.language || "code"}</span>
                <span className="flex items-center gap-1">
                  <button
                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-black/[0.05] dark:hover:bg-white/[0.08]"
                    onClick={() => onPasteCode(block.text, source, context)}
                    type="button"
                  >
                    <Clipboard size={11} />
                    粘贴代码
                  </button>
                  <button
                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-black/[0.05] dark:hover:bg-white/[0.08]"
                    onClick={() => onCopyCode(block.text, source, context)}
                    type="button"
                  >
                    <Copy size={11} />
                    复制
                  </button>
                </span>
              </span>
              <code className="block whitespace-pre-wrap break-words p-3">{block.text}</code>
            </pre>
          );
        }
        if (block.type === "quote") {
          return <blockquote className="border-l-2 border-border pl-3 text-muted-foreground" key={index}>{renderInlineText(block.text)}</blockquote>;
        }
        if (block.type === "list") return <p className="flex gap-2" key={index}><span aria-hidden="true">•</span><span>{renderInlineText(block.text)}</span></p>;
        if (block.type === "table-row") {
          return (
            <div className="flex gap-px overflow-hidden rounded border border-border/60 text-[12px]" key={index}>
              {block.cells?.map((cell, cellIndex) => (
                <span className="min-w-0 flex-1 truncate px-2 py-1" key={`${index}-${cellIndex}`}>{renderInlineText(cell)}</span>
              ))}
            </div>
          );
        }
        return <p key={index}>{renderInlineText(block.text)}</p>;
      })}
    </div>
  );
}

/** 链接类 clip 预览：主链接卡片 + 原文 pre。 */
export function LinkPreview({ clip, links, onOpen, tr }: { clip: ClipItem; links: string[]; onOpen: (clip: ClipItem) => void; tr: WorkspaceTr }) {
  const primaryUrl = parseHttpUrl(clip.analysis.url)?.href ?? parseHttpUrl(links[0])?.href ?? parseHttpUrl(clip.analysis.attachment?.target)?.href;
  return (
    <div className="space-y-2">
      {primaryUrl ? (
        <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-black/[0.02] p-3 dark:bg-white/[0.04]">
          <ExternalLink className="shrink-0 text-muted-foreground" size={16} />
          <div className="min-w-0 flex-1">
            <strong className="block truncate text-[13px]">{clip.analysis.title || primaryUrl}</strong>
            <span className="block truncate text-[11px] text-muted-foreground">{primaryUrl}</span>
          </div>
          <button
            className="h-7 shrink-0 rounded-md border border-border/60 px-2.5 text-[12px] hover:bg-black/[0.05] dark:hover:bg-white/[0.08]"
            onClick={() => onOpen(clip)}
            type="button"
          >
            {tr("main.detail.open")}
          </button>
          <button
            className="h-7 shrink-0 rounded-md border border-border/60 px-2.5 text-[12px] hover:bg-black/[0.05] dark:hover:bg-white/[0.08]"
            onClick={() => navigator.clipboard.writeText(primaryUrl)}
            type="button"
          >
            {tr("main.detail.copyLink")}
          </button>
        </div>
      ) : null}
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/[0.03] p-3 text-[12px] leading-relaxed dark:bg-white/[0.05]">{clip.content}</pre>
    </div>
  );
}

/** 大文本安全预览：超过阈值只渲染前 N 字符，避免选中即同步渲染 1MB+ 内容导致界面卡死。
 *  超长时给出「展开全部」按钮，按需再渲染完整内容（用户主动触发，不阻塞列表/复制）。 */
export function TruncatedPre({ clip, className }: { clip: ClipItem; className?: string }) {
  const MAX_PREVIEW_CHARS = 200_000;
  const [expanded, setExpanded] = useState(false);
  const total = clip.content.length;
  const truncated = total > MAX_PREVIEW_CHARS && !expanded;
  const shown = truncated ? clip.content.slice(0, MAX_PREVIEW_CHARS) : clip.content;
  return (
    <div className="space-y-2">
      <pre className={`whitespace-pre-wrap break-words rounded-lg bg-black/[0.03] p-3 text-[12px] leading-relaxed dark:bg-white/[0.05] ${className ?? ""}`}>{shown}</pre>
      {truncated ? (
        <button
          className="w-full rounded-md border border-dashed border-border px-3 py-1.5 text-[11px] text-muted-foreground hover:bg-black/[0.03] dark:hover:bg-white/[0.05]"
          onClick={() => setExpanded(true)}
          type="button"
        >
          内容过大（{total.toLocaleString()} 字符），仅显示前 {MAX_PREVIEW_CHARS.toLocaleString()} 字符，点击展开全部
        </button>
      ) : null}
    </div>
  );
}

/** JSON 预览：格式化/错误态 + 复制格式化结果。 */
export function JsonPreview({
  clip,
  content,
  onCopyText,
  tr,
}: {
  clip: ClipItem;
  content: string;
  onCopyText: (text: string, source: string, context?: Record<string, unknown>) => void;
  tr: WorkspaceTr;
}) {
  const preview = useMemo(() => formatJsonPreview(content), [content]);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <FileJson size={12} />
          {preview.error ? tr("main.detail.jsonRaw") : tr("main.detail.jsonFormatted")}
          <em className="not-italic opacity-70">{preview.root}</em>
        </span>
        <button
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border/60 px-2.5 text-[12px] hover:bg-black/[0.05] dark:hover:bg-white/[0.08]"
          onClick={() =>
            onCopyText(preview.formatted, `json-preview:${clip.id}`, {
              businessChain: "quick-panel -> workspace-router -> detail-route -> json-preview -> copy-formatted",
              clipId: clip.id,
              chars: preview.formatted.length,
              valid: !preview.error,
            })
          }
          type="button"
        >
          <Copy size={11} />
          {tr("main.detail.copyFormatted")}
        </button>
      </div>
      {preview.error ? <p className="text-[12px] text-destructive">{tr("main.detail.jsonParseFailed", { error: preview.error })}</p> : null}
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/[0.03] p-3 text-[12px] leading-relaxed dark:bg-white/[0.05]"><code>{preview.formatted}</code></pre>
    </div>
  );
}

/** 为 HTML 预览 iframe 包一层白底基础样式（沙箱内不继承外部 token）。 */
function buildHtmlPreviewDocument(content: string) {
  const style = `
    <style>
      :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      body { margin: 0; padding: 12px; color: #171717; background: #fff; font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
      img, video, canvas, svg { max-width: 100%; height: auto; }
      pre, code { white-space: pre-wrap; overflow-wrap: anywhere; }
      table { max-width: 100%; border-collapse: collapse; }
      td, th { border: 1px solid #e5e5e5; padding: 4px 6px; }
    </style>`;
  if (/<html[\s>]/i.test(content)) {
    return content.replace(/<head([^>]*)>/i, `<head$1><meta charset="utf-8">${style}`);
  }
  return `<!doctype html><html><head><meta charset="utf-8">${style}</head><body>${content}</body></html>`;
}

/** HTML 内容的 iframe 沙箱预览（>180KB 或空内容时降级为原文 pre）。 */
export function HtmlPreview({ clip, content, onCopy, tr }: { clip: ClipItem; content: string; onCopy: (clip: ClipItem) => void; tr: WorkspaceTr }) {
  const canPreview = content.trim().length > 0 && content.length <= 180_000;
  const srcDoc = useMemo(() => {
    try {
      return canPreview ? buildHtmlPreviewDocument(content) : "";
    } catch {
      return "";
    }
  }, [canPreview, content]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <FileText size={12} />
          {tr("main.detail.htmlPreview")}
        </span>
        <button
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border/60 px-2.5 text-[12px] hover:bg-black/[0.05] dark:hover:bg-white/[0.08]"
          onClick={() => onCopy(clip)}
          type="button"
        >
          <Copy size={11} />
          {tr("main.detail.copyOriginal")}
        </button>
      </div>
      {srcDoc ? (
        <iframe className="h-72 w-full rounded-lg border border-border/60 bg-white" sandbox="" srcDoc={srcDoc} title={clip.analysis.title || "HTML preview"} />
      ) : (
        <div className="space-y-2 rounded-lg border border-dashed border-border p-3">
          <strong className="text-[12px] text-muted-foreground">{tr("main.detail.htmlPreviewFallback")}</strong>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-[12px] leading-relaxed">{content}</pre>
        </div>
      )}
    </div>
  );
}

/** 智能格式识别面板：对内容做多格式解析（JSON/表格等），提供逐格式复制。 */
export function SmartFormatPanel({
  clip,
  content,
  onCopyText,
  tr,
}: {
  clip: ClipItem;
  content: string;
  onCopyText: (text: string, source: string, context?: Record<string, unknown>) => void;
  tr: WorkspaceTr;
}) {
  const analyses = useMemo(() => analyzeSmartFormats(content), [content]);
  if (!analyses.length) return null;
  return (
    <div aria-label={tr("main.detail.smartFormatAria")} className="space-y-2 rounded-lg border border-border/60 p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        <FileJson size={12} />
        <span>{tr("main.detail.smartFormatTitle")}</span>
      </div>
      {analyses.map((analysis) => (
        <div className="space-y-1" key={analysis.kind}>
          <div className="flex items-center gap-2">
            <strong className="text-[12px]">{analysis.label}</strong>
            {analysis.error ? <em className="text-[11px] text-destructive">{analysis.error}</em> : null}
            {!analysis.error ? (
              <button
                className="inline-flex h-6 items-center gap-1 rounded px-1.5 text-[11px] hover:bg-black/[0.05] dark:hover:bg-white/[0.08]"
                onClick={() =>
                  onCopyText(analysis.output, `smart-format:${analysis.kind}:${clip.id}`, {
                    businessChain: "detail -> smart-format -> copy-result",
                    clipId: clip.id,
                    kind: analysis.kind,
                    chars: analysis.output.length,
                  })
                }
                type="button"
              >
                <Copy size={11} />
                {tr("main.detail.copyResult")}
              </button>
            ) : null}
          </div>
          {analysis.error ? null : <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-black/[0.03] p-2 text-[11px] leading-relaxed dark:bg-white/[0.05]">{analysis.output}</pre>}
        </div>
      ))}
    </div>
  );
}

/** 可用剪贴板格式行（图片/文件预览底部共用）。 */
export function AvailableFormatsRow({ clip, tr }: { clip: ClipItem; tr: WorkspaceTr }) {
  const formats = clip.availableFormats.length ? clip.availableFormats : [clip.primaryFormat];
  return (
    <div aria-label={tr("main.detail.availableFormats")} className="flex flex-wrap gap-1">
      {formats.map((format) => (
        <span className="rounded bg-black/[0.04] px-1.5 py-0.5 text-[10px] text-muted-foreground dark:bg-white/[0.07]" key={format}>{format}</span>
      ))}
    </div>
  );
}

/** 图片详情只负责紧凑预览；扩展操作由详情页顶部的溢出菜单统一承载。 */
export function ImageFilePreview({
  actualSize,
  clip,
  onClosePreview,
  onOpenPreview,
  previewOpen,
  tr,
}: {
  actualSize: boolean;
  clip: ClipItem;
  onClosePreview: () => void;
  onOpenPreview: () => void;
  previewOpen: boolean;
  tr: WorkspaceTr;
}) {
  const src = clipImageSrc(clip);
  const path = clip.imageFile || clip.analysis.attachment?.target || clip.thumbnailPath || "";
  const name = getFileNameFromPath(path) || clip.analysis.attachment?.name || clip.analysis.title || clip.content;
  return (
    <div className="space-y-2">
      <div className={`flex min-h-32 items-center justify-center overflow-hidden rounded-lg border border-border/60 bg-black/[0.02] p-2 dark:bg-white/[0.04] ${actualSize ? "items-start" : ""}`}>
        {src ? (
          <button className="max-h-64 cursor-zoom-in" onClick={onOpenPreview} title={tr("main.detail.imagePreview")} type="button">
            <img alt={clip.analysis.title || name || "Clipboard image"} className={actualSize ? "max-w-none" : "max-h-64 max-w-full rounded object-contain"} src={src} />
          </button>
        ) : (
          <span className="text-[12px] text-muted-foreground">{tr("main.payloadKind.image")}</span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span>{clip.width && clip.height ? `${clip.width} x ${clip.height}` : tr("main.payloadKind.image")}</span>
        {clip.size ? <span>{Math.round(clip.size / 1024)} KB</span> : null}
        {name ? <span className="max-w-[240px] truncate" title={name}>{name}</span> : null}
        {path ? <span className="max-w-full truncate" title={path}>{path}</span> : null}
      </div>
      <AvailableFormatsRow clip={clip} tr={tr} />
      {previewOpen && src ? (
        <div aria-label={tr("main.detail.imagePreview")} aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-8" role="dialog">
          <button
            aria-label={tr("main.detail.close")}
            className="absolute right-4 top-4 rounded-md p-2 text-white/80 hover:bg-white/10"
            onClick={onClosePreview}
            type="button"
          >
            <X size={14} />
          </button>
          <img alt={clip.analysis.title || name || "Clipboard image"} className="max-h-full max-w-full object-contain" src={src} />
        </div>
      ) : null}
    </div>
  );
}

/** 文件列表预览：路径行（可点击打开、缺失置灰）+ 汇总 + 可用格式。 */
export function FileListPreview({
  clip,
  filePathStatuses = {},
  tr,
  onOpenPath,
}: {
  clip: ClipItem;
  filePathStatuses?: Record<string, FilePathStatus>;
  tr: WorkspaceTr;
  onOpenPath?: (path: string) => void;
}) {
  const rows = fileRowsFromClip(clip);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
        <FileText size={13} />
        <span>{tr("main.detail.fileCount", { count: rows.length })}</span>
        {clip.fileTypes ? <em className="not-italic opacity-70">{clip.fileTypes}</em> : null}
      </div>
      <div className="flex flex-col gap-1">
        {rows.map((path) => {
          const missing = filePathStatuses[path]?.exists === false;
          return (
            <button
              className={`flex items-center gap-1.5 truncate rounded-md px-2 py-1 text-left text-[12px] hover:bg-black/[0.04] dark:hover:bg-white/[0.07] ${missing ? "text-destructive/70 hover:bg-transparent dark:hover:bg-transparent" : ""}`}
              disabled={missing || !onOpenPath}
              key={path}
              onClick={() => onOpenPath?.(path)}
              title={missing ? `${path} - ${tr("main.list.fileMissing")}` : path}
              type="button"
            >
              <FileText className="shrink-0" size={12} />
              <span className="truncate">{path}</span>
            </button>
          );
        })}
      </div>
      <AvailableFormatsRow clip={clip} tr={tr} />
    </div>
  );
}
