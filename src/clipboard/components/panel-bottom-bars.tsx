// 主面板底栏（S5 从 App.tsx 迁出）：多选底栏 + 状态栏/快速命令菜单。
// 不携带 data-surface marker——marker 只允许 App.tsx 主面板一根。
import { toast } from "sonner";
import type { TranslationKey } from "../../i18n";
import type { ClipItem, PasteMode, ViewKey } from "../clip-model";
import { MultiSelectBottomBar } from "./MultiSelectBottomBar";
import { PanelStatusFeedback } from "./PanelStatusFeedback";
import { QuickCommandMenu } from "./QuickCommandMenu";

export function PanelBottomBars(options: {
  activeView: ViewKey;
  multiSelectMode: boolean;
  selectedInList: ClipItem[];
  selectedClip: ClipItem | null;
  filteredCount: number;
  nativeStatus: string;
  modLabel: string;
  copyClip: (item: ClipItem, pasteMode?: PasteMode) => Promise<void>;
  deleteClips: (ids: string[]) => Promise<void>;
  updateClip: (id: string, next: Partial<ClipItem>) => void;
  onTogglePanelPinned: () => void;
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
}) {
  const o = options;
  return (
    <>
      {/* 多选底栏常驻渲染（visible 控制显隐/过渡），退出多选时与
          PanelStatusFeedback 短暂并存（约 100ms 淡出），可接受。 */}
      <MultiSelectBottomBar
        count={o.selectedInList.length}
        tr={o.tr}
        variant={o.activeView === "trash" ? "trash" : "default"}
        visible={o.multiSelectMode}
      />
      {!o.multiSelectMode ? (
        <PanelStatusFeedback
          commandMenu={
            <QuickCommandMenu
              mod={o.modLabel}
              onCopyMode={(item, mode) => {
                void o.copyClip(item, mode);
              }}
              onDelete={(item) => {
                void o.deleteClips([item.id]);
              }}
              onFavorite={(item) => o.updateClip(item.id, { favorite: !item.favorite })}
              onCreateSnippet={() => toast.info("新建片段功能开发中")}
              onTogglePanelPinned={o.onTogglePanelPinned}
              selectedItem={o.selectedClip}
            >
              <button
                className="mono flex cursor-pointer items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
                type="button"
              >
                <span>{o.filteredCount} 条</span>
                <span>·</span>
                <span>⌘K 全部操作</span>
              </button>
            </QuickCommandMenu>
          }
          status={o.nativeStatus}
          tr={o.tr}
        />
      ) : null}
    </>
  );
}
