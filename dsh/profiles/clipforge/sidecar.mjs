#!/usr/bin/env node
/**
 * ClipForge DSH sidecar —— 进程内加载 clipforge profile，按模式运行。
 *
 * 两种模式（由首个参数决定，互不干扰）：
 *   1. 常驻服务模式 `--serve [--port 3080] [--host 127.0.0.1]`
 *      通过 boot 的 prepare 回调注入 `provideCmdline`，让 dsh-web-app 的
 *      web carrier（dsh-host-webserver）在 loopback 上监听并直接提供 DSH 官方
 *      Web UI。进程常驻不退出，由宿主（Rust 守护进程）在退出时回收。
 *      这正是「直接使用 DSH 自己的 web 页面」的兼容模式（参考项目 desktop 壳同思路）。
 *   2. 一次性分析模式（默认，task 作为位置参数）
 *      复刻 `dsh --profile clipforge` 的启动序列，跑一次剪贴板分析，
 *      由 @clipforge/dsh-plugin 的 runner 打印 `DSH_RESULT::<json>` 后退出。
 *      此路径被 Rust 命令 `analyze_clipboard` 调用，作为无守护进程时的降级旁路。
 *
 * 本文件与 profile 的 cordis.yml 同目录，node 模块解析向上即可命中 profile/node_modules。
 */
import { boot, loadProfile } from "@deepseek-ai/dsh-app-boot";
import { provideCmdline } from "@deepseek-ai/dsh-cmdline";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
// profile 目录 = <home>/profiles/clipforge；home 取本 profile 的上两级（dsh/）。
const DSH_HOME = resolve(__dirname, "..", ".."); // .../dsh
const PROFILE_NAME = "clipforge";
const BIN_NAME = "clipforge-dsh-sidecar";
const configPath = resolve(__dirname, "cordis.yml");
// installAnchor：本 profile 的 package.json（用于解析 bundle 依赖路径）。
const installAnchor = resolve(__dirname, "package.json");

/** web carrier 监听地址（loopback-only 硬约束，避免暴露到局域网）。 */
const SERVE_HOST = process.env.CLIPFORGE_DSH_HOST || "127.0.0.1";
const SERVE_PORT = Number(process.env.CLIPFORGE_DSH_PORT || 3080);

/** 首个位置参数（非 `--` 开头）作为一次性分析任务；serve 模式下为空。 */
function firstPositional() {
  return process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "";
}

/** 常驻服务模式：boot + 注入 cmdline → web carrier 监听，进程常驻。 */
async function startServe() {
  const profile = loadProfile(BIN_NAME, PROFILE_NAME, installAnchor, DSH_HOME);
  const patches = profile.layers.flatMap((layer) => layer.patches).concat(profile.patches);
  await boot(
    BIN_NAME,
    configPath,
    patches,
    // prepare 在 Loader 安装后、任何 config-tree entry 挂载前运行：
    // 注入 cmdlineArgs，让 dsh-web-app 的 web-startup 解析出 webStartup（host/port），
    // 进而 dsh-host-webserver 绑定 loopback 端口，dsh-web-app 直接服务官方 Web UI。
    (ctx) => {
      provideCmdline(ctx, {
        args: ["--host", SERVE_HOST, "--port", String(SERVE_PORT)],
        exit: (code) => process.exit(code),
      });
    },
  );
  // 常驻：不调用 process.exit；事件循环由 web carrier 持有。
  process.stderr.write(
    `clipforge-dsh-sidecar: web carrier listening on http://${SERVE_HOST}:${SERVE_PORT}\n`,
  );
}

/** 一次性分析模式：与旧行为一致，跑完由插件 runner 打印 DSH_RESULT:: 并退出。 */
async function startAnalyze(task) {
  const profile = loadProfile(BIN_NAME, PROFILE_NAME, installAnchor, DSH_HOME);
  const patches = profile.layers.flatMap((layer) => layer.patches).concat(profile.patches);
  await boot(BIN_NAME, configPath, patches);
  // 看门狗：runner 异常挂死时（如模型长驻不返回）兜底退出，避免进程永远不结束。
  // 用 ref 定时器保持事件循环存活，正常情况 runner 会先调用 process.exit(0) 结束进程。
  setTimeout(() => {
    process.stderr.write("clipforge-dsh-sidecar: 看门狗超时（runner 未在正常时间内收尾），强制结束\n");
    process.exit(1);
  }, 120000).ref();
}

try {
  if (process.argv.includes("--serve")) {
    await startServe();
  } else {
    await startAnalyze(firstPositional());
  }
} catch (err) {
  process.stderr.write(`clipforge-dsh-sidecar: boot failed: ${err?.stack ?? err?.message ?? err}\n`);
  process.exit(1);
}
