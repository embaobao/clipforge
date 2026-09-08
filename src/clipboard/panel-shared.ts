/** 快速面板共享桥接：模块级日志与 DSH 分析入口（主体与子组件共用，不挂在组件作用域内）。 */
import { invoke } from "@tauri-apps/api/core";
import type { ClipItem } from "../App";
import { analyzeClipboard, type DshAnalyzeResult } from "../agent/dsh-analysis";

/** 结构化前端日志：写 Tauri append_app_log（截断 8KB），error 级别同时落 console。 */
export function logAppError(level: "info" | "warn" | "error", message: string, context?: unknown) {
  const contextText =
    typeof context === "string" ? context : context ? JSON.stringify(context).slice(0, 8000) : "";
  invoke("append_app_log", { level, message, context: contextText }).catch(() => {
    if (level === "error") console.error(message, context);
  });
}

/** DSH 只读快速分析入口（详情页与右键菜单共用）：失败降级为 undefined，不抛错打断交互。 */
export async function analyzeClipboardWithDsh(item: ClipItem): Promise<DshAnalyzeResult | void> {
  try {
    const result = await analyzeClipboard(item.content ?? "", {});
    return result;
  } catch (error) {
    console.warn("dsh-analysis: invoke failed", error);
    return undefined;
  }
}
