#!/usr/bin/env node
/**
 * 关键词联想门禁（clipboard-search-and-tag-quality 第 3 项）。
 *
 * 验证目标：汉字前缀提示包含它的常用词；比输入短的词、输入本身已是完整常用词、汉字字母混输都不提示；
 * 英文按前缀提示；没有同前缀英文词时按注入的拼音（声母或全拼）提示汉字词；返回值就是下拉项的形状。
 * 关键词模块本身无依赖，沿用「编译到系统临时目录再导入」的做法。
 * 下拉组装（clip-search.ts 的 buildSearchSuggestions）带项目内依赖，改用 Vite 按项目配置加载后断言。
 * 纯逻辑断言，不需要 GUI / 解锁 / 网络，不替代面板实机走查。
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const outDir = mkdtempSync(join(tmpdir(), "clipforge-keyword-"));

try {
  execFileSync(
    join(root, "node_modules/.bin/tsc"),
    [
      "--target", "ES2022",
      "--module", "ESNext",
      "--moduleResolution", "bundler",
      "--lib", "ES2022,DOM",
      "--strict",
      "--skipLibCheck",
      "--outDir", outDir,
      "src/clipboard/keyword-suggestions.ts",
    ],
    { cwd: root, stdio: "inherit" },
  );
  // 临时目录里没有 package.json，Node 会把 .js 当 CommonJS，改名成 .mjs 才能按 ESM 加载。
  renameSync(join(outDir, "keyword-suggestions.js"), join(outDir, "keyword-suggestions.mjs"));
  const { buildKeywordIndex, suggestKeywords } = await import(
    pathToFileURL(join(outDir, "keyword-suggestions.mjs")).href
  );
  const labels = (index, input, options) => suggestKeywords(index, input, options).map((item) => item.label);

  const index = buildKeywordIndex([
    "插件化平台启动接线",
    "跨平台剪贴板",
    "平台启动顺序",
    "剪贴板历史记录",
    "剪贴板快捷键",
    "标注证据",
    "标注证据",
    "Read the README before review",
    "README review request",
    "review the request",
  ]);

  // ---------- 汉字前缀：提示包含它的常用词，词内碎片不出现 ----------
  assert.deepEqual(labels(index, "台"), ["平台"]);
  assert.deepEqual(labels(index, "剪贴"), ["剪贴板"], "只提示完整词：剪贴、贴板、剪贴板历都是碎片");
  assert.deepEqual(labels(index, "证据"), ["标注证据"]);
  assert.deepEqual(labels(index, "板"), ["剪贴板"]);
  assert.deepEqual(suggestKeywords(index, "台"), [
    { id: "keyword:平台", label: "平台", hint: "3", kind: "keyword" },
  ]);

  // ---------- 不提示：输入本身已是常用词、没有这种连续字、混输、超长 ----------
  assert.deepEqual(labels(index, "平台"), [], "输入已是完整常用词时不提示，回车直接粘贴");
  assert.deepEqual(labels(index, "标注证据"), []);
  assert.deepEqual(labels(index, "台平"), []);
  assert.deepEqual(labels(index, "平a"), []);
  assert.deepEqual(labels(index, "剪贴板历史"), []);

  // ---------- 英文前缀：按条目数排序，大小写不敏感 ----------
  assert.deepEqual(labels(index, "re"), ["review", "README", "request"]);
  assert.deepEqual(labels(index, "REQ"), ["request"]);
  assert.deepEqual(labels(index, "zz"), []);

  // ---------- 拼音：没有同前缀英文词时按声母或全拼提示汉字词 ----------
  const syllables = { 平: "ping", 台: "tai", 剪: "jian", 贴: "tie", 板: "ban", 标: "biao", 注: "zhu", 证: "zheng", 据: "ju" };
  const syllablesOf = (han) => [...han].map((char) => syllables[char] ?? "");
  assert.deepEqual(labels(index, "pt"), [], "没有拼音注入时不做拼音匹配");
  assert.deepEqual(labels(index, "pt", { syllablesOf }), ["平台"]);
  assert.deepEqual(labels(index, "jtb", { syllablesOf }), ["剪贴板"]);
  assert.deepEqual(labels(index, "pingtai", { syllablesOf }), ["平台"]);

  // ---------- 上限 ----------
  const many = buildKeywordIndex(Array.from({ length: 9 }, (_, i) => `配置项${i} 参数表${i}`));
  const words = ["平台", "看台", "前台", "后台", "阳台", "站台", "讲台", "台词"].flatMap((word) => [word, word]);
  assert.equal(suggestKeywords(buildKeywordIndex(words), "台").length, 6, "下拉最多 6 条");
  assert.deepEqual(labels(many, "配"), ["配置项"], "出现 9 次的「配置」本身是完整词，不提示，只提示更长的「配置项」");

  // ---------- 下拉组装：用项目自己的 Vite 配置加载真实模块（裸模块路径、类型导入都由它解析） ----------
  // 不弹面板、不抢键盘焦点；面板像素与按键走查仍靠实机。
  const { createServer } = await import("vite");
  const server = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
  try {
    const search = await server.ssrLoadModule("/src/clipboard/clip-search.ts");
    const clip = (id, content, tags = [], extra = {}) => ({
      id,
      content,
      plainText: content,
      searchText: null,
      tags,
      kind: "text",
      favorite: false,
      deletedAt: null,
      analysis: { title: "", summary: "", host: "" },
      ...extra,
    });
    const clips = [
      clip("a", "插件化平台启动接线 https://example.com"),
      clip("b", "跨平台剪贴板"),
      clip("c", "跨平台复制失败", ["甲"]),
      clip("d", "平台", ["旧"], { deletedAt: 1 }),
      clip("e", "会议纪要", ["乙"]),
      clip("f", "会议纪要", ["甲"]),
      clip("g", "会议纪要", ["丙"]),
    ];
    const labelOf = {
      "main.searchSuggestion.favorite": "收藏",
      "main.searchSuggestion.link": "链接",
      "main.searchSuggestion.command": "命令",
      "main.searchSuggestion.rule": "规则",
    };
    const base = search.buildBaseSearchSuggestions(clips, { tagRules: [] }, (key) => labelOf[key] ?? key);
    const indexFor = () => buildKeywordIndex(clips.filter((item) => !item.deletedAt).map(search.getKeywordSource));
    const names = (query, options) => search.buildSearchSuggestions(clips, query, base, options).map((item) => item.label);

    assert.deepEqual(names("台"), [], "没有索引就不做关键词联想");
    assert.deepEqual(names("台", { keywordIndex: indexFor }), ["平台"]);
    assert.deepEqual(names("会", { keywordIndex: indexFor }), ["会议纪要"]);
    assert.deepEqual(names("平台", { keywordIndex: indexFor }), [], "输入已是常用词时不提示");
    assert.deepEqual(names("@收", { keywordIndex: indexFor }), ["收藏"], "@ 过滤器不受关键词联想影响");
    assert.deepEqual(names("#"), ["甲", "丙", "乙"], "# 标签按出现次数排序，同数按字典序；已删除条目不计数");
    assert.deepEqual(search.buildSearchSuggestions(clips, "#甲", base), [
      { id: "tag:甲", label: "甲", hint: "2", kind: "saved", tag: "甲" },
    ]);
    assert.deepEqual(names("pt", { keywordIndex: indexFor }), []);
    assert.deepEqual(names("pt", { keywordIndex: indexFor, pinyinEnabled: true }), ["平台"], "开关打开时用真实拼音库匹配");
  } finally {
    await server.close();
  }

  console.log("[unit] keyword-suggestions passed");
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
