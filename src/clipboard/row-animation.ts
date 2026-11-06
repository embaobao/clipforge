/** 行入场动画 epoch 判定（纯函数，供虚拟列表滚动回填静默化）。
 *  背景：row-in 是挂载动画，虚拟窗口滚动回填的新行会无条件重放 stagger 入场——
 *  快速滚动全程逐行闪现（motion-meaning 违例：动画表达了「窗口回填」而非「新数据」）。
 *  判定规则：只有 items 的 id 序列变化（粘贴/筛选/搜索等数据集变化）才允许「该帧挂载的行」
 *  播放入场；id 序列不变（纯滚动、同数据集后台刷新/缓存回放）则静默。
 *  首次（digest 从 null → 有值）视为数据变化。
 *  边界：按 id 序列摘要比较而非引用比较——后台刷新返回同集合时引用必变但语义未变,
 *  引用比较会把这类刷新误判为「新数据」整窗重放(Tab 切回闪烁回归的主因之一)。 */

/** epoch 状态：digest 为 null 表示尚未见过任何数据集（首帧必播）。 */
export type RowAnimEpochState = { digest: string | null; epoch: number };

/** VirtualList 挂载期初始态。 */
export const initialRowAnimEpoch: RowAnimEpochState = { digest: null, epoch: 0 };

/** items → 稳定摘要:长度 + id 串哈希。同集合不同引用 → 同摘要;集合变 → 摘要变。 */
export function clipsDigest(items: readonly { id: string }[] | null): string | null {
  if (!items) return null;
  let hash = 0;
  for (const item of items) {
    for (let i = 0; i < item.id.length; i++) {
      hash = (hash << 5) - hash + item.id.charCodeAt(i);
      hash |= 0;
    }
  }
  return `${items.length}:${hash}`;
}

/** 推进 epoch 并返回「本次 render 挂载的行是否播入场动画」。
 *  每次 VirtualList render 恰好调用一次；返回的 state 必须写回调用方 ref。 */
export function advanceRowAnimEpoch(
  state: RowAnimEpochState,
  items: readonly unknown[] | null,
): { state: RowAnimEpochState; animate: boolean } {
  const digest = clipsDigest(items as readonly { id: string }[] | null);
  const changed = digest !== null && digest !== state.digest;
  const nextState: RowAnimEpochState = changed ? { digest, epoch: state.epoch + 1 } : state;
  return { state: nextState, animate: changed };
}
