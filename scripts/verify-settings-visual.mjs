// 设置页视觉回归验证闭环：通过 ego-browser 驱动真实 Chromium 加载 settings.html（web mock 数据），
// 遍历全部 section × tab，断言布局不变量并逐屏截图。
//
// 用法：pnpm verify:settings:visual
// 前置：脚本会自行启动 `pnpm dev`（端口 1420），结束后回收。
// 检查项（每个 section/tab）：
//   1. 无水平溢出（scrollWidth 不超过视口）
//   2. 底部状态条左右文案不重复
//   3. 中文界面无已知后端英文串泄漏（MCP server running / Could not fetch 等）
//   4. 侧栏默认收起（data-sidebar-collapsed）且展开/收起宽度切换生效
// 产物：artifacts/settings-visual/<section>-<tab>.png + 控制台汇总，失败退出码 1。
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const ARTIFACT_DIR = path.join(ROOT, "artifacts", "settings-visual");
const DEV_URL = "http://localhost:1420/settings.html";
const VIEWPORT = { width: 720, height: 600, deviceScaleFactor: 2, mobile: false };

/** 等待 dev server 端口就绪；超时抛错。 */
async function waitForServer(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { method: "HEAD" });
      if (res.ok || res.status === 404) return;
    } catch {
      /* 未就绪，继续等 */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`dev server 未在 ${timeoutMs}ms 内就绪: ${url}`);
}

/** ego-browser 内执行的检查脚本：遍历 section/tab、断言不变量、逐屏截图。 */
function buildProbeScript() {
  return `
const task = await taskSpace("clipforge settings visual regression");
const page = task.page("p1");
await page.cdp("Emulation.setDeviceMetricsOverride", ${JSON.stringify(VIEWPORT)});
await page.goto("${DEV_URL}");
await page.waitForSelector('[data-surface="settings"]', { state: "visible", timeout: 15_000 });

// 中文界面下不允许出现的后端英文串泄漏（本地化映射应兜住）。
const LEAK_PATTERNS = ["MCP server running", "Could not fetch", "accessibility status unavailable", "Launch at login"];

const collectState = () => page.evaluate(() => {
  const doc = document.documentElement;
  const bar = document.querySelector('[role="status"], [role="alert"]');
  const texts = bar ? [bar.children[0]?.textContent?.trim() ?? "", bar.children[1]?.textContent?.trim() ?? ""] : [];
  const aside = document.querySelector("aside");
  return {
    hOverflow: doc.scrollWidth - window.innerWidth,
    statusPrimary: texts[0],
    statusDuplicated: texts[0].length > 0 && texts[0] === texts[1],
    bodyText: document.body.innerText,
    sidebarCollapsed: aside?.getAttribute("data-sidebar-collapsed") === "true" || undefined,
    sidebarWidth: aside ? Math.round(aside.getBoundingClientRect().width) : 0,
    surface: document.querySelector('[data-surface="settings"]') ? "ok" : "missing",
  };
});

const results = { sections: [], failures: [] };
const assert = (cond, message) => { if (!cond) results.failures.push(message); };

// 侧栏默认收起（icon-only）。
const initial = await collectState();
assert(initial.surface === "ok", "settings surface 未渲染");
assert(initial.sidebarCollapsed === true, "侧栏应默认收起（data-sidebar-collapsed）");
assert(initial.sidebarWidth <= 60, \`收起态侧栏宽度应 ≤60px，实际 \${initial.sidebarWidth}\`);

// 遍历侧栏每个 section。
const navButtons = await page.evaluate(() =>
  [...document.querySelectorAll("aside button")].slice(1).map((b) => b.getAttribute("aria-label")),
);
for (const label of navButtons) {
  await page.click(\`loc=css:aside button[aria-label="\${label}"]\`);
  await page.waitForTimeout(350); // 宽度过渡 + 首帧渲染
  const sectionState = await collectState();
  assert(sectionState.hOverflow <= 1, \`\${label}: 水平溢出 \${sectionState.hOverflow}px\`);
  assert(!sectionState.statusDuplicated, \`\${label}: 状态条左右文案重复\`);
  for (const leak of LEAK_PATTERNS) {
    assert(!sectionState.bodyText.includes(leak), \`\${label}: 英文串泄漏 "\${leak}"\`);
  }
  // 遍历该 section 的全部 tab。
  const tabLabels = await page.evaluate(() =>
    [...document.querySelectorAll('[data-dev-probe="settings-section-tabs-list"] button')].map((b) => b.textContent?.trim()),
  );
  for (const tab of tabLabels) {
    await page.click(\`text=\${tab}\`);
    await page.waitForTimeout(250);
    const tabState = await collectState();
    assert(tabState.hOverflow <= 1, \`\${label}/\${tab}: 水平溢出 \${tabState.hOverflow}px\`);
    assert(!tabState.statusDuplicated, \`\${label}/\${tab}: 状态条左右文案重复\`);
    for (const leak of LEAK_PATTERNS) {
      assert(!tabState.bodyText.includes(leak), \`\${label}/\${tab}: 英文串泄漏 "\${leak}"\`);
    }
    const safeTab = tab.replace(/[^\\w\\u4e00-\\u9fa5-]+/g, "_");
    const shot = await page.screenshot({ path: "${ARTIFACT_DIR}/" + label + "-" + safeTab + ".png" });
    results.sections.push({ section: label, tab, overflow: tabState.hOverflow, screenshot: shot });
  }
}

// 展开态回归：点开展开后侧栏宽度恢复、label 可见。
await page.click('loc=css:aside button[aria-label*="侧栏"], loc=css:aside button[aria-label*="sidebar"]');
await page.waitForTimeout(350);
const expanded = await collectState();
assert(expanded.sidebarWidth > 120, \`展开态侧栏宽度应 >120px，实际 \${expanded.sidebarWidth}\`);
await page.screenshot({ path: "${ARTIFACT_DIR}/sidebar-expanded.png" });

console.log(JSON.stringify(results, null, 2));
if (results.failures.length > 0) process.exitCode = 1;
await task.finish({ keep: [] });
`;
}

async function main() {
  await mkdir(ARTIFACT_DIR, { recursive: true });
  const dev = spawn("pnpm", ["dev"], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
  let devLog = "";
  dev.stdout.on("data", (chunk) => { devLog += chunk; });
  dev.stderr.on("data", (chunk) => { devLog += chunk; });
  try {
    await waitForServer(DEV_URL);
    const probe = buildProbeScript();
    const probePath = path.join(ARTIFACT_DIR, ".probe.mjs");
    await writeFile(probePath, probe);
    const exitCode = await new Promise((resolve, reject) => {
      const ego = spawn("ego-browser", ["nodejs"], { stdio: ["pipe", "inherit", "inherit"] });
      ego.on("error", reject);
      ego.on("close", resolve);
      ego.stdin.end(probe);
    });
    if (exitCode !== 0) {
      console.error("视觉回归未通过，截图与明细见 " + ARTIFACT_DIR);
      if (devLog) console.error(devLog.slice(-2000));
    }
    process.exitCode = exitCode;
  } finally {
    dev.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
