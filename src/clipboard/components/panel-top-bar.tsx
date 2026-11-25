// 主面板顶栏（S5 从 App.tsx 迁出）：TopToolbar + 搜索条槽位。
// 不携带 data-surface marker——marker 只允许 App.tsx 主面板一根。
import type { RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { TranslationKey } from "../../i18n";
import type { ClipTypeFilter, PanelArrowKey, ViewKey } from "../clip-model";
import type { ParsedSearchCommand, SearchSuggestion } from "../../search-query";
import { logAppError, createWindowDragHandler } from "../panel-shared";
import { GlassSearchBar } from "./GlassSearchBar";
import { TopToolbar } from "./TopToolbar";
type SearchProps = {
  query: string;
  setQuery: (value: string) => void;
  activeTag: string | null;
  setActiveTag: (value: string | null) => void;
  activeTypeFilter: ClipTypeFilter;
  setActiveTypeFilter: (value: ClipTypeFilter) => void;
  filterFavorite: boolean;
  setFilterFavorite: (value: boolean) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  parsedSearchCommand: ParsedSearchCommand;
  searchSuggestions: SearchSuggestion[];
  activeSuggestionIndex: number;
  setActiveSuggestionIndex: (index: number) => void;
  applySearchSuggestion: (suggestion: SearchSuggestion) => void;
  closeSearchIfEmpty: () => void;
  handleSearchChange: (value: string) => void;
  focusSearch: () => void;
  removeSearchFilter: (label: string) => void;
};

export function PanelTopBar(options: {
  activeView: ViewKey;
  showSearchBar: boolean;
  search: SearchProps;
  onPanelArrowKey: (key: PanelArrowKey, repeat?: boolean) => void;
  onViewChange: (view: ViewKey) => void;
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
}) {
  const { activeView, showSearchBar, search, onPanelArrowKey, onViewChange, tr } = options;
  const handleWindowDrag = createWindowDragHandler();
  const { setQuery, setActiveTag, setFilterFavorite, setActiveTypeFilter, searchRef } = search;
  return (
    <TopToolbar
      activeView={activeView}
      onDrag={handleWindowDrag}
      onOpenSettings={() => {
        invoke("open_settings_window").catch((error) =>
          logAppError("warn", "Open settings window failed", String(error)),
        );
      }}
      onPanelArrowKey={onPanelArrowKey}
      onViewChange={onViewChange}
      searchBar={showSearchBar ? (
        <GlassSearchBar
          activeFilterLabels={search.parsedSearchCommand.ast.labels}
          inputRef={search.searchRef}
          onApplySuggestion={search.applySearchSuggestion}
          activeSuggestionIndex={search.activeSuggestionIndex}
          onSelectSuggestionIndex={search.setActiveSuggestionIndex}
          onBlur={search.closeSearchIfEmpty}
          onChange={search.handleSearchChange}
          onClear={() => {
            setQuery("");
            setActiveTag(null);
            setFilterFavorite(false);
            setActiveTypeFilter("all");
            searchRef.current?.focus();
          }}
          onFocus={search.focusSearch}
          onRemoveFilter={search.removeSearchFilter}
          parsedSearchCommand={search.parsedSearchCommand}
          query={search.query}
          suggestions={search.searchSuggestions}
          tr={tr}
        />
      ) : null}
      tr={tr}
    />
  );
}
