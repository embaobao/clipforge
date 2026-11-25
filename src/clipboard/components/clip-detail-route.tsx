// 详情路由渲染体（S5 从 App.tsx 迁出）：ClipDetailWorkspace + 快捷操作组装。
// 不携带 data-surface marker——marker 只允许 App.tsx 主面板一根。
import { Copy, ExternalLink, FileJson } from "lucide-react";
import type { TranslationKey } from "../../i18n";
import type { AppSettings } from "../../App";
import type { ClipItem } from "../clip-model";
import { canOpenClipTarget, extractUrls, normalizeClip } from "../clip-model";
import type { FilePathStatus } from "../../services/clipboard";
import { ClipDetailWorkspace } from "../../workspace/workspace-panels";
import { toDetailAgentProviders } from "../../workspace/components/workspace-detail-shared";
import { mergeAiProvenance, parseTagProvenance } from "../../workspace/components/detail/tag-provenance";
import { updateClipTagsOnly } from "../tag-only-writeback";
import type { PasteMode } from "../clip-model";

export function ClipDetailRoute(options: {
  clipId: string;
  clips: ClipItem[];
  selectedClip: ClipItem | null;
  filteredClips: ClipItem[];
  filePathStatuses: Record<string, FilePathStatus>;
  settings: AppSettings;
  settingsRef: { current: AppSettings };
  clipsRef: { current: ClipItem[] };
  setClips: React.Dispatch<React.SetStateAction<ClipItem[]>>;
  setNativeStatus: (status: string) => void;
  setSelectedId: (id: string) => void;
  navigateWorkspaceList: () => Promise<void>;
  navigateWorkspaceDetail: (id: string) => Promise<void>;
  copyClip: (item: ClipItem, pasteMode?: PasteMode) => Promise<void>;
  copyText: (text: string) => void | Promise<void>;
  pasteText: (text: string) => void | Promise<void>;
  ocrExtractAndCopy: (item: ClipItem) => unknown;
  openClipTarget: (item: ClipItem, target?: string) => unknown;
  openSystemPath: (path: string) => unknown;
  searchByTag: (tag: string) => void;
  updateClip: (id: string, next: Partial<ClipItem>) => void;
  updateClipContent: (clip: ClipItem, content: string, tags?: string[], context?: { sessionId: string; draftVersion: number; tagsProvenance?: Record<string, unknown> }) => Promise<ClipItem | void>;
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
}) {
  const o = options;
  const clip = o.clips.find((item) => item.id === o.clipId) ?? o.selectedClip;
  const detailItems = o.filteredClips;
  const detailIndex = clip ? detailItems.findIndex((item) => item.id === clip.id) : -1;
  const previousClip = detailIndex > 0 ? detailItems[detailIndex - 1] : null;
  const nextClip = detailIndex >= 0 && detailIndex < detailItems.length - 1 ? detailItems[detailIndex + 1] : null;
  const navigateDetailClip = (item: ClipItem | null) => {
    if (!item) return;
    void o.navigateWorkspaceDetail(item.id);
  };
  return (
    <ClipDetailWorkspace
      clip={clip}
      filePathStatuses={o.filePathStatuses}
      links={clip ? extractUrls(clip.content) : []}
      tr={o.tr}
      onBack={() => {
        void o.navigateWorkspaceList();
      }}
      onCopy={o.copyClip}
      onCopyPlain={(item) => o.copyClip(item, "plain")}
      onCopyText={o.copyText}
      onOcrExtract={(clip) => {
        void o.ocrExtractAndCopy(clip);
      }}
      onOpen={o.openClipTarget}
      onOpenPath={o.openSystemPath}
      onPasteText={o.pasteText}
      onPrevious={previousClip ? () => navigateDetailClip(previousClip) : undefined}
      onNext={nextClip ? () => navigateDetailClip(nextClip) : undefined}
      onSearchTag={o.searchByTag}
      onUpdateContent={o.updateClipContent}
      onUpdateTags={async (item, tags) =>
        // 标签独立写回：不带 content，Rust 侧不重建正文与 representations（提案 §24）。
        updateClipTagsOnly(item, tags, {
          setClips: o.setClips,
          clipsRef: o.clipsRef,
          settingsRef: o.settingsRef,
          normalizeClip,
          setNativeStatus: o.setNativeStatus,
          tr: o.tr,
        })
      }
      onApplyTags={(clipId, tags) => {
        // AI 建议标签应用：merge 语义写入，新增 tag 在 provenance 标 ai（详情页提案 §5.3）。
        const source = o.clipsRef.current.find((item) => item.id === clipId);
        const previous = source ? parseTagProvenance(source) : {};
        const added = tags.filter((tag) => !(source?.tags ?? []).includes(tag));
        o.updateClip(clipId, {
          tags,
          metadata: {
            ...(source?.metadata ?? {}),
            tags_provenance: mergeAiProvenance(previous, added, "pi"),
          },
        });
      }}
      agentProviders={toDetailAgentProviders(
        o.settings.agent?.providers ?? o.settings.agentProviders,
      )}
      quickActions={[
        ...(clip && canOpenClipTarget(clip)
          ? [
              {
                id: "open-target",
                label: clip.analysis.attachment?.targetType === "path" ? o.tr("main.detailAction.openResource") : o.tr("main.detailAction.openLink"),
                icon: <ExternalLink size={13} />,
                onSelect: () => {
                  void o.openClipTarget(clip);
                },
              },
            ]
          : []),
        ...(clip
          ? [
              {
                id: "copy",
                label: o.tr("main.detailAction.copyContent"),
                icon: <Copy size={13} />,
                onSelect: () => {
                  void o.copyClip(clip);
                },
              },
              {
                id: "parse",
                label: o.tr("main.detailAction.parse"),
                icon: <FileJson size={13} />,
                onSelect: () => {
                  o.setNativeStatus(o.tr("main.status.parsePluginReserved"));
                },
              },
            ]
          : []),
      ]}
    />
  );
}
