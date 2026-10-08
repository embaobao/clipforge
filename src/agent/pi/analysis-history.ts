/** pi 分析历史：本地持久化最近的分析结果（record/get 惯例模式）。
 *  边界：localStorage 存储（上限 20 条裁剪）；不联网、不进剪贴板数据库。 */

export type PiHistoryEntry = {
  at: number;
  clipId: string;
  summary: string;
  tags: string[];
};

const STORAGE_KEY = "clipforge.pi-analysis-history.v1";
const MAX_ENTRIES = 20;

export function recordPiHistory(entry: Omit<PiHistoryEntry, "at">): void {
  try {
    const history = getPiHistory();
    history.unshift({ ...entry, at: Date.now() });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(0, MAX_ENTRIES)));
  } catch {
    // localStorage 不可用（隐私模式/配额）时静默跳过——历史是纯增强能力。
  }
}

export function getPiHistory(): PiHistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PiHistoryEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
