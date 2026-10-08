/** 浏览器开发预览 mock 的状态仓（dev-only，与命令分发层 tauri-web-mock.ts 分离）。
 *  集中存放 localStorage 持久化的剪贴板记录、事件监听器表、回调表与轮询状态；
 *  分发层经 mockStore 对象直接读写可变状态，避免跨模块 let 重赋值所需的成套 setter。 */
import { DEMO_CLIP_SOURCES } from "../clipboard/dev-demo-clips";

/** 单条剪贴板记录（结构对齐 Rust ClipRecord，normalizeClip 宽容兜底缺失字段）。 */
export type MockRecord = {
  id: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  lastSeenAt: number;
  favorite: boolean;
  deletedAt: number | null;
  bucket: string;
  source: string;
  tags: string[];
  kind: string;
  payloadKind: string;
  primaryFormat: string;
  availableFormats: string[];
  representations: unknown[];
  plainText: string;
  metadata: Record<string, unknown>;
  captureContext: Record<string, unknown>;
  /** 图片条目：本地路径或 data: URL（浏览器预览用 data:，convertFileSrc 原样透传）。 */
  imageFile?: string | null;
  thumbnailPath?: string | null;
  width?: number | null;
  height?: number | null;
};

export const DB_KEY = "clipforge-webmock-v1";
export const SETTINGS_KEY = "clipforge-webmock-settings-v1";
export const PINNED_KEY = "clipforge-webmock-pinned";

/** 存原始记录数组（结构对齐 Rust ClipRecord，normalizeClip 宽容兜底缺失字段）。 */
function loadDb(): MockRecord[] {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) return JSON.parse(raw) as MockRecord[];
  } catch {
    /* 损坏则重建 */
  }
  return [];
}

export function saveDb(records: MockRecord[]) {
  localStorage.setItem(DB_KEY, JSON.stringify(records));
}

/** 事件监听器表条目：plugin:event|listen 注册，emitEvent 广播。 */
type MockListener = { event: string; handler: (payload: unknown) => void };

/** 全部可变 mock 状态：记录数组/自增序号/轮询句柄/监听器表/回调表。 */
export const mockStore = {
  records: loadDb(),
  seq: 0,
  lastClipboardText: "",
  pollTimer: 0,
  listeners: new Map<number, MockListener>(),
  listenerSeq: 0,
  callbacks: new Map<number, { fn: (data: unknown) => void; once: boolean }>(),
  callbackSeq: 0,
};

/** 首次初始化：用演示源数据播种（deletedAt 的记录进回收站）。 */
export function seedDb(): void {
  if (mockStore.records.length > 0) return;
  const now = Date.now();
  mockStore.records = DEMO_CLIP_SOURCES.map((source, index) => {
    const createdAt = now - source.minutesAgo * 60_000;
    return {
      id: `web-seed-${index + 1}`,
      content: source.content,
      createdAt,
      updatedAt: createdAt,
      lastSeenAt: createdAt,
      favorite: Boolean(source.favorite),
      deletedAt: source.deletedAt ? now - 60_000 : null,
      bucket: "all",
      source: source.sourceLabel ?? "mock",
      tags: [],
      kind: "text",
      payloadKind: "text",
      primaryFormat: "text/plain",
      availableFormats: ["text/plain"],
      representations: [],
      plainText: source.content,
      metadata: {},
      captureContext: {},
    };
  });
  saveDb(mockStore.records);
}

export function toPublic(record: MockRecord): MockRecord {
  return { ...record };
}

/** 剪贴板轮询：浏览器等价物，变化时入库并广播 clipboard-changed（对齐 Rust 线程行为）。 */
export async function pollClipboard(): Promise<void> {
  try {
    const text = await navigator.clipboard.readText();
    if (text && text !== mockStore.lastClipboardText) {
      mockStore.lastClipboardText = text;
      upsertRecord(text, "Clipboard");
      emitEvent("clipboard-changed", {
        changeCount: 1,
        hasChange: true,
        preview: text.slice(0, 80),
        previewLen: text.length,
      });
    }
  } catch {
    /* 无剪贴板权限时静默跳过 */
  }
}

export function upsertRecord(content: string, sourceLabel: string): { status: "created" | "promoted"; item: MockRecord } {
  const existing = mockStore.records.find((record) => record.content === content && !record.deletedAt);
  const now = Date.now();
  if (existing) {
    existing.lastSeenAt = now;
    existing.updatedAt = now;
    saveDb(mockStore.records);
    return { status: "promoted", item: toPublic(existing) };
  }
  const record: MockRecord = {
    id: `web-${Date.now()}-${mockStore.seq++}`,
    content,
    createdAt: now,
    updatedAt: now,
    lastSeenAt: now,
    favorite: false,
    deletedAt: null,
    bucket: "all",
    source: sourceLabel,
    tags: [],
    kind: "text",
    payloadKind: "text",
    primaryFormat: "text/plain",
    availableFormats: ["text/plain"],
    representations: [],
    plainText: content,
    metadata: {},
    captureContext: {},
  };
  mockStore.records = [record, ...mockStore.records];
  saveDb(mockStore.records);
  return { status: "created", item: toPublic(record) };
}

/** 事件监听器表：plugin:event|listen 注册，emitEvent 广播。 */
export function emitEvent(event: string, payload: unknown): void {
  mockStore.listeners.forEach((entry) => {
    if (entry.event === event) {
      try {
        entry.handler(payload);
      } catch (error) {
        console.warn("[web-mock] listener error", error);
      }
    }
  });
}

/** 简单文本搜索：大小写不敏感包含匹配（对齐 Rust 侧最小行为，供样式验证）。
 *  支持 cursor 分页（偏移式，对齐 Rust 键集分页的前端契约）：返回 nextCursor 供 loadMore。 */
export function filterRecords(input: Record<string, unknown>): { items: MockRecord[]; nextCursor: string | null } {
  let result = [...mockStore.records];
  const text = typeof input.text === "string" ? input.text.trim().toLowerCase() : "";
  if (text) {
    result = result.filter((record) => record.content.toLowerCase().includes(text));
  }
  if (input.favorite === true) result = result.filter((record) => record.favorite);
  const limit = typeof input.limit === "number" ? input.limit : 200;
  const offset = typeof input.cursor === "string" ? Number.parseInt(input.cursor, 10) || 0 : 0;
  const items = result.slice(offset, offset + limit);
  const nextCursor = offset + items.length < result.length ? String(offset + items.length) : null;
  return { items, nextCursor };
}
