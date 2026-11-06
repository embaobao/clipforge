# 提案：图片文字识别与快速复制——本地 OCR 接入（ocr-image-text-extraction）

> 所属轨：AI 能力优化轨，见 [ai-model-plugin-productization](../ai-model-plugin-productization/proposal.md)（隐私门禁对齐其「图片 OCR 需显式授权」条款）。衔接 [file-image-clipboard-support](../file-image-clipboard-support/proposal.md) 遗留的「OCR 后续独立提案」。

## 状态

评估已完成并实测通过（2026-10-27），方案定型：**复用现有 OpenAI-compatible provider 体系接入本地视觉模型 OvisOCR3**，不做内置推理运行时。优先级 P3，不阻塞剪贴板主线。

## 背景

图片条目目前只能整图复制，图内文字不可用。剪贴板工具的高频场景「截图里有段文字要拿走」目前需要用户另开工具。file-image-clipboard-support 提案边界明确将 OCR 留给独立提案；本提案即为该独立提案。

## 评估结论（2026-10-27 本机实测）

**模型**：[ATH-MaaS/OvisOCR3](https://huggingface.co/ATH-MaaS/OvisOCR3)（Apache-2.0，Qwen3.5-0.8B 微调，统一 OCR/文档理解 VLM，OmniDocBench1.6 96.74）。原始仓 gated，采用社区 GGUF 转档 [michalland/OvisOCR3-GGUF](https://huggingface.co/michalland/OvisOCR3-GGUF)（Q8_0 主模型 812MB + F16 视觉投影 mmproj 205MB）。

**运行时**：llama.cpp（brew 版 llama-server，Apple Silicon Metal），`--jinja --ctx-size 16384 --temp 0 --chat-template-kwargs '{"enable_thinking": false}'`，OpenAI-compatible `/v1/chat/completions` 端点，图片走 base64 data URL。

**实测效果**（Apple Silicon，本机）：

| 用例 | 耗时 | 结果 |
|---|---|---|
| 密集中英文 UI 截图（1000×560pt retina） | 8.5s | 全文按阅读顺序提取，中英文/侧栏层级全对 |
| 渲染样张 2x（1800×640，含 28px 小字号行/邮箱/电话/中文标点） | 2.9s | 5/5 行逐字全对 |
| 渲染样张 1x（900×320） | 2.2s | 英文行全对，细笔画中文漏行（1x 渲染笔画过细所致，非模型缺陷） |

**资源**：权重 ~1GB 常驻 + KV；服务冷启动 ~12s（一次性）。**结论：0.8B 量化模型本地可用，效果满足剪贴板场景；延迟 2-9s 属"识别一条"可接受区间，不适合批量。**

**落点**：模型与 llama-server 不进应用包——OvisOCR3 定位为「用户自备的本地视觉端点」，与 Ollama/LM Studio 同一接入面（现状已有 provider 自动发现体系），应用只做发现与调用。内置 sidecar + 模型下载管理另行评估（重依赖，见 What 边界）。

## What（实施范围）

1. **视觉端点自动发现**：现有 provider 检测扩展一项「支持图片输入的本地端点」探测（llama-server `:8491/:8080`、Ollama `:11434`、LM Studio `:1234`，探测 `/v1/models` + 视觉能力标记），设置页 Agent/模型分组可见。
2. **Rust `ocr_extract` command**：入参图片条目 id → 读 `image_file` 原图（上限 8MB，超限拒绝）→ base64 → POST 本地视觉端点（官方 plain-OCR prompt，`temperature=0`）→ 返回纯文本。超时 60s、可取消、失败带 `OCR_*` 错误码（端点不可达/模型不支持图片/超时）。
3. **前端入口**：图片条目右键菜单 + 详情页「提取文字」动作，loading 态防重复点击；结果展示在详情页文本块，一键复制；「保存为文本条目」动作新建 text clip（metadata 记 `sourceImageId`，入 FTS 可搜索）。
4. **设置**：「图片文字识别」分区——启用开关（默认开，仅本地端点）、端点选择（自动发现列表 + 手动 URL）。云端 provider 不路由 OCR（隐私边界，对齐 ai-model-plugin-productization 授权条款）。

## 边界（明确不做）

- 不内置模型下载管理/sidecar 进程管理（llama.cpp 二进制分发 + 1GB 模型托管是独立重量级决策，后续按需另立提案）。
- 不做批量 OCR、不做表格/公式结构化输出（plain OCR 单一契约；document_markdown 等 prompt 能力留作后续 additive）。
- macOS Vision 快速路径（零依赖、<1s）列为 Phase 2 可选优化：平台分支隔离在 Rust 原生层，与跨平台 OCR 端点并存。

## 风险与护栏

- GGUF 为社区转档（非官方），护栏：端点探测失败即降级隐藏入口，不阻塞其余功能；模型文件校验和由 llama-server 加载期把关。
- 首次调用延迟（mmproj 编码 ~2s 起）：入口有明确 loading 态，失败可重试；后续可缓存同图结果（按 image content_hash 键）。
- 中文细笔画小字在低分辨率源图上有漏行风险：详情页展示原图缩略可人工核对；2x 及以上源图实测无此问题。

## 备选方案否决记录

- **PaddleOCR-VL / Xiaomi-OCR（GGUF）**：同量级基准分，但无更优；OvisOCR3 MDPBench/PureDocBench 领先（88.80/82.31），且 llama.cpp 生态现成。否决。
- **应用内置 tesseract/其他传统 OCR 库**：中文准确率与版面还原显著落后 VLM 方案（基准分差距 20+ 点），Rust 绑定维护成本高。否决。
- **云端 OCR API（服务商 vision 模型）**：剪贴板截图常含敏感内容，上传第三方违反隐私默认；仅本地端点。否决。
