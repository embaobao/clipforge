// 主面板历史行内动作（frontend-surface-architecture-refactor Phase B）
// 打开目标（仅 url/attachment 条目）+ 收藏。容器 stopPropagation 阻止冒泡到行级 onClick；收藏按钮再 stopPropagation 一次。
// 类名保持 .row-actions / .quick-fav / .has-favorite 不变以兼容 App.css，视觉零变化。
import { ExternalLink, Heart } from "lucide-react";
import type { ClipItem } from "../../App";
import type { TrFunction } from "../clipboard-domain";

export interface ClipboardRowActionsProps {
  item: ClipItem;
  /** 打开目标（URL/附件）。 */
  onOpen: (item: ClipItem) => void;
  /** 切换收藏。 */
  onFavorite: (item: ClipItem) => void;
  tr: TrFunction;
}

/** 历史行内动作：open-target（仅 url/attachment 条目出现）+ favorite。 */
export function ClipboardRowActions({ item, onOpen, onFavorite, tr }: ClipboardRowActionsProps) {
  return (
    <div className={item.favorite ? "row-actions has-favorite" : "row-actions"} onClick={(event) => event.stopPropagation()}>
      {item.analysis.url || item.analysis.attachment ? (
        <button className="icon-button" data-tooltip={tr("main.list.openTarget")} onClick={() => onOpen(item)} title={tr("main.list.openTarget")} type="button">
          <ExternalLink size={14} />
        </button>
      ) : null}
      <button
        className={item.favorite ? "quick-fav faved" : "quick-fav"}
        data-tooltip={item.favorite ? tr("main.list.unfavorite") : tr("main.list.favorite")}
        onClick={(event) => {
          event.stopPropagation();
          onFavorite(item);
        }}
        title={item.favorite ? tr("main.list.unfavorite") : tr("main.list.favorite")}
        type="button"
      >
        <Heart size={13} />
      </button>
    </div>
  );
}

export default ClipboardRowActions;
