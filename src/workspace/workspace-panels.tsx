import {
  AppWindow,
  BarChart3,
  Copy,
  ExternalLink,
  FileJson,
  FileText,
  Image,
  RotateCcw,
  Search,
  Table2,
  X,
} from "lucide-react";
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

export function ClipDetailWorkspace({ clip, links, onBack, onCopy, onOpen }: ClipDetailWorkspaceProps) {
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
        {/* 当前是动作槽占位：后续接入插件后可在这里执行搜索、模板填充和结构化解析。 */}
        <button type="button">
          <Search size={13} />
          Google
        </button>
        <button type="button">
          <FileText size={13} />
          模板
        </button>
        <button type="button">
          <FileJson size={13} />
          解析
        </button>
      </div>

      <div className="detail-content">
        {imageUrl ? (
          <img src={imageUrl} alt={clip.analysis.title} />
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
