/** 提示词快速优化器：对剪贴板里的提示词条目做单次 AI 重写。
 *  边界：只调用一次 piComplete（不引入 eval 循环）；provider 解析/降级/截断形态照抄
 *  `analysis.ts`——无配置或调用失败抛错，由调用方禁用按钮并引导去设置页。
 *  产物是 `EditorSuggestionResult` 信封（contentPatch preview → diff → 确认 → updateClipContent 写回），
 *  不新增写通道。 */
import { piComplete } from "./provider-config";
import type { AgentProviderConfig } from "./provider-config";
import type { EditorSuggestionResult } from "../../services/contracts";

/** 优化元提示常量（首版内置，便于后续手动迭代）。
 *  5-slot brief：角色 / 任务 / 约束 / 输出格式 / 示例。
 *  约束「只输出改写后的提示词本身」是为了让产出能直接进 contentPatch，
 *  不需要二次拆洗 markdown 代码块或前后缀说明。 */
export const PROMPT_OPTIMIZER_META_PROMPT = [
  "你是提示词工程专家，擅长把粗糙的提示词改写成结构清晰、可直接使用的指令。",
  "",
  "# 角色",
  "扮演资深 prompt engineer，按下面的任务与约束处理用户提交的提示词草稿。",
  "",
  "# 任务",
  "1. 识别原提示词的真实意图、目标读者与期望产出。",
  "2. 重写为包含「角色 / 任务 / 约束 / 输出格式 / 示例」五个部分的完整提示词；原草稿已覆盖的部分保留并补全，缺少的部分按意图补齐。",
  "3. 保持原有语言（中文进中文出，英文进英文出）；保留其中的占位符、变量和专有名词。",
  "4. 只做澄清与结构化，不改变任务目标，不新增原意图没有的功能。",
  "",
  "# 约束",
  "- 只输出改写后的提示词正文，不要输出解释、前后缀、markdown 代码块围栏。",
  "- 不编造用户没提供的上下文；信息不足时用「（待补充：…）」占位。",
  "- 长度控制在原文的 1～3 倍，避免堆砌空话。",
  "",
  "# 输出格式",
  "纯文本，五个部分各占一段，段首用「角色：」「任务：」「约束：」「输出格式：」「示例：」标注。",
  "",
  "# 示例",
  "输入：帮我写个周报",
  "输出：",
  "角色：你是我的写作助手，熟悉研发团队的周报规范。",
  "任务：根据我提供的本周工作记录，整理成一份周报。",
  "约束：只使用记录中的事实，不夸大；每项工作一句话，附量化结果（若有）。",
  "输出格式：按「本周完成 / 进行中 / 下周计划」三节输出，每节用无序列表。",
  "示例：（待补充：一条工作记录样例）",
].join("\n");

/** 单次优化的输入：原始提示词文本 + 运行时解析的 provider 配置。 */
export type PromptOptimizeInput = {
  /** 条目里的提示词草稿正文（调用方负责截断展示，这里只做长度保护）。 */
  content: string;
  providerConfig: AgentProviderConfig;
};

/** 单次优化的输出：改写后的提示词正文（未 trim 掉有意义空行外的空白）。 */
export type PromptOptimizeResult = {
  optimizedContent: string;
};

/** 输入截断上限：与 analysis.ts 的 4000 字同档，防止超长条目把请求撑爆。 */
const MAX_INPUT_CHARS = 4000;

/** 调用一次 pi 完成，返回改写后的提示词正文。
 *  provider 缺失或返回内容为空时抛错，交由调用方走禁用/引导设置页的降级形态。 */
export async function optimizePromptWithPi(
  input: PromptOptimizeInput,
): Promise<PromptOptimizeResult> {
  const content = input.content.slice(0, MAX_INPUT_CHARS).trim();
  if (!content) throw new Error("提示词内容为空，无法优化");

  const message = await piComplete({
    system: PROMPT_OPTIMIZER_META_PROMPT,
    prompt: `请优化以下提示词：\n\n${content}`,
    providerConfig: input.providerConfig,
  });

  const text = message.content
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n")
    .trim();
  if (!text) throw new Error("AI 优化返回为空");
  return { optimizedContent: text };
}

/** 把优化结果包成既有建议信封（与 buildLocalEditorSuggestion 同形的 contentPatch 形状），
 *  供详情页 draft-diff 预览 → 确认 → updateClipContent 写回，不新增写通道。 */
export function buildPromptOptimizerSuggestion(input: {
  sessionId: string;
  draftVersion: number;
  originalContent: string;
  optimizedContent: string;
}): EditorSuggestionResult {
  const optimized = input.optimizedContent.trim();
  return {
    id: `prompt_optimizer_${Date.now()}`,
    sessionId: input.sessionId,
    draftVersion: input.draftVersion,
    contentPatch:
      optimized && optimized !== input.originalContent
        ? {
            type: "replaceDocument" as const,
            preview: optimized.slice(0, 1600),
            replacement: optimized,
          }
        : undefined,
    rationale: "AI 已按 5-slot brief（角色/任务/约束/输出格式/示例）重写提示词；应用前不会写入数据库。",
    riskLevel: "medium",
  };
}
