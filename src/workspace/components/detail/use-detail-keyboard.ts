/** 详情页键盘层（capture 阶段，先于面板全局键盘）：E 进编辑 · ⌘S 保存 · Esc 层层后退 ·
 *  ⇧⌘C 复制路径 · J/K 上下条。消费的事件 stopPropagation，未消费的放行给 use-panel-keyboard。
 *
 *  clipboard-interaction-repair 第 1 项：view 态 Escape 统一由本层接管并走外壳的
 *  离开保护，原因是 use-panel-keyboard 的 Escape 分支在详情路由下会无条件
 *  navigateWorkspaceList()，绕过 confirmDiscardDraft（含浏览态标签写回中）。
 *  焦点在可编辑目标（浏览标签输入框等）时放行，保留控件原生 Escape。 */
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
  /** view 态 Escape 的统一离开请求：外壳先跑离开保护再决定返回列表。 */
  onRequestLeave: () => void;
  /** 存在未保存工作（正文/标签/Agent 草稿或浏览标签写回中）。无草稿时 view 态 Escape 保持原行为。 */
  hasUnsavedWork: boolean;
  onPrevious?: () => void;
  onNext?: () => void;
};

export function useDetailKeyboard(options: DetailKeyboardOptions) {
  const { mode, canEdit, hasPath, overlayOpen, onEnterEdit, onSave, onExit, onCopyPath, onRequestLeave, hasUnsavedWork, onPrevious, onNext } = options;
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
      if (event.key === "Escape" && mode !== "view") {
        // 编辑器聚焦时也必须拦截 Escape，否则全局列表处理会直接卸载草稿。
        event.preventDefault();
        event.stopPropagation();
        onExit();
        return;
      }
      // view 态：仅在存在未保存工作、且焦点不在输入或菜单/弹层时接管 Escape。
      // use-panel-keyboard 的 Escape 分支在详情路由下会无条件 navigateWorkspaceList()，
      // 绕过 confirmDiscardDraft；本层是 capture 阶段，先消费事件并走统一离开保护。
      // 可编辑目标与 role=menu/menuitem 保持原生 Escape（输入框取消输入、Radix 菜单关闭），
      // 避免抢先拦截破坏控件行为；按钮/链接焦点仍接管，其 Escape 无原生语义。
      const inMenuLayer =
        event.target instanceof Element &&
        Boolean(event.target.closest("[role='menu'], [role='menuitem'], [data-radix-popper-content-wrapper]"));
      if (event.key === "Escape" && mode === "view" && hasUnsavedWork && !editable && !inMenuLayer) {
        event.preventDefault();
        event.stopPropagation();
        onRequestLeave();
        return;
      }
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
      if (event.key !== "Escape" && event.target instanceof Element && event.target.closest("button, a, [role='menu'], [role='menuitem']")) return;
      if (key === "e" && !event.repeat) {
        if (mode !== "view" || !canEdit) return;
        event.preventDefault();
        event.stopPropagation();
        onEnterEdit();
        return;
      }
      if (key === "j" || key === "k" || event.key === "ArrowDown" || event.key === "ArrowUp") {
        const navigate = key === "j" || event.key === "ArrowDown" ? onNext : onPrevious;
        if (!navigate) return;
        event.preventDefault();
        event.stopPropagation();
        navigate();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [mode, canEdit, hasPath, overlayOpen, onEnterEdit, onSave, onExit, onCopyPath, onRequestLeave, hasUnsavedWork, onPrevious, onNext]);
}
