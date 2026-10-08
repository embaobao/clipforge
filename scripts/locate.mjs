#!/usr/bin/env node
/** ClipForge 快速业务定位脚本（零依赖，纯 Node）。
 *
 *  数据源（即 AGENTS.md 要求的「公共能力必须有中文注释」的副产品）：
 *    1. 文件路径（文件名/目录名命中排最前）
 *    2. 导出符号：TS `export function/const/type/interface/class/enum`、Rust `pub fn`
 *    3. Tauri 命令：`#[tauri::command]` 后最近的 `fn 名`
 *    4. 中文注释 / 文档行
 *
 *  用法：
 *    pnpm locate <关键词> [关键词2...]   # OR 语义，任一关键词命中即输出（可一次给中英文同义词）
 *    pnpm locate --check-index           # 校验 docs/BUSINESS_INDEX.md 反引号内引用的文件真实存在（防腐）
 *
 *  退出码：有命中 / 校验通过 = 0；无命中 / 校验失败 = 1。
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(import.meta.url)), "..", "..");
const SCAN_DIRS = ["src", "src-tauri/src"];
const SCAN_EXTS = new Set([".ts", ".tsx", ".rs", ".css"]);
const SKIP_DIRS = new Set(["node_modules", "dist", "target", "styles"]);
const INDEX_DOC = "docs/BUSINESS_INDEX.md";
const MAX_HITS = 60;
const LINE_CLIP = 140;

const CJK = /[\u4e00-\u9fff]/;
// TS/Rust 符号声明行：捕获符号名（可能一行多个 export，逐个抓）。
const SYMBOL_RE =
  /(?:export\s+(?:default\s+)?(?:async\s+)?(?:function|const|class|type|interface|enum)\s+([A-Za-z0-9_$]+))|(?:pub\s+(?:async\s+)?fn\s+([A-Za-z0-9_]+))/g;
const COMMAND_RE = /^\s*#\[tauri::command\]/;
const FN_RE = /^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z0-9_]+)/;

/** 递归收集待扫文件（相对路径）。 */
function collectFiles(dir, out = []) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return out;
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) collectFiles(rel, out);
    } else if (SCAN_EXTS.has(entry.name.slice(entry.name.lastIndexOf(".")))) {
      out.push(rel);
    }
  }
  return out;
}

/** 单文件扫描：返回 { path, symbol, doc, text } 四类命中行。 */
function scanFile(rel, keywords) {
  const hits = { path: false, symbol: [], doc: [], text: [] };
  if (keywords.some((kw) => rel.toLowerCase().includes(kw.toLowerCase()))) hits.path = true;

  const lines = readFileSync(join(ROOT, rel), "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Tauri 命令：#[tauri::command] 后 3 行内找 fn 名。
    if (COMMAND_RE.test(line)) {
      for (let j = i + 1; j <= i + 3 && j < lines.length; j++) {
        const fn = FN_RE.exec(lines[j]);
        if (fn) {
          if (keywords.some((kw) => fn[1].toLowerCase().includes(kw.toLowerCase()))) {
            hits.symbol.push({ line: j + 1, text: lines[j].trim() });
          }
          break;
        }
      }
    }
    // 符号名命中。
    for (const m of line.matchAll(SYMBOL_RE)) {
      const name = m[1] ?? m[2];
      if (name && keywords.some((kw) => name.toLowerCase().includes(kw.toLowerCase()))) {
        hits.symbol.push({ line: i + 1, text: line.trim() });
      }
    }
    // 行内容命中：中文注释/文档行为主，普通文本行兜底。
    if (keywords.some((kw) => line.includes(kw))) {
      const isComment = /^\s*(\/\/|\/\*|\*|#)/.test(line);
      if (isComment || CJK.test(line)) hits.doc.push({ line: i + 1, text: line.trim() });
      else hits.text.push({ line: i + 1, text: line.trim() });
    }
  }
  return hits;
}

function printSection(title, rows) {
  if (!rows.length) return;
  console.log(`\n## ${title}`);
  for (const r of rows) console.log(`${r.ref}${r.text ? `  ${clip(r.text)}` : ""}`);
}

function clip(text) {
  return text.length > LINE_CLIP ? `${text.slice(0, LINE_CLIP)}…` : text;
}

/** 校验索引文档反引号内引用的文件真实存在。 */
function checkIndex() {
  const docRel = INDEX_DOC;
  const lines = readFileSync(join(ROOT, docRel), "utf8").split("\n");
  const missing = [];
  const seen = new Set();
  for (let i = 0; i < lines.length; i++) {
    for (const m of lines[i].matchAll(/`([^`]+)`/g)) {
      const token = m[1];
      if (token.includes(" ") || /[:=]/.test(token) || seen.has(token)) continue;
      const looksLikePath =
        /^(src|src-tauri|scripts|docs)\//.test(token) || /^[A-Za-z0-9._-]+\.(html|json|mjs)$/.test(token);
      if (!looksLikePath) continue;
      seen.add(token);
      if (!existsSync(join(ROOT, token))) missing.push({ token, line: i + 1 });
    }
  }
  if (missing.length) {
    console.error(`[check-index] ${docRel} 引用了不存在的文件：`);
    for (const m of missing) console.error(`  ${docRel}:${m.line}  \`${m.token}\``);
    return 1;
  }
  console.log(`[check-index] ${docRel} 引用的 ${seen.size} 个路径全部存在`);
  return 0;
}

// ---- main ----
const args = process.argv.slice(2);
if (args[0] === "--check-index") process.exit(checkIndex());

const keywords = args.filter((a) => !a.startsWith("-"));
if (!keywords.length) {
  console.error("用法: pnpm locate <关键词> [关键词2...]   |   pnpm locate --check-index");
  process.exit(1);
}

const files = SCAN_DIRS.flatMap((d) => collectFiles(d));
const pathHits = [];
const symbolHits = [];
const docHits = [];
const textHits = [];
for (const rel of files) {
  const h = scanFile(rel, keywords);
  if (h.path) pathHits.push({ ref: rel });
  symbolHits.push(...h.symbol.map((s) => ({ ref: `${rel}:${s.line}`, text: s.text })));
  docHits.push(...h.doc.map((s) => ({ ref: `${rel}:${s.line}`, text: s.text })));
  textHits.push(...h.text.map((s) => ({ ref: `${rel}:${s.line}`, text: s.text })));
}

console.log(`locate [${keywords.join(", ")}] — 扫描 ${files.length} 个文件`);
printSection("路径命中", pathHits);
printSection("符号 / Tauri 命令", symbolHits);
printSection("注释 / 文档", docHits);
if (symbolHits.length + docHits.length < 12) printSection("文本兜底", textHits);
else if (textHits.length) console.log(`\n(另有 ${textHits.length} 条普通文本命中，已省略)`);

const total = pathHits.length + symbolHits.length + docHits.length + textHits.length;
if (!total) {
  console.error("\n无命中。换关键词（可中英混用），或查 docs/BUSINESS_INDEX.md 的业务域表。");
  process.exit(1);
}
