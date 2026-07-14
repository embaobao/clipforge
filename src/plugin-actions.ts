import { analyzeSmartFormats } from "./smart-format.js";

export type PluginRuntime = "builtin" | "script" | "mcp" | "rpc" | "panel";
export type PluginActionType =
  | "renderPanel"
  | "previewPatch"
  | "replaceSelection"
  | "replaceDocument"
  | "copyResult"
  | "openUrl"
  | "openApp"
  | "runCommand"
  | "callAgent"
  | "navigateDetail"
  | "updateTags"
  | "suggestUpdate";

export type ClipForgePluginManifest = {
  id: string;
  name: string;
  version: string;
  runtime: PluginRuntime;
  actions: Array<{ id: string; type: PluginActionType; label: string }>;
  matching: {
    priority: number;
    contentKinds?: string[];
    payloadKinds?: string[];
    urlPatterns?: string[];
  };
  permissions: {
    requiresUserConfirmation: boolean;
    allowFullContent: boolean;
    allowOpenUrl: boolean;
    allowOpenApp: boolean;
    allowRunCommand: boolean;
  };
  compatibility: { app: string; contextSchema: number };
};

export type SmartParsedTarget = {
  id: string;
  kind: "url" | "filePath" | "command" | "jsonField" | "codeBlock" | "markdownHeading" | "markdownLink" | "errorBlock" | "plainSummary";
  label: string;
  value: string;
  suggestedActions: Array<"copy" | "open" | "openDetail" | "runPlugin">;
};

export type PluginActionResolution = {
  traceId: string;
  clipId: string;
  surface: "quick-action" | "detail" | "editor";
  shortcut?: "Mod+J";
  selected: {
    pluginId: string;
    actionId: string;
    priority: number;
    requiresUserConfirmation: boolean;
    targetCandidateId?: string;
    targetKind?: SmartParsedTarget["kind"] | "analysisUrl";
    targetValue?: string;
  };
  parsedTargets: SmartParsedTarget[];
  candidates: Array<{
    pluginId: string;
    actionId: string;
    score: number;
    reasons: string[];
  }>;
};

export type PluginActionClip = {
  id: string;
  content: string;
  kind: string;
  payloadKind: string;
  analysis: {
    url?: string;
    attachment?: { target: string; targetType: "url" | "path"; isImage?: boolean };
  };
};

export type PluginManifestValidationResult = {
  valid: boolean;
  errors: string[];
};

export type PermissionExpansion = {
  permission: keyof ClipForgePluginManifest["permissions"];
  previous: boolean;
  next: boolean;
};

export type CapabilityVersionRecord = {
  id: string;
  kind: "app" | "builtin-manifest" | "plugin" | "agent-provider";
  version: string;
  previousVersion?: string;
  status: "current" | "available" | "disabled" | "rollback";
  checkedAt: number;
  requiresUserConfirmation: boolean;
};

export const builtinPluginManifests: ClipForgePluginManifest[] = [
  {
    id: "builtin.open-link",
    name: "打开链接",
    version: "1.0.0",
    runtime: "builtin",
    actions: [{ id: "open-link", type: "openUrl", label: "打开链接" }],
    matching: {
      priority: 900,
      contentKinds: ["link"],
      payloadKinds: ["link", "html", "markdown", "text"],
      urlPatterns: ["^https?://"],
    },
    permissions: {
      requiresUserConfirmation: false,
      allowFullContent: false,
      allowOpenUrl: true,
      allowOpenApp: false,
      allowRunCommand: false,
    },
    compatibility: { app: ">=0.1.0", contextSchema: 1 },
  },
  {
    id: "builtin.open-detail",
    name: "进入详情",
    version: "1.0.0",
    runtime: "builtin",
    actions: [{ id: "open-detail", type: "navigateDetail", label: "进入详情" }],
    matching: {
      priority: 100,
      contentKinds: ["text", "markdown", "code", "command", "attachment", "json", "chart", "table"],
    },
    permissions: {
      requiresUserConfirmation: false,
      allowFullContent: false,
      allowOpenUrl: false,
      allowOpenApp: false,
      allowRunCommand: false,
    },
    compatibility: { app: ">=0.1.0", contextSchema: 1 },
  },
];

