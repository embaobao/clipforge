# Tasks: clipboard-search-and-tag-quality

> 状态：**方案提案阶段，代码未改**，待盟哥审阅后执行第 2 节起的全部任务。
> 证据栏填计数 / 命令输出 / 截图路径；未跑项保持 `[ ]` 并写明原因，不代勾。

## 1. 取证（已完成，只读）

- [x] 1.1 检索命中率实测（现状 2 字部分词 0/162，三方案对照见 proposal「方案选型」） -- 证据：`.work/listener-fix/search-probe-omp-2.py` 输出，交付时已清理
- [x] 1.2 关键词候选质量预演（491 行，DF≥3 得 194 个汉字词 / 108 个英文词） -- 证据：`.work/listener-fix/suggest-probe-omp-1.py` 输出，交付时已清理
- [x] 1.3 标签存量统计（181 条：类型 157、垃圾 14、其余 10） -- 证据：生产库只读查询

## 2. 汉字部分词与英文前缀匹配（Rust）

- [ ] 2.1 新增 `clipboard/search_text.rs`：逐字切分函数与查短语构造函数，附单测（汉字逐字切开、英文数字 emoji 原样、末词前缀）；短语可跨标点相邻是已接受的行为，见 proposal 第 1 节 -- 证据：
- [ ] 2.2 `upsert_fts` 写入 `content`、`plain_text`、`search_text`、`title`、`summary`、`tags` 六列时应用切分（`tags` 不切分，中文标签就搜不到）；`fts_query` 应用同一变换；核对 4 个 `clip_fts MATCH` 调用点的绑定参数；附单测：带中文标签的行能被搜到 -- 证据：
- [ ] 2.3 `init_schema` 增加 user_version 2 → 3 分支：事务内清空并回填 `clip_fts`，失败整体回滚；记录回填耗时 -- 证据：
- [ ] 2.4 沙箱回归：搜「平台」「方案」「会议」「token」均命中含该词的历史行；搜「聚合」命中带该中文标签的 2 行 -- 证据：

## 3. 关键词联想（前端）

- [ ] 3.1 新增 `src/clipboard/keyword-suggestions.ts`：候选提取、频次门槛、同频剪枝、停用词，附单测 -- 证据：
- [ ] 3.2 `buildSearchSuggestions` 对普通文字返回关键词候选（≤6 条，`kind: "keyword"`）；`@`、`#` 路径不变，附单测；`src/search-query.ts` 的 `getSearchSuggestionToken`、`getSearchSuggestionAliases`、`matchesSearchSuggestionToken` 为 `kind: "keyword"` 补分支 -- 证据：
- [ ] 3.3 选中候选后替换当前输入并发起搜索，复用 ↑/↓/Enter 处理 -- 证据：
- [ ] 3.4 沙箱走查（解锁状态）：输入「会」「方」「re」出现候选；中英文混输无闪烁、列表不跳动 -- 证据：

## 4. 标签质量（Rust）

- [ ] 4.1 `default_tags` 话题校验（长度、字符集、必须含字母或汉字、排除色值形态），附单测覆盖存量 14 条垃圾形态；来源标签「AI」（`lib.rs:1489-1497`）不在校验范围，保持不变 -- 证据：
- [ ] 4.2 `builtinTagRules.link` / `markdown` 默认值改为关闭，前后端同改：Rust 缺省值（`lib.rs:5085`）、`src/settings/settings-model.ts:263`、`src/settings/sections/AgentUpdateTagSections.tsx:354-369` 的 `?? true`；显式设置优先；附单测：未显式设置时 Rust 读到关闭，前端缺省写盘的 JSON 不含显式 `true` -- 证据：
- [ ] 4.3 新增 `clipboard/tag_cleanup.rs`：一次性移除垃圾标签与自动类型标签，写入 `metadata.tags_retired`，附单测 -- 证据：
- [ ] 4.4 迁移前用生产库副本预演：标签总数 181 → 10，被移除 171 条均有 `tags_retired` 记录 -- 证据：
- [ ] 4.5 `#` 下拉按出现次数排序，附单测 -- 证据：

## 5. 验证与收尾

- [ ] 5.1 门禁：`pnpm build:web`、`pnpm test:unit`、`cd src-tauri && cargo check`、`openspec validate --all --strict` -- 证据：
- [ ] 5.2 `docs/BUSINESS_INDEX.md` 同步搜索行、标签行、剪贴板引擎行，`pnpm locate --check-index` 通过 -- 证据：
- [ ] 5.3 `pnpm tauri build` 并部署到 /Applications（需盟哥点头） -- 证据：
- [ ] 5.4 盟哥验收后归档 -- 证据：
