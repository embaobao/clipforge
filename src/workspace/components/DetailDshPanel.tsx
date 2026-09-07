import { ScanSearch } from "lucide-react";
import { useState } from "react";
import type { ClipItem } from "../../App";
import { getDshHistory, recordDshHistory, type DshAnalyzeResult, type DshHistoryEntry } from "../../agent/dsh-analysis";
import { normalizeDetailTags } from "./workspace-detail-shared";

/** DSH 只读快速分析的调用参数：clip 与写入回调由外壳提供，会话标识用于编辑会话归因。 */
export type UseDshQuickAnalysisParams = {
  clip: ClipItem | null;
  editorSessionId: string;
  draftVersion: number;
  onAnalyzeClipboard?: (clip: ClipItem) => Promise<DshAnalyzeResult | void> | DshAnalyzeResult | void;
  onUpdateContent: (
    clip: ClipItem,
    content: string,
    tags?: string[],
    context?: { sessionId: string; draftVersion: number },
  ) => Promise<ClipItem | void>;
};

/** DSH 只读快速分析 hook：管理分析结果/加载/错误/最近历史，以及「应用标签/分组」的合并写入。
 *  边界：分析本身不改动剪贴板内容；应用标签/分组走 onUpdateContent 的 tags 通道。 */
export function useDshQuickAnalysis({ clip, editorSessionId, draftVersion, onAnalyzeClipboard, onUpdateContent }: UseDshQuickAnalysisParams) {
  const [dshResult, setDshResult] = useState<DshAnalyzeResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [dshError, setDshError] = useState<string | null>(null);
  const [dshHistory, setDshHistory] = useState<DshHistoryEntry[]>(() => getDshHistory());
  const runDshAnalysis = async () => {
    if (!onAnalyzeClipboard || isAnalyzing || !clip) return;
    setIsAnalyzing(true);
    setDshError(null);
    setDshResult(null);
    try {
      const result = await onAnalyzeClipboard(clip);
      if (result) {
        setDshResult(result);
        recordDshHistory({
          clipId: clip.id,
          summary: result.summary,
          category: result.category,
          tags: result.tags,
          suggestedFolder: result.suggestedFolder,
          degraded: result.degraded,
          errorCode: result.errorCode,
        });
        setDshHistory(getDshHistory());
      }
    } catch (error) {
      setDshError(String(error));
    } finally {
      setIsAnalyzing(false);
    }
  };
  const applyDshTags = async () => {
    if (!clip || !dshResult || dshResult.tags.length === 0) return;
    const currentTags = normalizeDetailTags(clip.tags);
    const merged = Array.from(new Set([...currentTags, ...dshResult.tags]));
    await onUpdateContent(clip, clip.content, merged, {
      sessionId: editorSessionId || `editor_${clip.id}`,
      draftVersion,
    });
  };
  const applyDshFolder = async () => {
    if (!clip || !dshResult?.suggestedFolder) return;
    const currentTags = normalizeDetailTags(clip.tags);
    const merged = Array.from(new Set([...currentTags, dshResult.suggestedFolder]));
    await onUpdateContent(clip, clip.content, merged, {
      sessionId: editorSessionId || `editor_${clip.id}`,
      draftVersion,
    });
  };
  return { dshResult, isAnalyzing, dshError, dshHistory, runDshAnalysis, applyDshTags, applyDshFolder };
}

export type DetailDshPanelProps = {
  isAnalyzing: boolean;
  dshError: string | null;
  dshHistory: DshHistoryEntry[];
  dshResult: DshAnalyzeResult | null;
  onApplyFolder: () => void;
  onApplyTags: () => void;
  onSearchTag: (tag: string) => void;
};

/** DSH 分析结果面板（纯展示）：摘要/类别/标签/建议分组/降级提示/应用动作/最近历史。
 *  触发按钮在详情页工具条上；本面板只在有结果或进行中时由外壳条件渲染。 */
export function DetailDshPanel({ isAnalyzing, dshError, dshHistory, dshResult, onApplyFolder, onApplyTags, onSearchTag }: DetailDshPanelProps) {
  const actionButtonClass = "h-6 rounded-md border border-border/60 px-2 text-[11px] transition-colors hover:bg-black/[0.05] disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-white/[0.08]";
  return (
    <div className="space-y-2 rounded-lg border border-border/60 bg-background/95 p-3 text-[12px] shadow-sm" data-surface="workspace">
      <div className="flex items-center gap-1.5 font-medium">
        <ScanSearch size={13} />
        <span>AI 分析</span>
        {isAnalyzing ? <span className="text-[11px] text-muted-foreground">分析中…</span> : null}
      </div>
      {dshError ? <div className="text-destructive">{dshError}</div> : null}
      {dshResult ? (
        <div className="space-y-2">
          {dshResult.summary ? <p className="leading-relaxed">{dshResult.summary}</p> : null}
          {dshResult.category ? (
            <div className="flex gap-2">
              <span className="w-16 shrink-0 text-muted-foreground">类别</span>
              <span>{dshResult.category}</span>
            </div>
          ) : null}
          {dshResult.tags.length ? (
            <div className="flex flex-wrap gap-1">
              {dshResult.tags.map((tag) => (
                <button
                  className="rounded bg-black/[0.05] px-1.5 py-0.5 text-[11px] hover:bg-black/[0.09] dark:bg-white/[0.09] dark:hover:bg-white/[0.15]"
                  key={tag}
                  onClick={() => onSearchTag(tag)}
                  type="button"
                >
                  {tag}
                </button>
              ))}
            </div>
          ) : null}
          {dshResult.suggestedFolder ? (
            <div className="flex gap-2">
              <span className="w-16 shrink-0 text-muted-foreground">建议分组</span>
              <span>{dshResult.suggestedFolder}</span>
            </div>
          ) : null}
          {dshResult.degraded ? <div className="text-[11px] text-amber-600 dark:text-amber-400">降级：{dshResult.errorCode ?? "未拿到结构化结果"}</div> : null}
          <div className="flex gap-1">
            <button className={actionButtonClass} disabled={dshResult.tags.length === 0} onClick={onApplyTags} type="button">
              应用标签
            </button>
            {dshResult.suggestedFolder ? (
              <button className={actionButtonClass} onClick={onApplyFolder} type="button">
                应用分组
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      {dshHistory.length ? (
        <div className="space-y-1 border-t border-border/60 pt-2">
          <div className="text-[11px] text-muted-foreground">最近分析</div>
          {dshHistory.slice(0, 3).map((h, i) => (
            <div className="flex items-center gap-2 text-[11px]" key={`${h.at}-${i}`}>
              <span className="shrink-0 text-muted-foreground">{new Date(h.at).toLocaleTimeString()}</span>
              <span className="truncate">{h.summary ?? h.errorCode ?? "（降级）"}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
