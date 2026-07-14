import { analyzeSmartFormats } from "../smart-format.js";
import type { EditorSuggestionResult, TagPatch } from "../services/contracts.js";

function normalizeTag(value: string): string | null {
  const tag = value.trim().replace(/^#/, "").replace(/^tag:/i, "").trim();
  if (!tag) return null;
  return tag.slice(0, 32);
}

export function normalizeEditorTags(values: string[]) {
  const seen = new Set<string>();
  const tags: string[] = [];
  values.forEach((value) => {
    const tag = normalizeTag(value);
    if (!tag) return;
    const key = tag.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    tags.push(tag);
  });
  return tags.slice(0, 12);
}

function buildTagPatch(currentTags: string[], suggestedTags: string[]): TagPatch | undefined {
  const keep = normalizeEditorTags(currentTags);
  const add = normalizeEditorTags(suggestedTags).filter(
    (tag) => !keep.some((current) => current.toLowerCase() === tag.toLowerCase()),
  );
  if (!add.length) return undefined;
  return { add, remove: [], keep };
}

export function buildLocalEditorSuggestion(input: {
  sessionId: string;
  draftVersion: number;
  content: string;
  tags: string[];
  suggestedTags: string[];
}): EditorSuggestionResult {
  const content = input.content.trim();
  const tagPatch = buildTagPatch(input.tags, input.suggestedTags);
  const smartPatch = analyzeSmartFormats(content).find(
    (item) =>
      !item.error &&
      (item.kind === "json_repair" || item.kind === "json_unescape" || item.kind === "unicode" || item.kind === "html_entity"),
  );
  const contentPatch = smartPatch
    ? {
        type: "replaceDocument" as const,
        preview: smartPatch.output.slice(0, 1600),
        replacement: smartPatch.output,
      }
    : undefined;
  const actionCount = Number(Boolean(contentPatch)) + (tagPatch?.add.length ?? 0);
  return {
    id: `editor_suggestion_${Date.now()}`,
    sessionId: input.sessionId,
    draftVersion: input.draftVersion,
    contentPatch,
    tagPatch,
    rationale: actionCount
      ? "基于当前草稿生成可预览的内容更新与 tagPatch；应用前不会写入数据库。"
      : "当前草稿没有发现可自动应用的安全建议。",
    riskLevel: contentPatch ? "medium" : "low",
  };
}

export function applyEditorSuggestion(
  content: string,
  tags: string[],
  suggestion: EditorSuggestionResult,
) {
  const nextContent = suggestion.contentPatch?.type === "replaceDocument" ? suggestion.contentPatch.replacement : content;
  const patch = suggestion.tagPatch;
  if (!patch) return { content: nextContent, tags: normalizeEditorTags(tags) };
  const remove = new Set(patch.remove.map((tag) => tag.toLowerCase()));
  const kept = normalizeEditorTags([...patch.keep, ...tags]).filter((tag) => !remove.has(tag.toLowerCase()));
  return { content: nextContent, tags: normalizeEditorTags([...kept, ...patch.add]) };
}
