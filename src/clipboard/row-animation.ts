/** 行入场动画 epoch 判定（纯函数，供虚拟列表滚动回填静默化）。
 *  背景：row-in 是挂载动画，虚拟窗口滚动回填的新行会无条件重放 stagger 入场——
 *  快速滚动全程逐行闪现（motion-meaning 违例：动画表达了「窗口回填」而非「新数据」）。
 *  判定规则：只有 items 引用变化（粘贴/筛选/搜索等数据集变化）才允许「该帧挂载的行」
 *  播放入场；引用不变（纯滚动）则该帧挂载的行静默。首次（items 从 null → 数组）视为数据变化。
 *  边界：只比较引用不比较内容——调用方保证 items 不可变更新（React SetState 惯例）。 */

/** epoch 状态：items 为 null 表示尚未见过任何数据集（首帧必播）。 */
export type RowAnimEpochState = { items: readonly unknown[] | null; epoch: number };

/** VirtualList 挂载期初始态。 */
export const initialRowAnimEpoch: RowAnimEpochState = { items: null, epoch: 0 };

/** 推进 epoch 并返回「本次 render 挂载的行是否播放入场动画」。
 *  每次 VirtualList render 恰好调用一次；返回的 state 必须写回调用方 ref。 */
export function advanceRowAnimEpoch(
  state: RowAnimEpochState,
  items: readonly unknown[] | null,
): { state: RowAnimEpochState; animate: boolean } {
  const changed = items !== state.items;
  const nextState: RowAnimEpochState = changed ? { items, epoch: state.epoch + 1 } : state;
  return { state: nextState, animate: changed };
}
