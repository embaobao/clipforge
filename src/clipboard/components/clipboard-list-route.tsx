// 列表路由渲染体（S5 从 App.tsx 迁出）：垃圾箱视图 vs 快速粘贴面板。
// 不携带 data-surface marker——marker 只允许 App.tsx 主面板一根。
import { toast } from "sonner";
import type { TranslationKey } from "../../i18n";
import type { AppSettings } from "../../App";
import type { ClipItem, ViewKey } from "../clip-model";
import { QuickPastePanel } from "./QuickPastePanel";
import { TrashPanel } from "./TrashPanel";
import type { FilePathStatus } from "../../services/clipboard";
import type { PasteMode } from "../clip-model";
export type PanelWritebackHandlers = {
  pasteClip: (item: ClipItem, source?: string) => Promise<void>;
  favoriteSelectedClips: (items: ClipItem[]) => Promise<unknown>;
  copySelectedClips: (items: ClipItem[]) => Promise<void>;
  copyClip: (item: ClipItem, pasteMode?: PasteMode) => Promise<void>;
  ocrExtractAndCopy: (item: ClipItem) => unknown;
};

type Writeback = PanelWritebackHandlers;

export function ClipboardListRoute(options: {
  activeView: ViewKey;
  selectedClip: ClipItem | null;
  keyboardNavigating: boolean;
  filteredClips: ClipItem[];
  selectedInList: ClipItem[];
  activeSearchSummary: string | null;
  nextCursor: string | null;
  isLoadingMore: boolean;
  multiSelectMode: boolean;
  selectedIds: Set<string>;
  settings: AppSettings;
  lastCopiedId: string | null;
  filePathStatuses: Record<string, FilePathStatus>;
  restoreScroll: { top: number; token: string } | null;
  activeGroupStart: number;
  groupScrollTarget: number | null;
  quickPreviewOpen: boolean;
  writeback: Writeback;
  emptyTrash: () => Promise<void>;
  hardDeleteClips: (ids: string[]) => Promise<void>;
  restoreClips: (ids: string[]) => Promise<void>;
  onActiveGroupChange: (groupStart: number) => void;
  deleteClips: (ids: string[]) => Promise<void>;
  loadMoreClips: () => void;
  onListScrollTop: (top: number) => void;
  onRunPrimaryOpenAction: (item: ClipItem, source: "shortcut" | "keyboard" | "click" | "context-menu" | "detail") => void;
  onRowFavorite: (item: ClipItem) => void;
  onRowSelect: (item: ClipItem) => void;
  onRowStartMultiSelect: (id: string) => void;
  onRowToggleSelected: (id: string) => void;
  navigateWorkspaceList: () => Promise<void>;
  navigateWorkspaceAggregate: () => Promise<void>;
  setSelectedId: (id: string) => void;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  setMultiSelectMode: React.Dispatch<React.SetStateAction<boolean>>;
  setMultiPreviewOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setKeyboardNavigating: React.Dispatch<React.SetStateAction<boolean>>;
  setQuickPreviewOpen: React.Dispatch<React.SetStateAction<boolean>>;
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
}) {
  const o = options;
  if (o.activeView === "trash") {
    return (
      <TrashPanel
        key={`trash:${o.activeView}`}
        activeId={o.selectedClip?.id ?? null}
        autoScroll={o.keyboardNavigating}
        clips={o.filteredClips}
        emptySummary={o.activeSearchSummary}
        onEmptyTrash={o.emptyTrash}
        hasMore={Boolean(o.nextCursor)}
        isLoadingMore={o.isLoadingMore}
        multiSelectMode={o.multiSelectMode}
        onDeleteSelected={() => o.hardDeleteClips(o.selectedInList.map((item) => item.id))}
        onHardDelete={(item) => o.hardDeleteClips([item.id])}
        onLoadMore={o.loadMoreClips}
        onScrollTopChange={o.onListScrollTop}
        onPointerActive={() => o.setKeyboardNavigating(false)}
        onRestore={(item) => o.restoreClips([item.id])}
        onRestoreSelected={() => o.restoreClips(o.selectedInList.map((item) => item.id))}
        restoreScroll={o.restoreScroll}
        onSelect={(item) => {
          o.setSelectedId(item.id);
        }}
        onStartMultiSelect={(id) => {
          o.setMultiSelectMode(true);
          o.setMultiPreviewOpen(false);
          o.setSelectedIds(new Set([id]));
        }}
        onToggleSelected={(id) =>
          o.setSelectedIds((current) => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          })
        }
        selectedIds={o.selectedIds}
        settings={o.settings}
        tr={o.tr}
      />
    );
  }
  return (
    <QuickPastePanel
      activeId={o.selectedClip?.id ?? null}
      autoScroll={o.keyboardNavigating}
      clips={o.filteredClips}
      copiedId={o.lastCopiedId}
      emptySummary={o.activeSearchSummary}
      filePathStatuses={o.filePathStatuses}
      hasMore={Boolean(o.nextCursor)}
      isLoadingMore={o.isLoadingMore}
      limit={o.settings.quickItemLimit}
      multiSelectMode={o.multiSelectMode}
      selectedIds={o.selectedIds}
      density={o.settings.panelDensity}
      onCreateSnippet={() => toast.info("新建片段功能开发中")}
      onPaste={o.writeback.pasteClip}
      onFavorite={o.onRowFavorite}
      onFavoriteSelected={() => {
        void o.writeback.favoriteSelectedClips(o.selectedInList);
      }}
      onLoadMore={o.loadMoreClips}
      onScrollTopChange={o.onListScrollTop}
      restoreScroll={o.restoreScroll}
      onOpen={(item) => {
        void o.onRunPrimaryOpenAction(item, "click");
      }}
      onOpenAggregate={() => {
        o.setMultiPreviewOpen(true);
        o.setMultiSelectMode(false);
        void o.navigateWorkspaceAggregate();
      }}
      onPointerActive={() => o.setKeyboardNavigating(false)}
      onCopySelected={() => {
        void o.writeback.copySelectedClips(o.selectedInList);
      }}
      onCopyMode={(item, mode) => {
        void o.writeback.copyClip(item, mode);
      }}
      onOcrExtract={(item) => {
        void o.writeback.ocrExtractAndCopy(item);
      }}
      onDelete={(item) => {
        void o.deleteClips([item.id]);
      }}
      onDeleteSelected={() => {
        void o.deleteClips(o.selectedInList.map((item) => item.id));
      }}
      onSelect={o.onRowSelect}
      onStartMultiSelect={o.onRowStartMultiSelect}
      onToggleSelected={o.onRowToggleSelected}
      onClearSelection={() => {
        o.setSelectedIds(new Set());
        o.setMultiSelectMode(false);
        o.setMultiPreviewOpen(false);
        void o.navigateWorkspaceList();
      }}
      activeGroupStart={o.activeGroupStart}
      onActiveGroupChange={o.onActiveGroupChange}
      groupScrollTarget={o.groupScrollTarget}
      quickPreviewOpen={o.quickPreviewOpen}
      onToggleQuickPreview={() => o.setQuickPreviewOpen((open) => !open)}
      tr={o.tr}
    />
  );
}
