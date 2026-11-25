# Tasks: clipboard-search-and-tag-quality

> 状态（2026-11-24）：盟哥已确认实施（Plannotator 回复「开始」）并指示直接部署。第 2–4 节代码已完成、门禁通过，22:23 已部署到正式版（提交 d00d3d4）。面板走查 2.4 / 3.4 未做（部署时屏幕锁定，不向用户会话注入按键），等 5.4 验收归档。
> 证据栏填计数 / 命令输出 / 截图路径；未跑项保持 `[ ]` 并写明原因，不代勾。

## 1. 取证（已完成，只读）

- [x] 1.1 检索命中率实测（现状 2 字部分词 0/162，三方案对照见 proposal「方案选型」） -- 证据：`.work/listener-fix/search-probe-omp-2.py` 输出，交付时已清理
- [x] 1.2 关键词候选质量预演（491 行，DF≥3 得 194 个汉字词 / 108 个英文词） -- 证据：`.work/listener-fix/suggest-probe-omp-1.py` 输出，交付时已清理
- [x] 1.3 标签存量统计（181 条：类型 157、垃圾 14、其余 10） -- 证据：生产库只读查询

## 2. 汉字部分词与英文前缀匹配（Rust）

- [x] 2.1 新增 `clipboard/search_index.rs`（原计划名 `search_text.rs`，与库升级合并为一个模块）：逐字切分函数与查短语构造函数，附单测（汉字逐字切开、英文数字 emoji 原样、末词前缀、字母或数字紧贴汉字时补空格）；短语可跨标点相邻是已接受的行为，见 proposal 第 1 节 -- 证据：`cargo test --lib` 中 `clipboard::search_index::tests::*` 2 项通过
- [x] 2.2 `upsert_fts` 写入 `content`、`plain_text`、`search_text`、`title`、`summary`、`tags` 六列时应用切分（`tags` 不切分，中文标签就搜不到）；`fts_query` 应用同一变换；核对 4 个 `clip_fts MATCH` 调用点（`lib.rs:2172`、`2188`、`2204`、`2268`）的绑定参数；附单测：带中文标签的行能被搜到 -- 证据：`chinese_tag_is_searchable`、`han_substring_and_english_prefix_are_searchable` 通过；生产库副本升级后 `MATCH '"聚 合"*'` 命中 2 行
- [x] 2.3 `init_schema` 增加 user_version 2 → 3 分支：事务内清空并回填 `clip_fts`，失败整体回滚；记录回填耗时 -- 证据：生产库副本（666 行、84 MB）重建 279 ms（debug 构建），库文件大小不变；`schema_upgrade_retires_tags_and_rebuilds_index` 通过
- [ ] 2.4 沙箱回归：搜「平台」「方案」「会议」「token」均命中含该词的历史行；搜「聚合」命中带该中文标签的 2 行 -- 证据：未跑，屏幕锁定无法走查。副本实测：183 个两字查询，命中查询数 28 → 183，单次查询 66 µs（最大 371 µs）

## 3. 关键词联想（前端）

- [x] 3.1 新增 `src/clipboard/keyword-suggestions.ts`：候选提取（2–4 字词频）、频次门槛、碎片剪枝、停用词、拼音，无依赖，附单测 -- 证据：`node scripts/verify-keyword-suggestions.mjs` 通过，已挂入 `pnpm test:unit`；生产库副本 666 条建索引 29.1 ms，得 702 个汉字词 / 735 个英文词，单次输入 0.0–0.4 ms
- [x] 3.2 `buildSearchSuggestions` 对普通文字返回关键词候选（≤6 条，`kind: "keyword"`）；`@`、`#` 路径不变；`src/search-query.ts` 的 `getSearchSuggestionToken`、`getSearchSuggestionAliases` 为 `kind: "keyword"` 补分支（`matchesSearchSuggestionToken` 只走 `@` 路径，不接触 keyword） -- 证据：候选形状与上限见 3.1 的单测；`buildSearchSuggestions` 带 React 侧类型链、无法单独编译，门禁脚本 `scripts/verify-keyword-suggestions.mjs` 改用 Vite 按项目配置加载真实模块后断言（无索引不提示、「台」→ 平台、「会」→ 会议纪要、输入已是常用词不提示、`@收` → 收藏、`#` → 甲 丙 乙、`#甲` → 标签项、拼音开关）；`pnpm build:web` 通过
- [x] 3.3 选中候选后替换当前输入并发起搜索，复用 ↑/↓/Enter 处理；输入本身已是常用词时不出现候选，回车仍是粘贴 -- 证据：`src/App.tsx` `applySearchSuggestion` 的 keyword 分支 + 惰性索引；`pnpm build:web` 通过
- [ ] 3.4 沙箱走查（解锁状态）：输入「会」「方」「re」出现候选；中英文混输无闪烁、列表不跳动 -- 证据：未跑，屏幕锁定无法走查

