// 设置页通用控件组件集合。
// 从 src/settings.tsx 抽出，保持 props 签名不变，调用方无需改动。
// - SegmentSetting 已升级为 Animate UI ToggleGroup 原语（方向键导航 / roving focus / 滑动高亮由原语提供）。
// - Switch / Input / Slider 等常规表单控件使用 shadcn/ui 基础件，避免继续维护并行控件样式。

import { useId, type ReactNode } from "react";
import { Copy } from "lucide-react";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/animate-ui/components/animate/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/animate-ui/primitives/animate/tooltip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";

/** 设置分组容器：标题 + 内容体 */
export function SettingGroup({ children, title }: { children: ReactNode; title: string }) {
  return (
    <div className="setting-group">
      <h3>{title}</h3>
      <div className="setting-group-body">{children}</div>
    </div>
  );
}

/**
 * 单选分段控件。
 *
 * Inc3 升级：改用 Animate UI 的 ToggleGroup 原语（底层 Radix ToggleGroupPrimitive）。
 * - 方向键导航、roving focus、ARIA radiogroup 语义、滑动高亮动效全部由原语提供，无需手写 onKeyDown。
 * - 设置项不允许反选：onValueChange 收到空串（取消选中）时直接忽略。
 * - props 签名（label?/options/selected/onChange）保持不变，调用方无需改动。
 */
export function SegmentSetting<T extends string>({
  disabled = false,
  label,
  options,
  selected,
  onChange,
  probeId,
}: {
  disabled?: boolean;
  label?: string;
  options: Array<{ value: T; label: string }>;
  selected: T;
  onChange: (value: T) => void;
  probeId?: string;
}) {
  return (
    <div data-dev-probe={probeId}>
      <ToggleGroup
        aria-label={label}
        aria-disabled={disabled || undefined}
        value={selected}
        onValueChange={(value) => {
          // 设置项不允许反选：原语在取消选中时会回传空串，这里再次忽略，双重保险。
          if (value && !disabled) onChange(value as T);
        }}
      >
        {options.map((option) => (
          <ToggleGroupItem disabled={disabled} key={option.value} value={option.value}>
            {option.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

/** 数字输入控件 */
export function NumberSetting({
  disabled = false,
  label,
  value,
  min,
  max,
  onChange,
  probeId,
}: {
  disabled?: boolean;
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  probeId?: string;
}) {
  const inputId = useId();
  const hintId = `${inputId}-bounds`;
  const clamp = (next: number) => Math.min(max, Math.max(min, next));

  return (
    <div className="setting-row" data-dev-probe={probeId}>
      <Label htmlFor={inputId}>{label}</Label>
      <Input
        aria-describedby={hintId}
        className="setting-number-input"
        disabled={disabled}
        id={inputId}
        inputMode="numeric"
        max={max}
        min={min}
        onChange={(event) => {
          const next = Number(event.currentTarget.value);
          if (Number.isFinite(next)) onChange(clamp(next));
        }}
        type="number"
        value={value}
      />
      <small className="setting-number-bounds" id={hintId}>
        {min} - {max}
      </small>
    </div>
  );
}

/** 滑块控件（带数值后缀展示） */
export function SliderSetting({
  disabled = false,
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
  probeId,
}: {
  disabled?: boolean;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (value: number) => void;
  probeId?: string;
}) {
  const inputId = useId();
  const hintId = `${inputId}-bounds`;

  return (
    <div className="setting-row" data-dev-probe={probeId}>
      <Label htmlFor={inputId}>{label}</Label>
      <div className="slider-setting">
        <Slider
          aria-describedby={hintId}
          className="setting-slider-control"
          disabled={disabled}
          max={max}
          min={min}
          onValueChange={([next]) => {
            if (Number.isFinite(next)) onChange(next);
          }}
          step={step ?? 1}
          value={[value]}
        />
        <span>
          {value}
          {suffix}
        </span>
      </div>
      <small className="setting-number-bounds" id={hintId}>
        {min} - {max}
        {suffix}
      </small>
    </div>
  );
}

/** 只读字段：用于路径、只读状态和可复制配置值。 */
export function ReadonlyField({
  label,
  value,
  description,
  copyLabel,
  onCopy,
}: {
  label: string;
  value: string;
  description?: string;
  copyLabel: string;
  onCopy: (label: string, value: string) => void;
}) {
  const fieldId = useId();
  const disabled = value.length === 0;

  return (
    <div className="setting-row readonly-field">
      <Label htmlFor={fieldId}>{label}</Label>
      <Tooltip side="top" sideOffset={8}>
        <TooltipTrigger asChild>
          <code className="readonly-field-value path" id={fieldId} tabIndex={disabled ? undefined : 0}>
            {value || "-"}
          </code>
        </TooltipTrigger>
        <TooltipContent className="settings-tooltip-content">
          {value || "-"}
        </TooltipContent>
      </Tooltip>
      {description ? <small className="readonly-field-description">{description}</small> : null}
      <Tooltip side="top" sideOffset={8}>
        <TooltipTrigger asChild>
          <Button
            aria-label={`${copyLabel}: ${label}`}
            className="readonly-field-copy"
            disabled={disabled}
            onClick={() => onCopy(label, value)}
            size="sm"
            type="button"
            variant="outline"
          >
            <Copy size={13} />
            {copyLabel}
          </Button>
        </TooltipTrigger>
        <TooltipContent className="settings-tooltip-content">
          {copyLabel}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

/** 开关按钮控件 */
export function ToggleSetting({
  checked,
  disabled = false,
  label,
  onChange,
  probeId,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
  probeId?: string;
}) {
  const switchId = useId();

  return (
    <div className="setting-row" data-dev-probe={probeId}>
      <Label htmlFor={switchId}>{label}</Label>
      <Switch
        checked={checked}
        disabled={disabled}
        id={switchId}
        onCheckedChange={onChange}
      />
    </div>
  );
}

/** 内容识别能力说明卡片 */
export function CheckItem({ body, icon, title }: { body: string; icon: ReactNode; title: string }) {
  return (
    <div className="check-item">
      <span className="check-item-icon">{icon}</span>
      <div>
        <strong>{title}</strong>
        <p>{body}</p>
      </div>
    </div>
  );
}
