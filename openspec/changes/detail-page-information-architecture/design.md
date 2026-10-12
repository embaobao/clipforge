# 设计：详情页信息架构、类型渲染管线与插件化

## 1. 显示优先级模型

按「每次访问都要用 / 扫一眼 / 显式动作才出现」三档分层：

| 层 | 内容 | 高度 | 频次 |
|---|---|---|---|
| ① Crumb | back + 标题 + prev/next + 溢出菜单 | 36px | 每次访问 |
| ② Meta 单行 | 类型 chip + 来源 app chip + tags 全量横滚 | 28px | 扫一眼 |
| ③ 内容主体 | detail renderer 渲染 + 链接 chips 尾挂 | flex-1（≥70%）| P0 |
| ④ detail-section | 插件受控区块（空注册零高度）| 动态 | 按插件 |
| ⑤ 底部动作区 | 复制(主钮)/粘贴/编辑/AI + detail-action 位 + 溢出 | 40px sticky | P0 动作 |

依据：内容与复制是日频 P0；AI 分析是显式动作不该常驻占黄金位；采集上下文是排障用低频层。

## 2. 类型渲染管线（detail renderer registry）

### 2.1 现状

`ClipDetailWorkspace.tsx` 只读态 L369-406 是 8 分支 if/else 链：image→file→imageUrl→html→link→json→markdown→fallback。每加一种类型反应都要改外壳；插件无从贡献。

### 2.2 目标结构

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

- **迁移策略**：Phase 1 把 8 分支逐条搬进 `builtinRenderers: DetailRendererEntry[]`，匹配顺序与现 if/else 完全一致（golden 对照：对同一批 fixture clip 逐个断言命中 renderer id）；外壳只剩 `resolveDetailRenderer(clip)` 一行分发。
- **resolve 顺序**：payloadKind 精确 > extensions/mime > heuristic；同层按 order。全不命中 → fallback readonly-text。
- **插件扩展点**：manifest 声明 `detail-renderer` 插槽（agent-plugin-runtime 侧 schema），传入受限 match 声明（无函数——不可信代码不能带 matcher 进宿主）；命中后由宿主用白名单组件渲染。插件自定义「文件类型检查」= match.extensions/mimePrefix 覆盖宿主默认（order 更小者胜，插件可用 order<100 抢占，需 manifest 授权）。
- **边界**：插件 renderer 只读展示，不能替换编辑态（编辑态仍走 DetailQuickEditor）；不能覆盖 image（防降级攻击）；白名单组件是宿主编译期集合，不开放注册自定义组件。

### 2.3 收益

- 「不同文件类型不同反应」有唯一扩展点；宿主加类型 = 加一条注册表项，不再改外壳。
- 插件贡献类型反应（yaml→format-panel、csv→json-tree、日志→readonly-text+高亮规则）零宿主改动。
- 类型反应可测试：registry 是纯数据 + 纯函数 resolve。

## 3. 插件 tag 逻辑（四源分层 + provenance）

### 3.1 四源

| 来源 source | 写入者 | 合并策略 | chip 视觉 |
|---|---|---|---|
| `heuristic` | Rust default_tags | 采集时一次性 | 默认 muted |
| `manual` | 用户 | 权威替换（整组覆盖）| accent |
| `ai` | AI 分析 applyTags | merge 确认后写入 | success |
| `plugin` | 插件 runtime | append-only（每插件至多 N 条/天，manifest 配额）| warning |

### 3.2 provenance 存储

`clips.metadata_json` 内 additive 字段 `tags_provenance: Record<tag, {source, ts, actor?}>`（actor=插件 id 或 provider 名）。不新建列、不改表结构；读取端 record 解析，未知 source 归为 heuristic 显示。

### 3.3 写回协议

- **人工**：详情页 tag chip 行进入快速编辑（点 + 展开内联编辑，见 §4），保存 = 前端组装完整 tags 数组 + provenance 中该 tag 标 manual，走既有 `update_clip_record` 整体替换。
- **插件**：只能 append（新增 tag 追加 + provenance 标 plugin:插件id）；不能删除/改名非自己写入的 tag（runtime 校验，越权拒绝）。
- **AI**：applyTags 合并去重后写入，provenance 标 ai:provider；用户在确认 UI 可剔除建议项。
- **删除规则**：用户删 tag 总是允许；插件删 tag 仅限 provenance.actor = 自己。
- **规则打标插件**（runtime §13 端到端示例）：manifest.config 声明规则（如「正文含 error/warn → 加 #日志」），runtime 在 capture 后事件回调里走插件 append 协议——「自定义 tag 规则」诉求由此闭环，无需用户写 matcher 函数。

