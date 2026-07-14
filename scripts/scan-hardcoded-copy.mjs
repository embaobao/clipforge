#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const strict = process.env.CLIPFORGE_I18N_STRICT === "1";
const includeDirs = ["src"];
const skipPathParts = [
  `${path.sep}i18n${path.sep}locales${path.sep}`,
  `${path.sep}frontend-diagnostics`,
];
const skipLinePatterns = [
  /console\./,
  /logAppError/,
  /append.*Log/,
  /aria-label=/,
  /title=/,
  /className=/,
  /data-tooltip=/,
  /sourceLabel/,
  /businessChain/,
  /placeholder=/,
];

function collect(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collect(fullPath, out);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(fullPath);
    }
  }
  return out;
}

const files = includeDirs.flatMap((dir) => collect(path.join(root, dir)));
const findings = [];

for (const file of files) {
  if (skipPathParts.some((part) => file.includes(part))) continue;
  const rel = path.relative(root, file);
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    if (!/[\u4e00-\u9fff]/.test(line)) return;
    if (skipLinePatterns.some((pattern) => pattern.test(line))) return;
    findings.push({
      file: rel,
      line: index + 1,
      text: line.trim().slice(0, 160),
    });
  });
}

const maxPrint = 80;
console.log(`[i18n] hardcoded user-copy candidates: ${findings.length}`);
for (const item of findings.slice(0, maxPrint)) {
  console.log(`${item.file}:${item.line}: ${item.text}`);
}
if (findings.length > maxPrint) {
  console.log(`[i18n] ${findings.length - maxPrint} more candidates omitted`);
}

if (strict && findings.length) {
  process.exit(1);
}
