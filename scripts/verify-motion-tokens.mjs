#!/usr/bin/env node
// Motion token 门禁：业务 tsx 禁止裸 duration 字面量；index.css 动画时长必须走 --motion-* token。
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const roots = ["src/clipboard", "src/settings", "src/workspace", "src/onboarding"];
const tsxFiles = ["src/App.tsx"];
for (const root of roots) {
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".tsx")) tsxFiles.push(p);
    }
  })(root);
}

const violations = [];

// 规则 A：业务 tsx 禁止 duration-100 / duration-150 / duration-[Nms]
for (const file of tsxFiles) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (/duration-(100|150)\b/.test(line) || /duration-\[\d+ms\]/.test(line)) {
      violations.push(`${file}:${i + 1} ${line.trim()}`);
    }
  });
}

// 规则 B：index.css 禁止动画时长裸写（0.Xs / 120ms），白名单：0.01ms、7s、--motion- token 定义行、注释行
{
  const file = "src/index.css";
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("--motion-") || trimmed.startsWith("--ease-")) return;
    if (trimmed.startsWith("/*") || trimmed.startsWith("*")) return;
    if (/\b0\.01ms\b/.test(line) || /\b7s\b/.test(line)) return;
    if (
      (/(animation|transition)[^;]*\b0\.\d+s/.test(line) && !/var\(--motion-/.test(line)) ||
      /\b120ms\b/.test(line)
    ) {
      violations.push(`${file}:${i + 1} ${trimmed}`);
    }
  });
}

if (violations.length) {
  console.error("[motion-tokens] violations:");
  for (const v of violations) console.error("  " + v);
  process.exit(1);
}
console.log(`[motion-tokens] ok (checked ${tsxFiles.length + 1} files)`);
