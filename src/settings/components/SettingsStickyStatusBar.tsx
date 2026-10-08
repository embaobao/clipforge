import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type SettingsStickyStatusBarProps = {
  primary: ReactNode;
  secondary?: ReactNode;
  state?: "idle" | "pending" | "saved" | "error";
};

/**
 * 设置内容区底部状态条：保留保存反馈、后台命令状态和配置同步状态的稳定位置。
 * 视觉上不画分割线，用留白（pt-3）与半透明毛玻璃背景分隔滚动内容；
 * 状态文案使用语义 token，避免 slate 硬编码色在暗色模式下失效。
 */
export function SettingsStickyStatusBar({
  primary,
  secondary,
  state = "idle",
}: SettingsStickyStatusBarProps) {
  return (
    <div
      className={cn(
        "sticky bottom-[-16px] z-10 mt-auto flex min-h-8 items-center justify-between gap-3 rounded-md bg-card/95 px-1 pt-3 text-xs leading-4 text-muted-foreground backdrop-blur-sm",
        state === "pending" && "text-foreground",
        state === "saved" && "text-emerald-700 dark:text-emerald-400",
        state === "error" && "text-destructive",
      )}
      role={state === "error" ? "alert" : "status"}
    >
      <div className="min-w-0 truncate text-foreground/90">{primary}</div>
      {secondary ? <div className="min-w-0 truncate">{secondary}</div> : null}
    </div>
  );
}
