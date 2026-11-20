# Design：OCR 域模块化拆分与测试矩阵

> 2026-11-06 盟哥要求「800 行以内、功能为主、详细模块拆分、高内聚低耦合、对照 Rust 开发最佳范式、建立完整测试、模块化开发管理」。
> **执行记录（2026-11-06）**：盟哥已放行 Phase 4，目录化重构与三层测试均已落地。当前实数 `src-tauri/src/ocr/` 五文件合计 **713 行**（`mod.rs` 61 / `endpoint.rs` 141 / `extract.rs` 116 / `cache.rs` 93 / `tests.rs` 302），≤800 预算；`cargo test --lib ocr` 19 passed。下文第 3-4 节的「待确认/待补」为设计时的状态，实际结果以 `tasks.md` Phase 4 勾选项为准（第 5 节下一批功能仍未做）。

## 1. 预算定义与当前实数

- **800 行 = OCR 域 Rust 代码合计上限**，不是单文件上限。单文件仍守 `AGENTS.md` 的 **500 行门禁**（`scripts/verify-file-size.mjs`），豁免清单只有 `src/App.tsx`/`src/settings.tsx`/`src-tauri/src/lib.rs` 且只减不增，**不放宽**。
- 当前实数：`src-tauri/src/ocr.rs` 470 行 + `src-tauri/src/ocr_cache.rs` ~215 行 = **约 685 行**，余约 115 行。
- 若「单文件放宽到 800」是盟哥本意，需先改 `AGENTS.md` 与豁免清单：优点是少拆文件；缺点是削弱门禁、与 `codebase-modularity-refactor` 冲突。**不建议**。

## 2. Rust 范式盘点（项目内先例）

| 范式 | 项目证据 | 本次取舍 |
|---|---|---|
| 域目录化 + `mod.rs` 门面 | `agent/`、`mcp/`、`settings_service/`、`clipboard/`、`plugin_runtime/` 五域全是目录；`lib.rs:27-38` 只写 `mod xxx;` | **采用**：OCR 目前是唯一「2 个平级散文件」的域 |
| 最小可见性 | `pub(crate)`（`agent/mod.rs:20-29`）、`pub(super)`（`settings_service/write.rs:461`）、门面 `pub use`（`clipboard/mod.rs:9-14`） | **采用**：helper 收为 `pub(super)`，仅 2 个 `#[tauri::command]` 保持 `pub` |
| `Result<_, String>` + 前缀错误码 | 全项目一致，前端按 `OCR_*` 前缀 toast | **不改**：改 enum/thiserror 要动 command 签名与前端契约，收益只在内部 |
| 测试内联 / `#[path]` 分离 | `clipboard/write.rs:323-325` 用 `#[cfg(test)] #[path="write_tests.rs"] mod tests;`；golden 冻结见 `mcp/mod.rs:286-341` | **采用**：测试集中 `ocr/tests.rs`，无需 `src-tauri/tests/` 集成目录 |
| 异步边界收敛 | 只有 command 与网络段是 `async` | **保持**：端点校验/请求体/解析/缓存全同步 |
| 不引入 trait/DI 抽象缓存 | 只有一个 `OnceLock<Mutex<HashMap>>` | **不采用**：trait+泛型会穿透到 command，多 30-50 行只换可测性，用测试锁即可 |

## 3. 目录化方案（Phase 4，待确认执行）

| 候选 | 行数 | 内聚/耦合 | 改动面 | 结论 |
|---|---|---|---|---|
| A 维持 2 文件只补测试 | ~750 | 3/5 · 4/5 | 不动 | **不可行**：`ocr.rs` 仅余 30 行，取消语义 + 测试必破 500 门禁；且已混 5 类职责，触发 `AGENTS.md:76` |
| **B 目录化 `src-tauri/src/ocr/`** | **~760** | **5/5 · 4/5** | `lib.rs:35-36` 两行合并为 `mod ocr;`（净减 1 行）、删 `ocr_cache.rs`、改索引 | **推荐** |
| C 单文件门面 + 1 兄弟模块 | ~645 | 4/5 · 4/5 | `lib.rs` 反向增长 | 未归位，仍 3 个散文件 |

**B 的模块划分（800 行预算内）**

