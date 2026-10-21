import { RiArrowDownWideFill, RiArrowUpWideFill } from "react-icons/ri";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ClipItem } from "../../App";
import { formatCommandError } from "../../i18n";
import type { FilePathStatus } from "../../services/clipboard";
import { WorkspaceCrumb } from "./WorkspaceCrumb";
import { DetailOverflowMenu } from "./DetailOverflowMenu";
import { PROMPT_OPTIMIZER_DRAFT_SRC } from "./PromptOptimizerBar";
import {
  FileListPreview,
  HtmlPreview,
  ImageFilePreview,
  JsonPreview,
  LinkPreview,
  MarkdownPreview,
  SmartFormatPanel,
  TruncatedPre,
} from "./DetailPreview";
import {
  appendWorkspacePanelLog,
  droppedLinkLogKeys,
  getApplicationContextSummary,
  getClipRenderDiagnostics,
  getDetailModeLabel,
  getImageOpenPath,
  getDetailSourceAddress,
  normalizeDetailTags,
  safeHttpUrls,
  type DetailQuickAction,
  type WorkspaceTr,
} from "./workspace-detail-shared";
import { DetailActionBar } from "./detail/detail-action-bar";
import { DetailMetaRow } from "./detail/detail-meta-row";
import { DetailPathRow } from "./detail/detail-path-row";
import { CaptureOverlay } from "./detail/capture-overlay";
import { DraftDiff } from "./detail/draft-diff";
import { DetailLinkList } from "./detail/detail-link-list";
import { DetailPluginZone } from "./detail/detail-plugin-zone";
import type { PluginQueueTask } from "./detail/plugin-zone";
import {
  buildSuggestedTags,
  getDetailSourcePath,
  hasRichRepresentation,
  isEditableClip,
  type DetailDraft,
  type DetailMode,
} from "./detail/detail-state";
import { MdEditor } from "./detail/md-editor";
import { buildManualProvenance, parseTagProvenance } from "./detail/tag-provenance";
import { resolveDetailRenderer } from "./detail/renderer-registry";
import { useDetailKeyboard } from "./detail/use-detail-keyboard";

type ClipDetailWorkspaceProps = {
  clip: ClipItem | null;
  filePathStatuses?: Record<string, FilePathStatus>;
  links: string[];
  tr: WorkspaceTr;
  onBack: () => void;
  onCopy: (clip: ClipItem) => void;
  onCopyPlain: (clip: ClipItem) => void;
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
    context?: { sessionId: string; draftVersion: number; tagsProvenance?: Record<string, unknown> },
  ) => Promise<ClipItem | void>;
  quickActions?: DetailQuickAction[];
  /** Agent provider 配置（settings.agentProviders），用于 pi 底层 AI 分析；空数组时分析按钮禁用。 */
  agentProviders?: Array<Record<string, unknown>>;
  /** 应用 AI 建议标签（转发 update_clip_record 写回通道）；缺省时详情页不显示应用入口。 */
  onApplyTags?: (clipId: string, tags: string[]) => void;
};

/** 详情页外壳（提案 detail-page-information-architecture v8 定稿）：
 *  五区编排（crumb / 路径行 / meta 单行 / 内容三态 / 底部动作区）+ 三态状态机（浏览/编辑/diff）。
 *  AI 入口收敛到 tags 行右侧插件区（PiAnalysisBar 精简形态 + 队列角标）；弹窗仅采集原数据与 AI 配置两处。 */
