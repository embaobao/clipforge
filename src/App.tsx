import { invoke } from "@tauri-apps/api/core";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  formatCommandError,
  resolveAppLocale,
  t,
  type TranslationKey,
} from "./i18n";
import type { FilePathStatus } from "./services/clipboard";
import { resolvePrimaryPluginAction } from "./plugin-actions";
import {
  WorkspaceRouterProvider,
  navigateWorkspaceAggregate,
  navigateWorkspaceDetail,
  navigateWorkspaceList,
} from "./routes/workspace-router";
import { useWorkspaceStore } from "./stores/workspace-store";
import { SurfaceFade } from "./components/surface-fade";
import { AppErrorBoundary, PanelContentBoundary, type ErrorBoundaryCopy } from "./components/panel-error-boundary";
import { getShortcutModLabel, formatAggregate } from "./clipboard/clipboard-domain";
import { usePanelEnvironmentEffects } from "./clipboard/use-panel-environment";
import { usePanelBlurHide } from "./clipboard/use-panel-blur-hide";
import { usePanelBootstrap } from "./clipboard/use-panel-bootstrap";
import { useFilePathStatuses } from "./clipboard/use-file-path-statuses";
import { usePanelWindowListeners } from "./clipboard/use-panel-blur-hide";
import { useCleanupScheduler } from "./clipboard/use-cleanup-scheduler";
import { useClipboardList } from "./clipboard/use-clipboard-list";
import { useSettingsSync } from "./clipboard/use-settings-sync";
import { useClipWriteback } from "./clipboard/use-clip-writeback";
import { useClipTrash } from "./clipboard/use-clip-trash";
import { usePanelSearch } from "./clipboard/use-panel-search";
import { usePanelShow } from "./clipboard/use-panel-show";
import { useSearchSnapshotQuery } from "./clipboard/use-search-snapshot-query";
import { PanelTopBar } from "./clipboard/components/panel-top-bar";
import { PanelBottomBars } from "./clipboard/components/panel-bottom-bars";
import { ClipboardListRoute } from "./clipboard/components/clipboard-list-route";
import { ClipDetailRoute } from "./clipboard/components/clip-detail-route";
import { AggregateRoute } from "./clipboard/components/aggregate-route";
import { saveViewScrollTop } from "./clipboard/view-clip-cache";
import { usePanelKeyboard } from "./clipboard/use-panel-keyboard";
import { loadLocalSettings, mergeSettings, retagClips } from "./clipboard/panel-settings";
import { usePanelUiStore } from "./clipboard/panel-shared";
import { isTauriRuntime, logAppError } from "./clipboard/panel-shared";
import { buildSearchClipsRequest, isFavoriteView, getBucketForView, matchesSavedSearch, matchesSearchTerm, type SearchClipsRequest } from "./clipboard/clip-search";
import {
  canOpenClipTarget,
  createClip,
  normalizeClip,
  type PanelArrowKey,
  type PanelSurface,
  type ViewKey,
} from "./clipboard/clip-model";
import type { ClipItem } from "./clipboard/clip-model";

export { extractHashTags, normalizeTagList } from "./clipboard/clip-model";
export type {
  ClipCaptureContext,
  ClipItem,
  ClipPayloadKind,
  ClipboardRepresentation,
  PanelDensity,
  ViewKey,
} from "./clipboard/clip-model";


import type { AppSettings } from "./clipboard/app-settings";

export type { AppSettings, TagRule } from "./clipboard/app-settings";

