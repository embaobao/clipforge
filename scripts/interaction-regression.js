// ClipForge 交互/功能自动化回归（依赖 dev server :7100 与 ego-browser 运行时）。
// 运行：bash scripts/run-interaction-tests.sh
// 每次交付前必须全部 PASS；新增交互缺陷修复时同步增加断言。

const task = await taskSpace("clipforge 视觉验收");
const page = task.page("p1");

const results = [];
let failed = 0;
function report(name, pass, detail = "") {
  results.push({ name, pass, detail });
  if (!pass) failed += 1;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

const PREVIEW = "http://localhost:7100/preview.html";
const SETTINGS = "http://localhost:7100/settings.html";

const setPanel = (w, h) =>
  page.evaluate(({ w, h }) => {
    const iframe = document.getElementById("panel");
    iframe.style.width = `${w}px`;
    iframe.style.height = `${h}px`;
  }, { w, h });

const iframeDoc = () =>
  page.evaluate(() => {
    const win = document.getElementById("panel").contentWindow;
    const doc = win.document;
    const overflow = [];
    const walk = (el, depth) => {
      if (depth > 14) return;
      const r = el.getBoundingClientRect();
      if (r.width > win.innerWidth + 1) {
        overflow.push(`${el.tagName}.${String(el.className).slice(0, 50)}:${Math.round(r.width)}`);
      }
      for (const c of el.children) walk(c, depth + 1);
    };
    walk(doc.body, 0);
    return {
      innerWidth: win.innerWidth,
      rows: doc.querySelectorAll("article").length,
      overflow,
      toast: Boolean(doc.querySelector("[data-sonner-toast]")),
      crumbTitle: doc.querySelector("header h1")?.textContent ?? null,
      previewCard: Boolean(doc.querySelector(".row-in.mx-2.mt-2.rounded-\\[10px\\]")),
      footerStatus: doc.querySelector("footer")?.textContent?.slice(0, 60) ?? "",
      toolbarButtons: [...doc.querySelectorAll("header button")].map((b) => {
        const r = b.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height) };
      }),
      tooltipCard: (() => {
        const card = doc.querySelector(".app-tooltip-card");
        if (!card) return { found: false };
        const r = card.getBoundingClientRect();
        const vis = doc.defaultView.getComputedStyle(card).visibility === "visible";
        // heightOk：portal 卡曾因 bottom 未复位塌成 16px 白胶囊，必须校验内容高度
        // equalWidth：浮卡与行等宽（对齐列表 px-2 内边距），不随内容忽宽忽窄
        return { found: true, visible: vis, height: Math.round(r.height), heightOk: r.height >= 40, equalWidth: Math.abs(r.left - 8) <= 1 && Math.abs(r.right - (win.innerWidth - 8)) <= 1, left: Math.round(r.left), right: Math.round(r.right), inViewport: r.left >= -1 && r.right <= win.innerWidth + 1 };
      })(),
      // 调试：列出全部 tooltip 卡（区分 portal/行内）与环境状态，定位偶发失败用
      tooltipDebug: (() => {
        const dbg = win.__dbgTooltipEvents ?? [];
        return {
          focus: doc.hasFocus(),
          hidden: doc.hidden,
          events: dbg.slice(-6),
          cards: [...doc.querySelectorAll(".app-tooltip-card")].map((c) => {
            const r = c.getBoundingClientRect();
            const cs = doc.defaultView.getComputedStyle(c);
            return { cls: c.className.slice(0, 60), inlineVis: c.style.visibility || null, vis: cs.visibility, h: Math.round(r.height), top: Math.round(r.top), text: (c.textContent ?? "").slice(0, 14) };
          }),
        };
      })(),
    };
  });

const clickInIframe = async (selector, nth = 0) => {
  const rect = await page.evaluate(({ selector, nth }) => {
    const doc = document.getElementById("panel").contentDocument;
    const el = doc.querySelectorAll(selector)[nth];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const fr = document.getElementById("panel").getBoundingClientRect();
    return { x: fr.x + r.left + r.width / 2, y: fr.y + r.top + r.height / 2 };
  }, { selector, nth });
  if (!rect) return false;
  await page.mouse.click(rect.x, rect.y);
  return true;
};

