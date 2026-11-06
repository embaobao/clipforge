/** MD 编辑器（设计 §3，v8 定稿）：格式工具条 + 编辑/预览 tab + 状态行。
 *  值为纯 Markdown 文本；保存动作上抛外壳统一处理（onSave/onCancel），⌘S/Esc 由外壳键盘层接。 */
import {
  Bold,
  Code,
  Eye,
  Heading1,
  Heading2,
  Italic,
  Link2,
  List,
  ListOrdered,
  PenLine,
  Quote,
  SquareCode,
  Strikethrough,
} from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";
import { MarkdownPreview } from "../DetailPreview";
import type { ClipItem } from "../../../App";
import type { TranslationKey } from "../../../i18n";

export type MdEditorProps = {
  clip: ClipItem;
  value: string;
  error: string;
  isSaving: boolean;
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
  onCopyCode: (text: string, source: string, context?: Record<string, unknown>) => void;
  onPasteCode: (text: string, source: string, context?: Record<string, unknown>) => void;
};

const toolButton =
  "inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-[color,background-color,border-color,transform] hover:bg-black/[0.05] hover:text-foreground active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-white/[0.08]";
const tabButton =
  "inline-flex h-6 items-center gap-1 rounded-md px-2 text-[11px] transition-[color,background-color,border-color,transform] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

/** 选区包裹动作：无选区时插入空标记并置光标于内。 */
function wrapSelection(
  textarea: HTMLTextAreaElement,
  before: string,
  after: string,
  placeholder: string,
) {
  const { selectionStart, selectionEnd, value } = textarea;
  const selected = value.slice(selectionStart, selectionEnd);
  const inner = selected || placeholder;
  const next = `${value.slice(0, selectionStart)}${before}${inner}${after}${value.slice(selectionEnd)}`;
  const caret = selectionStart + before.length + inner.length;
  return { next, caretStart: selectionStart + before.length, caret };
}

/** 行首前缀动作（标题/列表/引用）：作用于选区覆盖的每一行。 */
function prefixLines(textarea: HTMLTextAreaElement, prefix: string) {
  const { selectionStart, selectionEnd, value } = textarea;
  const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
  let lineEnd = value.indexOf("\n", selectionEnd);
  if (lineEnd === -1) lineEnd = value.length;
  const block = value.slice(lineStart, lineEnd);
  const lines = block.split("\n").map((line) => `${prefix}${line}`);
  const joined = lines.join("\n");
  const next = `${value.slice(0, lineStart)}${joined}${value.slice(lineEnd)}`;
  const caret = lineStart + joined.length;
  return { next, caretStart: lineStart, caret };
}

