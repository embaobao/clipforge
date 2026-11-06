/** tag provenance 读写（设计 §5）：tags_provenance 存 clips.metadata（additive，不建列）。
 *  四源：heuristic（Rust default_tags）/ manual（用户编辑保存）/ ai（分析 applyTags）/ plugin（运行时 append）。
 *  未知/缺失 source 归 heuristic 显示（旧数据不迁移不清洗）。 */
import type { ClipItem } from "../../../App";

export type TagProvenanceSource = "heuristic" | "manual" | "ai" | "plugin";

export type TagProvenanceMap = Record<string, { source: TagProvenanceSource; ts: number; actor?: string }>;

/** 从条目 metadata 解析 provenance；无记录返回空对象（chip 端按 heuristic 兜底）。 */
export function parseTagProvenance(clip: ClipItem): TagProvenanceMap {
  const raw = (clip.metadata as Record<string, unknown> | undefined)?.tags_provenance;
  if (!raw || typeof raw !== "object") return {};
  const out: TagProvenanceMap = {};
  for (const [tag, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const record = value as Record<string, unknown>;
    const source = record.source;
    const valid: TagProvenanceSource[] = ["heuristic", "manual", "ai", "plugin"];
    out[tag] = {
      source: valid.includes(source as TagProvenanceSource) ? (source as TagProvenanceSource) : "heuristic",
      ts: typeof record.ts === "number" ? record.ts : 0,
      actor: typeof record.actor === "string" ? record.actor : undefined,
    };
  }
  return out;
}

/** 人工保存：整组覆盖 tags 后重组 provenance——保留已有非冲突记录，新增/变更标 manual。 */
export function buildManualProvenance(
  previous: TagProvenanceMap,
  tags: string[],
  now = Date.now(),
): TagProvenanceMap {
  const out: TagProvenanceMap = {};
  for (const tag of tags) {
    const kept = previous[tag];
    // 已是 manual 的保留原 ts（多次保存不刷新）；heuristic/ai 转手动时以本次时间为准。
    out[tag] = kept && kept.source === "manual" ? kept : { source: "manual", ts: now };
  }
  return out;
}

/** AI 追加：merge 语义——只对新增 tag 标 ai:actor，已有记录不动。 */
export function mergeAiProvenance(
  previous: TagProvenanceMap,
  addedTags: string[],
  actor: string,
  now = Date.now(),
): TagProvenanceMap {
  const out = { ...previous };
  for (const tag of addedTags) {
    if (out[tag]) continue;
    out[tag] = { source: "ai", ts: now, actor };
  }
  return out;
}

/** chip 色点 class（四源视觉契约，设计 §5.1）。 */
export const tagSourceDotClass: Record<TagProvenanceSource, string> = {
  heuristic: "bg-muted-foreground/50",
  manual: "bg-primary",
  ai: "bg-emerald-500",
  plugin: "bg-amber-500",
};

/** chip tooltip 前缀文案 key（i18n 键，组件端 tr）。 */
export const tagSourceLabelKey: Record<TagProvenanceSource, "main.detail.tag.source.heuristic" | "main.detail.tag.source.manual" | "main.detail.tag.source.ai" | "main.detail.tag.source.plugin"> = {
  heuristic: "main.detail.tag.source.heuristic",
  manual: "main.detail.tag.source.manual",
  ai: "main.detail.tag.source.ai",
  plugin: "main.detail.tag.source.plugin",
};
