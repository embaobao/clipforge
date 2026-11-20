#!/usr/bin/env node
/**
 * 浏览态标签未提交输入保护静态门禁（clipboard-interaction-repair 第 1 / 第 8 项 / 提案 §13）。
 *
 * 验证目标：
 * 1. 输入框状态机：打开恢复文本、输入累积、回车提交清空且返回 trim 值、
 *    Escape 显式取消才清空、失焦只关闭不丢文本、切条目 reset 清空；
 * 2. 纯空白不算草稿，与 detail-leave-guard.buildLeaveGuardSnapshot 的 trim 口径一致；
 * 3. 未提交文本经 useBrowseTagEdit 接线到外壳离开保护快照（pendingTagInput），
 *    使返回 / 上下条 / view 态 Escape 触发确认而非静默丢弃；
 * 4. 输入框已受控（value + onChange），Escape 保留原生取消且不冒泡成离开请求；
 * 5. 切条目按 clipId reset，上一条的草稿不残留到新条目；
 * 6. 500 行门禁、单测挂载、业务索引登记。
 *
 * 纯静态断言 + 零依赖纯函数单测，不需要 GUI / 解锁 / 网络，也不替代沙箱实机走查。
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const outDir = mkdtempSync(join(tmpdir(), "clipforge-browse-tag-input-"));
const read = (p) => readFileSync(join(root, p), "utf8");

try {
  execFileSync(
    join(root, "node_modules/.bin/tsc"),
    [
      "--target", "ES2022",
      "--module", "NodeNext",
      "--moduleResolution", "NodeNext",
      "--lib", "ES2022,DOM",
      "--strict",
      "--skipLibCheck",
      "--rootDir", "src",
      "--outDir", outDir,
      "src/workspace/components/detail/browse-tag-input.ts",
      "src/workspace/components/detail/detail-leave-guard.ts",
    ],
    { cwd: root, stdio: "inherit" },
  );
  const mod = await import(pathToFileURL(join(outDir, "workspace/components/detail/browse-tag-input.js")).href);
  const guard = await import(pathToFileURL(join(outDir, "workspace/components/detail/detail-leave-guard.js")).href);

  const empty = { open: false, text: "" };
  assert.deepEqual(mod.EMPTY_BROWSE_TAG_INPUT, empty);

  // ---------- 打开：恢复此前失焦保留的文本 ----------
  const opened = mod.reduceBrowseTagInput(empty, { type: "open" });
  assert.deepEqual(opened.state, { open: true, text: "" });
  assert.equal(opened.submitText, "");
  assert.deepEqual(mod.reduceBrowseTagInput({ open: false, text: "草稿" }, { type: "open" }).state,
    { open: true, text: "草稿" }, "失焦后重新打开必须恢复未提交文本");

  // ---------- 输入：累积文本、保持打开 ----------
  const typed = mod.reduceBrowseTagInput(opened.state, { type: "change", text: " #新标签 " });
  assert.deepEqual(typed.state, { open: true, text: " #新标签 " });
  assert.equal(typed.submitText, "");

  // ---------- 提交：返回 trim 值、清空输入框但保持打开 ----------
  const submitted = mod.reduceBrowseTagInput(typed.state, { type: "submit" });
  assert.deepEqual(submitted.state, { open: true, text: "" }, "回车后清空文本、仍可连续添加");
  assert.equal(submitted.submitText, "#新标签", "提交文本需 trim 后交给写回");
  assert.equal(mod.reduceBrowseTagInput({ open: true, text: "   " }, { type: "submit" }).submitText, "",
    "纯空白不得触发空写");

  // ---------- 取消：显式放弃，清空并关闭 ----------
  assert.deepEqual(mod.reduceBrowseTagInput(typed.state, { type: "cancel" }).state, empty);
  assert.equal(mod.reduceBrowseTagInput(typed.state, { type: "cancel" }).submitText, "");

  // ---------- 失焦：只关闭、保留文本，交给离开保护 ----------
  const blurred = mod.reduceBrowseTagInput(typed.state, { type: "blur" });
  assert.deepEqual(blurred.state, { open: false, text: " #新标签 " }, "失焦绝不静默丢弃未提交文本");
  assert.equal(blurred.submitText, "");

  // ---------- reset：切条目清空 ----------
  assert.deepEqual(mod.reduceBrowseTagInput(blurred.state, { type: "reset" }).state, empty);

  // ---------- 草稿判定：纯空白不算 ----------
  assert.equal(mod.hasPendingBrowseTagInput(empty), false);
  assert.equal(mod.hasPendingBrowseTagInput({ open: true, text: "   " }), false);
  assert.equal(mod.hasPendingBrowseTagInput(blurred.state), true);

  // ---------- 与离开保护联动：失焦保留的文本必须触发 confirm ----------
  const base = { mode: "view", isSaving: false, hasDraftChanges: false, hasAgentDraft: false, browseTagSaving: false };
  assert.deepEqual(guard.decideLeaveGuard(guard.buildLeaveGuardSnapshot({ ...base, pendingTagInput: blurred.state.text })),
    { action: "confirm", reason: "pending-tag-input" }, "view 态未提交标签输入不得静默放行");
  assert.deepEqual(guard.decideLeaveGuard(guard.buildLeaveGuardSnapshot({ ...base, pendingTagInput: "   " })),
    { action: "allow", reason: "none" }, "纯空白不误弹确认");
  assert.equal(guard.hasUnsavedDetailWork(guard.buildLeaveGuardSnapshot({ ...base, pendingTagInput: "草稿" })), true,
    "键盘层必须据此接管 view 态 Escape");
  assert.deepEqual(guard.decideLeaveGuard(guard.buildLeaveGuardSnapshot({ ...base, browseTagSaving: true, pendingTagInput: "草稿" })),
    { action: "block", reason: "browse-tag-saving" }, "写回中硬阻止优先");

  // ---------- 接线：hook 暴露状态机动作、按 clipId reset ----------
  const hook = read("src/workspace/components/detail/use-browse-tag-edit.ts");
  assert.match(hook, /reduceBrowseTagInput\(/, "hook 必须复用纯状态机，不得另写一套判定");
  assert.match(hook, /useEffect\(\(\) => \{[\s\S]{0,120}EMPTY_BROWSE_TAG_INPUT[\s\S]{0,80}\}, \[clipId\]\)/,
    "必须按 clipId 清空，防止草稿跨条目残留");
  assert.match(hook, /submitInput[\s\S]{0,400}type: "submit"/, "回车提交必须走状态机");
  assert.match(hook, /const blurInput = useCallback/, "失焦动作必须存在且保留文本");
  assert.match(hook, /input: BrowseTagInputState/, "输入状态必须暴露给外壳");

  // ---------- 接线：输入框受控 + Escape 保留原生取消 ----------
  const row = read("src/workspace/components/detail/detail-meta-row.tsx");
  assert.match(row, /value=\{browseTagEdit\.input\.text\}/, "输入框必须受控，文本才可被外壳读取");
  assert.match(row, /onChange=\{\(event\) => browseTagEdit\.changeInput\(/, "输入变更必须上报状态机");
  assert.match(row, /onBlur=\{browseTagEdit\.blurInput\}/, "失焦必须走保留文本的 blurInput");
  assert.match(row, /browseTagEdit\.submitInput\(clip\)/, "回车必须走 submitInput 统一写回");
  assert.match(row, /event\.stopPropagation\(\)[\s\S]{0,80}browseTagEdit\.cancelInput\(\)/,
    "输入框 Escape 显式取消，且不得冒泡触发详情离开请求");
  assert.match(row, /browseTagEdit\.input\.open \?/, "开合状态由 hook 单一事实源驱动");
  assert.ok(!/setBrowseTagInputOpen/.test(row), "不得再保留组件内独立的非受控开合状态");
  // 只检查浏览态输入框块：编辑态 input 的 DOM 清空写法属另一条工作流，本切片不动。
  const browseInputBlock = row.slice(row.indexOf("data-browse-tag-input"), row.indexOf("data-browse-tag-add"));
  assert.ok(browseInputBlock.length > 0, "必须能定位浏览态输入框块");
  assert.ok(!/event\.currentTarget\.value = ""/.test(browseInputBlock),
    "浏览态输入框不得再直接清空 DOM value（会绕过状态机）");

  // ---------- 接线：外壳把未提交文本送入离开保护快照 ----------
  const shell = read("src/workspace/components/ClipDetailWorkspace.tsx");
  assert.match(shell, /pendingTagInput: browseTagEdit\.input\.text/, "外壳必须把未提交文本交给离开保护");
  assert.match(shell, /useBrowseTagEdit\(onUpdateTags, translateTagError, clip\?\.id \?\? ""\)/,
    "外壳必须传可空安全的 clipId 以 reset");
  assert.ok(shell.split("\n").length <= 500, "ClipDetailWorkspace.tsx 不得破 500 行门禁");
  assert.ok(row.split("\n").length <= 500, "detail-meta-row.tsx 不得破 500 行门禁");
  assert.ok(hook.split("\n").length <= 500, "use-browse-tag-edit.ts 不得破 500 行门禁");
  assert.ok(read("src/workspace/components/detail/browse-tag-input.ts").split("\n").length <= 500,
    "browse-tag-input.ts 不得破 500 行门禁");

  // ---------- 门禁挂载与业务索引 ----------
  const pkg = read("package.json");
  assert.match(pkg, /node scripts\/verify-browse-tag-input\.mjs/, "单测必须挂入 pnpm test:unit");
  const index = read("docs/BUSINESS_INDEX.md");
  assert.match(index, /browse-tag-input\.ts/, "业务索引必须登记新模块");

  console.log("browse-tag-input checks passed (state machine, leave-guard wiring, controlled input)");
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
