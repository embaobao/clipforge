// 多选交互静态覆盖校验（TASK-8）：断言多选/导出关键接线存在，源码漂移时以中文报错退出。
// 用 process.cwd() 相对路径，保证仓库根目录 `pnpm test:unit` 与 `node scripts/...` 均可运行。
import { readFileSync } from "node:fs";
import { join } from "node:path";

const failures = [];

function check(label, ok) {
  if (!ok) failures.push(label);
}

function read(rel) {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

// ---- 1. use-panel-keyboard.ts：空格多选 / Cmd+A·C·X editable 守卫 / Tab 守卫 / Escape 逐级退出 / `/` 聚焦 ----
const kb = read("src/clipboard/use-panel-keyboard.ts");

// 空格分支：event.key === " " + editable/interactive/非列表守卫 + setMultiSelectMode(true) + selectedIds toggle
const spaceBranch = kb.match(/if \(event\.key === " "\) \{([\s\S]*?)\n      \}/);
check(
  "[use-panel-keyboard] 空格分支存在（event.key === \" \"）",
  Boolean(spaceBranch),
);
if (spaceBranch) {
  const body = spaceBranch[1];
  check(
    "[use-panel-keyboard] 空格分支守卫 editable/interactive/workspaceRoute.name !== \"list\"",
    body.includes("editable") &&
      body.includes("interactive") &&
      body.includes('workspaceRoute.name !== "list"'),
  );
  check(
    "[use-panel-keyboard] 空格分支 setMultiSelectMode(true)",
    /setMultiSelectMode\(true\)/.test(body),
  );
  check(
    "[use-panel-keyboard] 空格分支 selectedIds toggle（has→delete / else→add）",
    /next\.has\(item\.id\)/.test(body) && /next\.delete\(item\.id\)/.test(body) && /next\.add\(item\.id\)/.test(body),
  );
}

// Cmd+A / Cmd+C / Cmd+X 的 editable 守卫：editable && !allowListShortcutFromSearch
const guardCount = (kb.match(/editable && !allowListShortcutFromSearch/g) || []).length;
check(
  `[use-panel-keyboard] Cmd+A/C/X 共用 editable 守卫（editable && !allowListShortcutFromSearch，实际出现 ${guardCount} 处，需 ≥3）`,
  guardCount >= 3,
);

// Tab 守卫：(!editable || allowListShortcutFromSearch)
check(
  '[use-panel-keyboard] Tab 分支守卫 (!editable || allowListShortcutFromSearch)',
  /event\.key === "Tab"[\s\S]{0,300}!\(?editable \|\| allowListShortcutFromSearch\)?/.test(kb),
);

// Escape 逐级退出顺序：multiPreview → quickPreview → multiSelect → query → search → hide
const escIndex = (needle) => {
  const branch = kb.match(/if \(event\.key === "Escape"\) \{([\s\S]*?)\n      if \(event\.metaKey \&\&/);
  if (!branch) return -1;
  const at = branch[1].indexOf(needle);
  return at === -1 ? -1 : at;
};
const escOrder = ["isMultiPreviewOpen", "quickPreviewOpen", "if (multiSelectMode)", "query.trim()", "isSearchActive", "hide_quick_panel_command"];
const escPositions = escOrder.map(escIndex);
check(
  "[use-panel-keyboard] Escape 六级逐级退出齐全（multiPreview→quickPreview→multiSelect→query→search→hide）",
  escPositions.every((p) => p >= 0) &&
    escPositions.every((p, i) => i === 0 || p > escPositions[i - 1]),
);

// `/`（及普通字符）聚焦搜索分支
check(
  '[use-panel-keyboard] "/" 触发 focusSearch 分支',
  /event\.key === "\/"[\s\S]{0,200}focusSearch\(\)/.test(kb),
);

// ---- 2. QuickPastePanel.tsx：右键菜单接线 ----
const panel = read("src/clipboard/components/QuickPastePanel.tsx");
const openMenu = panel.match(/const openContextMenu = useCallback\(([\s\S]*?)\n  \}, \[/);
check("[QuickPastePanel] openContextMenu 存在", Boolean(openMenu));
if (openMenu) {
  check(
    "[QuickPastePanel] openContextMenu 仅调用 onSelect(item)（无其他选中副作用）",
    /onSelect\(item\);/.test(openMenu[1]) &&
      !/onToggleSelected|onStartMultiSelect|setMultiSelectMode/.test(openMenu[1]),
  );
}
check(
  "[QuickPastePanel] ClipContextMenu multiSelectMode={multiSelectMode && selectedIds.has(contextMenu.item.id)}",
  /multiSelectMode=\{multiSelectMode && selectedIds\.has\(contextMenu\.item\.id\)\}/.test(panel),
);
check(
  "[QuickPastePanel] onDelete 绑定 contextMenu.item",
  /onDelete=\{\(\) => onDelete\(contextMenu\.item\)\}/.test(panel),
);
check(
  "[QuickPastePanel] onCopyMode 绑定 contextMenu.item",
  /onCopyMode=\{\(mode\) => onCopyMode\(contextMenu\.item, mode\)\}/.test(panel),
);
check(
  "[QuickPastePanel] onOpenDetail 绑定 contextMenu.item",
  /contextMenu\.item\.id/.test(panel) && /navigateWorkspaceDetail\(contextMenu\.item\.id\)/.test(panel),
);
check(
  "[QuickPastePanel] selectedCount 来自 clips.filter(selectedIds.has)",
  /selectedCount=\{clips\.filter\(\(item\) => selectedIds\.has\(item\.id\)\)\.length\}/.test(panel),
);

// ---- 3. App.tsx：selectedInList 派生 + effect 剪除隐藏选中 ----
const app = read("src/App.tsx");
const selectedInListMemo = app.match(/const selectedInList = useMemo\(\(\) => \{([\s\S]*?)\n  \}, \[/);
check("[App] selectedInList useMemo 存在", Boolean(selectedInListMemo));
if (selectedInListMemo) {
  check(
    "[App] selectedInList 由 filteredClips 派生",
    selectedInListMemo[1].includes("filteredClips"),
  );
}
const pruneMatch = app.match(
  /useEffect\(\(\) => \{[\s\S]*?setSelectedIds\(\(current\) => \{[\s\S]*?visibleIds[\s\S]*?\}\);[\s\S]*?\}, \[filteredClips\]\)/,
);
check(
  "[App] effect 剪除隐藏选中（setSelectedIds 依赖 filteredClips）",
  Boolean(pruneMatch),
);

// ---- 4. use-aggregate-export.ts：写盘前统一走 check_file_paths 复核 ----
const exportSrc = read("src/clipboard/use-aggregate-export.ts");
const csvFn = exportSrc.match(/async function exportCsvFile\(\) \{([\s\S]*?)\n  \}\n\n  async function exportSplitFiles/);
const splitFn = exportSrc.match(/async function exportSplitFiles\(\) \{([\s\S]*?)\n  \}\n\n  return \{/);
check("[use-aggregate-export] exportCsvFile 函数体可定位", Boolean(csvFn));
check("[use-aggregate-export] exportSplitFiles 函数体可定位", Boolean(splitFn));

// 复核 helper：buildCheckedSources 内部走 check_file_paths，且导出函数在 build plan 前调用它
const recheckHelper = /checkFilePaths\([\s\S]{0,400}buildCheckedSources/;

if (csvFn) {
  const body = csvFn[1];
  check(
    "[use-aggregate-export] exportCsvFile 在 buildCsvFileExportPlan 之前走 buildCheckedSources 复核",
    /buildCheckedSources\(\)/.test(body) &&
      /buildCsvFileExportPlan/.test(body) &&
      body.indexOf("buildCheckedSources()") < body.indexOf("buildCsvFileExportPlan"),
  );
  check(
    "[use-aggregate-export] exportCsvFile 投影不再直接使用 filePathStatuses",
    !/projectExportSources\([^)]*filePathStatuses/.test(body) &&
      !/\bfilePathStatuses\b/.test(body.replace(/\/\/[^\n]*/g, "")),
  );
}
if (splitFn) {
  check(
    "[use-aggregate-export] exportSplitFiles 也走 buildCheckedSources 复核",
    /buildCheckedSources\(\)/.test(splitFn[1]),
  );
}
check(
  "[use-aggregate-export] buildCheckedSources 使用 checkFilePaths 复核",
  recheckHelper.test(exportSrc),
);


// ---- 汇总 ----
if (failures.length) {
  process.exitCode = 1;
  console.error("verify-multi-select-interaction: 未通过 " + failures.length + " 项：");
  for (const f of failures) console.error("  ✗ " + f);
  process.exit(process.exitCode);
}
console.log("verify-multi-select-interaction: 全部断言通过（多选键盘分支/右键菜单接线/选中剪除/导出路径复核）");
