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
        return { found: true, visible: vis, left: Math.round(r.left), right: Math.round(r.right), inViewport: r.left >= -1 && r.right <= win.innerWidth + 1 };
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
await hoverInIframe("article p", 0);
await page.waitForTimeout(600);
state = await iframeDoc();
await page.screenshot({ path: "/tmp/clipforge-visual/11-tooltip.png" });
await page.mouse.move(5, 5);
report("T11 tooltip 可见且不超视口", state.tooltipCard.found && state.tooltipCard.visible && state.tooltipCard.inViewport, JSON.stringify(state.tooltipCard));

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
