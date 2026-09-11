/** 详情页 AI 分析条（pi 底层）：触发按钮 + 分析状态 + 结果（摘要/标签）自包含渲染。
 *  边界：provider 配置从设置服务异步解析；无配置时按钮禁用并提示，失败降级为错误条。 */
import { ScanSearch } from "lucide-react";
import { useState } from "react";
import { analyzeClipWithPi, resolveDefaultPiProvider, type ClipPiAnalysis } from "../../agent/pi/analysis";
import type { ClipItem } from "../../App";

export type PiAnalysisBarProps = {
  clip: ClipItem;
  agentProviders: Array<Record<string, unknown>>;
  onSearchTag: (tag: string) => void;
};

/** AI 分析条：按钮触发 → 分析中 → 摘要与标签建议（标签点击走搜索）。 */
export function PiAnalysisBar({ clip, agentProviders, onSearchTag }: PiAnalysisBarProps) {
  const [analysis, setAnalysis] = useState<ClipPiAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const disabled = agentProviders.length === 0 || analyzing;

  const runAnalysis = async () => {
    if (analyzing) return;
    setAnalyzing(true);
    setError(null);
    try {
      const providerConfig = await resolveDefaultPiProvider();
      if (!providerConfig) {
        setError("尚未配置 Agent provider（设置 → MCP/Agent）");
        return;
      }
      setAnalysis(await analyzeClipWithPi(clip, providerConfig));
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="space-y-2 px-4 pt-2">
      <button
        aria-busy={analyzing}
        aria-label="AI 分析"
        className="flex h-7 items-center gap-1.5 rounded-md border border-border/60 px-2.5 text-[12px] text-foreground transition-colors hover:bg-black/[0.05] disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-white/[0.08]"
        data-pi-action="detail"
        disabled={disabled}
        onClick={() => void runAnalysis()}
        title={agentProviders.length === 0 ? "尚未配置 Agent provider" : "AI 分析（pi）"}
        type="button"
      >
        <ScanSearch size={12} />
        {analyzing ? "AI 分析中…" : "AI 分析"}
      </button>
      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/[0.04] p-3 text-[12px] text-destructive">
          {error}
        </div>
      ) : null}
      {analysis ? (
        <div className="rounded-lg border border-border/60 bg-background/95 p-3 shadow-sm">
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            AI 分析
          </div>
          <p className="text-[12px] leading-relaxed">{analysis.summary}</p>
          {analysis.tags.length ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {analysis.tags.map((tag) => (
                <button
                  className="rounded bg-black/[0.05] px-1.5 py-0.5 text-[11px] hover:bg-black/[0.09] dark:bg-white/[0.09] dark:hover:bg-white/[0.15]"
                  key={tag}
                  onClick={() => onSearchTag(tag)}
                  type="button"
                >
                  #{tag}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
