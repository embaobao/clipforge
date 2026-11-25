// 静态门禁：收藏详情可发现性（TASK-8）。
// 纯 Node ESM，无依赖；用 node scripts/verify-favorites-detail.mjs 运行。
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (p) => readFileSync(join(root, p), "utf8");
const failures = [];
const ok = (name, cond) => {
  if (!cond) failures.push(name);
};

// 1) clipboard-list-route.tsx：仅 trash 视图走 TrashPanel，其余统一 QuickPastePanel，无 favorites 独立列表分支
{
  const src = read("src/clipboard/components/clipboard-list-route.tsx");
  ok("list-route: trash 分支使用 TrashPanel", /activeView === "trash"[\s\S]*?<TrashPanel/.test(src));
  ok("list-route: 非-trash 分支使用 QuickPastePanel", /<QuickPastePanel/.test(src));
  ok("list-route: 不存在 favorites 独立列表组件分支", !/activeView === "favorites"/.test(src));
  ok("list-route: 无死 onRunPrimaryOpenAction 属性", !/onRunPrimaryOpenAction/.test(src));
}

// 2) ClipContextMenu.tsx：详情菜单项存在且无条件渲染
{
  const src = read("src/clipboard/components/ClipContextMenu.tsx");
  ok("context-menu: 存在 main.context.detail 菜单项", src.includes('tr("main.context.detail")'));
  const m = src.match(/<DropdownMenuItem[^>]*onSelect=\{[^}]*run\(onOpenDetail\)[^}]*\}[\s\S]{0,400}?main\.context\.detail/);
  ok("context-menu: detail 菜单项无条件渲染（不在 favorites/url 条件内）", Boolean(m));
}

// 3) QuickPastePanel.tsx：导入 navigateWorkspaceDetail，向 ClipboardRow 传 onOpenDetail，右键菜单按 contextMenu.item.id 导航
{
  const src = read("src/clipboard/components/QuickPastePanel.tsx");
  ok("panel: 导入 navigateWorkspaceDetail", /import\s*\{[^}]*navigateWorkspaceDetail[^}]*\}\s*from/.test(src));
  ok("panel: 向 ClipboardRow 传递 onOpenDetail", /<ClipboardRow[\s\S]*?onOpenDetail=/.test(src));
  ok("panel: 右键菜单 onOpenDetail 使用 contextMenu.item.id 导航", /onOpenDetail=\{\(\) =>[\s\S]{0,200}contextMenu\.item\.id[\s\S]{0,300}navigateWorkspaceDetail/.test(src));
}

// 4) ClipboardRowActions：可见详情按钮 + probe 属性 + 事件；无死 onPin 占位
{
  const src = read("src/clipboard/components/ClipboardRowActions.tsx");
  ok("actions: 存在 data-dev-probe=\"row-detail\" 按钮", src.includes('data-dev-probe=\"row-detail\"'));
  ok("actions: aria-label/title 使用 main.context.detail", src.includes('main.context.detail'));
  ok("actions: 点击调用 onOpenDetail(item) 并 stopPropagation", /onOpenDetail\(item\)/.test(src) && /stopPropagation/.test(src));
  ok("actions: 无死 onPin 占位残留", !/onPin/.test(src));
}
// 5) ClipboardRow：详情回调贯通到动作区，无死 onPin 占位
{
  const src = read("src/clipboard/components/ClipboardRow.tsx");
  ok("row: onOpenDetail 为必填回调", /onOpenDetail: \(item: ClipItem\) => void;/.test(src));
  ok("row: onOpenDetail 透传给 ClipboardRowActions", /<ClipboardRowActions[\s\S]*?onOpenDetail=\{onOpenDetail\}/.test(src));
  ok("row: 无死 onPin 占位残留", !/onPin/.test(src));
  ok("row: 无死 onOpen 属性或解构", !/onOpen\?:/.test(src) && !/onOpen:\s*_onOpen/.test(src));
}

// 5) clip-detail-route.tsx：onUpdateTags 走 updateClipTagsOnly 且输入不含 content
{
  const src = read("src/clipboard/components/clip-detail-route.tsx");
  const fn = src.match(/onUpdateTags=\{[\s\S]*?\n      \}\}/);
  ok("detail-route: onUpdateTags 调用 updateClipTagsOnly", Boolean(fn) && fn[0].includes("updateClipTagsOnly("));
  ok("detail-route: onUpdateTags 输入不含 content 字段", Boolean(fn) && !/\bcontent\s*:/.test(fn[0]));
}

if (failures.length > 0) {
  console.error(`[favorites-detail] 静态门禁未通过（${failures.length} 项）：`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exitCode = 1;
} else {
  console.log("[favorites-detail] 静态门禁全部通过：列表统一走 QuickPastePanel、右键/行内详情入口齐备、标签独立写回不含 content");
}