| 文件 | 预算 | 职责（高内聚判据） |
|---|---|---|
| `ocr/mod.rs` | 110 | 文件头中文注释、`mod`/`pub use` 门面、常量与 plain-OCR prompt、2 个 payload、2 个 command 薄壳 |
| `ocr/endpoint.rs` | 130 | `validate_local_endpoint`、`ocr_settings`、`/v1/models` 两形状解析、`OcrEndpointCandidate`、`ocr_detect_endpoints` |
| `ocr/extract.rs` | 115 | 请求体构造、响应解析结构、`ocr_extract_inner` 控制流（准入 → 缓存 → 读图 → POST → 写缓存）、取消语义 |
| `ocr/cache.rs` | 175 | 结果缓存 + `load_image_identity` / `read_image_bytes` + 纯函数单测 |
| `ocr/tests.rs` | 230 | 现有 11 个单测 + 新增隔离目录/stub HTTP 用例 + golden 冻结 |
| **合计** | **~760** | 余 40 行缓冲 |

**低耦合保证**：`ocr::ocr_extract` / `ocr_detect_endpoints` 路径与前端 `invoke("ocr_extract")` 零改动；跨域只经 `crate::`（`open_clip_db`、`settings_service`、`clipboard::payload`）；子模块间只经 `super::`；不改 command 名、错误码字符串、TS 类型。

**「不为拆分而拆分」的边界**：① 不为单一调用方的 helper 单独立文件；② 不引 trait/DI/依赖只为可测；③ 不把 <500 行的 `cache.rs` 再切碎；④ 不新建提案（并入本提案）；⑤ 不改 spec delta（纯重构无新 Requirement）。

**超预算先砍**：`ocr_extract_live_end_to_end`（70 行 `#[ignore]`）改用 `.work/phase10-e2e.mjs` 探针；取消语义若需新依赖则降级保留 60s 超时；golden 只冻错误码前缀，不冻全量响应快照。

## 4. 完整测试矩阵

| 层 | 用例 | 前置 | CI |
|---|---|---|---|
| 纯函数（已落地） | 请求体形状、models 两形状、端点准入放行/拒绝、schema 接受/拒绝、cache key 隔离、命中/未命中、`elapsed_ms=0` | 无 | 是 |
| 纯函数（本轮新增） | 8MB 拒绝且不发请求、64 条上限整体清空、8 线程并发读写、锁毒化自恢复 | 进程级 `OCR_CACHE_TEST_LOCK` | 是 |
| 隔离数据目录（待补） | `OCR_IMAGE_TOO_LARGE` 早于 POST、`OCR_ENDPOINT_NOT_LOCAL` 早于 DB、端点不可达 `OCR_ENDPOINT_UNAVAILABLE`、缓存命中跳过读图（image_file 指向已删文件仍返回） | `TEST_DATA_DIR_LOCK` + `CLIPFORGE_DATA_DIR` | 是 |
| mock HTTP（待补） | `std::net::TcpListener::bind("127.0.0.1:0")` 起本地 stub，测 200 解析 / 4xx / 空 content / 非法 JSON / 不跟随重定向 | 同上 + 临时端口 | 是 |
| golden 冻结（待补） | 请求体键形状、`OCR_*` 码表、`/v1/models` 两形状 | 无 | 是 |
| ignored 实机 | `ocr_extract_live_end_to_end` 需 llama-server:8491 | 外部服务 | 否 |
| 前端静态断言（待补） | `scripts/verify-ocr-surface.mjs`：右键/详情入口、设置卡 `data-dev-probe`、i18n 四键、无硬编码中文 | 无 | 是 |
| 交互 / 人眼 | `tauri-web-mock.ts` 补 `ocr_extract` case → `pnpm test:interaction`；真实端点 + 真剪贴板图片 | dev server / 解锁机器 | 半 / 否 |

**零新增依赖**：`Cargo.toml` 无 `[dev-dependencies]`、无 wiremock/mockito；`tokio` 仅 `["rt"]`、`futures` 全量。用 `TcpListener` 手工回 HTTP 响应即可，且回环地址恰被 `validate_local_endpoint` 放行。

## 5. 剩余功能实现顺序

