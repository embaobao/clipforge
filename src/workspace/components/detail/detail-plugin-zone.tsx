/** 详情页插件区装配（tags 行右侧 ⌕ 下拉）：内置 AI 功能（pi 分析条 + 提示词优化条）+ 队列角标。
 *  边界：只做宿主 UI 装配与插件队列状态机（并发上限见 PLUGIN_QUEUE_CONCURRENCY）；
 *  AI 本体在 src/agent/pi/，草稿产出经 onDraft 交回主壳（主壳持有 DetailDraft 与三态）。
 *  从 ClipDetailWorkspace 拆出以满足单文件 ≤500 行规范。 */
import { useCallback } from "react";
import { PiAnalysisBar } from "../PiAnalysisBar";
import { PROMPT_OPTIMIZER_DRAFT_SRC, PromptOptimizerBar } from "../PromptOptimizerBar";
import type { ClipItem } from "../../../App";
import type { WorkspaceTr } from "../workspace-detail-shared";
import { PluginZone, type PluginQueueTask } from "./plugin-zone";

export type DetailPluginZoneProps = {
  clip: ClipItem;
  agentProviders: Array<Record<string, unknown>>;
  queue: PluginQueueTask[];
  runningCount: number;
  tr: WorkspaceTr;
  onQueueChange: (next: PluginQueueTask[]) => void;
  onApplyTags?: (clipId: string, tags: string[]) => void;
  onSearchTag: (tag: string) => void;
  /** 提示词优化器产出草稿内容（主壳写入 DetailDraft 并切 diff 态）。 */
  onDraft: (content: string) => void;
};

/** 插件区装配：pi 分析 + 提示词优化两个内置 AI 功能共用一份插件队列。 */
export function DetailPluginZone({
  clip,
  agentProviders,
  queue,
  runningCount,
  tr,
  onQueueChange,
  onApplyTags,
  onSearchTag,
  onDraft,
}: DetailPluginZoneProps) {
  // 队列任务用插件 id 幂等增删：running=true 入队 / false 标记完成（角标只数 running）。
  const makeRunStateHandler = useCallback(
    (taskId: string, label: string) =>
      (running: boolean) => {
        onQueueChange(
          running
            ? [...queue.filter((task) => task.id !== taskId), { id: taskId, label, status: "running" }]
            : [...queue.filter((task) => task.id !== taskId), { id: taskId, label, status: "done" }],
        );
      },
    [onQueueChange, queue],
  );

  const handlePiRunState = makeRunStateHandler("pi.analyze", "AI 分析");
  const handlePromptOptimizerRunState = makeRunStateHandler(PROMPT_OPTIMIZER_DRAFT_SRC, "提示词优化");

  return (
    <PluginZone
      aiSection={
        <div className="space-y-2">
          <PiAnalysisBar
            agentProviders={agentProviders}
            clip={clip}
            onApplyTags={onApplyTags}
            onRunStateChange={handlePiRunState}
            onSearchTag={onSearchTag}
            tr={tr}
            variant="menu"
          />
          <PromptOptimizerBar
            agentProviders={agentProviders}
            clip={clip}
            onDraft={onDraft}
            onRunStateChange={handlePromptOptimizerRunState}
            tr={tr}
            variant="menu"
          />
        </div>
      }
      queue={queue}
      runningCount={runningCount}
      tr={tr}
    />
  );
}
