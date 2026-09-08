/** 回收站面板：TrashRow 虚拟列表 + 右键菜单定位与恢复/彻底删除动作。 */
import { useCallback, useState } from "react";
import type { MouseEvent } from "react";
import type { ClipItem } from "../../App";
import type { AppSettings } from "../../App";
import type { TranslationKey } from "../../i18n";
import { ClipboardEmptyState } from "./ClipboardEmptyState";
import { TrashContextMenu } from "./TrashContextMenu";
import { TrashRow } from "./TrashRow";
import { VirtualList } from "./VirtualList";

export type TrashPanelProps = {
  activeId: string | null;
  autoScroll: boolean;
  clips: ClipItem[];
  emptySummary: string | null;
  hasMore: boolean;
  isLoadingMore: boolean;
  multiSelectMode: boolean;
  onEmptyTrash: () => void;
  onDeleteSelected: () => void;
  onHardDelete: (item: ClipItem) => void;
  onLoadMore: () => void;
  onPointerActive: () => void;
  onRestore: (item: ClipItem) => void;
  onRestoreSelected: () => void;
  onSelect: (item: ClipItem) => void;
  onStartMultiSelect: (id: string) => void;
  onToggleSelected: (id: string) => void;
  selectedIds: Set<string>;
  settings: AppSettings;
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
};

export function TrashPanel({
  activeId,
  autoScroll,
  clips,
  emptySummary,
  hasMore,
  isLoadingMore,
  multiSelectMode,
  onEmptyTrash,
  onDeleteSelected,
  onHardDelete,
  onLoadMore,
  onPointerActive,
  onRestore,
  onRestoreSelected,
  onSelect,
  onStartMultiSelect,
  onToggleSelected,
  selectedIds,
  settings,
  tr,
}: TrashPanelProps) {
  const selectedCount = clips.filter((item) => selectedIds.has(item.id)).length;
  const [contextMenu, setContextMenu] = useState<{ item: ClipItem; x: number; y: number } | null>(null);
  const closeContextMenu = useCallback(() => setContextMenu(null), []);
  const openContextMenu = useCallback((event: MouseEvent<HTMLElement>, item: ClipItem) => {
    event.preventDefault();
    event.stopPropagation();
    onSelect(item);
    if (multiSelectMode && !selectedIds.has(item.id)) onToggleSelected(item.id);
    const menuWidth = 204;
    const menuHeight = multiSelectMode ? 188 : 142;
    setContextMenu({
      item,
      x: Math.min(event.clientX, Math.max(8, window.innerWidth - menuWidth - 8)),
      y: Math.min(event.clientY, Math.max(8, window.innerHeight - menuHeight - 8)),
    });
  }, [multiSelectMode, onSelect, onToggleSelected, selectedIds]);

  if (!clips.length) {
    return <ClipboardEmptyState variant="trash" emptySummary={emptySummary} tr={tr} />;
  }
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col" onPointerDown={onPointerActive}>
        <VirtualList
          activeId={activeId}
          autoScroll={autoScroll}
          className="flex-1"
          hasMore={hasMore}
          isLoadingMore={isLoadingMore}
          itemHeight={settings.panelDensity === "comfortable" ? 44 : settings.panelDensity === "dense" ? 34 : 40}
          items={clips}
          onEndReached={onLoadMore}
          onUserScroll={onPointerActive}
          groupSize={10}
          renderItem={(item, index) => (
            <TrashRow
              key={item.id}
              item={item}
              index={index}
              activeId={activeId}
              selectedIds={selectedIds}
              multiSelectMode={multiSelectMode}
              activeGroupStart={0}
              density={settings.panelDensity}
              settings={settings}
              onSelect={onSelect}
              onRestore={onRestore}
              onHardDelete={onHardDelete}
              onToggleSelected={onToggleSelected}
              onStartMultiSelect={onStartMultiSelect}
              onOpenContextMenu={openContextMenu}
              tr={tr}
            />
          )}
        />
        {contextMenu ? (
          <TrashContextMenu
            item={contextMenu.item}
            multiSelectMode={multiSelectMode}
            onClose={closeContextMenu}
            onDeleteSelected={onDeleteSelected}
            onEmptyTrash={onEmptyTrash}
            onHardDelete={onHardDelete}
            onRestore={onRestore}
            onRestoreSelected={onRestoreSelected}
            onStartMultiSelect={onStartMultiSelect}
            selectedCount={selectedCount}
            tr={tr}
            x={contextMenu.x}
            y={contextMenu.y}
          />
        ) : null}
      </div>
    </section>
  );
}
