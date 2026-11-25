/** 剪贴板写回域 facade（S4 拆分后）：复制/粘贴动作在 use-clip-copy-paste.ts（B），
 *  本文件保留 updateClip/updateClipContent、导出/收藏/打开目标等写回操作，
 *  并以 useClipWriteback 对外维持原 API 面（App.tsx 不感知拆分）。
 *  依赖方向：A → B 单向，B 禁止 import 本文件。 */
import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AppSettings, ClipItem } from "../App";
import { toast } from "sonner";
import type { TranslationKey } from "../i18n";
import { logAppError } from "./panel-shared";
import { normalizeTagList } from "./clip-model";
import { ocrExtractAndCopy as ocrExtract } from "./use-ocr-extract";
import { invalidateViewClipCache } from "./use-clip-cache-invalidation";
import { useClipCopyPaste } from "./use-clip-copy-paste";

type ExportTextFilesPayload = {
  directory: string;
  count: number;
  files: string[];
};

export type ClipWritebackOptions = {
  setClips: React.Dispatch<React.SetStateAction<ClipItem[]>>;
  clipsRef: { current: ClipItem[] };
  settingsRef: { current: AppSettings };
  setLastCopiedId: (id: string | null) => void;
  setNativeStatus: (status: string) => void;
  setSelectedId: (id: string) => void;
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
  formatNativeError: (error: unknown) => string;
  normalizeClip: (raw: Partial<ClipItem>, settings: AppSettings) => ClipItem | null;
  lastSeenClipboard: { current: string };
  selectedId: string | null;
  setIsPanelEntering: (v: boolean) => void;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  setMultiSelectMode: (v: boolean) => void;
  setMultiPreviewOpen: (v: boolean) => void;
  openPath: (path: string) => Promise<void>;
  openUrl: (url: string) => Promise<void>;
};

