# Tasks:ocr-image-text-extraction

## Phase 0:设置键与本地端点红线修复（2026-11-05，已完成）

- [x] 0.1 设置 schema 补 `ocrEnabled` / `ocrEndpointUrl`：`settings_service/mod.rs` 的 `settings_json_schema()` 原为 `additionalProperties:false` 且不认这两个键，导致 `settings_service_patch` 报 `SETTINGS_SCHEMA_VALIDATION_FAILED`、设置页 OCR 开关/端点改不了。--2026-11-05:加 2 属性;单测 `schema_accepts_ocr_setting_keys` / `schema_rejects_bad_ocr_values` 通过;TS 类型、field-catalog、i18n 无需同步(已就绪)
- [x] 0.2 仅本地端点准入 + 禁止重定向：`ocr.rs` 增 `validate_local_endpoint()`（用 `reqwest::Url` 解析 authority，只放行 http + 127.0.0.1/localhost/::1），`ocr_extract_inner` 在 `load_clip_image_bytes` 之前校验，请求 URL 基于同一 `Url` 拼接；`reqwest::Client` 加 `.redirect(Policy::none())`，防本地端点 307/308 把 base64 图片转发到云端。--2026-11-05:单测 loopback 放行 5 例 / 云端与伪装拒绝 9 例全过;`cargo test --lib ocr` 7 passed / 1 ignored(live 端到端)
- 边界备注：局域网自托管、`0.0.0.0`、自定义 DNS 指向本机、`https://localhost` 均被拒（静态无法确认归属），需改填回环地址；前端 `OcrEndpointCard` 仍允许自由填 URL，错误以 `OCR_ENDPOINT_NOT_LOCAL` 原文 toast 透出，行内提示与本地化错误码待补。
- [x] 0.3 `content_hash` 结果缓存：新增 `src-tauri/src/ocr_cache.rs`（135 行，中文文档注释），把图片定位/8MB 校验从 `ocr.rs` 下沉过去（`ocr.rs` 492 → 470 行，避开 500 行门禁）；缓存键 = 端点 + content_hash，进程内 `OnceLock<Mutex<HashMap>>` 上限 64 条超限整体清空、Mutex 毒化自恢复、不落盘；命中不读图/不 base64/不 POST，`elapsed_ms` 置 0。--2026-11-05:`cargo test --lib ocr` 10 passed / 1 ignored(live);新增 3 个缓存单测全过;`docs/BUSINESS_INDEX.md:25` 同步索引、`check-index` 80→81 路径全通过
- 0.3 已知残余风险：同端点换 gguf 模型时缓存仍命中旧文本（模型 id 只在响应里、请求体不带 model）；并发同键双 miss 会各 POST 一次（未做 in-flight 去重）；进程重启即失效。均记录在 `ocr_cache.rs` 文件头，必要时另立「清缓存」入口。
- [x] 0.4 `metadata.sourceImageId` 对齐 spec：`use-ocr-extract.ts` 传 `sourceImageId`（原 `ocrSourceImageId`），`use-clip-writeback.ts` 把它提升到 metadata 顶层，其余诊断字段仍留 `clipforgeContext`。--2026-11-05:两处 TS 各改 1 处,`pnpm build:web` tsc 通过
- [x] 0.5 完整测试（纯函数层）：`ocr_cache.rs` 补 8MB 拒绝不发请求、64 条上限整体清空、8 线程并发读写、Mutex 毒化自恢复 4 例；进程级 `OCR_CACHE_TEST_LOCK` 串行防 OnceLock 并行污染。--2026-11-05:`cargo test --lib ocr` 14 passed / 1 ignored

## Phase 1:端点发现与提取 command

- [ ] 1.1 provider 检测扩展：本地视觉端点探测（llama-server/Ollama/LM Studio，`/v1/models` + 视觉能力标记），复用现有 agent_detect_candidates 体系，结果进设置页模型分组
- [x] 1.2 `ocr_extract` Tauri command（2026-10-27:src-tauri/src/ocr.rs 域模块,8MB 上限/60s 超时/OCR_* 错误码/plain-OCR 契约;live 测试 ocr_extract_live_end_to_end 走真实 llama-server+OvisOCR3 全链路 2.76s 提取全对,常规门禁 #[ignore] 隔离）：图片条目 id → `image_file` 读取（8MB 上限）→ base64 → POST 视觉端点（官方 plain-OCR prompt、temperature=0）→ 纯文本返回；60s 超时、取消、`OCR_*` 错误码（含中文注释与 BUSINESS_INDEX 登记）
- [ ] 1.3 设置页「图片文字识别」分区：启用开关（默认开）+ 端点选择（自动发现 + 手动 URL），仅本地端点可选中 --2026-11-05 对账:`OcrEndpointCard.tsx` + `ocrEnabled` switch 已落地,设置写入由 Phase 0.1 修通,后端由 Phase 0.2 拒非本地端点;仍缺「仅本地端点可选中」的前端行内约束与提示,故不勾

## Phase 2:前端入口与结果落库

