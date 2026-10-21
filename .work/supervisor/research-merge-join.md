# 调研: 多项拼接(多条剪贴板内容合并)能力现状

日期: 2026-10-21 · 只读调研, 未动任何业务代码。

## 一、结论先行

「多项拼接」**前端已 90% 落地**: 多选 → 聚合复制/聚合工作区 → 拼接结果入库, 全链路可用。
真正缺的是三块: ①拼接格式不可定制(分隔符写死 `\n\n`, 聚合页「模板/结构化」两个按钮是 disabled 占位); ②MCP 面没有对外拼接工具(外部 Agent 无法"选 N 条→拼成一个→写回剪贴板"); ③富文本/图片/文件的真拼接(保格式合并), 依赖多格式保真线, 不是快活。
openspec **没有任何提案覆盖"拼接格式定制"本身**——盟哥这句原话在现有规划里是空白。

最快路径 = 前端拼接选项 + 新增 1 条 MCP 工具, 合计 1~1.5 天。

## 二、现状盘点(已有什么)

### 2.1 前端多选(完整)
- 状态: `selectedIds: Set<string>` + `multiSelectMode`, 在 `src/App.tsx:241-242`。
- 入口: 行右键菜单「多选此项」(`ClipContextMenu.tsx:105-112`, `handleRowStartMultiSelect` App.tsx:821)、⌘A 全选、⌘C 聚合复制、⌘X/Delete 批量删、⏎ 触发聚合(`src/clipboard/use-panel-keyboard.ts:167-207, 346`)。
- 底栏: `MultiSelectBottomBar.tsx` 显示计数 + 快捷键提示(主面板变体: 聚合复制/删除; 垃圾箱变体: 恢复/彻底删除, 无聚合)。
- 已知设计约束: 每次唤起面板多选被清空(`openspec/changes/settings-status-bar-and-dead-ai-cleanup/proposal.md:21` 记为"待拍板", 未实施)。

### 2.2 聚合复制 copySelectedClips(核心拼接, 已有)
`src/clipboard/use-clip-writeback.ts:175-227`:
```ts
const text = items.map((item) => item.content).join("\n\n");
```
- 拼接文本经 `capture_clip_record` 存为新 clip(source `ui:multi-select-aggregate`, metadata 带 itemIds/itemCount, 打「聚合」tag)。
- 再 `writeClipboard({ id: aggregate.id, pasteMode: "rich" })` 写回系统剪贴板; Tauri 失败降级 `navigator.clipboard.writeText`。
- 批量回写各源条目 copied/copyCount。
- ⚠️ 拼接逻辑(分隔符 `\n\n`)硬编码; `content` 是条目的纯文本投影——文件条目拼进来是路径字符串, 图片条目是描述文本, 不保留富格式。

### 2.3 聚合工作区 MultiAggregateWorkspace(预览面, 已有大半)
`src/workspace/components/MultiAggregateWorkspace.tsx` + `src/App.tsx:633-635, 1323-1346`:
- 聚合原文预览: `aggregatePreview`(同样 `join("\n\n")`, 第二处硬编码)。拼接顺序 = Set 插入顺序(点击顺序; ⌘A 全选则为列表序)。
- 可用动作: 复制全部(=copySelectedClips)、单条复制/打开、**分别导出文本文件**(Tauri 命令 `export_clip_text_files`, Rust 侧写盘)、**导出为表格**(TSV `title\tcontent` 拼一行, 走浏览器剪贴板, App.tsx:1338-1341)。
- **占位未接**: 「模板」(FileText) 和「结构化」(FileJson) 两个按钮硬编码 `disabled`(约 tsx:71-78), i18n key 已备好(`main.aggregate.template/structure`, zh-CN.json:274-275)。这就是拼接格式化的天然挂点, 前人留了坑没填。

### 2.4 Tauri/Rust 侧(只有积木, 无拼接命令)
- `generate_handler`(src-tauri/src/lib.rs:7863+) 约 90 条命令: 有 `capture_clip_record`、`query/search_clip_records`、`export_clip_text_files`(逐条落盘, 非合并)、`write_clipboard_item`/`paste_clipboard_item`。**无任何 merge/concat/join 命令**——拼接全在前端 TS 完成。
- Rust 无阻碍项: 现有积木(load_clip + capture_clip_record + write_clipboard_item)足够拼一条 MCP 工具出来。

### 2.5 MCP 面(最接近的缺口)
40 条工具契约(`src-tauri/src/mcp/specs.rs`, golden 冻结条数与顺序):
- `clipboard.context.compose`(dispatch.rs:184-254): 按 ids/favorites/search-result/all 拉多条→返回 `AgentContextSet.references`。**只读引用组合, 不产出拼接文本**, 且截断严格(maxCharsPerItem 2000/240, maxTotalChars 12000/4000), 给 Agent 当上下文用。
- `clipboard.copy`: 单条 by id/text。
- `clipf.get`/`clipf.search`/`clipf.export`: 外部 Agent 可自行拉全量→本地 join→`clipboard.copy {text}` 间接实现拼接, 但要三步、有契约摩擦。
- **没有** `clipboard.merge`/聚合复制类工具; `rg merge|concat|join src-tauri/src/mcp` 零命中(工具语义层面)。