/** 写回域 facade：组合 B 的复制/粘贴动作与本文件的字段更新/导出/收藏/打开操作。 */
export function useClipWriteback({
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
}: ClipWritebackOptions) {
  const {
    markClipCopied,
    captureStandardTextClip,
    copyClip,
    copyText,
    pasteClip,
    pasteText,
    copySelectedClips,
    aggregateFormat,
    setAggregateFormat,
    applyNormalizedToClips,
  } = useClipCopyPaste({
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
  });

  /** 条目字段更新（bucket/favorite/tags，tags 供 AI 建议标签应用）：写库（失败仅记日志）
   *  + 本地乐观同步（setClips 按 id map，不重排列表）。useCallback：依赖全为 setter/ref
   *  （调用方 ClipboardRow memo 依赖此引用稳定）。 */
  const updateClip = useCallback(function updateClip(id: string, next: Partial<ClipItem>) {
    const updatedAt = Date.now();
    invoke("update_clip_record", {
      input: {
        id,
        bucket: next.bucket,
        favorite: typeof next.favorite === "boolean" ? next.favorite : undefined,
        metadata: next.metadata,
      },
    }).catch((error) => logAppError("warn", "Update clip failed", String(error)));
    invalidateViewClipCache();
    setClips((current) => {
      const updated = current.map((item) =>
        item.id === id ? { ...item, ...next, updatedAt } : item,
      );
      clipsRef.current = updated;
      return updated;
    });
  }, [setClips, clipsRef, settingsRef]);

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

  async function favoriteSelectedClips(items: ClipItem[]) {
    if (!items.length) return;
    const targetFavorite = !items.every((item) => item.favorite);
    await Promise.all(
      items.map((item) =>
        invoke("update_clip_record", { input: { id: item.id, favorite: targetFavorite } }),
      ),
    ).catch((error) => logAppError("warn", "Batch favorite failed", String(error)));
    const ids = new Set(items.map((item) => item.id));
    invalidateViewClipCache();
    setClips((current) => {
      const next = current.map((clip) => (ids.has(clip.id) ? { ...clip, favorite: targetFavorite } : clip));
      clipsRef.current = next;
      return next;
    });
    toast.success(
      targetFavorite
        ? tr("main.toast.favoritedCount", { count: items.length })
        : tr("main.toast.unfavoritedCount", { count: items.length }),
    );
  }

  async function openClipTarget(item: ClipItem, targetUrlOverride?: string) {
    const attachment = item.analysis.attachment;
    if (!targetUrlOverride && attachment?.targetType === "path") {
      try {
        await openPath(attachment.target.replace(/^file:\/\//, ""));
        setNativeStatus(tr("main.status.openedTarget", { target: attachment.name }));
      } catch (error) {
        logAppError("warn", "Open path failed", { target: attachment.target, error: String(error) });
        setNativeStatus(tr("main.status.openPathFailed"));
      }
      return;
    }
    const targetUrl = targetUrlOverride ?? (attachment?.targetType === "url" ? attachment.target : item.analysis.url);
    if (!targetUrl) return;
    try {
      await openUrl(targetUrl);
      setNativeStatus(tr("main.status.openedTarget", { target: item.analysis.sourceName }));
    } catch (error) {
      logAppError("warn", "Open URL failed", { target: targetUrl, error: String(error) });
      window.open(targetUrl, "_blank", "noopener,noreferrer");
      setNativeStatus(tr("main.status.openedInBrowser"));
    }
  }

  async function openSystemPath(path: string) {
    if (!path) return;
    try {
      await openPath(path.replace(/^file:\/\//, ""));
      setNativeStatus(tr("main.status.openedTarget", { target: path.split(/[\\/]/).filter(Boolean).at(-1) ?? path }));
    } catch (error) {
      logAppError("warn", "Open detail file path failed", { target: path, error: String(error) });
      setNativeStatus(tr("main.status.openPathFailed"));
    }
  }

  async function updateClipContent(
    item: ClipItem,
    content: string,
    tags?: string[],
    context?: { sessionId: string; draftVersion: number; tagsProvenance?: Record<string, unknown> },
  ) {
    const payload = await invoke<Partial<ClipItem>>("save_editor_draft", {
      input: {
        id: item.id,
        sessionId: context?.sessionId ?? `editor_${item.id}`,
        draftVersion: context?.draftVersion ?? 1,
        content,
        tags: tags ? normalizeTagList(tags) : normalizeTagList(item.tags),
        metadata: {
          source: "detail-compact-editor",
          payloadKind: item.payloadKind,
          // 详情页提案 §5.2：tags_provenance 平铺进 clips.metadata（Rust 侧平铺合并）。
          ...(context?.tagsProvenance ? { tags_provenance: context.tagsProvenance } : {}),
        },
      },
    });
    const normalized = applyNormalizedToClips(payload);
    if (!normalized) throw new Error(tr("main.error.emptySavedClip"));
    setSelectedId(normalized.id);
    setNativeStatus(tr("main.status.detailSaved"));
    logAppError("info", "clip-detail-edit: saved", {
      id: normalized.id,
      payloadKind: normalized.payloadKind,
      chars: normalized.content.length,
      tags: normalized.tags,
      sessionId: context?.sessionId,
      draftVersion: context?.draftVersion,
    });
    return normalized;
  }

  return {
    markClipCopied,
    captureStandardTextClip,
    copyClip,
    ocrExtractAndCopy: (item: ClipItem) => ocrExtract(item, { captureStandardTextClip, setNativeStatus, tr }), // 实现在 use-ocr-extract.ts(门禁拆分), 此处仅绑定依赖
    copyText,
    pasteClip,
    pasteText,
    updateClip,
    exportSelectedTextFiles,
    favoriteSelectedClips,
    copySelectedClips,
    openClipTarget,
    openSystemPath,
    updateClipContent,
    aggregateFormat, setAggregateFormat, // 聚合格式（TASK-6-A）：state 驱动菜单，ref 供异步复制链路读最新值
  };
}
