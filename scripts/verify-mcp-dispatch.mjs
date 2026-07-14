// MCP dispatch 完整性 guard（settings-service-unified-protocol B3）
// 断言 mcp_tool_specs 声明的每个 clipf.* / clipboard.* 工具，在 call_mcp_tool 都有对应 match arm。
// 防止「tools/list 声明但 tools/call 返回 -32602 unknown tool」的幽灵工具回归。
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const librs = fs.readFileSync(path.join(root, "src-tauri/src/lib.rs"), "utf8");

// 声明的工具名：McpToolSpec.name 字面量（形如 name: "clipf.settings.get"）
const declared = [
  ...librs.matchAll(/name:\s*"((?:clipf|clipboard)\.[^"]+)"/g),
].map((match) => match[1]);
const unique = [...new Set(declared)];

// dispatch arm 判定：工具名作为 match 模式出现（独立 "X" => 或链式 "X" | "Y" =>）。
function hasDispatchArm(name) {
  return librs.includes(`"${name}" =>`) || librs.includes(`"${name}" |`);
}

const missing = unique.filter((name) => !hasDispatchArm(name));

if (missing.length > 0) {
  console.error(
    `MCP dispatch verification failed: ${missing.length} 个工具在 mcp_tool_specs 声明但 call_mcp_tool 无 dispatch arm：`,
  );
  for (const name of missing) {
    console.error(`  - ${name}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `MCP dispatch verification passed (${unique.length} 个工具全部有 dispatch arm)`,
  );
}
