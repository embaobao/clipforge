import {
  AppWindow,
  BarChart3,
  Copy,
  ExternalLink,
  FileJson,
  FileText,
  Image,
  RotateCcw,
  Table2,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
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
  onOpen: (clip: ClipItem) => void;
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
  onExportTable: () => void;
};

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
      return (
        <a href={mdLink[2]} key={`${part}-${index}`} onClick={(event) => event.preventDefault()} title={mdLink[2]}>
          {mdLink[1]}
        </a>
      );
    }
    if (/^https?:\/\//i.test(part)) {
      return (
        <a href={part} key={`${part}-${index}`} onClick={(event) => event.preventDefault()} title={part}>
          {part}
        </a>
      );
    }
    return <span key={`${part}-${index}`}>{part}</span>;
  });
}

function MarkdownPreview({ content }: { content: string }) {
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
          return (
            <pre className="md-code" key={index}>
              {block.language ? <span>{block.language}</span> : null}
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

function LinkPreview({ clip, links, onCopy, onOpen }: { clip: ClipItem; links: string[]; onCopy: (clip: ClipItem) => void; onOpen: (clip: ClipItem) => void }) {
  const primaryUrl = clip.analysis.url ?? links[0] ?? clip.analysis.attachment?.target;
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

export function ClipDetailWorkspace({ clip, links, onBack, onCopy, onOpen, quickActions = [] }: ClipDetailWorkspaceProps) {
  if (!clip) {
    return (
      <section className="workspace-page">
        <WorkspaceCrumb title="详情" onBack={onBack} />
        <div className="workspace-empty">当前内容不存在，返回列表重新选择。</div>
      </section>
    );
  }

  const mode = detectDetailMode(clip);
  const imageUrl = clip.analysis.attachment?.isImage && clip.analysis.attachment.targetType === "url"
    ? clip.analysis.attachment.target
    : null;

  return (
    <section className="workspace-page">
      <WorkspaceCrumb title="内容详情" subtitle={mode} onBack={onBack}>
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

      <div className="workspace-action-strip" aria-label="详情快捷操作">
        {quickActions.map((action) => (
          <button disabled={action.disabled} key={action.id} onClick={action.onSelect} type="button">
            {action.icon}
            {action.label}
          </button>
        ))}
      </div>

      <div className="detail-content">
        {imageUrl ? (
          <img src={imageUrl} alt={clip.analysis.title} />
        ) : clip.analysis.url || clip.kind === "link" ? (
          <LinkPreview clip={clip} links={links} onCopy={onCopy} onOpen={onOpen} />
        ) : isLikelyMarkdown(clip) ? (
          <MarkdownPreview content={clip.content} />
        ) : (
          <pre>{clip.content}</pre>
        )}
      </div>

      {links.length ? (
        <div className="detail-link-grid" aria-label="链接列表">
          {links.slice(0, 8).map((url) => (
            <button key={url} type="button" onClick={() => window.open(url, "_blank", "noopener,noreferrer")}>
              <ExternalLink size={12} />
              <span>{new URL(url).hostname.replace(/^www\./, "")}</span>
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
  onExportTable,
}: MultiAggregateWorkspaceProps) {
  return (
    <section className="workspace-page">
      <WorkspaceCrumb title="多选聚合" subtitle={`${items.length} 项`} onBack={onBack}>
        <button className="icon-button" onClick={onExportTable} type="button" aria-label="导出为表格">
          <Table2 size={14} />
        </button>
        <button className="icon-button" onClick={onCopy} type="button" aria-label="复制聚合内容">
          <Copy size={14} />
        </button>
      </WorkspaceCrumb>
      <div className="workspace-action-strip" aria-label="聚合快捷操作">
        {/* 聚合页保留批量转换入口，后续会扩展表格导出和插件解析。 */}
        <button type="button">
          <FileText size={13} />
          模板
        </button>
        <button type="button">
          <FileJson size={13} />
          结构化
        </button>
        <button type="button" onClick={onExportTable}>
          <Table2 size={13} />
          表格
        </button>
      </div>
      <div className="detail-content aggregate">
        {items.length ? <pre>{aggregatePreview}</pre> : <div className="workspace-empty">选择多条内容后预览聚合结果。</div>}
      </div>
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
