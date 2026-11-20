/**
 * 详情工作区外壳的 props 契约（按域从 `ClipDetailWorkspace.tsx` 抽出，主文件逼近 500 行门禁）。
 * 业务数据仍由 Tauri command 驱动：回调只负责触发写回，不在本层持有剪贴板状态。
 */
import type { ClipItem } from "../../../App";
import type { FilePathStatus } from "../../../services/clipboard";
import type { DetailQuickAction, WorkspaceTr } from "../workspace-detail-shared";

/** 详情页外壳入参：三态（浏览/编辑/diff）编排所需的条目、链接、翻译与写回回调。 */
export type ClipDetailWorkspaceProps = {
  clip: ClipItem | null;
  filePathStatuses?: Record<string, FilePathStatus>;
  links: string[];
  tr: WorkspaceTr;
  onBack: () => void;
  onCopy: (clip: ClipItem) => void;
  onCopyPlain: (clip: ClipItem) => void;
  onCopyText: (text: string, source: string, context?: Record<string, unknown>) => void;
  onOcrExtract: (clip: ClipItem) => void;
  onOpen: (clip: ClipItem) => void;
  onOpenPath?: (path: string) => void;
  onPasteText: (text: string, source: string, context?: Record<string, unknown>) => void;
  onPrevious?: () => void;
  onNext?: () => void;
  onSearchTag: (tag: string) => void;
  /** 正文 + 标签整篇保存（走 save_editor_draft）；仅标签变更时不得使用，见 onUpdateTags。 */
  onUpdateContent: (
    clip: ClipItem,
    content: string,
    tags?: string[],
    context?: { sessionId: string; draftVersion: number; tagsProvenance?: Record<string, unknown> },
  ) => Promise<ClipItem | void>;
  /**
   * 标签独立写回（提案 §24）：只更新 tags / metadata，不带 content，
   * 因此 Rust 侧不会重建 representations、plain_text 与 content_hash，正文及原格式保持不变。
   */
  onUpdateTags: (clip: ClipItem, tags: string[]) => Promise<ClipItem | void>;
  quickActions?: DetailQuickAction[];
  /** Agent provider 配置（settings.agentProviders），用于 pi 底层 AI 分析；空数组时分析按钮禁用。 */
  agentProviders?: Array<Record<string, unknown>>;
  /** 应用 AI 建议标签（转发 update_clip_record 写回通道）；缺省时详情页不显示应用入口。 */
  onApplyTags?: (clipId: string, tags: string[]) => void;
};
