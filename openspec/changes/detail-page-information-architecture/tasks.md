# Tasks: 详情页信息架构、类型渲染管线与插件化

## Phase 1: 布局重排（行为零变化）

- [ ] 1.1 新建 `src/workspace/components/detail/detail-layout.tsx`：五区骨架（crumb/meta/内容/插件占位/底部动作区），从 ClipDetailWorkspace 抽出渲染编排，保持既有 props 不变
- [ ] 1.2 DetailMeta 改造：三行 → 单行 chip 行（类型 + 来源 app + tags 全量 `overflow-x-auto` 横滚，点 tag 仍走 onSearchTag）；来源地址/应用上下文行删除，数据移入溢出菜单数据源
- [ ] 1.3 crumb 收敛：back + 标题 + prev/next + 溢出菜单（分组：复制地址/来源/应用上下文/采集上下文 JSON）；edit 钮移底部动作区
- [ ] 1.4 底部动作区：复制（`bg-primary text-primary-foreground` 主钮）/ 粘贴 / 编辑 / AI 触发钮 + detail-action 占位渲染点；PiAnalysisBar props 接口不变，仅迁移挂载位置
- [ ] 1.5 链接 chips 从独立底部区并入内容区尾部；采集上下文 accordion 删除，JSON 查看走底部滑入面板
- [ ] 1.6 验证：`pnpm build` + `cd src-tauri && cargo check` + `pnpm test:unit` + `pnpm test:boundaries`；`pnpm dev:sandbox` 真机走查六种 payloadKind + 长内容滚动 + 键盘 prev/next

## Phase 2: 类型渲染注册表（内置迁移，行为零变化）

- [ ] 2.1 新建 `src/workspace/components/detail/renderer-registry.ts`：DetailRendererEntry 类型 + builtinRenderers 8 条（迁移现有 if/else 分支，match 含 payloadKind/extensions/mimePrefix/heuristic/order）
- [ ] 2.2 golden 对照测试：fixture clips（image/file/imageUrl/html/link/json/markdown/纯文本）× 断言 resolveDetailRenderer 命中 id 与迁移前分支一致（先固化现分支命中表再动手）
- [ ] 2.3 ClipDetailWorkspace 只读态替换为 resolveDetailRenderer(clip) 分发；DetailPreview 各预览组件不动
- [ ] 2.4 验证：`pnpm test:unit`（含 golden）+ `pnpm dev:sandbox` 真机六类条目渲染对照截图无回归

## Phase 3: tag provenance 与内联编辑

- [ ] 3.1 `src/workspace/components/detail/tag-chips.tsx`：四源 chip（4px 来源色点 + tooltip 来源/时间）+ 横滚 + 行尾 + 钮内联编辑（回车加/点 x 删/建议 chips）
- [ ] 3.2 provenance 读写：clip record 解析 metadata_json.tags_provenance；保存时前端组装完整数组 + provenance 更新，走既有 update_clip_record 整体替换（后端协议不动）
- [ ] 3.3 PiAnalysisBar applyTags 写入 provenance source=ai
- [ ] 3.4 验证：`pnpm test:unit` + 沙箱真机：改 tag → 刷新 provenance 保持；AI applyTags → chip 出现 ai 色点

## Phase 4: 动效与可访问性

- [ ] 4.1 prev/next 方向感知过渡（translateY ±6px + fade 140ms cubic-bezier(0.32,0.72,0,1)）
- [ ] 4.2 AI/采集上下文底部滑入面板（220ms 同曲线、可打断、进出同路径）；溢出菜单 origin 缩放入场 120ms
- [ ] 4.3 复制成功反馈（主钮 success 置换 600ms）；tag 行内编辑展开高度过渡
- [ ] 4.4 全部动效 prefers-reduced-motion 退化 crossfade；验证 `defaults read com.apple.universalaccess reduceMotion` 开关下真机走查
- [ ] 4.5 验证：`pnpm build` + 真机动效可打断性（动画中途反向操作）走查

## Phase 5: 插槽占位与提案回写

- [ ] 5.1 detail-action / detail-section 占位渲染容器（空注册零 DOM、零开销，不阻塞内容首帧；>3 个折叠「扩展 (N)」）
- [ ] 5.2 renderer-registry 预留插件合并入口（读插件声明 match，与 builtin 合并排序；运行时本体未到前空数组直通）
- [ ] 5.3 回写 agent-plugin-runtime design §8 surface 表：新增 detail-renderer / detail-action / detail-section 三行（含字段、白名单组件、order 抢占授权、tag append 协议引用）
- [ ] 5.4 回写本提案 design §2/§3/§5 与实现状态对齐；docs/BUSINESS_INDEX.md 同步（detail 域入口改 detail-layout.tsx / renderer-registry.ts）
- [ ] 5.5 验证：`pnpm build` + `pnpm test:unit`（--check-index 过）+ openspec validate 全绿
