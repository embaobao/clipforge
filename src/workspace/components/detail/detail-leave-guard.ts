/**
 * 详情页「离开保护」统一决策（clipboard-interaction-repair 第 1 项 / 提案 §13）。
 *
 * 做什么：把「正文保存中 / 浏览态标签写回中 / 编辑态正文与标签草稿 / Agent·diff 草稿 /
 * 浏览态标签输入框未提交文本」这五类未保存状态，收敛成一个离开决策，供返回按钮、
 * 上下条切换、详情页 Escape 共用，避免各调用点各写一套判定而漏掉其中一类。
 *
 * 为什么：旧实现的 `confirmDiscardDraft` 对 view 态无条件放行；而第 8 项新增的浏览态
 * 标签编辑恰好发生在 view 态——标签写回进行中切条目会造成并发写库、输入框里已键入
 * 但未回车的文本会被静默丢弃。同时面板键盘层在详情路由下按 Escape 会直接
 * `navigateWorkspaceList()`，绕过详情页的任何确认。
 *
 * 边界：纯函数，不碰 DOM / React / Tauri，也不决定「怎么弹窗」。
 * - `block`：硬拒绝离开。保存/写回进行中不弹确认，防止用户在事务未结束时导航。
 * - `confirm`：有未保存草稿，由调用方决定是否弹窗以及弹什么文案。
 * - `allow`：可安全离开。
 * 实机行为（焦点、确认框可用性、写回时序）不在本模块验证范围内。
 */

/** 详情页三态，与 detail-state.ts 的 DetailMode 保持一致（此处独立声明避免引入 React 依赖）。 */
export type LeaveGuardMode = "view" | "edit" | "diff";

/** 触发离开时需要检查的全部未保存状态快照。字段一律为布尔/枚举，便于静态穷举断言。 */
export interface LeaveGuardSnapshot {
  /** 当前详情三态。view 态也可能存在浏览标签草稿，不能一律放行。 */
  mode: LeaveGuardMode;
  /** 正文整组保存（save_editor_draft）进行中。 */
  isSaving: boolean;
  /** 编辑/diff 态下正文或编辑态标签与库内条目存在差异。 */
  hasDraftChanges: boolean;
  /** 存在 Agent / 提示词优化器产出的待确认草稿（diff 态的 draft）。 */
  hasAgentDraft: boolean;
  /** 浏览态标签独立写回（onUpdateTags）进行中。 */
  browseTagSaving: boolean;
  /** 浏览态标签输入框存在已键入但尚未回车提交的文本（预留给输入受控化切片）。 */
  hasPendingTagInput: boolean;
}

/** 决策动作：允许离开 / 硬拒绝 / 需确认。 */
export type LeaveGuardAction = "allow" | "block" | "confirm";

/** 决策原因码：便于静态断言覆盖每一条路径，后续也可映射为脱敏提示文案。 */
export type LeaveGuardReason =
  | "none"
  | "saving"
  | "browse-tag-saving"
  | "editor-draft"
  | "agent-draft"
  | "pending-tag-input";

/** 离开决策结果。 */
export interface LeaveGuardDecision {
  action: LeaveGuardAction;
  reason: LeaveGuardReason;
}

/**
 * 判定一次离开请求该如何处理。
 *
 * 优先级（从高到低，先命中先返回）：
 * 1. 正文保存中 → block（事务未结束，不弹确认也不导航）
 * 2. 浏览态标签写回中 → block（同上，防同一条目并发写库）
 * 3. 编辑/diff 态存在正文或标签差异 → confirm
 * 4. 存在 Agent / diff 草稿 → confirm
 * 5. view 态存在未提交的浏览标签输入 → confirm（旧实现在此静默丢弃）
 * 6. 其余 → allow
 *
 * 注意：第 3 条只在非 view 态生效。view 态的 `hasDraftChanges` 由外壳用
 * draftContent/draftTags 与 clip 比较得出，浏览态标签写回成功后这两个草稿值
 * 可能滞后于库内数据，若把它算作未保存草稿会导致误弹确认框。
 */
export function decideLeaveGuard(snapshot: LeaveGuardSnapshot): LeaveGuardDecision {
  if (snapshot.isSaving) return { action: "block", reason: "saving" };
  if (snapshot.browseTagSaving) return { action: "block", reason: "browse-tag-saving" };
  if (snapshot.mode !== "view" && snapshot.hasDraftChanges) {
    return { action: "confirm", reason: "editor-draft" };
  }
  if (snapshot.hasAgentDraft) return { action: "confirm", reason: "agent-draft" };
  if (snapshot.hasPendingTagInput) {
    return { action: "confirm", reason: "pending-tag-input" };
  }
  return { action: "allow", reason: "none" };
}

/**
 * 执行离开决策：allow 直接放行，block 直接拒绝，confirm 交给调用方弹窗。
 * `confirm` 为惰性回调，只有真正需要确认时才会被调用（避免每次导航都弹窗）。
 */
export function resolveLeaveGuard(
  snapshot: LeaveGuardSnapshot,
  confirm: () => boolean,
): boolean {
  const decision = decideLeaveGuard(snapshot);
  if (decision.action === "allow") return true;
  if (decision.action === "block") return false;
  return confirm();
}

/** 是否存在任何未保存状态（供键盘层决定是否需要在 view 态拦截 Escape）。 */
export function hasUnsavedDetailWork(snapshot: LeaveGuardSnapshot): boolean {
  return decideLeaveGuard(snapshot).action !== "allow";
}

/** 构造快照的原始输入：由详情页外壳从各处 state 汇总，pendingTagInput 为输入框原始文本。 */
export interface LeaveGuardInput {
  mode: LeaveGuardMode;
  isSaving: boolean;
  hasDraftChanges: boolean;
  hasAgentDraft: boolean;
  browseTagSaving: boolean;
  /**
   * 浏览态标签输入框的原始文本；纯空白视为无草稿，不误弹确认。
   * 当前详情页输入框尚未受控上报，故可选；缺省按空串处理，
   * 待「浏览标签输入受控化」切片接线后自然生效，不改动调用点。
   */
  pendingTagInput?: string;
}

/**
 * 把外壳的原始状态归一化成决策快照。
 * 单独成函数的原因：详情页外壳已 479 行，接近 500 行门禁，判定细节必须留在域模块内；
 * 同时把「空字符串/纯空白不算草稿」这条规则收敛到一处，便于静态穷举断言。
 */
export function buildLeaveGuardSnapshot(input: LeaveGuardInput): LeaveGuardSnapshot {
  return {
    mode: input.mode,
    isSaving: input.isSaving,
    hasDraftChanges: input.hasDraftChanges,
    hasAgentDraft: input.hasAgentDraft,
    browseTagSaving: input.browseTagSaving,
    hasPendingTagInput: (input.pendingTagInput ?? "").trim().length > 0,
  };
}
