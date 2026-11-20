#!/usr/bin/env node
/**
 * 详情离开保护静态门禁（clipboard-interaction-repair 第 1 项 / 提案 §13）。
 *
 * 验证目标：
 * 1. 正文保存中、浏览态标签写回中一律硬拒绝离开（不弹窗、不导航），防并发写库；
 * 2. 编辑/diff 态草稿、Agent 草稿、view 态未提交标签输入需确认，不得静默丢弃；
 * 3. view 态无草稿直接放行，且不把编辑态草稿比较结果误算成 view 态草稿；
 * 4. 详情页键盘层已接管 view 态 Escape，面板层无条件 navigateWorkspaceList 的绕过
 *    被 capture 阶段 preventDefault/stopPropagation + defaultPrevented 双保险堵住；
 * 5. 各调用点均已接线（返回按钮、上下条、Escape、纯函数决策、500 行门禁）。
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
const outDir = mkdtempSync(join(tmpdir(), "clipforge-leave-guard-"));

/** 读取源码用于接线静态断言。 */
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
      "src/workspace/components/detail/detail-leave-guard.ts",
    ],
    { cwd: root, stdio: "inherit" },
  );
  const mod = await import(pathToFileURL(join(outDir, "workspace/components/detail/detail-leave-guard.js")).href);

  // ---------- 快照构造：trim、可选字段缺省、原样透传 ----------
  const base = {
    mode: "view", isSaving: false, hasDraftChanges: false,
    hasAgentDraft: false, browseTagSaving: false,
  };
  assert.deepEqual(mod.buildLeaveGuardSnapshot({ ...base }), { ...base, hasPendingTagInput: false });
  assert.equal(mod.buildLeaveGuardSnapshot({ ...base, pendingTagInput: "   " }).hasPendingTagInput, false,
    "纯空白输入不算草稿，不误弹确认");
  assert.equal(mod.buildLeaveGuardSnapshot({ ...base, pendingTagInput: " #tag " }).hasPendingTagInput, true);

  // ---------- 决策：干净 view 态直接放行 ----------
  assert.deepEqual(mod.decideLeaveGuard(mod.buildLeaveGuardSnapshot({ ...base })),
    { action: "allow", reason: "none" });
  // view 态即便外壳算出 hasDraftChanges（编辑态草稿值滞后），也不得误判为草稿
  assert.deepEqual(mod.decideLeaveGuard(mod.buildLeaveGuardSnapshot({ ...base, hasDraftChanges: true })),
    { action: "allow", reason: "none" }, "view 态忽略编辑态草稿比较，避免误弹确认");

  // ---------- 决策：硬阻止优先于一切确认 ----------
  assert.deepEqual(mod.decideLeaveGuard(mod.buildLeaveGuardSnapshot({ ...base, isSaving: true })),
    { action: "block", reason: "saving" });
  assert.deepEqual(mod.decideLeaveGuard(mod.buildLeaveGuardSnapshot({ ...base, browseTagSaving: true })),
    { action: "block", reason: "browse-tag-saving" }, "浏览标签写回中必须硬阻止");
  assert.deepEqual(mod.decideLeaveGuard(mod.buildLeaveGuardSnapshot({
    ...base, isSaving: true, browseTagSaving: true, mode: "edit", hasDraftChanges: true, hasAgentDraft: true,
  })), { action: "block", reason: "saving" }, "正文保存优先级最高");
  assert.deepEqual(mod.decideLeaveGuard(mod.buildLeaveGuardSnapshot({
    ...base, browseTagSaving: true, mode: "edit", hasDraftChanges: true, hasAgentDraft: true,
  })), { action: "block", reason: "browse-tag-saving" }, "写回中优先级高于编辑态草稿");

  // ---------- 决策：各类草稿需确认 ----------
  assert.deepEqual(mod.decideLeaveGuard(mod.buildLeaveGuardSnapshot({
    ...base, mode: "edit", hasDraftChanges: true,
  })), { action: "confirm", reason: "editor-draft" });
  assert.deepEqual(mod.decideLeaveGuard(mod.buildLeaveGuardSnapshot({
    ...base, mode: "diff", hasAgentDraft: true,
  })), { action: "confirm", reason: "agent-draft" });
  assert.deepEqual(mod.decideLeaveGuard(mod.buildLeaveGuardSnapshot({
    ...base, hasAgentDraft: true,
  })), { action: "confirm", reason: "agent-draft" }, "view 态残留 Agent 草稿同样要确认");
  assert.deepEqual(mod.decideLeaveGuard(mod.buildLeaveGuardSnapshot({
    ...base, pendingTagInput: "新标签",
  })), { action: "confirm", reason: "pending-tag-input" }, "view 态未提交标签输入不得静默丢弃");
  assert.deepEqual(mod.decideLeaveGuard(mod.buildLeaveGuardSnapshot({
    ...base, mode: "edit", hasDraftChanges: true, pendingTagInput: "x",
  })), { action: "confirm", reason: "editor-draft" }, "编辑态草稿优先于未提交标签输入");

  // ---------- resolveLeaveGuard：confirm 惰性调用、block 不调用 ----------
  let confirmCalls = 0;
  const ask = () => { confirmCalls += 1; return true; };
  assert.equal(mod.resolveLeaveGuard(mod.buildLeaveGuardSnapshot({ ...base }), ask), true);
  assert.equal(confirmCalls, 0, "allow 不得弹确认");
  assert.equal(mod.resolveLeaveGuard(mod.buildLeaveGuardSnapshot({ ...base, isSaving: true }), ask), false);
  assert.equal(confirmCalls, 0, "block 不得弹确认，也不能放行");
  assert.equal(mod.resolveLeaveGuard(mod.buildLeaveGuardSnapshot({
    ...base, mode: "edit", hasDraftChanges: true,
  }), ask), true);
  assert.equal(confirmCalls, 1, "confirm 恰好弹一次");
  assert.equal(mod.resolveLeaveGuard(mod.buildLeaveGuardSnapshot({
    ...base, mode: "edit", hasDraftChanges: true,
  }), () => false), false, "用户取消则不放行");
  assert.equal(mod.hasUnsavedDetailWork(mod.buildLeaveGuardSnapshot({ ...base })), false);
  assert.equal(mod.hasUnsavedDetailWork(mod.buildLeaveGuardSnapshot({ ...base, browseTagSaving: true })), true);
  assert.equal(mod.hasUnsavedDetailWork(mod.buildLeaveGuardSnapshot({
    ...base, mode: "diff", hasAgentDraft: true,
  })), true);

  // ---------- 接线：详情页外壳调用统一决策，返回/上下条/Escape 共用 ----------
  const shell = read("src/workspace/components/ClipDetailWorkspace.tsx");
  assert.match(shell, /buildLeaveGuardSnapshot\(/, "外壳必须构造统一快照");
  assert.match(shell, /resolveLeaveGuard\(leaveSnapshot/, "confirmDiscardDraft 必须走统一决策");
  assert.match(shell, /hasUnsavedDetailWork\(leaveSnapshot\)/, "键盘层必须拿到未保存判定");
  assert.match(shell, /onRequestLeave: requestLeave/, "view 态 Escape 必须接到统一离开请求");
  assert.match(shell, /if \(confirmDiscardDraft\(\)\) onBack\(\)/, "crumb 返回按钮仍走同一保护");
  assert.match(shell, /const goPrevious = \(\) => \{[\s\S]{0,160}confirmDiscardDraft\(\)/, "上一条走同一保护");
  assert.match(shell, /const goNext = \(\) => \{[\s\S]{0,160}confirmDiscardDraft\(\)/, "下一条走同一保护");
  assert.ok(!/const confirmDiscardDraft = \(\) => !isSaving && \(mode === "view"/.test(shell),
    "旧的对 view 态无条件放行的判定必须已移除");
  assert.ok(shell.split("\n").length <= 500, "ClipDetailWorkspace.tsx 不得破 500 行门禁");

  // ---------- 接线：详情键盘层 capture 阶段接管 view 态 Escape ----------
  const keyboard = read("src/workspace/components/detail/use-detail-keyboard.ts");
  assert.match(keyboard, /addEventListener\("keydown", onKeyDown, true\)/, "详情键盘层必须是 capture 阶段");
  assert.match(keyboard, /mode === "view" && hasUnsavedWork && !editable && !inMenuLayer/,
    "view 态接管必须同时排除输入与菜单层");
  assert.match(keyboard, /\[role='menu'\], \[role='menuitem'\], \[data-radix-popper-content-wrapper\]/,
    "Radix 菜单/弹层必须保留原生 Escape");
  assert.match(keyboard, /event\.preventDefault\(\)[\s\S]{0,120}event\.stopPropagation\(\)[\s\S]{0,120}onRequestLeave\(\)/,
    "接管分支必须 preventDefault + stopPropagation 后调用统一离开请求");
  assert.match(keyboard, /onRequestLeave, hasUnsavedWork, onPrevious, onNext\]/, "effect deps 必须包含新增字段");

  // ---------- 双保险：面板层 Escape 以 defaultPrevented 让位 ----------
  const panel = read("src/clipboard/use-panel-keyboard.ts");
  assert.match(panel, /if \(event\.defaultPrevented\) return;/,
    "面板层必须保留 defaultPrevented 让位，作为 capture 拦截之外的第二道保险");
  assert.match(panel, /if \(workspaceRoute\.name !== "list"\) \{[\s\S]{0,160}navigateWorkspaceList\(\)/,
    "确认面板层仍存在详情路由下的无条件导航分支（本轮不改动全局热路径）");

  // ---------- 门禁挂载与业务索引 ----------
  const pkg = read("package.json");
  assert.match(pkg, /node scripts\/verify-detail-leave-guard\.mjs/, "单测必须挂入 pnpm test:unit");
  const index = read("docs/BUSINESS_INDEX.md");
  assert.match(index, /detail-leave-guard\.ts/, "业务索引必须登记新模块");

  console.log("detail-leave-guard checks passed");
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
