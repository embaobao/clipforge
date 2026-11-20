/**
 * 浏览态标签输入框的未提交文本状态机（clipboard-interaction-repair 第 1 / 第 8 项）。
 *
 * 做什么：把「打开 / 输入 / 回车提交 / Escape 取消 / 失焦关闭」五种动作收敛成纯状态转移，
 *         并把未提交文本暴露给详情页离开保护（detail-leave-guard），供切条目与返回时拦截。
 *
 * 为什么：旧实现是非受控 input，Enter 后直接把 DOM value 置空、外壳拿不到已键入但未提交的文本；
 *         用户在输入框里打了字再点「下一条 / 返回」，文本会被静默丢弃，违反提案 §13
 *         「上下切换、返回、关闭均保护正文、标签与 Agent 草稿」。
 *
 * 边界：纯函数，不碰 DOM / React / Tauri，只决定文本与开合状态，不负责写回，也不决定怎么弹确认框。
 *       纯空白文本一律不算草稿（与 buildLeaveGuardSnapshot 的 trim 口径一致）。
 * 状态规则：
 * - open：打开输入框，恢复此前保留的文本（失焦后重新打开不丢输入）。
 * - change：累积文本，输入框保持打开。
 * - submit：返回待提交文本并清空输入框；输入框仍打开，便于连续添加多个标签。
 * - cancel：显式取消（Escape），清空文本并关闭。
 * - blur：只关闭输入框、保留文本，交由离开保护捕获；不静默丢弃。
 * - reset：切换条目时清空，避免上一条的未提交文本残留到新条目上误弹确认。
 */

/** 浏览态标签输入框状态：是否展开 + 已键入但尚未提交的原始文本。 */
export type BrowseTagInputState = {
  open: boolean;
  text: string;
};

/** 初始状态：输入框关闭、无未提交文本。 */
export const EMPTY_BROWSE_TAG_INPUT: BrowseTagInputState = { open: false, text: "" };

/** 输入框动作集合，供 UI 直接派发，避免在组件里散落 setState 细节。 */
export type BrowseTagInputAction =
  | { type: "open" }
  | { type: "change"; text: string }
  | { type: "submit" }
  | { type: "cancel" }
  | { type: "blur" }
  | { type: "reset" };

/** 一次转移的结果：下一状态 + 本次应写回的文本（仅 submit 可能非空）。 */
export type BrowseTagInputTransition = {
  state: BrowseTagInputState;
  submitText: string;
};

/**
 * 状态转移。submit 返回 trim 后的文本，空白输入返回空串（调用方据此跳过空写）；
 * blur 保留文本是刻意设计：失焦不等于放弃输入，留下文本让离开保护决定是否拦截。
 */
export function reduceBrowseTagInput(
  state: BrowseTagInputState,
  action: BrowseTagInputAction,
): BrowseTagInputTransition {
  switch (action.type) {
    case "open":
      return { state: { open: true, text: state.text }, submitText: "" };
    case "change":
      return { state: { open: true, text: action.text }, submitText: "" };
    case "submit":
      return { state: { open: true, text: "" }, submitText: state.text.trim() };
    case "cancel":
      return { state: { open: false, text: "" }, submitText: "" };
    case "blur":
      return { state: { open: false, text: state.text }, submitText: "" };
    case "reset":
      return { state: { ...EMPTY_BROWSE_TAG_INPUT }, submitText: "" };
  }
}

/** 是否存在未提交输入（纯空白不算草稿），供 UI 禁用态与静态断言复用。 */
export function hasPendingBrowseTagInput(state: BrowseTagInputState): boolean {
  return state.text.trim().length > 0;
}
