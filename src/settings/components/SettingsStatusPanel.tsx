import { useState, type ComponentType, type ReactNode } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";

/** 设置状态面板的语义状态：只影响提示强度，不承载业务判断。 */
export type SettingsStatusPanelState = "neutral" | "good" | "warning" | "danger" | "pending";

/** 设置状态面板的只读键值项，用于展示诊断、路径、版本等辅助信息。 */
export type SettingsStatusPanelItem = {
  label: string;
  value: ReactNode;
};

/** 设置状态面板动作：允许同步或异步执行，错误在面板内兜底展示。 */
export type SettingsStatusPanelAction = {
  label: string;
  onClick: () => void | Promise<void>;
  icon?: ComponentType<{ size?: number; className?: string }>;
  variant?: "primary" | "secondary" | "diagnostic" | "destructive";
  disabled?: boolean;
  tooltip?: string;
  ariaLabel?: string;
  probeId?: string;
};

/** 设置状态面板参数：统一权限、更新、诊断等设置页状态块的展示结构。 */
export type SettingsStatusPanelProps = {
  title: string;
  status: string;
  description?: ReactNode;
  state?: SettingsStatusPanelState;
  items?: SettingsStatusPanelItem[];
  actions?: SettingsStatusPanelAction[];
  children?: ReactNode;
  probeId?: string;
};

function formatPanelActionError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

const stateStyles: Record<SettingsStatusPanelState, string> = {
  neutral: "bg-black/[0.03] dark:bg-white/[0.05]",
  good: "bg-black/[0.03] dark:bg-white/[0.05]",
  warning: "bg-black/[0.03] dark:bg-white/[0.05]",
  danger: "bg-black/[0.03] dark:bg-white/[0.05]",
  pending: "bg-black/[0.03] dark:bg-white/[0.05]",
};

/** 设置状态面板：统一承载权限、更新、诊断等只读状态和动作分类。 */
export function SettingsStatusPanel({
  title,
  status,
  description,
  state = "neutral",
  items = [],
  actions = [],
  children,
  probeId,
}: SettingsStatusPanelProps) {
  const [actionError, setActionError] = useState<string | null>(null);
  const runAction = (action: SettingsStatusPanelAction) => {
    setActionError(null);
    try {
      const result = action.onClick();
      void Promise.resolve(result).catch((error) => {
        setActionError(formatPanelActionError(error));
      });
    } catch (error) {
      setActionError(formatPanelActionError(error));
    }
  };

  return (
    <section
      className={`rounded-lg p-4 ${stateStyles[state]}`}
      aria-label={title}
      data-dev-probe={probeId}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-[13px] font-medium text-foreground">{title}</h3>
          <p className="mono mt-0.5 text-[11px] text-muted-foreground">{status}</p>
          {description ? (
            <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">{description}</p>
          ) : null}
        </div>
      </div>

      {items.length > 0 ? (
        <dl className="mt-3 space-y-1.5 border-t border-black/[0.04] pt-3 dark:border-white/[0.06]">
          {items.map((item) => (
            <div className="flex items-center justify-between gap-4" key={item.label}>
              <dt className="text-[12px] text-muted-foreground">{item.label}</dt>
              <dd className="min-w-0 truncate text-right text-[12px]">{item.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {children ? <div className="mt-3 border-t border-black/[0.04] pt-3 dark:border-white/[0.06]">{children}</div> : null}

      {actions.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-black/[0.04] pt-3 dark:border-white/[0.06]">
          {actions.map((action) => {
            const Icon = action.icon;
            const variant = action.variant === "primary" ? "default" : action.variant === "destructive" ? "destructive" : action.variant === "diagnostic" ? "secondary" : "outline";
            const button = (
              <Button
                aria-label={action.ariaLabel ?? action.label}
                className="h-7 gap-1.5 rounded-md text-[12px]"
                data-dev-probe={action.probeId}
                disabled={action.disabled}
                onClick={() => runAction(action)}
                size="sm"
                variant={variant}
              >
                {Icon ? <Icon size={13} /> : null}
                {action.label}
              </Button>
            );

            return action.tooltip ? (
              <Tooltip key={action.label}>
                <TooltipTrigger asChild>
                  <span className="inline-flex">{button}</span>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={8}>{action.tooltip}</TooltipContent>
              </Tooltip>
            ) : (
              <span className="inline-flex" key={action.label}>
                {button}
              </span>
            );
          })}
          {actionError ? (
            <p className="w-full text-[11px] text-destructive" role="alert">
              {actionError}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
