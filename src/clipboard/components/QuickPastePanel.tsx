/** 快速粘贴主列表面板：ClipboardRow 虚拟列表 + 空格预览卡 + 右键菜单与多选动作。 */
import { useCallback, useState } from "react";
import type { MouseEvent } from "react";
import { toast } from "sonner";
import type { ClipItem, PanelDensity } from "../../App";
import type { PasteMode } from "../../clipboard/clip-model";
import type { FilePathStatus } from "../../services/clipboard";
import type { TranslationKey } from "../../i18n";
import { logAppError } from "../panel-shared";
import { navigateWorkspaceDetail } from "../../routes/workspace-router";
import { ClipContextMenu } from "./ClipContextMenu";
import { ClipboardEmptyState } from "./ClipboardEmptyState";
import { ClipboardRow } from "./ClipboardRow";
import { QuickPreviewCard } from "./QuickPreviewCard";
import { VirtualList } from "./VirtualList";

export type QuickPastePanelProps = {
  activeId: string | null;
  autoScroll: boolean;
  clips: ClipItem[];
  copiedId: string | null;
  emptySummary: string | null;
  filePathStatuses: Record<string, FilePathStatus>;
  hasMore: boolean;
  isLoadingMore: boolean;
  multiSelectMode: boolean;
  onFavorite: (item: ClipItem) => void;
  onFavoriteSelected: () => void;
  onLoadMore: () => void;
  onOpen: (item: ClipItem) => void;
  onOpenAggregate: () => void;
  onPointerActive: () => void;
  onPaste: (item: ClipItem, source?: string) => void;
  onCopySelected: () => void;
  onCopyMode: (item: ClipItem, mode: PasteMode) => void;
  onDelete: (item: ClipItem) => void;
  onDeleteSelected: () => void;
  onSelect: (item: ClipItem) => void;
  onStartMultiSelect: (id: string) => void;
  onToggleSelected: (id: string) => void;
  onClearSelection: () => void;
  selectedIds: Set<string>;
  limit: number;
  activeGroupStart: number;
  onActiveGroupChange: (groupStart: number) => void;
  groupScrollTarget: number | null;
  density?: PanelDensity;
  onCreateSnippet?: () => void;
  quickPreviewOpen: boolean;
  onToggleQuickPreview: () => void;
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
};

export function QuickPastePanel({
  activeId,
  autoScroll,
  clips,
  copiedId,
  emptySummary,
  filePathStatuses,
  hasMore,
  isLoadingMore,
  multiSelectMode,
  onFavorite,
  onFavoriteSelected,
  onLoadMore,
  onOpen,
  onOpenAggregate,
  onPointerActive,
  onPaste,
  onCopySelected,
  onCopyMode,
  onDelete,
  onDeleteSelected,
  onSelect,
  onStartMultiSelect,
  onToggleSelected,
  onClearSelection,
  selectedIds,
  activeGroupStart,
  onActiveGroupChange,
  groupScrollTarget,
  density,
  onCreateSnippet,
  quickPreviewOpen,
  onToggleQuickPreview,
  tr,
}: QuickPastePanelProps) {
  const [contextMenu, setContextMenu] = useState<{ item: ClipItem; x: number; y: number } | null>(null);
  const closeContextMenu = useCallback(() => setContextMenu(null), []);
  const openContextMenu = useCallback((event: MouseEvent<HTMLElement>, item: ClipItem) => {
    event.preventDefault();
    event.stopPropagation();
    onSelect(item);
    if (multiSelectMode && !selectedIds.has(item.id)) onToggleSelected(item.id);
    const menuWidth = 204;
    const menuHeight = multiSelectMode ? 190 : 332;
    setContextMenu({
      item,
      x: Math.min(event.clientX, Math.max(8, window.innerWidth - menuWidth - 8)),
      y: Math.min(event.clientY, Math.max(8, window.innerHeight - menuHeight - 8)),
    });
  }, [multiSelectMode, onSelect, onToggleSelected, selectedIds]);

  if (!clips.length) {
    return (
      <ClipboardEmptyState
        emptySummary={emptySummary}
        onCreateSnippet={onCreateSnippet}
        tr={tr}
        variant="history"
      />
    );
  }

  const selectedItem = clips.find((clip) => clip.id === activeId) ?? clips[0];

  return (
    // h-full 而非 flex-1：父级（App 的 section）是 block 不是 flex，flex-1 不生效会让
    // 列表高度随内容长到 3026px、overflow-auto 永不出现（表现就是「不能滚动」）。
    // h-full 对齐 detail/aggregate 表面的既有写法，沿 grid minmax(0,1fr) 行高向下传递。
    <section className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 flex-col" onPointerDown={onPointerActive}>
        {quickPreviewOpen && selectedItem ? (
          <QuickPreviewCard
            item={selectedItem}
            onClose={onToggleQuickPreview}
            onCopyPlain={(item) => onCopyMode(item, "plain")}
            onFavorite={onFavorite}
            onPaste={onPaste}
          />
        ) : null}
        <VirtualList
          activeId={activeId}
          autoScroll={autoScroll}
          className="flex-1"
          hasMore={hasMore}
          isLoadingMore={isLoadingMore}
          itemHeight={density === "comfortable" ? 44 : density === "dense" ? 34 : 40}
          items={clips}
          onEndReached={onLoadMore}
          groupSize={10}
          onActiveGroupChange={onActiveGroupChange}
          scrollToGroupStart={groupScrollTarget}
          renderItem={(item, index) => (
            <ClipboardRow
              activeGroupStart={activeGroupStart}
              activeId={activeId}
              copiedId={copiedId}
              density={density}
              filePathStatuses={filePathStatuses}
              index={index}
              item={item}
              key={item.id}
              multiSelectMode={multiSelectMode}
              onFavorite={onFavorite}
              onOpen={onOpen}
              onOpenContextMenu={openContextMenu}
              onPaste={onPaste}
              onPin={() => toast.info("固定到顶部功能开发中")}
              onSelect={onSelect}
              onStartMultiSelect={onStartMultiSelect}
              onToggleSelected={onToggleSelected}
              selectedIds={selectedIds}
              tr={tr}
            />
          )}
        />
        {contextMenu ? (
          <ClipContextMenu
            item={contextMenu.item}
            multiSelectMode={multiSelectMode}
            onClose={closeContextMenu}
            onFavorite={onFavorite}
            onFavoriteSelected={onFavoriteSelected}
            onDelete={() => onDelete(contextMenu.item)}
            onDeleteSelected={onDeleteSelected}
            onOpenAggregate={onOpenAggregate}
            onPaste={onPaste}
            onCopyMode={(mode) => onCopyMode(contextMenu.item, mode)}
            onCopySelected={onCopySelected}
            onStartMultiSelect={onStartMultiSelect}
            onClearSelection={onClearSelection}
            onOpenDetail={() => {
              logAppError("info", "context-menu-detail", {
                id: contextMenu.item.id,
                hasUrl: Boolean(contextMenu.item.analysis.url),
                hasAttachment: Boolean(contextMenu.item.analysis.attachment),
              });
              void navigateWorkspaceDetail(contextMenu.item.id);
            }}
            selectedCount={selectedIds.size}
            tr={tr}
            x={contextMenu.x}
            y={contextMenu.y}
          />
        ) : null}
      </div>
    </section>
  );
}
