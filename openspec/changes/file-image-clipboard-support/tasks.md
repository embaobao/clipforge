# 任务：文件与图片剪贴板支持

## Phase 1：基础依赖与数据模型

- [x] 在 `src-tauri/Cargo.toml` 添加 `clipboard-rs` 与 `blake3` 依赖
- [x] 创建 `src-tauri/src/clipboard/mod.rs` 模块入口
- [x] 定义 `ClipboardRepresentation`、`ClipboardCapture`、`TextPayload`、`ImagePayload`、`FilesPayload`（`clipboard/payload.rs`）
- [x] 扩展 `ClipItemPayload` JSON 结构：新增 `contentHash`、`primaryFormat`、`availableFormats`、`plainText`、`searchText`、`subKind`、`width`、`height`、`size`、`fileTypes`、`thumbnailPath`、`imageFile`
- [x] 按“不做兼容处理”改为 schema v2 删库重建：`clips` 表包含 `content_hash`、`primary_format`、`representations_json`、`plain_text`、`search_text`、`sub_kind`、`width`、`height`、`size`、`file_types`、`image_file`、`is_sensitive` 等列
- [ ] 编写迁移脚本回填存量 `content_hash`（当前方向已取消兼容迁移，后续归档提案时删除或改写此项）
- [x] 更新 `init_schema` 中新建表的 DDL，包含上述新列
- [x] 更新 FTS5 同步字段，优先同步 `search_text/plain_text` 字段

## Phase 2：剪贴板读取

- [x] 实现 `clipboard::read`，封装 `clipboard_rs::ClipboardContext`
- [x] 支持读取 text / html / rtf / image / files 五类格式，并在同一次读取中尽量保留所有可用 representation
- [x] 图片读取优先直取 PNG 原始字节（macOS `public.png` / Windows `PNG`），零解码解析尺寸
- [x] 非 PNG 图片回退到 `ClipboardContext::get_image()` 解码并重编码为 PNG
- [ ] 定义 `CaptureSettings`，支持文本、HTML、RTF、图片、文件启用开关和大小限制
- [x] 实现 `primaryFormat` 选择规则：文件优先于图片，图片优先于富文本，富文本优先于纯文本；但不丢弃其它 representation
- [x] 添加 `png_dimensions` 辅助函数与单元测试

## Phase 3：图片与文件存储

- [x] 实现 `clipboard::storage::ImageStore`
- [x] 确定图片根目录：`<app_data>/resources/clipboard-images/`
- [x] 按 `blake3(<png_bytes>)` 生成文件名，前 2 位 hex 作为分片目录
- [x] 实现 `store()` 落盘原图、`origin_path()` 解析原图路径
- [x] 实现 `ensure_thumbnail()` 延迟生成缩略图（最长边 300px）
- [x] 实现 `remove()` 删除原图、缩略图并清理空分片目录
- [ ] 为 `ImageStore` 编写单元测试（幂等、缩略图、删除）
- [ ] 实现文件存在性后台批量检查与缓存，列表渲染不得逐行同步访问磁盘

## Phase 4：采集与入库

- [x] 实现 `clipboard::ingest::build_item()`，将 `ClipboardCapture` 转为 `ClipItem`
- [x] 文本入库：`content/plain_text/search_text` 存纯文本，`representations_json` 包含 text/plain
- [x] HTML / RTF 入库：保存 html/rtf representation，同时保留 text/plain fallback
- [x] 图片入库：调用 `ImageStore::store()`，`content` 存文件名，`representations_json` 包含 image/png 文件 representation
- [x] 文件入库：`content` 存换行路径，`representations_json` 包含 application/file-list，`search_text` 存文件名
- [x] 实现多 representation 去重规则：`primary_format + preferred representation hash`
- [ ] 实现纯文本子类型识别 `clipboard::detect`（url / email / color / path）
- [ ] 实现大小限制过滤（文本、图片可配置上限）
- [ ] 实现敏感内容检测与开关（API Key 等）
- [x] 更新后台采集路径复用 `build_item` 路径

