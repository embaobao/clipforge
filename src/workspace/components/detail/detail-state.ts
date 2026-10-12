/** 详情页三态状态机与纯函数辅助（提案 detail-page-information-architecture）。
 *  三态：view（只读浏览）/ edit（MD 编辑器）/ diff（插件草稿对比）；
 *  本文件只放纯函数与类型，不依赖 React，便于单测。 */
import type { ClipItem } from "../../../App";
import { extractDetailHashTags } from "../workspace-detail-shared";

/** 详情页内容主体模式。 */
export type DetailMode = "view" | "edit" | "diff";

/** 插件草稿：改写类插件产出，仅存内存，⌘S 生效 / Esc 丢弃，不落库。 */
export type DetailDraft = {
  content: string;
  srcId: string;
  ts: number;
};

/** 可编辑条目判定：图片/文件类只读（内容为二进制/文件引用，文本编辑无意义）。 */
export function isEditableClip(clip: ClipItem): boolean {
  return clip.payloadKind !== "image" && clip.payloadKind !== "file";
}

/** 是否有富文本 representation（决定「⧉ 原格式」复制是否可用）。 */
export function hasRichRepresentation(clip: ClipItem): boolean {
  return (clip.representations ?? []).some(
    (entry) => entry.format === "text/html" || entry.format === "text/rtf",
  );
}

/** 来源路径：file-list 文件名 > path 型附件 > 本地路径型来源地址。
 *  返回空串表示条目无路径（路径行整体隐藏）。 */
export function getDetailSourcePath(clip: ClipItem): string {
  const fileListEntry = (clip.representations ?? []).find(
    (entry) => entry.format === "application/file-list" && entry.fileName,
  );
  if (fileListEntry?.fileName) return fileListEntry.fileName;
  if (clip.analysis.attachment?.targetType === "path" && clip.analysis.attachment.target) {
    return clip.analysis.attachment.target;
  }
  if (clip.imageFile) return clip.imageFile;
  const address = clip.analysis.url || "";
  return address.startsWith("/") || address.startsWith("~") ? address : "";
}

/** 键盘事件是否发生在可编辑目标内（编辑器/搜索框输入时不拦截单键快捷键）。 */
export function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof Element
    ? Boolean(target.closest("input, textarea, select, [contenteditable='true']"))
    : false;
}

/** 编辑态建议 tags（§5）：正文 #话题 + 类型推断（附件→图片/资源，纯类型→中文类型名），去重并排除已选。 */
export function buildSuggestedTags(clip: ClipItem, content: string, draftTags: string[]): string[] {
  const kindTagMap: Record<string, string[]> = {
    link: ["链接"],
    command: ["命令"],
    json: ["JSON"],
    markdown: ["Markdown"],
    code: ["代码"],
  };
  const smartTypeTags = clip.analysis.attachment
    ? [clip.analysis.attachment.isImage ? "图片" : "资源"]
    : kindTagMap[clip.kind] ?? [];
  return Array.from(new Set([...extractDetailHashTags(content), ...smartTypeTags])).filter(
    (tag) => !draftTags.some((current) => current.toLowerCase() === tag.toLowerCase()),
  );
}
