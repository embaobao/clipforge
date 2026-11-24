# 提案：剪贴板检索与标签质量修复——中文搜不到、无关键词提示、标签全是垃圾（clipboard-search-and-tag-quality）

> 状态（2026-11-24）：调查完成，**待盟哥审阅后实施**，代码未改。
> 同轮排查的监听问题（容量超限硬删历史、采集阻塞轮询线程）已在 [clipboard-listener-reliability](../clipboard-listener-reliability/proposal.md) 第 7 节实现，本提案不重复。
> 规则标签与 LLM 打标见休眠提案 [automated-tagging-eval](../automated-tagging-eval/proposal.md)，本提案只做垃圾治理，不重复设计。

## 问题

盟哥原话（2026-11-24）：「检索很鸡肋 不会自动提示」「标签系统太烂」。

## 调查结论（证据）

数据口径：生产库 `~/Library/Application Support/ClipForge/clipforge.sqlite` 以 `immutable=1` 只读打开，活跃行 644（text 474 / attachment 151 / markdown 16 / table 3）。检索对照实验把数据放大 10 倍到 4910 行，贴近历史数量上限。

**检索 1：中文只能整段命中，英文只能整词命中。**

- 根因：`clip_fts` 用 FTS5 默认 `unicode61` 分词（src-tauri/src/lib.rs:4944），一段连续汉字是**一个 token**；`fts_query`（lib.rs:5221）把每个空白分隔的词包成精确短语，没有前缀匹配，也没有 LIKE 兜底。
- 实测（490 行文本类，部分词取自该行自身正文）：

| 查询形态 | 命中自身 |
|---|---|
| 汉字 2 字部分词（如用「平台」搜「插件化平台启动接线」） | 0/162 |
| 汉字 3 字部分词 | 0/162 |
| 整个以标点分段的汉字串 | 152/162（94%） |
| 英文整词 | 375/386（97%） |
| 英文前缀（≥6 字母单词的前 4 个字母） | 42/351（12%） |

- 139/490 行（28%）含 ≥8 字的连续汉字串，这些行用其中任何一个词都搜不到。搜「方案」找不到「整体方案都错了」，搜「奖励」找不到「及时奖励自己」。
- 排序只有最近优先（lib.rs:2220 `search_clip_records`），没有相关度；设置里的 `fuzzySearchEnabled` / `pinyinSearchEnabled` 只用于保存的搜索规则，不作用于主搜索。

**检索 2：输入时没有任何关键词提示。**

- `buildSearchSuggestions`（src/clipboard/clip-search.ts:130-166）只在输入以 `@` 或 `#` 开头时返回候选（`@` 是类型筛选与收藏，`#` 是已存标签）；输入普通文字直接返回空数组。
- 标题不能当摘要：`title` 取正文前 80 个字符（lib.rs:5161），375/645 行的标题就是正文开头。

**标签 1：181 条标签里 157 条是自动类型标签，14 条是垃圾，0 条是主题标签。**

- 已存标签共 18 种：「链接」137、「Markdown」20（合计 87%，来自内置规则 `default_tags`，lib.rs:5194）；`#` 号碎片 14 条：`5423`、`32517`、`0000`、`1963`、`32517**`、`腾讯会议：963-810-970`、`腾讯会议：957-290-688`、`企业微信会议：688-586-957`、`1a1a2e），只对主要物体添加，不要全局滥用。`（正文里 `#` 开头的 token 被原样入库）；其余 10 条看形态是手打的：聚合 2、token 2、fff 2、fish、Github-token、AI、无用。
- `normalize_tags`（lib.rs:5010）只截到 32 字、去重、限 12 个，没有合法性校验。
- 类型标签与 `@` 筛选重复：`@链接`、`@Markdown` 已能按类型筛（clip-search.ts:99-126），落库的「链接」「Markdown」是同一信息的第二种写法，却占着标签下拉和详情页。
- 自动标签与手动标签分不出来：`tags_provenance` 只存在于前端（src/workspace/components/detail/tag-provenance.ts），存量行全部没有来源记录。
- `tagMode` 的 `similar` 与 `rules` 行为完全相同（src/clipboard/clip-model.ts:442 `generateTags` 只判断是不是 `off`），`tagRules` 实际是保存的搜索，不产生标签。

## 方案选型（检索分词，真实数据）

| 设计 | 汉字 2 字部分词 | 汉字 3 字部分词 | 英文 4 字母前缀 | 中位延迟（4910 行） |
|---|---|---|---|---|
| A 现状 | 0/183 | 0/183 | 3/331 | 0.01 ms |
| B `tokenize='trigram'`，不足 3 字走 LIKE | 183/183 | 183/183 | 329/331 | 2 字查询 5.19 ms，3 字 0.03 ms |
| **C 汉字逐字切分 + 现有分词器** | 183/183 | 183/183 | 321/331（末词加 `*`） | 0.05–0.11 ms |

选 C：只有一条查询路径，不需要 LIKE 兜底，延迟与现状同量级；B 的 2 字查询要全表 LIKE，慢约 65 倍。

## What（建议范围）

### 1. 汉字部分词与英文前缀匹配（Rust）

