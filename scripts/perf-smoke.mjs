// 性能 SLO 冒烟校验（settings-service-unified-protocol B6）
//
// 300ms 是 ClipForge 控制面（设置服务）与热路径交互的硬预算。真正的 P95
// 需要在 `pnpm tauri dev` 里用 performance.mark / Instant 采样累积，本机
// 静态脚本无法跑出真实分布。因此本脚本只做能静态断言的部分：
//   1. 后端 src-tauri/src/lib.rs 的 settings_service_get/patch/replace/reset
//      必须埋好 Instant + durationMs + log_slow_settings_operation。
//   2. 前端 src/services/settings.ts 必须记录 durationMs，并在 dev 环境
//      超 300ms 输出 warn。
// 再输出一份手动采样清单，供在 tauri dev 里用 performance.mark 逐项核对 P95。
//
// 退出码：静态断言全过 exitCode=0；任一失败 exitCode=1。
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const rustPath = path.join(root, "src-tauri/src/lib.rs");
const settingsTsPath = path.join(root, "src/services/settings.ts");

const PERF_BUDGET_MS = 300;

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function assert(condition, message) {
  if (!condition) {
    console.error(`Perf smoke verification failed: ${message}`);
    process.exitCode = 1;
  }
}

/**
 * 提取 Rust 源码中某个顶层 fn 的函数体片段（从 `fn <name>` 到下一个 `\nfn `）。
 * 用于对单个 settings_service_* 命令做点对点的埋点断言。
 * 注意: settings_service_get 是 `fn name(`，而 patch/replace/reset 带泛型 `fn name<R>(`，
 * 因此匹配 name 后接 `(` 或 `<` 两种形态。
 */
function extractRustFn(src, name) {
  const parenStart = src.indexOf(`fn ${name}(`);
  const genericStart = src.indexOf(`fn ${name}<`);
  const start = [parenStart, genericStart].filter((i) => i !== -1).sort((a, b) => a - b)[0];
  if (start === undefined) return "";
  const rest = src.slice(start);
  const nextFn = rest.indexOf("\nfn ", 1);
  return nextFn === -1 ? rest : rest.slice(0, nextFn);
}

// ---- 文件存在性 -----------------------------------------------------------
assert(fs.existsSync(rustPath), `${rustPath} not found`);
assert(fs.existsSync(settingsTsPath), `${settingsTsPath} not found`);

// ---- 静态断言 1：后端 settings_service_* 埋点 ------------------------------
const rust = read(rustPath);
const settingsFns = ["settings_service_get", "settings_service_patch", "settings_service_replace", "settings_service_reset"];

assert(
  rust.includes("fn log_slow_settings_operation"),
  "后端缺少 log_slow_settings_operation 慢操作埋点 helper",
);
assert(
  rust.includes(`&format!("slow {operation} durationMs={duration_ms} > 300")`),
  "log_slow_settings_operation 未按 300ms 阈值记录 durationMs",
);

for (const fn of settingsFns) {
  const body = extractRustFn(rust, fn);
  assert(body.length > 0, `后端缺少 ${fn} 命令实现`);
  assert(
    body.includes("std::time::Instant::now()"),
    `${fn} 未用 Instant::now() 记录起点`,
  );
  assert(body.includes("durationMs"), `${fn} 响应未回写 durationMs 字段`);
  assert(
    body.includes("log_slow_settings_operation"),
    `${fn} 未调用 log_slow_settings_operation 上报慢操作`,
  );
}

// ---- 静态断言 2：前端 settings.ts 计时 + dev warn --------------------------
const settingsTs = read(settingsTsPath);
assert(
  settingsTs.includes("PERF_BUDGET_MS") && settingsTs.includes("= 300"),
  "settings.ts 未定义 300ms 性能预算常量",
);
assert(
  settingsTs.includes("performance.now()") || settingsTs.includes("Date.now()"),
  "settings.ts withTiming 未用 performance.now()/Date.now() 记录耗时",
);
assert(
  settingsTs.includes("durationMs"),
  "settings.ts withTiming 未计算/记录 durationMs",
);
assert(
  settingsTs.includes("import.meta.env") && settingsTs.includes("DEV"),
  "settings.ts 慢操作 warn 未限定在 dev 环境",
);
assert(
  settingsTs.includes("console.warn"),
  "settings.ts 超 300ms 未输出 console.warn",
);
assert(
  settingsTs.includes("invoke<SettingsDocument>(\"settings_service_get\"") &&
    settingsTs.includes("invoke<SettingsWriteResult>(\"settings_service_patch\""),
  "settings.ts 未通过统一命令调用 settings_service_get / patch",
);

// ---- 手动采样清单（tauri dev 里用 performance.mark 完成） ------------------
const manualChecklist = [
  {
    scenario: "主面板快捷键打开（trayCenter/followCursor → 首屏可交互）",
    method: "performance.mark('panel:open:start') 于快捷键触发；panel:open:end 于首帧 list mount",
    target: `P95 <= ${PERF_BUDGET_MS}ms`,
  },
  {
    scenario: "列表选中 / 滚动 / 复制（热路径，不可阻塞）",
    method: "选中/滚动/复制各采样 N>=30，mark onAction:start → onAction:end",
    target: `P95 <= ${PERF_BUDGET_MS}ms`,
  },
  {
    scenario: "设置页 tab 切换（surface 切换不重拉全量 schema）",
    method: "performance.mark('settings:tab:start'/'settings:tab:end')，复用 schema 缓存",
    target: `P95 <= ${PERF_BUDGET_MS}ms`,
  },
  {
    scenario: "settings.get(includeSchema=false)",
    method: "后端 durationMs 字段 + 前端 withTiming('get') 双向采样",
    target: `P95 <= ${PERF_BUDGET_MS}ms（dev 超 300ms 会 console.warn）`,
  },
  {
    scenario: "settings.patch（局部写入推荐路径）",
    method: "后端 durationMs 字段 + 前端 withTiming('patch') 双向采样",
    target: `P95 <= ${PERF_BUDGET_MS}ms（dev 超 300ms 会 console.warn）`,
  },
];

console.log("");
console.log("=== 手动性能采样清单（需在 `pnpm tauri dev` 里完成）===");
for (const [idx, item] of manualChecklist.entries()) {
  console.log(`${idx + 1}. ${item.scenario}`);
  console.log(`   采样: ${item.method}`);
  console.log(`   目标: ${item.target}`);
}
console.log("提示: 后端每个 settings_service_* 已埋 Instant + durationMs + log_slow_settings_operation；");
console.log("      前端 settings.ts 的 withTiming 在 dev 环境超 300ms 会 console.warn，可直接当作超预算告警。");
console.log("");

if (!process.exitCode) {
  console.log("Perf smoke verification passed");
}
