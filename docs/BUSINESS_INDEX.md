# ClipForge 业务索引

> 目标：Agent / 新人在 30 秒内定位「某个业务改哪里」。
> 符号级定位用 `pnpm locate <关键词>`（支持中文，如 `pnpm locate 写回`、`pnpm locate 快捷键`）；本表维护「业务域 → 入口文件」。
> 维护义务见 AGENTS.md「业务索引与快速定位」；索引防腐校验：`pnpm locate --check-index`（已挂入 `pnpm test:unit`）。

## 1. 窗口与 Surface

| Surface | 窗口 label | HTML 入口 | 前端根 | 布局外壳 / 标题栏 | 主要目录 |
| --- | --- | --- | --- | --- | --- |
| 快速面板（主交互） | `main` | `index.html` | `src/main.tsx` → `src/App.tsx` | `src/clipboard/components/TopToolbar.tsx`（自绘 chrome + 拖拽区） | `src/clipboard/` |
| 详情工作区 | `main`（内部路由） | `index.html` | `src/routes/workspace-router.tsx` | `src/workspace/components/WorkspaceCrumb.tsx` | `src/workspace/` |
| 设置 | `settings` | `settings.html` | `src/settings-main.tsx` → `src/settings.tsx` | `src/settings/components/SettingsShell.tsx`（系统原生标题栏，页面内不画红绿灯） | `src/settings/` |
| 引导 | `onboarding` | `onboarding.html` | `src/onboarding-main.tsx` → `src/onboarding/OnboardingApp.tsx` | `src/onboarding/components/OnboardingWizard.tsx` | `src/onboarding/` |

- Surface 边界与样式分层（引导/设置独立窗口）:引导（onboarding）与设置（settings）是独立窗口 surface,与主面板（main）互不阻塞——引导窗口常驻不挡托盘/全局快捷键唤起主面板;样式分层遵守「全局 token 只在 `src/index.css` 的 `:root`,组件只消费 Tailwind 语义类,不重定义、不新建组件级 CSS」(契约见 docs/DESIGN_SYSTEM.md);各 surface 独立 HTML 入口 + 独立根组件,跨 surface 只经 Tauri command/事件通信,不共享 React 状态。

- 窗口属性（decorations / transparent / 尺寸 / hiddenTitle）唯一来源：`src-tauri/tauri.conf.json`。窗口 chrome 类问题（双标题栏、拖拽、圆角）先查这里，再看对应 Shell 根类名。
- Rust 入口：`src-tauri/src/main.rs` → `src-tauri/src/lib.rs`。

## 2. 前端业务域

