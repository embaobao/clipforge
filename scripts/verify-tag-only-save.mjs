#!/usr/bin/env node
/**
 * 标签独立写回静态门禁（clipboard-interaction-repair 第 8 项 / 提案 §24）。
 *
 * 验证目标：只改标签时写回入参绝不带 content，Rust 侧不会重建 representations /
 * plain_text / content_hash；provenance 增量合并保留既有来源；浏览态增删不产生空写。
 * 纯静态断言，不需要 GUI / 解锁 / 网络，也不替代沙箱实机走查。
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const outDir = mkdtempSync(join(tmpdir(), "clipforge-tag-only-"));

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
      "src/workspace/components/detail/tag-only-save.ts",
    ],
    { cwd: root, stdio: "inherit" },
  );
  const mod = await import(pathToFileURL(join(outDir, "workspace/components/detail/tag-only-save.js")).href);

  // ---------- 标签规整：去前缀、截断、去重、上限 ----------
  assert.equal(mod.normalizeBrowseTag("  #Link  "), "Link");
  assert.equal(mod.normalizeBrowseTag("  tag:AI  "), "AI");
  assert.equal(mod.normalizeBrowseTag("###"), "##", "与 normalizeDetailTag 一致：只去掉一个 # 前缀");
  assert.equal(mod.normalizeBrowseTag(""), null);
  assert.equal(mod.normalizeBrowseTag("   "), null);
  assert.equal(mod.normalizeBrowseTag("x".repeat(40)).length, 32);
  assert.deepEqual(mod.normalizeBrowseTags(["#Foo", "foo", "bar", "  ", "tag:Baz"]), ["Foo", "bar", "Baz"]);
  assert.equal(mod.normalizeBrowseTags(Array.from({ length: 20 }, (_, i) => `t${i}`)).length, 12);

  // ---------- 大小写不敏感比较 ----------
  assert.equal(mod.sameTags(["Foo", "bar"], ["foo", "BAR"]), true);
  assert.equal(mod.sameTags(["Foo", "bar"], ["bar", "Foo"]), false);
  assert.equal(mod.sameTags(["#Foo"], ["Foo"]), true);

  // ---------- 浏览态增删计划：无实质变化不写库 ----------
  assert.deepEqual(mod.planBrowseTagEdit(["A", "B"], { type: "add", value: "#C" }), {
    nextTags: ["A", "B", "C"], changed: true,
  });
  assert.deepEqual(mod.planBrowseTagEdit(["A", "B"], { type: "remove", tag: "a" }), {
    nextTags: ["B"], changed: true,
  });
  assert.equal(mod.planBrowseTagEdit(["A"], { type: "add", value: " a " }).changed, false, "重复标签不应产生空写");
  assert.equal(mod.planBrowseTagEdit(["A"], { type: "remove", tag: "missing" }).changed, false, "删除不存在的标签不应产生空写");
  assert.equal(mod.planBrowseTagEdit(["A"], { type: "add", value: "   " }).changed, false, "空输入不应产生空写");

  // ---------- provenance 增量合并：保留既有来源，只给新增标 manual ----------
  const previous = {
    Link: { source: "heuristic", ts: 1 },
    Idea: { source: "ai", ts: 2, actor: "pi" },
    Gone: { source: "plugin", ts: 3 },
  };
  const merged = mod.mergeBrowsedTagProvenance(previous, ["Link", "Idea", "Gone"], ["Link", "Idea", "New"], 99);
  assert.equal(merged.Link.source, "heuristic", "heuristic 来源不得降级为 manual");
  assert.equal(merged.Idea.source, "ai", "ai 来源不得降级为 manual");
  assert.equal(merged.Idea.actor, "pi", "既有 actor 需保留");
  assert.equal(merged.New.source, "manual", "新增标签标 manual");
  assert.equal(merged.New.ts, 99);
  assert.equal(merged.Gone, undefined, "删除标签的 provenance 需移除");
  assert.equal(previous.Link.source, "heuristic", "合并不修改入参");
  // 陈旧 provenance 记录（条目上并不存在的标签）按新增处理
  const stale = mod.mergeBrowsedTagProvenance({ Ghost: { source: "ai", ts: 5 } }, [], ["Ghost"], 7);
  assert.equal(stale.Ghost.source, "manual");

  // ---------- 标签专用入参：只含 id / tags / metadata，绝不带 content ----------
  const clip = {
    id: "clip-1",
    tags: ["Link", "Idea"],
    metadata: { aiSummary: "keep-me", tags_provenance: { stale: true } },
  };
  const input = mod.buildTagOnlyUpdateInput({ clip, tags: ["Link", "Idea", "New"], provenance: merged });
  assert.deepEqual(Object.keys(input).sort(), ["id", "metadata", "tags"]);
  assert.deepEqual(mod.findForbiddenTagOnlyKeys(input), [], "不得携带任何正文 / 表示重建字段");
  assert.equal(input.id, "clip-1");
  assert.deepEqual(input.tags, ["Link", "Idea", "New"]);
  assert.equal(input.metadata.aiSummary, "keep-me", "metadata 整组覆盖时必须保留既有字段");
  assert.deepEqual(input.metadata.tags_provenance, merged, "provenance 需覆盖旧值");
  // 无 metadata 的条目也不得丢字段
  const bare = mod.buildTagOnlyUpdateInput({ clip: { id: "x" }, tags: [], provenance: {} });
  assert.deepEqual(bare.metadata, { tags_provenance: {} });

  // ---------- 静态防护：正文相关字段一旦出现必须被检出 ----------
  assert.deepEqual(mod.findForbiddenTagOnlyKeys({ id: "x", content: "oops" }), ["content"]);
  assert.deepEqual(
    mod.findForbiddenTagOnlyKeys({ id: "x", plainText: "a", representations: {} }).sort(),
    ["plainText", "representations"],
  );

  console.log("[unit] tag-only-save checks passed (browse edit, provenance merge, content-free writeback input)");
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
