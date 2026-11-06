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

### Requirement: 提取资源边界

单次提取的图片 SHALL 受 8MB 大小上限约束(超限拒绝并提示),单次请求 SHALL 有 60s 超时且可取消;同一图片的提取结果 SHALL 可按图片 content_hash 缓存复用,不重复调用端点。

#### Scenario: 超大图片拒绝

- **WHEN** 图片条目的原图超过 8MB
- **THEN** 提取动作立即拒绝并返回超限错误,不发起网络请求