| 批次 | 项 | 方案 | 风险 |
|---|---|---|---|
| 本轮已做 | `content_hash` 缓存、`metadata.sourceImageId` 顶层字段 | 见 `tasks.md` Phase 0.3/0.4 | 低 |
| 下一批 A | 详情页文本块 + 一键复制（~60-100 行 TSX）、前端行内端点提示 + `OCR_*` 本地化文案（i18n 两语言 + `check:i18n`） | 不动 Rust | 中 |
| 下一批 B | 取消语义：`requestId` + `ocr_cancel` command + `futures::future::Abortable`（Tauri `invoke` abort 不会中断 Rust future）；`tokio` 无 `macros/time/sync`，不能靠 `select!` | reqwest future 被 drop 即断连 | 中高 |
| 下一批 C | 隔离目录 / stub HTTP / golden 测试（上表待补项） | 需目录化后落点 | 低 |
| 关闭 | **1.1 provider 检测扩展**：`ocr_detect_endpoints` 已并发扫 4 个本地端口并解析 `models[].name` + `capabilities`；`agent/provider.rs:249` 的 `agent_detect_candidates` 返回 CLI/聊天补全结构且默认 `https://api.openai.com`，与 OCR 隐私红线冲突。扩展属重复实现，标「已覆盖」 | — | — |
| 交付前 | 3.2 端到端（沙箱真实图片 → 提取 → 复制 → 存为文本条目）、`pnpm build`（需盟哥点头，会重签发布产物）、`cargo test --lib ocr -- --ignored` | 需 llama-server + 解锁机器 | 高 |

## 6. 模块化开发管理

- **并入本提案，不新建 change**：纯重构无新 Requirement，`specs/image-ocr/spec.md` 不改；新建提案会污染 ROADMAP「25 个 active」实数。
- 执行 Phase 4 时的登记清单：① `tasks.md` 新增「Phase 4：OCR 域目录化」并改写 3.1/3.3 的文件落点；② `docs/BUSINESS_INDEX.md:25` 两文件路径改为 `src-tauri/src/ocr/`（目录存在即通过 `locate.mjs --check-index`），说明列注明 `mod.rs` 为入口；③ 每个新文件头写中文文档注释（同时是 `pnpm locate` 数据源）；④ `docs/PROPOSAL_ROADMAP.md:170` 与 `openspec/project.md` 的 N/M 同步实数，未完成的 GUI / Tauri dev 项不代勾；⑤ `codebase-modularity-refactor` 只加交叉引用、不新增独立任务数。
- 门禁：`pnpm test:unit`（含 `verify-file-size.mjs` 与 `locate.mjs --check-index`）、`cargo check`、`cargo test --lib ocr`、`pnpm build:web`、`openspec validate --strict`；`pnpm check:i18n` 仅在改 i18n 时必跑。
- 索引防腐：删 `ocr.rs` / `ocr_cache.rs` 后若不同步 `BUSINESS_INDEX.md`，`check-index` 必红。

## 7. Phase 5：TDD 实施方案（2026-11-06 多 Agent review 后构建，待盟哥确认执行）

### 7.1 落点与 spec 形态

- **并入本提案 Phase 5，不新建 change**：现有提案上下文完整；新建会使 ROADMAP「25 个 active」实数与 `openspec list` 对账断链，还会复制一份重复 Requirement、让跨 change 相对链接在归档时断。
- **纯 `ADDED` + 在现有两个 Requirement 下补 4 个 Scenario**，不用 `MODIFIED`：实测 `openspec/specs/` **没有 image-ocr 基线**（只有 13 个其他域），`MODIFIED/REMOVED` 在归档合并阶段有静默丢失风险；整块重写还会重复 Requirement。补 Scenario 既不改 delta 结构、又能让新行为有验收依据（`openspec validate --strict` 已通过）。
- 新增 Scenario：详情页文本块与一键复制、错误码本地化与端点准入提示、取消进行中的提取、同图缓存命中复用。

### 7.2 待确认的测试接缝（seams）

> TDD skill 硬约束：**确认前不写任何测试**。下表是候选，需盟哥圈定后才进入红→绿。

