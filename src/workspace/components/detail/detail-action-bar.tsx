/** 底部动作区（设计 §4）：随三态切换按钮组；浏览态 = 复制(主)/原格式/路径/粘贴/编辑，
 *  编辑态/diff 态 = 保存生效(主)/退出。插件 detail-action 位在「… 扩展」内（空注册零 DOM）。 */
import { Check, ClipboardPaste, Copy, Pencil, Save, SquareArrowOutUpRight, X } from "lucide-react";
import type { ReactNode } from "react";
import type { TranslationKey } from "../../../i18n";
import type { DetailMode } from "./detail-state";

export type DetailActionBarProps = {
  mode: DetailMode;
  canCopyRich: boolean;
  canEdit: boolean;
  copyFeedback: boolean;
  hasPath: boolean;
  isSaving: boolean;
  pathCopied: boolean;
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
  onCopy: () => void;
  onCopyRich: () => void;
  onCopyPath: () => void;
  onEdit: () => void;
  onPaste: () => void;
  onSave: () => void;
  onExit: () => void;
  /** 插件 detail-action 注入位（现阶段由外壳传 quickActions；空数组零 DOM）。 */
  pluginActions?: ReactNode;
};

/** 主钮（bg-primary）与次钮（ghost）同一 28px 命中语言，按压 active:scale-95。 */
const primaryButton =
  "inline-flex h-7 items-center gap-1.5 rounded-md bg-primary px-2.5 text-[12px] font-medium text-primary-foreground transition-[color,background-color,border-color,transform] hover:bg-primary/90 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-40";
const ghostButton =
  "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] text-muted-foreground transition-[color,background-color,border-color,transform] hover:bg-black/[0.05] hover:text-foreground active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-white/[0.08]";

export function DetailActionBar({
  mode,
  canCopyRich,
  canEdit,
  copyFeedback,
  hasPath,
  isSaving,
  pathCopied,
  tr,
  onCopy,
  onCopyRich,
  onCopyPath,
  onEdit,
  onPaste,
  onSave,
  onExit,
  pluginActions,
}: DetailActionBarProps) {
  if (mode === "view") {
    return (
      <footer
        className="flex shrink-0 items-center gap-1 border-t border-black/[0.05] px-4 py-2 dark:border-white/[0.07]"
        data-surface="detail-action-bar"
      >
        <button
          className={primaryButton}
          data-detail-action="copy"
          onClick={onCopy}
          type="button"
        >
          {copyFeedback ? <Check size={13} /> : <Copy size={13} />}
          {copyFeedback ? tr("main.detail.copied") : tr("main.detail.action.copy")}
        </button>
        <button
          className={ghostButton}
          data-detail-action="copy-rich"
          data-tooltip={canCopyRich ? tr("main.detail.action.copyRichTitle") : tr("main.detail.action.copyRichUnavailable")}
          disabled={!canCopyRich}
          onClick={onCopyRich}
          title={canCopyRich ? tr("main.detail.action.copyRichTitle") : tr("main.detail.action.copyRichUnavailable")}
          type="button"
        >
          <SquareArrowOutUpRight size={13} />
          {tr("main.detail.action.copyRich")}
        </button>
        <button
          className={ghostButton}
          data-detail-action="copy-path"
          data-tooltip={tr("main.detail.action.copyPathTitle")}
          disabled={!hasPath}
          onClick={onCopyPath}
          title={tr("main.detail.action.copyPathTitle")}
          type="button"
        >
          {pathCopied ? <Check size={13} /> : <SquareArrowOutUpRight size={13} />}
          {pathCopied ? tr("main.detail.pathCopied") : tr("main.detail.action.copyPath")}
        </button>
        <button
          className={ghostButton}
          data-detail-action="paste"
          onClick={onPaste}
          type="button"
        >
          <ClipboardPaste size={13} />
          {tr("main.detail.action.paste")}
        </button>
        <button
          className={ghostButton}
          data-detail-action="edit"
          data-tooltip={canEdit ? tr("main.detail.quickEditTooltip") : tr("main.detail.action.editUnavailable")}
          disabled={!canEdit}
          onClick={onEdit}
          title={canEdit ? tr("main.detail.quickEditTooltip") : tr("main.detail.action.editUnavailable")}
          type="button"
        >
          <Pencil size={13} />
          {tr("main.detail.edit")}
        </button>
        {pluginActions ? <div className="ml-auto flex items-center gap-1">{pluginActions}</div> : null}
      </footer>
    );
  }
  const saving = mode === "edit";
  return (
    <footer
      className="flex shrink-0 items-center gap-1 border-t border-black/[0.05] px-4 py-2 dark:border-white/[0.07]"
      data-surface="detail-action-bar"
    >
      <button
        className={primaryButton}
        data-detail-action={mode === "edit" ? "save" : "save-draft"}
        disabled={isSaving}
        onClick={onSave}
        type="button"
      >
        <Save size={13} />
        {saving && isSaving ? tr("main.detail.saving") : tr("main.detail.action.saveEffect")}
      </button>
      <button
        className={ghostButton}
        data-detail-action={mode === "edit" ? "cancel-edit" : "discard-draft"}
        onClick={onExit}
        type="button"
      >
        <X size={13} />
        {mode === "edit" ? tr("main.detail.action.exitWithoutSave") : tr("main.detail.action.discardDraft")}
      </button>
      <span className="ml-auto text-[11px] text-muted-foreground">
        {mode === "diff" ? tr("main.detail.action.draftHint") : tr("main.detail.editorStatsHint")}
      </span>
    </footer>
  );
}
