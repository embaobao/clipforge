// 剪贴板领域纯函数与类型（frontend-surface-architecture-refactor Phase B）
// 从 src/App.tsx 迁出的「剪贴板内容展示」相关纯逻辑：行文案截断、显示文本、文件路径、tooltip 内容。
// 纯函数无副作用、不依赖 React/DOM，供主面板行组件（ClipboardContentPreview / ClipboardRowActions / ClipboardRow）和 App.tsx 共用。
// TODO: ClipItem 当前 type-only 从 ../App 引入；后续 App.tsx 拆分时迁到共享 types 模块。
import type { TranslationKey } from "../i18n";
import { getImagePath, type FilePathStatus } from "../services/clipboard";
import type { ClipItem } from "../App";

/** i18n 翻译函数类型（与 App.tsx 内各处签名一致）。 */
export type TrFunction = (key: TranslationKey, params?: Record<string, string | number>) => string;

/** 行 tooltip 内容（标题 / 描述 / 正文）。 */
export type AppTooltipContent = {
  title: string;
  description: string;
  body: string;
};

/** 从路径或 URL 中提取最后一段文件名，保留查询串之前的主体名。 */
export function getFileNameFromPath(value: string | null | undefined) {
  if (!value) return "";
  const normalized = value.replace(/^file:\/\//, "");
  try {
    if (/^https?:\/\//i.test(normalized)) {
      const url = new URL(normalized);
      return decodeURIComponent(url.pathname.split("/").filter(Boolean).at(-1) || url.hostname);
    }
  } catch {
    // ignore and fall through to filesystem-style basename parsing
  }
  const clean = normalized.split(/[?#]/)[0] ?? normalized;
  return clean.split(/[\\/]/).filter(Boolean).at(-1) || clean;
}

/** 中段省略：长文案从中间截断（头部 + ... + 尾部）。 */
export function middleEllipsis(value: string, head = 34, tail = 14) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= head + tail + 3) return normalized;
  return `${normalized.slice(0, head)}...${normalized.slice(-tail)}`;
}

/** 把单行长文案拆成「头 + 尾」两段交给 CSS flex 布局：头部可收缩并末尾省略，尾部固定不裁。
 *  修复旧实现「JS 先拼 head...tail，再被 .quick-line 的 text-overflow:ellipsis 二次裁掉尾部」的问题。
 *  文本较短（不超过单行容量）时返回单段，走普通末尾省略。 */
export function splitLineForMiddleEllipsis(text: string, tailLen = 16) {
  const normalized = (text || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= 50) return { split: false as const, text: normalized };
  return {
    split: true as const,
    head: normalized.slice(0, Math.max(1, normalized.length - tailLen)),
    tail: normalized.slice(-tailLen),
    full: normalized,
  };
}

/** 按内容展示模式返回列表行用的显示文本。结构化类型避免引入 AppSettings 命名冲突。 */
export function getDisplayText(item: ClipItem, settings: { contentDisplayMode: string }) {
  if (settings.contentDisplayMode === "raw") return item.content.replace(/\s+/g, " ").trim();
  if (settings.contentDisplayMode === "middle") return middleEllipsis(item.content);
  return item.analysis.summary || middleEllipsis(item.content);
}

/** 从 file 类 clip 的 content 里解析出行列表。 */
export function getFilePathsFromClip(item: ClipItem) {
  if (item.payloadKind !== "file") return [];
  return item.content
    .split(/\r?\n/)
    .map((path) => path.trim())
    .filter(Boolean);
}

/** 取列表行主文案：image/file 取文件名，其它取首行纯文本。 */
export function getClipboardLine(item: ClipItem) {
  if (item.payloadKind === "image") {
    return (
      getFileNameFromPath(item.imageFile) ||
      item.analysis.attachment?.name ||
      getFileNameFromPath(item.thumbnailPath) ||
      item.analysis.title ||
      "Image"
    );
  }
  if (item.payloadKind === "file") {
    const files = getFilePathsFromClip(item);
    const first = getFileNameFromPath(files[0]);
    return first ? `${first}${files.length > 1 ? ` +${files.length - 1}` : ""}` : item.analysis.title || item.content;
  }
  // 优先用纯文本渲染：HTML/RTF 等 clip 的 content 是源码，plainText 才是用户可见的文字。
  // 修复前：复制 HTML 后列表把它当 HTML 源码显示；修复后：默认渲染为文字内容。
  // 只取首个换行前的内容，避免对大文本（如长日志）做 O(n) 全串扫描：
  // 列表每行、每次滚动帧都会调用本函数，全串扫描会显著拖慢大内容场景的滚动与复制。
  const source = item.plainText || item.content || "";
  const newlineAt = source.search(/\r?\n/);
  const firstLineRaw = newlineAt >= 0 ? source.slice(0, newlineAt) : source;
  const line = firstLineRaw.replace(/\s+/g, " ").trim();
  return line || item.analysis.title || "";
}

/**
 * 图片条目的可加载图源：本地文件路径经 asset 协议转换；无可用源返回 null（调用方回退文本行）。
 * variant=thumb 行内小图优先缩略图文件（原图可能几 MB，28px 缩略图不值得解码全量）；
 * variant=full 悬浮卡/快速预览优先原图，缩略图兜底。
 */
export function getClipImageSrc(item: ClipItem, variant: "thumb" | "full" = "full"): string | null {
  if (item.payloadKind !== "image") return null;
  const candidates =
    variant === "thumb"
      ? [item.thumbnailPath, item.imageFile, item.analysis.attachment?.target]
      : [item.imageFile, item.analysis.attachment?.target, item.thumbnailPath];
  return getImagePath(candidates.find(Boolean));
}

/** 判断 file 类 clip 的文件是否缺失（任一路径不存在即缺失）。 */
export function isFileClipMissing(item: ClipItem, statuses: Record<string, FilePathStatus>) {
  const paths = getFilePathsFromClip(item);
  if (!paths.length) return false;
  return paths.some((path) => statuses[path]?.exists === false);
}

/** 构造行 tooltip 内容：标题取自 analysis.title / 来源；正文优先纯文本并截断到 600 字（避免大文本阻塞渲染）。 */
export function getItemTooltip(item: ClipItem, tr: TrFunction): AppTooltipContent {
  const source = item.sourceApp?.name || item.analysis.sourceName || tr("main.tooltip.clipboardHistory");
  const title = item.analysis.title || source;
  const description = item.analysis.url ? tr("main.tooltip.linkContent") : item.analysis.attachment ? tr("main.tooltip.attachmentContent") : source;
  // tooltip 每个可见行都常驻挂载在 DOM（仅 opacity:0）。把整篇大文案塞进 body，
  // 大文本条目会让打开那一帧布局/提交暴涨 200–340ms、阻塞输入。截断到预览长度即可；
  // 复制/粘贴走 item.content 本体，不受影响。
  // 优先纯文本：HTML/RTF 不把源码塞进 tooltip（与列表渲染一致，默认显示文字）。
  const fullBody = item.plainText || item.content || getClipboardLine(item);
  const body =
    fullBody.length > 600
      ? `${fullBody.slice(0, 600)}\n${tr("main.tooltip.omitted", { total: fullBody.length, omitted: fullBody.length - 600 })}`
      : fullBody;
  return { title, description, body };
}

/** 返回当前平台的修饰键标签：macOS 为 Cmd，其它为 Ctrl。 */
export function getShortcutModLabel() {
  return typeof navigator !== "undefined" && /Mac/i.test(navigator.platform) ? "Cmd" : "Ctrl";
}

/** 聚合拼接的分隔符档位：blank=一个空行，newline=单个换行，space=单空格，custom=用户自定义串。 */
export type AggregateSeparator = "blank" | "newline" | "space" | "custom";
/** 聚合条目顺序：selected=选中（点击）顺序，time=按创建时间从新到旧（与面板列表一致）。 */
export type AggregateOrder = "selected" | "time";

/** 聚合拼接格式：分隔符 + 编号开关 + 顺序。持久化到 localStorage，复制与预览共用同一份配置。 */
export type AggregateFormatOptions = {
  separator: AggregateSeparator;
  /** separator=custom 时使用的分隔串，支持 `\n` `\t` 转义。 */
  customSeparator: string;
  /** 是否给每条加 `1. ` 序号。 */
  numbered: boolean;
  order: AggregateOrder;
};

/** 默认拼接格式：空行分隔、无编号、保持点击顺序（与旧硬编码 join("\n\n") 行为一致）。 */
export const DEFAULT_AGGREGATE_FORMAT: AggregateFormatOptions = {
  separator: "blank",
  customSeparator: "",
  numbered: false,
  order: "selected",
};

/** 分隔符档位 → 实际拼接串；custom 档把字面量 `\n`/`\t`/`\r` 转义成真实控制字符。 */
function resolveSeparator(options: AggregateFormatOptions) {
  switch (options.separator) {
    case "newline":
      return "\n";
    case "space":
      return " ";
    case "custom":
      return options.customSeparator.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\r/g, "\r");
    default:
      return "\n\n";
  }
}