const hoverInIframe = async (selector, nth = 0) => {
  const rect = await page.evaluate(({ selector, nth }) => {
    const doc = document.getElementById("panel").contentDocument;
    const el = doc.querySelectorAll(selector)[nth];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const fr = document.getElementById("panel").getBoundingClientRect();
    return { x: fr.x + r.left + r.width / 2, y: fr.y + r.top + r.height / 2 };
  }, { selector, nth });
  if (!rect) return null;
  await page.mouse.move(rect.x, rect.y);
  return rect;
};

// 环境自愈重试：自动化页面偶发 1ms 级 document.hidden 抖动（ego-lite 窗口被遮挡）会冻结
// hover 命中与 CSS transition。±1px 抖动强制浏览器重新 hit-test，重走 hover 意图延时后再断言。
const rejiggleHover = async (pt) => {
  await page.mouse.move(pt.x + 1, pt.y);
  await page.waitForTimeout(60);
  await page.mouse.move(pt.x, pt.y);
  // 重走意图延时（500ms）+ 渲染余量
  await page.waitForTimeout(700);
};

/** 聚焦 iframe 内面板，后续 keyboard 事件进入 iframe。 */
const focusPanel = async () => {
  const rect = await page.evaluate(() => {
    const r = document.getElementById("panel").getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.click(rect.x, rect.y, { label: "聚焦面板" });
};

// ---------- T1 种子数据加载 ----------
await page.goto(PREVIEW);
await page.waitForLoadState("load");
await page.evaluate(() => document.getElementById("panel").contentWindow.__clipforgeMock.resetDb());
await page.reload();
await page.waitForLoadState("load");
await page.waitForTimeout(2200);
// 在 iframe 里记录 blur/visibilitychange/focus 事件时间线，供 tooltip 偶发失败定位
await page.evaluate(() => {
  const win = document.getElementById("panel").contentWindow;
  win.__dbgTooltipEvents = [];
  const push = (type) => win.__dbgTooltipEvents.push(`${type}@${Math.round(win.performance.now())}`);
  win.addEventListener("blur", () => push("blur"));
  win.addEventListener("focus", () => push("focus"));
  win.document.addEventListener("visibilitychange", () => push(`vis:${win.document.hidden}`));
});
await setPanel(420, 400);
await page.waitForTimeout(400);
let state = await iframeDoc();
report("T1 种子数据加载（历史 9 行）", state.rows === 9, `rows=${state.rows}`);

// ---------- T2 横向溢出：320 / 420 / 480 ----------
let overflowAll = [];
for (const w of [320, 420, 480]) {
  await setPanel(w, 400);
  await page.waitForTimeout(350);
  state = await iframeDoc();
  overflowAll = overflowAll.concat(state.overflow.map((o) => `${w}px:${o}`));
}
report("T2 三档宽度无横向溢出", overflowAll.length === 0, overflowAll.slice(0, 3).join(" | "));
await setPanel(420, 400);

// ---------- T3 ⌘C 复制 → toast 先可见后 1.4s 自动消失 ----------
await focusPanel();
await page.keyboard.press("ArrowDown");
await page.keyboard.press("ControlOrMeta+c");
await page.waitForTimeout(350);
state = await iframeDoc();
const toastVisible = state.toast;
await page.waitForTimeout(2200);
state = await iframeDoc();
report("T3 复制 toast 先可见后自动消失", toastVisible && !state.toast, `visible=${toastVisible} gone=${!state.toast}`);

// ---------- T4 搜索过滤与清除 ----------
await focusPanel();
await page.keyboard.press("/");
await page.waitForTimeout(250);
await page.keyboard.insertText("清单");
await page.waitForTimeout(600);
state = await iframeDoc();
const searchFiltered = state.rows === 1;
await page.keyboard.press("Escape");
await page.waitForTimeout(500);
state = await iframeDoc();
report("T4 搜索过滤（清单→1 行）+ Esc 清除恢复", searchFiltered && state.rows === 9, `filtered=${searchFiltered} restored=${state.rows}`);

// ---------- T5 键盘导航移动选中 ----------
await focusPanel();
const selIdx = () => page.evaluate(() => {
  const doc = document.getElementById("panel").contentDocument;
  return [...doc.querySelectorAll("article")].findIndex((a) => a.className.includes("bg-black/[0.045]"));
});
const selBefore = await selIdx();
await page.keyboard.press("ArrowDown");
await page.waitForTimeout(300);
const selAfter = await selIdx();
report("T5 键盘 ↓ 移动选中行", selAfter === selBefore + 1, `${selBefore} -> ${selAfter}`);

// ---------- T6 空格预览卡开关 ----------
await focusPanel();
await page.keyboard.press(" ");
await page.waitForTimeout(400);
state = await iframeDoc();
const cardOpened = state.previewCard;
await page.keyboard.press("Escape");
await page.waitForTimeout(400);
state = await iframeDoc();
report("T6 空格打开预览卡 + Esc 关闭", cardOpened && !state.previewCard, `opened=${cardOpened} closed=${!state.previewCard}`);

// ---------- T7 Enter 粘贴（状态栏反馈） ----------
await focusPanel();
await page.keyboard.press("Enter");
await page.waitForTimeout(500);
state = await iframeDoc();
report("T7 Enter 粘贴选中条目（状态栏反馈）", /已粘贴|Pasted/.test(state.footerStatus), state.footerStatus);

// ---------- T8 回收站全链路：t 进入 → 点击恢复 → 剩 1 → 回历史 10 ----------
await focusPanel();
await page.keyboard.press("t");
await page.waitForTimeout(500);
state = await iframeDoc();
const trashRows = state.rows;
await clickInIframe("article", 0); // 回收站行点击 = 恢复，停留在回收站视图
await page.waitForTimeout(600);
state = await iframeDoc();
const trashAfterRestore = state.rows;
await clickInIframe("button[aria-label='历史']"); // 顶栏历史按钮回历史视图
await page.waitForTimeout(500);
state = await iframeDoc();
report("T8 回收站 2→恢复 1→历史 10", trashRows === 2 && trashAfterRestore === 1 && state.rows === 10, `trash=${trashRows}->${trashAfterRestore} history=${state.rows}`);

// ---------- T9 收藏视图 ----------
await clickInIframe("button[aria-label='收藏']");
await page.waitForTimeout(500);
state = await iframeDoc();
const favRows = state.rows;
await clickInIframe("button[aria-label='历史']");
await page.waitForTimeout(400);
state = await iframeDoc();
report("T9 收藏视图 2 条 → 回历史 10", favRows === 2 && state.rows === 10, `fav=${favRows} history=${state.rows}`);

// ---------- T10 右钻详情页 + 返回 ----------
await focusPanel();
await page.keyboard.press("ArrowDown");
await page.waitForTimeout(200);
await page.keyboard.press("ArrowRight");
await page.waitForTimeout(700);
state = await iframeDoc();
const detailOk = state.crumbTitle === "详情";
const hasWorkspace = await page.evaluate(() => Boolean(document.getElementById("panel").contentDocument.querySelector("[data-surface='workspace']")));
await page.screenshot({ path: "/tmp/clipforge-visual/10-detail.png" });
await page.keyboard.press("ArrowLeft");
await page.waitForTimeout(500);
state = await iframeDoc();
report("T10 → 详情页 + ← 返回列表", detailOk && hasWorkspace && state.rows === 10, `title=${state.crumbTitle} backRows=${state.rows}`);

// ---------- T11 行 tooltip（portal 到 iframe body，视口内可见） ----------
// 前置用例的选中自动居中可能让列表处于滚动态（第 1 行半藏在 header 下），先滚回顶部再 hover。
await page.evaluate(() => {
  const doc = document.getElementById("panel").contentDocument;
  const scroller = doc.querySelector(".thin-scroll");
  if (scroller) scroller.scrollTop = 0;
});
await page.waitForTimeout(300);
const t11Pt = await hoverInIframe("article p", 0);
// hover 意图延时 500ms：停留满延时 + 渲染后再断言
await page.waitForTimeout(900);
state = await iframeDoc();
// hidden 抖动会冻结 hover/transition：卡住时抖动指针重试，最多 3 次
for (let attempt = 0; t11Pt && !(state.tooltipCard.found && state.tooltipCard.visible) && attempt < 3; attempt++) {
  await rejiggleHover(t11Pt);
  state = await iframeDoc();
}
await page.screenshot({ path: "/tmp/clipforge-visual/11-tooltip.png" });
await page.mouse.move(5, 5);
// 通过时只报卡片几何；失败时附带事件时间线/焦点等调试信息
const t11Pass = state.tooltipCard.found && state.tooltipCard.visible && state.tooltipCard.heightOk && state.tooltipCard.equalWidth && state.tooltipCard.inViewport;
report("T11 tooltip 可见、等宽、高度未塌陷且不超视口", t11Pass, t11Pass ? JSON.stringify(state.tooltipCard) : JSON.stringify({ card: state.tooltipCard, dbg: state.tooltipDebug }));

// ---------- T12 顶栏图标按钮尺寸统一 28px ----------
state = await iframeDoc();
const toolbarOk = state.toolbarButtons.length >= 4 && state.toolbarButtons.every((b) => b.w === 28 && b.h === 28);
report("T12 顶栏按钮统一 28px 命中区", toolbarOk, JSON.stringify(state.toolbarButtons));

// ---------- T13 mock 捕获入库（clipboard-changed 链路） ----------
const rowsBeforeSeed = (await iframeDoc()).rows;
await page.evaluate(() => {
  const win = document.getElementById("panel").contentWindow;
  win.__clipforgeMock.seedText("回归测试片段 ABC123", "回归测试");
  win.__clipforgeMock.emit("clipboard-changed", {
    changeCount: 1, hasChange: true, preview: "回归测试片段 ABC123", previewLen: 12,
  });
});
await page.waitForTimeout(700);
state = await iframeDoc();
report("T13 剪贴板变化事件 → 新条目入库", state.rows >= rowsBeforeSeed + 1, `rows=${rowsBeforeSeed}->${state.rows}`);

// ---------- T15 多行数据：列表可滚动 + 滚轮后虚拟窗口更新 ----------
// 回归「数据多了不能滚动」：QuickPastePanel 根节点 flex-1 在 block 父级下失效，
// 列表随内容长到 3000px+、overflow-auto 永不生效。断言容器可滚且滚后窗口渲染到底部行。
// clipboard-changed 已改增量合并（只置顶最新 1 条），批量种子需 reload 走初始加载。
await page.evaluate(() => {
  const win = document.getElementById("panel").contentWindow;
  for (let i = 0; i < 80; i++) win.__clipforgeMock.seedText(`回归批量条目 ${i}`);
});
await page.reload();
await page.waitForLoadState("load");
await page.waitForTimeout(2200);
await setPanel(420, 400);
await page.waitForTimeout(400);
const frameRect15 = await page.evaluate(() => {
  const f = document.getElementById("panel").getBoundingClientRect();
  return { x: f.x + 200, y: f.y + 200 };
});
// 少量滚轮验证滚轮链路可用；直达底部用 scrollTop（滚轮到底后会链式滚动外层预览页，干扰后续坐标）。
await page.mouse.move(frameRect15.x, frameRect15.y);
for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, 240); await page.waitForTimeout(60); }
const wheelScrolled = await page.evaluate(() => {
  const doc = document.getElementById("panel").contentDocument;
  return Math.round(doc.querySelector(".thin-scroll")?.scrollTop ?? -1);
});
// 滚动抑制断言：光标停在列表上边滚边等 800ms（> 意图延时 500ms），滚动中不应弹出浮卡
for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(100); }
const scrollSuppressed = await page.evaluate(() => !document.getElementById("panel").contentDocument.querySelector(".quick-panel-tooltip-card"));
await page.evaluate(() => {
  const doc = document.getElementById("panel").contentDocument;
  const scroller = doc.querySelector(".thin-scroll");
  if (scroller) scroller.scrollTop = scroller.scrollHeight;
});
await page.waitForTimeout(400);
const scrollState = await page.evaluate(() => {
  const doc = document.getElementById("panel").contentDocument;
  const scroller = doc.querySelector(".thin-scroll");
  const texts = [...doc.querySelectorAll("article")].map((a) => a.textContent ?? "");
  return {
    scrollable: scroller ? scroller.scrollHeight > scroller.clientHeight : false,
    scrollTop: Math.round(scroller?.scrollTop ?? -1),
    deepRowVisible: texts.some((t) => t.includes("回归批量条目 0")),
  };
});
report("T15 多行列表可滚动且虚拟窗口更新", scrollState.scrollable && wheelScrolled > 100 && scrollState.scrollTop > 400 && scrollState.deepRowVisible && scrollSuppressed, JSON.stringify({ wheelScrolled, scrollSuppressed, ...scrollState }));

