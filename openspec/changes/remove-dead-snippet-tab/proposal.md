# 提案：移除主面板无效的「片段」入口（remove-dead-snippet-tab）

> 状态：**方案提案，代码未改**。触发：2026-11-09 dev 沙箱功能验收中盟哥反馈「片段 tab 没有作用，删除了吧」，随后补充「剪刀」「先建立提案」。
> 定位对象：主面板顶部工具栏第三个灰色半透明剪刀图标（`data-dev-probe="top-scope-snippets"`）。
> 流程口径：提案先行。取得盟哥对「是否进入实施」的明确确认前，**不改任何产品代码**。

## Why

2026-11-09 `pnpm dev:sandbox` 功能验收时，盟哥在截图里指出顶部那个灰色剪刀图标点了没反应，要求删除。只读取证确认它是未实现功能的占位控件；同时发现同一「片段」功能还有三处同类占位入口，以及两处只弹「功能开发中」toast 的空 handler。这些入口对用户承诺了能力却无法兑现，属于可见的功能噪音。

### 调查结论（只读取证，2026-11-09 14:55–14:58）

1. **剪刀 tab 本身是死按钮**：`src/clipboard/components/TopToolbar.tsx:160-174` 的「片段」按钮带 `disabled` + `cursor-not-allowed opacity-40`，**没有 `onClick`、没有对应的 `activeView` 分支**；同文件 `:131-158` 的历史/收藏按钮才绑定 `onViewChange(...)`。点击不产生任何行为，盟哥的判断准确。
2. **同一未实现功能的其余可见占位**：
   - `src/clipboard/components/QuickCommandMenu.tsx:76-84`：⌘K 命令菜单「新建片段」项，`onSelect={onCreateSnippet}`，并标注 `mod+N`；
   - `src/clipboard/components/ClipboardEmptyState.tsx:37-47`：列表空态「新建片段」按钮，同样标注 `⌘N`；
   - `src/clipboard/components/QuickPastePanel.tsx:54,93,117`：`onCreateSnippet` 的 prop 定义、解构与透传；
   - `src/App.tsx:1210` 与 `src/App.tsx:1588`：两处 handler 都是 `() => toast.info("新建片段功能开发中")`，点了只弹一行开发中提示，无实际逻辑。
3. **承诺的快捷键也是空的**：`⌘N` / `mod+N` 在菜单和空态两处显示，但全仓 `src/` 搜 `key === "n"` 无命中（`use-panel-keyboard.ts` 无该分支），快捷键未注册。
4. **i18n 死键**：`main.dock.snippets`（片段 / Snippets）、`main.empty.createSnippet`（新建片段 / New snippet），在 `zh-CN.json:346,382` 与 `en-US.json:346,382` 对称存在，仅被上述占位引用。
5. **静态门禁无依赖**：全仓搜 `onCreateSnippet`、`top-scope-snippets`、两个 i18n key，`scripts/verify-*.mjs` **零命中**；删除不需要改任何断言。
6. **边界 / 反证**：`ClipBucket = "history" | "archive" | "snippet"`（`src/clipboard/clip-model.ts:10`、`src/services/contracts/clipboard-contracts.ts:17`）与 `src/search-query.ts:25,218` 的 bucket 过滤是**数据契约**，不是 UI 入口；`src/services/tauri-web-mock-store.ts:70` 的 `["代码", "片段"]` 是示例标签数据。二者均不在本次清理范围。

### 与产品定位的冲突（需盟哥裁决，提案不代决）

删「占位 UI」≠ 放弃「片段功能」。但 `AGENTS.md:9,14` 明确把「片段」列入第一阶段高频动作与「必须服务于快速粘贴」的产品方向，`openspec/project.md:5,13` 也把「片段视图」列为当前范围；`ai-model-plugin-productization/proposal.md:142` 还保留「内部推荐结果可保存为 snippet」的规划。

本提案**只收敛到清除当前不可达的占位**，不改 `AGENTS.md` / `openspec/project.md`、不动数据模型、不否定产品方向。若片段功能后续要落地，应另立提案重新设计入口与数据链路，届时再恢复可见 tab。这一取舍需盟哥在放行时一并确认。

## What（建议范围，待放行后执行）

1. 删 `TopToolbar.tsx` 的「片段」按钮与 Tooltip 整块（含 `data-dev-probe="top-scope-snippets"`），删 `Scissors` import，修正文件头「History/Favorites/片段/更多」注释。
2. 删 `QuickCommandMenu.tsx` 的「新建片段」菜单项、`onCreateSnippet` prop 与 `Plus` import。
3. 删 `ClipboardEmptyState.tsx` 空态的「新建片段」按钮、`onCreateSnippet` prop 与 `Button` import，修正文件头注释。
4. 清理 `QuickPastePanel.tsx` 的 prop 定义 / 解构 / 透传，清理 `App.tsx:1210`、`:1588` 两处 `onCreateSnippet` 传参。
5. `zh-CN.json` / `en-US.json` 对称删除 `main.dock.snippets`、`main.empty.createSnippet`。
6. 静态门禁：`pnpm build:web`、`pnpm test:unit`、`pnpm check:i18n`、`pnpm test:boundaries`、`pnpm locate --check-index`。**不跑 `pnpm build`**：该脚本会触发 `tauri build` / codesign / hdiutil 并重签覆盖 `release/*.dmg`，需盟哥单独点头；本提案用 `pnpm build:web` + `cargo check` 覆盖前端与 Rust 编译校验。
7. dev 沙箱目视复核：顶部工具栏只剩 时钟 / 收藏 / 更多，⌘K 菜单与列表空态不再出现「新建片段」，其余交互行为不变。

## Impact

- **前端 only，7 个文件**：`TopToolbar.tsx`、`QuickCommandMenu.tsx`、`ClipboardEmptyState.tsx`、`QuickPastePanel.tsx`、`App.tsx`、两份 locale。无 Rust 改动、无数据迁移、无设置字段变更。
- `docs/BUSINESS_INDEX.md` 无需改动：组件未新增 / 移动 / 重命名，索引路径不变。
- 不改 `scripts/verify-*.mjs` 断言；不勾任何既有 `tasks.md` checkbox；不置 backlog Done；不归档；不改台账。
- 本提案新建后 `openspec list` 的 active 实数由 27 → 28；`docs/PROPOSAL_ROADMAP.md` 与 `openspec/project.md` 的实数台账需同步，已列为待办（本轮不擅自改，避免与既有 25/27 冲突叠加）。
- 现有 dev 沙箱实例（`pnpm dev:sandbox`）由 vite HMR 承接前端改动，不会触发 Rust 重编译重启。

## 不做

- 不删 `ClipBucket` 的 `snippet` 分支、不改 `search-query.ts` 的 bucket 过滤、不改 Rust 侧契约。
- 不改 `AGENTS.md` / `openspec/project.md` 的产品方向表述。
- 不实现片段功能、不新增替代入口、不改 `snipaste-parity` 等 B 类待放行提案。
- 不碰 `tauri-web-mock-store.ts:70` 的示例标签数据。
- 不动「移到文件夹…」等其它 disabled 占位（盟哥只点名剪刀 / 片段）。
