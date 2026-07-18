import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type SettingsStickyStatusBarProps = {
  primary: ReactNode;
  secondary?: ReactNode;
  state?: "idle" | "pending" | "saved" | "error";
};

/** 设置内容区底部状态条：保留保存反馈、后台命令状态和配置同步状态的稳定位置。 */
export function SettingsStickyStatusBar({
  primary,
  secondary,
  state = "idle",
}: SettingsStickyStatusBarProps) {
  return (
    <div
      className={cn(
        "sticky bottom-[-16px] z-10 mt-auto flex min-h-8 items-center justify-between gap-3 border-t border-slate-200 bg-white/95 px-0 pt-2 text-xs leading-4 text-slate-500 backdrop-blur",
        state === "pending" && "text-slate-700",
        state === "saved" && "text-emerald-700",
        state === "error" && "text-red-700",
      )}
      role={state === "error" ? "alert" : "status"}
    >
      <div className="min-w-0 truncate text-slate-900">{primary}</div>
      {secondary ? <div className="min-w-0 truncate text-slate-500">{secondary}</div> : null}
    </div>
  );
}
