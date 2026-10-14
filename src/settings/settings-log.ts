// 设置窗口标准化日志（settings-window 模块）：settings.changed / settings.fallback.shown 事件摘要。
// 边界：只记事件名与路径计数等摘要，不记设置值原文；性能采样（settings.section/settings.changed）
// 已由 performance-smoke 覆盖，本模块只补事件流水，append_app_log 不可用时静默。
import { invoke } from "@tauri-apps/api/core";

export type SettingsLogEvent = "settings.changed" | "settings.fallback.shown";

/** 记录设置窗口事件摘要（info 级），message 即事件 key，context 携带非敏感元数据。 */
export function logSettingsEvent(
  event: SettingsLogEvent,
  meta?: Record<string, string | number | boolean>,
) {
  void invoke("append_app_log", {
    level: "info",
    message: event,
    context: meta ? JSON.stringify(meta).slice(0, 2000) : "",
  }).catch(() => {
    /* 日志通道不可用时静默：日志是辅助面，不阻塞设置主链路 */
  });
}
