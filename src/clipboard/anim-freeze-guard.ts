/** CSS 动画冻结守卫（仅 Tauri 运行时生效，浏览器预览不受影响）。
 *  背景：ClipForge 是后台 app（LSUIElement），NSPanel 非激活唤起时 WKWebView 会冻结
 *  CSS 动画/过渡时间轴，一切入场动画停在 from 帧——面板偏移+透明（panel-in）、
 *  toast 滑入卡在视口外（sonner）、行/预览卡隐形（row-in）。
 *  策略：注入一个探针 keyframes 实测时间轴是否推进；冻结时给 <html> 挂 cf-anim-frozen，
 *  把全部动画/过渡压到 0.01ms 即时完成（终帧即天然可见态，opacity 类动画终帧全可见）；
 *  解冻后摘除 class 恢复动效。唤起面板时复检（激活状态可能随用户操作变化）。
 *  边界：只读样式、无副作用导入；探针元素 visibility:hidden 不引发闪烁。 */
import { isTauriRuntime } from "./panel-shared";

let probeStyle: HTMLStyleElement | null = null;
let checkTimer: number | null = null;

/** 确保探针 keyframes 已注入（幂等）。 */
function ensureProbeStyle(): void {
  if (probeStyle?.isConnected) return;
  probeStyle = document.createElement("style");
  probeStyle.textContent =
    "@keyframes cf-anim-freeze-probe{from{transform:translateX(0)}to{transform:translateX(100px)}}";
  document.head.appendChild(probeStyle);
}

/** 实测一次动画时间轴：探针动画 100ms 后未推进即判定冻结，切换 <html> 冻结类。 */
export function checkAnimFreeze(): void {
  if (!isTauriRuntime()) return;
  ensureProbeStyle();
  const probe = document.createElement("div");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText =
    "position:fixed;left:-9999px;top:0;width:1px;height:1px;visibility:hidden;" +
    "animation:cf-anim-freeze-probe 0.1s linear forwards;";
  document.body.appendChild(probe);
  window.setTimeout(() => {
    // forwards 填充下完成态应为 translateX(100px)；时间轴冻结则停在 none/单位矩阵。
    const transform = window.getComputedStyle(probe).transform;
    const frozen = transform === "none" || transform === "matrix(1, 0, 0, 1, 0, 0)";
    document.documentElement.classList.toggle("cf-anim-frozen", frozen);
    probe.remove();
  }, 200);
}

/** 启动时安装守卫：立即检测一次 + 唤起面板时复检（showQuickPanel 调用）。 */
export function installAnimFreezeGuard(): void {
  if (!isTauriRuntime()) return;
  if (checkTimer !== null) window.clearTimeout(checkTimer);
  checkAnimFreeze();
  // 首检可能赶在 webview 尚未稳定渲染时，延迟补一枪降低误判（误判代价低：只是少动效）。
  checkTimer = window.setTimeout(() => {
    checkTimer = null;
    checkAnimFreeze();
  }, 1500);
}
