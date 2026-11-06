# 提案：详情页信息架构、三态编辑模型与插件化落位（detail-page-information-architecture）

> 所属波次：[product-iteration-master-plan](../product-iteration-master-plan/proposal.md) W1 核心闭环收口。为 [agent-plugin-runtime](../agent-plugin-runtime/proposal.md) Phase 3 UI 插槽与 detail-renderer 提供宿主侧落位；tag 写回协议对齐 [automated-tagging-eval](../automated-tagging-eval/proposal.md) 的三层边界裁决。
>
> 终版交互以 HTML 原型 v8 为准：`docs/layout-v8-compare.html`（v1–v7 迭代过程稿同目录留存）。

## 优先级

P1。用户直接反馈「详情也很乱可读性很差 也无法进行使用」；v1–v8 迭代定稿了三态模型（浏览/编辑/diff）、插件区右移、站内 diff、MD 编辑器、原格式/路径复制。

## 设计取向（design-taste-frontend 读法）

**Reading this as**: 工具型产品详情页重构 + 可扩展渲染管线设计，框架不变。受众是高频键盘用户。

- **模式**：Redesign - Preserve（框架/路由不动），渲染层做注册表化重构（行为零变化前提下的结构化）。
- **Dials**：VARIANCE 3 / MOTION 2 / DENSITY 5——克制、轻量、清晰层级（AGENTS.md 产品方向）；沿用 shadcn/ui 语义 token 与 28px ghost 工具钮语言，不发明平行体系。
- **Apple-design 落地**：Simplicity（内容本体最显眼）、Wayfinding（在 看/能做/怎么出去 三问内闭环）、Familiarity（进出同路径）、interruptible 微动效（active:scale-95 既有语言；高频键盘动作过渡 ≤140ms 且不锁输入）。

## 背景

现状详情页四类结构性问题：

1. **显示优先级倒置**：AI 分析条 + 三行元信息挡在内容前面，720×600 首屏内容占比 ~55%；低频层（AI 历史常驻、原始 JSON、地址行）与高频层（内容、复制）同级平铺。
2. **类型反应硬编码**：`ClipDetailWorkspace.tsx:369-406` 是 8 分支 if/else 链（image→file→imageUrl→html→link→json→markdown→fallback）。新增类型反应（如 yaml 高亮、csv 表格）必须改外壳代码；插件无法贡献类型行为。
3. **标签体系单薄**：tags 只显示 3 个截断；无来源区分（Rust 启发式/AI 建议/人工/插件写入共用一个扁平列表）；编辑必须进整页编辑器。
4. **编辑与产出模型缺失**：编辑态是独立下钻层，插件/AI 改写没有「草稿 vs 生效」的中间态，产出直接覆盖或被丢弃。

## 定稿要点（v8 终版，v1–v7 批注全量吸收）

1. **三态状态机**：浏览（只读 + tags + 插件区）⇄ 编辑（MD 编辑器满内容区，tags 行内改）→ diff（插件草稿，红删绿增 + 来源横幅）；E/双击进入，⌘S 保存生效，Esc 不保存退出。v6 的 AI 侧推面板、v5 的居中 AI 弹窗、v4 的边界工具条全部否决删除——不再有独立 AI 容器。
2. **编辑器 = MD/富文本**（改回早期集成版样式）：格式工具条（B/I/S · H1/H2 · 列表/引用/行内代码/代码块/链接，⌘B/⌘I）+ 编辑/预览 tab + 状态行；复用 DetailQuickEditor 骨架。
3. **插件区移到 tags 行右侧**：`[#tags…] | [插件 ⌕AI]`；AI 钮 = 下拉（自定义功能：名称 + 稳定 id + 快捷键 + 触发时机 manual/on-enter/on-save）+ 插件队列（并发上限 2，运行中/排队/完成）。
4. **插件产出 → 站内 diff**：改写类 → 详情页内容区红删绿增 + 草稿横幅标来源 id，保存即生效、不保存退出即弃（草稿不落库）；标签类 → 建议态点选。
5. **复制三路**：纯文本（主钮）/ 原格式（RTF/HTML+plain 多 flavor，走既有 write_clipboard_item rich 模式）/ 路径（顶部来源路径行 + ⇧⌘C）。
6. **类型 chip 下拉缓做**：先静态展示，类型快速操作进 backlog，等具体功能成型再定交互（renderer registry 的宿主侧基建照做，只是不暴露下拉 UI）。
7. **一处一操作**：复制=底部主钮 · 原格式=底部 ⧉原格式 · 路径=顶部路径行 · 编辑=底部 ✎/E · 类型信息=静态 chip · 采集原数据=来源 chip · 插件功能=tags 右侧 ⌕ 下拉 · 深层配置=设置页。
8. **翻条目 icon**：`react-icons/ri` 的 `RiArrowUpWideFill`/`RiArrowDownWideFill`（用户指定；项目引入 react-icons 依赖，lucide 保留给其余图标，此为唯一例外）。
9. **tag 规则治理**：内置规则回填设置页显式开关，#多行 规则删除（lib.rs L4953-4955），自定义规则支持 Agent 写入（tag_rules + provenance）。

