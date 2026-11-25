// 行数门禁回归：普通文件 501 行失败；豁免文件超过 800 行只提醒还债、不阻断。
// 用一次性工作区运行真实 scripts/verify-file-size.mjs，不依赖源码当前行数。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const gate = join(root, "scripts", "verify-file-size.mjs");
const sandbox = mkdtempSync(join(root, ".work", "file-size-gate-"));

function writeLines(name, lines) {
  const path = join(sandbox, "src", `${name}.ts`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Array.from({ length: lines }, (_, i) => `// line ${i + 1}`).join("\n"));
}

function run() {
  mkdirSync(join(sandbox, "scripts"), { recursive: true });
  writeFileSync(
    join(sandbox, "scripts", "file-size-exemptions.json"),
    JSON.stringify({
      limit: 500,
      exemptLimit: 800,
      exempt: [{ path: "src/exempt.ts", target: 800, track: "test" }],
    }),
  );
  try {
    execFileSync(process.execPath, [gate], { cwd: sandbox, encoding: "utf8", stdio: "pipe" });
    return { code: 0, output: "" };
  } catch (error) {
    return { code: error.status ?? 1, output: `${error.stdout ?? ""}${error.stderr ?? ""}` };
  }
}

try {
  writeLines("normal", 501);
  writeLines("exempt", 801);
  const result = run();
  assert.equal(result.code, 1, "普通文件 501 行必须失败");
  assert.match(result.output, /src\/normal\.ts: 501 行 > 500/, "失败信息应指出普通文件超限");
  assert.match(result.output, /src\/exempt\.ts: 801 行 \(豁免，目标 800/, "豁免文件超限只提醒还债");
  assert.doesNotMatch(result.output, /src\/exempt\.ts.*超限:/, "豁免文件不应进入失败列表");

  writeLines("normal", 500);
  writeLines("exempt", 600);
  const bounded = run();
  assert.equal(bounded.code, 0, "普通 500 行与豁免 600 行都应通过");

  console.log("[file-size-gate] passed: 普通 500 硬失败 / 豁免 800 只提醒");
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}