### 2.6 openspec / backlog 提案覆盖判定
- **无直接提案**。相邻的:
  - `snipaste-parity` P3.8「分组+批量多选」(tasks.md:34, 未勾选, Phase 3.5 后排)——指管理面多选, 不含拼接格式。
  - `vercel-ai-sdk-integration`「多选后批量生成摘要」(proposal.md:200,329, 未勾选)——AI 批量, 非拼接。
  - `settings-status-bar-and-dead-ai-cleanup` 多选状态跨唤起保留(待拍板)。
  - `product-iteration-master-plan` 仅把聚合页列为 workspace 面(L466 明确"多选聚合视图不在本期")。
- 聚合页「模板/结构化」占位按钮不来自任何提案, 是 tailwind 重构时从旧组件原样搬下来的(无出处记载)。

## 三、缺口清单

| # | 缺口 | 影响 |
|---|------|------|
| G1 | 拼接分隔符/顺序/编号/前缀标题不可调, 两处硬编码 join("\n\n") | 盟哥点名的"拼接能力"最直接的短板 |
| G2 | 聚合页「模板/结构化」按钮 disabled 占位, 无实现无提案 | 功能面看得见摸不着 |
| G3 | MCP 无"多条→拼接→写回/入库"工具, context.compose 只给截断引用 | 外部 Agent 用不了此能力 |
| G4 | 拼接仅纯文本, 丢富格式(HTML/RTF/图片/文件列表) | 长活, 依赖多格式保真线 |
| G5 | 多选状态每次唤起清空(已记录待拍板) | 体验摩擦, 非拼接本体 |

## 四、最快落地路径

**A. 前端拼接选项(G1+G2, 最快)** — 纯前端, 不碰 Rust/golden:
1. `MultiAggregateWorkspace.tsx`: 把两个 disabled 按钮换成格式弹出菜单(分隔符: 空行/换行/空格/自定义; 编号开关; 模板=标题+正文前缀)。
2. `use-clip-writeback.ts` `copySelectedClips(items, options?)` 加 joinOptions 参数; `App.tsx` `aggregatePreview` 同步用同一 formatter(抽一个 `formatAggregate(items, opts)` helper 到 `clipboard-domain.ts`, 消掉两处硬编码)。
3. 状态: 拼接选项进 App state(或 localStorage 持久化, 沿用 panel-settings 模式)。
- 工作量: 约 150~250 行 diff, **0.5~1 天**(含 i18n 双语 + 手测)。

**B. MCP 工具 clipboard.merge(G3)** — Rust 增量, 复用现成积木:
1. `mcp/specs.rs` 加第 41 条 spec: `{ ids: string[], separator?: string, copyToClipboard?: bool, saveAsItem?: bool }`。
2. `mcp/dispatch.rs` 加路由→新 `dispatch_clipboard_merge`: 循环 `load_clip`→join→可选 `capture_clip_record`+`write_clipboard_item`。
3. **必须同步交接 golden**: `mcp/mod.rs:286-346` golden_tests 冻结 `specs.len()==40` 与名称序列, 加条目要改断言(specs.rs 头注释明示"增删必须显式交接 golden 清单")。
4. 前端消费面(`services/contracts/agent-contracts.ts` / pi clipForgeTools)若需同步注册, 加一条。
- 工作量: 约 120~180 行 Rust + 测试交接, **0.5 天**。

**C. 富格式拼接(G4)** — 依赖 `clipboard-multi-format-fidelity` / `file-image-clipboard-support` 的 representation 合并策略, HTML/RTF 拼接需格式层归并, **3~5 天起, 不是最快路径**, 建议另立提案。

**推荐**: A+B 一起走(合计 1~1.5 天), 即覆盖盟哥"多项拼接"的直觉需求(可调格式拼一个)+对外 Agent 能力面; C 缓。

## 五、风险与注意点

- 拼接顺序: `selectedInList` 按 Set 插入序=点击序(App.tsx:617-620), 底栏文案"按选择顺序拼接"与实现一致; A 方案加"按列表顺序"开关成本极低。
- 文件/图片条目进纯文本拼接会退化为路径/alt 字符串——A 方案格式菜单里对非 text 条目给显式提示即可, 与 G4 划清边界。
- MCP 聚合复制产生的新 clip 会被 watcher 再次观察入库的风险: 现路径 `lastSeenClipboard.current = text.trim()` 已压制(writeback.ts:194), B 方案 Rust 侧写回时须同样走 capture→write 同源闭环或显式标记 source 防重。
- golden 断言是硬闸: 只做 A 不动 40 条契约; 做 B 必须同 PR 改 golden_tests, 否则 CI 红。

## 六、下一步

把 A(拼接格式选项)立为 openspec change(补上 G2 占位按钮的出处), B 并入其 tasks 作 Phase 2, 交盟哥拍板后动工。
