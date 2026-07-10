import type {
  ClipboardCaptureInput,
  ClipboardCaptureResult,
  ClipboardRepository,
  ClipPatch,
  ClipQuery,
  ClipQueryResult,
  ClipRecord,
  ExportRequest,
  ExportResult,
  ImportRequest,
  ImportResult,
} from "./contracts";

function hashContent(content: string) {
  let hash = 0;
  for (let index = 0; index < content.length; index += 1) {
    hash = (hash * 31 + content.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16);
}

function createRecord(input: ClipboardCaptureInput): ClipRecord {
  const now = input.observedAt;
  const contentHash = hashContent(input.content);
  const kind = /^https?:\/\//.test(input.content.trim()) ? "link" : "text";
  const primaryFormat = "text/plain";
  const sourceLabel = input.sourceLabel ?? "Clipboard";
  return {
    id: `clip_${contentHash}`,
    content: input.content,
    contentHash,
    kind,
    bucket: "history",
    source: input.source,
    sourceLabel,
    favorite: false,
    tags: input.tags ?? [],
    copyCount: 0,
    createdAt: now,
    updatedAt: now,
    lastSeenAt: now,
    analysis: {
      sourceName: input.sourceLabel ?? "Clipboard",
      badge: "T",
      title: input.content.replace(/\s+/g, " ").slice(0, 48),
      summary: input.content.replace(/\s+/g, " ").slice(0, 96),
      isMarkdown: false,
    },
    payloadKind: kind,
    primaryFormat,
    availableFormats: [primaryFormat],
    representations: [
      {
        format: primaryFormat,
        storage: "inline",
        content: input.content,
        size: input.content.length,
        hash: contentHash,
        preferred: true,
      },
    ],
    plainText: input.content,
    searchText: input.content,
    subKind: null,
    width: null,
    height: null,
    size: input.content.length,
    fileTypes: null,
    thumbnailPath: null,
    imageFile: null,
    isSensitive: false,
    captureContext: {
      schemaVersion: 1,
      surface: input.source,
      sourceLabel,
      sourceApp: null,
      observedAt: now,
      primaryFormat,
      availableFormats: [primaryFormat],
      environment: {},
    },
    metadata: input.metadata ?? {},
    agentContext: input.agentContext ?? {},
  };
}

export class ExampleClipboardRepository implements ClipboardRepository {
  private records = new Map<string, ClipRecord>();

  async initialize() {
    return { storagePath: "/Users/me/Library/Application Support/ClipForge/clipforge.sqlite", migrated: 0 };
  }

  async capture(input: ClipboardCaptureInput): Promise<ClipboardCaptureResult> {
    const contentHash = hashContent(input.content);
    const existing = [...this.records.values()].find((item) => item.contentHash === contentHash);
    if (existing) {
      const next = { ...existing, lastSeenAt: input.observedAt, updatedAt: input.observedAt };
      this.records.set(next.id, next);
      return { status: "promoted", item: next };
    }
    const item = createRecord(input);
    this.records.set(item.id, item);
    return { status: "created", item };
  }

  async get(id: string) {
    return this.records.get(id) ?? null;
  }

  async query(input: ClipQuery): Promise<ClipQueryResult> {
    const text = input.text?.toLowerCase().trim();
    const items = [...this.records.values()]
      .filter((item) => (input.bucket && input.bucket !== "all" ? item.bucket === input.bucket : true))
      .filter((item) => (text ? `${item.content} ${item.tags.join(" ")}`.toLowerCase().includes(text) : true))
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
      .slice(0, input.limit);
    return {
      items,
      total: items.length,
      indexedAt: Date.now(),
      window: { limit: input.limit, cursor: input.cursor, hasMore: false },
    };
  }

  async count() {
    return { total: this.records.size };
  }

  async update(id: string, patch: ClipPatch) {
    const current = this.records.get(id);
    if (!current) throw new Error(`Clip not found: ${id}`);
    const next = { ...current, ...patch, updatedAt: Date.now() };
    this.records.set(id, next);
    return next;
  }

  async delete(ids: string[]) {
    ids.forEach((id) => this.records.delete(id));
    return { deletedIds: ids };
  }

  async cleanup() {
    return { hardDeleted: 0, softDeleted: 0, retained: this.records.size, ranAt: Date.now() };
  }

  async export(input: ExportRequest): Promise<ExportResult> {
    const result = await this.query(input.query ?? { limit: 100, bucket: "all" });
    return {
      format: input.format,
      fileName: `clipforge-export.${input.format}`,
      content: JSON.stringify(result.items, null, 2),
      exportedAt: Date.now(),
      count: result.items.length,
    };
  }

  async import(input: ImportRequest): Promise<ImportResult> {
    const parsed = JSON.parse(input.content) as ClipRecord[];
    parsed.forEach((item) => this.records.set(item.id, item));
    return { imported: parsed.length, skipped: 0, updated: 0, errors: [] };
  }
}

export async function exampleServiceRoundTrip() {
  const repository = new ExampleClipboardRepository();
  await repository.initialize();

  const writeResult = await repository.capture({
    content: "https://github.com/shadcn-ui/ui",
    source: "clipboard",
    sourceLabel: "Clipboard",
    observedAt: Date.now(),
  });

  const readResult = writeResult.item ? await repository.get(writeResult.item.id) : null;

  const searchResult = await repository.query({
    text: "github",
    bucket: "all",
    limit: 10,
    sort: "recent",
  });

  return { writeResult, readResult, searchResult };
}
