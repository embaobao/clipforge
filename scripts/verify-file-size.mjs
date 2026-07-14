// 单文件 ≤500 行门禁（codebase-modularity-refactor）
// - 豁免清单内文件超 target 只 warn（提示还债，不阻断）
// - 豁免清单外文件超 500 行 fail
// 豁免清单：scripts/file-size-exemptions.json
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const configPath = path.join(root, "scripts/file-size-exemptions.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const LIMIT = config.limit ?? 500;
const exemptMap = new Map(
  (config.exempt ?? []).map((entry) => [entry.path.replace(/\\/g, "/"), entry]),
);

const SOURCE_ROOTS = [
  { root: "src", exts: [".ts", ".tsx"] },
  { root: "src-tauri/src", exts: [".rs"] },
];

function listFiles(dir, exts, out) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // 跳过 node_modules / target / 生成目录 / vendored 第三方原语（animate-ui 是从动画库本地复制的原语，不计入还债）
      if (["node_modules", "target", "dist", ".codegraph", "animate-ui"].includes(entry.name)) continue;
      listFiles(full, exts, out);
    } else if (exts.includes(path.extname(entry.name))) {
      out.push(full);
    }
  }
}

const warnings = [];
const failures = [];

for (const { root: subRoot, exts } of SOURCE_ROOTS) {
  const files = [];
  listFiles(path.join(root, subRoot), exts, files);
  for (const file of files) {
    const rel = path.relative(root, file).replace(/\\/g, "/");
    const lines = fs.readFileSync(file, "utf8").split("\n").length;
    const exempt = exemptMap.get(rel);
    if (exempt) {
      if (lines > exempt.target) {
        warnings.push(`${rel}: ${lines} 行 (豁免，目标 ${exempt.target}，track=${exempt.track})`);
      }
    } else if (lines > LIMIT) {
      failures.push(`${rel}: ${lines} 行 > ${LIMIT}`);
    }
  }
}

for (const warning of warnings) {
  console.warn(`[file-size] 还债提醒: ${warning}`);
}
for (const failure of failures) {
  console.error(`[file-size] 超限: ${failure}`);
}

if (failures.length > 0) {
  console.error(`File size verification failed: ${failures.length} 个非豁免文件超过 ${LIMIT} 行`);
  process.exitCode = 1;
} else {
  console.log(
    `File size verification passed (limit=${LIMIT}, 豁免 ${exemptMap.size} 个文件, ${warnings.length} 个还债提醒)`,
  );
}
