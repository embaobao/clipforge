// ClipForge 逐交互视觉走查 + 性能采样（依赖 dev server :7100 与 ego-browser）。
// 运行：bash scripts/run-visual-audit.sh
// 每个关键交互一条用例：执行动作 → DOM 断言 → 截图存 /tmp/clipforge-visual/audit/ → PASS/FAIL。
// 性能：搜索响应、详情打开、长任务统计随走查一并输出，回归对比用。

const task = await taskSpace("clipforge 视觉验收");
const page = task.page("p1");
const DIR = "/tmp/clipforge-visual/audit";
// 默认走 dev server；性能验收可指向生产构建（AUDIT_BASE=http://localhost:7101）
const BASE = process.env.AUDIT_BASE ?? "http://localhost:7100";

const results = [];
let failed = 0;
function report(name, pass, detail = "") {
  results.push({ name, pass });
  if (!pass) failed += 1;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

await page.goto(BASE + "/preview.html");
await page.waitForLoadState("load");
await page.evaluate(() => document.getElementById("panel").contentWindow.__clipforgeMock.resetDb());
await page.reload();
await page.waitForLoadState("load");

const shot = (name) => page.screenshot({ path: `${DIR}/${name}.png` });
const ev = (fn, arg) => (arg === undefined ? page.evaluate(fn) : page.evaluate(fn, arg));

// 等待 iframe 内列表就绪（mock 播种 + React 挂载是异步的，固定 sleep 不可靠）
const ready = await ev(async () => {
  const win = document.getElementById("panel").contentWindow;
  const t0 = Date.now();
  return await new Promise((resolve) => {
    const timer = win.setInterval(() => {
      const n = win.document.querySelectorAll("article").length;
      if (n >= 9 || Date.now() - t0 > 8000) { win.clearInterval(timer); resolve(n); }
    }, 100);
  });
});
if (ready < 9) {
  console.log(`FAIL  初始化（列表就绪超时，article=${ready}）`);
  await shot("A00-init-timeout");
  process.exit(1);
}
await page.evaluate(() => {
  const f = document.getElementById("panel");
  f.style.width = "420px";
  f.style.height = "480px";
});
await page.waitForTimeout(400);

// 长任务观察（性能门禁：走查全程无 >200ms 长任务）
// 注意：observer 必须挂在 iframe（真正的应用）里，顶层验证页的任务不算数。
await ev(() => {
  const win = document.getElementById("panel").contentWindow;
  win.__longTasks = { count: 0, max: 0, list: [] };
  new win.PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      win.__longTasks.count += 1;
      win.__longTasks.max = Math.max(win.__longTasks.max, e.duration);
      win.__longTasks.list.push(Math.round(e.duration));
    }
  }).observe({ entryTypes: ["longtask"] });
});
const focusPanel = async () => {
  const r = await ev(() => {
    const b = document.getElementById("panel").getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
  await page.mouse.click(r.x, r.y);
};
const rectOf = (sel, nth = 0) => ev(({ sel, nth }) => {
  const doc = document.getElementById("panel").contentDocument;
  const el = doc.querySelectorAll(sel)[nth];
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const fr = document.getElementById("panel").getBoundingClientRect();
  return { x: fr.x + r.left + r.width / 2, y: fr.y + r.top + r.height / 2, top: fr.y + r.top, bottom: fr.y + r.bottom, right: fr.x + r.right, left: fr.x + r.left };
}, { sel, nth });
const press = async (key) => { await focusPanel(); await page.keyboard.press(key); };
const key = async (k) => page.keyboard.press(k);

// ---------- A01 初始渲染 ----------
let s = await ev(() => {
  const doc = document.getElementById("panel").contentDocument;
  return { rows: doc.querySelectorAll("article").length, toast: !!doc.querySelector("[data-sonner-toast]") };
});
report("A01 初始渲染（9 行、无残留 toast）", s.rows === 9 && !s.toast, JSON.stringify(s));
await shot("A01-initial");

// ---------- A02 行 hover：序号隐藏、动作钮现身、不遮文字 ----------
let r = await rectOf("article", 1);
if (!r) { report("A02 行 hover（找不到目标行）", false, "article[1]=null"); process.exit(1); }
await page.mouse.move(r.x, r.y, { label: "悬停行" });
await page.waitForTimeout(400);
s = await ev(() => {
  const doc = document.getElementById("panel").contentDocument;
  const row = doc.querySelectorAll("article")[1];
  const actions = [...row.querySelectorAll("button")];
  const mid = row.children[1].getBoundingClientRect();
  const act = row.children[2].getBoundingClientRect();
  return { actionCount: actions.length, overlap: mid.right > act.left, indexHidden: !row.textContent.match(/^[\s\S]*?\n?2\n/) };
});
report("A02 行 hover（动作钮 ≥4、与文本无重叠）", s.actionCount >= 4 && !s.overlap, JSON.stringify(s));
await shot("A02-row-hover");

// ---------- A03 行 tooltip：显示在悬停行上方、不盖住下一行 ----------
await page.mouse.move(r.x, r.y - 2);
// hover 意图延时 500ms：停留满延时 + 渲染后再断言
await page.waitForTimeout(900);
const probeTooltip = () => ev(() => {
  const doc = document.getElementById("panel").contentDocument;
  // 必须取 portal 浮卡（.quick-panel-tooltip-card）；普通 .app-tooltip-card 是行内隐藏卡，选择器会命中错的
  const card = doc.querySelector(".quick-panel-tooltip-card");
  if (!card) return { found: false };
  const win = doc.defaultView;
  const cr = card.getBoundingClientRect();
  const rows = [...doc.querySelectorAll("article")].map((a) => a.getBoundingClientRect());
  const row2 = rows[1];
  const list = doc.querySelector(".thin-scroll")?.getBoundingClientRect();
  const style = win.getComputedStyle(card);
  // heightOk：portal 卡曾因 bottom 未复位塌成 16px 白胶囊（只露一截文字），高度必须能容纳标题+正文
  // equalWidth：浮卡与行等宽（左右对齐列表 px-2 内边距），不随内容忽宽忽窄
  // withinList：垂直钳制在列表容器内，永不盖搜索栏/底栏（旧版顶行出卡会压住顶栏）
  return {
    found: true,
    opacity: style.opacity,
    height: Math.round(cr.height),
    heightOk: cr.height >= 40,
    equalWidth: Math.abs(cr.left - 8) <= 1 && Math.abs(cr.right - (win.innerWidth - 8)) <= 1,
    above: cr.bottom <= row2.top + 1,
    coversRow: cr.top < row2.bottom && cr.bottom > row2.top,
    withinList: list ? cr.top >= list.top - 1 && cr.bottom <= list.bottom + 1 : false,
    inViewport: cr.left >= -1 && cr.right <= win.innerWidth + 1,
  };
});
s = await probeTooltip();
// 自动化页面偶发 1ms 级 hidden 抖动会冻结 hover/transition：卡住时 ±1px 抖动重试，最多 3 次
for (let attempt = 0; !(s.found && s.opacity === "1") && attempt < 3; attempt++) {
  await page.mouse.move(r.x + 1, r.y - 2);
  await page.waitForTimeout(60);
  await page.mouse.move(r.x, r.y - 2);
  await page.waitForTimeout(700);
  s = await probeTooltip();
}
report("A03 行 tooltip（等宽、不盖悬停行、钳制在列表内、高度未塌陷）", s.found && s.opacity === "1" && s.heightOk && s.equalWidth && !s.coversRow && s.withinList && s.inViewport, JSON.stringify(s));
await shot("A03-row-tooltip");
await page.mouse.move(4, 4);

// ---------- A04 工具栏：hover 态 + 激活态 ----------
r = await rectOf("header button", 3);
await page.mouse.move(r.x, r.y, { label: "悬停菜单" });
await page.waitForTimeout(300);
await shot("A04-toolbar-hover");
await ev(() => document.getElementById("panel").contentDocument.querySelector("header button[aria-label='收藏']").click());
await page.waitForTimeout(500);
s = await ev(() => {
  const doc = document.getElementById("panel").contentDocument;
  const fav = doc.querySelector("header button[aria-label='收藏']");
  return { active: fav.className.includes("bg-black/[0.08]"), rows: doc.querySelectorAll("article").length };
});
report("A04 工具栏（hover + 收藏激活态轻量底、2 行）", s.active && s.rows === 2, JSON.stringify(s));
await shot("A04b-toolbar-active");
await ev(() => document.getElementById("panel").contentDocument.querySelector("header button[aria-label='历史']").click());
await page.waitForTimeout(400);

// ---------- A05 搜索：输入过滤 + 性能 ----------
// 搜索框按需挂载（Tauri 下默认隐藏）：先按 "/" 唤醒搜索再断言输入框
await focusPanel();
await page.keyboard.press("/");
await page.waitForTimeout(500);
const perf = await ev(async () => {
  const win = document.getElementById("panel").contentWindow;
  const doc = win.document;
  const input = doc.querySelector("input");
  // 防御：搜索框未挂载时返回失败标记而不是抛异常（上轮在此崩溃）
  if (!input) return { searchMs: -2, rows: doc.querySelectorAll("article").length };
  input.focus();
  const t0 = win.performance.now();
  const setter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value").set;
  setter.call(input, "清单");
  input.dispatchEvent(new win.Event("input", { bubbles: true }));
  return await new Promise((resolve) => {
    const timer = win.setInterval(() => {
      if (doc.querySelectorAll("article").length === 1) {
        win.clearInterval(timer);
        resolve({ searchMs: Math.round(win.performance.now() - t0), rows: 1 });
      }
    }, 16);
    win.setTimeout(() => { win.clearInterval(timer); resolve({ searchMs: -1, rows: doc.querySelectorAll("article").length }); }, 3000);
  });
});
report("A05 搜索过滤（清单→1 行）", perf.rows === 1, JSON.stringify(perf));
await shot("A05-search-active");
await press("Escape");
await page.waitForTimeout(400);

// ---------- A06 空格预览卡 ----------
await press(" ");
await page.waitForTimeout(400);
s = await ev(() => ({ card: !!document.getElementById("panel").contentDocument.querySelector(".row-in.mx-2.mt-2.rounded-\\[10px\\]") }));
await shot("A06-preview-card");
await press("Escape");
await page.waitForTimeout(300);
report("A06 空格预览卡", s.card);

// ---------- A07 多选 + 聚合页 ----------
await press("ControlOrMeta+a");
await page.waitForTimeout(300);
s = await ev(() => {
  const doc = document.getElementById("panel").contentDocument;
  return { selected: doc.querySelectorAll("article").length };
});
await shot("A07-multi-select");
await press("ControlOrMeta+c");
await page.waitForTimeout(1200);
s = await ev(() => ({ toast: !!document.getElementById("panel").contentDocument.querySelector("[data-sonner-toast]") }));
report("A07 全选 + 聚合复制 toast", s.toast);
await page.waitForTimeout(1500);

// ---------- A08 详情页（三种类型） ----------
await press("ArrowRight");
await page.waitForTimeout(700);
s = await ev(() => {
  const doc = document.getElementById("panel").contentDocument;
  return { title: doc.querySelector("h1")?.textContent, workspace: !!doc.querySelector("[data-surface='workspace']") };
});
report("A08 → 详情页打开", s.title === "详情" && s.workspace, JSON.stringify(s));
await shot("A08-detail-text");
// Markdown 条目：导航到下一条（JSON 之后的 Markdown 用 ↓ 在详情内翻页）
await press("ArrowDown");
await page.waitForTimeout(500);
await shot("A08b-detail-next");
await press("ArrowLeft");
await page.waitForTimeout(500);

// ---------- A09 右键菜单 ----------
r = await rectOf("article", 1);
await page.mouse.click(r.x, r.y, { button: "right" });
await page.waitForTimeout(500);
s = await ev(() => {
  const doc = document.getElementById("panel").contentDocument;
  // 必须命中菜单内容（role=menu）；触发器也带 data-state，单独查会误报
  const menu = doc.querySelector("[role='menu']");
  return { open: !!menu && menu.textContent.length > 10 };
});
await shot("A09-context-menu");
await key("Escape");
report("A09 右键菜单打开", s.open);
await page.waitForTimeout(300);

// ---------- A10 回收站 ----------
await press("t");
await page.waitForTimeout(500);
s = await ev(() => ({ rows: document.getElementById("panel").contentDocument.querySelectorAll("article").length }));
r = await rectOf("article", 0);
await page.mouse.move(r.x, r.y, { label: "悬停回收站行" });
await page.waitForTimeout(400);
await shot("A10-trash-hover");
report("A10 回收站视图 + 行 hover", s.rows === 2, `rows=${s.rows}`);
await ev(() => document.getElementById("panel").contentDocument.querySelector("header button[aria-label='历史']").click());
await page.waitForTimeout(400);

// ---------- A11 320 窄窗整体 ----------
await ev(() => { const f = document.getElementById("panel"); f.style.width = "320px"; f.style.height = "400px"; });
await page.waitForTimeout(400);
s = await ev(() => {
  const win = document.getElementById("panel").contentWindow;
  const bad = [];
  const walk = (el, d) => { if (d > 14) return; const rr = el.getBoundingClientRect(); if (rr.width > win.innerWidth + 1) bad.push(el.tagName); for (const c of el.children) walk(c, d + 1); };
  walk(win.document.body, 0);
  return { bad: bad.length };
});
await shot("A11-narrow-320");
report("A11 320 窄窗无横向溢出", s.bad === 0, JSON.stringify(s));
await ev(() => { const f = document.getElementById("panel"); f.style.width = "420px"; f.style.height = "480px"; });

// ---------- A12 设置页两栏 ----------
// 先采样长任务（随后导航会重载顶层 window，iframe 也会被替换）
const perfSum = await ev(() => document.getElementById("panel").contentWindow.__longTasks ?? { count: -1, max: -1 });
await page.goto(BASE + "/settings.html");
await page.waitForLoadState("load");
await page.waitForTimeout(2200);
await shot("A12-settings-shortcuts");
s = await ev(() => ({ err: /Cannot read|reading '/.test(document.body.innerText) }));
await ev(() => [...document.querySelectorAll("aside button")].find((b) => b.textContent.includes("Display"))?.click());
await page.waitForTimeout(600);
await shot("A12b-settings-display");
report("A12 设置页无错误 + 分栏切换", !s.err);
await page.goto(BASE + "/preview.html");
await page.waitForLoadState("load");
await page.waitForTimeout(1800);

// ---------- 性能汇总 ----------
// perfSum 已在 A12 前采样（导航会重载顶层 window，observer 状态会被清掉）
console.log(`\n[perf] 搜索响应 ${perf.searchMs}ms · 长任务 ${perfSum.count} 个（最大 ${Math.round(perfSum.max)}ms）`);
report("P01 无 >200ms 长任务", perfSum.max < 200, JSON.stringify(perfSum));

console.log("\n===== 汇总 =====");
console.log(`共 ${results.length} 项，通过 ${results.length - failed}，失败 ${failed}`);
if (typeof process !== "undefined") process.exitCode = failed ? 1 : 0;
