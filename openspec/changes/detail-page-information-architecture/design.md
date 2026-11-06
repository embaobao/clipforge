# 设计：详情页信息架构、三态编辑模型与插件化

> 终版交互参照 `docs/layout-v8-compare.html`（可交互原型）。本文与原型不一致时以本文为准并回改原型。

## 1. 显示优先级模型

按「每次访问都要用 / 扫一眼 / 显式动作才出现」三档分层：

| 层 | 内容 | 高度 | 频次 |
|---|---|---|---|
| ① Crumb | back + 标题 + prev/next（RiArrow*WideFill）+ 溢出菜单 | 36px | 每次访问 |
| ② 来源路径行 | 📁 等宽路径 chip（点击复制）+ 复制路径钮；无路径条目整行隐藏 | 26px，仅浏览态 | 文件/链接类常用 |
| ③ Meta 单行 | 静态类型 chip + 来源 app chip（点击=采集原数据弹窗）+ tags 全量横滚 + 右端插件区 | 28px | 扫一眼 |
| ④ 内容主体 | 三态之一：浏览（renderer 渲染）/ 编辑（MD 编辑器满高）/ diff（草稿对比）| flex-1（≥70%）| P0 |
| ⑤ 底部动作区 | 随状态切换（见 §4.3）| 40px sticky | P0 动作 |

依据：内容与复制是日频 P0；AI 分析是显式动作不该常驻占黄金位；采集上下文是排障用低频层。

## 2. 三态状态机

```
        E / 双击 / ✎
 浏览 ──────────────► 编辑
  ▲                     │ ⌘S（保存生效）
  │ ◄───────────────────┘
  │ ◄─ Esc（退出即弃）──┐│
  │                     ││
  │  插件改写产出        ││ 编辑中调插件 → 并入草稿
  └───────────────────► diff
        ⌘S=保存生效 / Esc=放弃草稿
```

- **浏览态**：只读 renderer 渲染 + 路径行 + tags（点击=搜索）。
- **编辑态**：MD 编辑器占满内容区（§3）；tags 行内编辑（× 删 / input 回车加）；顶部 chips/插件区仍可用。
- **diff 态**：草稿横幅（`◈ 草稿 来自插件 <srcId>`）+ 红删绿增行级 diff + 底部「保存生效 (⌘S) / 放弃草稿 (Esc)」。草稿不落库。
- **弹窗层仅两处**：采集原数据（来源 chip 触发）、AI 功能配置（⌕ 下拉内入口）。其余一律不开新层。
- 三态互斥，切换时内容区 crossfade（§7）；E 进编辑、Esc 层层后退（先关弹窗→退 diff/编辑→返回列表）。

## 3. 编辑态：MD/富文本编辑器（复用早期集成版样式）

骨架复用 `DetailQuickEditor`（顶部工具条 + 内容区 + 状态行），去掉下钻容器改为内容区直挂：

- **工具条**：B/I/S · H1/H2 · 列表/引用/行内代码/代码块/链接；⌘B/⌘I 快捷键作用于选区（无选区时插空标记并置光标于内）。
- **编辑/预览 tab**：预览即时渲染（标题/列表/加粗/斜体/删除线/行内代码/引用）；切 tab 保持滚动位置不保证（v1 不做）。
- **状态行**：`Markdown · N 字 · ⌘S 保存 · Esc 退出`，字数随输入实时更新。
- **存储模型**：编辑器值为纯 Markdown 文本，保存走既有 `update_clip_record`（content 整体替换）；对 image/file 条目编辑态禁用（只读类型）。
- **tags 行内编辑**：编辑态 tag chip 显示 ×，行尾 input 回车追加；保存时组装完整 tags 数组 + provenance 更新（§5）。

## 4. 底部动作区（随状态切换）

### 4.1 浏览态

`[⧉ 复制(主)] [⧉ 原格式] [⤓ 路径] [↵ 粘贴] [✎ 编辑] | … 扩展(N)`

- **复制**：纯文本，走既有 plain 模式。
- **复制原格式**：走 `write_clipboard_item` rich 模式（write.rs 已支持 text/html + text/rtf + text/plain 多 flavor，L79-80）；无富文本 representations 的条目降级禁用并 tooltip 说明。
- **复制路径**：与顶部路径行同源同义（⇧⌘C）；无路径条目隐藏。
- **粘贴**：复制后回写前台应用（既有能力）。
- **编辑**：进入编辑态。

### 4.2 编辑态 / diff 态

- 编辑态：`[保存生效 (⌘S)(主)] [不保存退出 (Esc)]`。
- diff 态：`[保存生效 (⌘S)(主)] [放弃草稿 (Esc)]` + 说明「草稿不落库」。

### 4.3 动作区渲染规则

按 mode 重挂按钮；detail-action 插件位在 `…` 溢出内（>3 个折叠「扩展 (N)」，空注册零 DOM）。

