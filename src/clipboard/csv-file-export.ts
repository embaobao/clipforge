/**
 * 多选详情「导出」编排纯函数（openspec `clipboard-interaction-repair` 第 5 项）。
 *
 * 做什么：把选中的剪贴板条目投影成 CSV 文件内容（表头由 i18n 注入），并按载荷
 * 类型拆分导出计划、识别缺失原始文件、汇总部分失败结果，产出结构化报告。
 *
 * 为什么：提案要求「表格可复制或导出 CSV；文本、图片和文件分别导出，缺失项明确
 * 报告；分割导出不覆盖已有文件」。把「构建 / 分组 / 报告」收敛成纯函数后，UI 只
 * 负责注入文案与调用 Tauri 写盘命令，安全构建（RFC 4180 转义 + 表格公式注入防护）
 * 复用 `csv-export.ts`，不产生第二套拼串逻辑。
 *
 * 边界：本模块不碰 DOM、剪贴板、文件系统与 Tauri 命令；不硬编码任何用户可见
 * 文案（表头、状态、失败原因全部由调用方从 i18n 传入）；`pathAvailable` 由上层
 * 注入 `check_file_paths` 的结果，未检查（undefined）不擅自判定为缺失。
 */

import { buildCsvFileContent, type ClipExportRow } from "./csv-export.js";

/** 导出条目的最小投影，与 App 侧 ClipItem 解耦，便于独立单测与复用。 */
export type ExportSourceItem = {
  id: string;
  /** 标题，空串时由调用方注入的「未命名」文案兜底。 */
  title: string;
  /** 载荷类型（text / image / file / html ...）。 */
  kind: string;
  /** 正文原始内容；图片与文件条目通常是路径或占位文本。 */
  content: string;
  /** 图片 / 文件条目的本地原始文件路径；文本条目可省略。 */
  filePath?: string | null;
  /** 路径是否真实可用（来自 Rust `check_file_paths`）；undefined 表示尚未检查。 */
  pathAvailable?: boolean;
};

/** CSV 文件导出计划：可直接交给 `export_clip_csv_file` 写盘。 */
export type CsvFileExportPlan = {
  content: string;
  rowCount: number;
};

/** 按类型分割后的导出组名。 */
export type SplitExportGroup = "text" | "image" | "file" | "other";

/** 按类型分割的导出计划。 */
export type SplitExportPlan = {
  /** 文本类：写入 CSV / 文本文件。 */
  textItems: readonly ExportSourceItem[];
  /** 图片与文件类且原始路径可用：复制原始文件（不写路径文本）。 */
  fileItems: readonly ExportSourceItem[];
  /** 图片与文件类但原始文件缺失 / 不可读：需要明确报告，不静默跳过。 */
  missingItems: readonly ExportSourceItem[];
  /** 其他不可归类项（如 html / 未知类型）：保留在 CSV 中，不强塞进文件复制。 */
  otherItems: readonly ExportSourceItem[];
  /** 各组计数，供 UI 概览展示。 */
  groups: { group: SplitExportGroup; count: number }[];
};

/** 逐项写盘结果（success / failed / missing 三类，脱敏原因由调用方注入）。 */
export type ExportItemOutcome = {
  id: string;
  outcome: "success" | "failed" | "missing";
  /** 失败原因的稳定类别码，不含路径、正文与凭据；成功项可省略。 */
  reasonCode?: string;
};

/** 部分失败汇总，结构化返回，文案由 i18n 层拼装。 */
export type ExportOutcomeSummary = {
  total: number;
  succeeded: number;
  failed: number;
  missing: number;
  /** 存在任一失败或缺失，调用方应展示明确报告而不是笼统成功提示。 */
  partial: boolean;
  /** 失败类别码去重列表，便于 UI 逐条展示脱敏原因。 */
  reasonCodes: string[];
};

/** 标题为空时的兜底投影：不改动正文与类型，避免 CSV 首列空白。 */
export function toCsvExportRows(
  items: readonly ExportSourceItem[],
  untitledLabel: string,
): ClipExportRow[] {
  return items.map((item) => ({
    title: item.title.trim() ? item.title : untitledLabel,
    kind: item.kind,
    content: item.content,
  }));
}

/**
 * 构建 CSV 文件导出计划。表头文案由调用方从 i18n 注入（如「标题 / 类型 / 内容」）；
 * 空选区返回空内容与 rowCount=0，由调用方决定是否提示，不在纯函数里抛错。
 */
export function buildCsvFileExportPlan(
  items: readonly ExportSourceItem[],
  headers: readonly string[],
  untitledLabel: string,
): CsvFileExportPlan {
  const rows = toCsvExportRows(items, untitledLabel);
  return {
    content: rows.length ? buildCsvFileContent(rows, headers) : "",
    rowCount: rows.length,
  };
}

/** 图片与文件类必须复制原始文件而非路径文本，因此单独判定路径可用性。 */
function isFileBackedKind(kind: string): boolean {
  const normalized = kind.toLowerCase();
  return normalized === "image" || normalized === "file";
}

/**
 * 按载荷类型拆分导出计划：文本进 CSV、图片 / 文件按原始路径复制、缺失项单独列出。
 * `pathAvailable === undefined` 视为「尚未检查」，暂不下缺失结论但仍归入文件组，
 * 由调用方在写盘前用 `check_file_paths` 复核，避免误报。
 */
