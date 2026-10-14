// 引导窗口标准化日志（onboarding-window 模块）：onboarding.open/step/complete/permission.check 四事件。
// 边界：只记事件摘要（步骤 key、权限 status、耗时），不记设置值原文、权限 token 或剪贴板正文；
// 失败静默（append_app_log 不可用时不阻塞引导流程），与性能采样（performance-smoke）互不依赖。
import { invoke } from "@tauri-apps/api/core";

export type OnboardingLogEvent =
  | "onboarding.open"
  | "onboarding.step"
  | "onboarding.complete"
  | "onboarding.permission.check";

/** 记录引导窗口事件摘要（info 级），message 即事件 key，context 携带步骤/状态等非敏感元数据。 */
export function logOnboardingEvent(
  event: OnboardingLogEvent,
  meta?: Record<string, string | number | boolean>,
) {
  void invoke("append_app_log", {
    level: "info",
    message: event,
    context: meta ? JSON.stringify(meta).slice(0, 2000) : "",
  }).catch(() => {
    /* 日志通道不可用时静默：日志是辅助面，不阻塞引导主链路 */
  });
}
