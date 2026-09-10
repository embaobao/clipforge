/** 剪贴板写回域 hook · 首批（从 App.tsx 切出）：已复制标记、条目字段更新、选中项导出文本文件。
 *  边界：完整写回链（copyClip/copyText/pasteClip/updateClipContent 等）仍在主体，后续批次按域迁入。 */
import { invoke } from "@tauri-apps/api/core";
import type { AppSettings, ClipItem } from "../App";
import { isCaptureClipPayload, type CaptureClipPayload } from "./use-clipboard-list";
import { toast } from "sonner";
import type { TranslationKey } from "../i18n";
import { waitForPasteTriggerRelease, logAppError } from "./panel-shared";
import { startPerfSpan } from "../performance-smoke";
import { extractHashTags, normalizeTagList, truncateText } from "./clip-model";
import { pasteClipboard, writeClipboard } from "../services/clipboard";

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
  normalizeClip,
  lastSeenClipboard,
  selectedId,
  setIsPanelEntering,
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

  return { markClipCopied, captureStandardTextClip, copyText, updateClip, exportSelectedTextFiles, pasteClip };

  async function captureStandardTextClip(
    text: string,
    source: string,
    context: Record<string, unknown> = {},
    extraTags: string[] = [],
  ) {
    const payload = await invoke<CaptureClipPayload>("capture_clip_record", {
      content: text,
      sourceLabel: source,
      observedAt: Date.now(),
    });
    if (!isCaptureClipPayload(payload)) throw new Error("Invalid capture_clip_record payload");
    let normalized = normalizeClip(payload.item, settingsRef.current);
    if (!normalized) {
      throw new Error("capture returned an empty item");
    }

    const inferredTags = /(^|[\s:_-])(ai|agent|mcp|assistant)([\s:_-]|$)/i.test(source)
      ? ["AI"]
      : [];
    const nextTags = normalizeTagList([
      ...normalized.tags,
      ...extractHashTags(text),
      ...extraTags,
      ...inferredTags,
    ]);
    const metadata = {
      ...normalized.metadata,
      clipforgeContext: {
        source,
        ...context,
      },
    };
    if (
      nextTags.join("\n").toLowerCase() !== normalized.tags.join("\n").toLowerCase() ||
      Object.keys(context).length > 0
    ) {
      const updated = await invoke<Partial<ClipItem>>("update_clip_record", {
        input: { id: normalized.id, tags: nextTags, metadata },
      });
      normalized = normalizeClip(updated, settingsRef.current) ?? { ...normalized, tags: nextTags, metadata };
    }

    setClips((current) => {
      const existing = current.some((clip) => clip.id === normalized.id);
      const next = existing
        ? current.map((clip) => (clip.id === normalized.id ? normalized : clip))
        : [normalized, ...current].slice(0, settingsRef.current.maxStoredItems);
      clipsRef.current = next;
      return next;
    });
    return normalized;
  }


  async function copyText(text: string, source = "unknown", context: Record<string, unknown> = {}) {
    const finishCopyPerf = startPerfSpan("quick.copy", { source });
    let perfStatus = "ok";
    logAppError("info", "copy-text: invoke start", {
      source,
      chars: text.length,
      selectedId,
      ...context,
    });
    try {
      const item = await captureStandardTextClip(text, source, context);
      const payload = await writeClipboard<ClipItem>({ id: item.id, pasteMode: "rich", source });
      const normalized = normalizeClip(payload, settingsRef.current);
      if (normalized) {
        setClips((current) => {
          const next = current.map((clip) => (clip.id === normalized.id ? normalized : clip));
          clipsRef.current = next;
          return next;
        });
      }
      lastSeenClipboard.current = text.trim();
      setNativeStatus(tr("main.status.copiedCodeSystem"));
      toast.success("已复制到剪贴板", { description: truncateText(text, 42) });
      logAppError("info", "copy-text: invoke success", {
        source,
        chars: text.length,
        ...context,
      });
    } catch (error) {
      perfStatus = "fallback";
      logAppError("warn", "Copy text failed", { source, error: String(error), ...context });
      await navigator.clipboard.writeText(text);
      setNativeStatus(tr("main.status.copiedCodeBrowser"));
      toast.success("已复制到剪贴板", { description: truncateText(text, 42) });
    } finally {
      finishCopyPerf({ status: perfStatus });
    }
  }


  async function pasteClip(item: ClipItem, source = "unknown") {
    const finishPastePerf = startPerfSpan("quick.paste", { source });
    let perfStatus = "ok";
    setIsPanelEntering(false);
    lastSeenClipboard.current = item.content.trim();
    markClipCopied(item, tr("main.status.pastingToApp"));
    const releaseWaitMs = await waitForPasteTriggerRelease(source);
    if (releaseWaitMs > 0) {
      logAppError("info", "paste-ui: shortcut release settled", {
        id: item.id,
        source,
        releaseWaitMs,
      });
    }
    logAppError("info", "paste-ui: invoke start", {
      id: item.id,
      source,
      kind: item.kind,
      chars: item.content.length,
      selectedId,
    });
    try {
      const payload = await pasteClipboard<ClipItem>({ id: item.id, pasteMode: "rich", source });
      const normalized = normalizeClip(payload, settingsRef.current);
      // 粘贴后面板已被 Rust 隐藏（hide_panel_before_paste 不发 hide-quick-panel），
      // 这里显式复位 is-entering，否则下次唤起不会淡入。
      setIsPanelEntering(false);
      if (normalized) {
        setClips((current) => {
          const next = current.map((clip) => (clip.id === normalized.id ? normalized : clip));
          clipsRef.current = next;
          return next;
        });
      }
      setNativeStatus(tr("main.status.pastedToApp"));
      logAppError("info", "paste-ui: invoke success", { id: item.id, source });
    } catch (error) {
      perfStatus = "fallback-copy";
      logAppError("warn", "Paste clip failed", String(error));
      try {
        const payload = await writeClipboard<ClipItem>({
          id: item.id,
          pasteMode: "rich",
          source: `${source}:fallback-copy`,
        });
        const normalized = normalizeClip(payload, settingsRef.current);
        if (normalized) {
          setClips((current) => {
            const next = current.map((clip) => (clip.id === normalized.id ? normalized : clip));
            clipsRef.current = next;
            return next;
          });
        }
      } catch {
        await navigator.clipboard.writeText(item.content);
      }
      setNativeStatus(formatNativeError(error));
    } finally {
      finishPastePerf({ status: perfStatus });
    }
  }



}

