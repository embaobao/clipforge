import { ChevronDown, ChevronUp, Copy, ExternalLink, FileJson, FileText, Pencil, } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ClipItem } from "../../App";
import { detectSensitiveEditorFields } from "../../editor/sensitive";
import { formatCommandError } from "../../i18n";
import type { FilePathStatus } from "../../services/clipboard";
import { ButtonGroup } from "@/components/ui/button-group";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WorkspaceCrumb } from "./WorkspaceCrumb";
import { DetailMeta } from "./DetailMeta";
import { DetailOverflowMenu } from "./DetailOverflowMenu";
import { DetailQuickEditor } from "./DetailQuickEditor";
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
  compactInlineText,
  droppedLinkLogKeys,
  extractDetailHashTags,
  getApplicationContextSummary,
  getClipRenderDiagnostics,
  getDetailModeLabel,
  getImageOpenPath,
  getDetailSourceAddress,
  isLikelyJson,
  isLikelyMarkdown,
  normalizeDetailTags,
  safeHttpUrls,
  type DetailQuickAction,
  type EditorVariableRow,
  type WorkspaceTr,
} from "./workspace-detail-shared";

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
    context?: { sessionId: string; draftVersion: number },
  ) => Promise<ClipItem | void>;
  quickActions?: DetailQuickAction[];
};

