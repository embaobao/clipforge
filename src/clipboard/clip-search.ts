/** 搜索过滤域（从 App.tsx 切出）：haystack 构建、模糊匹配、拼音匹配、保存搜索规则与过滤 token 移除。
 *  纯函数域，不依赖 React；AppSettings/TagRule 类型从 App 引入（type-only，无运行时环）。 */
import { match as matchPinyin } from "pinyin-pro";
import type { AppSettings, ClipItem, TagRule } from "../App";
import { normalizeSearch } from "../search-query";

/** 拼接条目全部可搜索字段为小写 haystack（内容/来源/分析/标签/来源应用/采集上下文）。 */
export function getSearchHaystack(item: ClipItem) {
  const applicationContext = item.captureContext?.applicationContext;
  return [
    item.content,
    item.source,
    item.kind,
    item.bucket,
    item.analysis.title,
    item.analysis.summary,
    item.analysis.host,
    item.tags.join(" "),
    item.sourceApp?.name,
    applicationContext && typeof applicationContext === "object" ? JSON.stringify(applicationContext) : "",
  ]
    .join(" ")
    .toLowerCase();
}

/** 子序列模糊匹配：needle 的字符按序出现在 haystack 中即命中。 */
export function fuzzyIncludes(haystack: string, needle: string) {
  if (!needle) return true;
  let offset = 0;
  for (const char of needle) {
    const found = haystack.indexOf(char, offset);
    if (found < 0) return false;
    offset = found + 1;
  }
  return true;
}

/** 单词匹配：精确包含 → 拼音（可选）→ 模糊（可选）。 */
export function matchesSearchTerm(item: ClipItem, rawTerm: string, settings: AppSettings) {
  const term = normalizeSearch(rawTerm);
  if (!term) return true;
  const haystack = getSearchHaystack(item);
  if (haystack.includes(term)) return true;
  if (settings.pinyinSearchEnabled && /[a-z]/i.test(term)) {
    const textFields = [
      item.content,
      item.analysis.title,
      item.analysis.summary,
      item.tags.join(" "),
    ].filter(Boolean);
    if (textFields.some((text) => matchPinyin(text, term, { precision: "any", space: "ignore" }) !== null)) {
      return true;
    }
  }
  return settings.fuzzySearchEnabled ? fuzzyIncludes(haystack, term) : false;
}

/** 保存搜索规则匹配：query 拆词后任一词命中即通过。 */
export function matchesSavedSearch(item: ClipItem, rule: TagRule, settings: AppSettings) {
  const terms = rule.query
    .split(/[\s,，]+/)
    .map((term) => term.trim())
    .filter(Boolean);
  if (!rule.label.trim() || !terms.length) return false;
  return terms.some((term) => matchesSearchTerm(item, term, settings));
}

/** 从搜索框 query 中移除指定过滤标签对应的 token（兼容 #tag / @type: / kind: 等前缀形态）。 */
export function removeSearchFilterToken(rawQuery: string, label: string) {
  const normalizedLabel = normalizeSearch(label);
  const labelValue = label.replace(/^#/, "").replace(/^[^:]+:/, "");
  const normalizedValue = normalizeSearch(labelValue);
  return rawQuery
    .trim()
    .split(/\s+/)
    .filter((token) => {
      const normalizedToken = normalizeSearch(token);
      if (normalizedToken === normalizedLabel) return false;
      if (normalizedLabel.startsWith("#")) {
        return normalizedToken !== `#${normalizedValue}` && normalizedToken !== `tag:${normalizedValue}`;
      }
      if (normalizedLabel.startsWith("type:")) {
        return normalizedToken !== normalizedLabel && normalizedToken !== `@${normalizedValue}`;
      }
      if (normalizedLabel.startsWith("@") && normalizedLabel.endsWith(":")) {
        return normalizedToken !== normalizedLabel;
      }
      if (normalizedLabel.startsWith("kind:") || normalizedLabel.startsWith("file:") || normalizedLabel.startsWith("bucket:")) {
        return normalizedToken !== normalizedLabel;
      }
      return true;
    })
    .join(" ");
}