// ---------- T17 滚轮停下后不移鼠标也自动出卡（WKWebView hover 补发链路） ----------
// 滚动抑制的配套恢复：WKWebView 滚动停下后不会对指针下的新行重发 pointerenter
// （「长滚动后滑不进去、无法预览」），VirtualList 在滚动反馈窗口结束时补发 pointerover。
// 光标自 T15 起停在列表内未移动；这里再滚一格后完全不动鼠标，等反馈窗口+意图延时后应出卡。
await page.mouse.wheel(0, -600);
await page.waitForTimeout(420 + 500 + 450);
const afterScrollTip = await page.evaluate(() => {
  const doc = document.getElementById("panel").contentDocument;
  const card = doc.querySelector(".quick-panel-tooltip-card");
  return { found: Boolean(card), text: card?.textContent?.slice(0, 20) ?? null };
});
report("T17 滚轮停下后不移鼠标自动出卡", afterScrollTip.found, JSON.stringify(afterScrollTip));
await page.mouse.move(5, 5);
await page.waitForTimeout(300);

// ---------- T16 hover 连续下移：浮卡不吞被盖住行的 hover（移出即消） ----------
// 回归「hover 之后就有问题」：portal 浮卡 pointer-events:auto 时会盖住相邻行并吃掉它们的 hover。
// 前置：外层预览页与列表都回滚到顶，保证坐标计算时 iframe 位置稳定。
await page.evaluate(() => {
  window.scrollTo(0, 0);
  const doc = document.getElementById("panel").contentDocument;
  const scroller = doc.querySelector(".thin-scroll");
  if (scroller) scroller.scrollTop = 0;
});
await page.waitForTimeout(400);
const rowCenter = (idx) =>
  page.evaluate((i) => {
    const doc = document.getElementById("panel").contentDocument;
    const frame = document.getElementById("panel").getBoundingClientRect();
    const r = doc.querySelectorAll("article")[i].getBoundingClientRect();
    return { x: frame.x + r.x + r.width / 2, y: frame.y + r.y + r.height / 2 };
  }, idx);
