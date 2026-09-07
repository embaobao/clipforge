// 设置页通用控件组件集合。
// 按 design.md 规格 7：label 13px + desc 11.5px muted 居左，控件居右，行间发丝线 4%。
// 使用 shadcn/ui 基础件，避免继续维护并行控件样式。

import { useId, type ReactNode } from "react";
import { Copy } from "lucide-react";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";

/** 设置分组容器：标题 + 内容体 */
export function SettingGroup({ children, title }: { children: ReactNode; title: string }) {
  return (
    <div className="mb-6 last:mb-0">
      <h3 className="mb-2 text-[11px] font-medium text-muted-foreground">{title}</h3>
      <div className="divide-y divide-black/[0.04] rounded-lg dark:divide-white/[0.06]">{children}</div>
    </div>
  );
}

/**
 * 单选分段控件。
 * 设置项不允许反选：onValueChange 收到空串（取消选中）时直接忽略。
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
    <div className="flex items-center justify-between gap-8 py-3" data-dev-probe={probeId}>
      <span className="text-[13px]">{label}</span>
      <ToggleGroup
        type="single"
        aria-label={label}
        aria-disabled={disabled || undefined}
        className="gap-0 rounded-lg bg-black/[0.04] p-0.5 dark:bg-white/[0.07]"
        value={selected}
        onValueChange={(value: T) => {
          if (value && !disabled) onChange(value);
        }}
      >
        {options.map((option) => (
          <ToggleGroupItem
            className="h-6 rounded-[7px] px-2.5 text-[12px] data-[state=on]:bg-white data-[state=on]:text-foreground data-[state=on]:shadow-sm dark:data-[state=on]:bg-white/[0.14]"
            disabled={disabled}
            key={option.value}
            value={option.value}
          >
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
  const clamp = (next: number) => Math.min(max, Math.max(min, next));

  return (
    <div className="flex items-center justify-between gap-8 py-3" data-dev-probe={probeId}>
      <div className="min-w-0">
        <Label htmlFor={inputId} className="text-[13px]">
          {label}
        </Label>
        <p className="mt-0.5 text-[11.5px] text-muted-foreground">
          {min} - {max}
        </p>
      </div>
      <Input
        className="h-7 w-24 rounded-md text-[13px]"
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

  return (
    <div className="flex items-center justify-between gap-8 py-3" data-dev-probe={probeId}>
      <div className="min-w-0">
        <Label htmlFor={inputId} className="text-[13px]">
          {label}
        </Label>
        <p className="mt-0.5 text-[11.5px] text-muted-foreground">
          {min} - {max}
          {suffix}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Slider
          aria-describedby={`${inputId}-bounds`}
          className="w-36"
          disabled={disabled}
          id={inputId}
          max={max}
          min={min}
          onValueChange={([next]) => {
            if (Number.isFinite(next)) onChange(next);
          }}
          step={step ?? 1}
          value={[value]}
        />
        <span className="mono w-16 text-right text-[11.5px] text-muted-foreground">
          {value}
          {suffix}
        </span>
      </div>
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
    <div className="flex items-center justify-between gap-8 py-3">
      <div className="min-w-0">
        <Label htmlFor={fieldId} className="text-[13px]">
          {label}
        </Label>
        {description ? (
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <code className="mono max-w-[220px] truncate rounded-md bg-black/[0.04] px-2 py-1 text-[11.5px] dark:bg-white/[0.08]" id={fieldId} tabIndex={disabled ? undefined : 0}>
              {value || "-"}
            </code>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={8}>
            {value || "-"}
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label={`${copyLabel}: ${label}`}
              className="h-7 w-7 rounded-md"
              disabled={disabled}
              onClick={() => onCopy(label, value)}
              size="icon-sm"
              type="button"
              variant="outline"
            >
              <Copy className="h-3 w-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={8}>
            {copyLabel}
          </TooltipContent>
        </Tooltip>
      </div>
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
    <div className="flex items-center justify-between gap-8 py-3" data-dev-probe={probeId}>
      <div className="min-w-0">
        <Label htmlFor={switchId} className="text-[13px]">
          {label}
        </Label>
      </div>
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
    <div className="flex gap-3 rounded-lg bg-black/[0.03] p-3 dark:bg-white/[0.05]">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[7px] bg-black/[0.04] text-muted-foreground dark:bg-white/[0.07]">
        {icon}
      </span>
      <div className="min-w-0">
        <strong className="text-[13px]">{title}</strong>
        <p className="mt-0.5 text-[11.5px] text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}
