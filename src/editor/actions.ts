import { normalizeEditorTags } from "./suggestions.js";
import type { EditorPluginAction } from "../services/contracts.js";

export type EditorActionPreview = {
  valid: boolean;
  error: string;
  actionType: EditorPluginAction["type"];
  content: string;
  tags: string[];
  metadata?: Record<string, unknown>;
  preview: string;
};

export function previewEditorPluginAction(
  content: string,
  tags: string[],
  action: EditorPluginAction,
  selection?: { start: number; end: number },
): EditorActionPreview {
  const normalizedTags = normalizeEditorTags(tags);
  const range = selection
    ? {
        start: Math.max(0, Math.min(content.length, selection.start)),
        end: Math.max(0, Math.min(content.length, selection.end)),
      }
    : null;
  if (range && range.start > range.end) {
    return { valid: false, error: "selection range is invalid", actionType: action.type, content, tags: normalizedTags, preview: "" };
  }
  switch (action.type) {
    case "replaceDocument":
      return { valid: true, error: "", actionType: action.type, content: action.text, tags: normalizedTags, preview: action.text };
    case "replaceSelection": {
      if (!range) return { valid: false, error: "replaceSelection requires selection range", actionType: action.type, content, tags: normalizedTags, preview: "" };
      const next = `${content.slice(0, range.start)}${action.text}${content.slice(range.end)}`;
      return { valid: true, error: "", actionType: action.type, content: next, tags: normalizedTags, preview: action.text };
    }
    case "insertText": {
      const insertAt = range?.start ?? content.length;
      const next = `${content.slice(0, insertAt)}${action.text}${content.slice(insertAt)}`;
      return { valid: true, error: "", actionType: action.type, content: next, tags: normalizedTags, preview: action.text };
    }
    case "setMetadata":
      return { valid: true, error: "", actionType: action.type, content, tags: normalizedTags, metadata: action.metadata, preview: JSON.stringify(action.metadata) };
    case "updateTags": {
      const remove = new Set(action.tagPatch.remove.map((tag) => tag.toLowerCase()));
      const kept = normalizeEditorTags([...action.tagPatch.keep, ...normalizedTags]).filter((tag) => !remove.has(tag.toLowerCase()));
      const nextTags = normalizeEditorTags([...kept, ...action.tagPatch.add]);
      return { valid: true, error: "", actionType: action.type, content, tags: nextTags, preview: nextTags.join(", ") };
    }
  }
}
