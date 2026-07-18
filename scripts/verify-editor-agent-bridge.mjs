import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const workspacePath = path.join(root, "src/workspace/workspace-panels.tsx");
const rustPath = path.join(root, "src-tauri/src/lib.rs");

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

const workspace = read(workspacePath);
const rust = read(rustPath);

const saveDraftContent = sliceBetween(workspace, "const saveDraftContent = async (", "if (droppedLinkCount > 0");
assert(saveDraftContent.includes('afterSave: "stay" | "copy" | "paste"'), "detail editor save intent is missing copy mode");
assert(saveDraftContent.includes("const savedClip = await onUpdateContent"), "save-and-copy cannot access the saved normalized clip");
assert(saveDraftContent.includes("const postSaveClip = savedClip ?? { ...clip, content: nextContent, tags: nextTags }"), "save-and-copy does not preserve current clip identity after save");
assert(saveDraftContent.includes("onCopy(postSaveClip)"), "save-and-copy does not use the existing clip writeback path");
assert(saveDraftContent.indexOf("const savedClip = await onUpdateContent") < saveDraftContent.indexOf("onCopy(postSaveClip)"), "save-and-copy can copy before save_editor_draft completes");
assert(!saveDraftContent.includes('onCopyText(nextContent, "detail-editor:save-and-copy"'), "save-and-copy should not recapture a separate text clip");
assert(workspace.includes('onSaveAndCopy={() => void saveDraftContent("copy")}'), "DetailQuickEditor is not wired to save-and-copy");
assert(workspace.includes('tr("main.detail.saveAndCopy")'), "save-and-copy action is not localized");
assert(workspace.includes('onSaveAndPaste={() => void saveDraftContent("paste")}'), "DetailQuickEditor is not wired to save-and-paste");
assert(workspace.includes('tr("main.detail.saveAndPaste")'), "save-and-paste action is not localized");
assert(saveDraftContent.includes('onPasteText(nextContent, "detail-editor:save-and-paste"'), "save-and-paste does not reuse the existing pasteText path");
assert(saveDraftContent.includes('businessChain: "detail -> compact-editor -> save_editor_draft -> paste"'), "save-and-paste is missing its paste-path business chain");
assert(saveDraftContent.indexOf("const savedClip = await onUpdateContent") < saveDraftContent.indexOf('onPasteText(nextContent, "detail-editor:save-and-paste"'), "save-and-paste can paste before save_editor_draft completes");
assert(!saveDraftContent.includes("writeClipboard("), "detail editor should not write clipboard directly");
assert(!saveDraftContent.includes("pasteClipboard("), "detail editor should not paste clipboard directly");

const handleCancelEdit = sliceBetween(workspace, "const handleCancelEdit = () => {", "const saveDraftContent = async (");
assert(handleCancelEdit.includes("setDraftContent(clip.content)"), "cancel edit does not restore original clip content");
assert(handleCancelEdit.includes("setDraftTags(normalizeDetailTags(clip.tags))"), "cancel edit does not restore original clip tags");
assert(handleCancelEdit.includes("setIsEditing(false)"), "cancel edit does not leave edit mode");
assert(!handleCancelEdit.includes("onUpdateContent"), "cancel edit can save content");
assert(!handleCancelEdit.includes("onCopy"), "cancel edit can write clipboard");
assert(!handleCancelEdit.includes("onPasteText"), "cancel edit can paste content");

const detailQuickEditor = sliceBetween(workspace, "function DetailQuickEditor({", "function AvailableFormatsRow");
assert(detailQuickEditor.includes('onSaveAndPaste();'), "Cmd/Ctrl+Enter does not use save-and-paste");
assert(detailQuickEditor.includes('onSave();'), "Cmd/Ctrl+S does not use save");
assert(detailQuickEditor.includes('disabled={!hasChanges || isSaving || !content.trim()} type="button" onClick={onSaveAndCopy}'), "save-and-copy button is not protected by draft-change/saving/content guards");
assert(detailQuickEditor.includes('disabled={!hasChanges || isSaving || !content.trim()} type="button" onClick={onSaveAndPaste}'), "save-and-paste button is not protected by draft-change/saving/content guards");

const suggestionRequest = sliceBetween(workspace, "const requestSuggestion = () => {", "const applySuggestion =");
assert(suggestionRequest.includes("setSuggestionError"), "suggestion failures do not surface a local editor error");
assert(suggestionRequest.includes("catch (error)"), "suggestion generation has no failure boundary");
assert(!suggestionRequest.includes("onChange("), "suggestion failure path can mutate draft content");
assert(!suggestionRequest.includes("onTagsChange("), "suggestion failure path can mutate draft tags");
assert(!suggestionRequest.includes("onApplySuggestion("), "suggestion request path applies changes without explicit user action");
assert(!suggestionRequest.includes("onApplySuggestionAndSave("), "suggestion request path can save without explicit user action");

const previewPatch = sliceBetweenLast(
  rust,
  '"clipboard.editor.preview_patch" => {',
  '"clipboard.editor.apply_patch" | "clipboard.editor.save" => {',
);
assert(previewPatch.includes('"writesDatabase": false'), "preview_patch response does not declare writesDatabase=false");
assert(previewPatch.includes("load_clip(&conn, id)"), "preview_patch does not load the current item for a before/after preview");
assert(!previewPatch.includes("save_editor_draft"), "preview_patch calls save_editor_draft");
assert(!previewPatch.includes("update_clip_record"), "preview_patch can write through update_clip_record");
assert(!previewPatch.includes("write_clipboard_item"), "preview_patch can write to the system clipboard");

if (!process.exitCode) {
  console.log("Editor Agent bridge verification passed");
}
