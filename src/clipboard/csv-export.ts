/**
 * 多选表格 / CSV 导出域纯函数（openspec `clipboard-interaction-repair` 第 5 项）。
 *
 * 做什么：把剪贴板条目投影成表格行，按 RFC 4180 转义单元格，并对以 = + - @
 * 等开头的单元格做表格公式注入防护（OWASP CSV Injection），产出可复制的 TSV
 * 或可写盘的 CSV 文件内容。
 *
 * 为什么：剪贴板正文来自不可信来源，裸拼串时逗号、引号、换行会破坏列结构；
 * 以 = + - @ 开头的单元格在 Excel / Numbers / Sheets 里会被当作公式执行。
 * 提案「范围与约束」明确要求「CSV 处理逗号、引号、换行与表格公式注入」。
 *
 * 边界：本模块只做纯字符串构建，不碰 DOM、剪贴板、文件系统与 Tauri 命令；
 * 文件落盘、按类型分割导出、缺失文件与部分失败报告由上层 / Rust 侧承接。
 * 表头文案由调用方注入（i18n），模块内不硬编码用户可见文案。
 */

/** 分隔符：CSV 文件用逗号，复制到剪贴板的表格用制表符（便于粘贴进电子表格）。 */
export type TableDelimiter = "," | "\t";

/** 表格构建选项。 */
export type DelimitedTableOptions = {
  /** 单元格分隔符。 */
  delimiter: TableDelimiter;
  /** 表头行；不传或空数组则不输出表头。文案由调用方从 i18n 注入。 */
  headers?: readonly string[];
  /** 是否对危险前缀做表格公式注入防护，导出场景应恒为 true。 */
  guardFormula: boolean;
  /** 行结束符：CSV 文件用 CRLF（RFC 4180），剪贴板表格沿用 LF。 */
  lineEnding: "\n" | "\r\n";
  /** 是否加 UTF-8 BOM，避免 Excel 打开中文 CSV 乱码。 */
  withBom: boolean;
};

/** 导出表格所需的最小条目投影，与 ClipItem 解耦，便于独立单测与复用。 */
export type ClipExportRow = {
  /** 标题，回退逻辑由调用方处理。 */
  title: string;
  /** 载荷类型（text / image / file / html ...），按类型分割导出时使用。 */
  kind: string;
  /** 正文原始内容，不做空白折叠，保留换行交给转义处理。 */
  content: string;
};

/** 电子表格会当作公式执行的危险首字符（含制表符与回车）。 */
const FORMULA_PREFIX = /^[=+@\t\r]/;

/** 合法负数值，不需要防护，避免把 -12.5 变成文本。 */
const NUMERIC_NEGATIVE = /^-\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/**
 * 表格公式注入防护：去掉前导空白 / 控制符后，若首字符为 = + @ 或制表符 / 回车，
 * 或以 - 开头且整体不是合法数值，则在原文最前面加单引号，使电子表格按文本解析。
 * 前导空白不能绕过判定；除加前缀外不改变原始文本（换行等交给 escapeDelimitedCell）。
 */
export function guardCsvFormula(value: string): string {
  const trimmed = value.replace(/^[\s\u0000-\u001f]+/, "");
  if (!trimmed) return value;
  const first = trimmed[0];
  if (FORMULA_PREFIX.test(first)) return `'${value}`;
  if (first === "-" && !NUMERIC_NEGATIVE.test(trimmed)) return `'${value}`;
  return value;
}

/**
 * RFC 4180 单元格转义：含分隔符、双引号、CR 或 LF 时用双引号包裹，
 * 内部双引号翻倍。guardFormula 为 true 时先做公式注入防护。
 * null / undefined 归一为空串，不抛错。
 */
export function escapeDelimitedCell(
  raw: string | null | undefined,
  delimiter: TableDelimiter,
  guardFormula: boolean,
): string {
  const value = raw == null ? "" : String(raw);
  const safe = guardFormula ? guardCsvFormula(value) : value;
  const needsQuote =
    safe.includes(delimiter) || safe.includes('"') || safe.includes("\n") || safe.includes("\r");
  return needsQuote ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** 把二维表格行按选项拼成分隔文本；每行独立转义，不强制补齐列数。 */
export function buildDelimitedTable(
  rows: readonly (readonly (string | null | undefined)[])[],
  options: DelimitedTableOptions,
): string {
  const { delimiter, headers, guardFormula, lineEnding, withBom } = options;
  const normalize = (row: readonly (string | null | undefined)[]) =>
    row.map((cell) => escapeDelimitedCell(cell, delimiter, guardFormula)).join(delimiter);
  const lines: string[] = [];
  if (headers?.length) lines.push(normalize(headers));
  for (const row of rows) lines.push(normalize(row));
  return `${withBom ? "\uFEFF" : ""}${lines.join(lineEnding)}`;
}

/**
 * 把条目投影成表格行。includeKind 为 false 时输出 [标题, 内容] 两列，
 * 保持既有「复制表格」的列结构；为 true 时输出 [标题, 类型, 内容] 三列，
 * 供按类型分割导出 / CSV 文件使用。
 */
export function clipRowsToDelimitedRows(
  items: readonly ClipExportRow[],
  includeKind = false,
): (readonly string[])[] {
  return items.map((item) =>
    includeKind ? [item.title, item.kind, item.content] : [item.title, item.content],
  );
}

/** 把单元格内的空白（含换行 / 制表符）折叠成单个空格，避免 TSV 粘贴时串列。 */
function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * 生成复制到剪贴板的表格文本：TSV、两列、无表头、LF 换行。
 *
 * 与 CSV 文件的差别（重要）：TSV 是粘贴进 Excel / Sheets 的路径，电子表格
 * 粘贴 TSV 时把双引号当字面字符、不会按 RFC 4180 解析，因此这里沿用旧行为
 * 折叠单元格内空白（换行 / tab 变空格），只额外补上表格公式注入防护，
 * 不套双引号包裹。这样既修掉 `=cmd` 类注入，又不破坏既有粘贴兼容性。
 * 完整的逗号 / 引号 / 换行转义只在 buildCsvFileContent 里做。
 */
export function buildClipboardTable(items: readonly ClipExportRow[]): string {
  return items
    .map((item) =>
      [collapseWhitespace(item.title), collapseWhitespace(item.content)]
        .map((cell) => guardCsvFormula(cell))
        .join("\t"),
    )
    .join("\n");
}

/**
 * 生成 CSV 文件内容：逗号分隔、CRLF、UTF-8 BOM、开启公式防护，
 * 默认输出 [标题, 类型, 内容] 三列。表头由调用方传入，不传则无表头。
 * 只产出文本，写盘与部分失败报告不在本模块职责内。
 */
export function buildCsvFileContent(
  items: readonly ClipExportRow[],
  headers?: readonly string[],
): string {
  return buildDelimitedTable(clipRowsToDelimitedRows(items, true), {
    delimiter: ",",
    headers,
    guardFormula: true,
    lineEnding: "\r\n",
    withBom: true,
  });
}
