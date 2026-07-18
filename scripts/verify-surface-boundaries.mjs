// Surface 边界 guard（frontend-surface-architecture-refactor Phase 1）
// 目的：守护前端按业务 surface 组织的架构契约——
//   1. 每个 surface 根节点必须携带稳定身份 marker data-surface="<domain>"（verifier 锚点 + 样式作用域根）；
//   2. src/App.css 作为 legacy 全局样式表已冻结，禁止新增 P-FINAL 覆盖块（只能逐 surface 迁出后删除）。
// 与 verify-file-size.mjs（文件规模）、verify-hot-path.mjs（热路径）对仗，本脚本只管 surface marker 与 App.css 冻结边界。
// 读法与全部门禁一致：readFileSync + 字符串 includes/正则，不引入 AST。
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

const files = {
  app: "src/App.tsx",
  appCss: "src/App.css",
  settings: "src/settings.tsx",
  workspace: "src/workspace/workspace-panels.tsx",
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
function checkMarkers() {
  const app = read(files.app);
  const settings = read(files.settings);
  const workspace = read(files.workspace);

  assert(
    app.includes('data-surface="clipboard"'),
    "主面板 src/App.tsx 的 clipboard surface 根缺少 data-surface=\"clipboard\" marker",
  );
  assert(
    app.includes('data-surface="agent"'),
    "Agent 覆层 src/App.tsx 缺少 data-surface=\"agent\" marker",
  );
  assert(
    settings.includes('data-surface="settings"'),
    "设置页 src/settings.tsx 根缺少 data-surface=\"settings\" marker",
  );
  assert(
    workspace.includes('data-surface="workspace"'),
    "详情/聚合 src/workspace/workspace-panels.tsx 缺少 data-surface=\"workspace\" marker",
  );
}

// 2) 否向：src/App.css 冻结，P-FINAL 覆盖块不得新增（迁移删块会让计数下降，仍通过）。
//    基线 20 = 2026-07-16 Phase 1 冻结时实测的「/* P-FINAL」块头注释数。
const PF_FINAL_BASELINE = 20;

function checkAppCssFrozen() {
  const css = read(files.appCss);
  assert(
    css.includes("LEGACY GLOBAL STYLESHEET"),
    "src/App.css 顶部缺少 LEGACY 冻结 banner（见 design.md §9 样式边界规则）",
  );
  const pfFinalBlocks = (css.match(/\/\*\s*P-FINAL/g) || []).length;
  assert(
    pfFinalBlocks <= PF_FINAL_BASELINE,
    `src/App.css 新增了 P-FINAL 覆盖块（当前 ${pfFinalBlocks} > 基线 ${PF_FINAL_BASELINE}）；App.css 已冻结，新样式请落到目标 surface 样式表`,
  );
}

checkMarkers();
checkAppCssFrozen();

if (!process.exitCode) {
  console.log("Surface boundary verification passed");
}