## 5. 插件 tag 逻辑（四源分层 + provenance）

### 5.1 四源

| 来源 source | 写入者 | 合并策略 | chip 视觉 |
|---|---|---|---|
| `heuristic` | Rust default_tags | 采集时一次性 | 默认 muted |
| `manual` | 用户 | 权威替换（整组覆盖）| accent |
| `ai` | AI 分析 applyTags | merge 确认后写入 | success |
| `plugin` | 插件 runtime | append-only（每插件至多 N 条/天，manifest 配额）| warning |

### 5.2 provenance 存储

`clips.metadata`（前端 ClipRecord.metadata，Rust 侧 metadata_json）内 additive 字段 `tags_provenance: Record<tag, {source, ts, actor?}>`。不新建列、不改表结构；读取端 record 解析，未知 source 归为 heuristic 显示。

### 5.3 写回协议

- **人工**：编辑态 tags 行内改完，保存 = 前端组装完整 tags 数组 + provenance 中该 tag 标 manual，走既有 `update_clip_record` 整体替换。
- **插件**：只能 append；不能删除/改名非自己写入的 tag（runtime 校验，越权拒绝）。
- **AI**：建议态点选追加（v8 定稿：不走确认弹窗，建议 chips 常驻 tags 行尾，点选即加），provenance 标 ai:provider。
- **删除规则**：用户删 tag 总是允许；插件删 tag 仅限 provenance.actor = 自己。

### 5.4 内置 tag 规则治理（设置页）

- 内置规则（含 #多行，lib.rs L4953-4955）回填为设置页显式开关列表；#多行 规则直接删除（用户定稿）。
- 自定义规则：tag_rules 存 settings（规则数组 + provenance），Agent 可经 MCP 设置工具写入；采集端 default_tags 读合并后的规则集。

## 6. 类型渲染管线（detail renderer registry）

### 6.1 现状

`ClipDetailWorkspace.tsx` 只读态 L369-406 是 8 分支 if/else 链：image→file→imageUrl→html→link→json→markdown→fallback。

### 6.2 目标结构

```ts
/** 详情页类型渲染注册表（宿主内置 + 插件声明合并） */
interface DetailRendererEntry {
  id: string;                    // 'builtin.image' / 'my-plugin.yaml-view'
  match: {
    payloadKind?: PayloadKind;   // 精确匹配 clips.kind
    extensions?: string[];       // ['.yaml', '.yml']，file 条目用
    mimePrefix?: string;         // 'text/' 等，file 条目用
    heuristic?: (c: ClipRecord) => boolean;  // 仅宿主内置可用；插件只能声明式
    order?: number;              // 同命中时排序，小者胜；宿主默认 100，插件默认 200
  };
  component: 'readonly-text' | 'image' | 'html' | 'link-list' | 'json-tree'
           | 'markdown' | 'file-card' | 'format-panel';  // 白名单组件名，宿主渲染
}
```

- **迁移策略**：把 8 分支逐条搬进 `builtinRenderers: DetailRendererEntry[]`，匹配顺序与现 if/else 完全一致（golden 对照：fixture clips 逐个断言命中 renderer id）；外壳只剩 `resolveDetailRenderer(clip)` 一行分发。
- **resolve 顺序**：payloadKind 精确 > extensions/mime > heuristic；同层按 order。全不命中 → fallback readonly-text。
- **插件扩展点**：manifest 声明 `detail-renderer` 插槽，传入受限 match 声明（无函数）；命中后由宿主用白名单组件渲染。插件「自定义文件类型检查」= match.extensions/mimePrefix 覆盖宿主默认（order<100 抢占需 manifest 授权）。
- **边界**：插件 renderer 只读展示，不能替换编辑态；不能覆盖 image（防降级攻击）；白名单组件是宿主编译期集合。
- **类型 chip**：终版为静态展示（类型快速操作下拉缓做）；registry 基建照做，未来开下拉只加 UI 不动管线。

### 6.3 收益

- 「不同文件类型不同反应」有唯一扩展点；宿主加类型 = 加一条注册表项。
- 插件贡献类型反应零宿主改动；registry 是纯数据 + 纯函数 resolve，可测试。

## 7. 动效规范（MOTION 2，全部可打断）

依据 apple-design（Designing Fluid Interfaces）+ improve-animations 审计框架，按「状态切换 / 高频键盘 / 指令性反馈」三档定值。统一曲线 `cubic-bezier(0.32, 0.72, 0, 1)`（既有 token 语言），全部 transform+opacity（compositor-friendly），动画中不锁输入，reduced-motion 退化 crossfade。

