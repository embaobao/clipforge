/** diff 草稿态（设计 §2/§9）：草稿横幅（来源插件 id）+ 行级红删绿增 + 保存/放弃由底部动作区承接。
 *  草稿仅内存，不落库；行 diff 用朴素 LCS（行数上限保护，超限退化为整块替换）。 */
import { GitCompareArrows } from "lucide-react";
import type { TranslationKey } from "../../../i18n";
import type { DetailDraft } from "./detail-state";

export type DraftDiffProps = {
  baseline: string;
  draft: DetailDraft;
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
};

/** 行级 LCS 上限：超过按整块增删渲染，避免长文 O(n·m) 卡顿。 */
const MAX_LCS_LINES = 400;

type DiffRow = { kind: "same" | "add" | "del"; text: string };

/** 朴素行 diff：dp 表 + 回溯。仅用于 ≤MAX_LCS_LINES 的草稿对比。 */
export function diffLines(baseline: string, next: string): DiffRow[] {
  const a = baseline.split(/\r?\n/);
  const b = next.split(/\r?\n/);
  if (a.length > MAX_LCS_LINES || b.length > MAX_LCS_LINES) {
    return [
      ...a.map<DiffRow>((text) => ({ kind: "del", text })),
      ...b.map<DiffRow>((text) => ({ kind: "add", text })),
    ];
  }
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = rows - 2; i >= 0; i -= 1) {
    for (let j = cols - 2; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ kind: "del", text: a[i] });
      i += 1;
    } else {
      out.push({ kind: "add", text: b[j] });
      j += 1;
    }
  }
  while (i < a.length) {
    out.push({ kind: "del", text: a[i] });
    i += 1;
  }
  while (j < b.length) {
    out.push({ kind: "add", text: b[j] });
    j += 1;
  }
  return out;
}

export function DraftDiff({ baseline, draft, tr }: DraftDiffProps) {
  const rows = diffLines(baseline, draft.content);
  const removed = rows.filter((row) => row.kind === "del").length;
  const added = rows.filter((row) => row.kind === "add").length;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2" data-surface="detail-diff">
      <div
        className="draft-banner-in flex shrink-0 items-center gap-2 rounded-lg border border-primary/25 bg-primary/[0.04] px-3 py-1.5 text-[11px]"
        data-diff-banner
      >
        <GitCompareArrows size={13} />
        <span className="font-medium">{tr("main.detail.diff.draftBanner")}</span>
        <span className="mono text-muted-foreground" data-draft-src={draft.srcId}>{draft.srcId}</span>
        <span className="ml-auto text-muted-foreground">
          <span className="text-emerald-600 dark:text-emerald-400">+{added}</span>
          <span className="mx-1">·</span>
          <span className="text-destructive">-{removed}</span>
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border/60" data-diff-body>
        <table className="w-full border-collapse font-mono text-[11.5px] leading-relaxed">
          <tbody>
            {rows.map((row, index) => (
              <tr
                className={
                  row.kind === "add"
                    ? "bg-emerald-500/[0.08]"
                    : row.kind === "del"
                      ? "bg-destructive/[0.08]"
                      : undefined
                }
                data-diff-row={row.kind}
                key={`${index}-${row.text}`}
              >
                <td aria-hidden="true" className="w-6 select-none px-1 text-center text-muted-foreground/70">
                  {row.kind === "add" ? "+" : row.kind === "del" ? "-" : ""}
                </td>
                <td className="whitespace-pre-wrap break-words px-2">{row.text || " "}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="shrink-0 text-[11px] text-muted-foreground">{tr("main.detail.action.draftHint")}</p>
    </div>
  );
}
