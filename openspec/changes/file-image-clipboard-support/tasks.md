# 任务：文件与图片剪贴板支持

## Phase 1：基础依赖与数据模型

- [ ] 在 `src-tauri/Cargo.toml` 添加 `clipboard-rs` 与 `blake3` 依赖
- [ ] 创建 `src-tauri/src/clipboard/mod.rs` 模块入口
- [ ] 定义 `ClipboardPayload` / `TextPayload` / `ImagePayload`（`clipboard/payload.rs`）
- [ ] 扩展 `ClipItemPayload` JSON 结构：新增 `contentHash`、`searchText`、`subKind`、`width`、`height`、`size`、`fileTypes`、`thumbnailPath`、`imageFile`
- [ ] 数据库迁移：为 `clips` 表添加 `content_hash`、`search_text`、`sub_kind`、`width`、`height`、`size`、`file_types`、`image_file`、`is_sensitive` 列
- [ ] 编写迁移脚本回填存量 `content_hash`（默认用 `id`）和 `search_text`（默认用 `content`）
- [ ] 更新 `init_schema` 中新建表的 DDL，包含上述新列
- [ ] 更新 FTS5 触发器，同步 `search_text` 字段

## Phase 2：剪贴板读取

- [ ] 实现 `clipboard::read::ClipboardReader`，封装 `clipboard_rs::ClipboardContext`
- [ ] 支持读取 text / html / rtf / image / files 五类格式
- [ ] 图片读取优先直取 PNG 原始字节（macOS `public.png` / Windows `PNG`），零解码解析尺寸
- [ ] 非 PNG 图片回退到 `ClipboardContext::get_image()` 解码并重编码为 PNG
- [ ] 定义 `CaptureSettings` 与 `CaptureKind`，支持启用开关与采集顺序
- [ ] 添加 `png_dimensions` 辅助函数与单元测试

## Phase 3：图片与文件存储

- [ ] 实现 `clipboard::storage::ImageStore`
- [ ] 确定图片根目录：`<app_data>/resources/clipboard-images/`
- [ ] 按 `blake3(<png_bytes>)` 生成文件名，前 2 位 hex 作为分片目录
- [ ] 实现 `store()` 落盘原图、`origin_path()` 解析原图路径
- [ ] 实现 `ensure_thumbnail()` 延迟生成缩略图（最长边 300px）
- [ ] 实现 `remove()` 删除原图、缩略图并清理空分片目录
- [ ] 为 `ImageStore` 编写单元测试（幂等、缩略图、删除）

## Phase 4：采集与入库

- [ ] 实现 `clipboard::ingest::build_item()`，将 `ClipboardPayload` 转为 `ClipItem`
- [ ] 文本入库：`content` 存源表示，`search_text` 存纯文本
- [ ] HTML / RTF 子类型识别与存储
- [ ] 图片入库：调用 `ImageStore::store()`，`content` 存文件名
- [ ] 文件入库：`content` 存换行路径，`search_text` 存文件名
- [ ] 实现纯文本子类型识别 `clipboard::detect`（url / email / color / path）
- [ ] 实现大小限制过滤（文本、图片可配置上限）
- [ ] 实现敏感内容检测与开关（API Key 等）
- [ ] 更新 `capture_clip_record_internal` 复用 `build_item` 路径

## Phase 5：写回与粘贴

- [ ] 实现 `clipboard::write::write_to_clipboard()`
- [ ] 文本写回：纯文本 / HTML / RTF 多格式同时写入
- [ ] 图片写回：从 `ImageStore` 读取原图并 `ctx.set_image()`
- [ ] 文件写回：`ctx.set_files()` 与「粘贴为路径」纯文本模式
- [ ] 实现 `clipboard::guard::WritebackGuard`，抑制写回回环
- [ ] 升级 `write_clipboard_text` 为 `write_clipboard_item`
- [ ] 升级 `paste_clipboard_text` 为 `paste_clipboard_item`
- [ ] 纯文本粘贴模式（`plain=true`）仅对文本/文件生效

## Phase 6：监听升级

- [ ] 实现 `clipboard::watcher::init()`，使用 `ClipboardWatcherContext`
- [ ] 替换当前 `poll_clipboard_change` 轮询方案
- [ ] macOS 配置 120ms 轮询间隔；Windows 事件驱动
- [ ] 监听线程内读取 payload 并投递到 Tauri 异步运行时入库
- [ ] 支持暂停/恢复监听
- [ ] 保持写回抑制与监听路径的去重逻辑一致

## Phase 7：前端适配

- [ ] 扩展 `src/services/contracts.ts` 中的 `ClipItem` 类型
- [ ] 新增 `src/services/clipboard.ts`：封装 `readClipboard` / `writeClipboard` / `pasteClipboard` / `getImagePath`
- [ ] 列表根据 `kind` 渲染不同行组件：`TextClipRow`、`ImageClipRow`、`FilesClipRow`
- [ ] 图片行：使用 `convertFileSrc(thumbnailPath)` 显示缩略图
- [ ] 文件行：显示文件图标、文件名、路径，多文件显示数量
- [ ] 文件已删除时显示弱化样式
- [ ] 详情页支持图片原图预览与文件列表
- [ ] 底部状态栏/右键菜单根据类型动态显示可用动作

## Phase 8：设置与配置

- [ ] 在设置面板新增「采集设置」分组
- [ ] 文本 / HTML / RTF / 图片 / 文件启用开关
- [ ] 采集顺序拖拽配置
- [ ] 图片大小上限、文本大小上限输入
- [ ] 敏感内容采集开关
- [ ] 将设置持久化到现有 user settings JSON

## Phase 9：迁移与清理

- [ ] 删除 `lib.rs` 中旧的 `read_platform_clipboard` / `write_platform_clipboard` / `read_command` / `write_command` shell 命令实现
- [ ] 删除 `poll_clipboard_change` 旧监听实现
- [ ] 删除旧的 `ClipboardPayload { text }` 单一文本结构
- [ ] 更新 `tauri::generate_handler!` 中的命令注册
- [ ] 确保 `init_clip_database` 与 `capture_clip_record` 命令仍向前端暴露

## Phase 10：验证

- [ ] `pnpm build` 通过
- [ ] `cd src-tauri && cargo check` 通过
- [ ] `cargo test` 中新增 `ImageStore` 与 `detect` 单元测试通过
- [ ] `pnpm tauri dev` 验证文本复制仍正常
- [ ] `pnpm tauri dev` 验证图片复制、显示、粘贴
- [ ] `pnpm tauri dev` 验证文件复制、显示、粘贴
- [ ] `pnpm tauri dev` 验证写回后无重复入库
- [ ] `pnpm tauri dev` 验证删除图片/文件条目后磁盘文件清理
