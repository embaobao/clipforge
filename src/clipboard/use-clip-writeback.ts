/** 剪贴板写回域 hook · 首批（从 App.tsx 切出）：已复制标记、条目字段更新、选中项导出文本文件。
 *  边界：完整写回链（copyClip/copyText/pasteClip/updateClipContent 等）仍在主体，后续批次按域迁入。 */
import { invoke } from "@tauri-apps/api/core";
import type { ClipItem } from "../App";
import type { TranslationKey } from "../i18n";
import { logAppError } from "./panel-shared";

type ExportTextFilesPayload = {
  directory: string;
  count: number;
  files: string[];
};

export type ClipWritebackOptions = {
  setClips: React.Dispatch<React.SetStateAction<ClipItem[]>>;
  clipsRef: { current: ClipItem[] };
  settingsRef: { current: { maxStoredItems: number } };
  setLastCopiedId: (id: string | null) => void;
  setNativeStatus: (status: string) => void;
  setSelectedId: (id: string) => void;
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
  formatNativeError: (error: unknown) => string;
};

/** 写回域首批操作：markClipCopied（复制后的乐观标记）、updateClip（字段更新写库+本地同步）、exportSelectedTextFiles。 */
export function useClipWriteback({
  setClips,
  clipsRef,
  settingsRef,
  setLastCopiedId,
  setNativeStatus,
  setSelectedId,
  tr,
  formatNativeError,
}: ClipWritebackOptions) {
  /** 复制成功后的乐观 UI：置最新复制 id、选中、copyCount+1，1.4s 后清除高亮。 */
  function markClipCopied(item: ClipItem, status: string) {
    const now = Date.now();
    setLastCopiedId(item.id);
    setNativeStatus(status);
    setSelectedId(item.id);
    setClips((current) => {
      const base = current.find((clip) => clip.id === item.id) ?? item;
      const updated = {
        ...base,
        copyCount: base.copyCount + 1,
        lastCopiedAt: now,
        updatedAt: now,
      };
      const next = current
        .map((clip) => (clip.id === item.id ? updated : clip))
        .slice(0, settingsRef.current.maxStoredItems);
      clipsRef.current = next;
      return next;
    });
    window.setTimeout(() => setLastCopiedId(null), 1400);
  }

  /** 条目字段更新（bucket/favorite）：写库（失败仅记日志）+ 本地乐观同步。 */
  function updateClip(id: string, next: Partial<ClipItem>) {
    const updatedAt = Date.now();
    invoke("update_clip_record", {
      input: {
        id,
        bucket: next.bucket,
        favorite: typeof next.favorite === "boolean" ? next.favorite : undefined,
      },
    }).catch((error) => logAppError("warn", "Update clip failed", String(error)));
    setClips((current) => {
      const updated = current.map((item) =>
        item.id === id ? { ...item, ...next, updatedAt } : item,
      );
      clipsRef.current = updated;
      return updated;
    });
  }

  /** 把选中条目导出为文本文件（Rust 侧写盘，返回目录与文件清单）。 */
  async function exportSelectedTextFiles(items: ClipItem[]) {
    if (!items.length) {
      setNativeStatus(tr("main.status.selectBeforeExportTextFiles"));
      return;
    }
    try {
      const result = await invoke<ExportTextFilesPayload>("export_clip_text_files", {
        items: items.map((item) => ({
          title: item.analysis.title || item.analysis.sourceName || item.payloadKind,
          content: item.content,
        })),
      });
      setNativeStatus(
        tr("main.status.exportedTextFiles", {
          count: result.count,
          directory: result.directory,
        }),
      );
    } catch (error) {
      logAppError("warn", "Export selected text files failed", String(error));
      setNativeStatus(formatNativeError(error));
    }
  }

  return { markClipCopied, updateClip, exportSelectedTextFiles };
}
