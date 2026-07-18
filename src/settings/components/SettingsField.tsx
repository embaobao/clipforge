// 设置字段分派器（frontend-surface-architecture-refactor Phase E）
// 读 SettingFieldConfig.type，把统一接口 (field + value + onChange + spec) 路由到对应 controls 控件。
// action / code / readonly 等复杂面板不在此分派（调用方手写），返回 null。
// 字段适配层目前直接复用 controls.tsx 原语；若某类型需要独立状态/交互，再按 design.md 拆到 src/settings/fields/*Field.tsx。
import type { TranslationKey } from "@/i18n";
import type { SettingFieldConfig } from "../settings-field-catalog";
import type { FieldRuntimeSpec } from "../field-runtime-spec";
import { NumberSetting, SegmentSetting, SliderSetting, ToggleSetting } from "../controls";

export interface SettingsFieldProps {
  /** 字段目录条目。 */
  field: SettingFieldConfig;
  /** 当前值（switch→boolean，number/slider→number，segment→string）。 */
  value: boolean | number | string;
  /** 值变更回调。 */
  onChange: (next: boolean | number | string) => void;
  /** 运行时约束（min/max/options 等），来自 FIELD_RUNTIME_SPEC。 */
  spec?: FieldRuntimeSpec;
  /** i18n 翻译函数。 */
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
  disabled?: boolean;
}

/**
 * 单字段分派器。按 field.type 渲染对应控件：
 * switch→ToggleSetting、number→NumberSetting、slider→SliderSetting、segment→SegmentSetting；
 * 其它（toggle legacy / action / code / readonly）返回 null，由调用方手写。
 */
export function SettingsField({ field, value, onChange, spec, tr, disabled }: SettingsFieldProps) {
  const label = tr(field.labelKey);
  switch (field.type) {
    case "switch":
      return <ToggleSetting checked={value as boolean} disabled={disabled} label={label} onChange={onChange} />;
    case "number":
      return (
        <NumberSetting
          disabled={disabled}
          label={label}
          max={spec?.max ?? Number.MAX_SAFE_INTEGER}
          min={spec?.min ?? 0}
          onChange={onChange}
          value={value as number}
        />
      );
    case "slider":
      return (
        <SliderSetting
          disabled={disabled}
          label={label}
          max={spec?.max ?? 100}
          min={spec?.min ?? 0}
          onChange={onChange}
          step={spec?.step}
          suffix={spec?.suffix}
          value={value as number}
        />
      );
    case "segment": {
      const options = (spec?.options ?? []).map((option) => ({
        value: option.value,
        label: tr(option.labelKey),
      }));
      return (
        <SegmentSetting
          disabled={disabled}
          label={label}
          onChange={onChange}
          options={options}
          selected={value as string}
        />
      );
    }
    default:
      // toggle（legacy）/ action / code / readonly：复杂或派生字段，由调用方手写渲染。
      return null;
  }
}

export default SettingsField;
