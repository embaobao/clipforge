/** 聚合拼接格式的本地持久化（TASK-6-A）：模板 = 分隔符/编号/顺序的可存组合。
 *  存储键沿用 clipforge.* 前缀；localStorage 不可用（隐私模式/配额）时降级为内存默认值，
 *  与 panel-settings / analysis-history 的既有宽松读取策略一致。 */
import { DEFAULT_AGGREGATE_FORMAT, type AggregateFormatOptions } from "./clipboard-domain";

const STORAGE_KEY = "clipforge.aggregate.format";

/** 宽松校验：任意字段缺失或非法都回落默认值，坏数据不阻塞 UI。 */
export function normalizeAggregateFormat(value: unknown): AggregateFormatOptions {
  const raw = (value ?? {}) as Partial<AggregateFormatOptions>;
  const separator = raw.separator;
  const order = raw.order;
  return {
    separator: separator === "blank" || separator === "newline" || separator === "space" || separator === "custom" ? separator : DEFAULT_AGGREGATE_FORMAT.separator,
    customSeparator: typeof raw.customSeparator === "string" ? raw.customSeparator : DEFAULT_AGGREGATE_FORMAT.customSeparator,
    numbered: typeof raw.numbered === "boolean" ? raw.numbered : DEFAULT_AGGREGATE_FORMAT.numbered,
    order: order === "selected" || order === "time" ? order : DEFAULT_AGGREGATE_FORMAT.order,
  };
}

/** 读取持久化格式；无记录或解析失败返回默认格式。 */
export function loadAggregateFormat(): AggregateFormatOptions {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_AGGREGATE_FORMAT;
    return normalizeAggregateFormat(JSON.parse(raw));
  } catch {
    return DEFAULT_AGGREGATE_FORMAT;
  }
}

/** 写入持久化格式；失败静默跳过（格式是纯增强能力，不阻断主流程）。 */
export function persistAggregateFormat(format: AggregateFormatOptions) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(format));
  } catch {
    /* localStorage 不可用时仅内存态生效 */
  }
}
