# 详情页布局示意（720×600 主窗口 · 新旧对照）

> 框架不变：Tauri 主窗口 + workspace-router 内部路由，只重排内容编排与显示优先级。提案：`openspec/changes/detail-page-information-architecture/`。

## 新布局：内容优先 + 底部动作区 + 插件插槽预留

```svg
<svg viewBox="0 0 760 640" xmlns="http://www.w3.org/2000/svg" font-family="-apple-system, system-ui, sans-serif">
  <defs>
    <marker id="arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
      <path d="M0 0 L8 4 L0 8 z" fill="var(--muted)"/>
    </marker>
  </defs>

  <!-- 新方案面板 -->
  <text x="20" y="26" font-size="13" font-weight="600" fill="var(--fg)">新布局：打开即见内容（首屏占比 ~70%）</text>

  <g transform="translate(20 40)">
    <!-- 面板外框 -->
    <rect x="0" y="0" width="440" height="560" rx="10" fill="var(--surface)" stroke="var(--border)"/>

    <!-- ① Crumb 层 36px -->
    <rect x="1" y="1" width="438" height="35" rx="9" fill="none"/>
    <text x="16" y="24" font-size="12" fill="var(--muted)">← 详情 · 文本</text>
    <circle cx="380" cy="19" r="9" fill="none" stroke="var(--border)"/>
    <path d="M376 16 L384 16 M380 16 L380 22 M376.5 24.5 L380 22 L383.5 24.5" stroke="var(--muted)" stroke-width="1" fill="none"/>
    <circle cx="406" cy="19" r="9" fill="none" stroke="var(--border)"/>
    <path d="M402 22 L406 16 L410 22" stroke="var(--muted)" stroke-width="1" fill="none"/>
    <circle cx="424" cy="19" r="9" fill="none" stroke="var(--border)"/>
    <path d="M421 22 h6 M424 19.5 v-3 M422.5 15.5 a1.5 1.5 0 1 1 3 0" stroke="var(--muted)" stroke-width="1" fill="none"/>

    <!-- ② Meta 单行 28px -->
    <rect x="12" y="44" width="416" height="24" rx="12" fill="none" stroke="var(--border)"/>
    <rect x="18" y="48" width="34" height="16" rx="8" fill="var(--accent)" opacity="0.14"/>
    <text x="24" y="60" font-size="9" fill="var(--accent)">文本</text>
    <rect x="58" y="48" width="42" height="16" rx="8" fill="none" stroke="var(--border)"/>
    <text x="64" y="60" font-size="9" fill="var(--muted)">Safari</text>
    <text x="108" y="60" font-size="9" fill="var(--muted)">#链接  #工作  #Markdown  #多行</text>
    <path d="M414 52 l6 4 -6 4" stroke="var(--muted)" fill="none" stroke-width="1"/>
    <text x="16" y="82" font-size="8" fill="var(--muted)">tags 全量横向滚动 · 点击=搜索 · 来源地址/应用上下文收进溢出菜单</text>

    <!-- ③ 内容主体 -->
    <rect x="12" y="94" width="416" height="360" rx="8" fill="none" stroke="var(--success)" stroke-dasharray="4 3" stroke-width="1.2"/>
    <text x="24" y="118" font-size="11" font-weight="600" fill="var(--success)">P0 内容预览 · flex-1 占满</text>
    <text x="24" y="138" font-size="10" fill="var(--muted)">文本/图片/JSON/Markdown/HTML/链接 → 现有 DetailPreview 不动</text>
    <line x1="24" y1="152" x2="290" y2="152" stroke="var(--border)"/>
    <text x="24" y="172" font-size="10" fill="var(--muted)">· 渲染后 / 原内容 tabs（Markdown 保持现状）</text>
    <text x="24" y="190" font-size="10" fill="var(--muted)">· 智能格式面板（命令/JSON/多行）保持现状</text>

    <!-- 内容区尾部的链接 chips -->
    <rect x="24" y="400" width="120" height="18" rx="6" fill="none" stroke="var(--border)"/>
    <text x="34" y="412" font-size="9" fill="var(--muted)">🔗 github.com/x…</text>
    <rect x="150" y="400" width="100" height="18" rx="6" fill="none" stroke="var(--border)"/>
    <text x="160" y="412" font-size="9" fill="var(--muted)">🔗 pi.dev…</text>
    <text x="24" y="438" font-size="8" fill="var(--muted)">链接 chips 并入内容区尾部（原独立底部区）</text>

    <!-- ④ 插件扩展区（预留） -->
    <rect x="12" y="462" width="416" height="0" fill="none"/>
    <text x="16" y="466" font-size="8" fill="var(--warning)">▸ detail-section 插槽（空时不占高度）</text>

    <!-- ⑤ 底部动作区 40px sticky -->
    <rect x="1" y="519" width="438" height="40" rx="0" fill="none" stroke="var(--accent)" stroke-width="1.2"/>
    <rect x="12" y="527" width="64" height="24" rx="7" fill="var(--accent)"/>
    <text x="24" y="543" font-size="10" fill="var(--surface)" font-weight="600">复制</text>
    <rect x="84" y="527" width="40" height="24" rx="7" fill="none" stroke="var(--border)"/>
    <text x="93" y="543" font-size="10" fill="var(--fg)">粘贴</text>
    <rect x="132" y="527" width="40" height="24" rx="7" fill="none" stroke="var(--border)"/>
    <text x="141" y="543" font-size="10" fill="var(--fg)">编辑</text>
    <rect x="180" y="527" width="64" height="24" rx="7" fill="none" stroke="var(--border)"/>
    <text x="189" y="543" font-size="10" fill="var(--muted)">AI 分析</text>
    <circle cx="342" cy="539" r="10" fill="none" stroke="var(--warning)" stroke-dasharray="2 2"/>
    <text x="330" y="570" font-size="8" fill="var(--warning)">detail-action</text>
    <text x="338" y="542" font-size="10" fill="var(--warning)">+ ⊕</text>
    <circle cx="374" cy="539" r="9" fill="none" stroke="var(--border)"/>
    <path d="M371 542 h6 M374 539 v-3 M371.5 535 a2.5 2.5 0 1 1 5 0" stroke="var(--muted)" stroke-width="1" fill="none"/>
    <circle cx="398" cy="539" r="9" fill="none" stroke="var(--border)"/>
    <circle cx="398" cy="536" r="1" fill="var(--muted)"/>
    <path d="M394 541 a4 4 0 0 1 8 0" stroke="var(--muted)" stroke-width="1" fill="none"/>

    <!-- AI 结果面板（滑入态示意） -->
    <rect x="12" y="446" width="416" height="66" rx="8" fill="var(--surface)" stroke="var(--accent)" stroke-dasharray="3 2" opacity="0.9"/>
    <text x="24" y="464" font-size="9" fill="var(--muted)">AI 摘要 · 底部滑入（damping 1.0, 可打断, 进出同路径）</text>
    <text x="24" y="480" font-size="10" fill="var(--fg)">这是一段剪贴板内容的 AI 摘要……</text>
    <rect x="24" y="488" width="48" height="16" rx="6" fill="none" stroke="var(--border)"/>
    <text x="31" y="500" font-size="9" fill="var(--muted)">#建议</text>
    <rect x="78" y="488" width="48" height="16" rx="6" fill="none" stroke="var(--border)"/>
    <text x="85" y="500" font-size="9" fill="var(--muted)">#标签</text>
    <text x="134" y="500" font-size="9" fill="var(--accent)">应用标签</text>
  </g>

  <!-- 层级标注 -->
  <g transform="translate(478 46)" font-size="10">
    <text y="10" fill="var(--muted)" font-weight="600">显示优先级</text>
    <text y="34" fill="var(--success)">P0 内容本体（每次访问）</text>
    <text y="54" fill="var(--success)">P0 复制/粘贴（高频动作）</text>
    <text y="74" fill="var(--fg)">P1 元信息+标签（扫一眼）</text>
    <text y="94" fill="var(--fg)">P2 链接/JSON（低频查阅）</text>
    <text y="114" fill="var(--muted)">P3 AI 分析（显式动作）</text>
    <text y="134" fill="var(--warning)">预留 插件插槽（二期）</text>

    <line x1="0" y1="158" x2="230" y2="158" stroke="var(--border)"/>

    <text y="182" fill="var(--muted)" font-weight="600">现状 → 新方案的变化</text>
    <text y="204" fill="var(--fg)">AI 条：内容上方 → 底部触发</text>
    <text y="224" fill="var(--fg)">元信息：3 行 → 1 行 chip</text>
    <text y="244" fill="var(--fg)">tags：3 个截断 → 全量横滚</text>
    <text y="264" fill="var(--fg)">内容占比：~55% → ~70%</text>
    <text y="284" fill="var(--fg)">复制：藏在 meta 行 → 主钮</text>
    <text y="304" fill="var(--fg)">采集上下文：折叠区 → 溢出菜单</text>

    <line x1="0" y1="328" x2="230" y2="328" stroke="var(--border)"/>
    <text y="352" fill="var(--muted)" font-weight="600">插件插槽（预留落位）</text>
    <text y="374" fill="var(--warning)">detail-action</text>
    <text y="390" fill="var(--muted)">底部动作区右段按钮</text>
    <text x="0" y="414" fill="var(--warning)">detail-section</text>
    <text y="430" fill="var(--muted)">内容尾部受控渲染区</text>
    <text y="452" fill="var(--muted)">契约归 agent-plugin-runtime</text>
    <text y="470" fill="var(--muted)">空注册零 DOM 零开销</text>
    <text y="492" fill="var(--muted)">超过 3 个折叠为「扩展(N)」</text>
  </g>

  <!-- 箭头：新方案指向旧方案对照 -->
  <text x="20" y="626" font-size="10" fill="var(--muted)">框架不变：路由 / 面包屑 / 预览组件 / 编辑器全部复用，只重排层序与收纳低频层。</text>
</svg>
```

