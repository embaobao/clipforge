#!/usr/bin/env node
/**
 * 焦点框预取清理的静态门禁（零依赖）。
 * 做什么：扫描 `src-tauri/src/**\/*.rs`，断言后台预取线程及其 250ms 间隔常量在源码中
 *   （剥离注释后）彻底消失，同时断言面板主链路与兼容面命令必须保留，防连带误删。
 * 为什么：`cargo test --lib` 不调用 `run()`，线程在测试里本来就不会启动，运行时单测
 *   只能得到恒真断言；源码级双向断言配合 `cargo check`（删函数后残留引用直接编译失败）
 *   才是可证伪证据。见 openspec/changes/focus-prefetch-idle-removal/。
 * 边界：只做静态检查，不编译、不读构建产物、不做语义分析；fail-closed——任一源文件
 *   读失败、源码为空、符号清单越界都判失败。新增或重命名相关符号须同步本清单。
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RUST_SRC = join(ROOT, "src-tauri", "src");

/** 清理后必须消失的符号：任一 .rs 源码中出现即失败。 */
const REMOVED = ["start_focus_prefetch_thread", "FOCUS_PREFETCH_INTERVAL_MS"];

/** 清理后必须保留的符号：合并源码中任一缺失即失败（面板定位 / 粘贴目标 / 兼容面）。 */
const KEPT = [
  "fn focused_input_bounds(",
  "focused_input_bounds_platform",
  "FOCUS_BOUNDS_CACHE",
  "FOCUS_CACHE_MAX_AGE_MS",
  "native_focused_input_bounds",
  "snapshot_paste_target_bounds",
  "PASTE_TARGET_BOUNDS_CACHE",
  "restore_paste_target_focus",
  "PanelPositionStrategy::FocusInput",
  "generate_handler!",
];

/** 递归收集 Rust 源文件；目录读失败直接抛错，由调用方按 fail-closed 处理。 */
function collectRustFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectRustFiles(path));
    } else if (entry.isFile() && entry.name.endsWith(".rs")) {
      files.push(path);
    }
  }
  return files;
}

/** 去掉行注释与块注释，避免注释文字造成假阳性/假阴性；字符串内的 // 误伤不影响本门禁的符号集。 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** 标识符按词边界匹配，避免前缀/后缀同名绕过。 */
function hasToken(source, token) {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^A-Za-z0-9_])${escaped}(?:$|[^A-Za-z0-9_])`, "m").test(source);
}

function fail(message) {
  console.error(`✗ ${message}`);
  process.exitCode = 1;
}

let files = [];
try {
  files = collectRustFiles(RUST_SRC);
} catch (error) {
  fail(`无法枚举 ${RUST_SRC}: ${error.message}`);
}

if (files.length === 0 && process.exitCode !== 1) {
  fail(`未找到任何 Rust 源文件：${RUST_SRC}`);
}

if (process.exitCode !== 1) {
  let merged = "";
  for (const file of files) {
    try {
      const code = stripComments(readFileSync(file, "utf8"));
      if (code.trim().length === 0) fail(`源码为空或仅含注释：${file}`);
      merged += `\n${code}`;
    } catch (error) {
      fail(`无法读取 ${file}: ${error.message}`);
    }
  }
  if (process.exitCode !== 1) {
    for (const token of REMOVED) {
      if (hasToken(merged, token)) fail(`仍存在已废弃符号 ${token}`);
    }
    for (const token of KEPT) {
      if (!hasToken(merged, token)) fail(`误删必须保留的符号 ${token}`);
    }
    if (process.exitCode !== 1) {
      console.log(
        `✓ 焦点框预取已停用（扫描 ${files.length} 个 .rs，${REMOVED.length} 项禁用符号不存在），${KEPT.length} 项主链路/兼容面符号完整`,
      );
    }
  }
}
