# 提案：剪贴板检索与标签质量修复——中文搜不到、无关键词提示、标签全是垃圾（clipboard-search-and-tag-quality）

> 状态（2026-11-24）：盟哥已确认实施（Plannotator 回复「开始」：关键词联想与按意思检索两个都要；链接/Markdown 自动标签去掉）。汉字部分词匹配、关键词联想、标签治理三项**代码已完成并通过门禁**，正式版尚未更新（等部署确认，见文末「实施结果」）；按意思检索不在本提案内，见「实施结果」末尾。
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

- `buildSearchSuggestions`（src/clipboard/clip-search.ts:130-166）只在输入以 `@` 或 `#` 开头的词上返回候选（`@` 是类型筛选与收藏，`#` 是已存标签）；输入普通文字直接返回空数组。
- 标题不能当摘要：`title` 取正文前 80 个字符（lib.rs:5161），375/645 行的标题就是正文开头。

**标签 1：181 条标签里 157 条是自动类型标签，14 条是垃圾，0 条是主题标签。**

- 已存标签共 18 种：「链接」137、「Markdown」20（合计 87%，来自内置规则 `default_tags`，lib.rs:5194）；`#` 号碎片 14 条：`5423`、`32517`、`0000`、`1963`、`32517**`、`腾讯会议：963-810-970`、`腾讯会议：957-290-688`、`企业微信会议：688-586-957`、`1a1a2e），只对主要物体添加，不要全局滥用。`（正文里 `#` 开头的 token 被原样入库）；其余 10 条里，聚合 2、token 2、fff 2、fish、Github-token、无用看形态是手打的，「AI」1 条是采集路径对 agent/mcp/ai 来源自动添加的来源标签（lib.rs:1489-1497，不经过 `default_tags`）。
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

- 新文件 `src-tauri/src/clipboard/search_text.rs`：写入索引时对 `content`、`plain_text`、`search_text`、`title`、`summary`、`tags` 六列做逐字切分——每个汉字前补一个空格，其余字符不动；`fts_query` 对每个空白分隔的词做同一变换后包成短语，最后一个词加前缀通配 `*`。
- `tags` 列必须一起切分：查询词变成「聚 合」之后，没切分的标签列再也匹配不上。实测「聚合」现在命中 2 行，全部来自 `tags` 列（这两行正文、标题都不含「聚合」）。
- 标点取舍：短语匹配允许跨标点相邻，例如搜「台再」会命中「平台，再搜」。这与 FTS5 对英文短语的既有行为一致（搜「land mark」命中「land, mark」）。要挡住它得在索引里给每个标点写占位 token，还会改变含符号的英文查询的行为，真实词几乎不会因此误命中，所以不要求。
- 存量索引一次性重建：`init_schema`（lib.rs:4880）已有 `PRAGMA user_version` 机制，2 → 3 时在事务内清空 `clip_fts` 并按新切法回填活跃行。`clip_fts` 是派生数据，迁移不触碰 `clips`。
- `clip_fts MATCH` 共 4 个调用点（lib.rs:2157、2173、2189、2254），统一经 `fts_query`，只改一处。
- 排序保持最近优先。实测 bm25 相关度排序会让短文本霸榜（搜「token」置顶的是一条裸 token，搜「会议」置顶的是企微链接），对剪贴板场景不如最近优先直观。

### 2. 关键词联想（前端）

- 新文件 `src/clipboard/keyword-suggestions.ts`：输入普通文字时，从已加载的历史里提取候选词——取标题（正文前 80 字）与已存标签中的汉字 2–4 字片段、≥4 字母的英文单词；至少在 3 行里出现才入选；一个更长片段与它的子串出现次数相同时只留长的；首尾是虚词的片段丢弃，另加一个小停用词表挡「然后」「直接」「进行」「什么」这类口头语。
- 实测（491 行）：候选 194 个汉字词、108 个英文词，高频为 插件 18、注册 13、平台 11、开发 11、生成 11、内容 10、项目 10、业务 9、提案 9、测试 9；输入「会」→ 会话、会议；「方」→ 方案；「re」→ review、requests、render、readme。
- 交互：复用现有联想下拉（src/clipboard/components/GlassSearchBar.tsx）与 ↑/↓/Enter 处理（src/clipboard/use-panel-keyboard.ts:326-342），最多 6 条，选中后用候选词替换当前输入并发起搜索；拼音继续用现成的 `matchPinyin`。不新增输入框、不新增面板，结果仍直接展示在主列表。
- 不发网络请求、不调用模型；候选只来自内存里的 `clips`。

