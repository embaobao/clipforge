/** 快速面板全局键盘导航 hook（从 App.tsx 切出）：所有 window keydown 分支的原样平移。
 *  分支清单：Cmd+, 设置 / t·Tab 视图 / Cmd+P 固定 / Cmd+F 收藏 / Cmd+J 打开 / Cmd+A 全选 /
 *  Cmd+C 复制 / Cmd+X·Delete 删除 / Cmd+0-9 分组条目 / Escape 逐级退出 / Cmd+↑↓ 切组 /
 *  ↑↓·←→ 导航与建议高亮 / Enter 粘贴或应用建议 / 空格 预览与多选 / 普通字符唤醒搜索。
 *  边界：所有 state/handler 经 options 注入（主体保持单一事实源）；热路径无新增抽象开销。 */
import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ClipItem, PanelArrowKey, ViewKey } from "./clip-model";
import type { TranslationKey } from "../i18n";
import type { SearchSuggestion } from "../search-query";
import { toast } from "sonner";
import { logAppError } from "./panel-shared";

type WorkspaceRouteSnapshot = { name: string; clipId?: string | null };

export type PanelKeyboardOptions = {
  activeView: ViewKey;
  activeSurface: string;
  query: string;
  selectedId: string | null;
  selectedClip: ClipItem | null;
  selectedInList: ClipItem[];
  filteredClips: ClipItem[];
  multiSelectMode: boolean;
  isMultiPreviewOpen: boolean;
  quickPreviewOpen: boolean;
  isSearchActive: boolean;
  searchSuggestions: SearchSuggestion[];
  activeSuggestionIndex: number;
  workspaceRoute: WorkspaceRouteSnapshot;
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
  searchRef: { current: HTMLInputElement | null };
  settingsRef: { current: { panelPinned: boolean } };
  activeGroupStartRef: { current: number };
  programmaticGroupUntilRef: { current: number };
  switchClipboardView: (view: ViewKey) => void;
  togglePanelPinned: () => void;
  favoriteSelectedClips: (items: ClipItem[]) => Promise<void>;
  updateClip: (id: string, next: Partial<ClipItem>) => void;
  runPrimaryOpenAction: (item: ClipItem, source: "shortcut" | "keyboard" | "click" | "context-menu" | "detail") => Promise<void>;
  copySelectedClips: (items: ClipItem[]) => Promise<void>;
  copyClip: (item: ClipItem) => Promise<void>;
  hardDeleteClips: (ids: string[]) => Promise<void>;
  deleteClips: (ids: string[]) => Promise<void>;
  restoreClips: (ids: string[]) => Promise<void>;
  pasteClip: (item: ClipItem, source: string) => Promise<void>;
  handlePanelArrowNavigation: (key: PanelArrowKey, repeat?: boolean) => void;
  applySearchSuggestion: (suggestion: SearchSuggestion) => void;
  focusSearch: () => void;
  navigateWorkspaceList: () => Promise<void>;
  setQuery: React.Dispatch<React.SetStateAction<string>>;
  setActiveTag: (tag: string | null) => void;
  setFilterFavorite: (v: boolean) => void;
  setActiveTypeFilter: (v: "all" | ClipItem["payloadKind"]) => void;
  setSelectedId: React.Dispatch<React.SetStateAction<string | null>>;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  setMultiSelectMode: (v: boolean) => void;
  setKeyboardNavigating: (v: boolean) => void;
  setMultiPreviewOpen: (v: boolean) => void;
  setQuickPreviewOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setSearchActive: (v: boolean) => void;
  setIsPanelEntering: (v: boolean) => void;
  setActiveGroupStart: (v: number) => void;
  setGroupScrollTarget: (v: number | null) => void;
  setActiveSuggestionIndex: React.Dispatch<React.SetStateAction<number>>;
};