## 4. 标签质量（Rust）

- [x] 4.1 `default_tags` 话题校验（长度、字符集、必须含字母或汉字、排除色值形态），附单测覆盖存量垃圾形态；来源标签「AI」（`lib.rs:1489-1497`）不在校验范围，保持不变 -- 证据：`hashtag_tag_rejects_numbers_colors_and_fragments`、`only_valid_hashtags_become_tags` 通过
- [x] 4.2 `builtinTagRules.link` / `markdown` 默认值改为关闭，前后端同改：Rust 缺省值（`lib.rs:5098`）、`src/settings/settings-model.ts:263`、`src/settings/sections/AgentUpdateTagSections.tsx:354`、`360` 的 `?? true` 改 `?? false`；显式设置优先；前端 `retagClips` 不再给无标签条目补类型标签 -- 证据：`builtin_tag_rules_default_to_topic_only` 断言读到 `(false, false, true)`；前端单测见 4.6
- [x] 4.3 新增 `clipboard/tag_cleanup.rs`：一次性移除垃圾标签与自动类型标签，写入 `metadata.tags_retired`，附单测 -- 证据：`retired_tags_keep_hand_made_tags`、`schema_upgrade_retires_tags_and_rebuilds_index` 通过
- [x] 4.4 迁移前用生产库副本预演 -- 证据：标签 181 → 8（`fff` ×2 的正文里是色值，一并移除；其余 8 条：聚合 2、token 2、fish、Github-token、AI、无用）；`tags_retired` 158 行 173 条 = 181 − 8
- [x] 4.5 `#` 下拉按出现次数排序，同数按字典序 -- 证据：`src/clipboard/clip-search.ts:168`；门禁脚本断言 `#` → `["甲","丙","乙"]`、已删除条目不计数（加载方式见 3.2）
- [x] 4.6 前端缺省值补测：未显式设置时，首次保存后的 `settings.json5` 里 `builtinTagRules` 不含显式 `true`（`settings-model.ts` 依赖运行时，现有纯函数门禁编译不了） -- 证据：部署后 `settings.json5` 无 `builtinTagRules` 键（缺省生效）；用正式版二进制在隔离数据目录采集含链接文本，行上 tags=[周报]（无「链接」）

## 5. 验证与收尾

- [x] 5.1 门禁：`pnpm build:web`、`pnpm test:unit`、`cd src-tauri && cargo check`、`cargo test --lib`、`openspec validate --all --strict` -- 证据：`✓ built in 4.28s`；`pnpm test:unit` 全部通过（文件行数、界面边界、MCP 分发 41 个工具、索引 98 个路径）；`Finished dev profile in 3.85s`；`84 passed; 0 failed`；`Totals: 43 passed, 0 failed (43 items)`
- [x] 5.2 `docs/BUSINESS_INDEX.md` 同步搜索行、标签行、剪贴板引擎行，`pnpm locate --check-index` 通过 -- 证据：`[check-index] docs/BUSINESS_INDEX.md 引用的 98 个路径全部存在`
- [x] 5.3 `pnpm tauri build` 并部署到 /Applications（需盟哥点头；首次启动会一次性重建全文索引并清理标签） -- 证据：盟哥回复「直接部署」；d00d3d4 构建 57s、签名校验通过；启动日志 `[schema-upgrade] schema upgraded 2 -> 3: retired tags rows=158, tags=173, reindexed=669`；正式库 user_version=3、fts rows=669=active；回滚备份 `/Users/embaobao/workspace/idea/clipforge/.work/ship/clipforge-before-deploy2-20261124-2222.sqlite`
- [ ] 5.4 盟哥验收后归档 -- 证据：
