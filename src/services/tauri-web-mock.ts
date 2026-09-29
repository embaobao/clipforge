/** 浏览器开发预览的 Tauri 协议 mock（dev-only）。
 *  在 web 环境下 polyfill window.__TAURI_INTERNALS__，用 localStorage 提供与 Rust 侧
 *  同名同参的 invoke 命令实现，让主面板/详情页/设置页在悬浮窗验证器里走完整交互闭环。
 *  仅验证样式与交互，不做真实系统能力（剪贴板读写、文件下载等用浏览器等价物替代）。 */
import { DEMO_CLIP_SOURCES } from "../clipboard/dev-demo-clips";

type MockRecord = {
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

const DB_KEY = "clipforge-webmock-v1";
const SETTINGS_KEY = "clipforge-webmock-settings-v1";
const PINNED_KEY = "clipforge-webmock-pinned";
let seq = 0;

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

function saveDb(records: MockRecord[]) {
  localStorage.setItem(DB_KEY, JSON.stringify(records));
}

let db: MockRecord[] = loadDb();

/** 首次初始化：用演示源数据播种（deletedAt 的记录进回收站）。 */
function seedDb(): void {
  if (db.length > 0) return;
  const now = Date.now();
  db = DEMO_CLIP_SOURCES.map((source, index) => {
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
  saveDb(db);
}

function toPublic(record: MockRecord): MockRecord {
  return { ...record };
}

/** 剪贴板轮询：浏览器等价物，变化时入库并广播 clipboard-changed（对齐 Rust 线程行为）。 */
let lastClipboardText = "";
let pollTimer = 0;
async function pollClipboard(): Promise<void> {
  try {
    const text = await navigator.clipboard.readText();
    if (text && text !== lastClipboardText) {
      lastClipboardText = text;
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

function upsertRecord(content: string, sourceLabel: string): { status: "created" | "promoted"; item: MockRecord } {
  const existing = db.find((record) => record.content === content && !record.deletedAt);
  const now = Date.now();
  if (existing) {
    existing.lastSeenAt = now;
    existing.updatedAt = now;
    saveDb(db);
    return { status: "promoted", item: toPublic(existing) };
  }
  const record: MockRecord = {
    id: `web-${Date.now()}-${seq++}`,
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
  db = [record, ...db];
  saveDb(db);
  return { status: "created", item: toPublic(record) };
}

/** 事件监听器表：plugin:event|listen 注册，emitEvent 广播。 */
type MockListener = { event: string; handler: (payload: unknown) => void };
const listeners = new Map<number, MockListener>();
let listenerSeq = 0;

function emitEvent(event: string, payload: unknown): void {
  listeners.forEach((entry) => {
    if (entry.event === event) {
      try {
        entry.handler(payload);
      } catch (error) {
        console.warn("[web-mock] listener error", error);
      }
    }
  });
}

/** 回调表：transformCallback 返回数字 id（支持 once，调用后注销）。 */
const callbacks = new Map<number, { fn: (data: unknown) => void; once: boolean }>();
let callbackSeq = 0;

/** 简单文本搜索：大小写不敏感包含匹配（对齐 Rust 侧最小行为，供样式验证）。
 *  支持 cursor 分页（偏移式，对齐 Rust 键集分页的前端契约）：返回 nextCursor 供 loadMore。 */
function filterRecords(input: Record<string, unknown>): { items: MockRecord[]; nextCursor: string | null } {
  let result = [...db];
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

/** 命令分发：覆盖主面板/详情页/设置页全部 invoke 路径；未列出的命令返回最小合理值。 */
async function mockInvoke(cmd: string, args: Record<string, unknown> = {}): Promise<unknown> {
  switch (cmd) {
    case "init_clip_database": {
      seedDb();
      return { path: "web-mock://clipforge.sqlite", schemaVersion: 1 };
    }
    case "search_clip_records": {
      const input = (args.input ?? {}) as Record<string, unknown>;
      // 返回全部记录（含已删），过滤逻辑由前端按 activeView 完成，与 Rust 行为一致。
      const { items, nextCursor } = filterRecords(input);
      return {
        items: items.map(toPublic),
        limit: typeof input.limit === "number" ? input.limit : 200,
        nextCursor,
      };
    }
    case "capture_clip_record": {
      const input = (args.input ?? args) as Record<string, unknown>;
      const content = String(input.content ?? "");
      if (!content.trim()) throw new Error("CLIPBOARD_EMPTY: empty content");
      return upsertRecord(content, String(input.sourceLabel ?? "mock"));
    }
    case "capture_current_clipboard": {
      let text = "";
      try {
        text = await navigator.clipboard.readText();
      } catch {
        text = "";
      }
      if (!text.trim()) throw new Error("CLIPBOARD_EMPTY: clipboard empty");
      lastClipboardText = text;
      return upsertRecord(text, String((args.input as Record<string, unknown> | undefined)?.sourceLabel ?? "Clipboard"));
    }
    case "write_clipboard_item":
    case "paste_clipboard_item": {
      const input = (args.input ?? {}) as Record<string, unknown>;
      const record = db.find((item) => item.id === input.id);
      if (!record) throw new Error("NOT_FOUND: clip record not found");
      const text = record.plainText || record.content;
      try {
        await navigator.clipboard.writeText(text);
        lastClipboardText = text;
      } catch {
        /* 剪贴板 API 不可用时仅返回记录，样式验证不受影响 */
      }
      record.lastSeenAt = Date.now();
      saveDb(db);
      return toPublic(record);
    }
    case "soft_delete_clip_records": {
      const ids = (args.ids ?? []) as string[];
      const now = Date.now();
      db.forEach((record) => {
        if (ids.includes(record.id)) record.deletedAt = now;
      });
      saveDb(db);
      return { deleted: ids.length };
    }
    case "restore_clip_records": {
      const ids = (args.ids ?? []) as string[];
      db.forEach((record) => {
        if (ids.includes(record.id)) record.deletedAt = null;
      });
      saveDb(db);
      return { restored: ids.length };
    }
    case "hard_delete_clip_records": {
      const ids = (args.ids ?? []) as string[];
      db = db.filter((record) => !ids.includes(record.id));
      saveDb(db);
      return { deleted: ids.length };
    }
    case "cleanup_clip_records": {
      const input = (args.input ?? {}) as Record<string, unknown>;
      const before = db.length;
      const now = Date.now();
      if (input.mode === "empty-trash") {
        db = db.filter((record) => !record.deletedAt);
      } else {
        db = db.filter((record) => !record.deletedAt || now - record.deletedAt < 30 * 24 * 3600_000);
      }
      saveDb(db);
      return { deleted: before - db.length };
    }
    case "update_clip_record": {
      const input = (args.input ?? {}) as Record<string, unknown>;
      const record = db.find((item) => item.id === input.id);
      if (!record) throw new Error("NOT_FOUND: clip record not found");
      if (typeof input.favorite === "boolean") record.favorite = input.favorite;
      if (typeof input.content === "string") {
        record.content = input.content;
        record.plainText = input.content;
      }
      if (Array.isArray(input.tags)) record.tags = input.tags as string[];
      record.updatedAt = Date.now();
      saveDb(db);
      return toPublic(record);
    }
    case "save_editor_draft": {
      const input = (args.input ?? args) as Record<string, unknown>;
      const record = db.find((item) => item.id === input.id);
      if (!record) throw new Error("NOT_FOUND: clip record not found");
      if (typeof input.content === "string") {
        record.content = input.content;
        record.plainText = input.content;
      }
      saveDb(db);
      return toPublic(record);
    }
    case "check_accessibility_permission":
      return { canReadFocusedInput: true, status: "unsupported", message: "web mock" };
    case "is_panel_pinned_command":
      return localStorage.getItem(PINNED_KEY) === "1";
    case "set_panel_pinned_command": {
      localStorage.setItem(PINNED_KEY, args.pinned ? "1" : "0");
      return null;
    }
    case "read_user_settings": {
      const raw = localStorage.getItem(SETTINGS_KEY);
      return { path: "web-mock://settings.json", settings: raw ? JSON.parse(raw) : {} };
    }
    case "write_user_settings": {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(args.settings ?? {}));
      return { path: "web-mock://settings.json" };
    }
    case "check_file_paths":
      // 故意全部标记缺失：让"文件不存在"徽标在预览里可验证。
      return ((args.paths ?? []) as string[]).map((path) => ({ path, exists: false, isDir: false }));
    case "append_app_log":
      console.debug("[web-mock:log]", args.level, args.message);
      return null;
    case "export_clip_text_files": {
      // 浏览器等价物：拼接文本触发下载，验证导出交互路径。
      const items = ((args.items ?? []) as Array<{ name?: string; text?: string }>);
      const blob = new Blob([items.map((item) => item.text ?? "").join("\n\n---\n\n")], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "clipforge-export.txt";
      anchor.click();
      URL.revokeObjectURL(url);
      return { count: items.length, directory: "Downloads", files: items.map((item) => item.name ?? "clip.txt") };
    }
    case "open_settings_window":
      window.open("/settings.html", "_blank");
      return null;
    case "open_onboarding_window":
      window.open("/onboarding.html", "_blank");
      return null;
    case "open_accessibility_settings":
      return null;
    case "show_quick_panel_command":
    case "hide_quick_panel_command":
      return null;
    case "get_clipforge_config_path":
    case "get_clipforge_database_path":
      return "web-mock://clipforge.sqlite";
    case "cleanup_app_logs":
      return "ok";
    case "settings_service_get": {
      const raw = localStorage.getItem(SETTINGS_KEY);
      // 契约对齐 Rust：返回 SettingsDocument（settings + revision），不是裸对象。
      return { settings: raw ? JSON.parse(raw) : {}, revision: "web-mock-rev-1" };
    }
    case "settings_service_patch":
    case "settings_service_replace": {
      const raw = localStorage.getItem(SETTINGS_KEY);
      const current = raw ? JSON.parse(raw) : {};
      const next = cmd === "settings_service_patch" ? { ...current, ...(args.settings ?? args) } : (args.settings ?? {});
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      return { ok: true };
    }
    case "settings_service_reset": {
      localStorage.removeItem(SETTINGS_KEY);
      return { ok: true };
    }
    case "settings_service_agent_providers":
      return { providers: [] };
    case "settings_service_agent_models":
      return { models: [] };
    case "settings_service_agent_check":
      return { ready: false, reason: "web mock" };
    case "plugin:event|listen": {
      const id = ++listenerSeq;
      const callbackId = args.handler as number;
      const callback = callbacks.get(callbackId);
      listeners.set(id, {
        event: String(args.event),
        handler: (payload) => callback?.fn({ event: args.event, payload }),
      });
      return id;
    }
    case "plugin:event|unlisten": {
      listeners.delete(Number(args.rid ?? args.id));
      return null;
    }
    case "plugin:event|emit":
      emitEvent(String(args.event), args.payload);
      return null;
    default: {
      if (cmd.startsWith("plugin:window|") || cmd.startsWith("plugin:webview|")) return null;
      if (cmd === "plugin:opener|open_url") {
        window.open(String(args.url), "_blank");
        return null;
      }
      if (cmd === "plugin:opener|open_path") return null;
      // 升级/诊断/启动项等：最小合理值，保证面板路径不阻塞。
      if (cmd.startsWith("check_update") || cmd.startsWith("download_update") || cmd.startsWith("install_update")) {
        return { status: "up-to-date" };
      }
      if (cmd.startsWith("get_build_info")) return { version: "0.0.0-web-mock", target: "web" };
      if (cmd.startsWith("get_mcp_status")) return { running: false };
      if (cmd.startsWith("get_log_stats")) return { total: 0 };
      if (cmd.startsWith("get_panel_trigger_status")) return { registered: true };
      if (cmd.startsWith("get_accessibility_diagnostics")) {
        return {
          trusted: false,
          expectedBundleIdentifier: "web.mock.clipforge",
          codeSignatureIdentifier: "web-mock",
          signatureKind: "web-mock",
          appBundlePath: "",
          executablePath: "",
          tccRecords: [],
        };
      }
      if (cmd.startsWith("get_launch_at_login")) return { enabled: false };
      if (cmd.startsWith("set_launch_at_login")) return { enabled: Boolean(args.enabled) };
      if (cmd.startsWith("reset_accessibility_permission")) return { canReadFocusedInput: false, status: "unsupported" };
      if (cmd.startsWith("export_diagnostics_bundle")) return { path: "web-mock://diagnostics.zip" };
      if (cmd.startsWith("ignore_update_version")) return null;
      console.warn(`[web-mock] unhandled command: ${cmd}`, args);
      return null;
    }
  }
}

/** 安装 polyfill：仅在 dev 且非 Tauri 运行时执行；重复安装幂等。 */
function install(): void {
  const runtime = window as typeof window & {
    __TAURI_INTERNALS__?: unknown;
    __clipforgeMock?: unknown;
  };
  if (runtime.__TAURI_INTERNALS__ || runtime.__clipforgeMock) return;

  runtime.__TAURI_INTERNALS__ = {
    invoke: (cmd: string, args?: Record<string, unknown>) => Promise.resolve().then(() => mockInvoke(cmd, args ?? {})),
    transformCallback: (callback: (data: unknown) => void, once = false) => {
      const id = ++callbackSeq;
      callbacks.set(id, { fn: callback, once });
      return id;
    },
    unregisterCallback: (id: number) => {
      callbacks.delete(id);
    },
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { label: "main" },
    },
    convertFileSrc: (path: string) => path,
  };

  // 暴露调试句柄：测试脚本可注入数据/触发事件/重置数据库。
  runtime.__clipforgeMock = {
    emit: emitEvent,
    listRecords: () => db.map(toPublic),
    resetDb: () => {
      localStorage.removeItem(DB_KEY);
      db = [];
      seedDb();
    },
    seedText: (content: string, sourceLabel = "mock") => upsertRecord(content, sourceLabel),
    /** 播种图片条目：验证行内缩略图 / 悬浮卡大图 / 快速预览的图片渲染链路。 */
    seedImage: (src: string, width = 640, height = 400, sourceLabel = "mock") => {
      const now = Date.now();
      const record: MockRecord = {
        id: `web-img-${now}-${seq++}`,
        content: "截图.png",
        createdAt: now,
        updatedAt: now,
        lastSeenAt: now,
        favorite: false,
        deletedAt: null,
        bucket: "all",
        source: sourceLabel,
        tags: [],
        kind: "attachment",
        payloadKind: "image",
        primaryFormat: "image/png",
        availableFormats: ["image/png"],
        representations: [],
        plainText: "截图.png",
        metadata: {},
        captureContext: {},
        imageFile: src,
        width,
        height,
      };
      db = [record, ...db];
      saveDb(db);
      return { status: "created" as const, item: toPublic(record) };
    },
  };

  window.clearInterval(pollTimer);
  pollTimer = window.setInterval(() => void pollClipboard(), 2000);
  console.info("[web-mock] Tauri protocol mock installed (dev preview)");
}

install();