### 3.4 chip 交互

- 只读态：全量横滚，chip 左上角 4px 来源色点（muted/success/warning），点 tag = 搜索；悬停 tooltip 显示「来源 · 时间」。
- 快速编辑：行尾 + 钮展开内联编辑（input + 建议 chips），回车加、点 x 删，保存走整体替换协议。避免每次改 tag 都进整页编辑器。

## 4. 顶部操作区与动效

### 4.1 crumb 收敛

back + 「详情 · {类型}」 + prev/next + 溢出菜单。原 edit 按钮移底部动作区；原 meta 行三枚复制小钮合并：复制/复制纯文本进底部动作区（次级菜单或长按），复制地址进溢出菜单。

### 4.2 溢出菜单结构（分组）

```
复制        复制地址 / 复制为纯文本
来源        来源地址(可复制) / 应用上下文摘要
上下文      采集上下文 JSON（→ 底部滑入面板）
```

### 4.3 动效规范（MOTION 2，全部可打断）

| 动效 | 参数 | reduced-motion |
|---|---layout|---|
| prev/next 切条目 | translateY ±6px + fade，140ms cubic-bezier(0.32,0.72,0,1)，方向感知 | crossfade |
| 溢出菜单入场 | 从触发钮 origin scale .96→1 + fade 120ms | fade |
| AI/JSON 底部面板滑入 | translateY 12px + fade 220ms 同曲线，可打断、进出同路径 | crossfade |
| tag chip 行内编辑展开 | 高度 + fade 140ms | fade |
| 复制成功 | 主钮短暂 success 色 + icon 置换 600ms | 仅 icon 置换 |

不引入动画库；全部 CSS transition + 既有 token。

## 5. 详情页插件化边界（回答「详情界面是否也可以插件化处理」）

**能插件化的**（声明式、宿主渲染）：
- detail-renderer：类型 → 白名单组件映射（§2）。
- detail-action：底部动作区按钮，带 match（按类型/扩展名出动作，如「图片 → 压缩」「yaml → 格式校验」）。
- detail-section：内容尾部区块（readonly-list/text 白名单），如「该剪贴板历史出现次数」。
- tag 规则：manifest.config 规则打标（§3.3）。

**不能插件化的**（信任边界）：
- 自定义 DOM/组件/样式注入——不可信代码不进 DOM 树。
- 编辑态替换、写剪贴板、覆盖 image renderer。
- 顶部 crumb/底部动作区布局本身——插件只填充预留位，不改布局。

结论：详情界面「可插件化处理」的正确形态 = **宿主定死骨架（五区布局）+ 插件填三个预留位（renderer/action/section）+ tag 规则**，而不是让插件自定义界面。

## 6. 实施分期

- **本提案 Phase 1-3**：布局重排 + 底部动作区 + meta 单行 + renderer registry 迁移（内置 8 类，行为零变化）+ tag provenance 读写 + 内联 tag 编辑 + 动效。
- **agent-plugin-runtime Phase 3 回写**：插件三落位 schema 进该提案 design §8 表格；本提案交付的 registry/落位/协议是其宿主侧依赖。
- **后续 change**：插件生态示例（yaml viewer、csv 表格、tag 规则包）单独提案。

## 7. 风险与对策

| 风险 | 对策 |
|---|---|
| renderer 迁移改变现有类型命中 | golden 对照测试：fixture clips × 8 类断言命中 id；先写对照再迁移 |
| provenance 与现 tags 数据不一致 | additive 字段，无 provenance 的旧 tag 显示为 heuristic 默认样式，不迁移不清洗 |
| 底部动作区挤压内容高度 | 动作区 40px 固定 + 内容 flex-1；720×600 下内容仍 ≥70% |
| 插件 renderer 抢占致体验劣化 | order 默认插件 200 > 宿主 100；抢占需 manifest 明示授权 |
| 动效引发可访问性回退 | 全部可打断 + prefers-reduced-motion 退化（既有 M5 基线） |
