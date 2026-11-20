/**
 * 标签独立写回编排（clipboard-interaction-repair 第 8 项 / 提案 §24）。
 *
 * 做什么：只构造 `id / tags / metadata` 的入参调用 `update_clip_record`，显式不带 content；
 * Rust 侧 `content = None` 会跳过 representations_json / plain_text / content_hash /
 * available_formats 的重建，正文与全部原格式原样保留。成功后用返回的 payload 归一化同步本地列表。
 *
 * 为什么：浏览态增删标签、编辑态仅改标签都不应触发整篇重建；旧的 `save_editor_draft`
 * 强制带 content，`updateClip` 又是 fire-and-forget 且吞掉错误，用户无法感知写回失败。
 *
 * 边界：metadata 采用「原样展开 + 覆盖 tags_provenance」，避免整组覆盖丢掉 aiSummary 等字段；
 * provenance 增量合并保留 heuristic / ai / plugin 来源；错误向上抛出，由调用方脱敏后展示。
 * 本模块不持有业务状态，依赖全部由上层注入。
 */
import { invoke } from "@tauri-apps/api/core";
import type { AppSettings, ClipItem } from "../App";
import type { TranslationKey } from "../i18n";
import { parseTagProvenance } from "../workspace/components/detail/tag-provenance";
import {
  buildTagOnlyUpdateInput,
  findForbiddenTagOnlyKeys,
  mergeBrowsedTagProvenance,
} from "../workspace/components/detail/tag-only-save";

/** 标签独立写回依赖：本地列表同步、设置快照、状态文案，由 App 层注入。 */
export type TagOnlyWritebackDeps = {
  setClips: React.Dispatch<React.SetStateAction<ClipItem[]>>;
  clipsRef: { current: ClipItem[] };
  settingsRef: { current: AppSettings };
  normalizeClip: (raw: Partial<ClipItem>, settings: AppSettings) => ClipItem | null;
  setNativeStatus: (status: string) => void;
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
};

/**
 * 标签独立写回：构造不含 content 的入参 → invoke → 归一化同步 → 成功状态。
 * 抛出的异常由 `useBrowseTagEdit` 的翻译函数转成脱敏文案，可关闭展示。
 */
export async function updateClipTagsOnly(
  clip: ClipItem,
  tags: string[],
  deps: TagOnlyWritebackDeps,
): Promise<ClipItem | void> {
  const provenance = mergeBrowsedTagProvenance(parseTagProvenance(clip), clip.tags ?? [], tags);
  const input = buildTagOnlyUpdateInput({ clip, tags, provenance });
  // 静态防护：任何正文相关字段出现都立即拒绝，绝不把重建 representations 的入参发给 Rust。
  const forbidden = findForbiddenTagOnlyKeys(input);
  if (forbidden.length) throw new Error(`TAG_ONLY_INPUT_FORBIDDEN:${forbidden.join(",")}`);
  const payload = await invoke<Partial<ClipItem>>("update_clip_record", { input });
  const normalized = deps.normalizeClip(payload, deps.settingsRef.current);
  if (normalized) {
    deps.setClips((current) => {
      const next = current.map((item) => (item.id === normalized.id ? normalized : item));
      deps.clipsRef.current = next;
      return next;
    });
  }
  deps.setNativeStatus(deps.tr("main.status.detailSaved"));
  return normalized ?? undefined;
}
