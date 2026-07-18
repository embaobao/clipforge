// 热路径边界 guard（settings-service-unified-protocol B1）
// 快速面板主路径（src/App.tsx）禁止接入控制面 / 网络类设置调用，
// 否则会破坏 Clipy 替代核心体验和 300ms 交互预算。
// 本脚本对 App.tsx 做否定断言：出现下列调用即 fail。
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const appPath = path.join(root, "src/App.tsx");

// 禁止在主面板热路径出现的控制面 / 网络类调用。
// read_user_settings / write_user_settings（legacy）在第一阶段允许，不在禁止列。
const FORBIDDEN = [
  "settings_service_get",
  "settings_service_patch",
  "settings_service_replace",
  "settings_service_reset",
  "settings_service_agent_providers",
  "settings_service_agent_check",
  "settings_service_agent_models",
  "agent_check_provider",
  "agent_detect",
  "agent_list_provider_models",
  "settings_changed",
  "clipf.settings",
  "clipf.agent",
  "settingsService",
];

function assert(condition, message) {
  if (!condition) {
    console.error(`Hot path verification failed: ${message}`);
    process.exitCode = 1;
  }
}

if (!fs.existsSync(appPath)) {
  console.error(`Hot path verification failed: ${appPath} not found`);
  process.exit(1);
}

const app = fs.readFileSync(appPath, "utf8");

for (const token of FORBIDDEN) {
  assert(
    !app.includes(token),
    `主面板 src/App.tsx 不得包含控制面/网络类调用 "${token}"（违反控制面/热路径隔离）`,
  );
}

if (!process.exitCode) {
  console.log("Hot path verification passed");
}
