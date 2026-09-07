// Surface 边界 guard（frontend-surface-architecture-refactor Phase 1）
// 目的：守护前端按业务 surface 组织的架构契约——
//   1. 每个 surface 根节点必须携带稳定身份 marker data-surface="<domain>"（verifier 锚点 + 样式作用域根）；
//   2. src/App.css 已于 2026-09 视觉重构中整体废弃，不再检查冻结边界。
// 与 verify-file-size.mjs（文件规模）、verify-hot-path.mjs（热路径）对仗，本脚本只管 surface marker。
// 读法与全部门禁一致：readFileSync + 字符串 includes/正则，不引入 AST。
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

const files = {
  app: "src/App.tsx",
  settings: "src/settings.tsx",
  settingsShell: "src/settings/components/SettingsShell.tsx",
  workspace: "src/workspace/workspace-panels.tsx",
  workspaceDetail: "src/workspace/components/ClipDetailWorkspace.tsx",
};

function read(rel) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) {
    throw new Error(`${rel} not found`);
  }
  return fs.readFileSync(p, "utf8");
}

function assert(condition, message) {
  if (!condition) {
    console.error(`Surface boundary verification failed: ${message}`);
    process.exitCode = 1;
  }
}

// 1) 正向：每个 surface 根节点必须挂 data-surface 身份 marker。
//    marker 恒定不变，与 surface-${activeSurface} 这类行为态 class 区分。
//    settings 的 marker 允许落在 settings.tsx 或 SettingsShell.tsx（布局组件）中。
function checkMarkers() {
  const app = read(files.app);
  const settings = read(files.settings);
  const settingsShell = read(files.settingsShell);
  const workspace = read(files.workspace);
  const workspaceDetail = read(files.workspaceDetail);

  assert(
    app.includes('data-surface="clipboard"'),
    "主面板 src/App.tsx 的 clipboard surface 根缺少 data-surface=\"clipboard\" marker",
  );
  assert(
    settings.includes('data-surface="settings"') || settingsShell.includes('data-surface="settings"'),
    "设置页 src/settings.tsx 或 src/settings/components/SettingsShell.tsx 缺少 data-surface=\"settings\" marker",
  );
  assert(
    workspace.includes('data-surface="workspace"'),
    "聚合页 src/workspace/workspace-panels.tsx 缺少 data-surface=\"workspace\" marker",
  );
  assert(
    workspaceDetail.includes('data-surface="workspace"'),
    "详情页 src/workspace/components/ClipDetailWorkspace.tsx 缺少 data-surface=\"workspace\" marker",
  );
}

checkMarkers();

if (!process.exitCode) {
  console.log("Surface boundary verification passed");
}
