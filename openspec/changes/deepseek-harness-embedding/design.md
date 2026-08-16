# 设计：DeepSeek Harness 内嵌

## 1. 内嵌形态

| 方案 | 做法 | 取舍 |
|---|---|---|
| A. ACP / JSON-RPC sidecar（**采用**） | Tauri sidecar 起 `dsh` headless 常驻，Rust 经 localhost JSON-RPC 调用；session 持久化利于「管理」；延迟最低 | 需打包 Node 运行时为 sidecar（DSH 要求 Node ^22.19 \|\| ≥24） |
| B. 一次性 Headless CLI | 每次分析 `dsh run --profile headless --task <file>` 解析 stdout | 零常驻、最稳，但每次冷启 |
| C. Python SDK | 需 Python3.10+ 与 Git，分发重 | 不采用 |

localhost-only 与 DSH 设计一致（CLI 拒绝 `--host 0.0.0.0`）。

## 2. 只读分析 Profile（安全核心）

- Cordis profile `clipforge-analysis`：仅启用模型 + 自定义分析工具（summarize / classify / extract / auto-tag / suggest-folder），**禁用 fs-write / shell / danger-full-access**。
- 工具管线 `pre-execute` 钩子：接入 ClipForge `CapabilityPolicy` 与脱敏（沿用 `redact_sensitive`）。
- 模型路由默认指向用户配置的 provider（DeepSeek / OpenAI 兼容均可）。

## 3. 与现有四类结果对齐

DSH 返回结构化结果后，映射到 `ai-model-plugin-productization` 定义的四类：
- `previewPatch`（详情页建议回填）
- `newClipDraft`（生成插件草稿）
- `copyResult`（复制结果）
- `renderPanel`（渲染面板）

写回前一律走 preview / confirm（WritebackGuard）。

## 4. 管理（AI 操作历史 + 审计）

- 复用 DSH session store：每次分析留下 append-only 轨迹，agent 面板极简页展示 + trajectory 回放。
- 自动标签 / 建议分组技能辅助剪贴板归管。

## 5. 降级与风险

- 开发者预览、破坏性变更预期 → 锁版本 + vendor（MIT 允许 fork）。
- sidecar / Node / 模型缺失 → 禁用 AI 入口，基础剪贴板功能不受影响。
- 安全红线：分析 profile 绝不开放 shell / 写文件。
