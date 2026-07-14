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
