#!/usr/bin/env node
/**
 * ClipForge 运行内存归因探针（macOS 外部只读，零侵入）。
 *
 * 做什么：按 lsappinfo coalition 归集应用全部进程（含 launchd 托管的 WKWebView
 *   WebContent / GPU / Networking），逐 PID 调 footprint 取 phys_footprint 与内存分类，
 *   输出中文分项报告；磁盘占用与虚拟地址空间单列，不计入内存总量。
 * 为什么：应用内 diagnostics_get_metrics 只测主进程 task_info(mach_task_self())，
 *   WebKit 辅助进程 ppid=1、不在进程树里，会被低估约 5 倍（实测 48 MB vs 256 MB）。
 * 边界：仅支持 macOS（依赖 lsappinfo/footprint/vmmap/du）；只读、不启动应用、不落盘；
 *   dev 沙箱与稳定版按 --dev / --pid 区分；非 macOS 明确报错退出而非给假数据。
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

const TARGET_BUNDLE = 'app.clipforge.desktop';
const STABLE_DATA = join(homedir(), 'Library', 'Application Support', 'ClipForge');
const DEV_DATA = join(homedir(), 'Library', 'Application Support', 'ClipForge-dev');

/** 执行外部命令；任何失败降级为空串，探针不因单个 pid 无权限而中断。 */
function run(cmd, args) {
  try {
    return execFileSync(cmd, args, {
      encoding: 'utf8',
      timeout: 20000,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return '';
  }
}

function parseArgs(argv) {
  const opts = { pid: null, dev: false, json: false, app: TARGET_BUNDLE, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--pid') opts.pid = Number(argv[++i]);
    else if (arg === '--dev') opts.dev = true;
    else if (arg === '--json') opts.json = true;
    else if (arg === '--app') opts.app = argv[++i];
  }
  return opts;
}

/** footprint 的 KB/MB/GB 统一换算成 MB。 */
function toMb(value, unit) {
  const scale = { K: 1 / 1024, M: 1, G: 1024 }[unit || ''] ?? 1 / 1024 / 1024;
  return value * scale;
}

function fmtMb(mb) {
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`;
}

/** lsappinfo 输出按行解析：先定位目标 app 的 pid，再找包含该 pid 的 coalition。 */
function appPidFromLsappinfo(text, bundleId) {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].includes(`bundleID="${bundleId}"`)) {
      for (let j = i; j < Math.min(i + 8, lines.length); j += 1) {
        const match = lines[j].match(/\bpid\s*=\s*(\d+)/);
        if (match) return Number(match[1]);
      }
    }
  }
  return null;
}

/** coalition 是 macOS 对同一 app 全部进程（含 XPC/WebKit）的权威归集。 */
function coalitionFor(text, pid) {
  const groups = [...text.matchAll(/coalition:\s*\d+\s*\{([^}]+)\}/g)].map((match) =>
    match[1].trim().split(/\s+/).map(Number).filter(Boolean),
  );
  const hit = groups.find((group) => group.includes(pid));
  return hit && hit.length ? hit : [pid];
}

/** dev 沙箱是 target/debug 下的裸二进制，没有 .app bundle，用 pgrep 找主进程。 */
function devPid() {
  const out = run('pgrep', ['-fl', 'clipforge']);
  for (const line of out.split('\n')) {
    if (line.includes('target/debug') && !line.includes('--mcp')) {
      const match = line.match(/^\s*(\d+)\s/);
      if (match) return Number(match[1]);
    }
  }
  return null;
}

function commandMap() {
  const map = new Map();
  for (const line of run('pgrep', ['-fl', '.']).split('\n')) {
    const match = line.match(/^\s*(\d+)\s+(.*)$/);
    if (match) map.set(Number(match[1]), match[2]);
  }
  return map;
}

/** 按进程命令名归类，便于回答「内存到底花在谁身上」。 */
function classify(pid, cmd, mainPid) {
  if (cmd.includes('com.apple.WebKit.WebContent')) return { kind: 'webcontent', label: 'WebContent' };
  if (cmd.includes('com.apple.WebKit.GPU')) return { kind: 'gpu', label: 'WebKit GPU' };
  if (cmd.includes('com.apple.WebKit.Networking')) return { kind: 'network', label: 'WebKit Networking' };
  if (cmd.includes('--mcp')) return { kind: 'mcp', label: 'MCP 子进程' };
  if (pid === mainPid) return { kind: 'main', label: '主进程' };
  return { kind: 'other', label: '其他辅助进程' };
}

/** 单进程 footprint + Dirty 分类 TopN；分类来自 footprint 的逐区域清单。 */
function readFootprint(pid) {
  const out = run('footprint', [String(pid)]);
  const head = out.match(/Footprint:\s*([\d.]+)\s*(K|M|G)?B/);
  const categories = [];
  for (const line of out.split('\n')) {
    const match = line.match(
      /^\s*([\d.]+)\s*(K|M|G)?B\s+([\d.]+\s*[KMG]?B)\s+([\d.]+\s*[KMG]?B)\s+\d+\s+(.+?)\s*$/,
    );
    if (match) categories.push({ name: match[5].trim(), mb: toMb(Number(match[1]), match[2]) });
  }
  return {
    mb: head ? toMb(Number(head[1]), head[2]) : 0,
    categories: categories.slice(0, 6),
  };
}

/** 主进程补充 peak / 启动时间，用于判断长期运行是否持续增长。 */
function readVmmap(pid) {
  const out = run('vmmap', ['-summary', String(pid)]);
  const peak = out.match(/Physical footprint \(peak\):\s*([^\n]+)/);
  const launch = out.match(/Launch Time:\s*([^\n]+)/);
  return {
    peak: peak ? peak[1].trim() : '—',
    launch: launch ? launch[1].trim().split(' (')[0] : '—',
  };
}

function dirMb(path) {
  if (!existsSync(path)) return 0;
  const out = run('du', ['-sk', path]);
  const match = out.match(/^(\d+)/);
  return match ? Number(match[1]) / 1024 : 0;
}

function diskUsage(dev) {
  const root = dev ? DEV_DATA : STABLE_DATA;
  return {
    root,
    total: dirMb(root),
    images: dirMb(join(root, 'resources', 'clipboard-images')),
    origin: dirMb(join(root, 'resources', 'clipboard-images', 'origin')),
    thumbnails: dirMb(join(root, 'resources', 'clipboard-images', 'thumbnails')),
    sqlite: dirMb(join(root, 'clipforge.sqlite')),
    log: dirMb(join(root, 'clipforge.jsonl')),
  };
}

const HELP = `ClipForge 运行内存归因探针（只读）
用法: pnpm mem:report [-- <选项>]
  --pid <pid>   指定主进程 PID，自动归集其 coalition
  --dev         定位 dev 沙箱实例（target/debug/clipforge）
  --app <id>    指定 bundleID，默认 ${TARGET_BUNDLE}
  --json        输出结构化 JSON 而非中文报告
  -h, --help    显示本说明
示例: pnpm mem:report -- --pid 14524
      pnpm mem:report -- --dev --json`;

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(HELP);
    return 0;
  }
  if (platform() !== 'darwin') {
    console.error('✗ 该探针依赖 macOS 的 lsappinfo / footprint / vmmap，当前平台不支持；不输出推测数据。');
    return 3;
  }

  const lsappinfo = run('lsappinfo', ['list']);
  if (!lsappinfo) {
    console.error('✗ 无法读取 lsappinfo，检查系统权限。');
    return 3;
  }
  const mainPid = opts.pid || (opts.dev ? devPid() : appPidFromLsappinfo(lsappinfo, opts.app));
  if (!mainPid || !Number.isFinite(mainPid)) {
    console.error(`✗ 未找到运行中的实例${opts.dev ? '（dev 沙箱）' : ''}；先启动应用，或用 --pid 指定。`);
    return 2;
  }

  const pids = coalitionFor(lsappinfo, mainPid);
  const cmds = commandMap();
  const rows = pids.map((pid) => {
    const cmd = cmds.get(pid) || '';
    const { kind, label } = classify(pid, cmd, mainPid);
    const { mb, categories } = readFootprint(pid);
    return { pid, kind, label, mb, categories, cmd: cmd.slice(0, 120) };
  });
  rows.sort((a, b) => b.mb - a.mb);

  const total = rows.reduce((sum, row) => sum + row.mb, 0);
  const main = rows.find((row) => row.kind === 'main') || { mb: 0, pid: mainPid };
  const webview = rows
    .filter((row) => ['webcontent', 'gpu', 'network'].includes(row.kind))
    .reduce((sum, row) => sum + row.mb, 0);
  const biggest = rows[0];
  const vmmap = readVmmap(mainPid);
  const disk = diskUsage(opts.dev);
  const ratio = (mb) => (total > 0 ? `${((mb / total) * 100).toFixed(1)}%` : '—');
  const stamp = new Date().toLocaleString('zh-CN', { hour12: false });
  const underestimate = main.mb > 0 ? (total / main.mb).toFixed(1) : '—';

  const result = {
    at: stamp,
    platform: 'macos',
    mainPid,
    instance: opts.dev ? 'dev-sandbox' : 'stable',
    processCount: rows.length,
    totalMb: Number(total.toFixed(1)),
    mainMb: Number(main.mb.toFixed(1)),
    webviewMb: Number(webview.toFixed(1)),
    underestimateFactor: Number(underestimate),
    rows: rows.map((row) => ({ ...row, mb: Number(row.mb.toFixed(1)) })),
    vmmap,
    disk,
  };

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }

  const lines = [];
  lines.push(`ClipForge 运行内存归因 · ${stamp}`);
  lines.push(`目标: ${opts.dev ? 'dev 沙箱' : opts.app} (pid ${mainPid}) · coalition ${rows.length} 个进程 · 启动于 ${vmmap.launch}`);
  lines.push('');
  lines.push(`【进程内存】合计 ${fmtMb(total)} · 主进程峰值 ${vmmap.peak} · phys_footprint 口径`);
  const labelWidth = 18;
  for (const row of rows) {
    const label = row.label.padEnd(labelWidth, ' ');
    lines.push(`  ${label}${fmtMb(row.mb).padStart(10)}  ${ratio(row.mb).padStart(6)}  pid ${row.pid}`);
  }
  lines.push('');
  if (biggest && biggest.categories.length) {
    lines.push(`【最大进程分类 Top${biggest.categories.length}】pid ${biggest.pid} · ${biggest.label} ${fmtMb(biggest.mb)}`);
    for (const cat of biggest.categories) {
      lines.push(`  ${cat.name.padEnd(48, ' ')}${fmtMb(cat.mb).padStart(10)}`);
    }
    lines.push('');
  }
  lines.push(`【磁盘占用（不计入内存）】${fmtMb(disk.total)} · ${disk.root}`);
  lines.push(`  图片 origin      ${fmtMb(disk.origin).padStart(10)}`);
  lines.push(`  图片 thumbnails  ${fmtMb(disk.thumbnails).padStart(10)}`);
  lines.push(`  clipforge.sqlite ${fmtMb(disk.sqlite).padStart(10)}`);
  lines.push(`  clipforge.jsonl  ${fmtMb(disk.log).padStart(10)}`);
  lines.push('');
  lines.push('【口径】phys_footprint = 活动监视器「内存」；不要与 resident/RSS 相加。');
  lines.push('  虚拟地址空间（含 Guard 保留区，数百 GB）是地址保留，不是占用；磁盘是持久化，不是内存。');
  lines.push('  应用内诊断页只测主进程 task_info(mach_task_self())，不含 launchd 托管的 WebKit 辅助进程。');
  lines.push('');
  lines.push(`【结论】WebView 辅助进程 ${fmtMb(webview)}（${ratio(webview)}），主进程 ${fmtMb(main.mb)}（${ratio(main.mb)}）。`);
  lines.push(`  应用内诊断页低估约 ${underestimate} 倍；三个隐藏 WebView 窗口常驻（tauri.conf.json windows），关闭仅 hide 不销毁。`);
  lines.push('  完整口径请用本脚本；应用内数值只用于观察主进程趋势。');
  console.log(lines.join('\n'));
  return 0;
}

process.exitCode = main();
