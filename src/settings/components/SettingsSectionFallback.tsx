// 设置/引导 section 兜底态组件：loading / error / permission-missing / empty 四态统一展示。
// 边界：纯展示不携带业务状态；文案与动作由调用方注入（i18n 留在调用方），动作按钮可缺省；
// 供设置窗口 section 与引导窗口复用，异常隔离本身由 SettingsErrorBoundary 负责。
import type { ReactNode } from "react";
import { AlertTriangle, Inbox, Loader2, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";

export type SettingsSectionFallbackTone = "loading" | "error" | "permission-missing" | "empty";

export interface SettingsSectionFallbackProps {
  /** 兜底类型：决定默认图标与语义色。 */
  tone: SettingsSectionFallbackTone;
  /** 主文案（一句话说明当前态）。 */
  title: string;
  /** 补充描述（可缺省）。 */
  description?: string;
  /** 动作按钮文案（提供时显示按钮，如「重试」）。 */
  actionLabel?: string;
  /** 动作按钮回调。 */
  onAction?: () => void;
  /** 覆盖默认图标。 */
  icon?: ReactNode;
  className?: string;
}

const TONE_META: Record<
  SettingsSectionFallbackTone,
  { icon: ReactNode; wrapper: string }
> = {
  loading: {
    icon: <Loader2 className="animate-spin" size={20} />,
    wrapper: "text-muted-foreground",
  },
  error: {
    icon: <AlertTriangle size={20} />,
    wrapper: "text-destructive",
  },
  "permission-missing": {
    icon: <ShieldAlert size={20} />,
    wrapper: "text-amber-600 dark:text-amber-400",
  },
  empty: {
    icon: <Inbox size={20} />,
    wrapper: "text-muted-foreground",
  },
};

/** 四态兜底：居中图标 + 标题 + 描述 + 可选动作，宽度自适应父容器。 */
export function SettingsSectionFallback({
  tone,
  title,
  description,
  actionLabel,
  onAction,
  icon,
  className,
}: SettingsSectionFallbackProps) {
  const meta = TONE_META[tone];
  return (
    <div
      className={cn("flex flex-col items-center justify-center gap-2 px-6 py-10 text-center", className)}
      data-fallback-tone={tone}
      role={tone === "error" ? "alert" : tone === "loading" ? "status" : undefined}
    >
      <span className={cn("flex h-10 w-10 items-center justify-center", meta.wrapper)}>
        {icon ?? meta.icon}
      </span>
      <p className="text-[13px] font-medium text-foreground">{title}</p>
      {description ? (
        <p className="max-w-[360px] text-[12px] leading-relaxed text-muted-foreground">{description}</p>
      ) : null}
      {actionLabel && onAction ? (
        <button
          className="mt-1 inline-flex h-7 items-center rounded-md border border-border/60 px-3 text-[12px] text-foreground transition-colors hover:bg-black/[0.05] active:scale-[0.98] dark:hover:bg-white/[0.08]"
          onClick={onAction}
          type="button"
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

export default SettingsSectionFallback;