| # | 公共接口 | 捕获什么回归 | 漏掉什么 | 建议 |
|---|---|---|---|---|
| S1 | `extract_with_endpoint(id, endpoint)`（`ocr/extract.rs:56`） | 准入→缓存→读图→POST→写缓存顺序、stub 全链路、取消后不写缓存 | `ocr_settings()` / `OCR_DISABLED` | **主起点**：显式端点注入、零依赖、已有 3 个样板用例 |
| S2 | `ocr::ocr_extract` / `ocr_cancel`（command 层） | 设置开关与取消返回码全链 | 需 `CLIPFORGE_DATA_DIR` + settings 全局态，隔离重 | 次起点，只在 S1 覆盖不到时补 |
| S3 | `invoke("ocr_extract")` → DOM（`use-ocr-extract.ts:29`、`data-dev-probe`） | 文本块展示、再复制、错误码文案 | 真剪贴板 / 真端点 | **前端唯一合法接缝**，用 `pnpm test:interaction` |
| S4 | 静态门禁（`scripts/verify-ocr-surface.mjs`、`check:i18n`） | 硬编码中文、双字典键齐、500 行、错误码表完整 | 运行时映射结果 | 补强，不作唯一证据 |

**明确不测**（实现耦合）：`lock_cache` / `OCR_RESULT_CACHE` 内部、`OcrChatResponse` 私有结构、DB 直查、`spawn_stub` 内部字节、`requestId→AbortHandle` HashMap 内容（只能经 `ocr_cancel` 返回值与二次提取观察）。

### 7.3 红→绿垂直切片顺序（一个测试 → 一个最小实现 → 重复）

1. **切片 1（Rust，S1）**：`cancel_before_response_leaves_no_cache` RED → 加 `ocr/cancel.rs`（in-flight 表，仿 cache.rs 的 `OnceLock<Mutex<HashMap>>`）+ `futures::Abortable` 包裹网络等待 + `OCR_CANCELLED` 映射 → GREEN。用 gated stub（`mpsc::Receiver::recv_timeout` 阻塞响应，`tx.send` 做同步点），不依赖真实 2-9s 推理、不用 `sleep`。
2. **切片 2（Rust，S1）**：`cancel_unknown_id_is_noop` RED → `ocr_cancel` 返回 `false` → GREEN（预算不足时可砍）。
3. **切片 3（前端，S3）**：`tauri-web-mock.ts` 补 `ocr_extract` case（现落 `default` 返回 `null`，一触发即 TypeError）→ 交互 T22：详情页点「提取文字」断言 `[data-dev-probe="ocr-text-block"]` 文本 → 再点复制断言 toast → 新建 `src/workspace/components/detail/ocr-text-block.tsx` 挂到有余量的 `detail-action-bar.tsx`(139) / `detail-plugin-zone.tsx`(81)，**不动 `ClipDetailWorkspace.tsx`(499) / `DetailPreview.tsx`(490) / `use-clip-writeback.ts`(499)**。
4. **切片 4（前端，S3）**：T23 注入 `OCR_ENDPOINT_UNAVAILABLE` 断言本地化 toast → `use-ocr-extract.ts:39` 的 `String(error)` 改走已有 `formatCommandError`（`i18n/index.ts:47-58`）+ `OcrEndpointCard` 行内 hint 经 `tr()` → 双字典补 `main.error.command.OCR_*` 键。
5. 每片结束跑 `cargo test --lib ocr` / 对应前端门禁，红了才写实现，禁止一次写完全部测试（水平切片）。

### 7.4 预算与取消深度（两个方案的取舍）

| 方案 | 行数 | 优点 | 缺点 |
|---|---|---|---|
| **完整 `Abortable` + `ocr_cancel` + in-flight** | `cancel.rs` 28 + `extract.rs` 18 + `mod.rs` 5 + `lib.rs` 1 + `tests.rs` 40 ≈ 92；抵扣 7.5 节反模式清理释放 ~30 → **净 ~62，落 776/800** | 兑现 spec「可取消」，公共观察点清晰（`OCR_CANCELLED`、二次提取重新 POST、cancel 返回 bool） | 触碰全局态，需 `OCR_CANCEL_TEST_LOCK` + `clear_cancel_registry_for_tests()` 与 `data_dir_lock()`/`cache_guard()` 三层隔离；`Abortable` 只在 `.await` 挂起点生效，同步读图/base64 段不可取消（spec 已写明边界） |
| 降级：保留 60s 超时 + 前端丢弃结果 | ~10 | 零新依赖、稳过门禁 | spec「可取消」软兑现，等于没修 |

