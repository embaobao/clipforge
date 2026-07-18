import type { ComponentType, ReactNode } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/animate-ui/primitives/animate/tooltip";

export type SettingsStatusPanelState = "neutral" | "good" | "warning" | "danger" | "pending";

export type SettingsStatusPanelItem = {
  label: string;
  value: ReactNode;
};

export type SettingsStatusPanelAction = {
  label: string;
  onClick: () => void;
  icon?: ComponentType<{ size?: number; className?: string }>;
  variant?: "primary" | "secondary" | "diagnostic" | "destructive";
  disabled?: boolean;
  tooltip?: string;
  ariaLabel?: string;
  probeId?: string;
};

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
                onClick={action.onClick}
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
        </div>
      ) : null}
    </section>
  );
}
