/** 详情页键盘层（capture 阶段，先于面板全局键盘）：E 进编辑 · ⌘S 保存 · Esc 层层后退 ·
 *  ⇧⌘C 复制路径 · J/K 上下条。消费的事件 stopPropagation，未消费的放行给 use-panel-keyboard。 */
import { useEffect } from "react";
import type { DetailMode } from "./detail-state";
import { isEditableTarget } from "./detail-state";

export type DetailKeyboardOptions = {
  mode: DetailMode;
  canEdit: boolean;
  hasPath: boolean;
  /** 弹层打开时键盘让位（采集弹窗/插件 popover 各自处理 Esc）。 */
  overlayOpen: boolean;
  onEnterEdit: () => void;
  onSave: () => void;
  onExit: () => void;
  onCopyPath: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
};

export function useDetailKeyboard(options: DetailKeyboardOptions) {
  const { mode, canEdit, hasPath, overlayOpen, onEnterEdit, onSave, onExit, onCopyPath, onPrevious, onNext } = options;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const editable = isEditableTarget(event.target);
      // ⇧⌘C：有路径才消费（否则放行给面板 ⌘C 复制）。编辑器内同样生效。
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && key === "c") {
        if (!hasPath) return;
        event.preventDefault();
        event.stopPropagation();
        onCopyPath();
        return;
      }
      if (overlayOpen) return;
      // ⌘S：编辑/diff 态保存；浏览态只拦截浏览器保存对话框。
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && key === "s") {
        event.preventDefault();
        if (mode !== "view") {
          event.stopPropagation();
          onSave();
        }
        return;
      }
      if (editable || event.metaKey || event.ctrlKey || event.altKey) return;
      if (key === "e" && !event.repeat) {
        if (mode !== "view" || !canEdit) return;
        event.preventDefault();
        event.stopPropagation();
        onEnterEdit();
        return;
      }
      if (event.key === "Escape") {
        if (mode === "view") return;
        event.preventDefault();
        event.stopPropagation();
        onExit();
        return;
      }
      if (key === "j" || key === "k") {
        const navigate = key === "j" ? onNext : onPrevious;
        if (!navigate) return;
        event.preventDefault();
        event.stopPropagation();
        navigate();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [mode, canEdit, hasPath, overlayOpen, onEnterEdit, onSave, onExit, onCopyPath, onPrevious, onNext]);
}
