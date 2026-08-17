// DSH 独立悬浮窗前端入口（独立于剪贴板主窗）。
//
// 复用剪贴板窗体的悬浮逻辑与能力：Rust 侧经 NSPanel status-level 浮动把本窗口
// 悬浮于其他应用之上；失焦自动隐藏（window blur → hideDshWindow）与固定(pinned)
// 由 Rust 侧统一处理，与剪贴板浮窗行为完全一致。这样能在任意应用之上快速弹出
// 使用 DeepSeek Harness 的 Agent 能力。
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DshPanel } from "./dsh/dsh-panel";
import { resolveAppLocale, t } from "./i18n";
import type { TranslationKey } from "./i18n";
import { hideDshWindow } from "./agent/dsh-analysis";

const root = document.getElementById("root");
if (root) {
  const locale = resolveAppLocale("system");
  const tr = (key: TranslationKey, params?: Record<string, string | number>) =>
    t(locale, key, params);
  createRoot(root).render(
    <StrictMode>
      <DshPanel onClose={() => hideDshWindow()} tr={tr} />
    </StrictMode>,
  );

  // 复用剪贴板窗体的失焦自动隐藏能力：本窗口失焦（用户切到其他 App）时隐藏 DSH 浮窗。
  window.addEventListener("blur", () => {
    void hideDshWindow();
  });
}