/** 非文本条目降级为可拼接字符串：file 取全部路径（每条一行），image 取文件名/标题。
 *  富格式（RTF/HTML）合并不在本版本范围，附件类统一走此降级路径。 */
function aggregateItemText(item: ClipItem) {
  if (item.payloadKind === "file") {
    const paths = getFilePathsFromClip(item);
    return paths.length ? paths.join("\n") : item.content;
  }
  if (item.payloadKind === "image") {
    return (
      getFileNameFromPath(item.imageFile) ||
      item.analysis.attachment?.name ||
      getFileNameFromPath(item.thumbnailPath) ||
      item.analysis.title ||
      item.content
    );
  }
  return item.content;
}

/** 按格式选项拼接多条剪贴板内容：聚合复制（copySelectedClips）与聚合工作区预览共用本函数，
 *  保证「复制结果与预览一致」。空内容条目直接跳过，避免旧实现在空条目处留下多余分隔符。
 *  顺序：selected 保持调用方传入序（App.tsx 的 selectedIds Set 插入序 = 点击序）；
 *  time 按 createdAt 从新到旧排序，同秒时保持原相对顺序（稳定排序）。 */
export function formatAggregate(items: ClipItem[], options: AggregateFormatOptions = DEFAULT_AGGREGATE_FORMAT) {
  const ordered = options.order === "time" ? [...items].sort((a, b) => b.createdAt - a.createdAt) : items;
  const separator = resolveSeparator(options);
  const parts: string[] = [];
  ordered.forEach((item, index) => {
    const text = aggregateItemText(item).replace(/\s+$/, "");
    if (!text) return;
    parts.push(options.numbered ? `${index + 1}. ${text}` : text);
  });
  return parts.join(separator);
}