### 3. 标签质量（Rust + 一次性清理）

- 3.1 话题校验：`default_tags` 只收 2–32 字、仅含字母/数字/汉字/`_`/`-`、至少含一个字母或汉字、且不是 3/4/6/8 位十六进制色值形态的 token。按存量数据，14 条垃圾全部被挡在外面。来源标签「AI」（lib.rs:1489-1497）不经过 `default_tags`，不在此校验范围内，保持不变。
- 3.2 类型标签不再落库：`builtinTagRules.link` 与 `builtinTagRules.markdown` 的默认值改为关闭，**前后端同改**——Rust 缺省值（lib.rs:5085 `unwrap_or(true)` 改为 `false`）、前端 `DEFAULT_SETTINGS.builtinTagRules`（src/settings/settings-model.ts:263）、设置页三个开关的缺省值（src/settings/sections/AgentUpdateTagSections.tsx:354-369 的 `?? true`）。只改 Rust 会被抵消：前端 state 常驻这三个键，任何设置变更后 220 ms 把全量 settings 写盘（src/clipboard/use-settings-sync.ts:63），显式 `true` 盖过 Rust 缺省值，清理过的类型标签又被重新打上。局限：已经把 `true` 落盘的安装保持开启——无法区分「显式打开」与「默认写入」，要在设置页手动关一次；盟哥当前的 `settings.json5` 没有这个键，升级后即关闭。设置页三个开关保留。
- 3.3 存量清理：升级时一次性移除两类已存标签——(a) 通不过 3.1 校验的标签；(b) 行内容满足内置规则条件的「链接」「Markdown」。按存量数据：移除 14 + 157 = 171 条，保留 10 条（聚合、token、fff、fish、Github-token、AI、无用）。被移除的标签写入该行 `metadata.tags_retired`，可据此恢复，不做物理丢弃。
- 3.4 `#` 下拉按出现次数排序（现在按插入顺序取前 8 条，clip-search.ts:150-157）。

## Impact

- Rust：`src-tauri/src/lib.rs`（`init_schema`、`upsert_fts`、`fts_query`、`default_tags`、`builtin_tag_rules_enabled`）+ 2 个新文件 `clipboard/search_text.rs`、`clipboard/tag_cleanup.rs`。
- 数据：`PRAGMA user_version` 2 → 3，`clip_fts` 整表重建一次（644 行量级，预计 <100 ms，实施时实测）；`clips.tags` 与 `clips.metadata` 按上文 3.3 改写一次。
- 前端：`src/clipboard/clip-search.ts`、`src/App.tsx`（联想接线，`applySearchSuggestion` 一并改）、`src/search-query.ts`（`SearchSuggestion` 增加 `kind: "keyword"` 后，`getSearchSuggestionToken`、`getSearchSuggestionAliases`、`matchesSearchSuggestionToken` 三处要加分支，否则 `tokenMap[suggestion.typeFilter]` 编译不过）、新增 `keyword-suggestions.ts`；`src/settings/settings-model.ts` 与 `src/settings/sections/AgentUpdateTagSections.tsx` 改类型标签缺省值。
- 不新增依赖、不新增 Tauri command、不新增 MCP 工具（agent-extension-seams 同源计数不变）。
- 行为变化：清理后 `#链接`、`#Markdown` 搜索无结果，改用 `@链接`、`@Markdown`；全文搜索的短语可以跨标点相邻（见第 1 节）。
- 联想候选与搜索质量随历史数量上限提高而变好；当前 500 条上限会把更早的历史清掉，见监听提案第 7 节。

## 不做

- 语义检索与向量索引：`clip_semantic_index` 表空置，没有任何 embedding 实现，属于 AGENTS.md 里的后续方向，另立提案。本提案把「自动提示」理解为「输入时给出关键词候选」，是否另有所指待盟哥确认。
- bm25 相关度排序（理由见第 1 节）。
- 规则标签与 LLM 打标、`tagMode` 两个选项的合并：随 automated-tagging-eval 一并处理。
- 标签来源回填：存量数据无法区分自动与手动，不伪造。
- 监听侧遗留项（来源应用慢采集、写回抑制按内容指纹）：已在 clipboard-listener-reliability 第 4 节登记。

