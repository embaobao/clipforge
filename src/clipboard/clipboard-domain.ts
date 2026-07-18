// 剪贴板领域纯函数与类型（frontend-surface-architecture-refactor Phase B）
// 从 src/App.tsx 迁出的「剪贴板内容展示」相关纯逻辑：行文案截断、显示文本、文件路径、tooltip 内容、AI 摘要状态文案。
// 纯函数无副作用、不依赖 React/DOM，供主面板行组件（ClipboardContentPreview / ClipboardRowActions / ClipboardRow）和 App.tsx 共用。
// TODO: ClipItem 当前 type-only 从 ../App 引入；后续 App.tsx 拆分时迁到共享 types 模块。
import type { TranslationKey } from "../i18n";
import type { ClipAiSummary } from "../services/ai-summary";
import type { FilePathStatus } from "../services/clipboard";
import type { ClipItem } from "../App";

/** i18n 翻译函数类型（与 App.tsx 内各处签名一致）。 */
export type TrFunction = (key: TranslationKey, params?: Record<string, string | number>) => string;

/** 行 tooltip 内容（标题 / 描述 / 正文）。 */
export type AppTooltipContent = {
  title: string;
  description: string;
  body: string;
};

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
    return item.imageFile || item.analysis.attachment?.name || item.content || item.analysis.title || "Image";
  }
  if (item.payloadKind === "file") {
    const files = getFilePathsFromClip(item);
    const first = files[0]?.split(/[\\/]/).filter(Boolean).at(-1);
    return first ? `${first}${files.length > 1 ? ` +${files.length - 1}` : ""}` : item.analysis.title || item.content;
  }
  // 优先用纯文本渲染：HTML/RTF 等 clip 的 content 是源码，plainText 才是用户可见的文字。
  // 修复前：复制 HTML 后列表把它当 HTML 源码显示；修复后：默认渲染为文字内容。
  const source = item.plainText || item.content;
  const firstLine = (source || "").split(/\r?\n/, 1)[0] ?? "";
  const line = firstLine.replace(/\s+/g, " ").trim();
  return line || item.analysis.title || "";
}

/** 判断 file 类 clip 的文件是否缺失（任一路径不存在即缺失）。 */
export function isFileClipMissing(item: ClipItem, statuses: Record<string, FilePathStatus>) {
  const paths = getFilePathsFromClip(item);
  if (!paths.length) return false;
  return paths.some((path) => statuses[path]?.exists === false);
}

/** AI 摘要状态的可读文案。 */
export function getAiSummaryStatusLabel(summary: ClipAiSummary, tr: TrFunction) {
  if (summary.status === "ready") return tr("main.list.aiSummaryReady");
  if (summary.status === "pending") return tr("main.list.aiSummaryPending");
  return tr("main.list.aiSummaryFailed");
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
