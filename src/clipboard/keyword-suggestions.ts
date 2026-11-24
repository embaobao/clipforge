/** 关键词联想（提案 clipboard-search-and-tag-quality §3）：输入普通文字时，从已加载的历史里找出常用的词给出提示。
 *  纯函数、零依赖：索引按条目文本构建一次，之后每次按键只查表；拼音由调用方注入（pinyin-pro 不在这里引入）。 */

/** 最多取最近这些条目来建索引，条目再多时联想质量不会明显变化，构建耗时却有上限。 */
const MAX_INDEXED_ITEMS = 1500;
const MAX_SOURCE_CHARS = 2000;
/** 汉字词最长到四个字：更长的短语不适合当检索词。 */
const MAX_NGRAM_LENGTH = 4;
/** 五个字的片段只用来判断四字词是不是更长短语的碎片，本身不成为关键词。 */
const PRUNING_NGRAM_LENGTH = 5;
/** 更长的字母数字串是标识符、哈希一类的碎片。 */
const MAX_LATIN_LENGTH = 20;
/** 一个词至少出现在这么多条历史里才算常用；只出现一次的多半是人名、编号这类碎片。 */
const MIN_COUNT = 2;

/** 虚词与连接词：切词时当分隔符，出现再多也不会成为关键词。 */
const STOP_CHARS = "的了在是我和就不都为来去说以还与之其呢吧啊把被给让从及或而则也又很最没每这那它他她您谁什么哪怎如此已经常";
/** 成词后整词丢弃的高频套话（汉字两字以上的，以及英文虚词）。 */
const STOP_WORDS: Record<string, true> = {
  需要: true, 进行: true, 使用: true, 支持: true, 可以: true, 如果: true, 没有: true, 时候: true, 然后: true, 直接: true,
  相关: true, 以及: true, 或者: true, 我们: true, 自己: true, 就是: true, 还是: true, 但是: true, 因为: true, 所以: true,
  这样: true, 现在: true, 一些: true, 所有: true, 其他: true, 不要: true, 可能: true, 应该: true, 目前: true, 这里: true,
  之后: true, 之前: true, 之间: true,
  the: true, and: true, for: true, with: true, that: true, this: true, from: true, have: true, are: true, was: true, you: true,
  your: true, will: true, not: true, but: true, all: true, use: true, using: true,
};

// 联想有意只收常用汉字（基本区 + 扩展 A）。全文索引的切分范围更宽（src-tauri/src/clipboard/search_index.rs），
// 假名、谚文等能搜到，但不建关键词索引。
const HAN_CHAR = /[\u3400-\u4dbf\u4e00-\u9fff]/;
const HAN_RUNS = /[\u3400-\u4dbf\u4e00-\u9fff]+/g;
const STOP_CHAR_IN_RUN = new RegExp(`[${STOP_CHARS}]`, "g");
// 字母数字串：汉字不算在内，至少三个字符，允许下划线与连字符（my_var、node_modules）。
const LATIN_WORDS = /(?:(?![\u3400-\u4dbf\u4e00-\u9fff])[\p{L}\p{N}])(?:(?![\u3400-\u4dbf\u4e00-\u9fff])[\p{L}\p{N}_-]){2,31}/gu;

export type KeywordIndex = {
  /** 汉字词 → 出现的条目数（碎片已去掉）。 */
  han: Map<string, number>;
  /** 小写词 → 原样写法与出现的条目数。 */
  latin: Map<string, { label: string; count: number }>;
  /** 汉字 → 拼音音节，首次用到时才计算。 */
  syllables: Map<string, string[]>;
};

/** 下拉里的关键词候选：与 SearchSuggestion 的 keyword 成员同构。本模块不依赖 search-query，才能被单独测试。 */
export interface KeywordSuggestion {
  id: string;
  label: string;
  hint: string;
  kind: "keyword";
}

export type KeywordMatch = { keyword: string; count: number };

