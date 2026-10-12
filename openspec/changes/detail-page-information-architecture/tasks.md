# Tasks: 详情页信息架构、三态编辑模型与插件化

## Phase 1: 布局重排与三态骨架（行为零变化迁移）

- [x] 1.1 安装 `react-icons`（仅按子路径导入 `react-icons/ri`）；prev/next 换 `RiArrowUpWideFill` / `RiArrowDownWideFill`
- [x] 1.2 新建 `src/workspace/components/detail/detail-layout.tsx`：五区骨架（crumb / 路径行 / meta 单行 / 内容三态容器 / 底部动作区），从 ClipDetailWorkspace 抽出渲染编排，props 透传不变
- [x] 1.3 DetailMeta 改造：三行 → 单行 chip 行（静态类型 chip + 来源 app chip + tags 横滚）；来源地址行删除并入数据源；来源 app chip 点击 → 采集原数据弹窗（既有 accordion 内容迁移为 modal）
- [x] 1.4 crumb 收敛：back + 标题 + prev/next + 溢出菜单；edit 钮移底部动作区
- [x] 1.5 三态状态机：`detail-state.ts`（'view' | 'edit' | 'diff'）+ E/双击/⌘S/Esc 键盘路由；底部动作区按 mode 切换按钮组
- [ ] 1.6 验证：`pnpm build` + `cd src-tauri && cargo check` + `pnpm test:unit` + `pnpm test:boundaries`；`pnpm dev:sandbox` 走查六种 payloadKind 浏览态

## Phase 2: MD 编辑器与 tags 行内编辑

- [x] 2.1 新建 `src/workspace/components/detail/md-editor.tsx`：工具条（B/I/S/H1/H2/列表/引用/行内代码/代码块/链接 + ⌘B/⌘I）+ textarea + 预览 tab + 状态行（Markdown · 字数 · 快捷键提示）
- [x] 2.2 编辑态挂载：替换下钻编辑层为内容区直挂（隐藏浏览态正文/路径行/提示行）；image/file 只读条目禁用编辑
- [x] 2.3 tags 行内编辑：编辑态 chip × 删、行尾 input 回车加；保存组装完整数组走 update_clip_record
- [ ] 2.4 验证：test:unit + 沙箱：E 进编辑、⌘B 加粗、预览 tab 渲染、⌘S 保存刷新生效、Esc 丢弃

## Phase 3: 复制三路（纯文本 / 原格式 / 路径）

- [x] 3.1 底部动作区：复制（主钮，plain）+ ⧉原格式（rich；representations 含 text/html|rtf 才启用）+ ⤓路径（无路径隐藏）
- [x] 3.2 来源路径行：`detail-path-row.tsx`——representations(file-list fileName) / analysis.url / metadata 取路径；等宽 chip 点击复制 + ⇧⌘C
- [x] 3.3 复制成功反馈（主钮 icon ✓ + success 600ms；路径行「已复制」就地置换）
- [ ] 3.4 验证：沙箱实测——富文本条目原格式复制粘贴到备忘录保留格式；路径粘贴到终端正确

## Phase 4: 类型渲染注册表（内置迁移，行为零变化）

- [x] 4.1 新建 `src/workspace/components/detail/renderer-registry.ts`：DetailRendererEntry + builtinRenderers 8 条（迁移 if/else 分支）
- [x] 4.2 golden 对照测试：fixture clips × 断言 resolveDetailRenderer 命中 id 与迁移前一致（先固化现分支命中表再动手）
- [x] 4.3 只读态替换为 resolveDetailRenderer(clip) 分发；DetailPreview 各预览组件不动
- [ ] 4.4 验证：test:unit（含 golden）+ 沙箱六类条目渲染对照

## Phase 5: tag provenance 与规则治理

- [x] 5.1 `tag-chips.tsx`：四源 chip（来源色点 + tooltip）+ 横滚 + AI 建议 chips 点选追加
- [x] 5.2 provenance 读写：metadata.tags_provenance 解析/组装；人工保存标 manual；AI applyTags 标 ai
- [x] 5.3 设置页「内置标签规则」分区：显式开关列表；#多行 规则删除（lib.rs L4953-4955）；自定义规则读写 settings.tag_rules
- [ ] 5.4 验证：改 tag → 刷新 provenance 保持；AI 建议 → chip 出现 ai 色点；#多行 不再自动打标

## Phase 6: 插件区与 diff 草稿态（宿主侧占位）

- [x] 6.1 插件区：tags 行右侧 `⌕ AI` 下拉容器（功能列表占位 + 队列入口 + 配置入口 + ＋安装入口）；队列角标 + popover（并发 2 状态机，宿主侧纯 UI）
- [x] 6.2 diff 草稿态：draft-banner + 行级 diff 渲染（简易 LCS）+ 保存生效/放弃草稿；draft 仅内存
- [x] 6.3 detail-action / detail-section 占位容器（空注册零 DOM；>3 折叠「扩展 (N)」）；renderer-registry 预留插件合并入口（空数组直通）
- [x] 6.4 回写 agent-plugin-runtime design §8 surface 表（detail-renderer / detail-action / detail-section + AI 功能契约引用）
- [ ] 6.5 验证：⌕ 下拉开合、队列状态流转、模拟草稿→diff→保存链路；空注册零 DOM 断言

## Phase 7: 动效与可访问性收口

- [x] 7.1 三态切换/prev-next 方向感知/popover origin 缩放/草稿横幅/diff 行交错/复制反馈/tag 增删/弹窗进出，按 design §7 参数表实施（统一 220ms/140ms 曲线，可打断）
- [x] 7.2 全部 prefers-reduced-motion 退化 crossfade；`defaults read com.apple.universalaccess reduceMotion` 开关下真机走查
- [x] 7.3 docs/BUSINESS_INDEX.md 同步（detail 域入口 detail-layout.tsx / renderer-registry.ts）；本提案 design 与实现状态对齐
- [ ] 7.4 终验：`pnpm build` + `cargo check` + `pnpm test:unit`（--check-index 过）+ `pnpm test:boundaries` + openspec validate 全绿 + 沙箱全流程走查（六类条目 × 三态 × 键盘动线 × 原格式/路径复制）