- [ ] 2.1 图片条目右键菜单 + 详情页「提取文字」动作：loading 态防重复、失败 toast 带 `OCR_*` 错误码提示
- [ ] 2.2 结果展示与复制：详情页文本块 + 一键复制（走现有 writeClipboard）——复制+toast 已落地(右键/详情同一动作链),详情页内嵌文本块展示待下一切片
- [ ] 2.3 「保存为文本条目」：新建 text clip，metadata 记 `sourceImageId`，入 FTS 索引——已落地 text clip 入库(source=ocr,入 FTS,走 capture_clip_record);metadata.sourceImageId 待补(capture_clip_record 不收 context,需换 capture 路径)

## Phase 3:验收与门禁

- [ ] 3.1 单测：8MB 上限拒绝、端点不可达错误码、取消语义、保存文本条目 metadata/FTS 断言
- [ ] 3.2 端到端：沙箱实例真实图片条目 → 提取 → 复制 → 保存为文本条目（复用 .work/phase10-e2e.mjs 的 MCP/剪贴板探针模式）
- [ ] 3.3 门禁：pnpm build + cargo check + pnpm test:unit 全绿；BUSINESS_INDEX 登记 ocr 域 --2026-11-05 对账:`BUSINESS_INDEX.md:25` 已登记 `ocr.rs`/`ocr_cache.rs`,`check-index` 路径全通过;cargo check / test:unit 已全绿,仅 `pnpm build` 待盟哥点头(会重签发布产物)

## Phase 4：OCR 域目录化拆分（设计已完成，待盟哥确认后执行）

> 完整设计见 [design.md](./design.md)：800 行预算、Rust 范式盘点、模块划分、测试矩阵、剩余功能顺序、索引与 N/M 同步清单。纯重构，无新 Requirement，不改 spec delta。

- [x] 4.1 目录化完成：`src-tauri/src/ocr/` 五文件 `mod.rs`(61) / `endpoint.rs`(141) / `extract.rs`(116) / `cache.rs`(93) / `tests.rs`(302)，**合计 713 行 ≤800 预算**；删 `ocr.rs`/`ocr_cache.rs`，`lib.rs` 两行合并为 `mod ocr;`（净减 1 行）
- [x] 4.2 `ocr::ocr_extract` / `ocr_detect_endpoints` 路径与前端 `invoke("ocr_extract")` 契约不变；子模块 helper 一律 `pub(super)`；5 个文件头均有中文文档注释（`pnpm locate` 数据源）
- [x] 4.3 `docs/BUSINESS_INDEX.md:25` 改为 `src-tauri/src/ocr/` 目录路径；`check-index` 81 路径全通过；`cargo check` 0 warning
- [x] 4.4 三层测试补齐：隔离数据目录（缓存命中不读图、非图片条目）、本地 `TcpListener` stub（200 解析 / 400 错误码，零新增依赖）、golden（请求体形状 / `OCR_*` 前缀）；`cargo test --lib ocr` **19 passed / 0 failed**，过滤串不变
- [ ] 4.5 按 design 第 5 节推进下一批功能：详情页文本块、行内提示与本地化错误码、取消语义（`futures::Abortable` + `ocr_cancel`）；**1.1 provider 扩展判定为重复实现，关闭**
- [x] 4.6 `docs/PROPOSAL_ROADMAP.md:170` 同步实数；`codebase-modularity-refactor` 不新增独立任务数（本域是 OCR 提案内部重构）
- 执行备注：原 `ocr_extract_live_end_to_end`（70 行 `#[ignore]`、依赖本机绝对路径的模型样张）在目录化时移除，HTTP 全链路由 stub 测试覆盖；实机端到端改由 3.2 / `.work/phase10-e2e.mjs` 探针承接。为让 stub 不碰全局设置，`extract` 域拆出带显式端点的 `extract_with_endpoint(id, endpoint)`，是本次唯一结构性改动。

## Phase 5：TDD 完成剩余功能（提案已构建，**待盟哥确认 seams 后执行**）

> 完整设计见 [design.md](./design.md) 第 7 节：落点决策、seams 清单、红→绿垂直切片、800 行预算、反模式清理、门禁索引、不做清单、验证闭环。spec 已在现有两个 Requirement 下补 4 个 Scenario（纯 ADDED，不用 MODIFIED）。

