import {
  AppWindow,
  BarChart3,
  Clipboard,
  Copy,
  ExternalLink,
  FileJson,
  FileText,
  Image,
  Pencil,
  RotateCcw,
  Save,
  Tag,
  Table2,
  X,
} from "lucide-react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { Component, useEffect, useMemo, useState } from "react";
import type { ErrorInfo, ReactNode } from "react";
import type { ClipItem, ClipPayloadKind } from "../App";

function getPayloadKindLabel(kind: ClipPayloadKind): string {
  switch (kind) {
    case "link":
      return "链接";
    case "markdown":
      return "Markdown";
    case "code":
      return "代码";
    case "command":
      return "命令";
    case "html":
      return "HTML";
    case "rtf":
      return "RTF";
    case "file":
      return "文件";
    case "image":
      return "图片";
    case "json":
      return "JSON";
    case "chart":
      return "图表";
    case "table":
      return "表格";
    default:
      return "文本";
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
  links: string[];
  onBack: () => void;
  onCopy: (clip: ClipItem) => void;
  onCopyText: (text: string, source: string, context?: Record<string, unknown>) => void;
  onOpen: (clip: ClipItem) => void;
  onPasteText: (text: string, source: string, context?: Record<string, unknown>) => void;
  onSearchTag: (tag: string) => void;
  onUpdateContent: (clip: ClipItem, content: string, tags?: string[]) => Promise<ClipItem | void>;
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
  onBack: () => void;
  onCopy: () => void;
  onCopyItem: (clip: ClipItem) => void;
  onExportTable: () => void;
  onOpenItem: (clip: ClipItem) => void;
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

function extractDetailHashTags(content: string) {
  return normalizeDetailTags(
    Array.from(content.matchAll(/(^|[\s([{])#([\p{L}\p{N}_-]{1,32})/gu)).map((match) => match[2]),
  );
}

function clipImageSrc(clip: ClipItem) {
  const path = clip.imageFile || clip.thumbnailPath;
  if (!path) return null;
  if (/^(data:|https?:|asset:|http:\/\/asset\.localhost)/i.test(path)) return path;
  return convertFileSrc(path);
}

function fileRowsFromClip(clip: ClipItem) {
  return clip.content
    .split(/\r?\n/)
    .map((path) => path.trim())
    .filter(Boolean);
}

function detectDetailMode(clip: ClipItem) {
  // 详情页先做轻量类型识别，后续解析插件会从这里扩展更完整的渲染能力。
  if (clip.analysis.attachment?.isImage) return "图片";
  if (clip.kind === "markdown") return "Markdown";
  if (clip.kind === "code") return "代码";
  if (/^\s*[\[{]/.test(clip.content)) return "JSON";
  if (/\t/.test(clip.content) || /^\|.+\|$/m.test(clip.content)) return "表格";
  if (clip.kind === "link") return "链接";
  return "文本";
}

function isLikelyMarkdown(clip: ClipItem) {
  return clip.kind === "markdown" || clip.analysis.isMarkdown || detectDetailMode(clip) === "Markdown";
}

function isLikelyJson(clip: ClipItem) {
  return clip.payloadKind === "json" || detectDetailMode(clip) === "JSON";
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
    businessChain: "quick-panel -> workspace-router -> detail-route -> ClipDetailWorkspace -> content-renderer",
    routePath: "/clip/$clipId",
    component: "ClipDetailWorkspace",
    renderer: getDetailRendererName(clip),
    clipId: clip.id,
    clipKind: clip.kind,
    payloadKind: clip.payloadKind,
    detailMode: detectDetailMode(clip),
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
  { children: ReactNode; clip: ClipItem; onBack: () => void; onCopy: (clip: ClipItem) => void },
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
          <strong>当前内容预览失败</strong>
          <span title={this.state.message}>已切换到原文模式，面板可继续使用。</span>
          <div className="copy-layout-grid">
            <button type="button" onClick={() => this.props.onCopy(this.props.clip)}>
              复制原文
            </button>
            <button type="button" onClick={this.props.onBack}>
              返回列表
            </button>
          </div>
        </div>
        <pre>{this.props.clip.content}</pre>
      </div>
    );
  }
}

function LinkPreview({ clip, links, onCopy, onOpen }: { clip: ClipItem; links: string[]; onCopy: (clip: ClipItem) => void; onOpen: (clip: ClipItem) => void }) {
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
          <button type="button" onClick={() => onOpen(clip)}>打开</button>
          <button type="button" onClick={() => navigator.clipboard.writeText(primaryUrl)}>复制链接</button>
        </div>
      ) : null}
      <pre>{clip.content}</pre>
      <div className="copy-layout-grid">
        <button type="button" onClick={() => onCopy(clip)}>复制全文</button>
        {primaryUrl ? <button type="button" onClick={() => navigator.clipboard.writeText(primaryUrl)}>只复制链接</button> : null}
      </div>
    </div>
  );
}

function JsonPreview({
  clip,
  content,
  onCopyText,
}: {
  clip: ClipItem;
  content: string;
  onCopyText: (text: string, source: string, context?: Record<string, unknown>) => void;
}) {
  const preview = useMemo(() => formatJsonPreview(content), [content]);
  return (
    <div className={preview.error ? "json-preview has-error" : "json-preview"}>
      <div className="json-preview-toolbar">
        <span>
          <FileJson size={12} />
          {preview.error ? "JSON 原文" : "JSON 格式化"}
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
          复制格式化
        </button>
      </div>
      {preview.error ? <p className="json-preview-error">解析失败：{preview.error}</p> : null}
      <pre><code>{preview.formatted}</code></pre>
    </div>
  );
}

function DetailQuickEditor({
  content,
  error,
  hasChanges,
  isSaving,
  suggestedTags,
  tags,
  onCancel,
  onChange,
  onTagsChange,
  onSave,
}: {
  content: string;
  error: string;
  hasChanges: boolean;
  isSaving: boolean;
  suggestedTags: string[];
  tags: string[];
  onCancel: () => void;
  onChange: (value: string) => void;
  onTagsChange: (tags: string[]) => void;
  onSave: () => void;
}) {
  const [tagInput, setTagInput] = useState("");
  const addTag = (value: string) => {
    const tag = normalizeDetailTag(value);
    if (!tag) return;
    onTagsChange(normalizeDetailTags([...tags, tag]));
    setTagInput("");
  };
  return (
    <div className="detail-editor">
      <div className="detail-editor-toolbar">
        <span>
          快速编辑
          <em>{content.length} 字符 / {content.split(/\r?\n/).length} 行</em>
        </span>
        <div>
          <button type="button" onClick={onCancel}>
            <X size={11} />
            取消
          </button>
          <button disabled={!hasChanges || isSaving || !content.trim()} type="button" onClick={onSave}>
            <Save size={11} />
            {isSaving ? "保存中" : "保存"}
          </button>
        </div>
      </div>
      <div className="detail-tag-editor" aria-label="编辑 Tag">
        <div className="detail-tag-scroll">
          {tags.map((tag) => (
            <button
              aria-label={`删除 Tag ${tag}`}
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
            aria-label="新增 Tag"
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
      <textarea
        aria-label="编辑剪贴板内容"
        className="detail-editor-textarea"
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
        value={content}
      />
      {error ? <p className="detail-editor-error" role="alert">{error}</p> : null}
    </div>
  );
}

function AgentMcpCopyButton({ clip }: { clip: ClipItem }) {
  const getCommand = `use clipf.get id=${clip.id}`;
  const [copied, setCopied] = useState(false);
  const copyCommand = (text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    });
  };
  const tooltip = [
    "复制 Agent MCP 获取命令",
    getCommand,
  ].join("\n");

  return (
    <button
      aria-label="复制 Agent MCP 获取命令"
      className={copied ? "agent-mcp-copy-button copied" : "agent-mcp-copy-button"}
      onClick={() => copyCommand(getCommand)}
      title={tooltip}
      type="button"
    >
      <Clipboard size={12} />
      <span>{copied ? "已复制" : "复制 MCP"}</span>
    </button>
  );
}

function AvailableFormatsRow({ clip }: { clip: ClipItem }) {
  const formats = clip.availableFormats.length ? clip.availableFormats : [clip.primaryFormat];
  return (
    <div className="detail-format-row" aria-label="可用格式">
      {formats.map((format) => (
        <span key={format}>{format}</span>
      ))}
    </div>
  );
}

function ImageFilePreview({ clip }: { clip: ClipItem }) {
  const src = clipImageSrc(clip);
  return (
    <div className="detail-binary-preview">
      {src ? <img alt={clip.analysis.title || "Clipboard image"} src={src} /> : null}
      <div className="detail-binary-meta">
        <span>{clip.width && clip.height ? `${clip.width} x ${clip.height}` : "Image"}</span>
        {clip.size ? <span>{Math.round(clip.size / 1024)} KB</span> : null}
        {clip.imageFile ? <span title={clip.imageFile}>{clip.imageFile}</span> : null}
      </div>
      <AvailableFormatsRow clip={clip} />
    </div>
  );
}

function FileListPreview({ clip }: { clip: ClipItem }) {
  const rows = fileRowsFromClip(clip);
  return (
    <div className="detail-file-preview">
      <div className="detail-file-summary">
        <FileText size={13} />
        <span>{rows.length} 个文件</span>
        {clip.fileTypes ? <em>{clip.fileTypes}</em> : null}
      </div>
      <div className="detail-file-list">
        {rows.map((path) => (
          <button key={path} title={path} type="button">
            <FileText size={12} />
            <span>{path}</span>
          </button>
        ))}
      </div>
      <AvailableFormatsRow clip={clip} />
    </div>
  );
}

export function ClipDetailWorkspace({
  clip,
  links,
  onBack,
  onCopy,
  onCopyText,
  onOpen,
  onPasteText,
  onSearchTag,
  onUpdateContent,
  quickActions = [],
}: ClipDetailWorkspaceProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draftContent, setDraftContent] = useState("");
  const [draftTags, setDraftTags] = useState<string[]>([]);
  const [editError, setEditError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setDraftContent(clip?.content ?? "");
    setDraftTags(normalizeDetailTags(clip?.tags ?? []));
    setIsEditing(false);
    setEditError("");
    setIsSaving(false);
  }, [clip?.id, clip?.content, clip?.tags]);

  if (!clip) {
    return (
      <section className="workspace-page workspace-detail-page">
        <WorkspaceCrumb title="详情" onBack={onBack} />
        <div className="workspace-empty">当前内容不存在，返回列表重新选择。</div>
      </section>
    );
  }

  const mode = detectDetailMode(clip);
  const imageUrl = clip.analysis.attachment?.isImage && clip.analysis.attachment.targetType === "url"
    ? clip.analysis.attachment.target
    : null;
  const hasDraftChanges =
    draftContent !== clip.content ||
    normalizeDetailTags(draftTags).join("\n").toLowerCase() !== normalizeDetailTags(clip.tags).join("\n").toLowerCase();
  const suggestedTags = extractDetailHashTags(draftContent).filter(
    (tag) => !draftTags.some((current) => current.toLowerCase() === tag.toLowerCase()),
  );
  const safeLinks = safeHttpUrls(links);
  const droppedLinkCount = links.length - safeLinks.length;
  const droppedLinkLogKey = `${clip.id}:${links.length}:${safeLinks.length}`;

  const saveDraftContent = async () => {
    if (!draftContent.trim()) {
      setEditError("内容不能为空");
      return;
    }
    if (!hasDraftChanges) {
      setIsEditing(false);
      return;
    }
    setIsSaving(true);
    setEditError("");
    try {
      await onUpdateContent(clip, draftContent, draftTags);
      setIsEditing(false);
    } catch (error) {
      setEditError(`保存失败：${error instanceof Error ? error.message : String(error)}`);
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

  return (
    <section className="workspace-page workspace-detail-page">
      <WorkspaceCrumb title="内容详情" subtitle={mode} onBack={onBack}>
        <AgentMcpCopyButton clip={clip} />
        <button
          aria-label={isEditing ? "正在编辑内容" : "编辑内容"}
          className={isEditing ? "detail-edit-button active" : "detail-edit-button"}
          onClick={() => {
            setDraftContent(clip.content);
            setDraftTags(normalizeDetailTags(clip.tags));
            setEditError("");
            setIsEditing(true);
          }}
          title="快速编辑当前剪贴板内容"
          type="button"
        >
          <Pencil size={12} />
          <span>{isEditing ? "编辑中" : "编辑"}</span>
        </button>
        {clip.analysis.url || clip.analysis.attachment ? (
          <button className="icon-button" onClick={() => onOpen(clip)} type="button" aria-label="打开内容">
            <ExternalLink size={14} />
          </button>
        ) : null}
        <button className="icon-button" onClick={() => onCopy(clip)} type="button" aria-label="复制内容">
          <Copy size={14} />
        </button>
      </WorkspaceCrumb>

      <div className="detail-meta" aria-label="内容元信息">
        <span className="clip-id-chip" title={clip.id}>
          ID {clip.id.slice(0, 8)}…{clip.id.slice(-6)}
        </span>
        <span className={`kind-chip ${clip.payloadKind}`} title={getPayloadKindLabel(clip.payloadKind)}>
          {(() => {
            const Icon = getPayloadKindIcon(clip.payloadKind);
            return <Icon size={10} />;
          })()}
          <span>{getPayloadKindLabel(clip.payloadKind)}</span>
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
        <div className="detail-tag-row" aria-label="Tag 列表">
          {clip.tags.map((tag) => (
            <button key={tag} onClick={() => onSearchTag(tag)} type="button">
              <Tag size={10} />
              #{tag}
            </button>
          ))}
        </div>
      ) : null}

      <div className="workspace-action-strip" aria-label="详情快捷操作">
        {quickActions.map((action) => (
          <button disabled={action.disabled} key={action.id} onClick={action.onSelect} type="button">
            {action.icon}
            {action.label}
          </button>
        ))}
      </div>

      <DetailContentBoundary clip={clip} onBack={onBack} onCopy={onCopy}>
        <div className="detail-content">
          {isEditing ? (
            <DetailQuickEditor
              content={draftContent}
              error={editError}
              hasChanges={hasDraftChanges}
              isSaving={isSaving}
              suggestedTags={suggestedTags}
              tags={draftTags}
              onCancel={() => {
                setDraftContent(clip.content);
                setDraftTags(normalizeDetailTags(clip.tags));
                setEditError("");
                setIsEditing(false);
              }}
              onChange={(value) => {
                setDraftContent(value);
                if (editError) setEditError("");
              }}
              onTagsChange={setDraftTags}
              onSave={saveDraftContent}
            />
          ) : clip.payloadKind === "image" ? (
            <ImageFilePreview clip={clip} />
          ) : clip.payloadKind === "file" ? (
            <FileListPreview clip={clip} />
          ) : imageUrl ? (
            <img src={imageUrl} alt={clip.analysis.title} />
          ) : clip.analysis.url || clip.kind === "link" ? (
            <LinkPreview clip={clip} links={links} onCopy={onCopy} onOpen={onOpen} />
          ) : isLikelyJson(clip) ? (
            <JsonPreview clip={clip} content={clip.content} onCopyText={onCopyText} />
          ) : isLikelyMarkdown(clip) ? (
            <MarkdownPreview clip={clip} content={clip.content} onCopyCode={onCopyText} onPasteCode={onPasteText} />
          ) : (
            <pre>{clip.content}</pre>
          )}
        </div>
      </DetailContentBoundary>

      {safeLinks.length ? (
        <div className="detail-link-grid" aria-label="链接列表">
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
  onBack,
  onCopy,
  onCopyItem,
  onExportTable,
  onOpenItem,
}: MultiAggregateWorkspaceProps) {
  const grouped = items.reduce<Record<string, ClipItem[]>>((acc, item) => {
    const key = getPayloadKindLabel(item.payloadKind);
    acc[key] = acc[key] ?? [];
    acc[key].push(item);
    return acc;
  }, {});
  const totalChars = items.reduce((sum, item) => sum + item.content.length, 0);
  const linkCount = items.reduce((sum, item) => sum + (item.analysis.url ? 1 : 0), 0);

  return (
    <section className="workspace-page workspace-aggregate-page">
      <WorkspaceCrumb title="多选聚合" subtitle={`${items.length} 项 / ${totalChars} 字符`} onBack={onBack}>
        <button className="icon-button" onClick={onExportTable} type="button" aria-label="导出为表格">
          <Table2 size={14} />
        </button>
        <button className="icon-button" onClick={onCopy} type="button" aria-label="复制聚合内容">
          <Copy size={14} />
        </button>
      </WorkspaceCrumb>
      <div className="workspace-action-strip" aria-label="聚合快捷操作">
        <button type="button" onClick={onCopy}>
          <Copy size={13} />
          复制全部
        </button>
        <button type="button" onClick={onExportTable}>
          <Table2 size={13} />
          导出表格
        </button>
        <button type="button" disabled>
          <FileText size={13} />
          模板
        </button>
        <button type="button" disabled>
          <FileJson size={13} />
          结构化
        </button>
      </div>
      {items.length ? (
        <div className="aggregate-summary" aria-label="聚合摘要">
          <span><strong>{items.length}</strong> 项</span>
          <span><strong>{Object.keys(grouped).length}</strong> 类</span>
          <span><strong>{linkCount}</strong> 个链接</span>
        </div>
      ) : null}
      {items.length ? (
        <div className="aggregate-content" aria-label="聚合内容">
          <section className="aggregate-preview-block">
            <div className="aggregate-section-title">
              <strong>聚合原文</strong>
              <span>按选择顺序拼接，可直接复制全部</span>
            </div>
            <pre>{aggregatePreview}</pre>
          </section>

          {Object.entries(grouped).map(([group, groupItems]) => (
            <section className="aggregate-group" key={group}>
              <div className="aggregate-section-title">
                <strong>{group}</strong>
                <span>{groupItems.length} 项</span>
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
                          {getPayloadKindLabel(item.payloadKind)}
                        </span>
                        <strong title={item.analysis.title}>{item.analysis.title || item.analysis.sourceName || "剪贴板内容"}</strong>
                        <div className="aggregate-item-actions">
                          <button type="button" onClick={() => onOpenItem(item)}>
                            <FileJson size={12} />
                            详情
                          </button>
                          <button type="button" onClick={() => onCopyItem(item)}>
                            <Copy size={12} />
                            复制
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
        <div className="workspace-empty">选择多条内容后预览聚合结果。</div>
      )}
    </section>
  );
}

function WorkspaceCrumb({
  children,
  onBack,
  subtitle,
  title,
}: {
  children?: React.ReactNode;
  onBack: () => void;
  subtitle?: string;
  title: string;
}) {
  return (
    <header className="workspace-crumb">
      <button className="icon-button subtle" onClick={onBack} type="button" aria-label="返回列表">
        <RotateCcw size={14} />
      </button>
      <div className="workspace-crumb-title">
        <strong>{title}</strong>
        {subtitle ? <em>{subtitle}</em> : null}
      </div>
      <div className="workspace-crumb-actions">
        {children}
        <button className="icon-button subtle" onClick={onBack} type="button" aria-label="关闭详情">
          <X size={14} />
        </button>
      </div>
    </header>
  );
}
