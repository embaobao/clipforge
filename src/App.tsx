import { Clipboard, Copy, ExternalLink, FileJson } from "lucide-react";
import { PanelStatusFeedback } from "./clipboard/components/PanelStatusFeedback";
import { TopToolbar } from "./clipboard/components/TopToolbar";
import { QuickCommandMenu } from "./clipboard/components/QuickCommandMenu";
import { MultiSelectBottomBar } from "./clipboard/components/MultiSelectBottomBar";
import {
  getShortcutModLabel,
} from "./clipboard/clipboard-domain";
import { invoke } from "@tauri-apps/api/core";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { Component, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { ErrorInfo, ReactNode, UIEvent } from "react";
import {
  formatCommandError,
  resolveAppLocale,
  t,
  type AppLanguagePreference,
  type TranslationKey,
} from "./i18n";
import { pasteClipboard, writeClipboard, type FilePathStatus } from "./services/clipboard";
import { resolvePrimaryPluginAction } from "./plugin-actions";
import {
  getSearchSuggestionToken,
  normalizeTagName,
  parseSearchCommand,
  type SearchSuggestion,
} from "./search-query";
import {
  WorkspaceRouterProvider,
  navigateWorkspaceAggregate,
  navigateWorkspaceDetail,
  navigateWorkspaceList,
} from "./routes/workspace-router";
import { useWorkspaceStore } from "./stores/workspace-store";
import { ClipDetailWorkspace, MultiAggregateWorkspace } from "./workspace/workspace-panels";
import { openDshWindow } from "./agent/dsh-analysis";
import { GlassSearchBar } from "./clipboard/components/GlassSearchBar";
import { QuickPastePanel } from "./clipboard/components/QuickPastePanel";
import { TrashPanel } from "./clipboard/components/TrashPanel";
import { analyzeClipboardWithDsh, createWindowDragHandler, logAppError, useDebouncedValue, waitForPasteTriggerRelease } from "./clipboard/panel-shared";
import { usePanelEnvironmentEffects } from "./clipboard/use-panel-environment";
import { usePanelBlurHide } from "./clipboard/use-panel-blur-hide";
import { usePanelBootstrap } from "./clipboard/use-panel-bootstrap";
import { useFilePathStatuses } from "./clipboard/use-file-path-statuses";
import { usePanelWindowListeners } from "./clipboard/use-panel-blur-hide";
import { useCleanupScheduler } from "./clipboard/use-cleanup-scheduler";
import { isQueryClipPayload, useClipboardList, type QueryClipPayload } from "./clipboard/use-clipboard-list";
import { useSettingsSync } from "./clipboard/use-settings-sync";
import { useClipWriteback } from "./clipboard/use-clip-writeback";
import { usePanelKeyboard } from "./clipboard/use-panel-keyboard";
import { loadLocalSettings, mergeSettings, retagClips } from "./clipboard/panel-settings";
import { usePanelUiStore } from "./clipboard/panel-shared";
import { buildBaseSearchSuggestions, buildSearchClipsRequest, buildSearchSuggestions, isFavoriteView, getBucketForView, matchesSavedSearch, matchesSearchTerm, removeSearchFilterToken, type SearchClipsRequest } from "./clipboard/clip-search";
import {
  createClip,
  normalizeClip,
  truncateText,
  type ContentDisplayMode,
  type PanelArrowKey,
  type PanelDensity,
  type PanelSurface,
  type TagMode,
  type ViewKey,
} from "./clipboard/clip-model";
import {
  extractUrls,
  normalizeTagList,
  type ClipItem,
  type ClipTypeFilter,
  canOpenClipTarget,
  type PasteMode,
} from "./clipboard/clip-model";

export { extractHashTags, normalizeTagList } from "./clipboard/clip-model";
export type {
  ClipCaptureContext,
  ClipItem,
  ClipPayloadKind,
  ClipboardRepresentation,
  PanelDensity,
  ViewKey,
} from "./clipboard/clip-model";

import { startPerfSpan } from "./performance-smoke";

export type TagRule = {
  id: string;
  label: string;
  query: string;
};

export type AppSettings = {
  language: AppLanguagePreference;
  panelDensity: PanelDensity;
  quickItemLimit: number;
  maxStoredItems: number;
  clipboardPollMs: number;
  tagMode: TagMode;
  tagRules: TagRule[];
  contentDisplayMode: ContentDisplayMode;
  showSourceBadges: boolean;
  enableMarkdownPreview: boolean;
  fuzzySearchEnabled: boolean;
  pinyinSearchEnabled: boolean;
  globalShortcut: string;
  copyPreviewEnabled: boolean;
  cleanupEnabled: boolean;
  cleanupIntervalHours: number;
  softDeletedRetentionDays: number;
  panelBackgroundOpacity: number;
  enableScrollCollapse: boolean;
  panelPinned: boolean;
  panelWidth: number;
  panelHeight: number;
  onboardingCompleted: boolean;
  onboardingShownAt?: number | null;
  launchAtLogin: boolean;
  logMaxSizeMb: number;
  logKeepRatio: number;
  logMaxLines: number;
  logRetentionDays: number;
  logAutoCleanup: boolean;
  logCleanupIntervalMin: number;
  debugLogsEnabled: boolean;
  captureTextEnabled: boolean;
  captureHtmlEnabled: boolean;
  captureRtfEnabled: boolean;
  captureImageEnabled: boolean;
  captureFileEnabled: boolean;
  captureSensitiveEnabled: boolean;
  captureApplicationContext: boolean;
  imageMaxSizeMb: number;
  textMaxSizeMb: number;
};

type ErrorBoundaryCopy = {
  toastMessage: string;
  recoverLabel: string;
  panelTitle: string;
  panelMessage: string;
};

class AppErrorBoundary extends Component<{ children: ReactNode; copy: Pick<ErrorBoundaryCopy, "toastMessage" | "recoverLabel"> }, { errorMessage: string | null; resetKey: number }> {
  state = { errorMessage: null, resetKey: 0 };

  static getDerivedStateFromError(error: Error) {
    return { errorMessage: error.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logAppError("error", error.message, info.componentStack);
  }

  render() {
    return (
      <>
        <div key={this.state.resetKey}>{this.props.children}</div>
        {this.state.errorMessage ? (
          <div className="runtime-error-toast" role="status">
            <Clipboard size={16} />
            <span>{this.props.copy.toastMessage}</span>
            <button
              className="text-button"
              onClick={() => this.setState((state) => ({ errorMessage: null, resetKey: state.resetKey + 1 }))}
              type="button"
            >
              {this.props.copy.recoverLabel}
            </button>
          </div>
        ) : null}
      </>
    );
  }
}

class PanelContentBoundary extends Component<
  { children: ReactNode; copy: Pick<ErrorBoundaryCopy, "panelTitle" | "panelMessage">; resetKey: string },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidUpdate(previous: { resetKey: string }) {
    if (previous.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logAppError("error", `Panel content failed: ${error.message}`, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
          <Clipboard size={22} />
          <strong className="text-[13px] font-medium">{this.props.copy.panelTitle}</strong>
          <span className="text-[12px] text-muted-foreground">{this.props.copy.panelMessage}</span>
        </div>
      );
    }
    return this.props.children;
  }
}

function ClipForgeApp() {
  const isSettingsWindow = useMemo(
    () => new URLSearchParams(window.location.search).get("window") === "settings",
    [],
  );
  const initialSettings = useMemo(loadLocalSettings, []);
  const initialLocale = resolveAppLocale(initialSettings.language);
  const [settings, setSettings] = useState<AppSettings>(initialSettings);
  const locale = resolveAppLocale(settings.language);
  const tr = useCallback((key: TranslationKey, params?: Record<string, string | number>) => t(locale, key, params), [locale]);
  const formatNativeError = useCallback((error: unknown) => formatCommandError(tr, error), [tr]);
  const [clips, setClips] = useState<ClipItem[]>([]);
  const [query, setQuery] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [activeTypeFilter, setActiveTypeFilter] = useState<ClipTypeFilter>("all");
  const [filterFavorite, setFilterFavorite] = useState(false);
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
  const [isSearchActive, setSearchActive] = useState(false);
  const [nativeStatus, setNativeStatus] = useState(() => t(initialLocale, "main.status.clipboardReady"));
  const [filePathStatuses, setFilePathStatuses] = useState<Record<string, FilePathStatus>>({});

  const [lastCopiedId, setLastCopiedId] = useState<string | null>(null);
  const [, setIsReadingClipboard] = useState(false);
  const [, setIsPanelEntering] = useState(false);
  const [, setScrollOffset] = useState(0);
  const [, setSearchCompact] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const debouncedQuery = useDebouncedValue(query, 120);
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
    mergeSettings,
    retagClips,
  });
  const captureInFlightRef = useRef(false);
  const lastSeenClipboard = useRef("");
  const searchRef = useRef<HTMLInputElement | null>(null);
  const scrollAccelRef = useRef<number | null>(null);
  const panelFocusGraceUntilRef = useRef(0);
  const blurHideInFlightRef = useRef(false);
  const focusRetryTimersRef = useRef<number[]>([]);
  const panelShowStartedAtRef = useRef(0);
  const isPanelClosing = usePanelUiStore((state) => state.isClosing);
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

  const { loadMoreClips, captureClipboard } = useClipboardList({
    isSettingsWindow,
    setClips,
    clipsRef,
    setNextCursor,
    nextCursor,
    setIsLoadingMore,
    isLoadingMore,
    setSelectedId,
    setActiveView,
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

  const handleScroll = useCallback((event: UIEvent<HTMLElement>) => {
    const top = event.currentTarget.scrollTop;
    setScrollOffset(top);
    setSearchCompact(top > 18);
  }, []);

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

  const showQuickPanel = useCallback(
    async (reason: "shortcut" | "tray") => {
      const finishPanelOpenPerf = startPerfSpan("panel.open", { reason });
      blurHideInFlightRef.current = false;
      // 唤起后只在极短窗口内忽略失焦（吸收 show_and_make_key 引发的一瞬 blur→focus 抖动）。
      // 原值 2400ms 太长：唤起提速后，用户在 2.4s 内点别的窗口，那次 blur 被吞掉、之后不再有
      // blur，面板就不再自动隐藏。400ms 足以覆盖抖动，又不至于吞掉真实的「点开别处」失焦。
      panelFocusGraceUntilRef.current = Date.now() + 400;
      panelShowStartedAtRef.current = Date.now();
      focusRetryTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      focusRetryTimersRef.current = [];
      setActiveView("history");
      setActiveSurface("clipboard");
      setSelectedIds(new Set());
      setMultiSelectMode(false);
      setQuery("");
      setActiveTag(null);
      setActiveTypeFilter("all");
      setFilterFavorite(false);
      setSearchActive(true);
      setIsPanelEntering(true);
      // 非激活面板不能依赖第一下普通字符来“唤醒”搜索；打开后立即渲染并聚焦输入框。
      [0, 80, 180].forEach((delay) => {
        const timer = window.setTimeout(() => {
          if (document.activeElement !== searchRef.current) {
            searchRef.current?.focus();
          }
          if (delay === 180) {
            finishPanelOpenPerf({
              searchActive: true,
              searchFocused: document.activeElement === searchRef.current,
            });
            logAppError("info", "panel-keyboard: search focus settle", {
              active: document.activeElement === searchRef.current,
              reason,
              openReadyMs: Date.now() - panelShowStartedAtRef.current,
            });
          }
        }, delay);
        focusRetryTimersRef.current.push(timer);
      });
      setNativeStatus(reason === "tray" ? tr("main.status.panelFocusedTray") : tr("main.status.panelFocusedShortcut"));
      // 后台监听线程每 100ms 已在采集，这里只是兜底；延后到 300ms，避免与「唤起后立即输入」
      // 抢主线程——setClips 触发的重渲染会吞掉最初几个按键，造成「面板出来后要等一下才能打字」。
      window.setTimeout(() => {
        void captureClipboard("manual");
      }, 300);
    },
    [captureClipboard, tr],
  );

  usePanelWindowListeners({
    enabled: !isSettingsWindow,
    setPanelClosing,
    setIsPanelEntering,
    settingsRef,
    showQuickPanel,
  });

  useCleanupScheduler({
    isSettingsWindow,
    settings,
  });

  const handleWindowDrag = createWindowDragHandler();

  const baseSearchSuggestions = useMemo(
    () => buildBaseSearchSuggestions(clips, settings, tr),
    [clips, settings.tagRules, tr],
  );

  const parsedSearchCommand = useMemo(
    () => parseSearchCommand(debouncedQuery, baseSearchSuggestions),
    [baseSearchSuggestions, debouncedQuery],
  );

  const effectiveQuery = parsedSearchCommand.handled ? parsedSearchCommand.queryText : debouncedQuery;
  const effectiveTypeFilters =
    activeTypeFilter !== "all" ? [activeTypeFilter] : parsedSearchCommand.ast.types;
  const effectiveFilterFavorite = filterFavorite || parsedSearchCommand.filterFavorite;
  const effectiveActiveTags = normalizeTagList([...(activeTag ? [activeTag] : []), ...parsedSearchCommand.ast.tags]);
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

  useEffect(() => {
    searchRequestRef.current = searchRequest;
  }, [searchRequestKey, searchRequest]);

  useEffect(() => {
    if (isSettingsWindow) return;
    let cancelled = false;
    const request = JSON.parse(searchRequestKey) as SearchClipsRequest;
    searchRequestRef.current = request;
    invoke<QueryClipPayload>("search_clip_records", { input: request })
      .then((payload) => {
        if (cancelled) return;
        if (!isQueryClipPayload(payload)) throw new Error("Invalid search_clip_records payload");
        const items = payload.items
          .map((item) => normalizeClip(item, settingsRef.current))
          .filter((item): item is ClipItem => Boolean(item));
        clipsRef.current = items;
        setClips(items);
        setNextCursor(payload.nextCursor ?? null);
        setSelectedId((current) => (current && items.some((item) => item.id === current) ? current : (items[0]?.id ?? null)));
      })
      .catch((error) => {
        if (!cancelled) {
          logAppError("warn", "Search clip records failed", String(error));
          setNativeStatus(tr("main.status.searchFailed"));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isSettingsWindow, searchRequestKey, tr]);

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

  const activeSearchSummary = useMemo(() => {
    const parts = [
      ...parsedSearchCommand.ast.labels,
      ...parsedSearchCommand.ast.invalidTokens,
      effectiveQuery.trim() ? `text:${effectiveQuery.trim()}` : "",
    ].filter(Boolean);
    return parts.length ? tr("main.search.activeSummary", { filters: parts.join(" · ") }) : null;
  }, [effectiveQuery, parsedSearchCommand.ast.invalidTokens, parsedSearchCommand.ast.labels, tr]);

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

  const searchSuggestions = useMemo(
    () => buildSearchSuggestions(clips, query, baseSearchSuggestions),
    [baseSearchSuggestions, clips, query],
  );

  // autocomplete 下拉的高亮项索引；建议列表变化（输入/过滤）时重置到首项，使 Enter 默认应用第一项。
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
  useEffect(() => {
    setActiveSuggestionIndex(0);
  }, [searchSuggestions]);

  const aggregatePreview = useMemo(() => {
    return selectedInList.map((item) => item.content.trim()).filter(Boolean).join("\n\n");
  }, [selectedInList]);

  const focusSearch = useCallback(() => {
    setSearchActive(true);
    window.setTimeout(() => searchRef.current?.focus(), 0);
  }, []);

  const handleSearchChange = useCallback((value: string) => {
    setQuery(value);
    const token = value.trimStart();
    if (!token.startsWith("@") && !token.startsWith("#")) {
      setActiveTag(null);
      setFilterFavorite(false);
      setActiveTypeFilter("all");
    }
  }, []);

  const closeSearchIfEmpty = useCallback(() => {
    if (!query.trim()) setSearchActive(false);
  }, [query]);

  const clearClipboardFilters = useCallback(() => {
    setQuery("");
    setActiveTag(null);
    setFilterFavorite(false);
    setActiveTypeFilter("all");
  }, []);

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

  function replaceTrailingSearchToken(current: string, nextToken: string) {
    if (!current.trim()) return `${nextToken} `;
    if (!/(^|\s)[@#][^\s]*$/.test(current)) return `${nextToken} `;
    return current.replace(/(^|\s)[@#][^\s]*$/, `$1${nextToken} `);
  }

  function applySearchSuggestion(suggestion: SearchSuggestion) {
    setActiveTag(null);
    setFilterFavorite(false);
    setActiveTypeFilter("all");
    const nextToken =
      suggestion.kind === "all"
        ? ""
        : suggestion.kind === "saved"
          ? `#${suggestion.tag}`
          : getSearchSuggestionToken(suggestion);
    if (suggestion.kind === "all") {
      setQuery("");
    } else {
      setQuery((current) => replaceTrailingSearchToken(current, nextToken));
    }
    setSearchActive(true);
    window.setTimeout(() => searchRef.current?.focus(), 0);
  }

  const removeSearchFilter = (label: string) => {
    setQuery((current) => removeSearchFilterToken(current, label));
    setActiveTag((current) => (current && label.toLowerCase() === `#${current.toLowerCase()}` ? null : current));
    setFilterFavorite((current) => (label === "@favorite" || label === "@收藏" ? false : current));
    setActiveTypeFilter((current) => {
      if (current === "all") return current;
      const currentToken = getSearchSuggestionToken({
        id: current,
        label: current,
        hint: "",
        kind: "type",
        typeFilter: current,
      });
      return label.toLowerCase() === `type:${current}` || label === currentToken ? "all" : current;
    });
    setSearchActive(true);
    window.setTimeout(() => searchRef.current?.focus(), 0);
  };

  const searchByTag = (tag: string) => {
    const normalized = normalizeTagName(tag);
    if (!normalized) return;
    setQuery(`#${normalized} `);
    setActiveTag(null);
    setFilterFavorite(false);
    setActiveTypeFilter("all");
    setSearchActive(true);
    void navigateWorkspaceList();
    window.setTimeout(() => searchRef.current?.focus(), 0);
  };

  const { markClipCopied, captureStandardTextClip, copyText, updateClip, exportSelectedTextFiles, pasteClip, favoriteSelectedClips, copySelectedClips, openClipTarget, openSystemPath, updateClipContent } = useClipWriteback({
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

  const togglePanelPinned = useCallback(() => {
    const nextPinned = !settingsRef.current.panelPinned;
    setSettings((prev) => ({ ...prev, panelPinned: nextPinned }));
    invoke("set_panel_pinned_command", { pinned: nextPinned }).catch((error) =>
      logAppError("warn", "Toggle panel pin failed", String(error)),
    );
  }, []);

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
  });

  async function copyClip(item: ClipItem, pasteMode: PasteMode = "rich") {
    const finishCopyPerf = startPerfSpan("quick.copy", { source: "ui", pasteMode });
    let perfStatus = "ok";
    const optimisticStatus =
      pasteMode === "plain"
        ? tr("main.status.copiedPlain")
        : pasteMode === "filesAsPaths"
          ? tr("main.status.copiedFilePaths")
          : tr("main.status.copiedRich");
    lastSeenClipboard.current = item.content.trim();
    markClipCopied(item, optimisticStatus);
    try {
      const payload = await writeClipboard<ClipItem>({ id: item.id, pasteMode, source: "ui" });
      const normalized = normalizeClip(payload, settingsRef.current);
      if (normalized) {
        setClips((current) => {
          const next = current.map((clip) => (clip.id === normalized.id ? normalized : clip));
          clipsRef.current = next;
          return next;
        });
      }
    } catch {
      perfStatus = "fallback";
      await navigator.clipboard.writeText(item.content);
      setNativeStatus(tr("main.status.copiedBrowser"));
    } finally {
      toast.success("已复制到剪贴板", { description: truncateText(item.plainText || item.content, 42) });
      finishCopyPerf({ status: perfStatus });
    }
  }

  async function pasteText(text: string, source = "unknown", context: Record<string, unknown> = {}) {
    const finishPastePerf = startPerfSpan("quick.paste", { source });
    let perfStatus = "ok";
    const releaseWaitMs = await waitForPasteTriggerRelease(source);
    if (releaseWaitMs > 0) {
      logAppError("info", "paste-text: shortcut release settled", {
        source,
        releaseWaitMs,
        ...context,
      });
    }
    logAppError("info", "paste-text: invoke start", {
      source,
      chars: text.length,
      selectedId,
      ...context,
    });
    try {
      const item = await captureStandardTextClip(text, source, context);
      const payload = await pasteClipboard<ClipItem>({ id: item.id, pasteMode: "rich", source });
      const normalized = normalizeClip(payload, settingsRef.current);
      if (normalized) {
        setClips((current) => {
          const next = current.map((clip) => (clip.id === normalized.id ? normalized : clip));
          clipsRef.current = next;
          return next;
        });
      }
      setIsPanelEntering(false);
      lastSeenClipboard.current = text.trim();
      setNativeStatus(tr("main.status.pastedCode"));
      toast.success(tr("main.toast.pastedCode"));
      logAppError("info", "paste-text: invoke success", {
        source,
        chars: text.length,
        ...context,
      });
    } catch (error) {
      perfStatus = "fallback-copy";
      logAppError("warn", "Paste text failed", { source, error: String(error), ...context });
      await copyText(text, `${source}:fallback-copy`, context);
      setNativeStatus(tr("main.status.pasteCodeFallback"));
    } finally {
      finishPastePerf({ status: perfStatus });
    }
  }


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


  async function deleteClips(ids: string[]) {
    const now = Date.now();
    // 删除后锚定到「被删项当前位置的下一项」；若已是最后一项则锚定上一项；都没有则不锚定。
    // 旧实现一律 setSelectedId(null)，导致 selectedClip 回退到 filteredClips[0] = 第一条。
    const deleteIndex = filteredClips.findIndex((item) => ids.includes(item.id));
    const remaining = filteredClips.filter((item) => !ids.includes(item.id));
    const nextSelectedId =
      deleteIndex >= 0 && remaining.length > 0
        ? (remaining[Math.min(deleteIndex, remaining.length - 1)]?.id ?? null)
        : null;
    const shouldReselect = selectedId != null && ids.includes(selectedId);
    try {
      await invoke("soft_delete_clip_records", { ids });
      setNativeStatus(tr("main.status.movedToTrash", { count: ids.length }));
      toast.success(tr("main.toast.deletedCount", { count: ids.length }));
    } catch (error) {
      logAppError("warn", "Soft delete failed", String(error));
      setNativeStatus(formatNativeError(error));
      return;
    }
    // 软删除后保留在 clips 中以支持垃圾箱视图，仅设置 deletedAt 标记
    setClips((current) =>
      current.map((item) => (ids.includes(item.id) ? { ...item, deletedAt: now } : item)),
    );
    setSelectedIds(new Set());
    setMultiSelectMode(false);
    if (shouldReselect) setSelectedId(nextSelectedId);
  }

  async function restoreClips(ids: string[]) {
    try {
      await invoke("restore_clip_records", { ids });
      setNativeStatus(tr("main.status.restoredCount", { count: ids.length }));
    } catch (error) {
      logAppError("warn", "Restore failed", String(error));
      setNativeStatus(formatNativeError(error));
      return;
    }
    setClips((current) =>
      current.map((item) =>
        ids.includes(item.id) ? { ...item, deletedAt: null, bucket: "history" } : item,
      ),
    );
    setSelectedIds(new Set());
    setMultiSelectMode(false);
  }

  async function hardDeleteClips(ids: string[]) {
    const deleteIndex = filteredClips.findIndex((item) => ids.includes(item.id));
    const remaining = filteredClips.filter((item) => !ids.includes(item.id));
    const nextSelectedId =
      deleteIndex >= 0 && remaining.length > 0
        ? (remaining[Math.min(deleteIndex, remaining.length - 1)]?.id ?? null)
        : null;
    const shouldReselect = selectedId != null && ids.includes(selectedId);
    try {
      await invoke("hard_delete_clip_records", { ids });
      setNativeStatus(tr("main.status.hardDeletedCount", { count: ids.length }));
    } catch (error) {
      logAppError("warn", "Hard delete failed", String(error));
      setNativeStatus(formatNativeError(error));
      return;
    }
    setClips((current) => current.filter((item) => !ids.includes(item.id)));
    setSelectedIds(new Set());
    setMultiSelectMode(false);
    if (shouldReselect) setSelectedId(nextSelectedId);
  }

  async function emptyTrash() {
    const trashIds = clips.filter((item) => item.deletedAt).map((item) => item.id);
    if (!trashIds.length) {
      setNativeStatus(tr("main.status.trashEmpty"));
      return;
    }
    if (!window.confirm(tr("main.confirm.emptyTrash", { count: trashIds.length }))) {
      return;
    }
    await hardDeleteClips(trashIds);
  }

  const showSearchBar = activeSurface === "clipboard" && workspaceRoute.name === "list";
  const shouldRenderSearchBar = showSearchBar && (isSearchActive || Boolean(query));

  const modLabel = getShortcutModLabel();

  return (
    <main
      data-surface="clipboard"
      className={`relative mx-auto grid h-fit max-h-[640px] w-[480px] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-[14px] material panel-shadow panel-in${isPanelClosing ? " pointer-events-none" : ""}`}
      ref={shellRef}
    >
      {workspaceRoute.name !== "detail" && (
        <TopToolbar
          activeView={activeView}
          onDrag={handleWindowDrag}
          onOpenDsh={() => {
            void openDshWindow();
          }}
          onOpenSettings={() => {
            invoke("open_settings_window").catch((error) =>
              logAppError("warn", "Open settings window failed", String(error)),
            );
          }}
          onPanelArrowKey={handlePanelArrowNavigation}
          onViewChange={switchClipboardView}
          searchBar={shouldRenderSearchBar ? (
            <GlassSearchBar
              activeFilterLabels={parsedSearchCommand.ast.labels}
              inputRef={searchRef}
              onApplySuggestion={applySearchSuggestion}
              activeSuggestionIndex={activeSuggestionIndex}
              onSelectSuggestionIndex={setActiveSuggestionIndex}
              onBlur={closeSearchIfEmpty}
              onChange={handleSearchChange}
              onClear={() => {
                setQuery("");
                setActiveTag(null);
                setFilterFavorite(false);
                setActiveTypeFilter("all");
                searchRef.current?.focus();
              }}
              onFocus={focusSearch}
              onRemoveFilter={removeSearchFilter}
              parsedSearchCommand={parsedSearchCommand}
              query={query}
              suggestions={searchSuggestions}
              tr={tr}
            />
          ) : null}
          tr={tr}
        />
      )}

      <section className="min-w-0 overflow-hidden" onScroll={handleScroll}>
        <PanelContentBoundary
          copy={errorBoundaryCopy}
          resetKey={`workspace:${activeView}:${selectedId ?? "none"}:${filteredClips.length}:${selectedInList.length}`}
        >
          <WorkspaceRouterProvider
            fallbackCopy={{
              routeTitle: tr("main.workspace.routeErrorTitle"),
              routeMessage: tr("main.workspace.routeErrorMessage"),
              providerTitle: tr("main.workspace.providerErrorTitle"),
              providerMessage: tr("main.workspace.providerErrorMessage"),
              backToList: tr("main.workspace.backToList"),
              retry: tr("main.workspace.retry"),
            }}
            renderList={() =>
              activeView === "trash" ? (
                <TrashPanel
                  key={`trash:${activeView}`}
                  activeId={selectedClip?.id ?? null}
                  autoScroll={keyboardNavigating}
                  clips={filteredClips}
                  emptySummary={activeSearchSummary}
                  onEmptyTrash={emptyTrash}
                  hasMore={Boolean(nextCursor)}
                  isLoadingMore={isLoadingMore}
                  multiSelectMode={multiSelectMode}
                  onDeleteSelected={() => hardDeleteClips(selectedInList.map((item) => item.id))}
                  onHardDelete={(item) => hardDeleteClips([item.id])}
                  onLoadMore={loadMoreClips}
                  onPointerActive={() => setKeyboardNavigating(false)}
                  onRestore={(item) => restoreClips([item.id])}
                  onRestoreSelected={() => restoreClips(selectedInList.map((item) => item.id))}
                  onSelect={(item) => {
                    setSelectedId(item.id);
                  }}
                  onStartMultiSelect={(id) => {
                    setMultiSelectMode(true);
                    setMultiPreviewOpen(false);
                    setSelectedIds(new Set([id]));
                  }}
                  onToggleSelected={(id) =>
                    setSelectedIds((current) => {
                      const next = new Set(current);
                      if (next.has(id)) next.delete(id);
                      else next.add(id);
                      return next;
                    })
                  }
                  selectedIds={selectedIds}
                  settings={settings}
                  tr={tr}
                />
              ) : (
                <QuickPastePanel
                  key={`quick:${activeView}`}
                  activeId={selectedClip?.id ?? null}
                  autoScroll={keyboardNavigating}
                  clips={filteredClips}
                  copiedId={lastCopiedId}
                  emptySummary={activeSearchSummary}
                  filePathStatuses={filePathStatuses}
                  hasMore={Boolean(nextCursor)}
                  isLoadingMore={isLoadingMore}
                  limit={settings.quickItemLimit}
                  multiSelectMode={multiSelectMode}
                  selectedIds={selectedIds}
                  density={settings.panelDensity}
                  onCreateSnippet={() => toast.info("新建片段功能开发中")}
                  onPaste={pasteClip}
                  onFavorite={(item) => updateClip(item.id, { favorite: !item.favorite })}
                  onFavoriteSelected={() => {
                    void favoriteSelectedClips(selectedInList);
                  }}
                  onLoadMore={loadMoreClips}
                  onOpen={(item) => {
                    void runPrimaryOpenAction(item, "click");
                  }}
                  onOpenAggregate={() => {
                    setMultiPreviewOpen(true);
                    setMultiSelectMode(false);
                    void navigateWorkspaceAggregate();
                  }}
                  onPointerActive={() => setKeyboardNavigating(false)}
                  onCopySelected={() => {
                    void copySelectedClips(selectedInList);
                  }}
                  onCopyMode={(item, mode) => {
                    void copyClip(item, mode);
                  }}
                  onDelete={(item) => {
                    void deleteClips([item.id]);
                  }}
                  onDeleteSelected={() => {
                    void deleteClips(selectedInList.map((item) => item.id));
                  }}
                  onSelect={(item) => {
                    setSelectedId(item.id);
                  }}
                  onStartMultiSelect={(id) => {
                    setMultiSelectMode(true);
                    setMultiPreviewOpen(false);
                    setSelectedIds(new Set([id]));
                  }}
                  onToggleSelected={(id) =>
                    setSelectedIds((current) => {
                      const next = new Set(current);
                      if (next.has(id)) next.delete(id);
                      else next.add(id);
                      return next;
                    })
                  }
                  onClearSelection={() => {
                    setSelectedIds(new Set());
                    setMultiSelectMode(false);
                    setMultiPreviewOpen(false);
                    void navigateWorkspaceList();
                  }}
                  activeGroupStart={activeGroupStart}
                  onActiveGroupChange={handleActiveGroupChange}
                  groupScrollTarget={groupScrollTarget}
                  quickPreviewOpen={quickPreviewOpen}
                  onToggleQuickPreview={() => setQuickPreviewOpen((open) => !open)}
                  tr={tr}
                />
              )
            }
            renderDetail={(clipId) => {
              const clip = clips.find((item) => item.id === clipId) ?? selectedClip;
              const detailItems = filteredClips;
              const detailIndex = clip ? detailItems.findIndex((item) => item.id === clip.id) : -1;
              const previousClip = detailIndex > 0 ? detailItems[detailIndex - 1] : null;
              const nextClip = detailIndex >= 0 && detailIndex < detailItems.length - 1 ? detailItems[detailIndex + 1] : null;
              const navigateDetailClip = (item: ClipItem | null) => {
                if (!item) return;
                setSelectedId(item.id);
                void navigateWorkspaceDetail(item.id);
              };
              return (
                <ClipDetailWorkspace
                  clip={clip}
                  filePathStatuses={filePathStatuses}
                  links={clip ? extractUrls(clip.content) : []}
                  tr={tr}
                  onBack={() => {
                    void navigateWorkspaceList();
                  }}
                  onCopy={copyClip}
                  onCopyPlain={(item) => copyClip(item, "plain")}
                  onCopyText={copyText}
                  onOpen={openClipTarget}
                  onOpenPath={openSystemPath}
                  onPasteText={pasteText}
                  onPrevious={previousClip ? () => navigateDetailClip(previousClip) : undefined}
                  onNext={nextClip ? () => navigateDetailClip(nextClip) : undefined}
                  onSearchTag={searchByTag}
                  onUpdateContent={updateClipContent}
                  onAnalyzeClipboard={analyzeClipboardWithDsh}
                  quickActions={[
                    ...(clip && canOpenClipTarget(clip)
                      ? [
                          {
                            id: "open-target",
                            label: clip.analysis.attachment?.targetType === "path" ? tr("main.detailAction.openResource") : tr("main.detailAction.openLink"),
                            icon: <ExternalLink size={13} />,
                            onSelect: () => {
                              void openClipTarget(clip);
                            },
                          },
                        ]
                      : []),
                    ...(clip
                      ? [
                          {
                            id: "copy",
                            label: tr("main.detailAction.copyContent"),
                            icon: <Copy size={13} />,
                            onSelect: () => {
                              void copyClip(clip);
                            },
                          },
                          {
                            id: "parse",
                            label: tr("main.detailAction.parse"),
                            icon: <FileJson size={13} />,
                            onSelect: () => {
                              setNativeStatus(tr("main.status.parsePluginReserved"));
                            },
                          },
                        ]
                      : []),
                  ]}
                />
              );
            }}
            renderAggregate={() => (
              <MultiAggregateWorkspace
                aggregatePreview={aggregatePreview}
                items={selectedInList}
                tr={tr}
                onBack={() => {
                  setMultiPreviewOpen(false);
                  setMultiSelectMode(selectedInList.length > 0);
                  void navigateWorkspaceList();
                }}
                onCopy={() => {
                  void copySelectedClips(selectedInList).then(() => navigateWorkspaceList());
                }}
                onCopyItem={(clip) => copyClip(clip)}
                onExportTextFiles={() => exportSelectedTextFiles(selectedInList)}
                onExportTable={() => {
                  const table = selectedInList.map((item) => [item.analysis.title, item.content.replace(/\s+/g, " ")]).map((row) => row.join("\t")).join("\n");
                  void navigator.clipboard.writeText(table);
                  setNativeStatus(tr("main.status.exportedTsv"));
                }}
                onOpenItem={(clip) => {
                  setSelectedId(clip.id);
                  void navigateWorkspaceDetail(clip.id);
                }}
              />
            )}
          />
        </PanelContentBoundary>
      </section>

      {workspaceRoute.name === "list" ? (
        multiSelectMode ? (
          <MultiSelectBottomBar
            count={selectedInList.length}
            tr={tr}
            variant={activeView === "trash" ? "trash" : "default"}
          />
        ) : (
          <PanelStatusFeedback
            commandMenu={
              <QuickCommandMenu
                mod={modLabel}
                onCopyMode={(item, mode) => {
                  void copyClip(item, mode);
                }}
                onDelete={(item) => {
                  void deleteClips([item.id]);
                }}
                onFavorite={(item) => updateClip(item.id, { favorite: !item.favorite })}
                onCreateSnippet={() => toast.info("新建片段功能开发中")}
                onTogglePanelPinned={togglePanelPinned}
                selectedItem={selectedClip}
              >
                <button
                  className="mono flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
                  type="button"
                >
                  <span>{filteredClips.length} 条</span>
                  <span>·</span>
                  <span>⌘K 全部操作</span>
                </button>
              </QuickCommandMenu>
            }
            status={nativeStatus}
            tr={tr}
          />
        )
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
