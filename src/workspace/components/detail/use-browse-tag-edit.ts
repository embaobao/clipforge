/**
 * 浏览态标签编辑 hook（clipboard-interaction-repair 第 8 项 / 第 1 项）。
 *
 * 做什么：浏览态直接增删标签并即时写回，不进入正文编辑态；写回走 `onUpdateTags`
 * （只带 tags / metadata、不带 content），因此 Rust 侧不重建正文与 representations。
 * 同时托管「添加标签」输入框的未提交文本，供详情页离开保护读取，避免切条目时静默丢弃。
 *
 * 为什么：旧行为要求先进入正文编辑态才能改标签，而整篇保存会重建 representations；
 * 输入框原先是非受控 DOM，键入但未回车的文本外壳拿不到，返回 / 上下条会静默丢弃。
 * 把状态编排独立成 hook，详情页外壳只需一行接线，避免主文件触碰 500 行门禁。
 *
 * 边界：只负责「变更判定 + 防重入 + 错误态 + 输入文本状态」，不构造写回入参、不碰 Tauri 命令；
 * 错误经调用方传入的 `translateError` 脱敏后交给 UI，脱敏原因码由 Rust 侧返回。
 * 切换条目（clipId 变化）时清空输入文本，防止上一条的草稿残留到新条目误弹确认。
 */
import { useCallback, useEffect, useState } from "react";
import type { ClipItem } from "../../../App";
import { planBrowseTagEdit, type BrowseTagEdit } from "./tag-only-save";
import {
  EMPTY_BROWSE_TAG_INPUT,
  reduceBrowseTagInput,
  type BrowseTagInputState,
} from "./browse-tag-input";

/** 浏览态标签编辑的 UI 状态与唯一入口。 */
export type BrowseTagEditState = {
  /** 写回进行中：禁用增删控件防重入，避免同一条目并发写库。 */
  saving: boolean;
  /** 已脱敏的失败原因（空串代表无错误），可关闭。 */
  error: string;
  /** 添加标签输入框状态；`text` 未提交时交由离开保护拦截，不静默丢弃。 */
  input: BrowseTagInputState;
  /** 打开输入框；重新打开时恢复此前保留的未提交文本。 */
  openInput: () => void;
  /** 受控输入变更。 */
  changeInput: (text: string) => void;
  /** 回车提交：有文本才写回，清空输入框但保持打开以便连续添加。 */
  submitInput: (clip: ClipItem) => void;
  /** Escape 显式取消：清空文本并关闭输入框。 */
  cancelInput: () => void;
  /** 失焦：关闭输入框但保留文本，交由离开保护决定是否拦截离开。 */
  blurInput: () => void;
  /** 应用一次增删动作；无实质变化或正在保存时直接跳过，不产生空写。 */
  edit: (clip: ClipItem, action: BrowseTagEdit) => Promise<void>;
  /** 关闭错误提示。 */
  clearError: () => void;
};

/** 错误翻译函数：把命令异常转成可展示的脱敏文案。 */
export type BrowseTagErrorTranslator = (error: unknown) => string;

/** 浏览态标签编辑状态机：写回回调由上层注入（业务数据仍由 Tauri command 驱动）。 */
export function useBrowseTagEdit(
  onUpdateTags: (clip: ClipItem, tags: string[]) => Promise<ClipItem | void>,
  translateError: BrowseTagErrorTranslator,
  clipId: string,
): BrowseTagEditState {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [input, setInput] = useState<BrowseTagInputState>(EMPTY_BROWSE_TAG_INPUT);

  const edit = useCallback(
    async (clip: ClipItem, action: BrowseTagEdit) => {
      if (saving) return;
      const plan = planBrowseTagEdit(clip.tags ?? [], action);
      if (!plan.changed) return;
      setSaving(true);
      setError("");
      try {
        await onUpdateTags(clip, plan.nextTags);
      } catch (cause) {
        setError(translateError(cause));
      } finally {
        setSaving(false);
      }
    },
    [saving, onUpdateTags, translateError],
  );

  // 切换条目时清空未提交文本：详情页外壳复用同一组件实例，草稿不能跨条目残留。
  useEffect(() => {
    setInput(EMPTY_BROWSE_TAG_INPUT);
  }, [clipId]);

  const openInput = useCallback(() => setInput((current) => reduceBrowseTagInput(current, { type: "open" }).state), []);
  const changeInput = useCallback((text: string) => setInput((current) => reduceBrowseTagInput(current, { type: "change", text }).state), []);
  const cancelInput = useCallback(() => setInput((current) => reduceBrowseTagInput(current, { type: "cancel" }).state), []);
  const blurInput = useCallback(() => setInput((current) => reduceBrowseTagInput(current, { type: "blur" }).state), []);
  const submitInput = useCallback(
    (clip: ClipItem) => {
      const transition = reduceBrowseTagInput(input, { type: "submit" });
      setInput(transition.state);
      if (transition.submitText) void edit(clip, { type: "add", value: transition.submitText });
    },
    [input, edit],
  );

  const clearError = useCallback(() => setError(""), []);
  return { saving, error, input, openInput, changeInput, submitInput, cancelInput, blurInput, edit, clearError };
}
