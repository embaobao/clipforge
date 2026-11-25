// 搜索域状态与 handler（frontend-surface-architecture-refactor S5 从 App.tsx 迁出）。
// 约束：setter 必须原样返回——showQuickPanel/usePanelKeyboard 直接用它们重置/驱动搜索态。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppSettings } from "../App";
import type { TranslationKey } from "../i18n";
import type { ClipItem, ClipTypeFilter } from "./clip-model";
import {
  buildBaseSearchSuggestions,
  buildSearchSuggestions,
  getKeywordSource,
  removeSearchFilterToken,
} from "./clip-search";
import { buildKeywordIndex, type KeywordIndex } from "./keyword-suggestions";
import { isTauriRuntime, useDebouncedValue } from "./panel-shared";
import {
  getSearchSuggestionToken,
  normalizeTagName,
  type SearchSuggestion,
} from "../search-query";
import { normalizeTagList } from "./clip-model";
import { parseSearchCommand } from "../search-query";

function replaceTrailingSearchToken(current: string, nextToken: string) {
  if (!current.trim()) return `${nextToken} `;
  if (!/(^|\s)[@#][^\s]*$/.test(current)) return `${nextToken} `;
  return current.replace(/(^|\s)[@#][^\s]*$/, `$1${nextToken} `);
}

export function usePanelSearch(options: {
  clips: ClipItem[];
  settings: AppSettings;
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
  navigateWorkspaceList: () => Promise<void> | void;
}) {
  const { clips, settings, tr, navigateWorkspaceList } = options;
  const [query, setQuery] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [activeTypeFilter, setActiveTypeFilter] = useState<ClipTypeFilter>("all");
  const [filterFavorite, setFilterFavorite] = useState(false);
  const [isSearchActive, setSearchActive] = useState(() => !isTauriRuntime());
  const searchRef = useRef<HTMLInputElement | null>(null);
  const debouncedQuery = useDebouncedValue(query, 120);

  const baseSearchSuggestions = useMemo(
    () => buildBaseSearchSuggestions(clips, settings, tr),
    [clips, settings.tagRules, tr],
  );

  const parsedSearchCommand = useMemo(
    () => parseSearchCommand(debouncedQuery, baseSearchSuggestions),
    [baseSearchSuggestions, debouncedQuery],
  );

  const effectiveQuery = parsedSearchCommand.handled ? parsedSearchCommand.queryText : debouncedQuery;
  // 必须稳定引用：filteredClips 的 memo 依赖它们,裸新建数组会让每次重渲都重算过滤。
  const effectiveTypeFilters = useMemo(
    () => (activeTypeFilter !== "all" ? [activeTypeFilter] : parsedSearchCommand.ast.types),
    [activeTypeFilter, parsedSearchCommand.ast],
  );
  const effectiveFilterFavorite = filterFavorite || parsedSearchCommand.filterFavorite;
  const effectiveActiveTags = useMemo(
    () => normalizeTagList([...(activeTag ? [activeTag] : []), ...parsedSearchCommand.ast.tags]),
    [activeTag, parsedSearchCommand.ast],
  );

  const activeSearchSummary = useMemo(() => {
    const parts = [
      ...parsedSearchCommand.ast.labels,
      ...parsedSearchCommand.ast.invalidTokens,
      effectiveQuery.trim() ? `text:${effectiveQuery.trim()}` : "",
    ].filter(Boolean);
    return parts.length ? tr("main.search.activeSummary", { filters: parts.join(" · ") }) : null;
  }, [effectiveQuery, parsedSearchCommand.ast.invalidTokens, parsedSearchCommand.ast.labels, tr]);

  // 关键词索引按历史惰性构建：没人输入普通文字就不建；历史列表换了，下次用到时重建。
  const keywordIndexFor = useMemo(() => {
    let index: KeywordIndex | null = null;
    return () => (index ??= buildKeywordIndex(clips.filter((clip) => !clip.deletedAt).map(getKeywordSource)));
  }, [clips]);
  const searchSuggestions = useMemo(
    () =>
      buildSearchSuggestions(clips, query, baseSearchSuggestions, {
        keywordIndex: keywordIndexFor,
        pinyinEnabled: settings.pinyinSearchEnabled,
      }),
    [baseSearchSuggestions, clips, keywordIndexFor, query, settings.pinyinSearchEnabled],
  );

  // autocomplete 下拉的高亮项索引；建议列表变化（输入/过滤）时重置到首项，使 Enter 默认应用第一项。
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
  useEffect(() => {
    setActiveSuggestionIndex(0);
  }, [searchSuggestions]);

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

  const applySearchSuggestion = useCallback(
    (suggestion: SearchSuggestion) => {
      // 关键词联想只把输入末尾那一段补成完整的词（与 @/# 候选同一口径），前面的词和过滤条件都保留。
      if (suggestion.kind === "keyword") {
        setQuery(query.replace(/\S+\s*$/, `${suggestion.label} `));
        setSearchActive(true);
        window.setTimeout(() => searchRef.current?.focus(), 0);
        return;
      }
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
    },
    [query],
  );

  const removeSearchFilter = useCallback((label: string) => {
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
  }, []);

  const searchByTag = useCallback(
    (tag: string) => {
      const normalized = normalizeTagName(tag);
      if (!normalized) return;
      setQuery(`#${normalized} `);
      setActiveTag(null);
      setFilterFavorite(false);
      setActiveTypeFilter("all");
      setSearchActive(true);
      void navigateWorkspaceList();
      window.setTimeout(() => searchRef.current?.focus(), 0);
    },
    [navigateWorkspaceList],
  );

  return {
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
    focusSearch,
    handleSearchChange,
    closeSearchIfEmpty,
    clearClipboardFilters,
    applySearchSuggestion,
    removeSearchFilter,
    searchByTag,
  };
}