| 业务域 | 入口 / 核心文件 | 说明 |
| --- | --- | --- |
| 图片文字识别（OCR） | `src-tauri/src/ocr.rs`（`ocr_extract` command）、`openspec/changes/ocr-image-text-extraction/` | 本地视觉端点（llama-server/Ollama）调用；`OCR_*` 错误码；端点设置键 `ocrEnabled`/`ocrEndpointUrl` |
| 面板生命周期 | `src/clipboard/use-panel-bootstrap.ts`、`src/clipboard/use-panel-environment.ts` | 启动引导、环境副作用 |
| 面板显隐 / 失焦 | `src/clipboard/use-panel-blur-hide.ts` | 失焦隐藏 180ms 窗口约束 |
| 键盘交互 | `src/clipboard/use-panel-keyboard.ts` | 全局键位、快捷键分发；effect deps 是历史 bug 高发区 |
| 列表 / 虚拟滚动 | `src/clipboard/use-clipboard-list.ts`、`src/clipboard/clipboard-event-gate.ts`、`src/clipboard/components/VirtualList.tsx` | 主列表数据与渲染；clipboard-changed 事件闸门（序号去重 + in-flight 合并） |
| 搜索 | `src/clipboard/clip-search.ts`、`src/search-query.ts`、`src/clipboard/components/GlassSearchBar.tsx` | 搜索请求构建与查询语法 |
| 复制回写 | `src/clipboard/use-clip-writeback.ts`、`src/services/clipboard.ts` | 粘贴写回抑制，避免回环采集 |
| 聚合拼接格式 | `src/clipboard/clipboard-domain.ts`、`src/clipboard/use-aggregate-format.ts`、`src/clipboard/aggregate-format-storage.ts`、`src/workspace/components/AggregateFormatMenu.tsx` | 多选聚合的分隔符/编号/顺序，复制与预览共用 formatAggregate |
| 行视觉 / 动画 | `src/clipboard/row-animation.ts`、`src/clipboard/anim-freeze-guard.ts` | 行入场动画、WKWebView 动画冻结守卫 |
| 快速预览 | `src/clipboard/components/QuickPreviewCard.tsx`、`src/clipboard/components/ClipboardContentPreview.tsx` | hover 预览卡（规格见 DESIGN_SYSTEM 7.3） |
| 多选 / 回收站 | `src/clipboard/components/MultiSelectBottomBar.tsx`、`src/clipboard/components/TrashPanel.tsx` | 批量删除、回收站视图 |
| 面板根组件 | `src/clipboard/components/QuickPastePanel.tsx` | 快速面板主体 |
| 设置模型 / 字段目录 | `src/settings/settings-model.ts`、`src/settings/settings-field-catalog.ts`、`src/settings/field-runtime-spec.ts` | 设置状态、字段目录、运行时规格 |
| 设置控件 | `src/settings/controls.tsx` | Switch / Slider / ToggleGroup / Input 语义控件 |
| 设置 sections | `src/settings/sections/` | 各分类内容（ShortcutLanguage、DisplayPanel、CaptureStorage、AgentUpdateTag、AgentProviderManager：provider 增删改表单，key 只写不回显） |
| 设置状态条 | `src/settings/components/SettingsStickyStatusBar.tsx` | 底部保存状态 |
| 详情 / 聚合工作区 | `src/workspace/components/ClipDetailWorkspace.tsx`、`src/workspace/components/detail/` | 详情页三态（浏览/编辑/diff）编排壳 + 子组件：`detail-state.ts` 状态机纯函数、`md-editor.tsx` MD 编辑器、`renderer-registry.ts` 类型渲染注册表（含 golden 测试）、`detail-meta-row.tsx` tags 四源 provenance、`detail-plugin-zone.tsx` 插件区装配（AI 分析 + 提示词优化共用插件队列）、`draft-diff.tsx` 草稿对比；聚合视图/PiAnalysisBar/PromptOptimizerBar 在 `src/workspace/components/` |
| 内置标签规则 / tag provenance | `src-tauri/src/lib.rs`（`builtin_tag_rules_enabled`、`default_tags`）、`src/workspace/components/detail/tag-provenance.ts`、设置页 tag-rules 分区 | 链接/Markdown/#话题 三开关（settings.builtinTagRules）；tags 四源色点存 `clips.metadata.tags_provenance` |
| Agent / pi-sdk | `src/agent/pi/` | agent、analysis、tools、provider-config、stream、prompt-optimizer（提示词单次 AI 重写，产出草稿进 diff 态写回）；默认 provider 经 `agent_resolve_pi_provider` 运行时解析（设置态无明文 key） |
| 编辑器域 | `src/editor/` | 敏感信息、建议、动作 |
| 智能格式 / 插件动作 | `src/smart-format.ts`、`src/plugin-actions.ts` | 内容智能格式化与动作解析 |
| 服务契约 | `src/services/contracts.ts`、`src/services/contracts/` | 前后端契约类型 |
| Web mock | `src/services/tauri-web-mock.ts` | 无 Tauri 环境的浏览器开发桥（各入口首行副作用导入） |
| i18n | `src/i18n/index.ts`、`src/i18n/locales/zh-CN.json`、`src/i18n/locales/en-US.json` | 文案收口；改文案跑 `pnpm check:i18n` |
| 样式 token | `src/index.css` | 全局语义 token 唯一来源；视觉契约见 `docs/DESIGN_SYSTEM.md` |
| 通用 hooks | `src/hooks/` | mobile / auto-height / controlled-state / data-state |
| 性能探针 | `src/performance-smoke.ts`、`src/frontend-diagnostics.ts` | recordNextFramePerf、诊断快照 |

## 3. Rust 侧