- 新文件 `src-tauri/src/clipboard/search_text.rs`：写入索引时对 `content`、`plain_text`、`search_text`、`title`、`summary` 做逐字切分——每个汉字前补一个空格，其余字符不动（`tags` 不处理）；`fts_query` 对每个空白分隔的词做同一变换后包成短语，最后一个词加前缀通配 `*`。
- 存量索引一次性重建：`init_schema`（lib.rs:4880）已有 `PRAGMA user_version` 机制，2 → 3 时在事务内清空 `clip_fts` 并按新切法回填活跃行。`clip_fts` 是派生数据，迁移不触碰 `clips`。
- `clip_fts MATCH` 共 4 个调用点（lib.rs:2157、2173、2189、2254），统一经 `fts_query`，只改一处。
- 排序保持最近优先。实测 bm25 相关度排序会让短文本霸榜（搜「token」置顶的是一条裸 token，搜「会议」置顶的是企微链接），对剪贴板场景不如最近优先直观。

### 2. 关键词联想（前端）

- 新文件 `src/clipboard/keyword-suggestions.ts`：输入普通文字时，从已加载的历史里提取候选词——取标题（正文前 80 字）与已存标签中的汉字 2–4 字片段、≥4 字母的英文单词；至少在 3 行里出现才入选；一个更长片段与它的子串出现次数相同时只留长的；首尾是虚词的片段丢弃，另加一个小停用词表挡「然后」「直接」「进行」「什么」这类口头语。
- 实测（491 行）：候选 194 个汉字词、108 个英文词，高频为 插件 18、注册 13、平台 11、开发 11、生成 11、内容 10、项目 10、业务 9、提案 9、测试 9；输入「会」→ 会话、会议；「方」→ 方案；「re」→ review、requests、render、readme。
- 交互：复用现有联想下拉（src/clipboard/components/GlassSearchBar.tsx）与 ↑/↓/Enter 处理（src/clipboard/use-panel-keyboard.ts:326-342），最多 6 条，选中后用候选词替换当前输入并发起搜索；拼音继续用现成的 `matchPinyin`。不新增输入框、不新增面板，结果仍直接展示在主列表。
- 不发网络请求、不调用模型；候选只来自内存里的 `clips`。

### 3. 标签质量（Rust + 一次性清理）

- 3.1 话题校验：`default_tags` 只收 2–32 字、仅含字母/数字/汉字/`_`/`-`、至少含一个字母或汉字、且不是 3/4/6/8 位十六进制色值形态的 token。按存量数据，14 条垃圾全部被挡在外面。
- 3.2 类型标签不再落库：`builtinTagRules.link` 与 `builtinTagRules.markdown` 的默认值改为关闭（lib.rs:5085）。设置页三个开关保留，已显式打开的用户不受影响。
- 3.3 存量清理：升级时一次性移除两类已存标签——(a) 通不过 3.1 校验的标签；(b) 行内容满足内置规则条件的「链接」「Markdown」。按存量数据：移除 14 + 157 = 171 条，保留 10 条（聚合、token、fff、fish、Github-token、AI、无用）。被移除的标签写入该行 `metadata.tags_retired`，可据此恢复，不做物理丢弃。
- 3.4 `#` 下拉按出现次数排序（现在按插入顺序取前 8 条，clip-search.ts:150-157）。

## Impact

- Rust：`src-tauri/src/lib.rs`（`init_schema`、`upsert_fts`、`fts_query`、`default_tags`、`builtin_tag_rules_enabled`）+ 2 个新文件 `clipboard/search_text.rs`、`clipboard/tag_cleanup.rs`。
- 数据：`PRAGMA user_version` 2 → 3，`clip_fts` 整表重建一次（644 行量级，预计 <100 ms，实施时实测）；`clips.tags` 与 `clips.metadata` 按上文 3.3 改写一次。
- 前端：`src/clipboard/clip-search.ts`、`src/App.tsx`（联想接线）、新增 `keyword-suggestions.ts`；`SearchSuggestion` 增加一种 `kind: "keyword"`。
- 不新增依赖、不新增 Tauri command、不新增 MCP 工具（agent-extension-seams 同源计数不变）。
- 行为变化：清理后 `#链接`、`#Markdown` 搜索无结果，改用 `@链接`、`@Markdown`。
- 联想候选与搜索质量随历史数量上限提高而变好；当前 500 条上限会把更早的历史清掉，见监听提案第 7 节。

## 不做

- 语义检索与向量索引：`clip_semantic_index` 表空置，没有任何 embedding 实现，属于 AGENTS.md 里的后续方向，另立提案。本提案把「自动提示」理解为「输入时给出关键词候选」。
- bm25 相关度排序（理由见第 1 节）。
- 规则标签与 LLM 打标、`tagMode` 两个选项的合并：随 automated-tagging-eval 一并处理。
- 标签来源回填：存量数据无法区分自动与手动，不伪造。
- 监听侧遗留项（来源应用慢采集、写回抑制按内容指纹）：已在 clipboard-listener-reliability 第 4 节登记。

## 验证

- 检索：生产库只读预演已给出上表；实施后在沙箱里用「平台」「方案」「会议」「token」四个词回归，期望都能命中含该词的历史行。
- 联想：输入「会」「方」「re」，下拉出现上文候选；输入 `@`、`#` 时行为不变。
- 标签：迁移前后对比标签总数（期望 181 → 10）；复制「渠道 #13 状态正常」不产生标签，复制「周会 #工作 安排」产生「工作」。
- 门禁：`pnpm build:web`、`pnpm test:unit`、`cd src-tauri && cargo check`、`openspec validate --all --strict`。
