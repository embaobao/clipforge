import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const catalogPath = path.join(root, "release-assets", "clipforge-feature-catalog.json");
const bannerPath = path.join(root, "assets", "brand", "clipforge-banner.png");
const outPath = path.join(root, "release-assets", "CLIPFORGE_MUST_READ.html");

const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
const banner = fs.readFileSync(bannerPath).toString("base64");

function esc(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function featureTiles() {
  return catalog.features
    .map(
      (item) => `<div class="tile"><h3>${esc(item.title)}</h3><p>${esc(item.description)}</p></div>`,
    )
    .join("\n");
}

function shortcutLine() {
  return catalog.shortcuts
    .map((parts) => {
      const label = parts[parts.length - 1];
      const keys = parts.slice(0, -1).map((key) => `<span class="kbd">${esc(key)}</span>`).join("");
      return `<span class="shortcut">${keys}<em>${esc(label)}</em></span>`;
    })
    .join("\n");
}

function mcpRows() {
  return catalog.mcpTools
    .map(
      ([name, description]) =>
        `<div class="status"><span class="badge ok">已暴露</span><span><code>${esc(name)}</code> ${esc(description)}</span></div>`,
    )
    .join("\n");
}

const html = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${esc(catalog.title)}</title>
    <style>
      :root { color-scheme: light; --ink:#171717; --paper:#f7f5ed; --card:#fffdf5; --muted:#5f5a50; --line:#201f1b; --soft:#e8e1d1; --green:#1c7c54; --red:#b91c1c; --yellow:#f6c453; --shadow:rgba(23,23,23,.18); }
      * { box-sizing: border-box; }
      body { margin:0; min-height:100vh; color:var(--ink); font-family:"SF Pro Text","PingFang SC","Noto Sans SC",Arial,sans-serif; background:linear-gradient(90deg,rgba(32,31,27,.04) 1px,transparent 1px),linear-gradient(180deg,rgba(32,31,27,.04) 1px,transparent 1px),#eee8d8; background-size:16px 16px; }
      main { width:min(980px,calc(100vw - 32px)); margin:0 auto; padding:24px 0 48px; }
      .pixel-shell { border:3px solid var(--line); background:var(--paper); box-shadow:8px 8px 0 var(--shadow); }
      .topbar { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:10px 12px; border-bottom:3px solid var(--line); background:#111; color:#fff; font-weight:800; }
      .window-dots { display:flex; gap:7px; flex:0 0 auto; }
      .dot { width:10px; height:10px; border:2px solid #fff; background:var(--yellow); }
      .dot:nth-child(2) { background:var(--green); }
      .dot:nth-child(3) { background:var(--red); }
      .hero { display:grid; grid-template-columns:minmax(0,1.05fr) minmax(280px,.95fr); gap:20px; padding:22px; border-bottom:3px solid var(--line); }
      .banner-frame { border:3px solid var(--line); background:#fff; padding:8px; box-shadow:5px 5px 0 rgba(23,23,23,.16); }
      .banner-frame img { display:block; width:100%; height:auto; }
      .hero-copy { display:flex; flex-direction:column; justify-content:center; }
      .eyebrow { display:inline-flex; width:fit-content; padding:5px 8px; border:2px solid var(--line); background:var(--yellow); font-size:12px; font-weight:900; }
      h1,h2,h3,p { margin:0; }
      h1 { margin-top:12px; font-size:clamp(28px,5vw,52px); line-height:.98; letter-spacing:0; }
      h2 { display:inline-flex; width:fit-content; margin-bottom:12px; padding:5px 8px; border:2px solid var(--line); background:#fff; font-size:17px; line-height:1.2; }
      h3 { margin-bottom:5px; font-size:14px; }
      p,li,.small { color:var(--muted); font-size:14px; line-height:1.65; }
      .lead { margin-top:12px; color:#37332d; font-size:15px; }
      .content { display:grid; grid-template-columns:1fr 1fr; gap:14px; padding:18px; }
      .panel { border:3px solid var(--line); background:var(--card); padding:14px; box-shadow:4px 4px 0 rgba(23,23,23,.12); }
      .panel.full { grid-column:1 / -1; }
      .notice { background:#fff1c7; } .danger { background:#fff1f1; } .ok { background:#eefaf3; }
      .steps { display:grid; gap:8px; margin:0; padding:0; list-style:none; }
      .steps li { display:grid; grid-template-columns:30px 1fr; gap:10px; align-items:start; }
      .num { display:inline-grid; place-items:center; width:28px; height:28px; border:2px solid var(--line); background:#fff; color:var(--ink); font-weight:900; }
      .grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; }
      .tile { min-height:92px; padding:10px; border:2px solid var(--line); background:#fff; }
      .shortcut { display:inline-flex; align-items:center; gap:4px; margin:0 8px 8px 0; }
      .shortcut em { color:var(--muted); font-style:normal; font-size:12px; }
      .kbd { display:inline-flex; align-items:center; justify-content:center; min-width:32px; min-height:24px; padding:2px 7px; border:2px solid var(--line); background:#f6f6f6; box-shadow:2px 2px 0 var(--line); color:var(--ink); font-size:12px; font-weight:900; }
      code,pre { font-family:"SF Mono","JetBrains Mono",Menlo,Consolas,monospace; }
      pre { overflow-x:auto; margin:10px 0 0; padding:12px; border:2px solid var(--line); background:#111; color:#f7f7f7; font-size:13px; line-height:1.55; }
      ul { margin:0; padding-left:18px; }
      .status-list { display:grid; gap:8px; margin-top:4px; }
      .status { display:grid; grid-template-columns:92px 1fr; gap:10px; align-items:start; padding:9px; border:2px solid var(--line); background:#fff; }
      .badge { display:inline-flex; justify-content:center; padding:3px 7px; border:2px solid var(--line); background:var(--soft); color:var(--ink); font-size:12px; font-weight:900; }
      .badge.ok { background:#b7f3cf; }
      .footer { padding:14px 18px 18px; border-top:3px solid var(--line); color:var(--muted); font-size:12px; }
      @media (max-width:820px) { .hero,.content,.grid { grid-template-columns:1fr; } }
    </style>
  </head>
  <body>
    <main>
      <article class="pixel-shell">
        <div class="topbar"><span>ClipForge Beta Test Kit</span><span class="window-dots" aria-hidden="true"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span></div>
        <section class="hero">
          <div class="banner-frame"><img src="data:image/png;base64,${banner}" alt="ClipForge banner" /></div>
          <div class="hero-copy"><span class="eyebrow">安装必读 / READ ME FIRST</span><h1>ClipForge 全功能使用说明</h1><p class="lead">这是内测包。macOS 提示“无法验证开发者”“已损坏”时，通常不是应用真的损坏，而是 Gatekeeper 拦截尚未 Apple 公证的下载应用。请先按本文安装，再开始测试。</p></div>
        </section>
        <div class="content">
          <section class="panel notice"><h2>首次安装</h2><ol class="steps"><li><span class="num">1</span><span>打开 DMG，把 <strong>ClipForge.app</strong> 拖到 <strong>Applications</strong>。</span></li><li><span class="num">2</span><span>在 Applications 里按住 <strong>Control</strong> 点击应用，选择 <strong>打开</strong>。</span></li><li><span class="num">3</span><span>系统弹窗出现后点击 <strong>打开</strong> 或 <strong>仍要打开</strong>。</span></li></ol></section>
          <section class="panel danger"><h2>仍被拦截</h2><p>只移除 ClipForge 的下载隔离属性，不要全局关闭 Gatekeeper。</p><pre><code>xattr -r -d com.apple.quarantine /Applications/ClipForge.app</code></pre></section>
          <section class="panel ok"><h2>首次权限</h2><ul><li><strong>辅助功能权限</strong>：用于悬浮窗贴近当前输入区域、模拟粘贴和快速键入。</li><li><strong>全局快捷键</strong>：用于在任意应用里唤起 ClipForge。</li><li><strong>剪贴板访问</strong>：用于读取历史、写回文本和复制内容。</li></ul></section>
          <section class="panel"><h2>默认快捷键</h2><p>${shortcutLine()}</p></section>
          <section class="panel full"><h2>功能目录</h2><div class="grid">${featureTiles()}</div></section>
          <section class="panel full"><h2>MCP 当前能力状态</h2><div class="status-list">${mcpRows()}</div></section>
          <section class="panel full"><h2>外部快速接入</h2><p>外部 MCP Client 使用下面命令作为 stdio server。应用启动后会自动托管 MCP 服务状态，Agent 可直接使用 clipf.* 工具名。</p><pre><code>/Applications/ClipForge.app/Contents/MacOS/clipforge --mcp

use clipf.list limit=9
use clipf.get id=clip_xxx
use clipf.copy id=clip_xxx</code></pre></section>
          <section class="panel full"><h2>内测检查重点</h2><ul><li>复制内容后，历史是否稳定出现，不漏记、不重复、不把应用自身写回污染为新记录。</li><li>快捷键唤起、数字选择、Control+J、Control+P、Control+F 是否符合预期。</li><li>悬浮窗是否能在全屏、多个显示器、不同输入框位置保持正确显示。</li><li>删除、恢复、清空垃圾箱、收藏保护和自动清理是否符合预期。</li><li>MCP 外部工具调用是否能读取列表、写入历史、写回剪贴板、分析内容和导出数据。</li></ul></section>
          <section class="panel full danger"><h2>不要这样做</h2><p>不建议使用下面的命令全局关闭 macOS 安全机制：</p><pre><code>sudo spctl --master-disable</code></pre><p>请优先使用右键打开，或者只对 <strong>/Applications/ClipForge.app</strong> 移除隔离属性。</p></section>
        </div>
        <footer class="footer">ClipForge 先保证快速剪贴板工具闭环，再扩展搜索、归档、语义检索和 MCP。本文档由 release-assets/clipforge-feature-catalog.json 自动生成，会作为 DMG 内的“0_安装必读_READ_ME_FIRST_ClipForge.html”随包分发。</footer>
      </article>
    </main>
  </body>
</html>
`;

fs.writeFileSync(outPath, html);
console.log(`Generated ${outPath}`);
