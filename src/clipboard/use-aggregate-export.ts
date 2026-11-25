// 聚合导出域（S5 从 App.tsx 迁出）：TSV 复制、CSV 文件导出、按类型分割导出。
import { invoke } from "@tauri-apps/api/core";
import type { TranslationKey } from "../i18n";
import type { FilePathStatus } from "../services/clipboard";
import type { ClipItem } from "./clip-model";
import { getFilePathsFromClip } from "./clipboard-domain";
import { buildClipboardTable } from "./csv-export";
import {
  buildCsvFileExportPlan,
  buildSplitExportRequest,
  planSplitExport,
  projectExportSources,
  summarizeExportOutcome,
  type ExportItemOutcome,
  type ExportSourceClip,
} from "./csv-file-export";
import { logAppError } from "./panel-shared";

export function useAggregateExport(options: {
  selectedInList: ClipItem[];
  filePathStatuses: Record<string, FilePathStatus>;
  setNativeStatus: (status: string) => void;
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
  formatNativeError: (error: unknown) => string;
}) {
  const { selectedInList, filePathStatuses, setNativeStatus, tr, formatNativeError } = options;

  function buildExportSources(): ExportSourceClip[] {
    return selectedInList.map((item) => ({
      id: item.id,
      title: item.analysis.title || item.analysis.sourceName || item.payloadKind,
      kind: item.payloadKind,
      content: item.content,
      filePath:
        item.payloadKind === "file"
          ? getFilePathsFromClip(item)[0] ?? null
          : item.payloadKind === "image"
            ? item.imageFile ?? null
            : null,
    }));
  }

  function exportTable() {
    // 复制表格走 TSV 粘贴路径：空白折叠防串列 + 表格公式注入防护（clipboard-interaction-repair 第 5 项）。
    const table = buildClipboardTable(selectedInList.map((item) => ({
      title: item.analysis.title || "",
      kind: item.payloadKind,
      content: item.content,
    })));
    void navigator.clipboard.writeText(table);
    setNativeStatus(tr("main.status.exportedTsv"));
  }

  async function exportCsvFile() {
    // 导出 CSV 文件（clipboard-interaction-repair 第 5 项）：正文经 RFC 4180 转义与
    // 公式注入防护后交给 Rust 独占写盘；缺失原始文件在状态栏明确报告，不静默跳过。
    const sources = projectExportSources(buildExportSources(), filePathStatuses);
    if (!sources.length) {
      setNativeStatus(tr("main.status.exportCsvEmpty"));
      return;
    }
    const plan = buildCsvFileExportPlan(
      sources,
      [
        tr("main.aggregate.csvHeaderTitle"),
        tr("main.aggregate.csvHeaderKind"),
        tr("main.aggregate.csvHeaderContent"),
      ],
      tr("main.aggregate.csvUntitled"),
    );
    const split = planSplitExport(sources);
    try {
      const result = await invoke<{ directory: string; path: string; count: number }>(
        "export_clip_csv_file",
        { input: { content: plan.content, rowCount: plan.rowCount } },
      );
      const outcomes: ExportItemOutcome[] = [
        ...split.textItems.map((item) => ({ id: item.id, outcome: "success" as const })),
        ...split.otherItems.map((item) => ({ id: item.id, outcome: "success" as const })),
        ...split.fileItems.map((item) => ({ id: item.id, outcome: "success" as const })),
        ...split.missingItems.map((item) => ({
          id: item.id,
          outcome: "missing" as const,
          reasonCode: "CLIP_CSV_SOURCE_MISSING",
        })),
      ];
      const summary = summarizeExportOutcome(outcomes);
      setNativeStatus(
        summary.partial
          ? tr("main.status.exportedCsvPartial", {
              count: result.count,
              path: result.path,
              missing: summary.missing,
            })
          : tr("main.status.exportedCsvFile", { count: result.count, path: result.path }),
      );
    } catch (error) {
      logAppError("warn", "Export CSV file failed", String(error));
      setNativeStatus(formatNativeError(error));
    }
  }

  async function exportSplitFiles() {
    // 按类型分割导出（clipboard-interaction-repair 第 5 项）：CSV 清单与原始文件复制
    // 落在同一独立目录；写盘前复核路径，逐项 outcome 明确报告缺失与部分失败。
    const sources = projectExportSources(buildExportSources(), filePathStatuses);
    if (!sources.length) {
      setNativeStatus(tr("main.status.exportCsvEmpty"));
      return;
    }
    try {
      // 列表状态是加载时的快照；导出时文件可能已移动或删除，写盘前复核一次。
      const paths = [
        ...new Set(
          sources.flatMap((item) => (item.filePath?.trim() ? [item.filePath] : [])),
        ),
      ];
      const checks = paths.length
        ? await invoke<
            { path: string; exists: boolean; isFile: boolean; isDir: boolean }[]
          >("check_file_paths", { paths })
        : [];
      const availability: Record<string, boolean> = {};
      for (const check of checks) {
        availability[check.path] = check.exists && check.isFile;
      }
      const request = buildSplitExportRequest(
        sources,
        [
          tr("main.aggregate.csvHeaderTitle"),
          tr("main.aggregate.csvHeaderKind"),
          tr("main.aggregate.csvHeaderContent"),
        ],
        tr("main.aggregate.csvUntitled"),
        availability,
      );
      type SplitOutcome = {
        id: string;
        status: "success" | "missing" | "failed";
        reasonCode?: string;
        detail?: string;
      };
      const result = await invoke<{
        directory: string;
        csvPath?: string;
        csvRowCount: number;
        outcomes: SplitOutcome[];
      }>("export_clip_split_files", {
        input: {
          csvContent: request.csvContent,
          csvRowCount: request.csvRowCount,
          files: request.files,
        },
      });
      // 文本 / 其他类进 CSV 清单即成功；原始文件复制结果由 Rust 逐项返回；
      // 复核后判缺失的条目由前端补 missing，保证报告覆盖全部条目。
      const outcomes: ExportItemOutcome[] = [
        ...request.split.textItems.map((item) => ({ id: item.id, outcome: "success" as const })),
        ...request.split.otherItems.map((item) => ({ id: item.id, outcome: "success" as const })),
        ...result.outcomes.map((item) => ({
          id: item.id,
          outcome: item.status,
          reasonCode: item.reasonCode,
        })),
        ...request.split.missingItems.map((item) => ({
          id: item.id,
          outcome: "missing" as const,
          reasonCode: "CLIP_SPLIT_SOURCE_MISSING",
        })),
      ];
      const summary = summarizeExportOutcome(outcomes);
      const reasonLabels: Partial<Record<string, TranslationKey>> = {
        CLIP_SPLIT_SOURCE_MISSING: "main.error.command.CLIP_SPLIT_SOURCE_MISSING",
        CLIP_SPLIT_COPY_FAILED: "main.error.command.CLIP_SPLIT_COPY_FAILED",
      };
      const reasons = summary.reasonCodes
        .map((code) => {
          const key = reasonLabels[code];
          return key ? tr(key) : code;
        })
        .join(tr("main.status.exportReasonSeparator"));
      setNativeStatus(
        summary.partial
          ? tr("main.status.exportedSplitPartial", {
              succeeded: summary.succeeded,
              failed: summary.failed,
              missing: summary.missing,
              directory: result.directory,
            }) + (reasons ? tr("main.status.exportSplitReasons", { reasons }) : "")
          : tr("main.status.exportedSplitFiles", {
              count: result.csvRowCount,
              directory: result.directory,
              files: result.outcomes.filter((item) => item.status === "success").length,
            }),
      );
    } catch (error) {
      logAppError("warn", "Split export by type failed", String(error));
      setNativeStatus(formatNativeError(error));
    }
  }

  return { exportTable, exportCsvFile, exportSplitFiles };
}
