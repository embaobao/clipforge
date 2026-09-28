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
        return { found: true, visible: vis, height: Math.round(r.height), heightOk: r.height >= 40, left: Math.round(r.left), right: Math.round(r.right), inViewport: r.left >= -1 && r.right <= win.innerWidth + 1 };
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
  if (!rect) return false;
  await page.mouse.move(rect.x, rect.y);
  return true;
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
await hoverInIframe("article p", 0);
await page.waitForTimeout(600);
state = await iframeDoc();
await page.screenshot({ path: "/tmp/clipforge-visual/11-tooltip.png" });
await page.mouse.move(5, 5);
// 通过时只报卡片几何；失败时附带事件时间线/焦点等调试信息
const t11Pass = state.tooltipCard.found && state.tooltipCard.visible && state.tooltipCard.heightOk && state.tooltipCard.inViewport;
report("T11 tooltip 可见、高度未塌陷且不超视口", t11Pass, t11Pass ? JSON.stringify(state.tooltipCard) : JSON.stringify({ card: state.tooltipCard, dbg: state.tooltipDebug }));

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
await page.evaluate(() => {
  const win = document.getElementById("panel").contentWindow;
  for (let i = 0; i < 80; i++) win.__clipforgeMock.seedText(`回归批量条目 ${i}`);
  win.__clipforgeMock.emit("clipboard-changed", { changeCount: 1, hasChange: true, preview: "回归批量条目 79" });
});
await page.waitForTimeout(800);
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
report("T15 多行列表可滚动且虚拟窗口更新", scrollState.scrollable && wheelScrolled > 100 && scrollState.scrollTop > 400 && scrollState.deepRowVisible, JSON.stringify({ wheelScrolled, ...scrollState }));

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
await page.waitForTimeout(400);
const rc3 = await rowCenter(3);
for (let y = rc0.y; y <= rc3.y; y += 8) { await page.mouse.move(rc3.x, y); await page.waitForTimeout(40); }
await page.waitForTimeout(400);
const hoverSweep = await page.evaluate(() => {
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
  "T16 浮卡不吞被盖行 hover（移出即消）",
  hoverSweep.hoveredIdx === 3 && Boolean(hoverSweep.cardText && hoverSweep.row3Text && hoverSweep.cardText.includes(hoverSweep.row3Text.slice(0, 8))),
  JSON.stringify({ ...hoverSweep, ...(hoverDbg ? { dbg: hoverDbg } : {}) }),
);
await page.mouse.move(5, 5);

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
