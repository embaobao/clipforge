// 设置字段批量行（frontend-surface-architecture-refactor Phase E）
// 按 section+tab 过滤 SETTINGS_FIELD_CATALOG、排除复杂类型（action/code/readonly）、按 order 排序后，
// 用 SettingsField 分派器批量渲染 catalog 驱动字段；末尾追加 extraNodes（非 catalog 的 info 卡、CheckItem 等）。
// catalog 驱动是动态分派，values 用宽松索引类型在边界接收，调用点 cast 一次。
import type { ReactNode } from "react";
import type { TranslationKey } from "@/i18n";
import {
  SETTINGS_FIELD_CATALOG,
  type SettingFieldConfig,
  type SettingsSectionId,
  type SettingsTabId,
} from "../settings-field-catalog";
import { FIELD_RUNTIME_SPEC } from "../field-runtime-spec";
import { SettingsField } from "./SettingsField";

export interface SettingsFieldRowProps {
  section: SettingsSectionId;
  tab: SettingsTabId;
  /** 当前设置值；动态分派边界用宽松索引类型，调用点 cast。 */
  values: Record<string, unknown>;
  /** 字段写回：key 为 settingsKey（缺省回退 id）。 */
  onChange: (key: string, value: boolean | number | string) => void;
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
  /** 非 catalog 字段的补充内容（info 卡、CheckItem 等），渲染在字段之后。 */
  extraNodes?: ReactNode[];
}

// 显式按基类类型消费 catalog，避免 `as const` 字面量类型导致 settingsKey 等可选字段不可访问。
const CATALOG: readonly SettingFieldConfig[] = SETTINGS_FIELD_CATALOG;
// 这些类型可由分派器直接驱动；action/code/readonly/toggle(legacy) 由调用方手写。
const DRIVEN_TYPES = new Set<string>(["switch", "number", "slider", "segment"]);

/** 批量渲染某个 section/tab 下的 catalog 驱动字段 + extraNodes。 */
export function SettingsFieldRow({ section, tab, values, onChange, tr, extraNodes }: SettingsFieldRowProps) {
  const fields = CATALOG.filter(
    (field) => field.section === section && field.tab === tab && DRIVEN_TYPES.has(field.type),
  ).sort((a, b) => a.order - b.order);
  return (
    <>
      {fields.map((field) => {
        const key = field.settingsKey ?? field.id;
        return (
          <SettingsField
            field={field}
            key={field.id}
            onChange={(next) => onChange(key, next)}
            spec={FIELD_RUNTIME_SPEC[field.id]}
            tr={tr}
            value={(values[key] ?? "") as boolean | number | string}
          />
        );
      })}
      {extraNodes}
    </>
  );
}

export default SettingsFieldRow;
