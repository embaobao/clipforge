# Delta:图片文字识别(image-ocr)

> 本地 OCR 接入:图片条目可提取图内文字并复制/存为文本条目。

## ADDED Requirements

### Requirement: 图片文字提取

图片条目 SHALL 提供「提取文字」动作(右键菜单与详情页入口),经用户配置的**本地**视觉端点(OpenAI-compatible)执行 OCR,返回纯文本。系统 SHALL NOT 将剪贴板图片内容发送到云端 provider;本地端点不可达或模型不支持图片输入时 SHALL 返回 `OCR_*` 错误码并保持入口可用(可重试)。

#### Scenario: 本地端点提取成功

- **WHEN** 用户对图片条目执行「提取文字」且本地视觉端点可用
- **THEN** 详情页展示提取的纯文本并提供一键复制;「保存为文本条目」可新建 text clip 且 metadata 记录 `sourceImageId`,该条目可被全文搜索命中

#### Scenario: 端点不可达降级

- **WHEN** 本地视觉端点不可达或未配置
- **THEN** 动作返回 `OCR_ENDPOINT_UNAVAILABLE` 类错误码并以 toast 提示,不崩溃、不阻塞图片条目的其他操作(复制图片/删除等)

#### Scenario: 详情页文本块与一键复制

- **WHEN** 用户对图片条目执行「提取文字」且本地视觉端点返回文本
- **THEN** 详情页展示只读文本块(全文可选中)与「复制」按钮,复制走现有 writeClipboard;「保存为文本条目」新建 text clip 且 metadata 顶层记录 `sourceImageId`,该条目可被全文搜索命中

#### Scenario: OCR 错误码本地化与端点准入提示

- **WHEN** 提取失败返回 `OCR_*` 错误码,或用户在设置里填入非回环端点
- **THEN** toast 显示按错误码映射的 zh-CN/en-US 文案而非英文原文;端点输入给行内提示,且不阻断图片条目的其他操作

### Requirement: 提取资源边界

单次提取的图片 SHALL 受 8MB 大小上限约束(超限拒绝并提示),单次请求 SHALL 有 60s 超时且可取消;同一图片的提取结果 SHALL 可按图片 content_hash 缓存复用,不重复调用端点。

#### Scenario: 超大图片拒绝

- **WHEN** 图片条目的原图超过 8MB
- **THEN** 提取动作立即拒绝并返回超限错误,不发起网络请求

#### Scenario: 取消进行中的提取

- **WHEN** 提取请求尚在等待本地端点响应时,用户通过 `ocr_cancel(requestId)` 取消
- **THEN** 网络等待被中断、动作返回 `OCR_CANCELLED`、结果不写入缓存、入口恢复可重试;同步读图/base64 段不承诺可中断

#### Scenario: 同图缓存命中复用

- **WHEN** 同一图片、同一端点在缓存有效期内再次执行「提取文字」
- **THEN** 直接返回缓存文本,不读原图、不发起 POST,`elapsed_ms` 为 0;换端点或进程重启后重新请求