**本提案推荐完整方案**（功能为主、spec 已写「可取消」），但 800 预算是硬约束：先删并 7.5 的反模式用例腾出行数，仍超则按序砍 `cancel_unknown_id_is_noop` → golden 只冻 `OCR_CANCELLED` 前缀 → 不复活 `live_end_to_end`。`Cargo.toml` 不新增依赖（`futures` 全量已够 `AbortHandle::new_pair()`；tokio 仅 `rt` 不能用 `select!`）。

### 7.5 反模式清理（review 发现，红→绿前先做，属 review 阶段不是 loop 内）

现有 19 个用例里 5 个应删/并：`golden_tests::error_codes_are_prefixed`（只取 2 个码、与 i18n 键契约脱节，迁到静态门禁）、`cache_poison_recovers`（白盒毒化私有 `lock_cache` 且 store→get 恒真）、`builds_plain_ocr_request_body` 与 `request_body_shape_is_frozen`（重复、都测私有输出，合并成 1 个「stub 收到的请求体」golden）、`cache_concurrent_rw_no_panic`（只验不 panic，恒真）、`cached_payload_is_returned_with_zero_elapsed`（已被更强的 `cache_hit_skips_image_read` 覆盖）。**保留** `stub_success_parses_model_text` / `stub_4xx_returns_endpoint_error` / `cache_hit_skips_image_read`（经 S1 观测行为，是红→绿样板）。

### 7.6 门禁、索引与已知风险

- 新增 i18n 键 → `scripts/check-i18n-keys.mjs:16-29`（双字典对齐）、`scan-hardcoded-copy.mjs`；**两个 locale 文件工作区当前就是 `M`（盟哥既有未提交改动），只追加 key、不改既有行，冲突按 hunk 隔离**。
- 新增 `ocr_cancel` command → `lib.rs:7868` 注册行 + `docs/BUSINESS_INDEX.md:25` 索引（`AGENTS.md:101`）；不需要 capabilities ACL（v2 app-defined command 默认放行）、不触发 `AGENTS.md:38` MCP/L3 同源计数。
- `use-clip-writeback.ts` **499/500**、`ClipDetailWorkspace.tsx` 499、`DetailPreview.tsx` 490：加代码即破门禁，落点必须是新子组件或有余量的 action-bar。
- stub `accept()` / `handle.join()` 无超时，被测链路不发请求会挂起；gated stub 应给 `recv_timeout(≤1s)` 兜底。
- 3 个缓存用例（`cache_miss...` / `cached_payload...` / `cache_hit...`）未持 `OCR_CACHE_TEST_LOCK`，新增并行用例会放大清空窗口 → 清理时统一补锁。

### 7.7 不做（防范围蔓延）

不动剪贴板采集 hash 口径（`BUSINESS_INDEX.md:61` 已写「本期不做」）、不动 `lib.rs` 除注册行、不新增内存探针 / Cargo 依赖、不做 `lib.rs` 模块化切片、不复活 1.1 provider 扩展（已判重复关闭）、不代勾 3.2 实机验收、不跑 `pnpm build`（会重签发布产物，需单独点头）。

### 7.8 完整迁移后「无问题」判据

`cargo check` 0 warning · `cargo test --lib`（含 OCR 21-22 passed）连跑 2 次 0 flaky · `pnpm test:unit`（file-size / check-index 80 路径 / 新增 `verify-ocr-surface.mjs`）· `pnpm check:i18n` 双字典对齐 · `pnpm test:interaction` T1–T23 全 PASS（需 dev server :7100）· `pnpm build:web` · `openspec validate --strict` · `wc -l src-tauri/src/ocr/*.rs` ≤800 且单文件 ≤500。**未验项必须显式列出**：llama-server 未启动的 3.2 实机（真 2-9s 推理、真取消时机）、真剪贴板回采、三档宽度视觉走查、锁屏/权限弹窗、`pnpm build` 重签。每层要有红→绿记录，不把 mock / `[ignore]` 通过当实机通过。