const rc0 = await rowCenter(0);
await page.mouse.move(rc0.x, rc0.y);
// 停留 400ms（< 500ms 意图延时）：确保短暂悬停不出卡
await page.waitForTimeout(400);
const rc3 = await rowCenter(3);
for (let y = rc0.y; y <= rc3.y; y += 8) { await page.mouse.move(rc3.x, y); await page.waitForTimeout(40); }
// 扫过结束后立即断言：路过各行不应弹出任何浮卡（hover 意图规范）
const sweepCard = await page.evaluate(() => Boolean(document.getElementById("panel").contentDocument.querySelector(".quick-panel-tooltip-card")));
// 停留满意图延时 + 渲染余量后，浮卡才应出现并跟随当前行
await page.waitForTimeout(900);
const probeHover = () => page.evaluate(() => {
  const doc = document.getElementById("panel").contentDocument;
  const rows = [...doc.querySelectorAll("article")];
  const hoveredIdx = rows.findIndex((a) => a.matches(":hover"));
  const card = doc.querySelector(".quick-panel-tooltip-card");
  return {
    hoveredIdx,
    cardText: card?.textContent?.slice(0, 24) ?? null,
    row3Text: rows[3]?.textContent?.slice(0, 24) ?? null,
  };
});
let hoverSweep = await probeHover();
// hidden 抖动会让 hover 命中丢失：卡住时抖动指针重试，最多 3 次
for (let attempt = 0; hoverSweep.hoveredIdx !== 3 && attempt < 3; attempt++) {
  await rejiggleHover(rc3);
  hoverSweep = await probeHover();
}
// 失败时补抓环境状态：焦点/隐藏/事件时间线/悬停链路，定位偶发干扰
let hoverDbg = null;
if (hoverSweep.hoveredIdx !== 3) {
  hoverDbg = await page.evaluate((pt) => {
    const win = document.getElementById("panel").contentWindow;
    const doc = win.document;
    const frame = document.getElementById("panel").getBoundingClientRect();
    const el = doc.elementFromPoint(pt.x - frame.x, pt.y - frame.y);
    const rows = [...doc.querySelectorAll("article")];
    return {
      focus: doc.hasFocus(),
      hidden: doc.hidden,
      scrollTop: Math.round(doc.querySelector(".thin-scroll")?.scrollTop ?? -1),
      frame: { x: Math.round(frame.x), y: Math.round(frame.y) },
      hit: el ? el.tagName + "." + String(el.className).slice(0, 40) : null,
      hitRowIdx: rows.indexOf(el?.closest?.("article") ?? null),
      events: (win.__dbgTooltipEvents ?? []).slice(-6),
    };
  }, rc3);
}
report(
  "T16 路过不出卡 + 停下出卡跟随 + 不吞被盖行 hover",
  !sweepCard && hoverSweep.hoveredIdx === 3 && Boolean(hoverSweep.cardText && hoverSweep.row3Text && hoverSweep.cardText.includes(hoverSweep.row3Text.slice(0, 8))),
  JSON.stringify({ sweepCard, ...hoverSweep, ...(hoverDbg ? { dbg: hoverDbg } : {}) }),
);
await page.mouse.move(5, 5);

