/** 提示词快速优化条（pi 底层）：按钮触发 → 单次 AI 重写 → 草稿进 diff 态确认写回。
 *  边界：provider 经 agent_resolve_pi_provider 运行时解析；无配置/失败禁用或报错条，
 *  与 PiAnalysisBar 同一门控形态。产物是 DetailDraft（内存草稿，不落库），
 *  确认写回走外壳既有 saveDraftContent → onUpdateContent → updateClipContent，
 *  不新增写通道。 */
import { Sparkles } from "lucide-react";
import { useState } from "react";
import { resolveDefaultPiProvider } from "../../agent/pi/analysis";
import { optimizePromptWithPi } from "../../agent/pi/prompt-optimizer";
import type { ClipItem } from "../../App";
import type { WorkspaceTr } from "./workspace-detail-shared";

export type PromptOptimizerBarProps = {
  clip: ClipItem;
  agentProviders: Array<Record<string, unknown>>;
  /** 产出草稿：由外壳写入 DetailDraft 并切 diff 态。 */
  onDraft: (content: string) => void;
  /** 运行态回调：插件区队列角标接线（running=true 入队 / false 完成）。 */
  onRunStateChange?: (running: boolean) => void;
  tr: WorkspaceTr;
  /** 展示形态：menu=插件下拉内嵌（零外距）。 */
  variant?: "menu";
};

/** 草稿来源插件 id（draft-diff 的 srcId，标注草稿出处）。 */
export const PROMPT_OPTIMIZER_DRAFT_SRC = "prompt.optimizer";

/** 提示词优化条：按钮触发 → 优化中 → 结果作为草稿进 diff 态。 */
export function PromptOptimizerBar({
  clip,
  agentProviders,
  onDraft,
  onRunStateChange,
  tr,
  variant = "menu",
}: PromptOptimizerBarProps) {
  const [optimizing, setOptimizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const disabled = agentProviders.length === 0 || optimizing;

  const runOptimize = async () => {
    if (optimizing) return;
    if (!clip.content.trim()) {
      setError(tr("main.detail.promptOptimizer.empty"));
      return;
    }
    setOptimizing(true);
    setError(null);
    onRunStateChange?.(true);
    try {
      const providerConfig = await resolveDefaultPiProvider();
      if (!providerConfig) {
        setError(tr("main.detail.pi.unconfigured"));
        return;
      }
      const result = await optimizePromptWithPi({
        content: clip.content,
        providerConfig,
      });
      onDraft(result.optimizedContent);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setOptimizing(false);
      onRunStateChange?.(false);
    }
  };

  return (
    <div className={variant === "menu" ? "space-y-2" : "space-y-2 px-4 pt-2"}>
      <button
        aria-busy={optimizing}
        aria-label={tr("main.detail.promptOptimizer.optimize")}
        className="flex h-7 items-center gap-1.5 rounded-md border border-border/60 px-2.5 text-[12px] text-foreground transition-[color,background-color,border-color,transform] hover:bg-black/[0.05] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-white/[0.08]"
        data-pi-action="prompt-optimizer"
        disabled={disabled}
        onClick={() => void runOptimize()}
        title={
          agentProviders.length === 0
            ? tr("main.detail.pi.unconfiguredTitle")
            : tr("main.detail.promptOptimizer.configuredTitle")
        }
        type="button"
      >
        <Sparkles size={12} />
        {optimizing
          ? tr("main.detail.promptOptimizer.optimizing")
          : tr("main.detail.promptOptimizer.optimize")}
      </button>
      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/[0.04] p-3 text-[12px] text-destructive">
          {error}
        </div>
      ) : null}
    </div>
  );
}
