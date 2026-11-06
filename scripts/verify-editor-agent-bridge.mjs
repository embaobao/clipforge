import fs from "node:fs";
import path from "node:path";

// 编辑器-代理桥接门禁：验证详情页保存/退出/建议链路与 Rust preview_patch 的行为契约。
// 断言分两类（见 codebase-modularity-refactor Phase 2）：
// 1. 结构接线断言：基于 data-editor-action / data-md-* / data-detail-action 语义标记与 props 符号，容忍 JSX/格式重排（拆分安全）；
// 2. 行为切片断言：在函数体内做子串/顺序/反向检查——与文件无关、只随函数本体重写失效，
//    保留是因为它们表达「不能绕过写回路径」等业务不变量，无法用标记表达。
// 2026-10 详情页信息架构重构（detail-page-information-architecture v8）：
//   编辑器 UI 由 DetailQuickEditor.tsx 迁至 detail/md-editor.tsx（11 工具钮 + 编辑/预览 tab + 状态行），
//   三态状态机（view/edit/diff）落在外壳；saveDraftContent 语义保持「先保存再复制/粘贴」。
const root = process.cwd();
// 详情页外壳（三态编排）与新 MD 编辑器分文件：
// saveDraftContent/handleExitEdit/编辑布线在 ClipDetailWorkspace.tsx，编辑器 UI 语义在 detail/md-editor.tsx。
const workspacePath = path.join(root, "src/workspace/components/ClipDetailWorkspace.tsx");
const mdEditorPath = path.join(root, "src/workspace/components/detail/md-editor.tsx");
// modularity Phase 4：Rust 侧 editor 臂从 lib.rs 迁至 mcp/dispatch_agent_editor.rs。
const rustPath = path.join(root, "src-tauri/src/mcp/dispatch_agent_editor.rs");

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function assert(condition, message) {
  if (!condition) {
    console.error(`Editor agent bridge verification failed: ${message}`);
    process.exitCode = 1;
  }
}

function sliceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  if (startIndex === -1) return "";
  const endIndex = source.indexOf(end, startIndex);
  return endIndex === -1 ? "" : source.slice(startIndex, endIndex);
}

function sliceBetweenLast(source, start, end) {
  const startIndex = source.lastIndexOf(start);
  if (startIndex === -1) return "";
  const endIndex = source.indexOf(end, startIndex);
  return endIndex === -1 ? "" : source.slice(startIndex, endIndex);
}

const workspace = read(workspacePath);
const mdEditor = read(mdEditorPath);
const rust = read(rustPath);

// ---------- saveDraftContent：保存写回路径（行为切片） ----------
const saveDraftContent = sliceBetween(workspace, "const saveDraftContent = async (", "const handleCopyPath =");
assert(saveDraftContent.includes("await onUpdateContent(clip, nextContent, nextTags"), "save is not wired to onUpdateContent with tags");
// 空内容守卫：保存前拦截空草稿（历史回归：空内容清库）。
assert(saveDraftContent.includes('tr("main.detail.emptyContent")'), "save does not guard against empty content");

// ---------- 外壳 → MdEditor 接线（结构断言，容忍格式重排） ----------
const mdEditorJsx = sliceBetween(workspace, "<MdEditor", "/>");
assert(mdEditorJsx.length > 0, "ClipDetailWorkspace does not render MdEditor");
assert(/onSave=\{[^}]*saveDraftContent\(/.test(mdEditorJsx), "MdEditor is not wired to plain save");
assert(/onCancel=\{handleExitEdit\}/.test(mdEditorJsx), "MdEditor is not wired to cancel");

// ---------- MdEditor 键盘：⌘S 保存 / Esc 退出（行为切片） ----------
const keydownHandler = sliceBetween(mdEditor, "const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {", "const wordCount");
assert(/key === "s"\s*\)/.test(keydownHandler), "Cmd/Ctrl+S must be handled in the editor keydown");
assert(/onSave\(\)/.test(keydownHandler), "Cmd/Ctrl+S must trigger save");
assert(/event\.key === "Escape"/.test(keydownHandler), "Escape must be handled in the editor keydown");
assert(/onCancel\(\)/.test(keydownHandler), "Escape must trigger cancel");

// ---------- MdEditor 工具条标记（结构断言） ----------
assert(mdEditor.includes('data-md-textarea'), "MdEditor textarea is missing data-md-textarea marker");
assert(mdEditor.includes('data-md-preview'), "MdEditor preview pane is missing data-md-preview marker");
assert(mdEditor.includes('data-md-tab="edit"') && mdEditor.includes('data-md-tab="preview"'), "MdEditor edit/preview tabs are missing markers");

// ---------- saveDraftContent：错误边界（行为切片） ----------
assert(saveDraftContent.includes("catch (error)"), "saveDraftContent has no failure boundary");
assert(saveDraftContent.includes('tr("main.detail.saveFailed"'), "save failures do not surface localized errors");

// ---------- handleExitEdit：退出不得产生副作用（行为切片） ----------
const handleExitEdit = sliceBetween(workspace, "const handleExitEdit = () => {", "const saveDraftContent = async (");
assert(handleExitEdit.includes("setDraftContent(clip.content)"), "exit edit does not restore original clip content");
assert(handleExitEdit.includes("setDraftTags(normalizeDetailTags(clip.tags))"), "exit edit does not restore original clip tags");
assert(handleExitEdit.includes('setMode("view")'), "exit edit does not leave edit mode");
// 反向断言保留原因：退出编辑是纯状态回滚；任何 save/copy/paste 副作用都属「取消即提交」回归。
assert(!handleExitEdit.includes("onUpdateContent"), "exit edit can save content");
assert(!handleExitEdit.includes("onCopy"), "exit edit can write clipboard");
assert(!handleExitEdit.includes("onPasteText"), "exit edit can paste content");

// ---------- 三态状态机：view/edit/diff（结构断言，v8 契约） ----------
assert(workspace.includes('type DetailMode = "view" | "edit" | "diff"') || workspace.includes('DetailMode'), "detail shell must consume the three-state DetailMode contract");
assert(workspace.includes("isEditableClip(clip)"), "edit entry is not guarded by isEditableClip (image/file are read-only)");
assert(workspace.includes("hasRichRepresentation(clip)"), "rich copy is not guarded by hasRichRepresentation");
assert(workspace.includes('onCopyPlain(clip)'), "primary copy button must use onCopyPlain (plain-text semantics)");
assert(/onCopyRich=\{\(\) => onCopy\(clip\)\}/.test(workspace), "rich copy button must reuse the existing rich writeback path onCopy");

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