export function usePanelKeyboard({
  activeView,
  activeSurface,
  query,
  selectedId,
  selectedClip,
  selectedInList,
  filteredClips,
  multiSelectMode,
  isMultiPreviewOpen,
  quickPreviewOpen,
  isSearchActive,
  searchSuggestions,
  activeSuggestionIndex,
  workspaceRoute,
  tr,
  searchRef,
  settingsRef,
  activeGroupStartRef,
  programmaticGroupUntilRef,
  switchClipboardView,
  togglePanelPinned,
  favoriteSelectedClips,
  updateClip,
  runPrimaryOpenAction,
  copySelectedClips,
  copyClip,
  hardDeleteClips,
  deleteClips,
  restoreClips,
  pasteClip,
  handlePanelArrowNavigation,
  applySearchSuggestion,
  focusSearch,
  navigateWorkspaceList,
  setQuery,
  setActiveTag,
  setFilterFavorite,
  setActiveTypeFilter,
  setSelectedId,
  setSelectedIds,
  setMultiSelectMode,
  setKeyboardNavigating,
  setMultiPreviewOpen,
  setQuickPreviewOpen,
  setSearchActive,
  setIsPanelEntering,
  setActiveGroupStart,
  setGroupScrollTarget,
  setActiveSuggestionIndex,
}: PanelKeyboardOptions) {
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.isComposing) return;

      const target = event.target;
      const editable =
        target instanceof Element
          ? target.closest("input, textarea, select, [contenteditable='true']")
          : null;
      const allowListShortcutFromSearch = editable === searchRef.current && !query.trim();
      const quickItems = filteredClips;
      const key = event.key.toLowerCase();
      const currentItem = quickItems.find((clip) => clip.id === selectedId) ?? quickItems[0];

      if ((event.metaKey || event.ctrlKey) && !event.altKey && key === ",") {
        event.preventDefault();
        invoke("open_settings_window").catch((error) =>
          logAppError("warn", "Open settings window failed", String(error)),
        );
        return;
      }

      if (!editable && !event.ctrlKey && !event.metaKey && !event.altKey && key === "t") {
        event.preventDefault();
        switchClipboardView("trash");
        return;
      }

      if (event.key === "Tab" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        const views: ViewKey[] = ["history", "favorites"];
        const currentIndex = Math.max(0, views.indexOf(activeView));
        const nextIndex = event.shiftKey
          ? (currentIndex - 1 + views.length) % views.length
          : (currentIndex + 1) % views.length;
        switchClipboardView(views[nextIndex]);
        return;
      }

      if ((event.metaKey || event.ctrlKey) && !event.altKey && key === "p") {
        event.preventDefault();
        togglePanelPinned();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && !event.altKey && key === "f") {
        event.preventDefault();
        if (multiSelectMode && selectedInList.length > 0) {
          void favoriteSelectedClips(selectedInList);
        } else if (currentItem && activeView !== "trash") {
          updateClip(currentItem.id, { favorite: !currentItem.favorite });
          toast.success(currentItem.favorite ? tr("main.toast.unfavorited") : tr("main.toast.favorited"));
        }
        return;
      }

      if ((event.metaKey || event.ctrlKey) && !event.altKey && key === "j") {
        event.preventDefault();
        if (currentItem && !multiSelectMode) {
          void runPrimaryOpenAction(currentItem, "shortcut");
        }
        return;
      }

      if ((event.metaKey || event.ctrlKey) && !event.altKey && key === "a") {
        if (editable && !allowListShortcutFromSearch) return;
        if (!quickItems.length) return;
        event.preventDefault();
        setMultiSelectMode(true);
        setSelectedIds(new Set(quickItems.map((item) => item.id)));
        setSelectedId((current) => current ?? quickItems[0]?.id ?? null);
        return;
      }

      if ((event.metaKey || event.ctrlKey) && !event.altKey && key === "c") {
        if (editable && !allowListShortcutFromSearch) return;
        if (!currentItem) return;
        event.preventDefault();
        if (multiSelectMode) {
          void copySelectedClips(selectedInList);
        } else {
          void copyClip(currentItem);
        }
        return;
      }

      // 删除选中项：Ctrl+X 或 Delete（不处于编辑态时）
      if (((event.metaKey || event.ctrlKey) && !event.altKey && key === "x") || event.key === "Delete") {
        if (editable && !allowListShortcutFromSearch) return;
        event.preventDefault();
        if (multiSelectMode && selectedInList.length > 0) {
          if (activeView === "trash") void hardDeleteClips(selectedInList.map((item) => item.id));
          else void deleteClips(selectedInList.map((item) => item.id));
        } else if (selectedClip) {
          if (activeView === "trash") void hardDeleteClips([selectedClip.id]);
          else void deleteClips([selectedClip.id]);
        }
        return;
      }

      if (event.ctrlKey || event.altKey) return;

      // 普通数字键必须保留给搜索输入；只有 Cmd+数字才作用于列表条目。
      // Cmd+0..9：触发【激活分组】内第 N 项（激活分组由滚动位置决定；切组后同一数字对应不同项）。
      if (event.metaKey && /^[0-9]$/.test(event.key)) {
        const index = activeGroupStartRef.current + Number(event.key);
        const item = quickItems[index];
        if (!item) return;
        event.preventDefault();
        setSelectedId(item.id);
        if (multiSelectMode) {
          setSelectedIds((current) => {
            const next = new Set(current);
            if (next.has(item.id)) next.delete(item.id);
            else next.add(item.id);
            return next;
          });
          return;
        }
        if (activeView === "trash") {
          void restoreClips([item.id]);
          return;
        }
        void pasteClip(item, "cmd-number");
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        if (workspaceRoute.name !== "list") {
          setMultiPreviewOpen(false);
          void navigateWorkspaceList();
          return;
        }
        if (isMultiPreviewOpen) {
          setMultiPreviewOpen(false);
          void navigateWorkspaceList();
          return;
        }
        if (quickPreviewOpen) {
          setQuickPreviewOpen(false);
          return;
        }
        if (multiSelectMode) {
          setSelectedIds(new Set());
          setMultiSelectMode(false);
          void navigateWorkspaceList();
          return;
        }
        if (query.trim()) {
          setQuery("");
          setActiveTag(null);
          setFilterFavorite(false);
          setActiveTypeFilter("all");
          focusSearch();
          return;
        }
        if (isSearchActive) {
          setSearchActive(false);
          searchRef.current?.blur();
          return;
        }
        if (!settingsRef.current.panelPinned) {
          setIsPanelEntering(false);
          invoke("hide_quick_panel_command").catch((error) => logAppError("warn", "Hide quick panel failed", String(error)));
        }
        return;
      }

      // Cmd+↑ / Cmd+↓：切到上/下一分组（每 10 项一组，平滑滚动使该组进入视口），
      // 同时把键盘焦点/选中项移到新组第一项，方便紧接着 Enter / Cmd+0 操作。
      if (event.metaKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        event.preventDefault();
        const dir = event.key === "ArrowDown" ? 1 : -1;
        const maxGroupStart = Math.max(0, Math.floor(Math.max(0, quickItems.length - 1) / 10) * 10);
        const next = Math.min(Math.max(0, activeGroupStartRef.current + dir * 10), maxGroupStart);
        // 同步更新激活分组起点（含 ref，使同一 tick 内连按也能叠加）+ 屏蔽滚动回调一小段窗口，
        // 让快速连按 Cmd+↑/↓ 确定性地逐页叠加（0→10→20），不再因 activeGroupStart 异步滞后导致翻页不叠加/错位跳项。
        activeGroupStartRef.current = next;
        setActiveGroupStart(next);
        programmaticGroupUntilRef.current = Date.now() + 450;
        setGroupScrollTarget(next);
        const firstInGroup = quickItems[next];
        if (firstInGroup) {
          setSelectedId(firstInGroup.id);
        }
        return;
      }

      if (event.metaKey) return;

      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        if (editable && editable !== searchRef.current) return;
        event.preventDefault();
        handlePanelArrowNavigation(event.key);
        return;
      }

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        // 搜索聚焦且有建议时：↑/↓ 在 autocomplete 下拉里移动高亮，不再穿透去翻背后列表。
        if (editable === searchRef.current && searchSuggestions.length > 0) {
          event.preventDefault();
          const dir = event.key === "ArrowDown" ? 1 : -1;
          setActiveSuggestionIndex((i) => (i + dir + searchSuggestions.length) % searchSuggestions.length);
          return;
        }
        if (editable && editable !== searchRef.current) return;
        event.preventDefault();
        handlePanelArrowNavigation(event.key, event.repeat);
        return;
      }

      if (event.key === "Enter") {
        if (editable === searchRef.current && searchSuggestions.length > 0) {
          event.preventDefault();
          const idx = Math.min(Math.max(activeSuggestionIndex, 0), searchSuggestions.length - 1);
          applySearchSuggestion(searchSuggestions[idx]);
          return;
        }
        if (editable && editable !== searchRef.current) return;
        const item = quickItems.find((clip) => clip.id === selectedId) ?? quickItems[0];
        if (!item) return;
        event.preventDefault();
        if (activeView === "trash") {
          if (multiSelectMode) void restoreClips(selectedInList.map((clip) => clip.id));
          else void restoreClips([item.id]);
        } else if (multiSelectMode) void copySelectedClips(selectedInList);
        else void pasteClip(item, "enter");
        return;
      }

      if (event.key === " ") {
        const item = quickItems.find((clip) => clip.id === selectedId) ?? quickItems[0];
        if (!item || editable) return;
        event.preventDefault();
        if (multiSelectMode) {
          // 多选模式下空格继续切换当前项选中状态
          setKeyboardNavigating(true);
          setSelectedIds((current) => {
            const next = new Set(current);
            if (next.has(item.id)) next.delete(item.id);
            else next.add(item.id);
            return next;
          });
          return;
        }
        // 非多选模式下空格开关快速预览
        setQuickPreviewOpen((open) => !open);
        return;
      }

      if ((event.key === "/" || event.key.length === 1) && !editable && !multiSelectMode) {
        event.preventDefault();
        focusSearch();
        if (event.key !== "/" && event.key.length === 1) {
          setQuery((current) => `${current}${event.key}`);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  // deps 原样保留主体口径（stable handler 均为 useCallback 产物）。
  }, [
    activeView,
    activeSurface,
    filteredClips,
    focusSearch,
    isMultiPreviewOpen,
    isSearchActive,
    multiSelectMode,
    query,
    selectedId,
    selectedInList,
    searchSuggestions,
    activeSuggestionIndex,
    handlePanelArrowNavigation,
    toast,
    switchClipboardView,
    togglePanelPinned,
    workspaceRoute.clipId,
    workspaceRoute.name,
  ]);
}

