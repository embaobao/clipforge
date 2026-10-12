# detail-workspace Delta：详情页信息架构、类型渲染管线与插件化

## ADDED Requirements

### Requirement: 内容优先层序

详情页 SHALL 按「crumb → meta 单行 → 内容主体 → detail-section 插件占位 → 底部动作区」五区编排，内容主体占视口高度 ≥70%。

#### Scenario: 打开详情页即见内容

- **GIVEN** 用户在主窗口打开任意类型剪贴板条目详情页
- **WHEN** 详情页渲染完成
- **THEN** 元信息压缩为单行 chip 行（类型 + 来源应用 + tags）
- **AND** AI 分析不再常驻内容上方，其入口位于底部动作区
- **AND** 内容主体在 720×600 主窗口下占视口高度 ≥70%

#### Scenario: 低频信息收纳进溢出菜单

- **GIVEN** 详情页展示一条带来源地址与应用上下文的条目
- **WHEN** 用户查看 crumb 层
- **THEN** 来源地址、应用上下文、采集上下文 JSON 入口收纳于溢出菜单
- **AND** 详情页主体不渲染独立的地址行、应用上下文行与采集上下文折叠区

### Requirement: 底部动作区

详情页 SHALL 提供底部 sticky 动作区，集中复制（主钮）、粘贴、编辑、AI 分析触发钮与 detail-action 插件按钮占位。

#### Scenario: 高频动作集中于底部

- **GIVEN** 用户在详情页需要复制当前条目
- **WHEN** 用户查看底部动作区
- **THEN** 复制以主钮形态（bg-primary）呈现于动作区首位
- **AND** 粘贴、编辑、AI 分析触发钮位于同一动作区
- **AND** AI 结果面板自底部滑入，动画可打断且进出同路径

#### Scenario: 复制成功反馈

- **GIVEN** 用户点击底部动作区复制主钮
- **WHEN** 剪贴板写入完成
- **THEN** 主钮短暂呈现 success 状态（色 + icon 置换约 600ms）
- **AND** 系统开启 prefers-reduced-motion 时仅保留 icon 置换

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

### Requirement: 顶部操作区与动效

crumb SHALL 收敛为返回、标题、上一条/下一条与溢出菜单；切条目、菜单、底部面板、tag 编辑展开的过渡 SHALL 可打断且在 prefers-reduced-motion 下退化为 crossfade。

#### Scenario: 方向感知切换条目

- **GIVEN** 用户在详情页按键盘触发下一条
- **WHEN** 切换发生
- **THEN** 内容以 translateY -6px + fade 约 140ms 过渡，上一条方向相反
- **AND** 动画进行中再次切换立即生效（可打断）

#### Scenario: reduced-motion 退化

- **GIVEN** 系统开启减少动态效果
- **WHEN** 用户触发切条目、AI 面板滑入、菜单展开
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