const pluginRuntimes: PluginRuntime[] = ["builtin", "script", "mcp", "rpc", "panel"];
const pluginActionTypes: PluginActionType[] = [
  "renderPanel",
  "previewPatch",
  "replaceSelection",
  "replaceDocument",
  "copyResult",
  "openUrl",
  "openApp",
  "runCommand",
  "callAgent",
  "navigateDetail",
  "updateTags",
  "suggestUpdate",
];

export function validatePluginManifest(manifest: ClipForgePluginManifest): PluginManifestValidationResult {
  const errors: string[] = [];
  if (!/^[a-z0-9][a-z0-9.-]{2,80}$/i.test(manifest.id)) errors.push("id must be a stable dotted identifier");
  if (!manifest.name.trim()) errors.push("name is required");
  if (!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(manifest.version)) errors.push("version must be semver-like");
  if (!pluginRuntimes.includes(manifest.runtime)) errors.push(`runtime is unsupported: ${manifest.runtime}`);
  if (!manifest.actions.length) errors.push("actions must not be empty");
  for (const action of manifest.actions) {
    if (!action.id.trim()) errors.push("action.id is required");
    if (!pluginActionTypes.includes(action.type)) errors.push(`action.type is unsupported: ${action.type}`);
    if (!action.label.trim()) errors.push(`action ${action.id} label is required`);
  }
  if (!Number.isFinite(manifest.matching.priority)) errors.push("matching.priority must be finite");
  for (const key of Object.keys(manifest.permissions) as Array<keyof ClipForgePluginManifest["permissions"]>) {
    if (typeof manifest.permissions[key] !== "boolean") errors.push(`permissions.${key} must be boolean`);
  }
  if (manifest.compatibility.contextSchema !== 1) errors.push("compatibility.contextSchema must be 1");
  return { valid: errors.length === 0, errors };
}

export function detectPluginPermissionExpansion(
  previous: ClipForgePluginManifest,
  next: ClipForgePluginManifest,
): PermissionExpansion[] {
  return (Object.keys(next.permissions) as Array<keyof ClipForgePluginManifest["permissions"]>)
    .filter((permission) => previous.permissions[permission] === false && next.permissions[permission] === true)
    .map((permission) => ({ permission, previous: false, next: true }));
}

export function builtinCapabilityVersionRecords(now = Date.now()): CapabilityVersionRecord[] {
  return [
    { id: "clipforge.app", kind: "app", version: "0.1.0", status: "current", checkedAt: now, requiresUserConfirmation: false },
    ...builtinPluginManifests.map((manifest) => ({
      id: manifest.id,
      kind: "builtin-manifest" as const,
      version: manifest.version,
      status: "current" as const,
      checkedAt: now,
      requiresUserConfirmation: false,
    })),
  ];
}

