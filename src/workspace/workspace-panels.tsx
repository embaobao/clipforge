import {
  AppWindow,
  BarChart3,
  ChevronDown,
  ChevronUp,
  Clipboard,
  Copy,
  ExternalLink,
  FileJson,
  FileText,
  Image,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Save,
  Sparkles,
  Tag,
  Table2,
  X,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { Component, useEffect, useMemo, useState } from "react";
import type { ErrorInfo, ReactNode } from "react";
import type { ClipItem, ClipPayloadKind } from "../App";
import { detectSensitiveEditorFields } from "../editor/sensitive";
import { applyEditorSuggestion, buildLocalEditorSuggestion } from "../editor/suggestions";
import { formatCommandError, type TranslationKey } from "../i18n";
import { getImagePath, type FilePathStatus } from "../services/clipboard";
import type { EditorSuggestionResult } from "../services/contracts";
import { analyzeSmartFormats } from "../smart-format";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";

type WorkspaceTr = (key: TranslationKey, params?: Record<string, string | number>) => string;

function getPayloadKindLabel(kind: ClipPayloadKind, tr: WorkspaceTr): string {
  switch (kind) {
    case "link":
      return tr("main.payloadKind.link");
    case "markdown":
      return "Markdown";
    case "code":
      return tr("main.payloadKind.code");
    case "command":
      return tr("main.payloadKind.command");
    case "html":
      return "HTML";
    case "rtf":
      return "RTF";
    case "file":
      return tr("main.payloadKind.file");
    case "image":
      return tr("main.payloadKind.image");
    case "json":
      return "JSON";
    case "chart":
      return tr("main.payloadKind.chart");
    case "table":
      return tr("main.payloadKind.table");
    default:
      return tr("main.payloadKind.text");
  }
}

function getPayloadKindIcon(kind: ClipPayloadKind) {
  switch (kind) {
    case "link":
      return ExternalLink;
    case "markdown":
      return FileText;
    case "code":
      return Copy;
    case "command":
      return Copy;
    case "html":
      return FileText;
    case "rtf":
      return FileText;
    case "file":
      return FileText;
    case "image":
      return Image;
    case "json":
      return FileJson;
    case "chart":
      return BarChart3;
    case "table":
      return Table2;
    default:
      return FileText;
  }
}

type ClipDetailWorkspaceProps = {
  clip: ClipItem | null;
  filePathStatuses?: Record<string, FilePathStatus>;
  links: string[];
  tr: WorkspaceTr;
  onBack: () => void;
  onCopy: (clip: ClipItem) => void;
  onCopyText: (text: string, source: string, context?: Record<string, unknown>) => void;
  onOpen: (clip: ClipItem) => void;
  onOpenPath?: (path: string) => void;
  onPasteText: (text: string, source: string, context?: Record<string, unknown>) => void;
  onPrevious?: () => void;
  onNext?: () => void;
  onSearchTag: (tag: string) => void;
  onUpdateContent: (
    clip: ClipItem,
    content: string,
    tags?: string[],
    context?: { sessionId: string; draftVersion: number },
  ) => Promise<ClipItem | void>;
  quickActions?: DetailQuickAction[];
};

export type DetailQuickAction = {
  id: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
};

type MultiAggregateWorkspaceProps = {
  items: ClipItem[];
  aggregatePreview: string;
  tr: WorkspaceTr;
  onBack: () => void;
  onCopy: () => void;
  onCopyItem: (clip: ClipItem) => void;
  onExportTable: () => void;
  onOpenItem: (clip: ClipItem) => void;
};

type EditorVariableRow = {
  key: string;
  type: string;
  example: string;
};

const droppedLinkLogKeys = new Set<string>();

function normalizeDetailTag(value: string): string | null {
  const tag = value.trim().replace(/^#/, "").replace(/^tag:/i, "").trim();
  if (!tag) return null;
  return tag.slice(0, 32);
}

function normalizeDetailTags(values: string[]) {
  const seen = new Set<string>();
  const tags: string[] = [];
  values.forEach((value) => {
    const tag = normalizeDetailTag(value);
    if (!tag) return;
    const key = tag.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    tags.push(tag);
  });
  return tags.slice(0, 12);
}

function compactInlineText(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

function extractDetailHashTags(content: string) {
  return normalizeDetailTags(
    Array.from(content.matchAll(/(^|[\s([{])#([\p{L}\p{N}_-]{1,32})/gu)).map((match) => match[2]),
  );
}

function clipImageSrc(clip: ClipItem) {
  const path = clip.imageFile || clip.thumbnailPath;
  return getImagePath(path);
}

function fileRowsFromClip(clip: ClipItem) {
  return clip.content
    .split(/\r?\n/)
    .map((path) => path.trim())
    .filter(Boolean);
}

function getDetailModeId(clip: ClipItem) {
  if (clip.analysis.attachment?.isImage) return "image";
  if (clip.kind === "markdown") return "markdown";
  if (clip.kind === "code") return "code";
  if (/^\s*[\[{]/.test(clip.content)) return "json";
  if (/\t/.test(clip.content) || /^\|.+\|$/m.test(clip.content)) return "table";
  if (clip.kind === "link") return "link";
  return "text";
}

function getDetailModeLabel(clip: ClipItem, tr: WorkspaceTr) {
  const mode = getDetailModeId(clip);
  if (mode === "markdown") return "Markdown";
  if (mode === "json") return "JSON";
  return tr(`main.detail.mode.${mode}` as TranslationKey);
}

function isLikelyMarkdown(clip: ClipItem) {
  return clip.kind === "markdown" || clip.analysis.isMarkdown || getDetailModeId(clip) === "markdown";
}

function isLikelyJson(clip: ClipItem) {
  return clip.payloadKind === "json" || getDetailModeId(clip) === "json";
}

function formatJsonPreview(content: string) {
  try {
    const value = JSON.parse(content);
    const formatted = JSON.stringify(value, null, 2);
    const root =
      Array.isArray(value)
        ? `Array(${value.length})`
        : value && typeof value === "object"
          ? `Object(${Object.keys(value as Record<string, unknown>).length})`
          : typeof value;
    return { formatted, root, error: "" };
  } catch (error) {
    return {
      formatted: content,
      root: "Invalid JSON",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function appendWorkspacePanelLog(level: "info" | "warn" | "error", message: string, context: Record<string, unknown>) {
  let contextText = "";
  try {
    contextText = JSON.stringify(context);
  } catch {
    contextText = String(context);
  }
  void invoke("append_app_log", { level, message, context: contextText }).catch(() => {
    // Logging must not break clipboard rendering.
  });
}

function getDetailRendererName(clip: ClipItem) {
  if (clip.analysis.attachment?.isImage && clip.analysis.attachment.targetType === "url") return "image-preview";
  if (clip.analysis.url || clip.kind === "link") return "link-preview";
  if (isLikelyMarkdown(clip)) return "markdown-preview";
  return "plain-text";
}

function getClipRenderDiagnostics(clip: ClipItem, extra: Record<string, unknown> = {}) {
  return {
    traceId: `detail_render_${clip.id}_${Date.now().toString(36)}`,
    contextSchema: "ClipDetailRenderDiagnostics.v1",
    businessChain: "quick-panel -> workspace-router -> detail-route -> ClipDetailWorkspace -> content-renderer",
    routePath: "/clip/$clipId",
    component: "ClipDetailWorkspace",
    renderer: getDetailRendererName(clip),
    clipId: clip.id,
    clipKind: clip.kind,
    payloadKind: clip.payloadKind,
    detailMode: getDetailModeId(clip),
    chars: clip.content.length,
    lines: clip.content.split(/\r?\n/).length,
    sourceAppName: clip.sourceApp?.name ?? "",
    sourceAppBundle: clip.sourceApp?.bundleId ?? "",
    hasAnalysisUrl: Boolean(clip.analysis.url),
    hasAttachment: Boolean(clip.analysis.attachment),
    isMarkdown: clip.analysis.isMarkdown,
    ...extra,
  };
}

function parseHttpUrl(value: string | null | undefined) {
  if (!value || !/^https?:\/\//i.test(value)) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function safeHttpUrls(values: string[]) {
  const seen = new Set<string>();
  return values.flatMap((value) => {
    const url = parseHttpUrl(value);
    if (!url || seen.has(url.href)) return [];
    seen.add(url.href);
    return [{ href: url.href, label: url.hostname.replace(/^www\./, "") }];
  });
}

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

function renderInlineText(text: string) {
  const parts = text.split(/(\[[^\]]+\]\([^)]+\)|https?:\/\/[^\s<>"')\]]+)/g).filter(Boolean);
  return parts.map((part, index) => {
    const mdLink = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (mdLink) {
      const url = parseHttpUrl(mdLink[2]);
      if (!url) return <span key={`${part}-${index}`}>{mdLink[1]}</span>;
      return (
        <a href={url.href} key={`${part}-${index}`} onClick={(event) => event.preventDefault()} title={url.href}>
          {mdLink[1]}
        </a>
      );
    }
    const url = parseHttpUrl(part);
    if (url) {
      return (
        <a href={url.href} key={`${part}-${index}`} onClick={(event) => event.preventDefault()} title={url.href}>
          {part}
        </a>
      );
    }
    return <span key={`${part}-${index}`}>{part}</span>;
  });
}

function MarkdownPreview({
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
    <div className="markdown-preview">
      {blocks.map((block, index) => {
        if (block.type === "space") return <div className="md-space" key={index} />;
        if (block.type === "heading") {
          const Tag = `h${Math.min(block.level ?? 2, 4)}` as "h1" | "h2" | "h3" | "h4";
          return <Tag key={index}>{renderInlineText(block.text)}</Tag>;
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
            <pre className="md-code" key={index}>
              <span className="md-code-toolbar">
                <span>{block.language || "code"}</span>
                <span className="md-code-actions">
                  <button type="button" onClick={() => onPasteCode(block.text, source, context)}>
                    <Clipboard size={11} />
                    粘贴代码
                  </button>
                  <button type="button" onClick={() => onCopyCode(block.text, source, context)}>
                    <Copy size={11} />
                    复制
                  </button>
                </span>
              </span>
              <code>{block.text}</code>
            </pre>
          );
        }
        if (block.type === "quote") return <blockquote key={index}>{renderInlineText(block.text)}</blockquote>;
        if (block.type === "list") return <p className="md-list" key={index}>{renderInlineText(block.text)}</p>;
        if (block.type === "table-row") {
          return (
            <div className="md-table-row" key={index}>
              {block.cells?.map((cell, cellIndex) => <span key={`${index}-${cellIndex}`}>{renderInlineText(cell)}</span>)}
            </div>
          );
        }
        return <p key={index}>{renderInlineText(block.text)}</p>;
      })}
    </div>
  );
}

class DetailContentBoundary extends Component<
  { children: ReactNode; clip: ClipItem; onBack: () => void; onCopy: (clip: ClipItem) => void; tr: WorkspaceTr },
  { failed: boolean; message: string }
> {
  state = { failed: false, message: "" };

  static getDerivedStateFromError(error: Error) {
    return { failed: true, message: error.message };
  }

  componentDidUpdate(previous: { clip: ClipItem }) {
    if (previous.clip.id !== this.props.clip.id && this.state.failed) {
      this.setState({ failed: false, message: "" });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Clip detail render failed", error, info.componentStack);
    appendWorkspacePanelLog(
      "error",
      "clip-detail-render-error",
      getClipRenderDiagnostics(this.props.clip, {
        errorMessage: error.message,
        errorName: error.name,
        componentStack: info.componentStack,
      }),
    );
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <div className="detail-render-fallback">
        <div className="panel-fallback">
          <FileText size={22} />
          <strong>{this.props.tr("main.detail.previewFailedTitle")}</strong>
          <span title={this.state.message}>{this.props.tr("main.detail.previewFailedBody")}</span>
          <div className="copy-layout-grid">
            <button type="button" onClick={() => this.props.onCopy(this.props.clip)}>
              {this.props.tr("main.detail.copyOriginal")}
            </button>
            <button type="button" onClick={this.props.onBack}>
              {this.props.tr("main.workspace.backToList")}
            </button>
          </div>
        </div>
        <pre>{this.props.clip.content}</pre>
      </div>
    );
  }
}

function LinkPreview({ clip, links, onOpen, tr }: { clip: ClipItem; links: string[]; onOpen: (clip: ClipItem) => void; tr: WorkspaceTr }) {
  const primaryUrl = parseHttpUrl(clip.analysis.url)?.href ?? parseHttpUrl(links[0])?.href ?? parseHttpUrl(clip.analysis.attachment?.target)?.href;
  return (
    <div className="link-preview">
      {primaryUrl ? (
        <div className="link-preview-card">
          <ExternalLink size={16} />
          <div>
            <strong>{clip.analysis.title || primaryUrl}</strong>
            <span>{primaryUrl}</span>
          </div>
          <button type="button" onClick={() => onOpen(clip)}>{tr("main.detail.open")}</button>
          <button type="button" onClick={() => navigator.clipboard.writeText(primaryUrl)}>{tr("main.detail.copyLink")}</button>
        </div>
      ) : null}
      <pre>{clip.content}</pre>
    </div>
  );
}

function JsonPreview({
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
    <div className={preview.error ? "json-preview has-error" : "json-preview"}>
      <div className="json-preview-toolbar">
        <span>
          <FileJson size={12} />
          {preview.error ? tr("main.detail.jsonRaw") : tr("main.detail.jsonFormatted")}
          <em>{preview.root}</em>
        </span>
        <button
          type="button"
          onClick={() =>
            onCopyText(preview.formatted, `json-preview:${clip.id}`, {
              businessChain: "quick-panel -> workspace-router -> detail-route -> json-preview -> copy-formatted",
              clipId: clip.id,
              chars: preview.formatted.length,
              valid: !preview.error,
            })
          }
        >
          <Copy size={11} />
          {tr("main.detail.copyFormatted")}
        </button>
      </div>
      {preview.error ? <p className="json-preview-error">{tr("main.detail.jsonParseFailed", { error: preview.error })}</p> : null}
      <pre><code>{preview.formatted}</code></pre>
    </div>
  );
}

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

function HtmlPreview({ clip, content, onCopy, tr }: { clip: ClipItem; content: string; onCopy: (clip: ClipItem) => void; tr: WorkspaceTr }) {
  const canPreview = content.trim().length > 0 && content.length <= 180_000;
  const srcDoc = useMemo(() => {
    try {
      return canPreview ? buildHtmlPreviewDocument(content) : "";
    } catch {
      return "";
    }
  }, [canPreview, content]);

  return (
    <div className="html-preview">
      <div className="html-preview-toolbar">
        <span>
          <FileText size={12} />
          {tr("main.detail.htmlPreview")}
        </span>
        <button type="button" onClick={() => onCopy(clip)}>
          <Copy size={11} />
          {tr("main.detail.copyOriginal")}
        </button>
      </div>
      {srcDoc ? (
        <iframe sandbox="" srcDoc={srcDoc} title={clip.analysis.title || "HTML preview"} />
      ) : (
        <div className="html-preview-fallback">
          <strong>{tr("main.detail.htmlPreviewFallback")}</strong>
          <pre>{content}</pre>
        </div>
      )}
    </div>
  );
}

function SmartFormatPanel({
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
    <div className="smart-format-panel" aria-label={tr("main.detail.smartFormatAria")}>
      <div className="smart-format-header">
        <FileJson size={12} />
        <span>{tr("main.detail.smartFormatTitle")}</span>
      </div>
      {analyses.map((analysis) => (
        <div className={analysis.error ? "smart-format-result has-error" : "smart-format-result"} key={analysis.kind}>
          <div>
            <strong>{analysis.label}</strong>
            {analysis.error ? <em>{analysis.error}</em> : null}
            {!analysis.error ? (
              <button
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
          {analysis.error ? null : <pre>{analysis.output}</pre>}
        </div>
      ))}
    </div>
  );
}

function DetailQuickEditor({
  content,
  draftVersion,
  error,
  hasChanges,
  isSaving,
  sessionId,
  suggestedTags,
  tags,
  variableRows,
  tr,
  onApplySuggestion,
  onApplySuggestionAndSave,
  onCancel,
  onChange,
  onTagsChange,
  onVariableDrawerOpen,
  onSave,
  onSaveAndPaste,
}: {
  content: string;
  draftVersion: number;
  error: string;
  hasChanges: boolean;
  isSaving: boolean;
  sessionId: string;
  suggestedTags: string[];
  tags: string[];
  variableRows: EditorVariableRow[];
  tr: WorkspaceTr;
  onApplySuggestion: (content: string, tags: string[]) => void;
  onApplySuggestionAndSave: (content: string, tags: string[]) => void;
  onCancel: () => void;
  onChange: (value: string) => void;
  onTagsChange: (tags: string[]) => void;
  onVariableDrawerOpen: () => void;
  onSave: () => void;
  onSaveAndPaste: () => void;
}) {
  const [tagInput, setTagInput] = useState("");
  const [showVariables, setShowVariables] = useState(false);
  const [suggestion, setSuggestion] = useState<EditorSuggestionResult | null>(null);
  const [suggestionError, setSuggestionError] = useState("");
  const [isSuggesting, setIsSuggesting] = useState(false);
  const sensitiveFindings = useMemo(() => detectSensitiveEditorFields(content), [content]);
  const addTag = (value: string) => {
    const tag = normalizeDetailTag(value);
    if (!tag) return;
    onTagsChange(normalizeDetailTags([...tags, tag]));
    setTagInput("");
  };
  const requestSuggestion = () => {
    setIsSuggesting(true);
    setSuggestionError("");
    try {
      setSuggestion(buildLocalEditorSuggestion({ sessionId, draftVersion, content, tags, suggestedTags }));
    } catch (error) {
      setSuggestionError(tr("main.detail.suggestionFailed", { error: error instanceof Error ? error.message : String(error) }));
    } finally {
      setIsSuggesting(false);
    }
  };
  const applySuggestion = (mode: "draft" | "save") => {
    if (!suggestion) return;
    const next = applyEditorSuggestion(content, tags, suggestion);
    if (mode === "save") {
      onApplySuggestionAndSave(next.content, next.tags);
    } else {
      onApplySuggestion(next.content, next.tags);
    }
  };
  return (
    <div className="detail-editor">
      <div className="detail-editor-toolbar">
        <span>
          {tr("main.detail.quickEdit")}
          <em>{tr("main.detail.editorStats", { chars: content.length, lines: content.split(/\r?\n/).length })}</em>
        </span>
        <div>
          <button type="button" onClick={onCancel}>
            <X size={11} />
            {tr("agent.action.cancel")}
          </button>
          <button disabled={isSuggesting} type="button" onClick={requestSuggestion}>
            <Sparkles size={11} />
            {isSuggesting ? tr("main.detail.analyzing") : tr("main.detail.suggest")}
          </button>
          <button
            type="button"
            onClick={() => {
              setShowVariables((current) => !current);
              if (!showVariables) onVariableDrawerOpen();
            }}
          >
            <FileJson size={11} />
            {tr("main.detail.variables")}
          </button>
          <button disabled={!hasChanges || isSaving || !content.trim()} type="button" onClick={onSave}>
            <Save size={11} />
            {isSaving ? tr("main.detail.saving") : tr("agent.action.save")}
          </button>
        </div>
      </div>
      <div className="detail-tag-editor" aria-label={tr("main.detail.editTags")}>
        <div className="detail-tag-scroll">
          {tags.map((tag) => (
            <button
              aria-label={tr("main.detail.removeTag", { tag })}
              className="detail-tag-chip removable"
              key={tag}
              onClick={() => onTagsChange(tags.filter((item) => item !== tag))}
              type="button"
            >
              <Tag size={10} />
              {tag}
              <X size={10} />
            </button>
          ))}
          <input
            aria-label={tr("main.detail.addTag")}
            className="detail-tag-input"
            onChange={(event) => setTagInput(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              addTag(tagInput);
            }}
            placeholder="#tag"
            value={tagInput}
          />
        </div>
        {suggestedTags.length ? (
          <div className="detail-tag-suggestions">
            {suggestedTags.map((tag) => (
              <button key={tag} onClick={() => addTag(tag)} type="button">
                #{tag}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {showVariables ? (
        <div className="detail-variable-drawer" aria-label={tr("main.detail.editVariables")}>
          <div className="detail-variable-head">
            <span>{tr("main.detail.sendScope")}</span>
            <em>{sensitiveFindings.length ? tr("main.detail.sensitiveSummaryOnly") : tr("main.detail.variablesVisibleThisSession")}</em>
          </div>
          <div className="detail-variable-grid">
            {variableRows.map((row) => (
              <div key={row.key}>
                <code>{row.key}</code>
                <span>{row.type}</span>
                <em>{row.example}</em>
              </div>
            ))}
          </div>
          {sensitiveFindings.length ? (
            <div className="detail-sensitive-row">
              {sensitiveFindings.map((finding) => (
                <span key={finding.kind}>{finding.label}</span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {suggestion ? (
        <div className="detail-suggestion-panel" aria-label={tr("main.detail.suggestionPreview")}>
          <div className="detail-suggestion-head">
            <span>
              <Sparkles size={12} />
              {tr("main.detail.smartSuggestion")}
              <em>{suggestion.riskLevel === "high" ? tr("main.detail.riskHigh") : suggestion.riskLevel === "medium" ? tr("main.detail.riskMedium") : tr("main.detail.riskLow")}</em>
            </span>
            <div>
              <button disabled={!suggestion.contentPatch && !suggestion.tagPatch} type="button" onClick={() => applySuggestion("draft")}>
                {tr("main.detail.applyToDraft")}
              </button>
              <button disabled={!suggestion.contentPatch && !suggestion.tagPatch || isSaving} type="button" onClick={() => applySuggestion("save")}>
                {tr("main.detail.applyAndSave")}
              </button>
            </div>
          </div>
          <p>{suggestion.rationale}</p>
          {suggestion.tagPatch ? (
            <div className="detail-suggestion-tags">
              {suggestion.tagPatch.add.map((tag) => (
                <span key={`add-${tag}`}>+ #{tag}</span>
              ))}
              {suggestion.tagPatch.remove.map((tag) => (
                <span className="remove" key={`remove-${tag}`}>- #{tag}</span>
              ))}
            </div>
          ) : null}
          {suggestion.contentPatch ? (
            <div className="detail-suggestion-diff" aria-label={tr("main.detail.contentChangePreview")}>
              <div>
                <span>{tr("main.detail.current")}</span>
                <pre className="detail-suggestion-preview">{content.slice(0, 1600)}</pre>
              </div>
              <div>
                <span>{tr("main.detail.suggested")}</span>
                <pre className="detail-suggestion-preview">{suggestion.contentPatch.preview}</pre>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      {suggestionError ? <p className="detail-editor-error" role="alert">{suggestionError}</p> : null}
      <textarea
        aria-label={tr("main.detail.editContent")}
        className="detail-editor-textarea"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (!(event.metaKey || event.ctrlKey)) return;
          if (event.key.toLowerCase() !== "s" && event.key !== "Enter") return;
          event.preventDefault();
          if (event.key === "Enter") {
            onSaveAndPaste();
          } else {
            onSave();
          }
        }}
        spellCheck={false}
        value={content}
      />
      {error ? <p className="detail-editor-error" role="alert">{error}</p> : null}
    </div>
  );
}

function AvailableFormatsRow({ clip, tr }: { clip: ClipItem; tr: WorkspaceTr }) {
  const formats = clip.availableFormats.length ? clip.availableFormats : [clip.primaryFormat];
  return (
    <div className="detail-format-row" aria-label={tr("main.detail.availableFormats")}>
      {formats.map((format) => (
        <span key={format}>{format}</span>
      ))}
    </div>
  );
}

function ImageFilePreview({ clip, tr, onOpenPath }: { clip: ClipItem; tr: WorkspaceTr; onOpenPath?: (path: string) => void }) {
  const src = clipImageSrc(clip);
  const name = clip.imageFile || clip.analysis.attachment?.name || clip.content;
  const openablePath = clip.imageFile || (clip.analysis.attachment?.targetType === "path" ? clip.analysis.attachment.target : "");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [actualSize, setActualSize] = useState(false);
  return (
    <div className="detail-binary-preview">
      <div className={actualSize ? "detail-image-stage actual-size" : "detail-image-stage"}>
        {src ? (
          <button className="detail-image-button" onClick={() => setPreviewOpen(true)} title={tr("main.detail.imagePreview")} type="button">
            <img alt={clip.analysis.title || name || "Clipboard image"} src={src} />
          </button>
        ) : (
          <span>{tr("main.payloadKind.image")}</span>
        )}
      </div>
      <div className="detail-image-actions">
        <button disabled={!src} onClick={() => setPreviewOpen(true)} type="button">
          <Image size={12} />
          {tr("main.detail.imagePreview")}
        </button>
        <button disabled={!src} onClick={() => setActualSize((current) => !current)} type="button">
          {actualSize ? tr("main.detail.imageFit") : tr("main.detail.imageActual")}
        </button>
        {openablePath && onOpenPath ? (
          <button onClick={() => onOpenPath(openablePath)} type="button">
            <ExternalLink size={12} />
            {tr("main.detail.openSystem")}
          </button>
        ) : null}
      </div>
      <div className="detail-binary-meta">
        <span>{clip.width && clip.height ? `${clip.width} x ${clip.height}` : tr("main.payloadKind.image")}</span>
        {clip.size ? <span>{Math.round(clip.size / 1024)} KB</span> : null}
        {name ? <span title={name}>{name}</span> : null}
      </div>
      <AvailableFormatsRow clip={clip} tr={tr} />
      {previewOpen && src ? (
        <div className="detail-image-lightbox" role="dialog" aria-modal="true" aria-label={tr("main.detail.imagePreview")}>
          <button className="detail-image-lightbox-close" onClick={() => setPreviewOpen(false)} type="button" aria-label={tr("main.detail.close")}>
            <X size={14} />
          </button>
          <img alt={clip.analysis.title || name || "Clipboard image"} src={src} />
        </div>
      ) : null}
    </div>
  );
}

function FileListPreview({
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
    <div className="detail-file-preview">
      <div className="detail-file-summary">
        <FileText size={13} />
        <span>{tr("main.detail.fileCount", { count: rows.length })}</span>
        {clip.fileTypes ? <em>{clip.fileTypes}</em> : null}
      </div>
      <div className="detail-file-list">
        {rows.map((path) => {
          const missing = filePathStatuses[path]?.exists === false;
          return (
          <button
            className={missing ? "is-missing" : undefined}
            disabled={missing || !onOpenPath}
            key={path}
            onClick={() => onOpenPath?.(path)}
            title={missing ? `${path} - ${tr("main.list.fileMissing")}` : path}
            type="button"
          >
            <FileText size={12} />
            <span>{path}</span>
          </button>
          );
        })}
      </div>
      <AvailableFormatsRow clip={clip} tr={tr} />
    </div>
  );
}

export function ClipDetailWorkspace({
  clip,
  filePathStatuses,
  links,
  tr,
  onBack,
  onCopy,
  onCopyText,
  onOpen,
  onOpenPath,
  onPasteText,
  onPrevious,
  onNext,
  onSearchTag,
  onUpdateContent,
  quickActions = [],
}: ClipDetailWorkspaceProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draftContent, setDraftContent] = useState("");
  const [draftTags, setDraftTags] = useState<string[]>([]);
  const [editError, setEditError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [editorSessionId, setEditorSessionId] = useState("");
  const [draftVersion, setDraftVersion] = useState(1);

  useEffect(() => {
    setDraftContent(clip?.content ?? "");
    setDraftTags(normalizeDetailTags(clip?.tags ?? []));
    setEditorSessionId(clip ? `editor_${clip.id}_${Date.now().toString(36)}` : "");
    setDraftVersion(1);
    setIsEditing(false);
    setEditError("");
    setIsSaving(false);
  }, [clip?.id, clip?.content, clip?.tags]);

  if (!clip) {
    return (
      <section className="workspace-page workspace-detail-page">
        <WorkspaceCrumb title={tr("main.detail.title")} onBack={onBack} tr={tr} />
        <div className="workspace-empty">{tr("main.detail.missing")}</div>
      </section>
    );
  }

  const mode = getDetailModeLabel(clip, tr);
  const imageUrl = clip.analysis.attachment?.isImage && clip.analysis.attachment.targetType === "url"
    ? clip.analysis.attachment.target
    : null;
  const hasDraftChanges =
    draftContent !== clip.content ||
    normalizeDetailTags(draftTags).join("\n").toLowerCase() !== normalizeDetailTags(clip.tags).join("\n").toLowerCase();
  const suggestedTags = extractDetailHashTags(draftContent).filter(
    (tag) => !draftTags.some((current) => current.toLowerCase() === tag.toLowerCase()),
  );
  const editorVariableRows = useMemo<EditorVariableRow[]>(
    () => [
      { key: "clip.id", type: "string", example: clip.id },
      { key: "clip.kind", type: "enum", example: clip.kind },
      { key: "clip.payloadKind", type: "enum", example: clip.payloadKind },
      { key: "clip.title", type: "string", example: compactInlineText(clip.analysis.title || tr("main.detail.clipContentFallback"), 44) },
      { key: "clip.tags", type: "string[]", example: draftTags.length ? draftTags.join(", ") : "[]" },
      { key: "editor.sessionId", type: "string", example: editorSessionId || `editor_${clip.id}` },
      { key: "editor.draftVersion", type: "number", example: String(draftVersion) },
      { key: "editor.content", type: "string", example: `${draftContent.length} chars` },
      { key: "editor.suggestedTags", type: "string[]", example: suggestedTags.length ? suggestedTags.join(", ") : "[]" },
      { key: "runtime.route", type: "string", example: "/clip/$clipId" },
    ],
    [clip, draftContent.length, draftTags, draftVersion, editorSessionId, suggestedTags],
  );
  const safeLinks = safeHttpUrls(links);
  const droppedLinkCount = links.length - safeLinks.length;
  const droppedLinkLogKey = `${clip.id}:${links.length}:${safeLinks.length}`;
  const confirmDiscardDraft = () => !hasDraftChanges || window.confirm(tr("main.detail.confirmDiscard"));
  const handleBack = () => {
    if (isEditing && !confirmDiscardDraft()) return;
    onBack();
  };
  const handleCancelEdit = () => {
    if (!confirmDiscardDraft()) return;
    setDraftContent(clip.content);
    setDraftTags(normalizeDetailTags(clip.tags));
    setEditError("");
    setIsEditing(false);
  };

  const saveDraftContent = async (
    afterSave: "stay" | "paste" = "stay",
    override?: { content: string; tags: string[] },
  ) => {
    const nextContent = override?.content ?? draftContent;
    const nextTags = normalizeDetailTags(override?.tags ?? draftTags);
    const nextHasChanges =
      nextContent !== clip.content ||
      nextTags.join("\n").toLowerCase() !== normalizeDetailTags(clip.tags).join("\n").toLowerCase();
    if (!nextContent.trim()) {
      setEditError(tr("main.detail.emptyContent"));
      return;
    }
    if (!nextHasChanges) {
      setIsEditing(false);
      return;
    }
    setIsSaving(true);
    setEditError("");
    try {
      await onUpdateContent(clip, nextContent, nextTags, {
        sessionId: editorSessionId || `editor_${clip.id}`,
        draftVersion,
      });
      setDraftContent(nextContent);
      setDraftTags(nextTags);
      setDraftVersion((current) => current + 1);
      if (afterSave === "paste") {
        onPasteText(nextContent, "detail-editor:save-and-paste", {
          businessChain: "detail -> compact-editor -> save_editor_draft -> paste",
          clipId: clip.id,
          sessionId: editorSessionId,
          draftVersion,
        });
      }
      setIsEditing(false);
    } catch (error) {
      setEditError(tr("main.detail.saveFailed", { error: formatCommandError(tr, error) }));
    } finally {
      setIsSaving(false);
    }
  };

  if (droppedLinkCount > 0 && !droppedLinkLogKeys.has(droppedLinkLogKey)) {
    droppedLinkLogKeys.add(droppedLinkLogKey);
    appendWorkspacePanelLog(
      "warn",
      "clip-detail-links-dropped",
      getClipRenderDiagnostics(clip, {
        rawLinkCount: links.length,
        safeLinkCount: safeLinks.length,
        droppedLinkCount,
      }),
    );
  }

  const menuActions = quickActions.filter((action) => action.id !== "open-target" && action.id !== "copy");

  return (
    <section className="workspace-page workspace-detail-page">
      <WorkspaceCrumb title={tr("main.detail.contentTitle")} subtitle={mode} onBack={handleBack} tr={tr}>
        <button
          aria-label={tr("main.detail.previous")}
          className="icon-button detail-nav-button"
          disabled={!onPrevious}
          onClick={onPrevious}
          title={tr("main.detail.previousShortcut")}
          type="button"
        >
          <ChevronUp size={14} />
        </button>
        <button
          aria-label={tr("main.detail.next")}
          className="icon-button detail-nav-button"
          disabled={!onNext}
          onClick={onNext}
          title={tr("main.detail.nextShortcut")}
          type="button"
        >
          <ChevronDown size={14} />
        </button>
        <button
          aria-label={isEditing ? tr("main.detail.editingContent") : tr("main.detail.editContent")}
          className={isEditing ? "detail-edit-button active" : "detail-edit-button"}
          onClick={() => {
            setDraftContent(clip.content);
            setDraftTags(normalizeDetailTags(clip.tags));
            setEditError("");
            setIsEditing(true);
          }}
          title={tr("main.detail.quickEditTooltip")}
          type="button"
        >
          <Pencil size={12} />
          <span>{isEditing ? tr("main.detail.editing") : tr("main.detail.edit")}</span>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="icon-button detail-more-button" type="button" aria-label={tr("main.detail.moreActions")} title={tr("main.detail.moreActions")}>
              <MoreHorizontal size={15} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="detail-action-menu" side="bottom" align="end" sideOffset={8}>
            <DropdownMenuLabel>{tr("main.detail.quickActions")}</DropdownMenuLabel>
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={() => void navigator.clipboard.writeText(`use clipf.get id=${clip.id}`)}>
                <Clipboard size={13} />
                <span>{tr("main.detail.copyMcp")}</span>
              </DropdownMenuItem>
              {clip.analysis.url || clip.analysis.attachment ? (
                <DropdownMenuItem onSelect={() => onOpen(clip)}>
                  <ExternalLink size={13} />
                  <span>{tr("main.detail.openContent")}</span>
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onSelect={() => onCopy(clip)}>
                <Copy size={13} />
                <span>{tr("main.detail.copyContent")}</span>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            {menuActions.length ? <DropdownMenuSeparator /> : null}
            {menuActions.length ? (
            <DropdownMenuGroup>
            {menuActions.map((action) => (
              <DropdownMenuItem
                disabled={action.disabled}
                key={action.id}
                onSelect={() => {
                  try {
                    action.onSelect();
                  } catch (error) {
                    appendWorkspacePanelLog("warn", "workspace-plugin-action-failed", {
                      actionId: action.id,
                      error: String(error),
                    });
                  }
                }}
              >
                {action.icon}
                <span>{action.label}</span>
              </DropdownMenuItem>
            ))}
            </DropdownMenuGroup>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </WorkspaceCrumb>

      <div className="detail-meta" aria-label={tr("main.detail.meta")}>
        <span className="clip-id-chip" title={clip.id}>
          ID {clip.id.slice(0, 8)}…{clip.id.slice(-6)}
        </span>
        <span className={`kind-chip ${clip.payloadKind}`} title={getPayloadKindLabel(clip.payloadKind, tr)}>
          {(() => {
            const Icon = getPayloadKindIcon(clip.payloadKind);
            return <Icon size={10} />;
          })()}
          <span>{getPayloadKindLabel(clip.payloadKind, tr)}</span>
        </span>
        {clip.sourceApp?.name ? (
          <span className="source-chip" title={clip.sourceApp.executablePath}>
            {clip.sourceApp.iconBase64 ? (
              <img alt="" className="source-icon" src={clip.sourceApp.iconBase64} />
            ) : (
              <AppWindow size={10} />
            )}
            <span>{clip.sourceApp.name}</span>
          </span>
        ) : null}
      </div>
      {clip.tags.length ? (
        <div className="detail-tag-row" aria-label={tr("main.detail.tagList")}>
          {clip.tags.map((tag) => (
            <button key={tag} onClick={() => onSearchTag(tag)} type="button">
              <Tag size={10} />
              #{tag}
            </button>
          ))}
        </div>
      ) : null}

      <DetailContentBoundary clip={clip} onBack={onBack} onCopy={onCopy} tr={tr}>
        <div className="detail-content">
          {isEditing ? (
            <DetailQuickEditor
              content={draftContent}
              draftVersion={draftVersion}
              error={editError}
              hasChanges={hasDraftChanges}
              isSaving={isSaving}
              sessionId={editorSessionId || `editor_${clip.id}`}
              suggestedTags={suggestedTags}
              tags={draftTags}
              variableRows={editorVariableRows}
              tr={tr}
              onApplySuggestion={(content, tags) => {
                setDraftContent(content);
                setDraftTags(normalizeDetailTags(tags));
                setDraftVersion((current) => current + 1);
                setEditError("");
              }}
              onApplySuggestionAndSave={(content, tags) => void saveDraftContent("stay", { content, tags })}
              onCancel={handleCancelEdit}
              onChange={(value) => {
                setDraftContent(value);
                if (editError) setEditError("");
              }}
              onTagsChange={setDraftTags}
              onVariableDrawerOpen={() => {
                const sensitive = detectSensitiveEditorFields(draftContent);
                appendWorkspacePanelLog("info", "editor-variable-snapshot", {
                  traceId: `editor_variable_${clip.id}_${Date.now().toString(36)}`,
                  contextSchema: "EditorVariableSnapshot.v1",
                  clipId: clip.id,
                  sessionId: editorSessionId || `editor_${clip.id}`,
                  draftVersion,
                  variableKeys: editorVariableRows.map((row) => row.key),
                  contentLength: draftContent.length,
                  tagCount: draftTags.length,
                  suggestedTagCount: suggestedTags.length,
                  sensitiveKinds: sensitive.map((finding) => finding.kind),
                });
              }}
              onSave={() => void saveDraftContent()}
              onSaveAndPaste={() => void saveDraftContent("paste")}
            />
          ) : clip.payloadKind === "image" ? (
            <ImageFilePreview clip={clip} tr={tr} onOpenPath={onOpenPath} />
          ) : clip.payloadKind === "file" ? (
            <FileListPreview clip={clip} filePathStatuses={filePathStatuses} tr={tr} onOpenPath={onOpenPath} />
          ) : imageUrl ? (
            <img src={imageUrl} alt={clip.analysis.title} />
          ) : clip.payloadKind === "html" ? (
            <HtmlPreview clip={clip} content={clip.content} onCopy={onCopy} tr={tr} />
          ) : clip.analysis.url || clip.kind === "link" ? (
            <LinkPreview clip={clip} links={links} onOpen={onOpen} tr={tr} />
          ) : isLikelyJson(clip) ? (
            <JsonPreview clip={clip} content={clip.content} onCopyText={onCopyText} tr={tr} />
          ) : isLikelyMarkdown(clip) ? (
            <MarkdownPreview clip={clip} content={clip.content} onCopyCode={onCopyText} onPasteCode={onPasteText} />
          ) : (
            <>
              <SmartFormatPanel clip={clip} content={clip.content} onCopyText={onCopyText} tr={tr} />
              <pre>{clip.content}</pre>
            </>
          )}
        </div>
      </DetailContentBoundary>

      {safeLinks.length ? (
        <div className="detail-link-grid" aria-label={tr("main.detail.linkList")}>
          {safeLinks.slice(0, 8).map((url) => (
            <button key={url.href} type="button" onClick={() => window.open(url.href, "_blank", "noopener,noreferrer")}>
              <ExternalLink size={12} />
              <span>{url.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function MultiAggregateWorkspace({
  aggregatePreview,
  items,
  tr,
  onBack,
  onCopy,
  onCopyItem,
  onExportTable,
  onOpenItem,
}: MultiAggregateWorkspaceProps) {
  const grouped = items.reduce<Record<string, ClipItem[]>>((acc, item) => {
    const key = getPayloadKindLabel(item.payloadKind, tr);
    acc[key] = acc[key] ?? [];
    acc[key].push(item);
    return acc;
  }, {});
  const totalChars = items.reduce((sum, item) => sum + item.content.length, 0);
  const linkCount = items.reduce((sum, item) => sum + (item.analysis.url ? 1 : 0), 0);

  return (
    <section className="workspace-page workspace-aggregate-page">
      <WorkspaceCrumb title={tr("main.aggregate.title")} subtitle={tr("main.aggregate.subtitle", { count: items.length, chars: totalChars })} onBack={onBack} tr={tr}>
        <button className="icon-button" onClick={onExportTable} type="button" aria-label={tr("main.aggregate.exportTable")}>
          <Table2 size={14} />
        </button>
        <button className="icon-button" onClick={onCopy} type="button" aria-label={tr("main.aggregate.copyContent")}>
          <Copy size={14} />
        </button>
      </WorkspaceCrumb>
      <div className="workspace-action-strip" aria-label={tr("main.aggregate.quickActions")}>
        <button type="button" onClick={onCopy}>
          <Copy size={13} />
          {tr("main.aggregate.copyAll")}
        </button>
        <button type="button" onClick={onExportTable}>
          <Table2 size={13} />
          {tr("main.aggregate.exportTable")}
        </button>
        <button type="button" disabled>
          <FileText size={13} />
          {tr("main.aggregate.template")}
        </button>
        <button type="button" disabled>
          <FileJson size={13} />
          {tr("main.aggregate.structure")}
        </button>
      </div>
      {items.length ? (
        <div className="aggregate-summary" aria-label={tr("main.aggregate.summary")}>
          <span><strong>{items.length}</strong> {tr("main.aggregate.items")}</span>
          <span><strong>{Object.keys(grouped).length}</strong> {tr("main.aggregate.kinds")}</span>
          <span><strong>{linkCount}</strong> {tr("main.aggregate.links")}</span>
        </div>
      ) : null}
      {items.length ? (
        <div className="aggregate-content" aria-label={tr("main.aggregate.content")}>
          <section className="aggregate-preview-block">
            <div className="aggregate-section-title">
              <strong>{tr("main.aggregate.raw")}</strong>
              <span>{tr("main.aggregate.rawHint")}</span>
            </div>
            <pre>{aggregatePreview}</pre>
          </section>

          {Object.entries(grouped).map(([group, groupItems]) => (
            <section className="aggregate-group" key={group}>
              <div className="aggregate-section-title">
                <strong>{group}</strong>
                <span>{tr("main.aggregate.itemCount", { count: groupItems.length })}</span>
              </div>
              <div className="aggregate-item-list">
                {groupItems.map((item) => {
                  const Icon = getPayloadKindIcon(item.payloadKind);
                  const links = safeHttpUrls([item.analysis.url ?? "", item.analysis.attachment?.target ?? ""]);
                  return (
                    <article className="aggregate-item" key={item.id}>
                      <header className="aggregate-item-head">
                        <span className={`kind-chip ${item.payloadKind}`}>
                          <Icon size={11} />
                          {getPayloadKindLabel(item.payloadKind, tr)}
                        </span>
                        <strong title={item.analysis.title}>{item.analysis.title || item.analysis.sourceName || tr("main.detail.clipContentFallback")}</strong>
                        <div className="aggregate-item-actions">
                          <button type="button" onClick={() => onOpenItem(item)}>
                            <FileJson size={12} />
                            {tr("main.detail.title")}
                          </button>
                          <button type="button" onClick={() => onCopyItem(item)}>
                            <Copy size={12} />
                            {tr("agent.action.copy")}
                          </button>
                        </div>
                      </header>
                      <div className="aggregate-item-body">
                        {item.analysis.url || item.kind === "link" ? (
                          <div className="aggregate-link-preview">
                            {links[0] ? (
                              <a href={links[0].href} onClick={(event) => event.preventDefault()} title={links[0].href}>
                                <ExternalLink size={12} />
                                {links[0].label}
                              </a>
                            ) : null}
                            <pre>{item.content}</pre>
                          </div>
                        ) : isLikelyMarkdown(item) ? (
                          <MarkdownPreview
                            clip={item}
                            content={item.content}
                            onCopyCode={(text) => navigator.clipboard.writeText(text)}
                            onPasteCode={(text) => navigator.clipboard.writeText(text)}
                          />
                        ) : (
                          <pre>{item.content}</pre>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="workspace-empty">{tr("main.aggregate.empty")}</div>
      )}
    </section>
  );
}

function WorkspaceCrumb({
  children,
  onBack,
  subtitle,
  title,
  tr,
}: {
  children?: React.ReactNode;
  onBack: () => void;
  subtitle?: string;
  title: string;
  tr: WorkspaceTr;
}) {
  return (
    <header className="workspace-crumb">
      <button className="icon-button subtle" onClick={onBack} type="button" aria-label={tr("main.workspace.backToList")}>
        <RotateCcw size={14} />
      </button>
      <div className="workspace-crumb-title">
        <strong>{title}</strong>
        {subtitle ? <em>{subtitle}</em> : null}
      </div>
      <div className="workspace-crumb-actions">
        {children}
        <button className="icon-button subtle" onClick={onBack} type="button" aria-label={tr("main.detail.close")}>
          <X size={14} />
        </button>
      </div>
    </header>
  );
}
