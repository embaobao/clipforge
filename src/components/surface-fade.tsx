// 路由切换入场过渡容器（Phase 3 surface 过渡）
// 以 key=路由名重挂载触发 tailwindcss-animate 入场：fade + translateY(4px)，
// 时长/缓动走 motion token（duration-surface / ease-enter），只动 opacity/transform；
// 无退出动画——路由切换退出即切，避免双阶段延迟。
// 边界：必须 h-full——本节点插在 section（grid 定高行）与虚拟列表之间的高度链上，
// 少了它列表容器会退化为内容高、虚拟窗口失约（T15 曾因此挂）。
import type { ReactNode } from "react";

export interface SurfaceFadeProps {
  /** 路由标识；变化时整棵子树重挂载并重放入场动画。 */
  routeKey: string;
  children: ReactNode;
}

/** workspace 路由子树（list/detail/aggregate）统一的入场过渡包装。 */
export function SurfaceFade({ routeKey, children }: SurfaceFadeProps) {
  return (
    <div
      key={routeKey}
      className="h-full animate-in fade-in-0 slide-in-from-top-1 duration-surface ease-enter"
    >
      {children}
    </div>
  );
}