export function planSplitExport(items: readonly ExportSourceItem[]): SplitExportPlan {
  const textItems: ExportSourceItem[] = [];
  const fileItems: ExportSourceItem[] = [];
  const missingItems: ExportSourceItem[] = [];
  const otherItems: ExportSourceItem[] = [];

  for (const item of items) {
    const kind = item.kind.toLowerCase();
    if (isFileBackedKind(kind)) {
      const pathMissing =
        item.pathAvailable === false || (!item.pathAvailable && !item.filePath?.trim());
      if (pathMissing) missingItems.push(item);
      else fileItems.push(item);
    } else if (kind === "text" || kind === "html" || kind === "rtf") {
      textItems.push(item);
    } else {
      otherItems.push(item);
    }
  }

  return {
    textItems,
    fileItems,
    missingItems,
    otherItems,
    groups: [
      { group: "text", count: textItems.length },
      { group: "image", count: fileItems.filter((item) => item.kind.toLowerCase() === "image").length },
      { group: "file", count: fileItems.filter((item) => item.kind.toLowerCase() === "file").length },
      { group: "other", count: otherItems.length },
    ],
  };
}

/**
 * 汇总逐项写盘结果：只要存在失败或缺失就标记 partial=true，调用方必须展示明确
 * 报告。reasonCode 只做去重透传，不拼接任何用户可见文案，避免泄露路径与正文。
 */
export function summarizeExportOutcome(
  outcomes: readonly ExportItemOutcome[],
): ExportOutcomeSummary {
  let succeeded = 0;
  let failed = 0;
  let missing = 0;
  const reasonCodes = new Set<string>();
  for (const outcome of outcomes) {
    if (outcome.outcome === "success") succeeded += 1;
    else if (outcome.outcome === "missing") missing += 1;
    else failed += 1;
    if (outcome.reasonCode) reasonCodes.add(outcome.reasonCode);
  }
  return {
    total: outcomes.length,
    succeeded,
    failed,
    missing,
    partial: failed > 0 || missing > 0,
    reasonCodes: [...reasonCodes],
  };
}

/** App 侧待投影条目的最小形状，与 ClipItem 解耦，避免纯函数依赖 UI 数据类型。 */
export type ExportSourceClip = {
  id: string;
  /** 已由调用方算好的展示标题（可为空，导出时再兜底）。 */
  title: string;
  kind: string;
  content: string;
  /** 图片 / 文件条目的原始路径，由调用方用 getFilePathsFromClip / imageFile 得到。 */
  filePath?: string | null;
};

/** 路径状态表：来自 Rust `check_file_paths` 或前端缓存，key 为原始路径字符串。 */
export type FilePathStatusMap = Readonly<
  Record<string, { exists: boolean; isFile: boolean }>
>;

/**
 * 把 App 侧条目投影为导出源，并注入路径可用性。
 * 未命中状态表的路径保持「尚未检查」，不擅自判定为缺失。
 */
export function projectExportSources(
  clips: readonly ExportSourceClip[],
  statuses: FilePathStatusMap,
): ExportSourceItem[] {
  return clips.map((clip) => {
    const status = clip.filePath ? statuses[clip.filePath] : undefined;
    return {
      id: clip.id,
      title: clip.title,
      kind: clip.kind,
      content: clip.content,
      filePath: clip.filePath,
      pathAvailable: status ? status.exists && status.isFile : undefined,
    };
  });
}

/** 按类型分割导出请求：可直接交给 `export_clip_split_files` 写盘。 */
export type SplitExportRequest = {
  /** 全部条目的 CSV 清单（含文件类路径信息），保证导出目录有一份完整索引。 */
  csvContent: string;
  csvRowCount: number;
  /** 需要复制原始文件的条目（路径已复核可用）。 */
  files: { id: string; path: string }[];
  /** 分组结果，供调用方补出缺失项 outcome。 */
  split: SplitExportPlan;
};

/**
 * 构建按类型分割导出请求。
 *
 * 为什么先复核：`filePathStatuses` 是列表加载时的快照，导出时文件可能已被移动或
 * 删除；写盘前用 `check_file_paths` 的结果覆盖旧判定，避免把缺失文件当成复制成功。
 *
 * 边界：CSV 清单始终包含全部条目；只有路径复核可用且未被判缺失的文件类条目进入
 * `files`；`pathAvailable === undefined`（未复核）仍允许尝试复制，由 Rust 侧做最终
 * 存在性校验并如实返回 missing，不静默跳过。
 */
export function buildSplitExportRequest(
  sources: readonly ExportSourceItem[],
  headers: readonly string[],
  untitledLabel: string,
  availability: Readonly<Record<string, boolean>>,
): SplitExportRequest {
  const verified = sources.map((item) => {
    if (!item.filePath || !(item.filePath in availability)) return item;
    return { ...item, pathAvailable: availability[item.filePath] };
  });
  const split = planSplitExport(verified);
  const csvContent = verified.length
    ? buildCsvFileContent(toCsvExportRows(verified, untitledLabel), headers)
    : "";
  const files = split.fileItems.flatMap((item) => {
    const path = item.filePath?.trim();
    return path && item.pathAvailable !== false ? [{ id: item.id, path }] : [];
  });
  return { csvContent, csvRowCount: verified.length, files, split };
}
