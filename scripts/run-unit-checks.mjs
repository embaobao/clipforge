import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const outDir = mkdtempSync(join(tmpdir(), "clipforge-unit-"));

try {
  execFileSync(
    join(root, "node_modules/.bin/tsc"),
    [
      "--target",
      "ES2022",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "--lib",
      "ES2022,DOM",
      "--strict",
      "--skipLibCheck",
      "--rootDir",
      "src",
      "--outDir",
      outDir,
      "src/search-query.ts",
      "src/smart-format.ts",
      "src/plugin-actions.ts",
      "src/editor/suggestions.ts",
      "src/editor/actions.ts",
      "src/editor/sensitive.ts",
    ],
    { cwd: root, stdio: "inherit" },
  );

  const search = await import(pathToFileURL(join(outDir, "search-query.js")).href);
  const smart = await import(pathToFileURL(join(outDir, "smart-format.js")).href);
  const actions = await import(pathToFileURL(join(outDir, "plugin-actions.js")).href);
  const suggestionsModule = await import(pathToFileURL(join(outDir, "editor/suggestions.js")).href);
  const editorActions = await import(pathToFileURL(join(outDir, "editor/actions.js")).href);
  const editorSensitive = await import(pathToFileURL(join(outDir, "editor/sensitive.js")).href);

  const suggestions = [
    { id: "all", label: "全部内容", hint: "9", kind: "all", typeFilter: "all" },
    { id: "favorite", label: "收藏", hint: "2", kind: "favorite" },
    { id: "file", label: "文件", hint: "3", kind: "type", typeFilter: "file" },
    { id: "image", label: "图片", hint: "1", kind: "type", typeFilter: "image" },
    { id: "json", label: "JSON", hint: "4", kind: "type", typeFilter: "json" },
    { id: "saved:AI", label: "AI", hint: "规则", kind: "saved", tag: "AI" },
  ];

  const parsed = search.parseSearchCommand("#AI type:image file:.png bucket:trash favorite error log", suggestions);
  assert.equal(parsed.handled, true);
  assert.equal(parsed.queryText, "error log");
  assert.deepEqual(parsed.ast.tags, ["AI"]);
  assert.deepEqual(parsed.ast.types, ["image"]);
  assert.deepEqual(parsed.ast.fileExtensions, ["png"]);
  assert.equal(parsed.ast.bucket, "trash");
  assert.equal(parsed.filterFavorite, true);

  const aliasParsed = search.parseSearchCommand("@file: kind:url tag:work", suggestions);
  assert.deepEqual(aliasParsed.ast.types, ["file"]);
  assert.deepEqual(aliasParsed.ast.kinds, ["link"]);
  assert.deepEqual(aliasParsed.ast.tags, ["work"]);
  const imageShortcutParsed = search.parseSearchCommand("@img: screenshot", suggestions);
  assert.deepEqual(imageShortcutParsed.ast.types, ["image"]);
  assert.equal(imageShortcutParsed.queryText, "screenshot");

  const invalidParsed = search.parseSearchCommand("@missing type:unknown kept", suggestions);
  assert.deepEqual(invalidParsed.ast.invalidTokens, ["@missing", "type:unknown"]);
  assert.equal(invalidParsed.queryText, "kept");
  assert.equal(search.matchesSearchSuggestionToken(suggestions[2], "@files"), true);
  assert.equal(search.getSearchSuggestionToken(suggestions[3]), "@img:");

  const jsonMinify = smart.analyzeSmartFormats('{\n  "b": 2,\n  "a": 1\n}').find((item) => item.kind === "json_minify");
  assert.equal(jsonMinify?.output, '{"b":2,"a":1}');

  const jsonRepair = smart.analyzeSmartFormats("{foo:'bar',}").find((item) => item.kind === "json_repair");
  assert.equal(jsonRepair?.error, "");
  assert.match(jsonRepair?.output ?? "", /"foo": "bar"/);

  const invalidRepair = smart.analyzeSmartFormats("{foo:'bar'").find((item) => item.kind === "json_repair");
  assert.ok(invalidRepair);
  assert.notEqual(invalidRepair.error, "");
  assert.equal(invalidRepair.output, "");

  const escaped = smart.analyzeSmartFormats(JSON.stringify('{"ok":true}')).find((item) => item.kind === "json_unescape");
  assert.match(escaped?.output ?? "", /"ok": true/);

  const urlDecoded = smart.analyzeSmartFormats("https%3A%2F%2Fexample.com%2Fa%20b").find((item) => item.kind === "url");
  assert.equal(urlDecoded?.output, "https://example.com/a b");

  const linkResolution = actions.resolvePrimaryPluginAction(
    {
      id: "clip_link",
      content: "https://example.com/path",
      kind: "link",
      payloadKind: "link",
      analysis: { url: "https://example.com/path" },
    },
    { surface: "quick-action", shortcut: "Mod+J" },
  );
  assert.equal(linkResolution.selected.pluginId, "builtin.open-link");
  assert.equal(linkResolution.selected.targetValue, "https://example.com/path");
  assert.equal(linkResolution.parsedTargets.some((target) => target.kind === "url"), true);

  const parsedLinkResolution = actions.resolvePrimaryPluginAction(
    {
      id: "clip_parsed_link",
      content: "see https://example.com/from-content",
      kind: "text",
      payloadKind: "text",
      analysis: {},
    },
    { surface: "quick-action", shortcut: "Mod+J" },
  );
  assert.equal(parsedLinkResolution.selected.pluginId, "builtin.open-link");
  assert.equal(parsedLinkResolution.selected.targetValue, "https://example.com/from-content");

  const textResolution = actions.resolvePrimaryPluginAction(
    {
      id: "clip_text",
      content: "plain note",
      kind: "text",
      payloadKind: "text",
      analysis: {},
    },
    { surface: "quick-action", shortcut: "Mod+J" },
  );
  assert.equal(textResolution.selected.pluginId, "builtin.open-detail");

  for (const manifest of actions.builtinPluginManifests) {
    assert.equal(actions.validatePluginManifest(manifest).valid, true);
  }
  const expandedManifest = {
    ...actions.builtinPluginManifests[1],
    permissions: { ...actions.builtinPluginManifests[1].permissions, allowRunCommand: true },
  };
  assert.deepEqual(actions.detectPluginPermissionExpansion(actions.builtinPluginManifests[1], expandedManifest), [
    { permission: "allowRunCommand", previous: false, next: true },
  ]);
  assert.deepEqual(
    actions.builtinCapabilityVersionRecords(123).map((record) => record.kind),
    ["app", "builtin-manifest", "builtin-manifest"],
  );

  const editorSuggestion = suggestionsModule.buildLocalEditorSuggestion({
    sessionId: "editor_clip",
    draftVersion: 2,
    content: "note #AI #work",
    tags: ["work"],
    suggestedTags: ["AI", "work"],
  });
  assert.deepEqual(editorSuggestion.tagPatch?.add, ["AI"]);
  assert.equal(editorSuggestion.contentPatch, undefined);
  const appliedSuggestion = suggestionsModule.applyEditorSuggestion("note #AI #work", ["work"], editorSuggestion);
  assert.deepEqual(appliedSuggestion.tags, ["work", "AI"]);

  const repairSuggestion = suggestionsModule.buildLocalEditorSuggestion({
    sessionId: "editor_json",
    draftVersion: 1,
    content: "{foo:'bar',}",
    tags: [],
    suggestedTags: [],
  });
  assert.equal(repairSuggestion.contentPatch?.type, "replaceDocument");
  assert.match(repairSuggestion.contentPatch?.replacement ?? "", /"foo": "bar"/);

  const replaceSelection = editorActions.previewEditorPluginAction(
    "hello world",
    ["old"],
    { type: "replaceSelection", text: "ClipForge" },
    { start: 6, end: 11 },
  );
  assert.equal(replaceSelection.valid, true);
  assert.equal(replaceSelection.content, "hello ClipForge");

  const missingSelection = editorActions.previewEditorPluginAction("hello", [], { type: "replaceSelection", text: "x" });
  assert.equal(missingSelection.valid, false);

  const insertText = editorActions.previewEditorPluginAction("hello", [], { type: "insertText", text: "!" });
  assert.equal(insertText.content, "hello!");

  const tagPreview = editorActions.previewEditorPluginAction("hello", ["old"], {
    type: "updateTags",
    tagPatch: { add: ["AI"], remove: ["old"], keep: [] },
  });
  assert.deepEqual(tagPreview.tags, ["AI"]);

  assert.deepEqual(
    editorSensitive.detectSensitiveEditorFields("Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456").map((finding) => finding.kind),
    ["bearer-token"],
  );
  assert.deepEqual(editorSensitive.detectSensitiveEditorFields("normal note"), []);

  console.log("[unit] search-query, smart-format, plugin-action, editor-suggestion, editor-action, and sensitive checks passed");
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