export function ClipDetailWorkspace({
  clip,
  filePathStatuses,
  links,
  tr,
  onBack,
  onCopy,
  onCopyPlain,
  onCopyText,
  onOpen,
  onOpenPath,
  onPasteText,
  onPrevious,
  onNext,
  onSearchTag,
  onUpdateContent,
  onApplyTags,
  quickActions = [],
  agentProviders = [],
}: ClipDetailWorkspaceProps) {
  const [mode, setMode] = useState<DetailMode>("view");
  const [draftContent, setDraftContent] = useState("");
  const [draftTags, setDraftTags] = useState<string[]>([]);
  const [editError, setEditError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [imagePreviewOpen, setImagePreviewOpen] = useState(false);
  const [imageActualSize, setImageActualSize] = useState(false);
  const [editorSessionId, setEditorSessionId] = useState("");
  const [draftVersion, setDraftVersion] = useState(1);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [pathCopied, setPathCopied] = useState(false);
  const [draft, setDraft] = useState<DetailDraft | null>(null);
  const [pluginQueue, setPluginQueue] = useState<PluginQueueTask[]>([]);
  // 动效状态（设计 §7）：切条目 140ms 方向感知 / 切态 220ms；key 变化即重播动画。
  // 用 ref 派生（render 期 setState 会连环重置，DOM 永远读不到 clip 值），200ms 后自动回落 state。
  const lastNavRef = useRef<"prev" | "next">("next");
  const goPrevious = () => {
    lastNavRef.current = "prev";
    onPrevious?.();
  };
  const goNext = () => {
    lastNavRef.current = "next";
    onNext?.();
  };
  const lastClipIdRef = useRef(clip?.id);
  const pendingSwitchRef = useRef(false);
  if (clip && lastClipIdRef.current !== clip.id) {
    pendingSwitchRef.current = true;
    lastClipIdRef.current = clip.id;
  }
  const switchKind = pendingSwitchRef.current ? "clip" : "state";
  const switchDir = pendingSwitchRef.current ? lastNavRef.current : "";
  useEffect(() => {
    const timer = window.setTimeout(() => {
      pendingSwitchRef.current = false;
    }, 200);
    return () => window.clearTimeout(timer);
  }, [clip?.id]);

  useEffect(() => {
    setDraftContent(clip?.content ?? "");
    setDraftTags(normalizeDetailTags(clip?.tags ?? []));
    setEditorSessionId(clip ? `editor_${clip.id}_${Date.now().toString(36)}` : "");
    setDraftVersion(1);
    setMode("view");
    setDraft(null);
    setEditError("");
    setIsSaving(false);
    setImagePreviewOpen(false);
    setImageActualSize(false);
    setCaptureOpen(false);
  }, [clip?.id, clip?.content, clip?.tags]);

  // 提示词优化器产出：内存草稿 + 切 diff 态，确认后走既有 saveDraftContent 写回。
  const handlePromptOptimizerDraft = useCallback((content: string) => {
    setDraft({ content, srcId: PROMPT_OPTIMIZER_DRAFT_SRC, ts: Date.now() });
    setDraftContent(content);
    setMode("diff");
  }, []);

  // 插件队列（AI 分析 / 提示词优化共用）：任务级幂等增删由 DetailPluginZone 负责。
  const handleQueueChange = useCallback((next: PluginQueueTask[]) => {
    setPluginQueue(next);
  }, []);

  if (!clip) {
    return (
      <section className="h-full overflow-auto bg-transparent" data-surface="workspace">
        <WorkspaceCrumb title={tr("main.detail.title")} onBack={onBack} tr={tr} />
        <div className="flex h-full items-center justify-center p-8 text-center text-[13px] text-muted-foreground">{tr("main.detail.missing")}</div>
      </section>
    );
  }

  const modeLabel = getDetailModeLabel(clip, tr);
  const sourceAddress = getDetailSourceAddress(clip);
  const applicationContextSummary = getApplicationContextSummary(clip);
  const imageOpenPath = getImageOpenPath(clip);
  const imageUrl = clip.analysis.attachment?.isImage && clip.analysis.attachment.targetType === "url"
    ? clip.analysis.attachment.target
    : null;
  const sourcePath = mode === "view" ? getDetailSourcePath(clip) : "";
  const canEdit = isEditableClip(clip);
  const canCopyRich = hasRichRepresentation(clip);
  const hasDraftChanges =
    draftContent !== clip.content ||
    normalizeDetailTags(draftTags).join("\n").toLowerCase() !== normalizeDetailTags(clip.tags).join("\n").toLowerCase();
  const suggestedTags = buildSuggestedTags(clip, draftContent, draftTags);

  const safeLinks = safeHttpUrls(links);
  const droppedLinkCount = links.length - safeLinks.length;
  const droppedLinkLogKey = `${clip.id}:${links.length}:${safeLinks.length}`;
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
  const hasImageActions = clip.payloadKind === "image";
  const toolButtonClass = "relative inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-[color,background-color,border-color,transform] hover:bg-black/[0.05] hover:text-foreground active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-white/[0.08]";

  const confirmDiscardDraft = () => !hasDraftChanges || window.confirm(tr("main.detail.confirmDiscard"));

  const enterEdit = () => {
    setDraftContent(clip.content);
    setDraftTags(normalizeDetailTags(clip.tags));
    setEditError("");
    setMode("edit");
  };

  const handleExitEdit = () => {
    if (mode === "diff") {
      setDraft(null);
      setMode("view");
      return;
    }
    if (!confirmDiscardDraft()) return;
    setDraftContent(clip.content);
    setDraftTags(normalizeDetailTags(clip.tags));
    setEditError("");
    setMode("view");
  };

  const saveDraftContent = async (override?: { content: string; tags?: string[] }) => {
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
      setMode("view");
      setDraft(null);
      return;
    }
    setIsSaving(true);
    setEditError("");
    try {
      // 人工保存 = 权威整组替换：tags_provenance 对最终 tags 重组，全部标 manual（§5.3）。
      const nextProvenance = buildManualProvenance(parseTagProvenance(clip), nextTags);
      await onUpdateContent(clip, nextContent, nextTags, {
        sessionId: editorSessionId || `editor_${clip.id}`,
        draftVersion,
        tagsProvenance: nextProvenance,
      });
      setDraftContent(nextContent);
      setDraftTags(nextTags);
      setDraftVersion((current) => current + 1);
      setDraft(null);
      setMode("view");
    } catch (error) {
      setEditError(tr("main.detail.saveFailed", { error: formatCommandError(tr, error) }));
    } finally {
      setIsSaving(false);
    }
  };

  const handleCopyPath = (path: string) => {
    onCopyText(path, `detail:copy-source-path:${clip.id}`, {
      businessChain: "workspace-router -> detail-route -> path-row -> copy",
      clipId: clip.id,
      sourcePath: path,
    });
    setPathCopied(true);
    window.setTimeout(() => setPathCopied(false), 900);
  };

  const handleCopyPlain = () => {
    onCopyPlain(clip);
    setCopyFeedback(true);
    window.setTimeout(() => setCopyFeedback(false), 600);
  };

  useDetailKeyboard({
    mode,
    canEdit,
    hasPath: Boolean(sourcePath),
    overlayOpen: captureOpen,
    onEnterEdit: enterEdit,
    onSave: () => void (mode === "diff" && draft ? saveDraftContent({ content: draft.content }) : saveDraftContent()),
    onExit: handleExitEdit,
    onCopyPath: () => handleCopyPath(sourcePath),
    onPrevious: goPrevious,
    onNext: goNext,
  });

  const renderer = resolveDetailRenderer(clip);
  const runningCount = pluginQueue.filter((task) => task.status === "running").length;
  const pluginZone = (
    <DetailPluginZone
      agentProviders={agentProviders}
      clip={clip}
      onApplyTags={onApplyTags}
      onDraft={handlePromptOptimizerDraft}
      onQueueChange={handleQueueChange}
      onSearchTag={onSearchTag}
      queue={pluginQueue}
      runningCount={runningCount}
      tr={tr}
    />
  );

  const contentBody = useMemo(() => {
    if (mode === "edit") {
      return (
        <MdEditor
          clip={clip}
          error={editError}
          isSaving={isSaving}
          onChange={(value) => {
            setDraftContent(value);
            if (editError) setEditError("");
          }}
          onCancel={handleExitEdit}
          onCopyCode={(text, source) => onCopyText(text, source)}
          onPasteCode={(text, source) => onPasteText(text, source)}
          onSave={() => void saveDraftContent()}
          tr={tr}
          value={draftContent}
        />
      );
    }
    if (mode === "diff" && draft) {
      return <DraftDiff baseline={clip.content} draft={draft} tr={tr} />;
    }
    switch (renderer.component) {
      case "readonly-image":
        return (
          <ImageFilePreview
            actualSize={imageActualSize}
            clip={clip}
            onClosePreview={() => setImagePreviewOpen(false)}
            onOpenPreview={() => setImagePreviewOpen(true)}
            previewOpen={imagePreviewOpen}
            tr={tr}
          />
        );
      case "file-list":
        return <FileListPreview clip={clip} filePathStatuses={filePathStatuses} tr={tr} onOpenPath={onOpenPath} />;
      case "image-url":
        return <img alt={clip.analysis.title} className="max-h-72 rounded-lg object-contain" src={imageUrl ?? ""} />;
      case "html":
        return <HtmlPreview clip={clip} content={clip.content} onCopy={onCopy} tr={tr} />;
      case "link":
        return <LinkPreview clip={clip} links={links} onOpen={onOpen} tr={tr} />;
      case "json-tree":
        return <JsonPreview clip={clip} content={clip.content} onCopyText={onCopyText} tr={tr} />;
      case "markdown":
        return (
          <div className="space-y-2">
            <MarkdownPreview clip={clip} content={clip.content} onCopyCode={onCopyText} onPasteCode={onPasteText} />
            <TruncatedPre clip={clip} />
          </div>
        );
      default:
        return (
          <>
            <SmartFormatPanel clip={clip} content={clip.content} onCopyText={onCopyText} tr={tr} />
            <TruncatedPre clip={clip} />
          </>
        );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, draft, clip, renderer.component, draftContent, editError, isSaving, imageActualSize, imagePreviewOpen, filePathStatuses, imageUrl, links, onCopy, onCopyText, onOpen, onOpenPath, onPasteText, tr]);
  return (
    <section className="relative flex h-full flex-col overflow-hidden bg-transparent" data-surface="workspace">
      {/* 层① crumb：返回 + 标题 + prev/next（remixicon，v8 指定）+ 溢出菜单 */}
      <WorkspaceCrumb
        onBack={() => {
          if (mode === "edit" && !confirmDiscardDraft()) return;
          onBack();
        }}
        subtitle={modeLabel}
        title={tr("main.detail.title")}
        tr={tr}
      >
        <button
          aria-label={tr("main.detail.previous")}
          className={toolButtonClass}
          disabled={!onPrevious}
          onClick={goPrevious}
          title={tr("main.detail.previousShortcut")}
          type="button"
        >
          <RiArrowUpWideFill size={14} />
        </button>
        <button
          aria-label={tr("main.detail.next")}
          className={toolButtonClass}
          disabled={!onNext}
          onClick={goNext}
          title={tr("main.detail.nextShortcut")}
          type="button"
        >
          <RiArrowDownWideFill size={14} />
        </button>
        <DetailOverflowMenu
          clip={clip}
          hasImageActions={hasImageActions}
          imageActualSize={imageActualSize}
          imageOpenPath={imageOpenPath}
          menuActions={menuActions}
          tr={tr}
          onCopyText={onCopyText}
          onOpen={onOpen}
          onOpenPath={onOpenPath}
          onOpenImagePreview={() => setImagePreviewOpen(true)}
          onToggleImageActualSize={() => setImageActualSize((current) => !current)}
        />
      </WorkspaceCrumb>

      {/* 层② 来源路径行：仅浏览态且条目有路径；层③ meta 单行 + 插件区 */}
      {sourcePath ? <DetailPathRow onCopyPath={handleCopyPath} path={sourcePath} tr={tr} /> : null}
      <DetailMetaRow
        clip={clip}
        draftTags={draftTags}
        editing={mode === "edit"}
        onOpenCaptureDialog={() => setCaptureOpen(true)}
        onSearchTag={onSearchTag}
        onTagsChange={setDraftTags}
        pluginZone={pluginZone}
        suggestedTags={suggestedTags}
        provenance={parseTagProvenance(clip)}
        tr={tr}
      />
      {/* 层④ 内容主体（三态）：E/双击进编辑，⌘S 保存，Esc 层层后退 */}
      <div
        className="detail-state-in flex min-h-0 flex-1 flex-col px-4 py-3"
        data-detail-mode={mode}
        data-dir={switchDir}
        data-switch={switchKind}
        key={`${clip.id}:${mode}`}
        onDoubleClick={() => {
          if (mode === "view" && canEdit) enterEdit();
        }}
      >
        <div className="flex min-h-0 flex-1 flex-col">
          {contentBody}
          {mode === "view" ? <DetailLinkList links={safeLinks} tr={tr} /> : null}
        </div>
      </div>

      {/* 层⑤ 底部动作区：随三态切换 */}
      <DetailActionBar
        canCopyRich={canCopyRich}
        canEdit={canEdit}
        copyFeedback={copyFeedback}
        hasPath={Boolean(sourcePath)}
        isSaving={isSaving}
        mode={mode}
        onCopy={handleCopyPlain}
        onCopyPath={() => handleCopyPath(sourcePath)}
        onCopyRich={() => onCopy(clip)}
        onEdit={enterEdit}
        onExit={handleExitEdit}
        onPaste={() =>
          onPasteText(clip.plainText || clip.content, "detail-action:paste", {
            businessChain: "workspace-router -> detail-route -> action-bar -> paste",
            clipId: clip.id,
          })
        }
        onSave={() => void (mode === "diff" && draft ? saveDraftContent({ content: draft.content }) : saveDraftContent())}
        pathCopied={pathCopied}
        tr={tr}
      />

      {/* 弹窗（仅两处之一）：采集原数据 */}
      {captureOpen ? (
        <CaptureOverlay
          applicationContextSummary={applicationContextSummary}
          clip={clip}
          onClose={() => setCaptureOpen(false)}
          onCopyText={onCopyText}
          sourceAddress={sourceAddress}
          tr={tr}
        />
      ) : null}
    </section>
  );
}
