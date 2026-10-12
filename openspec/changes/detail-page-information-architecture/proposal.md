# 提案：详情页内容编排、类型渲染管线与插件化落位（detail-page-information-architecture）

> 所属波次：[product-iteration-master-plan](../product-iteration-master-plan/proposal.md) W1 核心闭环收口。为 [agent-plugin-runtime](../agent-plugin-runtime/proposal.md) Phase 3 UI 插槽与 detail-renderer 提供宿主侧落位；tag 写回协议对齐 [automated-tagging-eval](../automated-tagging-eval/proposal.md) 的三层边界裁决。

## 优先级

P1。用户直接反馈「详情也很乱可读性很差 也无法进行使用」；二期扩展（类型反应统一化 + 详情插件化）承接用户诉求「不同文件类型不同反应如何统一化插件化、详情界面是否可插件化、自定义文件类型检查」。

## 设计取向（design-taste-frontend 读法）

**Reading this as**: 工具型产品详情页重构 + 可扩展渲染管线设计，框架不变。受众是高频键盘用户。

- **模式**：Redesign - Preserve（框架/路由不动），渲染层做注册表化重构（行为零变化前提下的结构化）。
- **Dials**：VARIANCE 3 / MOTION 2 / DENSITY 5——克制、轻量、清晰层级（AGENTS.md 产品方向）；沿用 shadcn/ui 语义 token 与 28px ghost 工具钮语言，不发明平行体系。
- **Apple-design 落地**：Simplicity（内容本体最显眼）、Wayfinding（在 看/能做/怎么出去 三问内闭环）、Familiarity（进出同路径）、interruptible 微动效（active:scale-95 既有语言；高频键盘动作过渡 ≤140ms 且不锁输入）。

## 背景

现状详情页四类结构性问题：

1. **显示优先级倒置**：AI 分析条 + 三行元信息挡在内容前面，720×600 首屏内容占比 ~55%；低频层（AI 历史常驻、原始 JSON、地址行）与高频层（内容、复制）同级平铺。
2. **类型反应硬编码**：`ClipDetailWorkspace.tsx:369-406` 是 8 分支 if/else 链（image→file→imageUrl→html→link→json→markdown→fallback）。新增类型反应（如 yaml 高亮、csv 表格）必须改外壳代码；插件无法贡献类型行为。
3. **标签体系单薄**：tags 只显示 3 个截断；无来源区分（Rust 启发式/AI 建议/人工/插件写入共用一个扁平列表）；编辑是整页编辑器才能做。
4. **顶部动作区未设计**：crumb 里 edit/overflow 与 meta 行的复制按钮、AI bar 三处动作分散，无动效语言。

## 目标

1. **内容优先布局**：打开详情页内容占视口主体（≥70%）；元信息压缩为单行 chip 行（类型 + 来源 app + tags 全量横向滚动）；来源地址/应用上下文/采集上下文 JSON 收进 crumb 溢出菜单。
2. **底部动作区**：复制（主钮）/粘贴/编辑/AI 分析统一收进底部 sticky 动作区；AI 结果与采集上下文 JSON 共用底部滑入面板（可打断、进出同路径）。
3. **类型渲染管线统一化（detail renderer registry）**：现有 8 分支迁移为宿主内置 matcher 注册表（行为零变化）；matcher 声明式（payloadKind/extension/mime/heuristic/order），插件可声明 `detail-renderer` 插槽扩展类型反应（如 `.yaml → readonly-text`），渲染端只允许受控白名单组件——「不同文件类型不同反应」与「自定义文件类型检查」由此统一插件化。
4. **插件三落位**：`detail-action`（底部动作区按钮，带 match 条件按类型出动作）+ `detail-section`（内容尾部受控区块）+ `detail-renderer`（类型反应映射）。契约归 agent-plugin-runtime（宿主渲染、插件零 DOM、声明式注册），本提案交付宿主侧 registry 与占位。
5. **插件 tag 逻辑细化**：四源分层（Rust 启发式 / 人工 / AI / 插件）+ provenance 记录（metadata_json.tags_provenance，additive）+ 写回协议（插件 append-only、AI merge 确认、人工权威替换）；详情页 tag chip 展示来源。规则打标插件（runtime §13 示例）经 manifest.config 声明规则即闭环「自定义 tag 规则」诉求。
6. **顶部操作区优化与动效**：crumb 收敛为 back + 标题 + prev/next + 溢出菜单（分组：复制/来源/上下文）；切条目方向感知过渡（6px translateY + fade 140ms，可打断）；菜单从触发钮 origin 缩放入场；reduced-motion 全部退化 crossfade。

## 非目标

- 不改框架/路由/技术栈；不动 workspace-router 与列表→详情动线。
- 不实现插件运行时本体（QuickJS/cordis/Fiber 均归 agent-plugin-runtime Phase 1-2）；本提案只交付宿主侧 registry、落位与协议定义。
- 不改 default_tags 采集端垃圾 tag 问题（# 提取白名单化归 automated-tagging-eval / 独立修复）；本提案只管展示、provenance 与写回协议。
- 不做 AI 助手对话面板。
- 不引入新动画库；全部走现有 CSS transition/token。

## 用户价值

- 打开即见内容，首屏内容占比翻倍；动作集中一处，键盘动线不绕路。
- 类型反应可扩展：宿主内置 8 类 + 插件声明式扩展（yaml/csv/自定义），不改宿主代码。
- 标签可信：来源可辨、插件只追加、人工值权威。
- 插件体系落地时详情页零改版接入。

## 验证

`pnpm build` + `cd src-tauri && cargo check` + `pnpm test:unit` + `pnpm test:boundaries`；渲染注册表迁移配 golden 对照（8 类 matcher 命中顺序回归）；真机 `pnpm dev:sandbox` 走查各 payloadKind + reduced-motion + 键盘 prev/next。
