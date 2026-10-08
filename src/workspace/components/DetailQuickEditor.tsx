import { Clipboard, Copy, FileJson, Save, Sparkles, Tag, X } from "lucide-react";
import { useMemo, useState } from "react";
import { detectSensitiveEditorFields } from "../../editor/sensitive";
import { applyEditorSuggestion, buildLocalEditorSuggestion } from "../../editor/suggestions";
import type { EditorSuggestionResult } from "../../services/contracts";
import { normalizeDetailTag, normalizeDetailTags, type EditorVariableRow, type WorkspaceTr } from "./workspace-detail-shared";

export type DetailQuickEditorProps = {
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
  onSaveAndCopy: () => void;
  onSaveAndPaste: () => void;
};

/** 详情页快捷编辑器：内容/标签编辑 + 本地智能建议 + 变量抽屉。
 *  保存动作由外壳统一处理（onSave / onSaveAndCopy / onSaveAndPaste），本组件只负责编辑交互。 */
export function DetailQuickEditor({
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
  onSaveAndCopy,
  onSaveAndPaste,
}: DetailQuickEditorProps) {
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
  const toolButtonClass = "inline-flex h-7 items-center gap-1 rounded-md border border-border/60 px-2 text-[12px] transition-[color,background-color,border-color,transform] hover:bg-black/[0.05] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-white/[0.08]";
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12px] text-muted-foreground">
          {tr("main.detail.quickEdit")}
          <em className="ml-2 not-italic opacity-70">{tr("main.detail.editorStats", { chars: content.length, lines: content.split(/\r?\n/).length })}</em>
        </span>
        <div className="flex flex-wrap items-center gap-1">
          <button className={toolButtonClass} onClick={onCancel} type="button">
            <X size={11} />
            {tr("agent.action.cancel")}
          </button>
          <button className={toolButtonClass} disabled={isSuggesting} onClick={requestSuggestion} type="button">
            <Sparkles size={11} />
            {isSuggesting ? tr("main.detail.analyzing") : tr("main.detail.suggest")}
          </button>
          <button
            className={toolButtonClass}
            onClick={() => {
              setShowVariables((current) => !current);
              if (!showVariables) onVariableDrawerOpen();
            }}
            type="button"
          >
            <FileJson size={11} />
            {tr("main.detail.variables")}
          </button>
          <button className={toolButtonClass} data-editor-action="save" disabled={!hasChanges || isSaving || !content.trim()} onClick={onSave} type="button">
            <Save size={11} />
            {isSaving ? tr("main.detail.saving") : tr("agent.action.save")}
          </button>
          <button className={toolButtonClass} data-editor-action="save-and-copy" disabled={!hasChanges || isSaving || !content.trim()} onClick={onSaveAndCopy} type="button">
            <Copy size={11} />
            {tr("main.detail.saveAndCopy")}
          </button>
          <button className={toolButtonClass} data-editor-action="save-and-paste" disabled={!hasChanges || isSaving || !content.trim()} onClick={onSaveAndPaste} type="button">
            <Clipboard size={11} />
            {tr("main.detail.saveAndPaste")}
          </button>
        </div>
      </div>
      <div aria-label={tr("main.detail.editTags")} className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-1">
          {tags.map((tag) => (
            <button
              aria-label={tr("main.detail.removeTag", { tag })}
              className="inline-flex items-center gap-1 rounded-full bg-black/[0.05] py-0.5 pl-2 pr-1.5 text-[11px] transition-[color,background-color,border-color,transform] hover:bg-black/[0.09] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 dark:bg-white/[0.09] dark:hover:bg-white/[0.15]"
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
            className="h-6 w-24 bg-transparent text-[12px] outline-none placeholder:text-muted-foreground/60"
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
          <div className="flex flex-wrap gap-1">
            {suggestedTags.map((tag) => (
              <button className="rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] text-muted-foreground transition-[color,background-color,border-color,transform] hover:bg-black/[0.04] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 dark:hover:bg-white/[0.07]" key={tag} onClick={() => addTag(tag)} type="button">
                #{tag}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {showVariables ? (
        <div aria-label={tr("main.detail.editVariables")} className="space-y-2 rounded-lg border border-border/60 p-3">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-medium">{tr("main.detail.sendScope")}</span>
            <em className="not-italic text-muted-foreground">{sensitiveFindings.length ? tr("main.detail.sensitiveSummaryOnly") : tr("main.detail.variablesVisibleThisSession")}</em>
          </div>
          <div className="grid gap-x-3 gap-y-1 text-[11px]" style={{ gridTemplateColumns: "auto auto 1fr" }}>
            {variableRows.map((row) => (
              <div className="contents" key={row.key}>
                <code className="rounded bg-black/[0.04] px-1.5 py-0.5 dark:bg-white/[0.07]">{row.key}</code>
                <span className="text-muted-foreground">{row.type}</span>
                <em className="truncate not-italic text-muted-foreground" title={row.example}>{row.example}</em>
              </div>
            ))}
          </div>
          {sensitiveFindings.length ? (
            <div className="flex flex-wrap gap-1.5">
              {sensitiveFindings.map((finding) => (
                <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] text-destructive" key={finding.kind}>{finding.label}</span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {suggestion ? (
        <div aria-label={tr("main.detail.suggestionPreview")} className="space-y-2 rounded-lg border border-primary/25 bg-primary/[0.04] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[12px] font-medium">
              <Sparkles size={12} />
              {tr("main.detail.smartSuggestion")}
              <em className="not-italic text-[11px] text-muted-foreground">
                {suggestion.riskLevel === "high" ? tr("main.detail.riskHigh") : suggestion.riskLevel === "medium" ? tr("main.detail.riskMedium") : tr("main.detail.riskLow")}
              </em>
            </span>
            <div className="flex items-center gap-1">
              <button className={toolButtonClass} disabled={!suggestion.contentPatch && !suggestion.tagPatch} onClick={() => applySuggestion("draft")} type="button">
                {tr("main.detail.applyToDraft")}
              </button>
              <button className={toolButtonClass} disabled={!suggestion.contentPatch && !suggestion.tagPatch || isSaving} onClick={() => applySuggestion("save")} type="button">
                {tr("main.detail.applyAndSave")}
              </button>
            </div>
          </div>
          <p className="text-[12px] text-muted-foreground">{suggestion.rationale}</p>
          {suggestion.tagPatch ? (
            <div className="flex flex-wrap gap-1.5 text-[11px]">
              {suggestion.tagPatch.add.map((tag) => (
                <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-700 dark:text-emerald-400" key={`add-${tag}`}>+ #{tag}</span>
              ))}
              {suggestion.tagPatch.remove.map((tag) => (
                <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-destructive" key={`remove-${tag}`}>- #{tag}</span>
              ))}
            </div>
          ) : null}
          {suggestion.contentPatch ? (
            <div aria-label={tr("main.detail.contentChangePreview")} className="grid gap-2 md:grid-cols-2">
              <div className="min-w-0 space-y-1">
                <span className="text-[11px] text-muted-foreground">{tr("main.detail.current")}</span>
                <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-md bg-black/[0.03] p-2 text-[11px] leading-relaxed dark:bg-white/[0.05]">{content.slice(0, 1600)}</pre>
              </div>
              <div className="min-w-0 space-y-1">
                <span className="text-[11px] text-muted-foreground">{tr("main.detail.suggested")}</span>
                <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-md bg-black/[0.03] p-2 text-[11px] leading-relaxed dark:bg-white/[0.05]">{suggestion.contentPatch.preview}</pre>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      {suggestionError ? <p className="text-[12px] text-destructive" role="alert">{suggestionError}</p> : null}
      <textarea
        aria-label={tr("main.detail.editContent")}
        className="h-64 w-full resize-y rounded-lg border border-border/60 bg-transparent p-3 font-mono text-[12px] leading-relaxed outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
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
      {error ? <p className="text-[12px] text-destructive" role="alert">{error}</p> : null}
    </div>
  );
}