- [ ] 5.1 **确认 seams**：圈定 S1 `extract_with_endpoint` / S2 command 层 / S3 `invoke→DOM` / S4 静态门禁中哪些进入红→绿；确认前不写任何测试（TDD skill 硬约束）
- [ ] 5.2 review 阶段清理反模式：删/并 5 个弱用例（`error_codes_are_prefixed` 迁静态门禁、`cache_poison_recovers`、重复的请求体两个、`cache_concurrent_rw_no_panic`、`cached_payload...`），3 个缓存用例补 `OCR_CACHE_TEST_LOCK`，stub 加 `recv_timeout` 兜底；预计释放 ~30 行
- [ ] 5.3 切片 1（S1）：`cancel_before_response_leaves_no_cache` RED → 新增 `ocr/cancel.rs` + `futures::Abortable` + `OCR_CANCELLED` + `ocr_cancel(requestId)` GREEN；gated stub 用 `mpsc` 同步点，不依赖真推理；公共观察点 = 返回码 / 二次提取重新 POST / cancel 返回 bool
- [ ] 5.4 切片 2（S1，预算不足可砍）：`cancel_unknown_id_is_noop` RED → GREEN
- [ ] 5.5 切片 3（S3）：`tauri-web-mock.ts` 补 `ocr_extract` case → 交互 T22（详情页文本块 + 再复制）RED → 新建 `src/workspace/components/detail/ocr-text-block.tsx` 并挂到有余量的 action-bar/plugin-zone GREEN；**不动** 499 行的 `use-clip-writeback.ts` / `ClipDetailWorkspace.tsx` / `DetailPreview.tsx`
- [ ] 5.6 切片 4（S3）：交互 T23（本地化 toast + 行内端点提示）RED → `String(error)` 改走 `formatCommandError`、双字典补 `main.error.command.OCR_*`、`OcrEndpointCard` hint 经 `tr()` GREEN；只追加 i18n key，与工作区既有 locale 改动按 hunk 隔离
- [ ] 5.7 门禁与索引：新增 `scripts/verify-ocr-surface.mjs` 挂 `test:unit`；`lib.rs` 注册 `ocr_cancel`；`docs/BUSINESS_INDEX.md:25` 同步；`pnpm check:i18n` / `pnpm locate --check-index` 复跑
- [ ] 5.8 完整迁移后验证：按 design 7.8 逐条跑（`cargo check` 0 warning、`cargo test --lib` 连跑 2 次、`pnpm test:unit`、`pnpm check:i18n`、`pnpm test:interaction` T1–T23、`pnpm build:web`、`openspec validate --strict`、`wc -l` ≤800）；未验项显式列出，不代勾 3.2 实机

> 本批边界：不动剪贴板采集 hash 口径、不动 `lib.rs` 除注册行、不新增内存探针/Cargo 依赖、不做 `lib.rs` 模块化、不复活 1.1 provider 扩展、不跑 `pnpm build`（重签发布产物，需单独点头）。

## Phase 6：macOS 内置 Vision OCR（2026-11-20，用户决策更新）

- [x] 6.1 `src-tauri/src/ocr/builtin.rs` + `builtin/macos.rs`：系统 Vision 动态 FFI（`VNRecognizeTextRequest` / `VNImageRequestHandler`），关闭语言纠正，单图 8MB 上限沿用；同步调用放 `spawn_blocking`，错误码 `OCR_BUILTIN_UNAVAILABLE` / `OCR_BUILTIN_FAILED` / `OCR_BUILTIN_NO_TEXT` 全部入白名单
- [x] 6.2 `extract::ocr_extract_inner` 优先内置引擎，失败回落本地端点；缓存键按引擎隔离（`apple-vision-v1`），前端契约 `invoke("ocr_extract")` 不变；新增 `ocr_builtin_available` command 并在 `lib.rs` 注册
- [x] 6.3 设置页 `OcrEndpointCard` 在 macOS 只显示「系统内置 OCR 已启用」，不再要求用户配置端点；其他平台保留端点发现/手填；中英文案与错误修复指引同步
- [x] 6.4 回归：`cargo test --lib ocr` 20 passed（新增固定样张 Vision 识别断言），`pnpm test:unit` 14 码一致性 + 脱敏 + i18n 全绿，`pnpm build:web` / `cargo check --lib` 全绿
- [x] 6.5 实机验证：重建并用 `ClipForge Dev` 自签部署 `/Applications/ClipForge.app`（pid 79427）；`cargo test --lib ocr` 中 `builtin_vision_recognizes_sample_text` 对 `src-tauri/src/ocr/fixtures/ocr-sample.png` 调真实 Apple Vision 返回 `ClipForge`/`2026`；浏览器面板 harness 实测 Tab 在历史 9↔收藏 2 间切换、Shift+Tab 反向，且顶栏选中态随之变化。完整 `pnpm build` 与 `pnpm tauri build --bundles app` 通过；GUI 右键 OCR 因 WKWebView 无 accessible row 未做自动点击，留人工验收。
- [x] 6.6 修复用户反馈的 `错误码：UNKNOWN`：根因是 `use-ocr-extract.ts` 把 OCR 调用、`navigator.clipboard.writeText`、入库放在同一 try，复制/入库异常被误报为 OCR 失败。拆分为 OCR 调用独立捕获；入库后优先用原生 `write_clipboard_item` 写剪贴板，失败才回落浏览器 API；新增 `main.toast.ocrCopyFailed` 等中英文案避免误分类。`parseOcrErrorCode` 兼容包装错误但仍只返回白名单码；新增 `ocr_extract_inner_prefers_builtin_engine` 回归验证完整 Rust 路径。`pnpm test:unit`、`pnpm build:web`、`cargo test --lib ocr`（21 passed）通过，重建并自签部署 `/Applications/ClipForge.app`（pid 29250）待用户复测。
