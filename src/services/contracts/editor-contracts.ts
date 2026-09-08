/** 编辑器域契约：草稿、上下文快照、标签补丁与本地智能建议结果。 */
import type { ClipKind, ClipPayloadKind } from "./clipboard-contracts.js";

export type EditorDraft = {
  sessionId: string;
  draftVersion: number;
  clipId: string;
  content: string;
  tags: string[];
  dirty: boolean;
  createdAt: number;
  updatedAt: number;
};

export type EditorContextSnapshot = {
  schemaVersion: 1;
  clip: {
    id: string;
    kind: ClipKind;
    payloadKind: ClipPayloadKind;
    title: string;
    summary: string;
    tags: string[];
    sourceAppName?: string;
  };
  editor: {
    sessionId: string;
    draftVersion: number;
    format: ClipPayloadKind;
    selectionText: string;
    contentLength: number;
    tags: string[];
    suggestedTags: string[];
    dirty: boolean;
  };
  runtime: {
    platform: string;
    route: string;
    activeView: string;
    panelPinned: boolean;
  };
  permission: {
    exposeFullContent: boolean;
    redactedFields: string[];
  };
};

export type TagPatch = {
  add: string[];
  remove: string[];
  keep: string[];
};

export type EditorSuggestionResult = {
  id: string;
  sessionId: string;
  draftVersion: number;
  contentPatch?: {
    type: "replaceDocument" | "replaceSelection" | "insertText";
    preview: string;
    replacement: string;
  };
  tagPatch?: TagPatch;
  rationale: string;
  riskLevel: "low" | "medium" | "high";
};

export type EditorPluginAction =
  | { type: "replaceSelection"; text: string }
  | { type: "replaceDocument"; text: string }
  | { type: "insertText"; text: string }
  | { type: "setMetadata"; metadata: Record<string, unknown> }
  | { type: "updateTags"; tagPatch: TagPatch };