export function parseSmartTargets(content: string): SmartParsedTarget[] {
  const targets: SmartParsedTarget[] = [];
  const seen = new Set<string>();
  const add = (target: SmartParsedTarget) => {
    const key = `${target.kind}:${target.value}`;
    if (seen.has(key)) return;
    seen.add(key);
    targets.push(target);
  };

  const urlRegex = /https?:\/\/[^\s<>"')\]]+/g;
  for (const match of content.matchAll(urlRegex)) {
    add({
      id: `url-${match.index ?? targets.length}`,
      kind: "url",
      label: "URL",
      value: match[0],
      suggestedActions: ["open", "copy"],
    });
  }

  for (const line of content.split(/\r?\n/).slice(0, 120)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^(~\/|\/|\.\/|\.\.\/|[A-Za-z]:\\).+\.[\w-]+$/.test(trimmed)) {
      add({ id: `file-${targets.length}`, kind: "filePath", label: "文件路径", value: trimmed, suggestedActions: ["open", "copy"] });
    }
    if (/^(pnpm|npm|cargo|git|node|bun|yarn)\s+/.test(trimmed) || trimmed.startsWith("$ ")) {
      add({ id: `cmd-${targets.length}`, kind: "command", label: "命令", value: trimmed.replace(/^\$\s*/, ""), suggestedActions: ["copy", "runPlugin"] });
    }
    if (/^#{1,6}\s+/.test(trimmed)) {
      add({ id: `heading-${targets.length}`, kind: "markdownHeading", label: "Markdown 标题", value: trimmed.replace(/^#{1,6}\s+/, ""), suggestedActions: ["openDetail"] });
    }
    if (trimmed.includes("Error:") || trimmed.includes("Exception") || trimmed.includes("Traceback")) {
      add({ id: `error-${targets.length}`, kind: "errorBlock", label: "错误日志", value: trimmed, suggestedActions: ["openDetail", "copy"] });
    }
  }

  if (analyzeSmartFormats(content).some((item) => item.kind === "json_minify" || item.kind === "json_repair")) {
    add({ id: "json-root", kind: "jsonField", label: "JSON", value: "root", suggestedActions: ["openDetail", "copy"] });
  }

  if (!targets.length) {
    add({
      id: "plain-summary",
      kind: "plainSummary",
      label: "正文摘要",
      value: content.replace(/\s+/g, " ").trim().slice(0, 240),
      suggestedActions: ["openDetail"],
    });
  }
  return targets.slice(0, 12);
}

export function resolvePrimaryPluginAction(
  clip: PluginActionClip,
  input: { surface: "quick-action" | "detail" | "editor"; shortcut?: "Mod+J" },
): PluginActionResolution {
  const parsedTargets = parseSmartTargets(clip.content);
  const linkTarget =
    clip.analysis.attachment?.targetType === "url"
      ? clip.analysis.attachment.target
      : clip.analysis.url || parsedTargets.find((target) => target.kind === "url")?.value;
  const candidates: PluginActionResolution["candidates"] = [];

  if (linkTarget && /^https?:\/\//i.test(linkTarget)) {
    candidates.push({
      pluginId: "builtin.open-link",
      actionId: "open-link",
      score: 900,
      reasons: ["safe-http-url", clip.analysis.url ? "analysis-url" : "parsed-url"],
    });
  }

  candidates.push({
    pluginId: "builtin.open-detail",
    actionId: "open-detail",
    score: 100,
    reasons: ["default-detail-fallback", `payload:${clip.payloadKind}`, `kind:${clip.kind}`],
  });

  const selected = candidates.slice().sort((a, b) => b.score - a.score)[0];
  const selectedTarget =
    selected.pluginId === "builtin.open-link"
      ? parsedTargets.find((target) => target.kind === "url" && target.value === linkTarget) ??
        parsedTargets.find((target) => target.kind === "url")
      : parsedTargets.find((target) => target.kind === "plainSummary");
  return {
    traceId: `plugin_action_${Date.now()}`,
    clipId: clip.id,
    surface: input.surface,
    shortcut: input.shortcut,
    selected: {
      pluginId: selected.pluginId,
      actionId: selected.actionId,
      priority: selected.score,
      requiresUserConfirmation: false,
      targetCandidateId: selectedTarget?.id,
      targetKind: selected.pluginId === "builtin.open-link" && linkTarget ? selectedTarget?.kind ?? "analysisUrl" : selectedTarget?.kind,
      targetValue: selected.pluginId === "builtin.open-link" ? linkTarget : selectedTarget?.value,
    },
    parsedTargets,
    candidates,
  };
}