## Phase 5：写回与粘贴

- [x] 实现 `clipboard::write::write_to_clipboard()`
- [x] 定义 `PasteMode = Rich | Plain | FilesAsPaths`
- [x] 文本写回：Rich/Plain 都写 text/plain
- [x] HTML / RTF 写回：Rich 写 html/rtf + plain，Plain 只写 plain
- [x] 图片写回：从 `ImageStore` 读取原图并 `ctx.set_image()`
- [x] 文件写回：Rich 写 `ctx.set_files()`，Plain/FilesAsPaths 写路径文本
- [x] 图片 Plain 动作第一阶段不可用，前端禁用并显示原因
- [x] 实现 `clipboard::guard::WritebackGuard`，抑制写回回环
- [x] 升级前端写入入口为 `write_clipboard_item`
- [x] 升级前端粘贴入口为 `paste_clipboard_item`
- [x] 写回日志包含 `clipId`、`primaryFormat`、`availableFormats`、`pasteMode`、`writtenFormats`、`guardHash`

## Phase 6：监听升级

- [ ] 实现 `clipboard::watcher::init()`，使用 `ClipboardWatcherContext`
- [ ] 替换当前 `poll_clipboard_change` 轮询方案
- [ ] macOS 配置 120ms 轮询间隔；Windows 事件驱动
- [x] 监听线程内读取 payload 并投递入库
- [ ] 支持暂停/恢复监听
- [ ] 保持写回抑制与监听路径的去重逻辑一致

## Phase 7：前端适配

- [x] 扩展 `src/services/contracts.ts` 中的 `ClipItem` 类型
- [ ] 新增 `src/services/clipboard.ts`：封装 `readClipboard` / `writeClipboard` / `pasteClipboard` / `getImagePath`，参数使用 `PasteMode`
- [ ] 快速面板保持高密度虚拟列表行高，不引入 48px 图片卡片
- [ ] 图片行：使用 `convertFileSrc(thumbnailPath)` 显示 24-28px 缩略图或图标
- [ ] 文件行：显示文件图标、文件名/数量，长路径进入详情页展示
- [ ] 文件已删除时显示弱化样式
- [x] 详情页支持图片原图预览、文件列表和“可用格式”展示
- [x] 右键菜单根据类型动态显示：复制原格式、复制为纯文本、文件复制为路径；不可用动作禁用并显示原因

## Phase 8：设置与配置

- [x] 在设置面板新增「采集设置」分组
- [x] 文本 / HTML / RTF / 图片 / 文件启用开关
- [x] 图片大小上限、文本大小上限输入
- [x] 敏感内容采集开关
- [ ] 将设置持久化到现有 user settings JSON

## Phase 9：迁移与清理

- [x] 删除 `lib.rs` 中旧的 `write_platform_clipboard` / `write_command` shell 写入实现，读取主路径改为 `clipboard-rs`
- [ ] 删除 `poll_clipboard_change` 旧监听实现
- [ ] 删除旧的 `ClipboardPayload { text }` 单一文本结构
- [x] 更新 `tauri::generate_handler!` 中的命令注册
- [x] 确保 `init_clip_database` 与 `capture_clip_record` 命令仍向前端暴露

## Phase 10：验证

- [x] `pnpm build` 通过
- [x] `cd src-tauri && cargo check` 通过
- [x] `cargo test parses_png_dimensions` 通过
- [ ] `pnpm tauri dev` 验证文本复制仍正常
- [ ] `pnpm tauri dev` 验证浏览器 HTML 复制后 Rich/Plain 写回均符合预期
- [ ] `pnpm tauri dev` 验证图片复制、显示、粘贴
- [ ] `pnpm tauri dev` 验证文件复制、显示、粘贴
- [ ] `pnpm tauri dev` 验证文件复制为路径
- [ ] `pnpm tauri dev` 验证写回后无重复入库
- [ ] `pnpm tauri dev` 验证删除图片/文件条目后磁盘文件清理