function ClipForgeApp() {
  const isSettingsWindow = useMemo(
    () => new URLSearchParams(window.location.search).get("window") === "settings",
    [],
  );
  const initialSettings = useMemo(loadLocalSettings, []);
  // URL ?lang=zh-CN|en-US 覆盖语言：供悬浮窗验证器/截图脚本固定界面语言，不写入设置。
  const urlLanguage = useMemo(() => {
    const value = new URLSearchParams(window.location.search).get("lang");
    return value === "zh-CN" || value === "en-US" ? value : null;
  }, []);
  const initialLocale = resolveAppLocale(urlLanguage ?? initialSettings.language);
  const [settings, setSettings] = useState<AppSettings>({ ...initialSettings, language: urlLanguage ?? initialSettings.language });
  const locale = resolveAppLocale(settings.language);
  const tr = useCallback((key: TranslationKey, params?: Record<string, string | number>) => t(locale, key, params), [locale]);
  const formatNativeError = useCallback((error: unknown) => formatCommandError(tr, error), [tr]);
  const [clips, setClips] = useState<ClipItem[]>([]);
  const [activeView, setActiveView] = useState<ViewKey>("history");
  const [activeSurface, setActiveSurface] = useState<PanelSurface>("clipboard");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [keyboardNavigating, setKeyboardNavigating] = useState(false);
  const [activeGroupStart, setActiveGroupStart] = useState(0);
  const [groupScrollTarget, setGroupScrollTarget] = useState<number | null>(null);
  const filteredClipsRef = useRef<ClipItem[]>([]);
  const selectedIdRef = useRef<string | null>(null);
  const multiSelectModeRef = useRef(false);
  const keyboardNavigatingRef = useRef(false);
  const activeGroupStartRef = useRef(0);
  activeGroupStartRef.current = activeGroupStart;
  selectedIdRef.current = selectedId;
  multiSelectModeRef.current = multiSelectMode;
  keyboardNavigatingRef.current = keyboardNavigating;
  // 程序化翻页（Cmd+↑/↓）窗口期内屏蔽视口中心驱动的分组检测，避免 smooth scroll 中间值导致 activeGroupStart 闪烁/回弹。
  const programmaticGroupUntilRef = useRef(0);
  const handleActiveGroupChange = useCallback((groupStart: number) => {
    if (Date.now() < programmaticGroupUntilRef.current) return;
    activeGroupStartRef.current = groupStart;
    setActiveGroupStart((current) => (current === groupStart ? current : groupStart));
    if (keyboardNavigatingRef.current || multiSelectModeRef.current) return;
    const firstVisibleGroupItem = filteredClipsRef.current[groupStart];
    if (firstVisibleGroupItem && selectedIdRef.current !== firstVisibleGroupItem.id) {
      setSelectedId(firstVisibleGroupItem.id);
    }
  }, []);
  const [isMultiPreviewOpen, setMultiPreviewOpen] = useState(false);
  const [quickPreviewOpen, setQuickPreviewOpen] = useState(false);
  const [nativeStatus, setNativeStatus] = useState(() => t(initialLocale, "main.status.clipboardReady"));
  const [filePathStatuses, setFilePathStatuses] = useState<Record<string, FilePathStatus>>({});

  const [lastCopiedId, setLastCopiedId] = useState<string | null>(null);
  const [, setIsReadingClipboard] = useState(false);
  // 面板进入动画门控：真实运行时必须等唤起事件（showQuickPanel）才挂上 panel-in，
  // 否则动画在 webview 隐藏的首启阶段就开始并被冻结在 from{opacity:0}，面板永久不可见。
  // 浏览器预览没有唤起事件，初始 true 保持加载即播放入场。
  const [isPanelEntering, setIsPanelEntering] = useState(() => !isTauriRuntime());
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  // 视图切换滚动恢复(panel-list-perf):token 单调递增驱动 VirtualList 恢复,同 key 再进也生效。
  const [restoreScroll, setRestoreScroll] = useState<{ top: number; token: string } | null>(null);
  const restoreScrollTokenRef = useRef(0);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  usePanelEnvironmentEffects({ activeView, setNativeStatus, tr });
  const clipsRef = useRef<ClipItem[]>(clips);
  const searchRequestRef = useRef<SearchClipsRequest>({ bucket: "all", limit: 200 });
  const shellRef = useRef<HTMLElement | null>(null);
  const settingsRef = useRef<AppSettings>(settings);

  useSettingsSync({
    settings,
    setSettings,
    setClips,
    settingsRef,
    isSettingsWindow,
    urlLanguage,
    mergeSettings,
    retagClips,
  });
  const captureInFlightRef = useRef(false);
  const lastSeenClipboard = useRef("");
  const scrollAccelRef = useRef<number | null>(null);
  const panelFocusGraceUntilRef = useRef(0);
  const blurHideInFlightRef = useRef(false);
  const focusRetryTimersRef = useRef<number[]>([]);
  const panelShowStartedAtRef = useRef(0);
  // setPanelClosing 仍被 blur-hide/show 流程调用,但收起动画已迁到 Rust 原生 alpha 淡出,
  // isClosing 状态不再驱动任何 UI(CSS panel-out 已移除),故不订阅 isClosing。
  const setPanelClosing = usePanelUiStore((state) => state.setClosing);
  const workspaceRoute = useWorkspaceStore((state) => state.route);
  const errorBoundaryCopy = useMemo<ErrorBoundaryCopy>(
    () => ({
      toastMessage: tr("main.errorBoundary.toast"),
      recoverLabel: tr("main.errorBoundary.recover"),
      panelTitle: tr("main.errorBoundary.panelTitle"),
      panelMessage: tr("main.errorBoundary.panelMessage"),
    }),
    [tr],
  );
  useEffect(() => {
    clipsRef.current = clips;
  }, [clips]);

  usePanelBootstrap({
    isSettingsWindow,
    tr,
    settingsRef,
    setClips,
    clipsRef,
    setSelectedId,
    setNextCursor,
    setNativeStatus,
    normalizeClip,
  });

  const { loadMoreClips, captureClipboard, mergeTopClip } = useClipboardList({
    isSettingsWindow,
    setClips,
    clipsRef,
    setNextCursor,
    nextCursor,
    setIsLoadingMore,
    isLoadingMore,
    setSelectedId,
    setNativeStatus,
    setIsReadingClipboard,
    searchRequestRef,
    settingsRef,
    captureInFlightRef,
    lastSeenClipboard,
    tr,
    formatNativeError,
    normalizeClip,
    createClip,
  });

  useEffect(() => {
    return () => {
      if (scrollAccelRef.current) window.clearInterval(scrollAccelRef.current);
      focusRetryTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      focusRetryTimersRef.current = [];
    };
  }, []);

  usePanelBlurHide({
    blurHideInFlightRef,
    enabled: !isSettingsWindow,
    panelFocusGraceUntilRef,
    setIsPanelEntering,
    setPanelClosing,
  });

  const search = usePanelSearch({ clips, settings, tr, navigateWorkspaceList });
  const {
    query,
    setQuery,
    activeTag,
    setActiveTag,
    activeTypeFilter,
    setActiveTypeFilter,
    filterFavorite,
    setFilterFavorite,
    isSearchActive,
    setSearchActive,
    activeSuggestionIndex,
    setActiveSuggestionIndex,
    searchRef,
    parsedSearchCommand,
    effectiveQuery,
    effectiveTypeFilters,
    effectiveFilterFavorite,
    effectiveActiveTags,
    searchSuggestions,
    activeSearchSummary,
    applySearchSuggestion,
    focusSearch,
    clearClipboardFilters,
    searchByTag,
  } = search;

  const showQuickPanel = usePanelShow({
    tr,
    mergeTopClip,
    captureClipboard,
    searchRef,
    blurHideInFlightRef,
    panelFocusGraceUntilRef,
    panelShowStartedAtRef,
    focusRetryTimersRef,
    setActiveView,
    setActiveSurface,
    setSelectedIds,
    setMultiSelectMode,
    setQuery,
    setActiveTag,
    setActiveTypeFilter,
    setFilterFavorite,
    setSearchActive,
    setIsPanelEntering,
    setNativeStatus,
  });

  usePanelWindowListeners({
    enabled: !isSettingsWindow,
    setPanelClosing,
    setIsPanelEntering,
    showQuickPanel,
  });

  useCleanupScheduler({
    isSettingsWindow,
    settings,
  });

  const searchRequest = useMemo(
    () =>
      buildSearchClipsRequest({
        activeTag,
        activeTypeFilter,
        activeView,
        ast: parsedSearchCommand.ast,
        filterFavorite,
        limit: 200,
      }),
    [activeTag, activeTypeFilter, activeView, filterFavorite, parsedSearchCommand.ast],
  );
  const searchRequestKey = useMemo(() => JSON.stringify(searchRequest), [searchRequest]);
  // 列表滚动位置连续回写快照:切走再切回即恢复,不依赖快照重建。
  const handleListScrollTop = useCallback(
    (top: number) => saveViewScrollTop(searchRequestKey, top),
    [searchRequestKey],
  );

  useEffect(() => {
    searchRequestRef.current = searchRequest;
  }, [searchRequestKey, searchRequest]);

  useSearchSnapshotQuery({
    isSettingsWindow,
    searchRequestKey,
    settingsRef,
    clipsRef,
    selectedIdRef,
    searchRequestRef,
    setClips,
    setSelectedId,
    setNextCursor,
    setRestoreScroll,
    restoreScrollTokenRef,
    setNativeStatus,
    tr,
  });

  const filteredClips = useMemo(() => {
    const bucket = getBucketForView(activeView);
    let bucketSource = clips;
    if (activeView === "trash") {
      bucketSource = clips.filter((item) => item.deletedAt);
    } else {
      bucketSource = clips.filter((item) => !item.deletedAt);
      if (isFavoriteView(activeView)) {
        bucketSource = bucketSource.filter((item) => item.favorite);
      } else if (bucket) {
        bucketSource = bucketSource.filter((item) => item.bucket === bucket);
      }
    }
    return bucketSource.filter((item) => {
      if (effectiveTypeFilters.length && !effectiveTypeFilters.includes(item.payloadKind)) return false;
      if (effectiveFilterFavorite && !item.favorite && !isFavoriteView(activeView)) return false;
      const matchesQuery = effectiveQuery.trim() ? matchesSearchTerm(item, effectiveQuery, settings) : true;
      const matchesTag = effectiveActiveTags.length
        ? effectiveActiveTags.every((activeTagValue) => {
            const activeSavedSearch = settings.tagRules.find((rule) => rule.label.trim() === activeTagValue);
            return (
              item.tags.some((tag) => tag.toLowerCase() === activeTagValue.toLowerCase()) ||
              Boolean(activeSavedSearch && matchesSavedSearch(item, activeSavedSearch, settings))
            );
          })
        : true;
      return matchesQuery && matchesTag;
    });
  }, [
    activeView,
    clips,
    effectiveActiveTags,
    effectiveFilterFavorite,
    effectiveQuery,
    effectiveTypeFilters,
    settings,
  ]);
  filteredClipsRef.current = filteredClips;

  const selectedClip = useMemo(() => {
    if (selectedId) {
      const found = clips.find((item) => item.id === selectedId);
      if (found) return found;
    }
    return filteredClips[0] ?? null;
  }, [clips, filteredClips, selectedId]);

  useFilePathStatuses({ filePathStatuses, filteredClips, isSettingsWindow, setFilePathStatuses });

  const selectedInList = useMemo(() => {
    const itemsById = new Map(filteredClips.map((item) => [item.id, item]));
    return Array.from(selectedIds)
      .map((id) => itemsById.get(id))
      .filter((item): item is ClipItem => Boolean(item));
  }, [filteredClips, selectedIds]);

  useEffect(() => {
    // 筛选后移除隐藏项，避免菜单数量与实际批量操作不一致；虚拟滚动不影响 filteredClips。
    setSelectedIds((current) => {
      if (!current.size) return current;
      const visibleIds = new Set(filteredClips.map((item) => item.id));
      const next = new Set([...current].filter((id) => visibleIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [filteredClips]);

  const switchClipboardView = useCallback((view: ViewKey) => {
    setActiveSurface("clipboard");
    setActiveView(view);
    setSelectedIds(new Set());
    setMultiSelectMode(false);
    setMultiPreviewOpen(false);
    if (view === "trash" || activeView === "trash") {
      clearClipboardFilters();
      setSearchActive(false);
    }
    void navigateWorkspaceList();
  }, [activeView, clearClipboardFilters]);

  const movePanelSelection = useCallback((key: "ArrowUp" | "ArrowDown", repeat = false) => {
    if (!filteredClips.length) return;
    setKeyboardNavigating(true);
    const direction = key === "ArrowDown" ? 1 : -1;
    if (workspaceRoute.name === "detail") {
      const routeClipId = workspaceRoute.clipId ?? selectedId;
      const currentIndex = Math.max(
        0,
        filteredClips.findIndex((item) => item.id === routeClipId),
      );
      const nextIndex = Math.min(Math.max(currentIndex + direction, 0), filteredClips.length - 1);
      const nextItem = filteredClips[nextIndex];
      if (nextItem && nextItem.id !== routeClipId) {
        setSelectedId(nextItem.id);
        void navigateWorkspaceDetail(nextItem.id);
      }
      return;
    }
    const currentIndex = Math.max(
      0,
      filteredClips.findIndex((item) => item.id === selectedId),
    );
    const offset = direction * (repeat ? 4 : 1);
    const nextIndex = Math.min(Math.max(currentIndex + offset, 0), filteredClips.length - 1);
    const nextItem = filteredClips[nextIndex];
    if (nextItem) {
      setSelectedId(nextItem.id);
    }
  }, [filteredClips, selectedId, workspaceRoute.clipId, workspaceRoute.name]);

  const handlePanelArrowNavigation = useCallback((key: PanelArrowKey, repeat = false) => {
    if (key === "ArrowDown" || key === "ArrowUp") {
      movePanelSelection(key, repeat);
      return;
    }
    if (key === "ArrowRight") {
      if (!multiSelectMode && selectedClip) {
        logAppError("info", "keyboard-detail", {
          id: selectedClip.id,
          hasUrl: Boolean(selectedClip.analysis.url),
          hasAttachment: Boolean(selectedClip.analysis.attachment),
        });
        void navigateWorkspaceDetail(selectedClip.id);
      }
      return;
    }
    if (workspaceRoute.name !== "list") {
      setMultiPreviewOpen(false);
      void navigateWorkspaceList();
    } else if (isMultiPreviewOpen) {
      setMultiPreviewOpen(false);
      void navigateWorkspaceList();
    } else if (multiSelectMode) {
      setSelectedIds(new Set());
      setMultiSelectMode(false);
    }
  }, [isMultiPreviewOpen, movePanelSelection, multiSelectMode, selectedClip, workspaceRoute.name]);

  const { copyClip, ocrExtractAndCopy, copyText, pasteText, updateClip, exportSelectedTextFiles, pasteClip, favoriteSelectedClips, copySelectedClips, openClipTarget, openSystemPath, updateClipContent, aggregateFormat, setAggregateFormat } = useClipWriteback({
    setClips,
    clipsRef,
    settingsRef,
    setLastCopiedId,
    setNativeStatus,
    setSelectedId,
    tr,
    formatNativeError,
    normalizeClip,
    lastSeenClipboard,
    selectedId,
    setIsPanelEntering,
    setSelectedIds,
    setMultiSelectMode,
    setMultiPreviewOpen,
    openPath,
    openUrl,
  });

  // 聚合预览与 copySelectedClips 共用 formatAggregate + 同一份格式配置：预览即复制结果。
  const aggregatePreview = useMemo(() => formatAggregate(selectedInList, aggregateFormat), [selectedInList, aggregateFormat]);

  const { deleteClips, restoreClips, hardDeleteClips, emptyTrash } = useClipTrash({
    clips,
    filteredClips,
    selectedId,
    clipsRef,
    setClips,
    setSelectedId,
    setSelectedIds,
    setMultiSelectMode,
    setNativeStatus,
    tr,
    formatNativeError,
  });

  const togglePanelPinned = useCallback(() => {
    // 事务链：先改 Rust 权威源 PANEL_PINNED，确认成功才落前端 state（随后经设置同步写盘）。
    // 失败不改任何状态——避免「前端显示已固定但 Rust 未固定」或反向漂移，
    // 也堵住旧链路 fire-and-forget 失败仍写盘、重启把脏值灌回 Rust 的复发路径。
    const nextPinned = !settingsRef.current.panelPinned;
    invoke("set_panel_pinned_command", { pinned: nextPinned })
      .then(() => setSettings((prev) => ({ ...prev, panelPinned: nextPinned })))
      .catch((error) => logAppError("warn", "Toggle panel pin failed", String(error)));
  }, []);

  // 快速面板行级回调：引用稳定是 ClipboardRow memo（行重渲染跳过）的前提，
  // 依赖只允许 setter/useClipWriteback 的 useCallback 产物与模块级函数。
  const handleRowSelect = useCallback((item: ClipItem) => setSelectedId(item.id), []);
  const handleRowStartMultiSelect = useCallback((id: string) => {
    setMultiSelectMode(true);
    setMultiPreviewOpen(false);
    setSelectedIds(new Set([id]));
  }, []);
  const handleRowToggleSelected = useCallback((id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const handleRowFavorite = useCallback(
    (item: ClipItem) => updateClip(item.id, { favorite: !item.favorite }),
    [updateClip],
  );

  usePanelKeyboard({
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
    workspaceRoute: { name: workspaceRoute.name, clipId: workspaceRoute.clipId },
    tr,
    searchRef,
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
  });

  async function runPrimaryOpenAction(item: ClipItem, source: "shortcut" | "keyboard" | "click" | "context-menu" | "detail") {
    try {
      setSelectedId(item.id);
      const resolution = resolvePrimaryPluginAction(item, {
        surface: source === "detail" ? "detail" : "quick-action",
        shortcut: source === "shortcut" ? "Mod+J" : undefined,
      });
      logAppError("info", "quick-action: resolved", {
        id: item.id,
        source,
        traceId: resolution.traceId,
        pluginId: resolution.selected.pluginId,
        actionId: resolution.selected.actionId,
        parsedTargets: resolution.parsedTargets.map((target) => ({ id: target.id, kind: target.kind, label: target.label })),
        candidates: resolution.candidates,
      });
      if (resolution.selected.pluginId === "builtin.open-link" && resolution.selected.targetValue) {
        await openClipTarget(item, resolution.selected.targetValue);
        return;
      }
      if (resolution.selected.pluginId === "builtin.open-link" && canOpenClipTarget(item)) {
        await openClipTarget(item);
        return;
      }
      await navigateWorkspaceDetail(item.id);
    } catch (error) {
      logAppError("warn", "quick-action: plugin action failed", {
        id: item.id,
        source,
        error: String(error),
      });
      setNativeStatus(tr("main.status.pluginActionUnavailable"));
    }
  }

  const showSearchBar = activeSurface === "clipboard" && workspaceRoute.name === "list";
  const shouldRenderSearchBar = showSearchBar && (isSearchActive || Boolean(query));

  const modLabel = getShortcutModLabel();

  return (
    <main
      data-surface="clipboard"
      // 宽度：设计基准 480px，但悬浮窗实际 420px（tauri.conf 默认）且最小 320px；
      // w-[min(480px,100%)] 保证小窗/浏览器窄窗口下收缩适配，不再裁掉右侧操作区。
      // 高度撑满窗口（h-screen）：悬浮窗是 transparent 窗口，面板 h-fit 时内容低于窗高
      // 会在底部留一条透明带，macOS 合成器在该区域画出残留波浪状伪影（「背景透明/波浪线」）。
      // 窗高由 Rust 按设置设定（300-1000），面板必须等于窗高，不再用 h-fit/max-h 截断。
      className={`relative mx-auto grid h-screen w-[min(480px,100%)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-[14px] material panel-shadow${isPanelEntering ? " panel-in" : ""}`}
      ref={shellRef}
    >
      {workspaceRoute.name !== "detail" && (
        <PanelTopBar
          activeView={activeView}
          showSearchBar={shouldRenderSearchBar}
          search={search}
          onPanelArrowKey={handlePanelArrowNavigation}
          onViewChange={switchClipboardView}
          tr={tr}
        />
      )}

      <section className="min-w-0 overflow-hidden">
        <PanelContentBoundary
          copy={errorBoundaryCopy}
          resetKey={`workspace:${activeView}:${selectedId ?? "none"}:${filteredClips.length}:${selectedInList.length}`}
        >
          <SurfaceFade routeKey={workspaceRoute.name}>
          <WorkspaceRouterProvider
            fallbackCopy={{
              routeTitle: tr("main.workspace.routeErrorTitle"),
              routeMessage: tr("main.workspace.routeErrorMessage"),
              providerTitle: tr("main.workspace.providerErrorTitle"),
              providerMessage: tr("main.workspace.providerErrorMessage"),
              backToList: tr("main.workspace.backToList"),
              retry: tr("main.workspace.retry"),
            }}
            renderList={() => (
              <ClipboardListRoute
                activeView={activeView}
                selectedClip={selectedClip}
                keyboardNavigating={keyboardNavigating}
                filteredClips={filteredClips}
                selectedInList={selectedInList}
                activeSearchSummary={activeSearchSummary}
                nextCursor={nextCursor}
                isLoadingMore={isLoadingMore}
                multiSelectMode={multiSelectMode}
                selectedIds={selectedIds}
                settings={settings}
                lastCopiedId={lastCopiedId}
                filePathStatuses={filePathStatuses}
                restoreScroll={restoreScroll}
                activeGroupStart={activeGroupStart}
                groupScrollTarget={groupScrollTarget}
                quickPreviewOpen={quickPreviewOpen}
                writeback={{ pasteClip, favoriteSelectedClips, copySelectedClips, copyClip, ocrExtractAndCopy }}
                emptyTrash={emptyTrash}
                hardDeleteClips={hardDeleteClips}
                restoreClips={restoreClips}
                deleteClips={deleteClips}
                loadMoreClips={loadMoreClips}
                onListScrollTop={handleListScrollTop}
                onRowFavorite={handleRowFavorite}
                onRowSelect={handleRowSelect}
                onRowStartMultiSelect={handleRowStartMultiSelect}
                onRowToggleSelected={handleRowToggleSelected}
                onActiveGroupChange={handleActiveGroupChange}
                navigateWorkspaceList={navigateWorkspaceList}
                navigateWorkspaceAggregate={navigateWorkspaceAggregate}
                setSelectedId={setSelectedId}
                setSelectedIds={setSelectedIds}
                setMultiSelectMode={setMultiSelectMode}
                setMultiPreviewOpen={setMultiPreviewOpen}
                setKeyboardNavigating={setKeyboardNavigating}
                setQuickPreviewOpen={setQuickPreviewOpen}
                tr={tr}
              />
            )}
            renderDetail={(clipId) => (
              <ClipDetailRoute
                clipId={clipId}
                clips={clips}
                selectedClip={selectedClip}
                filteredClips={filteredClips}
                filePathStatuses={filePathStatuses}
                settings={settings}
                settingsRef={settingsRef}
                clipsRef={clipsRef}
                setClips={setClips}
                setNativeStatus={setNativeStatus}
                setSelectedId={setSelectedId}
                navigateWorkspaceList={navigateWorkspaceList}
                navigateWorkspaceDetail={navigateWorkspaceDetail}
                copyClip={copyClip}
                copyText={copyText}
                pasteText={pasteText}
                ocrExtractAndCopy={ocrExtractAndCopy}
                openClipTarget={openClipTarget}
                openSystemPath={openSystemPath}
                searchByTag={searchByTag}
                updateClip={updateClip}
                updateClipContent={updateClipContent}
                tr={tr}
              />
            )}
            renderAggregate={() => (
              <AggregateRoute
                selectedInList={selectedInList}
                aggregatePreview={aggregatePreview}
                aggregateFormat={aggregateFormat}

                copySelectedClips={copySelectedClips}
                copyClip={copyClip}
                exportSelectedTextFiles={exportSelectedTextFiles}
                setAggregateFormat={setAggregateFormat}
                setMultiPreviewOpen={setMultiPreviewOpen}
                setMultiSelectMode={setMultiSelectMode}
                setSelectedId={setSelectedId}
                navigateWorkspaceList={navigateWorkspaceList}
                navigateWorkspaceDetail={navigateWorkspaceDetail}
                setNativeStatus={setNativeStatus}
                tr={tr}
                formatNativeError={formatNativeError}
              />
            )}
          />
          </SurfaceFade>
        </PanelContentBoundary>
      </section>

      {workspaceRoute.name === "list" ? (
        <PanelBottomBars
          activeView={activeView}
          multiSelectMode={multiSelectMode}
          selectedInList={selectedInList}
          selectedClip={selectedClip}
          filteredCount={filteredClips.length}
          nativeStatus={nativeStatus}
          modLabel={modLabel}
          copyClip={copyClip}
          deleteClips={deleteClips}
          updateClip={updateClip}
          onTogglePanelPinned={togglePanelPinned}
          tr={tr}
        />
      ) : null}
    </main>
  );
}

function App() {
  const locale = resolveAppLocale(loadLocalSettings().language);
  return (
    <AppErrorBoundary
      copy={{
        toastMessage: t(locale, "main.errorBoundary.toast"),
        recoverLabel: t(locale, "main.errorBoundary.recover"),
      }}
    >
      <ClipForgeApp />
    </AppErrorBoundary>
  );
}

export default App;