## 评审记录（2026-11-24，跨模型复审）

| # | 发现 | 处理 |
|---|---|---|
| 1 | 方案 C 满足不了原 spec 的「标点不被跨越」：`，` 是分隔符，切分后「台」「再」相邻，`MATCH '"台 再"'` 命中「先搜平台，再搜方案」 | 放弃该要求：spec 删除该场景，第 1 节写明短语可跨标点相邻及理由 |
| 2 | 3.2 只改 Rust 缺省值会被前端写盘路径抵消，类型标签继续落库 | 3.2 改为前后端同改，列出三处位置与局限；tasks 4.2 加前端缺省值单测 |
| 3 | `tags` 列不切分，中文标签从全文搜索里消失（「聚合」2 → 0），Impact 未声明 | 第 1 节改为 `tags` 列一起切分；spec 增加「中文标签参与全文搜索」场景；tasks 2.2 加单测 |
| 4 | Impact 前端清单漏 `src/search-query.ts` | 已补，tasks 3.2 同步 |
| 5 | 「AI」标签被归为手打，实际是采集路径自动添加，3.1 的校验点盖不住 | 改为来源标签、不在校验范围；调查结论与 3.1 同步 |

## 验证

- 检索：生产库只读预演已给出上表；实施后在沙箱里用「平台」「方案」「会议」「token」四个词回归，期望都能命中含该词的历史行；搜「聚合」命中带该标签的 2 行。
- 联想：输入「会」「方」「re」，下拉出现上文候选；输入 `@`、`#` 时行为不变。
- 标签：迁移前后对比标签总数（期望 181 → 10）；复制「渠道 #13 状态正常」不产生标签，复制「周会 #工作 安排」产生「工作」；未显式设置时，复制含链接的文本不再带「链接」标签。
- 门禁：`pnpm build:web`、`pnpm test:unit`、`cd src-tauri && cargo check`、`openspec validate --all --strict`。

## 实施结果（2026-11-24）

与计划的出入和实测数字。代码已通过门禁，正式版尚未更新。

- 文件布局：原计划的 `search_text.rs` 与库升级合并为 `src-tauri/src/clipboard/search_index.rs`（切分、查询构造、`upsert_fts`、v2 → v3 重建）；标签校验与存量清理在 `src-tauri/src/clipboard/tag_cleanup.rs`。
- 写入侧也要切分：查询词切了而正文没切同样搜不到，所以写入与查询用同一个变换。`unicode61` 把字母、数字与汉字算作同一类 token，`1补流程` 会变成一个 token `1补`，因此字母或数字紧贴汉字时补一个空格（实测发现，单测覆盖）。
- 标点取舍（评审记录 1）：`，` 是分隔符，逐字切分后 `「台 再」` 这类跨标点相邻的查询也会命中，保留 FTS5 标准短语行为，不另造方案。
- 标签存量：预演结果是 181 → 8（不是计划里的 10）：`fff` ×2 的正文里是色值，按「色值不是话题」一并移除；其余 8 条是 聚合 2、token 2、fish、Github-token、AI、无用。被移除的 173 条记录在 158 行的 `metadata.tags_retired`。
- 关键词联想：用系统 `Intl.Segmenter` 试过（60 ms），ICU 词典把「插件」「文档」「标注」拆成单字，放弃；最终用 2–4 字词频统计加词内碎片剪枝（左侧或右侧加一个字后频次不低于原词 80% 的判为碎片）。生产库副本 666 条建索引 29 ms，得 702 个汉字词与 735 个英文词，单次输入 0.0–0.4 ms。
- 升级耗时：666 行、84 MB 的生产库副本，重建全文索引 279 ms（debug 构建），库文件大小不变。
- 未做：按意思检索（语义）。需要先定向量来源（本机模型还是云端接口，涉及体积、隐私与费用），另立提案，不塞进本次改动。
- 未验证：面板实机走查（屏幕锁定）、正式版部署。
