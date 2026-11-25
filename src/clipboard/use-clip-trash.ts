// 垃圾箱/删除域（S5 从 App.tsx 迁出）：软删、恢复、硬删、清空垃圾箱。
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import type { TranslationKey } from "../i18n";
import type { ClipItem } from "./clip-model";
import { invalidateViewClipCache } from "./use-clip-cache-invalidation";
import { logAppError } from "./panel-shared";

export function useClipTrash(options: {
  clips: ClipItem[];
  filteredClips: ClipItem[];
  selectedId: string | null;
  clipsRef: { current: ClipItem[] };
  setClips: React.Dispatch<React.SetStateAction<ClipItem[]>>;
  setSelectedId: React.Dispatch<React.SetStateAction<string | null>>;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  setMultiSelectMode: React.Dispatch<React.SetStateAction<boolean>>;
  setNativeStatus: (status: string) => void;
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
  formatNativeError: (error: unknown) => string;
}) {
  const {
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
  } = options;

  async function deleteClips(ids: string[]) {
    const now = Date.now();
    // 删除后锚定到「被删项当前位置的下一项」；若已是最后一项则锚定上一项；都没有则不锚定。
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
    // 软删除后保留在 clips 中以支持垃圾箱视图，仅设置 deletedAt 标记；
    // 快照里没有这层标记(拍摄于删除前),不清缓存会在切回时复活已删条目。
    invalidateViewClipCache();
    setClips((current) => {
      const next = current.map((item) => (ids.includes(item.id) ? { ...item, deletedAt: now } : item));
      clipsRef.current = next;
      return next;
    });
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
    invalidateViewClipCache();
    setClips((current) => {
      const next = current.map((item) =>
        ids.includes(item.id) ? { ...item, deletedAt: null, bucket: "history" as const } : item,
      );
      clipsRef.current = next;
      return next;
    });
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
    invalidateViewClipCache();
    setClips((current) => {
      const next = current.filter((item) => !ids.includes(item.id));
      clipsRef.current = next;
      return next;
    });
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

  return { deleteClips, restoreClips, hardDeleteClips, emptyTrash };
}
