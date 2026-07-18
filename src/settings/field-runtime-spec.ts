// 字段运行时约束表（frontend-surface-architecture-refactor Phase E）
// catalog 只描述「UI 放置 + 控件类型 + 文案 key + 排序」，不承载 schema；
// min/max/step/suffix/options 等写入边界集中在此处维护，供 SettingsField 分派器读取。
// Phase E 首批只覆盖已从 settings.tsx 调用处核对过 bounds 的字段；更多 tab 切到 catalog 驱动时按需补齐。
import type { TranslationKey } from "@/i18n";

/** 单个字段的运行时约束。 */
export type FieldRuntimeSpec = {
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  /** segment 字段的选项：value + 文案 key（渲染时由分派器翻译成 label）。 */
  options?: Array<{ value: string; labelKey: TranslationKey }>;
};

/**
 * 字段运行时约束表，key 为 SettingFieldConfig.id。
 * 当前只登记已核对 bounds 的 number/slider 字段；switch 无约束，segment 的 options 待对应 tab 接入时补。
 */
export const FIELD_RUNTIME_SPEC: Record<string, FieldRuntimeSpec> = {
  // storage-logs / logs（已核对 settings.tsx 调用处）
  logMaxSizeMb: { min: 1, max: 1024 },
  logMaxLines: { min: 1000, max: 1000000 },
  logCleanupIntervalMin: { min: 1, max: 1440 },
};