/** 详情页外壳：只读态（工具条 + 元信息 + 内容/链接/采集上下文折叠区）与编辑态（快捷编辑器）切换。
 *  预览渲染、元信息、溢出菜单分别由 DetailPreview / DetailMeta / DetailOverflowMenu 承载（AI 分析随 pi-sdk 迁移待恢复）。 */
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
  quickActions = [],
}: ClipDetailWorkspaceProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draftContent, setDraftContent] = useState("");
  const [draftTags, setDraftTags] = useState<string[]>([]);
  const [editError, setEditError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [imagePreviewOpen, setImagePreviewOpen] = useState(false);
  const [imageActualSize, setImageActualSize] = useState(false);
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
    setImagePreviewOpen(false);
    setImageActualSize(false);
  }, [clip?.id, clip?.content, clip?.tags]);

  if (!clip) {
    return (
      <section className="h-full overflow-auto bg-background" data-surface="workspace">
        <WorkspaceCrumb title={tr("main.detail.title")} onBack={onBack} tr={tr} />
        <div className="flex h-full items-center justify-center p-8 text-center text-[13px] text-muted-foreground">{tr("main.detail.missing")}</div>
      </section>
    );
  }

  const mode = getDetailModeLabel(clip, tr);
  const sourceAddress = getDetailSourceAddress(clip);
  const applicationContextSummary = getApplicationContextSummary(clip);
  const captureContextJson = JSON.stringify(clip.captureContext, null, 2);
  const captureContextFieldCount = Object.keys(clip.captureContext).length;
  const imageOpenPath = getImageOpenPath(clip);
  const imageUrl = clip.analysis.attachment?.isImage && clip.analysis.attachment.targetType === "url"
    ? clip.analysis.attachment.target
    : null;
  const hasDraftChanges =
    draftContent !== clip.content ||
    normalizeDetailTags(draftTags).join("\n").toLowerCase() !== normalizeDetailTags(clip.tags).join("\n").toLowerCase();
  // 智能内容→tag：从 clip 类型/附件派生 tag，与文中 #tag 合并建议，去重已有 tag（镜像 App.tsx getTypeTags 语义）。
  const kindTagMap: Record<string, string[]> = {
    link: ["链接"],
    command: ["命令"],
    json: ["JSON"],
    markdown: ["Markdown"],
    code: ["代码"],
  };
  const smartTypeTags = clip.analysis.attachment
    ? [clip.analysis.attachment.isImage ? "图片" : "资源"]
    : kindTagMap[clip.kind] ?? [];
  const suggestedTags = Array.from(
    new Set([...extractDetailHashTags(draftContent), ...smartTypeTags]),
  ).filter((tag) => !draftTags.some((current) => current.toLowerCase() === tag.toLowerCase()));
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
    afterSave: "stay" | "copy" | "paste" = "stay",
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
      const savedClip = await onUpdateContent(clip, nextContent, nextTags, {
        sessionId: editorSessionId || `editor_${clip.id}`,
        draftVersion,
      });
      const postSaveClip = savedClip ?? { ...clip, content: nextContent, tags: nextTags };
      setDraftContent(nextContent);
      setDraftTags(nextTags);
      setDraftVersion((current) => current + 1);
      if (afterSave === "copy") {
        appendWorkspacePanelLog("info", "detail-editor-save-and-copy", {
          clipId: clip.id,
          sessionId: editorSessionId,
          draftVersion,
        });
        onCopy(postSaveClip);
      }
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
  const hasImageActions = clip.payloadKind === "image";
  const toolButtonClass = "inline-flex h-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-black/[0.05] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-white/[0.08]";
  const accordionTriggerClass = "gap-2 rounded-md px-1 py-2.5 text-[12px] font-normal hover:no-underline [&>em]:text-[11px] [&>em]:font-normal [&>em]:not-italic [&>em]:text-muted-foreground [&>svg:first-child]:shrink-0 [&>span]:truncate";

  return (
    <section className="flex h-full flex-col overflow-auto bg-background" data-surface="workspace">
      {!isEditing ? (
        <>
          <WorkspaceCrumb title={tr("main.detail.title")} subtitle={mode} onBack={handleBack} tr={tr}>
            <ButtonGroup className="rounded-md border border-border/60">
              <button
                aria-label={tr("main.detail.previous")}
                className={`${toolButtonClass} rounded-l-md border-r border-border/60`}
                disabled={!onPrevious}
                onClick={onPrevious}
                title={tr("main.detail.previousShortcut")}
                type="button"
              >
                <ChevronUp size={12} />
              </button>
              <button
                aria-label={tr("main.detail.next")}
                className={`${toolButtonClass} border-r border-border/60`}
                disabled={!onNext}
                onClick={onNext}
                title={tr("main.detail.nextShortcut")}
                type="button"
              >
                <ChevronDown size={12} />
              </button>
              <button
                aria-label={tr("main.detail.editContent")}
                className={toolButtonClass}
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
              </button>
            </ButtonGroup>
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
          <DetailMeta
            applicationContextSummary={applicationContextSummary}
            clip={clip}
            sourceAddress={sourceAddress}
            tr={tr}
            onCopy={onCopy}
            onCopyPlain={onCopyPlain}
            onCopyText={onCopyText}
            onSearchTag={onSearchTag}
          />
        </>
      ) : null}

      {/* 详情主体：按类型渲染，保留内容与链接的分区折叠 */}
      <div className="flex min-h-0 flex-1 flex-col px-4 py-3">
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
            onSaveAndCopy={() => void saveDraftContent("copy")}
            onSaveAndPaste={() => void saveDraftContent("paste")}
          />
        ) : (
          <Accordion className="space-y-1" collapsible defaultValue="content" type="single">
            <AccordionItem value="content">
              <AccordionTrigger className={accordionTriggerClass}>
                <FileText size={14} />
                <span>{tr("main.detail.contentTitle")}</span>
                <em>{tr("main.detail.editorStats", { chars: clip.content.length, lines: clip.content.split(/\r?\n/).length })}</em>
              </AccordionTrigger>
              <AccordionContent className="pt-2">
                {clip.payloadKind === "image" ? (
                  <ImageFilePreview
                    actualSize={imageActualSize}
                    clip={clip}
                    onClosePreview={() => setImagePreviewOpen(false)}
                    onOpenPreview={() => setImagePreviewOpen(true)}
                    previewOpen={imagePreviewOpen}
                    tr={tr}
                  />
                ) : clip.payloadKind === "file" ? (
                  <FileListPreview clip={clip} filePathStatuses={filePathStatuses} tr={tr} onOpenPath={onOpenPath} />
                ) : imageUrl ? (
                  <img alt={clip.analysis.title} className="max-h-72 rounded-lg object-contain" src={imageUrl} />
                ) : clip.payloadKind === "html" ? (
                  <HtmlPreview clip={clip} content={clip.content} onCopy={onCopy} tr={tr} />
                ) : clip.analysis.url || clip.kind === "link" ? (
                  <LinkPreview clip={clip} links={links} onOpen={onOpen} tr={tr} />
                ) : isLikelyJson(clip) ? (
                  <JsonPreview clip={clip} content={clip.content} onCopyText={onCopyText} tr={tr} />
                ) : isLikelyMarkdown(clip) ? (
                  <Tabs defaultValue="rendered">
                    <TabsList className="inline-flex gap-1 rounded-lg bg-black/[0.04] p-0.5 dark:bg-white/[0.07]">
                      <TabsTrigger className="h-7 rounded-[7px] px-2.5 text-[12px]" value="rendered">渲染后</TabsTrigger>
                      <TabsTrigger className="h-7 rounded-[7px] px-2.5 text-[12px]" value="raw">原内容</TabsTrigger>
                    </TabsList>
                    <TabsContent value="rendered">
                      <MarkdownPreview clip={clip} content={clip.content} onCopyCode={onCopyText} onPasteCode={onPasteText} />
                    </TabsContent>
                    <TabsContent value="raw">
                      <TruncatedPre clip={clip} />
                    </TabsContent>
                  </Tabs>
                ) : (
                  <>
                    <SmartFormatPanel clip={clip} content={clip.content} onCopyText={onCopyText} tr={tr} />
                    <TruncatedPre clip={clip} />
                  </>
                )}
              </AccordionContent>
            </AccordionItem>

            {safeLinks.length ? (
              <AccordionItem value="links">
                <AccordionTrigger className={accordionTriggerClass}>
                  <ExternalLink size={14} />
                  <span>{tr("main.detail.linkList")}</span>
                  <em>{safeLinks.length}</em>
                </AccordionTrigger>
                <AccordionContent className="pt-2">
                  <div aria-label={tr("main.detail.linkList")} className="grid grid-cols-2 gap-1.5">
                    {safeLinks.slice(0, 12).map((url) => (
                      <button
                        className="flex min-w-0 items-center gap-1.5 rounded-md border border-border/60 px-2 py-1.5 text-left text-[12px] hover:bg-black/[0.04] dark:hover:bg-white/[0.07]"
                        key={url.href}
                        onClick={() => window.open(url.href, "_blank", "noopener,noreferrer")}
                        type="button"
                      >
                        <ExternalLink className="shrink-0" size={12} />
                        <span className="truncate">{url.label}</span>
                      </button>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            ) : null}

            <AccordionItem value="capture-context">
              <AccordionTrigger className={accordionTriggerClass}>
                <FileJson size={14} />
                <span>{tr("main.detail.captureContext")}</span>
                <em>{tr("main.detail.captureContextFields", { count: captureContextFieldCount })}</em>
              </AccordionTrigger>
              <AccordionContent className="space-y-2 pt-2">
                <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                  <span className="min-w-0 truncate">{applicationContextSummary || tr("main.detail.captureContextUnavailable")}</span>
                  <button
                    className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-border/60 px-2.5 text-[12px] hover:bg-black/[0.05] dark:hover:bg-white/[0.08]"
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
                <pre aria-label={tr("main.detail.captureContext")} className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/[0.03] p-3 text-[11px] leading-relaxed dark:bg-white/[0.05]"><code>{captureContextJson}</code></pre>
              </AccordionContent>
            </AccordionItem>

          </Accordion>
        )}
      </div>
    </section>
  );
}
