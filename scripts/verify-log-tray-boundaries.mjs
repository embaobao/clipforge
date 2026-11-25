// S3 日志/托盘切片边界验证：实现必须落在 log_service.rs / tray.rs，
// lib.rs 只留命令壳与模块声明（命令名、日志文本、菜单 id 不变）。
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const libRsPath = path.join(root, "src-tauri/src/lib.rs");
const logServicePath = path.join(root, "src-tauri/src/log_service.rs");
const trayPath = path.join(root, "src-tauri/src/tray.rs");

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function assert(condition, message) {
  if (!condition) {
    console.error(`Log/tray boundary verification failed: ${message}`);
    process.exitCode = 1;
  }
}

function sliceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) return "";
  return source.slice(startIndex, endIndex);
}

assert(fs.existsSync(libRsPath), "lib.rs is missing");
const libRs = fs.existsSync(libRsPath) ? read(libRsPath) : "";

assert(fs.existsSync(logServicePath), "log_service.rs module is missing");
assert(fs.existsSync(trayPath), "tray.rs module is missing");
const logService = fs.existsSync(logServicePath) ? read(logServicePath) : "";
const trayRs = fs.existsSync(trayPath) ? read(trayPath) : "";

for (const symbol of [
  "pub(crate) fn log_to_file",
  "fn build_log_line",
  "fn log_writer_send",
  "fn should_write_app_log",
  "fn parse_log_line",
  "fn log_path",
  "fn cleanup_app_logs_impl",
  "fn get_log_stats_impl",
  "fn query_app_logs_impl",
  "pub(crate) fn append_app_log_impl",
  "struct AppLogEntryPayload",
  "struct LogStatsPayload",
]) {
  assert(logService.includes(symbol), `log_service.rs lost core symbol: ${symbol}`);
}
for (const symbol of [
  'pub(crate) const TRAY_ID: &str = "main-tray"',
  "fn build_tray_menu",
  "pub(crate) fn setup_tray",
  '"open_quick"',
  '"preferences"',
  '"toggle_listen"',
  '"quit"',
]) {
  assert(trayRs.includes(symbol), `tray.rs lost core symbol: ${symbol}`);
}
assert(libRs.includes("mod log_service;"), "lib.rs no longer declares the log_service module");
assert(libRs.includes("mod tray;"), "lib.rs no longer declares the tray module");
assert(!libRs.includes("fn build_log_line("), "lib.rs still holds build_log_line implementation");
assert(!libRs.includes("fn log_writer_send("), "lib.rs still holds log_writer_send implementation");
assert(!libRs.includes("fn parse_log_line("), "lib.rs still holds parse_log_line implementation");
assert(!libRs.includes("fn build_tray_menu<"), "lib.rs still holds build_tray_menu implementation");
assert(!libRs.includes("fn log_path()"), "lib.rs still holds log_path implementation");

// 日志命令壳仍在 lib.rs generate_handler 注册（命令名不变）。
const handlerSlice = sliceBetween(libRs, "generate_handler![", "]");
for (const command of [
  "append_app_log",
  "get_app_log_path",
  "query_app_logs",
  "cleanup_app_logs",
  "get_log_stats",
]) {
  assert(handlerSlice.includes(command), `generate_handler is missing log command: ${command}`);
}

if (!process.exitCode) {
  console.log("Log/tray boundary verification passed");
}