| 动效 | 触发 | 参数 | reduced-motion |
|---|---|---|---|
| 三态切换（浏览⇄编辑⇄diff） | mode 变化 | 内容区 fade + translateY 6px（进编辑向下、进 diff 向上、回浏览归零），220ms | crossfade |
| prev/next 切条目 | J/K | translateY ∓6px + fade，140ms，方向感知；进行中再按立即反向（可打断） | crossfade |
| 下拉/队列 popover 开 | ⌕ 点击 | 从触发钮 origin scale .96→1 + fade 120ms；transform-origin 设触发钮 | fade |
| 草稿横幅出现 | 进 diff 态 | 从顶部 translateY -8px + fade 160ms（先于 diff 内容） | fade |
| diff 行进入 | 进 diff 态 | 每行 opacity 0→1 交错 20ms（最多 8 行，长列表不交错） | 同时 fade |
| 复制成功 | 底部主钮 | icon 置换 ✓ + success 色 600ms 回落 | 仅 icon 置换 |
| tag 添加/删除 | 编辑态行内 | chip scale .9→1 + fade 120ms / 删除 fade+scale 收缩 100ms | fade |
| 队列项状态流转 | 运行→完成 | spinner→✓ icon 置换 + 状态色，无位移 | 同 |
| 弹窗（原数据/配置） | 打开 | overlay fade 140ms + modal scale .97→1 + translateY 8px，160ms；关闭反向同路径（进出同路径） | fade |
| 路径复制成功 | 路径行 | 「已复制」文本就地置换 900ms | 同 |

**禁止**：全屏移动背景、慢循环振荡、突然亮度跳变、动画期间锁 pointer-events。

**高频纪律**：键盘切条目（J/K/E/⌘S/Esc）路径上零 debounce 零人为 delay；140ms 上限仅对连续高频动作生效。

## 8. 详情页插件化边界

**能插件化的**（声明式、宿主渲染）：
- detail-renderer：类型 → 白名单组件映射（§6）。
- detail-action：底部动作区 `…` 溢出内按钮，带 match（按类型/扩展名出动作）。
- detail-section：内容尾部区块（readonly-list/text 白名单）。
- tag 规则：manifest.config 规则打标（§5.3）。

**不能插件化的**（信任边界）：
- 自定义 DOM/组件/样式注入——不可信代码不进 DOM 树。
- 编辑态替换、写剪贴板、覆盖 image renderer。
- 顶部 crumb/底部动作区布局本身——插件只填充预留位，不改布局。

结论：详情页「可插件化」= 宿主定死骨架（五区布局 + 三态机）+ 插件填三个预留位 + tag 规则。

## 9. 插件/AI 功能契约（宿主侧落位；细节归 agent-plugin-runtime）

- **功能条目**：稳定 id（如 `ai.polish`）+ 名称 + 快捷键（可绑/清空）+ 触发时机（manual / on-enter / on-save）+ match 类型。设置页同 schema，Agent 可写入。
- **队列**：并发上限 2；⌕ 钮角标显示进行中数；下拉内「插件队列」入口看运行中（spinner）/排队中/完成。
- **产出路由**：改写类 → diff 态（草稿协议，§2）；标签类 → tags 行尾建议 chips 点选；只读类（概要）→ toast/临时展示，不进 diff。
- **草稿协议**：draft = { content: string, srcId: string, ts }；仅存内存，⌘S 生效（update_clip_record）、Esc 弃；不落库不持久化。

## 10. 实施分期

- **本提案 Phase 1-5**：布局重排（含路径行）→ 三态机 + MD 编辑器 → 复制三路 → renderer registry 迁移 → tag provenance + 设置页规则治理 → 动效 → 插槽占位。
- **agent-plugin-runtime Phase 3 回写**：detail-renderer / detail-action / detail-section 三行进该提案 design §8 surface 表；本提案交付的 registry/落位/协议是其宿主侧依赖。
- **后续 change**：插件生态示例（yaml viewer、csv 表格、tag 规则包）单独提案；类型 chip 快速操作下拉（backlog，等具体功能）。

## 11. 风险与对策

| 风险 | 对策 |
|---|---|
| renderer 迁移改变现有类型命中 | golden 对照测试：fixture clips × 8 类断言命中 id；先固化再迁移 |
| MD 编辑器对非 markdown 条目的语义 | 编辑器只管 content 文本；html/image/file 只读或纯文本编辑，UI 明示 |
| provenance 与现 tags 数据不一致 | additive 字段，无记录的旧 tag 显示为 heuristic 默认样式，不迁移不清洗 |
| 原格式复制在无富文本条目上误触发 | 按 representations 探测（text/html 或 text/rtf 存在才启用），无则禁用+tooltip |
| 插件 renderer 抢占致体验劣化 | order 默认插件 200 > 宿主 100；抢占需 manifest 明示授权 |
| 动效引发可访问性回退 | 全部可打断 + prefers-reduced-motion 退化（既有 M5 基线） |
| react-icons 新依赖体积 | 仅引 `react-icons/ri` 两个 icon（tree-shake 按 ES module 子路径导入，只打包 2 个 path） |