// ---------- T18 浮卡可交互：滑进卡片保持打开，卡内滚动不带动列表 ----------
// 回归「鼠标滑不进去，无法预览长内容」：卡片打开后 pointer-events:auto，
// 打开期间由 document 级命中测试保持（指针在卡/触发行扩边内不关卡）；
// 卡内滚轮只滚卡片（overscroll contain），不触发列表滚动关卡。
await page.evaluate(() => {
  const win = document.getElementById("panel").contentWindow;
  win.__clipforgeMock.resetDb();
  win.__clipforgeMock.seedText(Array.from({ length: 30 }, (_, i) => `长内容第 ${i + 1} 行：Lorem ipsum dolor sit amet`).join("\n"));
  win.__clipforgeMock.emit("clipboard-changed", { changeCount: 1, hasChange: true, preview: "长内容第 1 行" });
});
await page.waitForTimeout(700);
const row0Pt = await rowCenter(0);
await page.mouse.move(row0Pt.x, row0Pt.y);
await page.waitForTimeout(900); // 意图延时出卡
const cardPt = await page.evaluate(() => {
  const doc = document.getElementById("panel").contentDocument;
  const card = doc.querySelector(".quick-panel-tooltip-card");
  if (!card) return null;
  const cr = card.getBoundingClientRect();
  const fr = document.getElementById("panel").getBoundingClientRect();
  return { x: fr.x + cr.left + cr.width / 2, y: fr.y + cr.top + Math.min(cr.height / 2, 40) };
});
let t18 = { opened: Boolean(cardPt), bridged: false, cardScrolled: 0, listMoved: false, closedAfterLeave: false };
if (cardPt) {
  await page.mouse.move(cardPt.x, cardPt.y); // 滑进卡片（跨过 6px 间隙）
  await page.waitForTimeout(350);
  t18.bridged = await page.evaluate(() => Boolean(document.getElementById("panel").contentDocument.querySelector(".quick-panel-tooltip-card")));
  for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 160); await page.waitForTimeout(60); }
  await page.waitForTimeout(250);
  const scrollProbe = await page.evaluate(() => {
    const doc = document.getElementById("panel").contentDocument;
    const card = doc.querySelector(".quick-panel-tooltip-card");
    const list = doc.querySelector(".thin-scroll");
    return { cardScrollTop: Math.round(card?.scrollTop ?? -1), listScrollTop: Math.round(list?.scrollTop ?? -1), cardGone: !card };
  });
  t18.cardScrolled = scrollProbe.cardScrollTop;
  t18.listMoved = scrollProbe.listScrollTop > 0;
  await page.mouse.move(5, 5);
  await page.waitForTimeout(350);
  t18.closedAfterLeave = await page.evaluate(() => !document.getElementById("panel").contentDocument.querySelector(".quick-panel-tooltip-card"));
}
report("T18 浮卡可滑入预览长内容（卡内滚动不带动列表）", t18.opened && t18.bridged && t18.cardScrolled > 100 && !t18.listMoved && t18.closedAfterLeave, JSON.stringify(t18));

