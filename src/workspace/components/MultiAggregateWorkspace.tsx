import { Copy, FileDown, FileJson, FileText, Table2 } from "lucide-react";
import { useState } from "react";
import type { ClipItem } from "../../App";
import { WorkspaceCrumb } from "./WorkspaceCrumb";
import { AggregateItem } from "./AggregateItem";
import type { WorkspaceTr } from "./workspace-detail-shared";

export type MultiAggregateWorkspaceProps = {
  items: ClipItem[];
  aggregatePreview: string;
  tr: WorkspaceTr;
  onBack: () => void;
  onCopy: () => void;
  onCopyItem: (clip: ClipItem) => void;
  onExportTextFiles: () => Promise<void> | void;
  onExportTable: () => void;
  onOpenItem: (clip: ClipItem) => void;
};

const actionStripButtonClass = "inline-flex h-7 items-center gap-1.5 rounded-md border border-border/60 px-2.5 text-[12px] transition-colors hover:bg-black/[0.05] disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-white/[0.08]";
const crumbIconButtonClass = "inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-black/[0.05] hover:text-foreground disabled:opacity-40 dark:hover:bg-white/[0.08]";

/** 多条目聚合视图：全量预览 + 逐条目列表（链接/Markdown 渲染），导出与复制动作在顶部工具条。 */
export function MultiAggregateWorkspace({
  aggregatePreview,
  items,
  tr,
  onBack,
  onCopy,
  onCopyItem,
  onExportTextFiles,
  onExportTable,
  onOpenItem,
}: MultiAggregateWorkspaceProps) {
  const [isExporting, setIsExporting] = useState(false);
  const totalChars = items.reduce((sum, item) => sum + item.content.length, 0);
  const linkCount = items.reduce((sum, item) => sum + (item.analysis.url ? 1 : 0), 0);
  const kindCount = new Set(items.map((item) => item.payloadKind)).size;
  const handleExportTextFiles = async () => {
    if (isExporting || !items.length) return;
    setIsExporting(true);
    try {
      await onExportTextFiles();
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <section className="h-full overflow-auto bg-transparent" data-surface="workspace">
      <WorkspaceCrumb title={tr("main.aggregate.title")} subtitle={tr("main.aggregate.subtitle", { count: items.length, chars: totalChars })} onBack={onBack} tr={tr}>
        <button aria-label={tr("main.aggregate.exportTexts")} className={crumbIconButtonClass} disabled={!items.length || isExporting} onClick={() => void handleExportTextFiles()} title={tr("main.aggregate.exportTexts")} type="button">
          <FileDown size={14} />
        </button>
        <button aria-label={tr("main.aggregate.exportTable")} className={crumbIconButtonClass} onClick={onExportTable} title={tr("main.aggregate.exportTable")} type="button">
          <Table2 size={14} />
        </button>
        <button aria-label={tr("main.aggregate.copyContent")} className={crumbIconButtonClass} onClick={onCopy} title={tr("main.aggregate.copyContent")} type="button">
          <Copy size={14} />
        </button>
      </WorkspaceCrumb>
      <div aria-label={tr("main.aggregate.quickActions")} className="flex flex-wrap gap-1.5 border-b border-border/40 px-4 py-2">
        <button className={actionStripButtonClass} onClick={onCopy} type="button">
          <Copy size={13} />
          {tr("main.aggregate.copyAll")}
        </button>
        <button className={actionStripButtonClass} onClick={onExportTable} type="button">
          <Table2 size={13} />
          {tr("main.aggregate.exportTable")}
        </button>
        <button aria-busy={isExporting} className={actionStripButtonClass} disabled={!items.length || isExporting} onClick={() => void handleExportTextFiles()} type="button">
          <FileDown size={13} />
          {tr("main.aggregate.exportTexts")}
        </button>
        <button className={actionStripButtonClass} disabled type="button">
          <FileText size={13} />
          {tr("main.aggregate.template")}
        </button>
        <button className={actionStripButtonClass} disabled type="button">
          <FileJson size={13} />
          {tr("main.aggregate.structure")}
        </button>
      </div>
      {items.length ? (
        <div aria-label={tr("main.aggregate.summary")} className="flex gap-4 px-4 py-2 text-[12px] text-muted-foreground">
          <span><strong className="text-foreground">{items.length}</strong> {tr("main.aggregate.items")}</span>
          <span><strong className="text-foreground">{kindCount}</strong> {tr("main.aggregate.kinds")}</span>
          <span><strong className="text-foreground">{linkCount}</strong> {tr("main.aggregate.links")}</span>
        </div>
      ) : null}
      {items.length ? (
        <div aria-label={tr("main.aggregate.content")} className="flex flex-col gap-4 px-4 pb-6">
          <section className="space-y-2">
            <div className="flex items-baseline gap-2">
              <strong className="text-[12px]">{tr("main.aggregate.raw")}</strong>
              <span className="text-[11px] text-muted-foreground">{tr("main.aggregate.rawHint")}</span>
            </div>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/[0.03] p-3 text-[12px] leading-relaxed dark:bg-white/[0.05]">{aggregatePreview}</pre>
          </section>

          <section className="space-y-2">
            <div className="flex items-baseline gap-2">
              <strong className="text-[12px]">{tr("main.aggregate.itemList")}</strong>
              <span className="text-[11px] text-muted-foreground">{tr("main.aggregate.itemCount", { count: items.length })}</span>
            </div>
            <div className="flex flex-col gap-2">
              {items.map((item, index) => (
                <AggregateItem count={items.length} index={index} item={item} key={item.id} tr={tr} onCopyItem={onCopyItem} onOpenItem={onOpenItem} />
              ))}
            </div>
          </section>
        </div>
      ) : (
        <div className="flex h-40 items-center justify-center text-[13px] text-muted-foreground">{tr("main.aggregate.empty")}</div>
      )}
    </section>
  );
}
