# detail-workspace Delta：详情页信息架构、三态编辑与插件化

## ADDED Requirements

### Requirement: 内容优先层序

详情页 SHALL 按「crumb → 来源路径行 → meta 单行 → 内容主体 → 底部动作区」五区编排，内容主体占视口高度 ≥70%；来源路径行仅在条目含可解析路径时渲染，无路径整行隐藏。

#### Scenario: 打开详情页即见内容

- **GIVEN** 用户在主窗口打开任意类型剪贴板条目详情页
- **WHEN** 详情页渲染完成
- **THEN** 元信息压缩为单行 chip 行（静态类型 chip + 来源应用 chip + tags）
- **AND** AI 功能入口位于 tags 行右侧插件区，不占内容区
- **AND** 内容主体在 720×600 主窗口下占视口高度 ≥70%

#### Scenario: 类型 chip 静态展示

- **GIVEN** 详情页 meta 单行展示条目类型
- **WHEN** 用户点按类型 chip
- **THEN** 类型 chip 不展开下拉菜单（类型快速操作缓做，进 backlog）
- **AND** chip 仅承担类型信息展示

#### Scenario: 采集原数据弹窗

- **GIVEN** 详情页展示一条带采集上下文的条目
- **WHEN** 用户点击来源 app chip
- **THEN** 以弹窗展示采集原数据（来源应用、地址、应用上下文）
- **AND** 详情页主体不常驻独立的地址行与应用上下文折叠区

### Requirement: 三态状态机

详情页内容主体 SHALL 实现浏览（只读）/ 编辑 / diff 三态互斥状态机：浏览态按 renderer 渲染只读内容；编辑态 MD 编辑器占满内容区；diff 态展示插件草稿对比；弹窗仅限采集原数据与 AI 功能配置两处。

#### Scenario: 进入与退出编辑

- **GIVEN** 用户在浏览态查看一条文本/markdown/html 条目
- **WHEN** 按 E 键或双击内容或点击底部编辑钮
- **THEN** 进入编辑态：MD 编辑器占满内容区，浏览态正文、路径行、提示行隐藏
- **WHEN** 按 ⌘S 或点击保存
- **THEN** 编辑内容经 update_clip_record 生效并回到浏览态
- **WHEN** 按 Esc
- **THEN** 不保存退出编辑态，内容回退到修改前

#### Scenario: 编辑器能力

- **GIVEN** 用户在编辑态的 markdown 条目上操作
- **WHEN** 使用工具条或 ⌘B/⌘I 对选区加粗/斜体，或切换到预览 tab
- **THEN** 选区被对应 markdown 标记包裹（无选区时插入空标记并置光标于内）
- **AND** 预览 tab 即时渲染标题/列表/加粗/删除线/行内代码/引用
- **AND** 状态行显示实时字数与快捷键提示

#### Scenario: 只读类型禁用编辑

- **GIVEN** 一条 image 或纯 file 类条目
- **WHEN** 用户查看编辑入口
- **THEN** 编辑入口禁用并说明原因

### Requirement: 插件草稿 diff 态

插件/AI 改写产出 SHALL 以草稿形态进入 diff 态：红删绿增行级对比 + 草稿横幅标注来源插件 id；草稿仅存内存不落库，⌘S 保存生效，Esc 放弃草稿返回浏览态。

#### Scenario: 草稿保存与放弃

- **GIVEN** 一个改写类插件功能产出内容草稿
- **WHEN** 草稿进入 diff 态
- **THEN** 内容区展示行级红删绿增，横幅显示「草稿 来自插件 <srcId>」
- **WHEN** 按 ⌘S
- **THEN** 草稿内容经 update_clip_record 生效，diff 态退出
- **WHEN** 按 Esc
- **THEN** 草稿被丢弃，内容保持草稿前状态，不产生任何持久化记录

#### Scenario: 标签类产出不进 diff

- **GIVEN** 一个标签类插件功能产出标签建议
- **WHEN** 产出返回
- **THEN** 建议以 tags 行尾建议 chips 点选追加呈现，不进入 diff 态

### Requirement: 插件区落位

详情页 SHALL 在 meta 单行 tags 右侧预留插件区：插件功能下拉（含功能列表、插件队列入口、安装入口）与队列角标；队列并发上限为 2。

#### Scenario: 插件下拉

- **GIVEN** 插件区已注册至少一个插件功能（含 AI 内置功能）
- **WHEN** 用户点击插件区 ⌕ 钮
- **THEN** 下拉自触发钮 origin 缩放展开，展示功能列表（名称 + 快捷键）与队列状态入口
- **AND** 队列运行中数以 ⌕ 钮角标显示

#### Scenario: 队列并发上限

- **GIVEN** 插件队列已有 2 个运行中任务
- **WHEN** 第 3 个功能被触发
- **THEN** 该任务进入排队状态，待任一运行中任务完成后启动

### Requirement: 复制三路

详情页 SHALL 提供三路复制：纯文本（底部主钮）、原格式（底部 ⧉原格式钮，RTF/HTML + 纯文本多 flavor）、路径（顶部来源路径行 + ⇧⌘C）。

#### Scenario: 原格式复制

- **GIVEN** 一条 representations 含 text/html 或 text/rtf 的条目
- **WHEN** 用户点击底部 ⧉原格式钮
- **THEN** 剪贴板以多 flavor 写入（富格式 + text/plain），粘贴到富文本目标应用保留格式
- **WHEN** 条目无任何富文本 representation
- **THEN** ⧉原格式钮禁用并以 tooltip 说明

#### Scenario: 路径复制