// ---------- T19 丢数据回归：分页加载超过 200 后，新复制不截断列表 ----------
// 回归「还有丢数据的问题」：旧实现每次 clipboard-changed 都 limit=200 全量刷新，
// 用户分页加载超过 200 条后被截断回 200（末尾条目「消失」）。修复后增量合并：
// 新条目置顶、已加载条数保持不变。这里种子 250 条 → 滚到底加载第二页 → 再复制 1 条。
await page.evaluate(() => {
  const win = document.getElementById("panel").contentWindow;
  win.__clipforgeMock.resetDb();
  for (let i = 0; i < 250; i++) win.__clipforgeMock.seedText(`分页条目 ${String(i).padStart(3, "0")}`);
});
await page.reload();
await page.waitForLoadState("load");
await page.waitForTimeout(2200);
await setPanel(420, 400);
await page.waitForTimeout(400);
// 滚到底部触发 loadMore（初始 limit 200 → 追加剩余 50 条）
await page.evaluate(() => {
  const doc = document.getElementById("panel").contentDocument;
  const scroller = doc.querySelector(".thin-scroll");
  if (scroller) scroller.scrollTop = scroller.scrollHeight;
});
await page.waitForTimeout(900);
const t19Before = await page.evaluate(() => {
  const doc = document.getElementById("panel").contentDocument;
  const scroller = doc.querySelector(".thin-scroll");
  const row = doc.querySelector("article");
  const rowH = row?.getBoundingClientRect().height || 40;
  return { loadedRows: Math.round((scroller?.scrollHeight ?? 0) / rowH), rowH };
});
// 新复制一条：增量合并应置顶且列表总长不缩
const t19t0 = Date.now();
await page.evaluate(() => {
  const win = document.getElementById("panel").contentWindow;
  win.__clipforgeMock.seedText("复制新增条目 XYZ");
  win.__clipforgeMock.emit("clipboard-changed", { changeCount: 1, hasChange: true, preview: "复制新增条目 XYZ", previewLen: 12 });
});
await page.waitForTimeout(800);
const t19After = await page.evaluate(() => {
  const doc = document.getElementById("panel").contentDocument;
  const scroller = doc.querySelector(".thin-scroll");
  const row = doc.querySelector("article");
  const rowH = row?.getBoundingClientRect().height || 40;
  return { loadedRows: Math.round((scroller?.scrollHeight ?? 0) / rowH) };
});
// 选中项自动居中会把新条目滚到视口中央；直接读列表数据层断言（滚动窗口只渲染部分行）
const t19Top = await page.evaluate(() => {
  const doc = document.getElementById("panel").contentDocument;
  return [...doc.querySelectorAll("article")].map((a) => a.textContent ?? "").join("|");
});
const t19Ms = Date.now() - t19t0;
const t19Pass =
  t19Before.loadedRows === 250 &&
  t19After.loadedRows === 251 &&
  t19Top.includes("复制新增条目 XYZ") &&
  t19Top.includes("分页条目 249") === false; // 249 是次新，新条目已置顶
