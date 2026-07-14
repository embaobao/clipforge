# ClipForge 开发规范

## 项目定位

ClipForge 是一个跨平台剪贴板工具，第一目标是完整替代 Clipy 的核心能力；只有在剪贴板工具体验闭环后，才继续扩展搜索、归档、语义检索和 MCP 连接。

默认产品方向：

- ClipForge 首先必须是快速剪贴板工具，不是平台、不是 AI 工作台；界面、文案和默认入口都要围绕快捷唤起、历史、片段、文件夹、搜索、复制和删除这些高频动作。
- 主交互使用独立窗口，不把复杂输入框、搜索结果和多级列表塞进系统菜单。
- 系统托盘、全局快捷键和快速菜单是 Clipy 等价能力的一部分，优先级高于 AI/MCP。
- 搜索结果直接展示在主列表，不进入文件夹或二级面板。
- 剪贴板采集、复制回写、归档、删除、批量删除是基础能力，必须保持低延迟和可恢复。
- 片段、文件夹和快捷菜单必须服务于快速粘贴，不要做成复杂知识库或控制台。
- 后续 AI 接入只提供标准 MCP 工具调用能力，不做复杂配置面板，不把 AI 设置暴露成当前主体验。
- 后续语义检索使用本地索引优先，MCP 通过明确工具接口暴露能力。
- 视觉风格默认采用跨平台中性工具风格：克制、轻量、清晰层级、shadcn/ui 式语义 token 和 pi.dev 式黑白对比；不要绑定某一个平台的专属视觉语言。

## 技术栈

- 桌面壳：Tauri v2
- 原生能力：Rust command
- 前端：React + TypeScript + Vite
- UI：优先 shadcn/ui 风格组件和语义 token；当前过渡期允许自定义 CSS + lucide-react 图标
- 当前持久化：localStorage
- 规划持久化：SQLite + 小型向量索引

## 开发规则

- 所有提案、设计说明、任务拆解默认使用中文。
- `AGENTS.md` 是主规则文件，`CLAUDE.md` 只能引用本文件，不维护第二套规则。
- 开发前优先查看 `openspec/changes/*` 下的当前提案和任务。
- 新功能优先保持跨平台，不要先写死 macOS 专用路径；确实需要平台分支时必须隔离在 Rust 原生层。
- 用户界面必须是可用的剪贴板工具界面，不做营销落地页，不做平台首页。
- 搜索、输入、复制、删除等基础操作要优先保证焦点稳定、按钮可点击、列表不跳动。
- 样式优化应优先保持现有信息结构和控件尺寸稳定；除非需求明确，不要借视觉优化重排核心工作流。
- 不引入重型运行时，除非有明确性能和维护收益。

## 验证要求

每次功能开发至少执行：

```bash
pnpm build
cd src-tauri && cargo check
```

涉及 Tauri 原生能力时，还应启动：

```bash
pnpm tauri dev
```

如果因为本机依赖、权限或系统安全策略无法完成，必须在交付说明中明确写出未验证项。

## 开发规范（可维护性）

为保证代码可维护、可协作、可长期演进，新增和重构代码必须遵守以下规范。门禁脚本见 [scripts/verify-file-size.mjs](scripts/verify-file-size.mjs)，豁免清单见 [scripts/file-size-exemptions.json](scripts/file-size-exemptions.json)，详见提案 [codebase-modularity-refactor](openspec/changes/codebase-modularity-refactor/proposal.md)。

### 单文件不超过 500 行

- 新增源文件、被本次改动触碰的文件，必须 ≤ 500 行（含注释）。
- 现存超长主文件（`src/App.tsx`、`src/settings.tsx`、`src/agent-panel.tsx`、`src/agent-chat-page.tsx`、`src-tauri/src/lib.rs`）列入豁免清单，按域分阶段拆分，不要求一次性达标；豁免清单只减不增，新增豁免必须在对应提案说明理由。
- 超过 500 行不是「拆成多文件」的唯一理由；当一个文件承担多个不相关职责时，即使未超限也应按域拆分。

### 必须有中文注释

- 公共能力必须有中文文档注释：Rust `#[tauri::command]`、public struct/enum/fn、TS exported interface/type、React 组件 props、MCP 工具、复杂业务逻辑（写回抑制、面板定位、settings 合并、原子写、provider 解析）。
- 注释说明「做什么、为什么、边界」，与提案/设计文档中文一致。
- 不强制行内注释；明显的小工具、CSS、纯样式常量可省略。

### 组件化与按域拆分

- 前端按 surface 拆目录：`src/settings/`、`src/agent/`、`src/clipboard/`。
- 组件职责单一，props 类型显式导出，状态提升到最近共同父级或 Zustand（仅跨组件 UI 状态）。
- 业务数据仍由 Tauri command 驱动，不把业务状态塞进全局 store。

### 样式按功能拆分

- 不再向 `src/App.css` 单文件追加；新组件样式随组件拆（优先 `*.module.css`，或按域 `src/<surface>/<surface>.css`）。
- 全局语义 token / CSS 变量保持在 `:root`，组件只消费不重定义。
- 现有 App.css 在对应 surface 抽组件时随组件迁移，不一次性重写。