/** 取出文本里的汉字词段：连续汉字为一段，虚词处断开。 */
function hanRuns(text: string): string[] {
  const runs: string[] = [];
  for (const run of text.match(HAN_RUNS) ?? []) {
    for (const piece of run.split(STOP_CHAR_IN_RUN)) {
      if (piece.length >= 2) runs.push(piece);
    }
  }
  return runs;
}

/** 统计每个 n 字片段出现在多少条里（同一条只算一次）。
 *  frequent 给出时只统计「去掉首字或末字后已达到常用线」的片段：短片段都不常用，长片段不可能常用。 */
function countNGrams(runsPerItem: string[][], size: number, frequent?: Map<string, number>) {
  const counts = new Map<string, number>();
  for (const runs of runsPerItem) {
    const seen = new Set<string>();
    for (const run of runs) {
      for (let start = 0; start + size <= run.length; start += 1) {
        const gram = run.slice(start, start + size);
        if (frequent) {
          const head = frequent.get(gram.slice(0, -1)) ?? 0;
          const tail = frequent.get(gram.slice(1)) ?? 0;
          if (head < MIN_COUNT && tail < MIN_COUNT) continue;
        }
        seen.add(gram);
      }
    }
    for (const gram of seen) counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  return counts;
}

/** 只留下完整的词。判断依据是词的边界是否稳定：一个片段如果在某一侧接的总是同一个字（接上那个字的更长片段
 *  计数跟它差不多），说明那一侧不是词的边界，它只是更长短语的一部分（「剪贴」之于「剪贴板」、「后标注证」之于
 *  「后标注证据」）。另外，词里包含计数是它一点五倍以上的短词时，它多半是常用词前后拖了别的字（「平台启动」之于「平台」、「配失败」之于「失败」）。 */
function keepWholeWords(candidates: Map<string, number>, longerFragments: Map<string, number>) {
  const all = new Map([...candidates, ...longerFragments]);
  const extensions = new Map<string, string[]>();
  for (const gram of all.keys()) {
    if (gram.length < 3) continue;
    for (const part of [gram.slice(0, -1), gram.slice(1)]) {
      const list = extensions.get(part);
      if (list) list.push(gram);
      else extensions.set(part, [gram]);
    }
  }
  const kept = new Map<string, number>();
  for (const [gram, count] of candidates) {
    if (count < MIN_COUNT || gram in STOP_WORDS) continue;
    if ((extensions.get(gram) ?? []).some((extension) => (all.get(extension) ?? 0) >= 0.8 * count)) continue;
    let dominated = false;
    for (let start = 0; start + 2 <= gram.length && !dominated; start += 1) {
      for (let end = start + 2; end <= gram.length; end += 1) {
        if (start === 0 && end === gram.length) continue;
        dominated = (candidates.get(gram.slice(start, end)) ?? 0) >= 1.5 * count;
        if (dominated) break;
      }
    }
    if (!dominated) kept.set(gram, count);
  }
  return kept;
}

function countLatinWords(sources: string[]) {
  const latin = new Map<string, { label: string; count: number }>();
  for (const source of sources) {
    const seen = new Set<string>();
    for (const match of source.matchAll(LATIN_WORDS)) {
      const word = match[0];
      const key = word.toLowerCase();
      if (word.length > MAX_LATIN_LENGTH || key in STOP_WORDS || seen.has(key)) continue;
      seen.add(key);
      const entry = latin.get(key);
      if (entry) entry.count += 1;
      else latin.set(key, { label: word, count: 1 });
    }
  }
  for (const [key, entry] of latin) {
    if (entry.count < MIN_COUNT) latin.delete(key);
  }
  return latin;
}

/** 按条目顺序（新的在前）建立索引。texts 是每条历史的取材文本。 */
export function buildKeywordIndex(texts: readonly string[]): KeywordIndex {
  const sources = texts.slice(0, MAX_INDEXED_ITEMS).map((text) => text.slice(0, MAX_SOURCE_CHARS));
  const runsPerItem = sources.map(hanRuns);
  // 由短到长逐层统计：上一层的计数决定哪些位置值得看更长的片段。
  const pairs = countNGrams(runsPerItem, 2);
  const triples = countNGrams(runsPerItem, 3, pairs);
  const quads = countNGrams(runsPerItem, 4, triples);
  const fives = countNGrams(runsPerItem, PRUNING_NGRAM_LENGTH, quads);
  return {
    han: keepWholeWords(new Map([...pairs, ...triples, ...quads]), fives),
    latin: countLatinWords(sources),
    syllables: new Map(),
  };
}

/** 按条目数降序、长度升序、字典序排列。输入的词本身如果有，计数一定最高，自然排在第一。 */
function topMatches(matches: KeywordMatch[], limit: number) {
  return matches
    .sort((a, b) => b.count - a.count || a.keyword.length - b.keyword.length || (a.keyword < b.keyword ? -1 : 1))
    .slice(0, limit);
}

/** 一个汉字词的两种拼音键：声母串与全拼。 */
function pinyinKeys(index: KeywordIndex, gram: string, syllablesOf: (han: string) => string[]) {
  let initials = "";
  let full = "";
  for (const char of gram) {
    let syllables = index.syllables.get(char);
    if (!syllables) {
      syllables = syllablesOf(char).map((syllable) => syllable.toLowerCase());
      index.syllables.set(char, syllables);
    }
    initials += syllables[0]?.[0] ?? "";
    full += syllables[0] ?? "";
  }
  return { initials, full };
}

/** 输入 → 最多 limit 个关键词提示（含出现条目数）。
 *  汉字输入：提示包含这段汉字的常用词（「台」→「平台」），比输入短的词不提示，避免把输全的词换掉。
 *  字母输入：先提示同前缀的英文词；没有时按拼音（声母或全拼前缀）提示汉字词。汉字与字母混输、输入本身已是常用词时不提示。 */
function matchKeywords(
  index: KeywordIndex,
  input: string,
  options: { limit?: number; syllablesOf?: (han: string) => string[] } = {},
): KeywordMatch[] {
  const term = input.trim().toLowerCase();
  const limit = options.limit ?? 6;
  // 汉字输入超过最长词长就不可能有候选；字母输入要留足四字词全拼的长度。
  if (!term || term.length > (HAN_CHAR.test(term) ? MAX_NGRAM_LENGTH : 24)) return [];
  // 输入本身已经是常用词：没有更完整的词可补，再提示会把回车粘贴变成反复选词。
  if (index.han.has(term) || index.latin.has(term)) return [];
  if (HAN_CHAR.test(term)) {
    if (![...term].every((char) => HAN_CHAR.test(char))) return [];
    return topMatches(
      [...index.han]
        .filter(([gram, count]) => gram.includes(term) && gram.length >= term.length && count >= MIN_COUNT)
        .map(([keyword, count]) => ({ keyword, count })),
      limit,
    );
  }
  if (!/^[a-z][a-z0-9_-]*$/.test(term)) return [];
  const matches = [...index.latin.values()]
    .filter((entry) => entry.label.toLowerCase().startsWith(term))
    .map((entry) => ({ keyword: entry.label, count: entry.count }));
  if (!matches.length && options.syllablesOf && /^[a-z]+$/.test(term)) {
    for (const [gram, count] of index.han) {
      const keys = pinyinKeys(index, gram, options.syllablesOf);
      if (keys.initials.startsWith(term) || keys.full.startsWith(term)) matches.push({ keyword: gram, count });
    }
  }
  return topMatches(matches, limit);
}

/** 关键词候选 → 下拉项。id 带前缀避免与保存的搜索重名，hint 是出现条目数。 */
export function suggestKeywords(
  index: KeywordIndex,
  input: string,
  options: { limit?: number; syllablesOf?: (han: string) => string[] } = {},
): KeywordSuggestion[] {
  return matchKeywords(index, input, options).map((match) => ({
    id: `keyword:${match.keyword}`,
    label: match.keyword,
    hint: `${match.count}`,
    kind: "keyword",
  }));
}