report(
  "T19 分页 >200 后复制不截断列表（250→251，新条目置顶）",
  t19Pass,
  JSON.stringify({ before: t19Before.loadedRows, after: t19After.loadedRows, topHasNew: t19Top.includes("复制新增条目 XYZ"), applyMs: t19Ms }),
);

// ---------- T20 显隐动画契约：panel-in 不含 opacity、panel-out 存在、材质不透明度足够 ----------
// 回归「触发白屏/闪烁」：后台 WKWebView 冻结动画时间轴时，from 帧含 opacity:0 会让面板
// 停在隐形帧。入场/退场动画只允许动 transform。材质 alpha 过低会在浅色桌面上透底难读。
const t20 = await page.evaluate(() => {
  const doc = document.getElementById("panel").contentDocument;
  const win = doc.defaultView;
  let panelInHasOpacity = null;
  let panelOutExists = false;
  for (const sheet of [...doc.styleSheets]) {
    let rules;
    try {
      rules = [...sheet.cssRules];
    } catch {
      continue;
    }
    for (const rule of rules) {
      if (rule.type === 7 /* KEYFRAMES_RULE */) {
        if (rule.name === "panel-in") panelInHasOpacity = rule.cssText.includes("opacity");
        if (rule.name === "panel-out") panelOutExists = true;
      }
    }
  }
  const mainBg = win.getComputedStyle(doc.querySelector("main")).backgroundColor;
  const alphaMatch = mainBg.match(/[\d.]+\)$/);
  const alpha = alphaMatch ? Number.parseFloat(alphaMatch[0]) : 1;
  return { panelInHasOpacity, panelOutExists, mainBg, alpha };
});
report(
  "T20 panel-in 无 opacity 帧 + panel-out 存在 + 材质 alpha ≥ 0.85",
  t20.panelInHasOpacity === false && t20.panelOutExists && t20.alpha >= 0.85,
  JSON.stringify(t20),
);