- **GIVEN** 一条含可解析来源路径的条目（file-list fileName、analysis.url 或 metadata 路径）
- **WHEN** 详情页渲染
- **THEN** 浏览态顶部显示等宽路径行（chip 展示 + 复制钮），编辑态隐藏
- **WHEN** 用户点击路径 chip、复制钮或按 ⇧⌘C
- **THEN** 路径以纯文本写入剪贴板并就地反馈「已复制」
- **WHEN** 条目无可解析路径
- **THEN** 路径行整行隐藏，⇧⌘C 不触发

### Requirement: 类型渲染注册表

详情页类型反应 SHALL 由 detail renderer registry 驱动：宿主内置渲染项以声明式 match（payloadKind/extensions/mimePrefix/heuristic/order）注册，resolve 顺序为 payloadKind 精确匹配 > extensions/mime > heuristic，同层按 order 升序，全部未命中回退 readonly-text。

#### Scenario: 内置类型命中与迁移前一致

- **GIVEN** image、file、imageUrl、html、link、json、markdown、纯文本八类 fixture 条目
- **WHEN** 逐条经过 resolveDetailRenderer 解析
- **THEN** 每条命中的渲染项与迁移前 if/else 分支结果一致（golden 对照）

#### Scenario: 插件声明式扩展类型反应

- **GIVEN** 一个插件在 manifest 声明 detail-renderer 插槽项，match 为 extensions: [".yaml"]
- **WHEN** 用户打开扩展名为 .yaml 的文件类条目详情页
- **THEN** 该条目由插件声明的白名单组件渲染（如 readonly-text）
- **AND** 插件无法注入自定义 DOM、自定义组件或 matcher 函数

#### Scenario: 插件渲染项不可覆盖图片

- **GIVEN** 插件声明的 detail-renderer 匹配规则试图覆盖 image 类型
- **WHEN** 运行时合并插件渲染项与内置渲染项
- **THEN** image 类型仍由宿主内置渲染项渲染

### Requirement: 标签四源分层与来源记录

详情页标签 SHALL 按 heuristic（采集启发式）、manual（人工）、ai（AI 建议）、plugin（插件）四源分层展示，来源记录写入 clips.metadata_json.tags_provenance（additive 字段，不改表结构），无记录的存量 tag 按 heuristic 展示。

#### Scenario: 标签来源可视化

- **GIVEN** 一条条目的 tags 含人工、AI、插件三种来源记录
- **WHEN** 用户查看 meta 单行的 tag chips
- **THEN** 每个 chip 以来源色点区分，悬停显示来源与时间
- **AND** 点按 tag 仍触发按标签搜索

#### Scenario: 人工标签权威替换

- **GIVEN** 用户在详情页 tag 行内联编辑中删除并新增标签后保存
- **WHEN** 前端组装完整 tags 数组提交
- **THEN** update_clip_record 按整体替换协议写入，被保留 tag 的既有来源记录不丢失
- **AND** 新增 tag 的来源记录为 manual

#### Scenario: 插件标签只追加

- **GIVEN** 插件通过 tag 规则（manifest.config）在采集后事件中打标
- **WHEN** 运行时执行插件写回
- **THEN** 插件只能追加新 tag（来源记录 actor 为该插件 id）
- **AND** 插件删除或改名非自己写入的 tag 被运行时拒绝

### Requirement: 内置标签规则治理

设置页 SHALL 提供内置标签规则显式开关列表，并支持自定义规则读写 settings.tag_rules；Rust 采集端 #多行 tag 规则 SHALL 被删除。

#### Scenario: #多行规则删除

- **GIVEN** 采集端 default_tags 处理多行文本
- **WHEN** 文本含 # 开头 token
- **THEN** 不再因「多行文本」条件额外打标（该规则分支已删除）

#### Scenario: 自定义规则 Agent 写入

- **GIVEN** Agent 通过 MCP 设置工具请求写入 tag_rules
- **WHEN** 写入请求通过校验
- **THEN** settings.tag_rules 更新且采集端读合并后的规则集生效

### Requirement: 顶部操作区与动效

crumb SHALL 收敛为返回、标题、上一条/下一条与溢出菜单；切条目、菜单、三态切换、popover、弹窗的过渡 SHALL 可打断且在 prefers-reduced-motion 下退化为 crossfade。

#### Scenario: 方向感知切换条目

- **GIVEN** 用户在详情页按键盘触发下一条
- **WHEN** 切换发生
- **THEN** 内容以 translateY -6px + fade 约 140ms 过渡，上一条方向相反
- **AND** 动画进行中再次切换立即生效（可打断）

#### Scenario: reduced-motion 退化

- **GIVEN** 系统开启减少动态效果
- **WHEN** 用户触发切条目、三态切换、popover、弹窗
- **THEN** 所有位移/缩放过渡退化为纯透明度过渡

### Requirement: 详情页插件插槽落位

详情页 SHALL 预留 detail-action（底部动作区按钮，match 按类型出动作）与 detail-section（内容尾部受控区块）两个插槽落位，空注册时零 DOM 零开销；插槽契约归 agent-plugin-runtime 提案维护。

#### Scenario: 空注册零开销

- **GIVEN** 未安装任何声明详情页插槽的插件
- **WHEN** 详情页渲染
- **THEN** detail-action 与 detail-section 占位不产生 DOM 节点
- **AND** 内容首帧渲染不被插件加载阻塞

#### Scenario: 插槽项超限折叠

- **GIVEN** 已注册 detail-action 插槽项超过 3 个
- **WHEN** 底部动作区渲染
- **THEN** 插槽项折叠为「扩展 (N)」单一入口，展开后可见全部
