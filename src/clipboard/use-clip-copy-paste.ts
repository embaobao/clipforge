/** 复制/粘贴域 hook（从 use-clip-writeback.ts 拆出，500 行门禁）：
 *  pasteText/copyClip/copyText/pasteClip/captureStandardTextClip、聚合复制 copySelectedClips，
 *  以及共用回写辅助 applyNormalizedToClips/markClipCopied。
 *  边界：单向被 use-clip-writeback.ts（facade）依赖，禁止反向 import。 */
import { useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AppSettings, ClipItem } from "../App";
import { isCaptureClipPayload, type CaptureClipPayload } from "./use-clipboard-list";
import { toast } from "sonner";
import type { TranslationKey } from "../i18n";
import { waitForPasteTriggerRelease, logAppError } from "./panel-shared";
import { startPerfSpan } from "../performance-smoke";
import { extractHashTags, normalizeTagList, truncateText } from "./clip-model";
import { pasteClipboard, writeClipboard, type PasteMode } from "../services/clipboard";
import { invalidateViewClipCache } from "./use-clip-cache-invalidation";
import { formatAggregate } from "./clipboard-domain";
import { useAggregateFormat } from "./use-aggregate-format";

export type ClipCopyPasteOptions = {
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
};

export function useClipCopyPaste({
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
}: ClipCopyPasteOptions) {
  /** 聚合拼接格式：ref 供异步复制链路读最新值，state 驱动聚合工作区菜单。 */
  const { format: aggregateFormat, setFormat: setAggregateFormat, formatRef: aggregateFormatRef } = useAggregateFormat();

  /** 命令回包归一化后合并回列表:按 id 原地替换并同步 clipsRef。
   *  写回族(copyClip/pasteText/pasteClip/聚合复制)共用同一回写形态,抽出来避免
   *  六处复制粘贴;失败由调用方 try/catch 承接。facade 的 updateClipContent 也复用。 */
  function applyNormalizedToClips(payload: Partial<ClipItem>) {
    const normalized = normalizeClip(payload, settingsRef.current);
    if (normalized) {
      invalidateViewClipCache();
      setClips((current) => {
        const next = current.map((clip) => (clip.id === normalized.id ? normalized : clip));
        clipsRef.current = next;
        return next;
      });
    }
    return normalized;
  }

  /** 复制成功后的乐观 UI：置最新复制 id、选中、copyCount+1，1.4s 后清除高亮。
   *  useCallback：依赖全为 setter/ref（pasteClip 与 ClipboardRow memo 依赖引用稳定）。 */
  const markClipCopied = useCallback(function markClipCopied(item: ClipItem, status: string) {
    const now = Date.now();
    setLastCopiedId(item.id);
    setNativeStatus(status);
    setSelectedId(item.id);
    invalidateViewClipCache();
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
  }, [setLastCopiedId, setNativeStatus, setSelectedId, setClips, clipsRef, settingsRef]);

  // pasteClip 的日志用到 selectedId；经 ref 读取（与 clipsRef 同惯例）使回调依赖
  // 全部为 setter/ref/tr——引用稳定是 App 行回调与 ClipboardRow memo 的前提。
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const pasteClip = useCallback(async function pasteClip(item: ClipItem, source = "unknown") {
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
      selectedId: selectedIdRef.current,
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
        applyNormalizedToClips(payload);
      } catch {
        await navigator.clipboard.writeText(item.content);
      }
      setNativeStatus(formatNativeError(error));
    } finally {
      finishPastePerf({ status: perfStatus });
    }
  }, [setIsPanelEntering, lastSeenClipboard, markClipCopied, tr, setClips, clipsRef, settingsRef, setNativeStatus, formatNativeError]);

  /** 粘贴任意文本到前台应用（从 App.tsx 迁入）：先经 captureStandardTextClip 落一条
   *  文本条目，再走 Rust pasteClipboard；失败回落 copyText（写入剪贴板）并提示。 */
  async function pasteText(text: string, source = "unknown", context: Record<string, unknown> = {}) {
    const finishPastePerf = startPerfSpan("quick.paste", { source });
    let perfStatus = "ok";
    const releaseWaitMs = await waitForPasteTriggerRelease(source);
    if (releaseWaitMs > 0) {
      logAppError("info", "paste-text: shortcut release settled", {
        source,
        releaseWaitMs,
        ...context,
      });
    }
    logAppError("info", "paste-text: invoke start", {
      source,
      chars: text.length,
      selectedId,
      ...context,
    });
    try {
      const item = await captureStandardTextClip(text, source, context);
      const payload = await pasteClipboard<ClipItem>({ id: item.id, pasteMode: "rich", source });
      const normalized = normalizeClip(payload, settingsRef.current);
      if (normalized) {
        setClips((current) => {
          const next = current.map((clip) => (clip.id === normalized.id ? normalized : clip));
          clipsRef.current = next;
          return next;
        });
      }
      setIsPanelEntering(false);
      lastSeenClipboard.current = text.trim();
      setNativeStatus(tr("main.status.pastedCode"));
      toast.success(tr("main.toast.pastedCode"));
      logAppError("info", "paste-text: invoke success", {
        source,
        chars: text.length,
        ...context,
      });
    } catch (error) {
      perfStatus = "fallback-copy";
      logAppError("warn", "Paste text failed", { source, error: String(error), ...context });
      await copyText(text, `${source}:fallback-copy`, context);
      setNativeStatus(tr("main.status.pasteCodeFallback"));
    } finally {
      finishPastePerf({ status: perfStatus });
    }
  }

  /** 复制条目到剪贴板（rich/plain/filesAsPaths 三种模式）。
   *  乐观标记 + Rust writeClipboard + 失败回落浏览器剪贴板 + toast 反馈；
   *  依赖全部来自 hook 入参。 */
  async function copyClip(item: ClipItem, pasteMode: PasteMode = "rich") {
    const finishCopyPerf = startPerfSpan("quick.copy", { source: "ui", pasteMode });
    let perfStatus = "ok";
    const optimisticStatus =
      pasteMode === "plain"
        ? tr("main.status.copiedPlain")
        : pasteMode === "filesAsPaths"
          ? tr("main.status.copiedFilePaths")
          : tr("main.status.copiedRich");
    lastSeenClipboard.current = item.content.trim();
    markClipCopied(item, optimisticStatus);
    try {
      const payload = await writeClipboard<ClipItem>({ id: item.id, pasteMode, source: "ui" });
      applyNormalizedToClips(payload);
    } catch {
      perfStatus = "fallback";
      await navigator.clipboard.writeText(item.content);
      setNativeStatus(tr("main.status.copiedBrowser"));
    } finally {
      toast.success("已复制到剪贴板", { description: truncateText(item.plainText || item.content, 42) });
      finishCopyPerf({ status: perfStatus });
    }
  }

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
      // OCR 等来源要求顶层 sourceImageId 可检索；其余上下文仍保留在 clipforgeContext。
      ...(typeof context.sourceImageId === "string"
        ? { sourceImageId: context.sourceImageId }
        : {}),
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
      applyNormalizedToClips(payload);
      lastSeenClipboard.current = text.trim();
      setNativeStatus(tr("main.status.copiedCodeSystem"));
      toast.success(tr("main.toast.copied"));
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
      toast.success(tr("main.toast.copied"));
    } finally {
      finishCopyPerf({ status: perfStatus });
    }
  }

  async function copySelectedClips(items: ClipItem[]) {
    if (!items.length) {
      setNativeStatus(tr("main.status.selectBeforeAggregate"));
      return;
    }
    // 与聚合工作区预览共用 formatAggregate 与同一格式配置：复制结果即预览。
    const text = formatAggregate(items, aggregateFormatRef.current);
    try {
      const aggregate = await captureStandardTextClip(
        text,
        "ui:multi-select-aggregate",
        { itemIds: items.map((item) => item.id), itemCount: items.length },
        [tr("main.tag.aggregate")],
      );
      const payload = await writeClipboard<ClipItem>({
        id: aggregate.id,
        pasteMode: "rich",
        source: "ui:multi-select-aggregate",
      });
      applyNormalizedToClips(payload);
      lastSeenClipboard.current = text.trim();
      setNativeStatus(tr("main.status.aggregateCopied", { count: items.length }));
    } catch {
      await navigator.clipboard.writeText(text);
      setNativeStatus(tr("main.status.aggregateCopiedBrowser", { count: items.length }));
    }
    toast.success(tr("main.toast.aggregateCopied", { count: items.length }));
    const now = Date.now();
    setLastCopiedId(items[0]?.id ?? null);
    items.forEach((item) => {
      invoke("update_clip_record", { input: { id: item.id, copied: true } }).catch((error) =>
        logAppError("warn", "Update aggregated copied state failed", String(error)),
      );
    });
    invalidateViewClipCache();
    setClips((current) => {
      const next = current.map((clip) =>
        items.some((item) => item.id === clip.id)
          ? {
              ...clip,
              copyCount: clip.copyCount + 1,
              lastCopiedAt: now,
              updatedAt: now,
            }
          : clip,
      );
      clipsRef.current = next;
      return next;
    });
    window.setTimeout(() => setLastCopiedId(null), 1400);
    setSelectedIds(new Set());
    setMultiSelectMode(false);
    setMultiPreviewOpen(false);
  }

  return {
    markClipCopied,
    captureStandardTextClip,
    copyClip,
    copyText,
    pasteClip,
    pasteText,
    copySelectedClips,
    aggregateFormat,
    setAggregateFormat,
    applyNormalizedToClips, // 内部共享：仅 facade（use-clip-writeback.ts）复用，勿在组件层直接使用
  };
}