// ---------- T21 面板撑满窗口：无底部透明带（透明窗口的波浪伪影来源） ----------
const t21 = await page.evaluate(() => {
  const doc = document.getElementById("panel").contentDocument;
  const win = doc.defaultView;
  const main = doc.querySelector("main");
  const r = main?.getBoundingClientRect();
  return { mainHeight: Math.round(r?.height ?? 0), innerHeight: win.innerHeight };
});
report("T21 面板高度 == 窗口高度（无透明带）", Math.abs(t21.mainHeight - t21.innerHeight) <= 1, JSON.stringify(t21));

// ---------- T14 设置页：无错误 + 侧栏不换行 ----------
await page.goto(SETTINGS);
await page.waitForLoadState("load");
await page.waitForTimeout(2200);
const settingsState = await page.evaluate(() => {
  const text = document.body.innerText;
  const hasError = /Cannot read|reading '|Load failed/.test(text);
  const buttons = [...document.querySelectorAll("aside button")];
  const wrapped = buttons.filter((b) => b.scrollHeight > 32).length;
  return { hasError, wrapped, sidebarCount: buttons.length };
});
report("T14 设置页无错误 + 侧栏单项单行", !settingsState.hasError && settingsState.wrapped === 0 && settingsState.sidebarCount >= 7, JSON.stringify(settingsState));
await page.screenshot({ path: "/tmp/clipforge-visual/14-settings.png" });

// ---------- 汇总 ----------
console.log("\n===== 汇总 =====");
console.log(`共 ${results.length} 项，通过 ${results.length - failed}，失败 ${failed}`);
if (typeof process !== "undefined") process.exitCode = failed ? 1 : 0;