export function MdEditor({
  clip,
  value,
  error,
  isSaving,
  tr,
  onChange,
  onCancel,
  onSave,
  onCopyCode,
  onPasteCode,
}: MdEditorProps) {
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const apply = (
    action: (textarea: HTMLTextAreaElement) => { next: string; caretStart: number; caret: number },
  ) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const { next, caretStart, caret } = action(textarea);
    onChange(next);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(caretStart, caret);
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const key = event.key.toLowerCase();
    if ((event.metaKey || event.ctrlKey) && key === "b") {
      event.preventDefault();
      apply((node) => wrapSelection(node, "**", "**", tr("main.detail.md.boldPlaceholder")));
      return;
    }
    if ((event.metaKey || event.ctrlKey) && key === "i") {
      event.preventDefault();
      apply((node) => wrapSelection(node, "*", "*", tr("main.detail.md.italicPlaceholder")));
      return;
    }
    if ((event.metaKey || event.ctrlKey) && key === "s") {
      event.preventDefault();
      onSave();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    }
  };

  const wordCount = value.length;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2" data-surface="detail-md-editor">
      {/* 工具条：格式动作 + 编辑/预览 tab */}
      <div className="flex shrink-0 flex-wrap items-center gap-1">
        <button aria-label={tr("main.detail.md.bold")} className={toolButton} onClick={() => apply((node) => wrapSelection(node, "**", "**", tr("main.detail.md.boldPlaceholder")))} title={`${tr("main.detail.md.bold")} ⌘B`} type="button">
          <Bold size={13} />
        </button>
        <button aria-label={tr("main.detail.md.italic")} className={toolButton} onClick={() => apply((node) => wrapSelection(node, "*", "*", tr("main.detail.md.italicPlaceholder")))} title={`${tr("main.detail.md.italic")} ⌘I`} type="button">
          <Italic size={13} />
        </button>
        <button aria-label={tr("main.detail.md.strikethrough")} className={toolButton} onClick={() => apply((node) => wrapSelection(node, "~~", "~~", tr("main.detail.md.strikePlaceholder")))} title={tr("main.detail.md.strikethrough")} type="button">
          <Strikethrough size={13} />
        </button>
        <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-black/[0.08] dark:bg-white/[0.12]" />
        <button aria-label={tr("main.detail.md.h1")} className={toolButton} onClick={() => apply((node) => prefixLines(node, "# "))} title={tr("main.detail.md.h1")} type="button">
          <Heading1 size={13} />
        </button>
        <button aria-label={tr("main.detail.md.h2")} className={toolButton} onClick={() => apply((node) => prefixLines(node, "## "))} title={tr("main.detail.md.h2")} type="button">
          <Heading2 size={13} />
        </button>
        <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-black/[0.08] dark:bg-white/[0.12]" />
        <button aria-label={tr("main.detail.md.unorderedList")} className={toolButton} onClick={() => apply((node) => prefixLines(node, "- "))} title={tr("main.detail.md.unorderedList")} type="button">
          <List size={13} />
        </button>
        <button aria-label={tr("main.detail.md.orderedList")} className={toolButton} onClick={() => apply((node) => prefixLines(node, "1. "))} title={tr("main.detail.md.orderedList")} type="button">
          <ListOrdered size={13} />
        </button>
        <button aria-label={tr("main.detail.md.quote")} className={toolButton} onClick={() => apply((node) => prefixLines(node, "> "))} title={tr("main.detail.md.quote")} type="button">
          <Quote size={13} />
        </button>
        <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-black/[0.08] dark:bg-white/[0.12]" />
        <button aria-label={tr("main.detail.md.inlineCode")} className={toolButton} onClick={() => apply((node) => wrapSelection(node, "`", "`", "code"))} title={tr("main.detail.md.inlineCode")} type="button">
          <Code size={13} />
        </button>
        <button aria-label={tr("main.detail.md.codeBlock")} className={toolButton} onClick={() => apply((node) => wrapSelection(node, "\n```\n", "\n```\n", "code"))} title={tr("main.detail.md.codeBlock")} type="button">
          <SquareCode size={13} />
        </button>
        <button aria-label={tr("main.detail.md.link")} className={toolButton} onClick={() => apply((node) => wrapSelection(node, "[", "](https://)", tr("main.detail.md.linkPlaceholder")))} title={tr("main.detail.md.link")} type="button">
          <Link2 size={13} />
        </button>
        <div className="ml-auto flex items-center gap-0.5 rounded-lg bg-black/[0.04] p-0.5 dark:bg-white/[0.07]">
          <button
            aria-pressed={tab === "edit"}
            className={`${tabButton} ${tab === "edit" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            data-md-tab="edit"
            onClick={() => setTab("edit")}
            type="button"
          >
            <PenLine size={11} />
            {tr("main.detail.md.editTab")}
          </button>
          <button
            aria-pressed={tab === "preview"}
            className={`${tabButton} ${tab === "preview" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            data-md-tab="preview"
            onClick={() => setTab("preview")}
            type="button"
          >
            <Eye size={11} />
            {tr("main.detail.md.previewTab")}
          </button>
        </div>
      </div>

      {tab === "edit" ? (
        <textarea
          ref={textareaRef}
          className="min-h-0 w-full flex-1 resize-none rounded-lg border border-border/60 bg-transparent p-3 font-mono text-[12px] leading-relaxed outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
          data-md-textarea
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={tr("main.detail.md.placeholder")}
          spellCheck={false}
          value={value}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border/60 p-3" data-md-preview>
          <MarkdownPreview
            clip={clip}
            content={value}
            onCopyCode={onCopyCode}
            onPasteCode={onPasteCode}
          />
        </div>
      )}

      {/* 状态行：字数 + 快捷键提示 + 错误 */}
      <div className="flex shrink-0 items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>
          {tr("main.detail.md.statusFormat", { count: wordCount })}
        </span>
        <span className="flex items-center gap-2">
          <span>⌘S {tr("main.detail.action.saveEffect")}</span>
          <span>Esc {tr("main.detail.action.exitWithoutSave")}</span>
          {isSaving ? <em className="not-italic text-foreground">{tr("main.detail.saving")}</em> : null}
        </span>
      </div>
      {error ? <p className="shrink-0 text-[12px] text-destructive" role="alert">{error}</p> : null}
    </div>
  );
}
