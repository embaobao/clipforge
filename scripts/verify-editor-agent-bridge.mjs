import fs from "node:fs";
import path from "node:path";

// 编辑器-代理桥接门禁：验证详情页保存/粘贴/取消/建议链路与 Rust preview_patch 的行为契约。
// 断言分两类（见 codebase-modularity-refactor Phase 2）：
// 1. 结构接线断言：基于 data-editor-action 语义标记与 props 符号，容忍 JSX/格式重排（拆分安全）；
// 2. 行为切片断言：在函数体内做子串/顺序/反向检查——与文件无关、只随函数本体重写失效，
//    保留是因为它们表达「不能绕过写回路径」等业务不变量，无法用标记表达。
const root = process.cwd();
// 详情页外壳与快捷编辑器已按 workspace 拆分提案分文件：
// saveDraftContent/handleCancelEdit/编辑布线在 ClipDetailWorkspace.tsx，编辑器 UI 语义在 DetailQuickEditor.tsx。
const workspacePath = path.join(root, "src/workspace/components/ClipDetailWorkspace.tsx");
const quickEditorPath = path.join(root, "src/workspace/components/DetailQuickEditor.tsx");
// modularity Phase 4：Rust 侧 editor 臂从 lib.rs 迁至 mcp/dispatch_agent_editor.rs。
const rustPath = path.join(root, "src-tauri/src/mcp/dispatch_agent_editor.rs");

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function assert(condition, message) {
  if (!condition) {
    console.error(`Editor Agent bridge verification failed: ${message}`);
    process.exitCode = 1;
  }
}

function sliceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) return "";
  return source.slice(startIndex, endIndex);
}

function sliceBetweenLast(source, start, end) {
  const startIndex = source.lastIndexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) return "";
  return source.slice(startIndex, endIndex);
}

// 取 data-editor-action="<action>" 按钮的元素块（标记 → </button>）。
// 依赖标记存在：按钮重排/样式类变更不受影响；删标记即 FAIL（门禁提醒补标记）。
function actionButtonBlock(source, action) {
  return sliceBetween(source, `data-editor-action="${action}"`, "</button>");
}

const workspace = read(workspacePath);
const quickEditor = read(quickEditorPath);
const rust = read(rustPath);

// ---------- saveDraftContent：保存意图与写回路径（行为切片） ----------
const saveDraftContent = sliceBetween(workspace, "const saveDraftContent = async (", "if (droppedLinkCount > 0");
assert(saveDraftContent.includes('afterSave: "stay" | "copy" | "paste"'), "detail editor save intent is missing copy mode");
assert(saveDraftContent.includes("const savedClip = await onUpdateContent"), "save-and-copy cannot access the saved normalized clip");
assert(saveDraftContent.includes("const postSaveClip = savedClip ?? { ...clip, content: nextContent, tags: nextTags }"), "save-and-copy does not preserve current clip identity after save");
assert(saveDraftContent.includes("onCopy(postSaveClip)"), "save-and-copy does not use the existing clip writeback path");
assert(saveDraftContent.indexOf("const savedClip = await onUpdateContent") < saveDraftContent.indexOf("onCopy(postSaveClip)"), "save-and-copy can copy before save_editor_draft completes");
// 反向断言保留原因：save-and-copy 复用已保存条目（onCopy），若改成 onCopyText 会重新采集一条重复文本条目——历史上出现过该回归。
assert(!saveDraftContent.includes('onCopyText(nextContent, "detail-editor:save-and-copy"'), "save-and-copy should not recapture a separate text clip");

// ---------- 外壳 → DetailQuickEditor 接线（结构断言，容忍格式重排） ----------
const quickEditorJsx = sliceBetween(workspace, "<DetailQuickEditor", "/>");
assert(quickEditorJsx.length > 0, "ClipDetailWorkspace does not render DetailQuickEditor");
assert(/onSaveAndCopy=\{[^}]*saveDraftContent\("copy"\)/.test(quickEditorJsx), "DetailQuickEditor is not wired to save-and-copy");
assert(/onSaveAndPaste=\{[^}]*saveDraftContent\("paste"\)/.test(quickEditorJsx), "DetailQuickEditor is not wired to save-and-paste");
assert(/onSave=\{[^}]*saveDraftContent\(\)/.test(quickEditorJsx), "DetailQuickEditor is not wired to plain save");

// ---------- DetailQuickEditor 动作按钮（data-editor-action 标记块内检查） ----------
const saveAndCopyButton = actionButtonBlock(quickEditor, "save-and-copy");
assert(saveAndCopyButton.length > 0, "save-and-copy button is missing data-editor-action marker");
assert(/onClick=\{onSaveAndCopy\}/.test(saveAndCopyButton), "save-and-copy handler is missing");
const saveAndPasteButton = actionButtonBlock(quickEditor, "save-and-paste");
assert(saveAndPasteButton.length > 0, "save-and-paste button is missing data-editor-action marker");
assert(/onClick=\{onSaveAndPaste\}/.test(saveAndPasteButton), "save-and-paste handler is missing");
const saveButton = actionButtonBlock(quickEditor, "save");
assert(saveButton.length > 0 && /onClick=\{onSave\}/.test(saveButton), "save button is missing marker or handler");
// 三个保存动作共用防误触守卫：草稿有变更 + 非保存中 + 内容非空（token 级检查，容忍表达式格式变化）。
for (const [name, block] of [["save", saveButton], ["save-and-copy", saveAndCopyButton], ["save-and-paste", saveAndPasteButton]]) {
  const guard = sliceBetween(block, "disabled={", "}", );
  assert(guard.includes("!hasChanges") && guard.includes("isSaving") && guard.includes("content.trim"), `${name} button is not protected by draft-change/saving/content guards`);
}

