#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const localesDir = path.join(root, "src", "i18n", "locales");
const localeFiles = ["zh-CN.json", "en-US.json"];
const dictionaries = Object.fromEntries(
  localeFiles.map((file) => {
    const fullPath = path.join(localesDir, file);
    return [file, JSON.parse(fs.readFileSync(fullPath, "utf8"))];
  }),
);

const [baseFile, ...otherFiles] = localeFiles;
const baseKeys = Object.keys(dictionaries[baseFile]).sort();
let failed = false;

for (const file of otherFiles) {
  const keys = Object.keys(dictionaries[file]).sort();
  const missing = baseKeys.filter((key) => !keys.includes(key));
  const extra = keys.filter((key) => !baseKeys.includes(key));
  if (missing.length || extra.length) {
    failed = true;
    console.error(`[i18n] ${file} key mismatch`);
    if (missing.length) console.error(`  missing: ${missing.join(", ")}`);
    if (extra.length) console.error(`  extra: ${extra.join(", ")}`);
  }
}

const sourceFiles = [];
function collectSourceFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["locales"].includes(entry.name)) continue;
      collectSourceFiles(fullPath);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      sourceFiles.push(fullPath);
    }
  }
}

collectSourceFiles(path.join(root, "src"));

const referencedKeys = new Set();
const keyPattern = /\b(?:t|tr)\(\s*["']([^"']+)["']/g;
for (const file of sourceFiles) {
  const source = fs.readFileSync(file, "utf8");
  for (const match of source.matchAll(keyPattern)) {
    referencedKeys.add(match[1]);
  }
}

const missingReferences = [...referencedKeys].filter((key) => !baseKeys.includes(key)).sort();
if (missingReferences.length) {
  failed = true;
  console.error(`[i18n] missing referenced keys: ${missingReferences.join(", ")}`);
}

if (failed) {
  process.exit(1);
}

console.log(`[i18n] ${localeFiles.join(" / ")} keys aligned (${baseKeys.length}); references checked (${referencedKeys.size})`);