## 旧布局回顾（对照，问题标注）

```svg
<svg viewBox="0 0 460 560" xmlns="http://www.w3.org/2000/svg" font-family="-apple-system, system-ui, sans-serif">
  <text x="20" y="26" font-size="13" font-weight="600" fill="var(--fg)">现状：内容被压到第三屏（~55%）</text>
  <g transform="translate(20 40)">
    <rect x="0" y="0" width="420" height="510" rx="10" fill="var(--surface)" stroke="var(--border)"/>

    <text x="16" y="24" font-size="11" fill="var(--muted)">← 详情 · 文本　[prev][next][edit][⋮]</text>
    <rect x="0" y="34" width="420" height="1" fill="var(--border)"/>

    <!-- PiAnalysisBar -->
    <rect x="12" y="44" width="396" height="30" rx="6" fill="none" stroke="var(--error)" stroke-dasharray="3 2"/>
    <text x="22" y="63" font-size="10" fill="var(--error)">AI 分析按钮（低频却占黄金位）</text>
    <rect x="12" y="80" width="396" height="66" rx="6" fill="none" stroke="var(--error)" stroke-dasharray="3 2"/>
    <text x="22" y="98" font-size="9" fill="var(--error)">分析结果卡 + 最近 3 条历史（常驻）</text>
    <text x="22" y="114" font-size="9" fill="var(--muted)">摘要摘要摘要……</text>
    <text x="22" y="130" font-size="9" fill="var(--muted)">10:24 摘要 / 09:11 摘要 / 08:03 摘要</text>

    <!-- DetailMeta 三行 -->
    <rect x="12" y="154" width="396" height="24" rx="6" fill="none" stroke="var(--error)" stroke-dasharray="3 2"/>
    <text x="22" y="170" font-size="9" fill="var(--muted)">[文本][Safari]　　　#a #b #c +2（截断）</text>
    <rect x="12" y="184" width="396" height="24" rx="6" fill="none" stroke="var(--error)" stroke-dasharray="3 2"/>
    <text x="22" y="200" font-size="9" fill="var(--muted)">🔗 safari://…　[复制][纯文本][复制地址]</text>
    <rect x="12" y="214" width="396" height="18" rx="6" fill="none" stroke="var(--error)" stroke-dasharray="3 2"/>
    <text x="22" y="227" font-size="9" fill="var(--muted)">▦ App 上下文摘要行</text>

    <!-- 内容 -->
    <rect x="12" y="240" width="396" height="170" rx="8" fill="none" stroke="var(--fg)" stroke-dasharray="4 3"/>
    <text x="22" y="264" font-size="10" fill="var(--fg)">内容预览（第四层才开始，高度被压）</text>

    <!-- 链接 -->
    <rect x="12" y="418" width="396" height="30" rx="6" fill="none" stroke="var(--border)"/>
    <text x="22" y="437" font-size="9" fill="var(--muted)">链接 (2)：[chip][chip]（与内容割裂）</text>

    <!-- 采集上下文 -->
    <rect x="12" y="454" width="396" height="26" rx="6" fill="none" stroke="var(--border)"/>
    <text x="22" y="471" font-size="9" fill="var(--muted)">▸ 采集上下文 (14 字段)</text>
  </g>
  <text x="20" y="572" font-size="10" fill="var(--error)">红色虚线 = 挡在内容前面的层，全部需要收纳或降位。</text>
</svg>
```

## 确认点

1. **层序**：crumb → meta 单行 → 内容（占满）→ 插件区（预留）→ 底部动作区。复制/粘贴/编辑/AI 分析收进底部 sticky 动作区，OK？
2. **AI 分析**：从内容上方移到底部动作区触发，结果面板底部滑入（可打断）。还是你想保留常驻入口？
3. **元信息收纳**：来源地址/应用上下文/采集上下文全进溢出菜单（⋮），meta 只留 类型 + 来源 app + tags。
4. **插件插槽**：`detail-action`（底部按钮）+ `detail-section`（内容尾部受控渲染区）两个落位，契约归 agent-plugin-runtime。
