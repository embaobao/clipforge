// 聚合路由渲染体（S5 从 App.tsx 迁出）：MultiAggregateWorkspace + 导出 handler 绑定。
// 不携带 data-surface marker——marker 只允许 App.tsx 主面板一根。
import type { TranslationKey } from "../../i18n";

import type { ClipItem } from "../clip-model";
import type { AggregateFormatOptions } from "../clipboard-domain";
import { MultiAggregateWorkspace } from "../../workspace/workspace-panels";
import { useAggregateExport } from "../use-aggregate-export";
import type { PasteMode } from "../clip-model";

export function AggregateRoute(options: {
  selectedInList: ClipItem[];
  aggregatePreview: string;
  aggregateFormat: AggregateFormatOptions;

  copySelectedClips: (items: ClipItem[]) => Promise<void>;
  copyClip: (item: ClipItem, pasteMode?: PasteMode) => Promise<void>;
  exportSelectedTextFiles: (items: ClipItem[]) => void | Promise<void>;
  setAggregateFormat: (format: AggregateFormatOptions) => void;
  setMultiPreviewOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setMultiSelectMode: React.Dispatch<React.SetStateAction<boolean>>;
  setSelectedId: (id: string) => void;
  navigateWorkspaceList: () => Promise<void>;
  navigateWorkspaceDetail: (id: string) => Promise<void>;
  setNativeStatus: (status: string) => void;
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
  formatNativeError: (error: unknown) => string;
}) {
  const o = options;
  const { exportTable, exportCsvFile, exportSplitFiles } = useAggregateExport({
    selectedInList: o.selectedInList,

    setNativeStatus: o.setNativeStatus,
    tr: o.tr,
    formatNativeError: o.formatNativeError,
  });
  return (
    <MultiAggregateWorkspace
      aggregatePreview={o.aggregatePreview}
      items={o.selectedInList}
      format={o.aggregateFormat}
      tr={o.tr}
      onFormatChange={o.setAggregateFormat}
      onBack={() => {
        o.setMultiPreviewOpen(false);
        o.setMultiSelectMode(o.selectedInList.length > 0);
        void o.navigateWorkspaceList();
      }}
      onCopy={() => {
        void o.copySelectedClips(o.selectedInList).then(() => o.navigateWorkspaceList());
      }}
      onCopyItem={(clip) => o.copyClip(clip)}
      onExportTextFiles={() => o.exportSelectedTextFiles(o.selectedInList)}
      onExportTable={exportTable}
      onExportCsvFile={exportCsvFile}
      onExportSplitFiles={exportSplitFiles}
      onOpenItem={(clip) => {
        o.setSelectedId(clip.id);
        void o.navigateWorkspaceDetail(clip.id);
      }}
    />
  );
}
