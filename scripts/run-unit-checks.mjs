import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
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
      "src/clipboard/row-animation.ts",
      "src/clipboard/csv-export.ts",
      "src/clipboard/csv-file-export.ts",
      "src/settings/settings-code-snippets.ts",
    ],
    { cwd: root, stdio: "inherit" },
  );

  const search = await import(pathToFileURL(join(outDir, "search-query.js")).href);
  const snippetsModule = await import(pathToFileURL(join(outDir, "settings/settings-code-snippets.js")).href);
  const smart = await import(pathToFileURL(join(outDir, "smart-format.js")).href);
  const actions = await import(pathToFileURL(join(outDir, "plugin-actions.js")).href);
  const suggestionsModule = await import(pathToFileURL(join(outDir, "editor/suggestions.js")).href);
  const editorActions = await import(pathToFileURL(join(outDir, "editor/actions.js")).href);
  const editorSensitive = await import(pathToFileURL(join(outDir, "editor/sensitive.js")).href);
  // renderer-registry 走 Vite 无扩展名导入且依赖 app 侧共享模块，用 vite 内置 esbuild 打包成 CJS 再 require。
  const registryOut = join(outDir, "registry.cjs");
  execFileSync(
    join(root, "node_modules/vite/node_modules/.bin/esbuild"),
    [
      join(root, "src/workspace/components/detail/renderer-registry.ts"),
      "--bundle",
      "--platform=node",
      "--format=cjs",
      `--outfile=${registryOut}`,
    ],
    { cwd: root, stdio: "inherit" },
  );
  const registry = createRequire(import.meta.url)(registryOut);

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

  // ---------- 行入场动画 epoch 判定（滚动回填静默化，Phase 1 / M1-M2 验收） ----------
  const rowAnim = await import(pathToFileURL(join(outDir, "clipboard/row-animation.js")).href);
  {
    const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const first = rowAnim.advanceRowAnimEpoch(rowAnim.initialRowAnimEpoch, items);
    assert.equal(first.animate, true, "首帧挂载的行播放入场（首屏 stagger 保留）");
    const scrolled = rowAnim.advanceRowAnimEpoch(first.state, items);
    assert.equal(scrolled.animate, false, "items 引用不变（纯滚动回填）静默");
    assert.equal(scrolled.state.epoch, first.state.epoch, "epoch 不因滚动递增");
    const refreshed = rowAnim.advanceRowAnimEpoch(scrolled.state, [...items]);
    assert.equal(refreshed.animate, false, "同 id 集合新引用（后台刷新/缓存回放）静默");
    assert.equal(refreshed.state.epoch, scrolled.state.epoch, "epoch 不因同集刷新递增");
    const pasted = rowAnim.advanceRowAnimEpoch(scrolled.state, [{ id: "z" }, ...items]);
    assert.equal(pasted.animate, true, "数据集变化恢复入场（粘贴/筛选保留 stagger）");
    assert.equal(pasted.state.epoch, scrolled.state.epoch + 1, "epoch 随数据变化递增");
    const cleared = rowAnim.advanceRowAnimEpoch(pasted.state, []);
    assert.equal(cleared.animate, true, "清空列表也是数据集变化");
    const refilled = rowAnim.advanceRowAnimEpoch(cleared.state, [{ id: "z" }]);
    assert.equal(refilled.animate, true, "空→非空恢复入场");
  }

  // ---------- 详情页渲染注册表 golden（迁移前后命中表零变化，提案 Phase 6） ----------
  {
    const mk = (patch) => ({
      id: "c",
      content: "",
      kind: "text",
      payloadKind: "text",
      primaryFormat: "text/plain",
      analysis: {},
      ...patch,
    });
    const hit = (clip, renderers) => registry.resolveDetailRenderer(clip, renderers).component;
    assert.equal(hit(mk({ payloadKind: "image" })), "readonly-image");
    assert.equal(hit(mk({ payloadKind: "file" })), "file-list");
    assert.equal(hit(mk({ payloadKind: "html" })), "html");
    assert.equal(hit(mk({ kind: "link", analysis: { url: "https://x.dev" } })), "link");
    assert.equal(hit(mk({ analysis: { attachment: { isImage: true, targetType: "url" } } })), "image-url");
    assert.equal(hit(mk({ content: '{"a":1}' })), "json-tree");
    assert.equal(hit(mk({ kind: "markdown", analysis: { isMarkdown: true } })), "markdown");
    assert.equal(hit(mk({ content: "just plain text" })), "smart-format");
    // 精确 payloadKind 压过 heuristic：html 条目带 url 仍渲染 html。
    assert.equal(hit(mk({ payloadKind: "html", analysis: { url: "https://x.dev" } })), "html");
    // 插件合入：image 恒宿主渲染（信任边界），插件命中以 order 200 参与排序。
    const merged = registry.mergePluginRenderers([
      { id: "p.image", match: { payloadKind: "image" }, component: "markdown" },
      { id: "p.md-ext", match: { payloadKind: "text", extensions: [".md"] }, component: "markdown" },
    ]);
    assert.equal(hit(mk({ payloadKind: "image" }), merged), "readonly-image");
    assert.equal(
      hit(
        mk({ payloadKind: "text", representations: [{ format: "application/file-list", fileName: "notes.md" }] }),
        merged,
      ),
      "markdown",
    );
    assert.equal(hit(mk({ payloadKind: "file" }), merged), "file-list");
  }
  // ---------- 多选表格 / CSV 导出安全构建（clipboard-interaction-repair 第 5 项） ----------
  {
    const csv = await import(pathToFileURL(join(outDir, "clipboard/csv-export.js")).href);

    // RFC 4180：逗号、双引号、CR/LF 触发包裹；内部引号翻倍；null/undefined 归一为空串。
    assert.equal(csv.escapeDelimitedCell("a,b", ",", true), '"a,b"');
    assert.equal(csv.escapeDelimitedCell('say "hi"', ",", true), '"say ""hi"""');
    assert.equal(csv.escapeDelimitedCell("line1\nline2", ",", true), '"line1\nline2"');
    assert.equal(csv.escapeDelimitedCell("line1\r\nline2", ",", true), '"line1\r\nline2"');
    assert.equal(csv.escapeDelimitedCell("plain", ",", true), "plain");
    assert.equal(csv.escapeDelimitedCell(null, ",", true), "");
    assert.equal(csv.escapeDelimitedCell(undefined, ",", true), "");
    // TSV 用制表符分隔：含 tab 的单元格必须被包裹，否则串列。
    assert.equal(csv.escapeDelimitedCell("a\tb", "\t", true), '"a\tb"');
    assert.equal(csv.escapeDelimitedCell("a,b", "\t", true), "a,b");

    // 表格公式注入防护：= + @ 与非法 - 开头前置单引号，前导空白不能绕过。
    assert.equal(csv.guardCsvFormula("=SUM(A1:A2)"), "'=SUM(A1:A2)");
    assert.equal(csv.guardCsvFormula("+1+1"), "'+1+1");
    assert.equal(csv.guardCsvFormula("@SUM(A1)"), "'@SUM(A1)");
    assert.equal(csv.guardCsvFormula("-cmd|' /C calc'!A0"), "'-cmd|' /C calc'!A0");
    assert.equal(csv.guardCsvFormula("  =2+2"), "'  =2+2");
    assert.equal(csv.guardCsvFormula("\t=2+2"), "'\t=2+2");
    // 合法负数与普通文本不改写，避免破坏数值语义。
    assert.equal(csv.guardCsvFormula("-12.5"), "-12.5");
    assert.equal(csv.guardCsvFormula("-1e3"), "-1e3");
    assert.equal(csv.guardCsvFormula("hello"), "hello");
    assert.equal(csv.guardCsvFormula(""), "");
    // guardFormula=false 时保留原文。
    assert.equal(csv.escapeDelimitedCell("=1+1", ",", false), "=1+1");

    // 表格组装：表头、BOM、行结束符、公式防护组合生效。
    assert.equal(
      csv.buildDelimitedTable([["a", "b"], ["c,d", "e"]], { delimiter: ",", lineEnding: "\r\n", withBom: false, guardFormula: true }),
      'a,b\r\n"c,d",e',
    );
    assert.ok(
      csv.buildDelimitedTable([["x"]], { delimiter: ",", headers: ["H"], lineEnding: "\r\n", withBom: true, guardFormula: true }).startsWith("\uFEFFH\r\nx"),
    );

    // 条目投影：两列（复制表格）与三列（CSV 文件）两种形态。
    const items = [
      { title: "First", kind: "text", content: "line1\nline2" },
      { title: "=2+2", kind: "image", content: "a,b" },
    ];
    assert.deepEqual(csv.clipRowsToDelimitedRows(items, false), [
      ["First", "line1\nline2"],
      ["=2+2", "a,b"],
    ]);
    assert.deepEqual(csv.clipRowsToDelimitedRows(items, true)[0], ["First", "text", "line1\nline2"]);

    // 复制到剪贴板的表格：TSV、两列、LF、无 BOM，空白折叠防串列，公式前缀防护。
    // 与 CSV 文件不同：TSV 走粘贴路径，折叠空白而不套引号，保持既有粘贴兼容性。
    const clipboardTable = csv.buildClipboardTable(items);
    assert.equal(
      clipboardTable,
      "First\tline1 line2\n'=2+2\ta,b",
      "两列 TSV：换行折叠为空格、标题公式前缀防护、逗号保留为字面量",
    );

    // CSV 文件：逗号分隔、CRLF、BOM、三列、表头注入、组合转义。
    const csvFile = csv.buildCsvFileContent(items, ["标题", "类型", "内容"]);
    assert.ok(csvFile.startsWith("\uFEFF标题,类型,内容\r\n"));
    assert.ok(csvFile.includes('"a,b"'), "逗号单元格应被包裹");
    assert.ok(csvFile.includes("'=2+2"), "CSV 文件同样防公式注入");
  }
  // ---------- 多选 CSV 文件导出编排 / 按类型分割 / 部分失败报告（clipboard-interaction-repair 第 5 项） ----------
  {
    const csvFileExport = await import(pathToFileURL(join(outDir, "clipboard/csv-file-export.js")).href);

    // 标题兜底：空串与纯空白都回退到 i18n 注入的「未命名」，正文与类型不改。
    const rows = csvFileExport.toCsvExportRows(
      [
        { id: "1", title: "  ", kind: "text", content: "a,b" },
        { id: "2", title: "Named", kind: "image", content: "=1+1" },
      ],
      "未命名",
    );
    assert.deepEqual(rows, [
      { title: "未命名", kind: "text", content: "a,b" },
      { title: "Named", kind: "image", content: "=1+1" },
    ]);

    // 空选区不产出内容，也不抛错，由调用方提示。
    assert.deepEqual(csvFileExport.buildCsvFileExportPlan([], ["标题", "类型", "内容"], "未命名"), {
      content: "",
      rowCount: 0,
    });
    const plan = csvFileExport.buildCsvFileExportPlan(
      [
        { id: "1", title: "", kind: "text", content: "line1\nline2" },
        { id: "2", title: "=2+2", kind: "image", content: "a,b" },
      ],
      ["标题", "类型", "内容"],
      "未命名",
    );
    assert.equal(plan.rowCount, 2);
    assert.ok(plan.content.startsWith("\uFEFF标题,类型,内容\r\n"), "CSV 文件应带 BOM 与 i18n 表头");
    assert.ok(plan.content.includes('"a,b"'), "逗号单元格应按 RFC 4180 包裹");
    assert.ok(plan.content.includes("'=2+2"), "CSV 文件应防表格公式注入");
    assert.ok(plan.content.includes('"line1\nline2"'), "正文换行应保留并转义，不被折叠");

    // 按类型分割：文本进 CSV、图片/文件按原始路径复制、缺失项单列、未检查不误报缺失。
    const split = csvFileExport.planSplitExport([
      { id: "t", title: "T", kind: "text", content: "text" },
      { id: "h", title: "H", kind: "html", content: "<b>x</b>" },
      { id: "i", title: "I", kind: "image", content: "/img/a.png", filePath: "/img/a.png", pathAvailable: true },
      { id: "f", title: "F", kind: "file", content: "/f/b.txt", filePath: "/f/b.txt", pathAvailable: false },
      { id: "m", title: "M", kind: "file", content: "", filePath: null },
      { id: "u", title: "U", kind: "image", content: "/img/u.png", filePath: "/img/u.png" },
      { id: "o", title: "O", kind: "rtf", content: "{\\rtf}" },
      { id: "x", title: "X", kind: "unknown", content: "?" },
    ]);
    assert.deepEqual(split.textItems.map((item) => item.id), ["t", "h", "o"]);
    assert.deepEqual(split.fileItems.map((item) => item.id), ["i", "u"]);
    assert.deepEqual(split.missingItems.map((item) => item.id), ["f", "m"], "显式不可用与无路径都算缺失");
    assert.deepEqual(split.otherItems.map((item) => item.id), ["x"]);
    assert.deepEqual(split.groups, [
      { group: "text", count: 3 },
      { group: "image", count: 2 },
      { group: "file", count: 0 },
      { group: "other", count: 1 },
    ]);

    // 部分失败汇总：任一失败/缺失即 partial，原因码去重且不回显正文或路径。
    const summary = csvFileExport.summarizeExportOutcome([
      { id: "1", outcome: "success" },
      { id: "2", outcome: "failed", reasonCode: "CLIP_CSV_EXPORT_FILE_FAILED" },
      { id: "3", outcome: "failed", reasonCode: "CLIP_CSV_EXPORT_FILE_FAILED" },
      { id: "4", outcome: "missing", reasonCode: "CLIP_CSV_SOURCE_MISSING" },
    ]);
    assert.deepEqual(summary, {
      total: 4,
      succeeded: 1,
      failed: 2,
      missing: 1,
      partial: true,
      reasonCodes: ["CLIP_CSV_EXPORT_FILE_FAILED", "CLIP_CSV_SOURCE_MISSING"],
    });
    const allOk = csvFileExport.summarizeExportOutcome([
      { id: "1", outcome: "success" },
      { id: "2", outcome: "success" },
    ]);
    assert.deepEqual(allOk, {
      total: 2, succeeded: 2, failed: 0, missing: 0, partial: false, reasonCodes: [],
    });
    assert.equal(csvFileExport.summarizeExportOutcome([]).partial, false, "空结果不应误报部分失败");

    // 按类型分割导出请求：路径状态注入 + 写盘前复核（clipboard-interaction-repair 第 5 项）。
    const statuses = {
      "/tmp/ok.png": { exists: true, isFile: true },
      "/tmp/gone.pdf": { exists: false, isFile: false },
      "/tmp/dir.png": { exists: true, isFile: false },
    };
    const projected = csvFileExport.projectExportSources(
      [
        { id: "t", title: "T", kind: "text", content: "a" },
        { id: "i", title: "I", kind: "image", content: "img", filePath: "/tmp/ok.png" },
        { id: "f", title: "F", kind: "file", content: "doc", filePath: "/tmp/gone.pdf" },
        { id: "d", title: "D", kind: "image", content: "dir", filePath: "/tmp/dir.png" },
        { id: "u", title: "U", kind: "file", content: "unknown", filePath: "/tmp/unchecked.zip" },
      ],
      statuses,
    );
    assert.equal(projected[0].pathAvailable, undefined, "文本条目无需路径状态");
    assert.equal(projected[1].pathAvailable, true, "命中状态表且为普通文件 → 可用");
    assert.equal(projected[2].pathAvailable, false, "命中状态表但不存在 → 缺失");
    assert.equal(projected[3].pathAvailable, false, "目录不应被判定为可复制文件");
    assert.equal(projected[4].pathAvailable, undefined, "未命中状态表保持「尚未检查」，不误报缺失");

    // 复核结果覆盖 stale 快照：原本可用的 ok.png 复核为不可用后移出 files 并计入缺失。
    const request = csvFileExport.buildSplitExportRequest(
      projected,
      ["标题", "类型", "内容"],
      "未命名",
      { "/tmp/ok.png": false, "/tmp/gone.pdf": false, "/tmp/dir.png": false, "/tmp/unchecked.zip": true },
    );
    assert.equal(request.csvRowCount, 5, "CSV 清单必须包含全部条目（含文件类）");
    assert.ok(request.csvContent.startsWith("\uFEFF标题,类型,内容\r\n"), "CSV 清单仍带 BOM 与表头");
    assert.ok(request.csvContent.includes("unknown"), "未复核的文件类条目仍保留在 CSV 清单中");
    assert.deepEqual(request.files, [{ id: "u", path: "/tmp/unchecked.zip" }], "仅路径复核可用的文件类进入原始文件复制");
    assert.equal(request.split.missingItems.length, 3, "复核后不可用的文件类全部单列为缺失");
    assert.deepEqual(request.split.textItems.map((item) => item.id), ["t"], "文本类不进入原始文件复制");

    // 表格公式注入防护在分割导出清单里同样生效。
    const guarded = csvFileExport.buildSplitExportRequest(
      [{ id: "x", title: "=2+2", kind: "text", content: "=1+1" }],
      ["标题", "类型", "内容"],
      "未命名",
      {},
    );
    assert.ok(guarded.csvContent.includes("'=2+2"), "标题公式前缀防护");
    assert.ok(guarded.csvContent.includes("'=1+1"), "正文公式前缀防护");
    assert.deepEqual(guarded.files, []);

    // 空选区不产出内容，也不抛错，由调用方提示。
    const empty = csvFileExport.buildSplitExportRequest([], ["标题", "类型", "内容"], "未命名", {});
    assert.deepEqual(empty, {
      csvContent: "",
      csvRowCount: 0,
      files: [],
      split: {
        textItems: [],
        fileItems: [],
        missingItems: [],
        otherItems: [],
        groups: [
          { group: "text", count: 0 },
          { group: "image", count: 0 },
          { group: "file", count: 0 },
          { group: "other", count: 0 },
        ],
      },
    });
  }

  // settings-code-snippets: MCP/Agent 纯文案构造,golden 冻结。
  const mcpJson = JSON.parse(snippetsModule.buildMcpServerConfigJson("/Applications/ClipForge.app/Contents/MacOS/clipforge --mcp"));
  assert.equal(mcpJson.mcpServers.clipforge.command, "/Applications/ClipForge.app/Contents/MacOS/clipforge", "mcp 配置 command 应剥掉 --mcp 尾缀");
  assert.deepEqual(mcpJson.mcpServers.clipforge.args, ["--mcp"], "mcp 配置 args 应为 [\"--mcp\"]");
  const providers = JSON.parse(snippetsModule.buildAgentProviderTemplateText()).agent.providers;
  assert.equal(providers.length, 2, "provider 模板应包含两个 provider");
  assert.deepEqual(providers.map((p) => p.id), ["openai-main", "local-openai-compatible"], "provider 模板 id 应保持 openai-main/local-openai-compatible");
  assert.ok(snippetsModule.buildJsonRpcExamples().includes("tools/call"), "JSON-RPC 示例应包含 tools/call");
  console.log("[unit] settings-code-snippets checks passed");
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
