# Tasks: remove-dead-snippet-tab

> 状态：**方案提案阶段，代码未改**。盟哥 2026-11-09 指示「先建立提案」；取得「是否进入实施」的明确确认前不改任何产品代码。
> **全部 checkbox 保持未勾**：按项目「不代勾 checkbox」口径由人工确认后勾选；第 1 节取证虽已完成，同样不代勾。
> 证据栏填文件路径 / 行号 / 命令输出；未跑项保持 `[ ]` 并写明原因，禁止写「应该没问题」。

## 1. 取证（已完成，只读；checkbox 待人工确认）

- [ ] 1.1 定位剪刀 tab：`TopToolbar.tsx:160-174` disabled、无 onClick、无 activeView 分支 -- 证据：`proposal.md` 调查结论 1
- [ ] 1.2 盘点同类占位：⌘K 菜单、空态按钮、QuickPastePanel 透传、App 两处「功能开发中」toast -- 证据：`proposal.md` 调查结论 2
- [ ] 1.3 核查 `mod+N` 快捷键全仓无绑定 -- 证据：`proposal.md` 调查结论 3
- [ ] 1.4 核查 i18n 死键与静态断言零命中 -- 证据：`proposal.md` 调查结论 4、5
- [ ] 1.5 划定数据契约边界（ClipBucket / search-query / Rust）与产品定位冲突 -- 证据：`proposal.md` 调查结论 6、冲突节

## 2. 提案交付（当前阶段）

- [ ] 2.1 建立 `openspec/changes/remove-dead-snippet-tab/` 三件套（proposal / tasks / specs delta） -- 证据：本目录
- [ ] 2.2 `openspec validate remove-dead-snippet-tab --strict` 通过 -- 证据：
- [ ] 2.3 向盟哥提交大白话结论：定位、范围、产品定位冲突点 -- 证据：
- [ ] 2.4 取得盟哥对「是否进入实施」及「片段功能是否保留为产品方向」的明确确认 -- **确认前不改任何产品代码**

## 3. 实施（待放行；逐项可独立回滚）

- [ ] 3.1 删 `TopToolbar.tsx` 片段按钮 + Tooltip，删 `Scissors` import，改文件头注释 -- 证据：
- [ ] 3.2 删 `QuickCommandMenu.tsx` 「新建片段」菜单项 + `onCreateSnippet` prop + `Plus` import -- 证据：
- [ ] 3.3 删 `ClipboardEmptyState.tsx` 空态按钮 + `onCreateSnippet` prop + `Button` import，改文件头注释 -- 证据：
- [ ] 3.4 清理 `QuickPastePanel.tsx` prop 定义 / 解构 / 透传 -- 证据：
- [ ] 3.5 清理 `App.tsx:1210`、`:1588` 两处 `onCreateSnippet` 传参 -- 证据：
- [ ] 3.6 zh-CN / en-US 对称删除 `main.dock.snippets`、`main.empty.createSnippet` -- 证据：

## 4. 验证（待放行）

- [ ] 4.1 `pnpm build:web` exit 0 -- 证据：
- [ ] 4.2 `pnpm test:unit` exit 0 -- 证据：
- [ ] 4.3 `pnpm check:i18n` exit 0（zh/en 键集对称） -- 证据：
- [ ] 4.4 `pnpm test:boundaries` 与 `pnpm locate --check-index` exit 0 -- 证据：
- [ ] 4.5 `cargo check --manifest-path src-tauri/Cargo.toml` exit 0 -- 证据：
- [ ] 4.6 dev 沙箱目视复核：顶部无剪刀图标、⌘K 菜单与空态无「新建片段」、其余交互不回归 -- 证据：
- [ ] 4.7 不跑 `pnpm build` / `tauri build` / codesign / hdiutil，不部署 `/Applications/ClipForge.app` -- 证据：

## 5. 台账同步（待放行，不擅自改）

- [ ] 5.1 `openspec list` active 由 27 → 28，同步 `docs/PROPOSAL_ROADMAP.md` 与 `openspec/project.md` 实数描述 -- 证据：
- [ ] 5.2 若盟哥裁决「片段仍是产品方向」，在 `AGENTS.md` / `openspec/project.md` 补一句「当前可见入口已移除，待另立提案重建」，避免文档与界面不一致 -- 证据：