// ---------- 快捷键：Cmd/Ctrl+Enter=保存并粘贴，Cmd/Ctrl+S=保存（行为切片） ----------
assert(quickEditor.includes('tr("main.detail.saveAndCopy")'), "save-and-copy action is not localized");
assert(quickEditor.includes('tr("main.detail.saveAndPaste")'), "save-and-paste action is not localized");
const keydownHandler = sliceBetween(quickEditor, "<textarea", "/>");
assert(/if \(event\.key === "Enter"\)\s*\{\s*onSaveAndPaste\(\);\s*\}\s*else\s*\{\s*onSave\(\);\s*\}/.test(keydownHandler), "Cmd/Ctrl+Enter must save-and-paste and Cmd/Ctrl+S must save");

// ---------- saveDraftContent：save-and-paste 复用 pasteText 路径（行为切片） ----------
assert(saveDraftContent.includes('onPasteText(nextContent, "detail-editor:save-and-paste"'), "save-and-paste does not reuse the existing pasteText path");
assert(saveDraftContent.includes('businessChain: "detail -> compact-editor -> save_editor_draft -> paste"'), "save-and-paste is missing its paste-path business chain");
assert(saveDraftContent.indexOf("const savedClip = await onUpdateContent") < saveDraftContent.indexOf('onPasteText(nextContent, "detail-editor:save-and-paste"'), "save-and-paste can paste before save_editor_draft completes");
// 反向断言保留原因：详情编辑器必须经由外壳写回路径（onCopy/onPasteText），直写系统剪贴板会绕过复制回写抑制与业务链埋点。
assert(!saveDraftContent.includes("writeClipboard("), "detail editor should not write clipboard directly");
assert(!saveDraftContent.includes("pasteClipboard("), "detail editor should not paste clipboard directly");

// ---------- handleCancelEdit：取消不得产生副作用（行为切片） ----------
const handleCancelEdit = sliceBetween(workspace, "const handleCancelEdit = () => {", "const saveDraftContent = async (");
assert(handleCancelEdit.includes("setDraftContent(clip.content)"), "cancel edit does not restore original clip content");
assert(handleCancelEdit.includes("setDraftTags(normalizeDetailTags(clip.tags))"), "cancel edit does not restore original clip tags");
assert(handleCancelEdit.includes("setIsEditing(false)"), "cancel edit does not leave edit mode");
// 反向断言保留原因：取消编辑是纯状态回滚；任何 save/copy/paste 副作用都属「取消即提交」回归。
assert(!handleCancelEdit.includes("onUpdateContent"), "cancel edit can save content");
assert(!handleCancelEdit.includes("onCopy"), "cancel edit can write clipboard");
assert(!handleCancelEdit.includes("onPasteText"), "cancel edit can paste content");

// ---------- 建议请求：失败只报错、不触碰草稿（行为切片） ----------
const suggestionRequest = sliceBetween(quickEditor, "const requestSuggestion = () => {", "const applySuggestion =");
assert(suggestionRequest.includes("setSuggestionError"), "suggestion failures do not surface a local editor error");
assert(suggestionRequest.includes("catch (error)"), "suggestion generation has no failure boundary");
// 反向断言保留原因：建议失败路径若改写草稿/直接应用/直接保存，会把未确认的模型输出写入用户数据。
assert(!suggestionRequest.includes("onChange("), "suggestion failure path can mutate draft content");
assert(!suggestionRequest.includes("onTagsChange("), "suggestion failure path can mutate draft tags");
assert(!suggestionRequest.includes("onApplySuggestion("), "suggestion request path applies changes without explicit user action");
assert(!suggestionRequest.includes("onApplySuggestionAndSave("), "suggestion request path can save without explicit user action");

// ---------- Rust preview_patch：只读预览，不落库不进剪贴板（行为切片，command 名即 API 契约） ----------
const previewPatch = sliceBetweenLast(
  rust,
  "pub(super) fn dispatch_editor_preview_patch",
  "pub(super) fn dispatch_editor_apply_patch",
);
assert(previewPatch.includes('"writesDatabase": false'), "preview_patch response does not declare writesDatabase=false");
assert(previewPatch.includes("load_clip(&conn, id)"), "preview_patch does not load the current item for a before/after preview");
assert(!previewPatch.includes("save_editor_draft"), "preview_patch calls save_editor_draft");
assert(!previewPatch.includes("update_clip_record"), "preview_patch can write through update_clip_record");
assert(!previewPatch.includes("write_clipboard_item"), "preview_patch can write to the system clipboard");

if (!process.exitCode) {
  console.log("Editor Agent bridge verification passed");
}
