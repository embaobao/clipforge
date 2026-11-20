/**
 * 标签独立保存（clipboard-interaction-repair 第 8 项 / 提案 §24「只改标签不得重建正文或 representations」）。
 *
 * 做什么：构造 `update_clip_record` 的标签专用入参，只带 id / tags / metadata，绝不带 content；
 * Rust 侧 `content = None` 时会跳过 representations_json、plain_text、content_hash、
 * available_formats、primary_format 的重建，正文与全部原格式原样保留。
 *
 * 为什么：`save_editor_draft` 强制带 content，即使只改一个标签也会重建 representations，
 * 富文本 / RTF / HTML 条目的原格式会被静默丢弃；浏览态增删标签又必须即时保存，不能进正文编辑态。
 *
 * 边界：本模块全是纯函数，不发 Tauri 命令、不依赖 React / App 类型（避免单测编译拖入 JSX 依赖）；
 * provenance 采用增量合并，不改 heuristic / ai / plugin 既有来源，删除的标签同步移除其记录。
 */

/** 标签专用写回入参：字段名与 Rust `UpdateClipInput` 对齐，禁止出现任何正文相关字段。 */
export type TagOnlyUpdateInput = {
  id: string;
  tags: string[];
  metadata: Record<string, unknown>;
};

/** 一旦出现在标签专用入参里就会触发 Rust 侧正文 / 表示重建的字段（供静态断言使用）。 */
export const TAG_ONLY_FORBIDDEN_KEYS = [
  "content",
  "contentHash",
  "plainText",
  "representations",
  "representationsJson",
  "primaryFormat",
  "availableFormats",
  "searchText",
  "payloadKind",
] as const;

/** tag provenance 记录：与 `detail/tag-provenance.ts` 的 `TagProvenanceMap` 结构兼容（独立声明避免编译依赖）。 */
export type BrowseTagSource = "heuristic" | "manual" | "ai" | "plugin";
export type BrowseTagProvenance = Record<string, { source: BrowseTagSource; ts: number; actor?: string }>;

/** 标签独立写回所需的最小条目视图：字段与 `ClipItem` 一致，结构化类型天然兼容。 */
export type TagOnlyClip = { id: string; metadata?: Record<string, unknown> };

/** 浏览态标签编辑动作：新增一个标签，或删除一个已有标签。 */
export type BrowseTagEdit = { type: "add"; value: string } | { type: "remove"; tag: string };

/** 浏览态标签编辑计划：规整后的完整标签组 + 是否有实质变化（供调用方跳过空写）。 */
export type BrowseTagEditPlan = { nextTags: string[]; changed: boolean };

/** 与 `workspace-detail-shared.normalizeDetailTag` 同规则：去 # / tag: 前缀、截断 32 字符，空值返回 null。 */
export function normalizeBrowseTag(value: string): string | null {
  const tag = value.trim().replace(/^#/, "").replace(/^tag:/i, "").trim();
  if (!tag) return null;
  return tag.slice(0, 32);
}

/** 与 `normalizeDetailTags` 同规则：去空、大小写不敏感去重、上限 12 个。 */
export function normalizeBrowseTags(values: string[]): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const value of values) {
    const tag = normalizeBrowseTag(value);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  return tags.slice(0, 12);
}

/** 大小写不敏感的标签组比较，用于判断是否需要写库（避免只改大小写也触发写回）。 */
export function sameTags(left: string[], right: string[]): boolean {
  const a = normalizeBrowseTags(left).map((tag) => tag.toLowerCase());
  const b = normalizeBrowseTags(right).map((tag) => tag.toLowerCase());
  return a.length === b.length && a.every((tag, index) => tag === b[index]);
}

/**
 * 浏览态增删标签计划：返回规整后的完整标签组。
 * 新增时去 # 前缀并去重；删除时大小写不敏感匹配；无实质变化 `changed=false`，调用方据此跳过空写。
 */
export function planBrowseTagEdit(currentTags: string[], edit: BrowseTagEdit): BrowseTagEditPlan {
  const base = normalizeBrowseTags(currentTags);
  let next: string[];
  if (edit.type === "add") {
    const tag = normalizeBrowseTag(edit.value);
    next = tag ? [...base, tag] : base;
  } else {
    const target = normalizeBrowseTag(edit.tag)?.toLowerCase() ?? "";
    next = target ? base.filter((tag) => tag.toLowerCase() !== target) : base;
  }
  next = normalizeBrowseTags(next);
  return { nextTags: next, changed: !sameTags(base, next) };
}

/**
 * 浏览态标签增删后的 provenance 增量合并：仍在的标签沿用原来源（heuristic / ai / plugin 不降级），
 * 新增标签标 manual，删除的标签移除记录。区别于 `buildManualProvenance` 的整组覆盖语义。
 */
export function mergeBrowsedTagProvenance(
  previous: BrowseTagProvenance,
  currentTags: string[],
  nextTags: string[],
  now = Date.now(),
): BrowseTagProvenance {
  const currentKeys = new Set(normalizeBrowseTags(currentTags).map((tag) => tag.toLowerCase()));
  const previousByKey = new Map<string, BrowseTagProvenance[string]>();
  for (const [tag, record] of Object.entries(previous)) {
    previousByKey.set(tag.toLowerCase(), record);
  }
  const out: BrowseTagProvenance = {};
  for (const tag of normalizeBrowseTags(nextTags)) {
    const key = tag.toLowerCase();
    const kept = previousByKey.get(key);
    // 只有「原本就在条目上」且 provenance 有记录的标签才保留来源；陈旧记录按新增处理。
    out[tag] = kept && currentKeys.has(key) ? { ...kept } : { source: "manual", ts: now };
  }
  return out;
}

/**
 * 构造标签专用写回入参。metadata 采用「原样展开 + 覆盖 tags_provenance」：
 * Rust 侧 `metadata` 是整组覆盖 `metadata_json`，只传 provenance 会丢掉 aiSummary 等既有字段。
 */
export function buildTagOnlyUpdateInput(args: {
  clip: TagOnlyClip;
  tags: string[];
  provenance: BrowseTagProvenance;
}): TagOnlyUpdateInput {
  return {
    id: args.clip.id,
    tags: normalizeBrowseTags(args.tags),
    metadata: {
      ...(args.clip.metadata ?? {}),
      tags_provenance: args.provenance,
    },
  };
}

/** 静态校验：标签专用入参不得携带任何会触发正文 / 表示重建的字段。 */
export function findForbiddenTagOnlyKeys(input: Record<string, unknown>): string[] {
  return TAG_ONLY_FORBIDDEN_KEYS.filter((key) => Object.prototype.hasOwnProperty.call(input, key));
}