| 域 | 文件 | 说明 |
| --- | --- | --- |
| command 主体 | `src-tauri/src/lib.rs` | 剪贴板/面板命令 + 托盘 + 窗口管理；设置命令下沉 `settings_service/`、Agent 命令下沉 `agent/`、MCP 命令下沉 `mcp/`；超长豁免文件，用 `pnpm locate <命令名或中文>` 定位具体命令 |
| Agent 域 | `src-tauri/src/agent/` | `agent_*` 命令与 provider 探测/健康检查/模型清单：`mod.rs` 门面（payload 结构体 + 命令薄壳）、`provider.rs` 探测/预览（redaction/keyRef）、`pi.rs` pi 运行时 provider 解析（key 只在调用时解出）、`check.rs` 健康检查、`context.rs` 上下文/prompt 组装、`events.rs` 事件/输出流、`run.rs` run 状态机、`runs.rs` run 存储 + 私有写锁 |
| MCP 运行时 | `src-tauri/src/mcp/` | `--mcp` stdio JSON-RPC 与 41 工具：`mod.rs` 运行时门面（run_mcp_stdio + 状态命令）、`specs.rs` 工具规格表、`dispatch.rs` 路由壳、`dispatch_write.rs` 写库臂、`dispatch_merge.rs` clipboard.merge 只读拼接臂、`dispatch_agent_editor.rs` skill/plugin/agent/editor 臂、`context.rs` 上下文快照、`envelope.rs` 响应封装 |
| 剪贴板引擎 | `src-tauri/src/clipboard/` | `watcher.rs` 采集监听（监督循环重连 + 启动 priming）、`suppress.rs` 写回抑制窗口（截止时间戳）、`dedup.rs` 跨采集路径共享指纹、`ingest.rs` 入库、`read.rs` 读取、`write.rs` 写回、`storage.rs` 存储、`detect.rs` 检测、`payload.rs` 载荷 |
| 采集去重语义 | `src-tauri/src/lib.rs`（capture 入库路径，`status=promoted`） | 同 content_hash 指纹命中走 promote：软删行复活回列表、刷 last_seen_at 与来源上下文，favorite/copy_count 保留。三类已知重复行为（clipboard-data-integrity 3.1）：① 富文本条目格式漂移（RTF/HTML 变体各自成条）；② HTML 与 plain 同源分条（哈希口径按 plain_text）；③ 文件复制按路径集合为键，同文件不同路径各成条。「同 plain_text 多格式合并」需哈希口径变更，单独立项评估，本期不做 |
| 设置服务 | `src-tauri/src/settings_service/` | `settings_service_*` 统一协议（唯一服务入口，供设置窗口 / MCP 复用）：`mod.rs` 门面（写事务/校验/redact）、`write.rs` 原子写 + 写锁 + redacted 占位符按 id 回填、`commands.rs` 命令 + 快捷键/托盘同步、`mcp.rs` MCP 分发 |
| 上下文采集 | `src-tauri/src/context_collectors.rs`、`src-tauri/src/context_collectors/`、`src-tauri/src/context_collector_runtime.rs`、`src-tauri/src/context_collector_system.rs` | Agent 上下文收集器 |
| 应用上下文 | `src-tauri/src/application_context.rs` | 应用级上下文聚合 |

## 4. 验证速查

| 改动 | 必跑 |
| --- | --- |
| 前端任意 | `pnpm build:web` |
| Rust 任意 | `cd src-tauri && cargo check` |
| 设置页 | `node scripts/verify-settings-surface.mjs`（已含在 `pnpm test:unit`） |
| 剪贴板监听事件闸门 | `node scripts/verify-clipboard-listener.mjs`（已含在 `pnpm test:unit`） |
| 主面板交互 | `pnpm test:interaction` |
| i18n 文案 | `pnpm check:i18n` |
| 动效 token | `pnpm verify:motion` |
| 全量门禁 | `pnpm test:unit`（含文件行数、边界、索引防腐校验） |
| 原生能力 / 视觉 | `pnpm tauri dev`（涉及 Tauri 能力或 UI 表面时） |

## 5. 常见排查入口

| 症状 | 首查 |
| --- | --- |
| 窗口 chrome 异常（双标题栏 / 无法拖拽 / 圆角错） | `src-tauri/tauri.conf.json` 窗口块 + 对应 Shell 根类名；页面内禁止绘制假红绿灯（见 DESIGN_SYSTEM 7.2） |
| 内容重复渲染 | 搜索同条件的两个渲染点（如旧内联块与新 section 组件并存） |
| 快捷键无响应 | `src-tauri/src/settings_service/commands.rs` 快捷键注册 + `src/clipboard/use-panel-keyboard.ts` effect deps |
| 设置不保存 / 不刷新 | `src-tauri/src/settings_service/commands.rs` 写入链 + `src/settings.tsx` `updateSettings` + `settings_changed` 事件 |
| 列表跳动 / 动画异常 | `src/clipboard/row-animation.ts`、`src/clipboard/anim-freeze-guard.ts`、`src/clipboard/components/VirtualList.tsx` |
| 粘贴后出现重复条目 | `src/clipboard/use-clip-writeback.ts` 写回抑制窗口 |
| 文案缺失 / 中英不对齐 | `src/i18n/locales/` + `pnpm check:i18n` |
