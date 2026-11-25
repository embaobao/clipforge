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
  workspace: "src/workspace/components/MultiAggregateWorkspace.tsx",
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
    "聚合页 src/workspace/components/MultiAggregateWorkspace.tsx 缺少 data-surface=\"workspace\" marker",
  );
  assert(
    workspaceDetail.includes('data-surface="workspace"'),
    "详情页 src/workspace/components/ClipDetailWorkspace.tsx 缺少 data-surface=\"workspace\" marker",
  );

// 2) S5 拆分契约：搜索域与面板区块必须落在独立模块，App.tsx 只做接线。
function checkS5Split() {
  const app = read(files.app);
  const splitFiles = [
    "src/clipboard/use-panel-search.ts",
    "src/clipboard/components/panel-top-bar.tsx",
    "src/clipboard/components/panel-bottom-bars.tsx",
    "src/clipboard/components/clipboard-list-route.tsx",
    "src/clipboard/components/clip-detail-route.tsx",
    "src/clipboard/components/aggregate-route.tsx",
    "src/clipboard/use-aggregate-export.ts",
    "src/clipboard/use-clip-trash.ts",
    "src/clipboard/use-panel-show.ts",
    "src/clipboard/use-search-snapshot-query.ts",
    "src/clipboard/app-settings.ts",
    "src/components/panel-error-boundary.tsx",
  ];
  for (const rel of splitFiles) {
    assert(fs.existsSync(path.join(root, rel)), `S5 拆分文件缺失: ${rel}`);
  }
  if (process.exitCode) return;
  for (const rel of splitFiles) {
    const content = read(rel);
    assert(
      !content.includes('data-surface="clipboard"'),
      `${rel} 出现第二处 data-surface="clipboard" marker（marker 只允许 App.tsx 主面板一根）`,
    );
  }
  assert(app.includes("<PanelTopBar"), "App.tsx 未接线 <PanelTopBar");
  assert(app.includes("<PanelBottomBars"), "App.tsx 未接线 <PanelBottomBars");
  assert(app.includes("<ClipboardListRoute"), "App.tsx 未接线 <ClipboardListRoute");
  assert(app.includes("usePanelSearch("), "App.tsx 未接线 usePanelSearch(");
  assert(
    !app.includes("buildBaseSearchSuggestions(") && !app.includes("buildSearchSuggestions("),
    "App.tsx 仍直接调用 buildBaseSearchSuggestions/buildSearchSuggestions（应经 use-panel-search）",
  );
}

checkS5Split();
}

checkMarkers();

if (!process.exitCode) {
  console.log("Surface boundary verification passed");
}
