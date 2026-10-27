# Tasks:ocr-image-text-extraction

## Phase 1:端点发现与提取 command

- [ ] 1.1 provider 检测扩展：本地视觉端点探测（llama-server/Ollama/LM Studio，`/v1/models` + 视觉能力标记），复用现有 agent_detect_candidates 体系，结果进设置页模型分组
- [ ] 1.2 `ocr_extract` Tauri command：图片条目 id → `image_file` 读取（8MB 上限）→ base64 → POST 视觉端点（官方 plain-OCR prompt、temperature=0）→ 纯文本返回；60s 超时、取消、`OCR_*` 错误码（含中文注释与 BUSINESS_INDEX 登记）
- [ ] 1.3 设置页「图片文字识别」分区：启用开关（默认开）+ 端点选择（自动发现 + 手动 URL），仅本地端点可选中

## Phase 2:前端入口与结果落库

- [ ] 2.1 图片条目右键菜单 + 详情页「提取文字」动作：loading 态防重复、失败 toast 带 `OCR_*` 错误码提示
- [ ] 2.2 结果展示与复制：详情页文本块 + 一键复制（走现有 writeClipboard）
- [ ] 2.3 「保存为文本条目」：新建 text clip，metadata 记 `sourceImageId`，入 FTS 索引

## Phase 3:验收与门禁

- [ ] 3.1 单测：8MB 上限拒绝、端点不可达错误码、取消语义、保存文本条目 metadata/FTS 断言
- [ ] 3.2 端到端：沙箱实例真实图片条目 → 提取 → 复制 → 保存为文本条目（复用 .work/phase10-e2e.mjs 的 MCP/剪贴板探针模式）
- [ ] 3.3 门禁：pnpm build + cargo check + pnpm test:unit 全绿；BUSINESS_INDEX 登记 ocr 域