## 目标

1. **内容优先布局**：打开详情页内容占视口主体（≥70%）；元信息压缩为单行 chip 行（静态类型 chip + 来源 app chip + tags 全量横滚）。
2. **三态编辑模型**：详情页本身即编辑器，编辑态 MD 编辑器最大化（隐藏浏览态正文与提示行）；diff 态承载插件/AI 产出的草稿对比。
3. **类型渲染管线统一化（detail renderer registry）**：现有 8 分支迁移为宿主内置 matcher 注册表（行为零变化）；matcher 声明式（payloadKind/extension/mime/heuristic/order），插件可声明 `detail-renderer` 插槽扩展类型反应。
4. **插件三落位**：`detail-action`（底部动作区按钮，带 match 条件按类型出动作）+ `detail-section`（内容尾部受控区块）+ `detail-renderer`（类型反应映射）。契约归 agent-plugin-runtime，本提案交付宿主侧 registry 与占位。
5. **插件 tag 逻辑细化**：四源分层（Rust 启发式 / 人工 / AI / 插件）+ provenance 记录（metadata.tags_provenance，additive）+ 写回协议（插件 append-only、AI merge 确认、人工权威替换）。
6. **动效规范**：三态切换 crossfade + 6px translateY 220ms 同曲线可打断；prev/next 方向感知 140ms；队列/下拉 popover 从触发钮 origin 缩放 120ms；reduced-motion 全退化 crossfade。

## 非目标

- 不改框架/路由/技术栈；不动 workspace-router 与列表→详情动线。
- 不实现插件运行时本体（QuickJS/cordis/Fiber 均归 agent-plugin-runtime Phase 1-2）；本提案只交付宿主侧 registry、落位与协议定义。
- 不做类型 chip 快速操作下拉（缓做，进 backlog）。
- 不改 default_tags 采集端垃圾 tag 的 # 提取白名单化（归 automated-tagging-eval / 独立修复）；本提案只管 #多行 规则删除、展示、provenance 与写回协议。
- 不做 AI 助手对话面板；AI 能力只以「功能条目 + 站内 diff」形态出现，经 MCP 工具调用通道（红线：AI 不进主体验/热路径）。
- 不引入新动画库；全部走现有 CSS transition/token。

## 用户价值

- 打开即见内容，首屏内容占比翻倍；动作集中一处，键盘动线不绕路。
- 编辑不再「去别处」：详情页内直接改内容与 tags，MD 工具条 + 预览降低格式成本。
- 插件/AI 产出可审视后采纳：diff 草稿协议保证「不落库、保存即生效、退出即弃」。
- 类型反应可扩展：宿主内置 8 类 + 插件声明式扩展（yaml/csv/自定义），不改宿主代码。
- 标签可信：来源可辨、插件只追加、人工值权威。
- 插件体系落地时详情页零改版接入。

## 验证

`pnpm build` + `cd src-tauri && cargo check` + `pnpm test:unit` + `pnpm test:boundaries`；渲染注册表迁移配 golden 对照（8 类 matcher 命中顺序回归）；真机 `pnpm dev:sandbox` 走查各 payloadKind × 三态切换 + reduced-motion + 键盘 prev/next + 原格式/路径复制实测粘贴。
