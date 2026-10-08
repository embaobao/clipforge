/** 快速面板搜索栏：44px 玻璃搜索输入 + 激活过滤标签 + @/# 自动补全浮层（floating-ui portal）。 */
import { Search, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";
import { autoUpdate, flip, FloatingPortal, offset as floatingOffset, shift, useFloating } from "@floating-ui/react";
import type { TranslationKey } from "../../i18n";
import { getSearchSuggestionToken, type ParsedSearchCommand, type SearchSuggestion } from "../../search-query";

export type GlassSearchBarProps = {
  activeFilterLabels: string[];
  inputRef: RefObject<HTMLInputElement | null>;
  onApplySuggestion: (suggestion: SearchSuggestion) => void;
  activeSuggestionIndex: number;
  onBlur: () => void;
  onChange: (value: string) => void;
  onClear: () => void;
  onFocus: () => void;
  onRemoveFilter: (label: string) => void;
  onSelectSuggestionIndex: (index: number) => void;
  parsedSearchCommand: ParsedSearchCommand;
  query: string;
  suggestions: SearchSuggestion[];
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
};

/** 搜索栏（纯展示）：输入、清除、过滤标签移除与补全下拉的容器。 */
export function GlassSearchBar({
  activeFilterLabels,
  inputRef,
  onApplySuggestion,
  activeSuggestionIndex,
  onBlur,
  onChange,
  onClear,
  onFocus,
  onRemoveFilter,
  onSelectSuggestionIndex,
  parsedSearchCommand,
  query,
  suggestions,
  tr,
}: GlassSearchBarProps) {
  return (
    <div className="flex w-full min-w-0 flex-col">
      <div className="flex h-11 min-w-0 items-center gap-3 px-3">
        <Search size={15} className="flex-shrink-0 text-muted-foreground" />
        <input
          aria-label={tr("main.search.aria")}
          autoComplete="off"
          className="h-full w-full min-w-0 bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
          onBlur={onBlur}
          onChange={(event) => onChange(event.currentTarget.value)}
          onFocus={onFocus}
          placeholder={tr("main.search.placeholder")}
          ref={inputRef}
          spellCheck={false}
          value={query}
        />
        {query ? (
          <button
            aria-label={tr("main.search.clear")}
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-black/5 active:scale-90 dark:hover:bg-white/[0.07]"
            onClick={onClear}
            type="button"
          >
            <X size={14} />
          </button>
        ) : null}
      </div>
      {activeFilterLabels.length ? (
        <div className="flex flex-wrap gap-1.5 px-3 pb-2" aria-label={tr("main.search.activeFilters")}>
          {activeFilterLabels.map((label) => (
            <button
              aria-label={tr("main.search.removeFilter", { label })}
              className="inline-flex items-center gap-1 rounded-md border border-black/10 bg-black/[0.03] px-1.5 py-0.5 text-[11px] text-foreground transition-colors hover:bg-black/5 dark:border-white/[0.12] dark:bg-white/[0.05]"
              key={label}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onRemoveFilter(label)}
              type="button"
            >
              <span>{label}</span>
              <X size={11} />
            </button>
          ))}
        </div>
      ) : null}
      {suggestions.length ? (
        <SearchAutocomplete
          activeIndex={activeSuggestionIndex}
          inputRef={inputRef}
          onApplySuggestion={onApplySuggestion}
          onSelectIndex={onSelectSuggestionIndex}
          parsedSearchCommand={parsedSearchCommand}
          suggestions={suggestions}
          tr={tr}
        />
      ) : null}
    </div>
  );
}

type SearchAutocompleteProps = {
  activeIndex: number;
  inputRef: RefObject<HTMLInputElement | null>;
  onApplySuggestion: (suggestion: SearchSuggestion) => void;
  onSelectIndex: (index: number) => void;
  parsedSearchCommand: ParsedSearchCommand;
  suggestions: SearchSuggestion[];
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
};

// reui 式 autocomplete 下拉：以 @ / # 触发，floating-ui 把浮层 portal 到 body 层，
// 绕开搜索栏祖先的 overflow/层叠，保证下拉一定可见；↑/↓/Enter 由外层 keydown 驱动 activeIndex。
function SearchAutocomplete({
  activeIndex,
  inputRef,
  onApplySuggestion,
  onSelectIndex,
  parsedSearchCommand,
  suggestions,
  tr,
}: SearchAutocompleteProps) {
  const { refs, x, y, strategy } = useFloating({
    open: suggestions.length > 0,
    placement: "bottom-start",
    whileElementsMounted: autoUpdate,
    middleware: [floatingOffset(6), flip({ padding: 8 }), shift({ padding: 8 })],
  });
  const listRef = useRef<HTMLDivElement | null>(null);

  // 把浮层锚定到搜索输入框（输入框由外层 inputRef 持有，挂载后绑定）。
  useLayoutEffect(() => {
    if (inputRef.current) refs.setReference(inputRef.current);
  }, [inputRef, refs]);

  // 键盘移动高亮时，把当前项滚进下拉视口。
  useEffect(() => {
    const root = listRef.current;
    if (!root) return;
    const el = root.querySelector<HTMLElement>(`[data-idx="${activeIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, suggestions]);

  const ready = x != null && y != null;

  return (
    <FloatingPortal>
      <div
        ref={refs.setFloating}
        className="z-[60]"
        role="listbox"
        aria-label={tr("main.search.suggestions")}
        style={{
          position: strategy,
          top: 0,
          left: 0,
          visibility: ready ? "visible" : "hidden",
          transform: `translate3d(${x ?? 0}px, ${y ?? 0}px, 0)`,
        }}
      >
        {/* 入场动画挂内层包装节点：外层内联 transform 承载 floating-ui 定位，动画覆盖会闪到左上角。
            退出不做动画，高频输入直接卸载（proposal 已记录偏差）。 */}
        <div className="animate-in fade-in-0 slide-in-from-top-1 duration-fast ease-enter w-56 rounded-xl border border-black/5 bg-popover p-1 shadow-lg dark:border-white/[0.07]">
          <div className="max-h-60 overflow-auto py-0.5" ref={listRef}>
          {suggestions.map((suggestion, index) => {
            const token = getSearchSuggestionToken(suggestion);
            const isActive =
              (suggestion.kind === "favorite" && parsedSearchCommand.filterFavorite) ||
              (suggestion.kind === "type" && parsedSearchCommand.typeFilter === suggestion.typeFilter) ||
              (suggestion.kind === "saved" && parsedSearchCommand.tag === suggestion.tag);
            return (
              <button
                className={`flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] outline-none transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring${index === activeIndex ? " bg-black/[0.045] dark:bg-white/[0.07]" : ""}${isActive ? " text-foreground" : " text-muted-foreground"}`}
                data-idx={index}
                key={suggestion.id}
                onMouseDown={(event) => event.preventDefault()}
                onMouseMove={() => onSelectIndex(index)}
                onClick={() => onApplySuggestion(suggestion)}
                role="option"
                aria-selected={index === activeIndex}
                type="button"
              >
                <span className="mono flex-shrink-0 rounded bg-black/[0.04] px-1 py-0.5 text-[11px] dark:bg-white/[0.07]">
                  {token}
                </span>
                <span className="min-w-0 flex-1 truncate text-foreground">{suggestion.label}</span>
                <span className="flex-shrink-0 text-[11px] opacity-60">{suggestion.hint}</span>
              </button>
            );
          })}
          </div>
        </div>
      </div>
    </FloatingPortal>
  );
}
