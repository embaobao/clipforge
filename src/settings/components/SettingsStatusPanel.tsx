import { useState, type ComponentType, type ReactNode } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/animate-ui/primitives/animate/tooltip";

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
    <section className={`settings-status-panel ${state}`} aria-label={title} data-dev-probe={probeId}>
      <div className="settings-status-panel-main">
        <span className="settings-status-panel-title">{title}</span>
        <strong>{status}</strong>
        {description ? <p>{description}</p> : null}
      </div>

      {items.length > 0 ? (
        <dl className="settings-status-panel-items">
          {items.map((item) => (
            <div className="settings-status-panel-item" key={item.label}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {children ? <div className="settings-status-panel-extra">{children}</div> : null}

      {actions.length > 0 ? (
        <div className="settings-status-panel-actions">
          {actions.map((action) => {
            const Icon = action.icon;
            const button = (
              <button
                className={`settings-action-button ${action.variant ?? "secondary"}`}
                data-dev-probe={action.probeId}
                disabled={action.disabled}
                onClick={() => runAction(action)}
                aria-label={action.ariaLabel ?? action.label}
                type="button"
              >
                {Icon ? <Icon size={13} /> : null}
                {action.label}
              </button>
            );

            return action.tooltip ? (
              <Tooltip key={action.label} side="top" sideOffset={8}>
                <TooltipTrigger asChild>
                  <span
                    aria-disabled={action.disabled || undefined}
                    aria-label={action.tooltip}
                    className="settings-status-panel-action-wrap"
                  >
                    {button}
                  </span>
                </TooltipTrigger>
                <TooltipContent className="settings-tooltip-content">{action.tooltip}</TooltipContent>
              </Tooltip>
            ) : (
              <span className="settings-status-panel-action-wrap" key={action.label}>
                {button}
              </span>
            );
          })}
          {actionError ? (
            <p className="settings-status-panel-error" role="alert">
              {actionError}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
