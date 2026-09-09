/** 文件路径存在性检查 hook（从 App.tsx 切出）：对可见列表中的文件路径批量探测，标记缺失状态。 */
import { useEffect } from "react";
import type { ClipItem } from "../App";
import type { FilePathStatus } from "../services/clipboard";
import { checkFilePaths } from "../services/clipboard";
import { getFilePathsFromClip } from "./clipboard-domain";
import { logAppError } from "./panel-shared";

export type FilePathStatusesOptions = {
  isSettingsWindow: boolean;
  filteredClips: ClipItem[];
  filePathStatuses: Record<string, FilePathStatus>;
  setFilePathStatuses: React.Dispatch<React.SetStateAction<Record<string, FilePathStatus>>>;
};

/** 批量检查过滤后列表中的文件路径（单批 ≤200 个，未知的才探测），写入 filePathStatuses。 */
export function useFilePathStatuses({ isSettingsWindow, filteredClips, filePathStatuses, setFilePathStatuses }: FilePathStatusesOptions) {
  useEffect(() => {
    if (isSettingsWindow) return;
    const paths = Array.from(
      new Set(
        filteredClips
          .flatMap(getFilePathsFromClip)
          .filter((path) => filePathStatuses[path] === undefined)
          .slice(0, 200),
      ),
    );
    if (!paths.length) return;
    let cancelled = false;
    checkFilePaths(paths)
      .then((items) => {
        if (cancelled || !items.length) return;
        setFilePathStatuses((current) => {
          const next = { ...current };
          items.forEach((item) => {
            next[item.path] = item;
          });
          return next;
        });
      })
      .catch((error) => logAppError("warn", "Check file paths failed", String(error)));
    return () => {
      cancelled = true;
    };
  }, [filePathStatuses, filteredClips, isSettingsWindow, setFilePathStatuses]);
}
