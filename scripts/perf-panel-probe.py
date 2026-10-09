#!/usr/bin/env python3
"""ClipForge 面板性能探针（固化的自动性能测试，替代手工 CGEvent 注入+截图比对）。

用法：
    python3 scripts/perf-panel-probe.py                 # 测稳定版（/Applications）
    python3 scripts/perf-panel-probe.py --sandbox       # 测沙箱 dev 实例（pnpm dev:sandbox）
    python3 scripts/perf-panel-probe.py --rounds 8 --threshold-ms 180

测量项：
    1. show 延迟：快捷键按下 → 面板出现在屏幕（CGWindowList 屏上列表）
    2. hide 延迟：快捷键按下 → 面板从屏幕消失
    3. 幻影 blur 自愈：面板显示中激活其他 app（无用户输入）→ 1.5s 后面板应仍在
阈值：show/hide ≤ --threshold-ms（默认 180ms）；幻影 blur 必须存活。
任一不达标退出码 1，可挂 CI / pnpm test:perf-panel。

依赖：macOS 系统 python3（自带 pyobjc：Quartz）。热键从实例的 settings.json5 读取。
"""

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import time

import Quartz

# 快捷键名 → (virtual key code, 修饰键)
VK_MAP = {
    "v": 9, "n": 45, "m": 46, "a": 0, "b": 11, "c": 8, "d": 2, "e": 14,
    "f": 3, "g": 5, "h": 4, "i": 34, "j": 38, "k": 40, "l": 37, "o": 31,
    "p": 35, "q": 12, "r": 15, "s": 1, "t": 17, "u": 32, "w": 13, "x": 7,
    "y": 16, "z": 6,
}


def app_pid(sandbox: bool) -> int:
    """定位实例主进程 pid（排除 --mcp 子进程）。"""
    pattern = (
        "target/debug/clipforge" if sandbox else "/Applications/ClipForge.app/Contents/MacOS/clipforge"
    )
    out = subprocess.run(["ps", "-Ao", "pid,command"], capture_output=True, text=True).stdout
    for line in out.splitlines():
        if pattern in line and "--mcp" not in line and "grep" not in line:
            return int(line.split()[0])
    print(f"✗ 找不到 {'sandbox' if sandbox else 'stable'} ClipForge 进程（先启动实例）")
    sys.exit(2)


def read_shortcut(sandbox: bool) -> str:
    """从实例 settings.json5 读 globalShortcut，读不到回落 Control+V。"""
    support_dir = os.path.expanduser(
        "~/Library/Application Support/ClipForge-dev" if sandbox else "~/Library/Application Support/ClipForge"
    )
    path = os.path.join(support_dir, "settings.json5")
    try:
        with open(path, encoding="utf-8") as handle:
            match = re.search(r'"globalShortcut"\s*:\s*"([^"]+)"', handle.read())
            if match:
                return match.group(1)
    except OSError:
        pass
    return "Control+V"


def shortcut_to_vk(shortcut: str):
    parts = [p.strip() for p in shortcut.split("+") if p.strip()]
    key = parts[-1].lower()
    flags = Quartz.kCGEventFlagMaskControl
    if "Shift" in parts or "⇧" in parts:
        flags |= Quartz.kCGEventFlagMaskShift
    if "Alt" in parts or "Option" in parts or "⌥" in parts:
        flags |= Quartz.kCGEventFlagMaskAlternate
    if "Meta" in parts or "Command" in parts or "⌘" in parts:
        flags |= Quartz.kCGEventFlagMaskCommand
    if key not in VK_MAP:
        print(f"✗ 探针不支持按键 {key}（支持: {', '.join(sorted(VK_MAP))}）")
        sys.exit(2)
    return VK_MAP[key], flags


def panel_window_id(pid: int):
    """快速面板 = 该实例名为 'ClipForge' 的窗口（设置/引导窗口名带后缀，托盘/辅助窗无名）。
    返回 None 表示不在屏上。"""
    windows = Quartz.CGWindowListCopyWindowInfo(
        Quartz.kCGWindowListOptionOnScreenOnly, Quartz.kCGNullWindowID
    )
    for window in windows:
        if window.get("kCGWindowOwnerPID") != pid:
            continue
        if window.get("kCGWindowName") == "ClipForge":
            bounds = window.get("kCGWindowBounds", {})
            if 200 <= bounds.get("Width", 0) <= 2400 and 150 <= bounds.get("Height", 0) <= 2000:
                return window.get("kCGWindowNumber")
    return None


def panel_bounds(pid: int):
    """返回屏上面板的 bounds 字典（不可见返回 None）。识别规则同 panel_window_id。"""
    windows = Quartz.CGWindowListCopyWindowInfo(
        Quartz.kCGWindowListOptionOnScreenOnly, Quartz.kCGNullWindowID
    )
    for window in windows:
        if window.get("kCGWindowOwnerPID") == pid and window.get("kCGWindowName") == "ClipForge":
            return window.get("kCGWindowBounds")
    return None


def tap_hotkey(vk: int, flags: int) -> float:
    """CGEventPost 注入组合键（HID 级，等价用户物理按键）；返回注入完成时刻。"""
    down = Quartz.CGEventCreateKeyboardEvent(None, vk, True)
    Quartz.CGEventSetFlags(down, flags)
    Quartz.CGEventPost(Quartz.kCGHIDEventTap, down)
    time.sleep(0.03)
    up = Quartz.CGEventCreateKeyboardEvent(None, vk, False)
    Quartz.CGEventSetFlags(up, flags)
    Quartz.CGEventPost(Quartz.kCGHIDEventTap, up)
    return time.time()


def wait_until(predicate, timeout_s: float = 2.0, interval_s: float = 0.003):
    """高频轮询直到 predicate() 为真；返回 (是否命中, 耗时 ms)。"""
    started = time.time()
    while time.time() - started < timeout_s:
        if predicate():
            return True, (time.time() - started) * 1000
        time.sleep(interval_s)
    return False, (time.time() - started) * 1000


def activate_other_app() -> None:
    """无用户输入地激活另一个 app（复现后台 app 自激活抢 key 场景）。Finder 无害。"""
    subprocess.run(
        ["osascript", "-e", 'tell application "Finder" to activate'],
        capture_output=True,
    )


def panel_bounds(pid: int):
    """返回屏上面板的 bounds 字典（不可见返回 None）。"""
    windows = Quartz.CGWindowListCopyWindowInfo(
        Quartz.kCGWindowListOptionOnScreenOnly, Quartz.kCGNullWindowID
    )
    for window in windows:
        if window.get("kCGWindowOwnerPID") == pid and window.get("kCGWindowLayer", 0) >= 20:
            return window.get("kCGWindowBounds")
    return None


def region_md5(bounds: dict) -> str:
    """对指定屏幕区域截图取 md5（静态内容下确定性输出，用于鬼影比对）。"""
    rect = "{},{},{},{}".format(
        int(bounds["X"]), int(bounds["Y"]), int(bounds["Width"]), int(bounds["Height"])
    )
    path = "/tmp/clipforge-probe-region.png"
    subprocess.run(["screencapture", "-x", f"-R{rect}", path], capture_output=True)
    try:
        with open(path, "rb") as handle:
            return hashlib.md5(handle.read()).hexdigest()
    except OSError:
        return ""


def ghost_check(pid: int, vk: int, flags: int) -> bool:
    """鬼影检测：面板「在窗口列表里」但 alpha=0（透明幽灵）时截图与隐藏态一致。
    返回 True = 面板真实可见（非鬼影）。"""
    bounds = panel_bounds(pid)
    if bounds is None:
        return True  # 面板不在，无鬼影可言
    tap_hotkey(vk, flags)
    wait_until(lambda: panel_bounds(pid) is None)
    time.sleep(0.25)
    hidden_md5 = region_md5(bounds)
    tap_hotkey(vk, flags)
    wait_until(lambda: panel_bounds(pid) is not None)
    time.sleep(0.35)
    shown_md5 = region_md5(bounds)
    return hidden_md5 != shown_md5


def interrupt_tests(pid: int, vk: int, flags: int, threshold_ms: float) -> list:
    """Apple 流式交互第一原则：动画必须可被硬需求随时打断，且打断不能卡。
    返回 [(名称, 耗时ms, 是否达标)]。"""
    results = []

    def ensure(state_visible: bool):
        if (panel_window_id(pid) is not None) != state_visible:
            tap_hotkey(vk, flags)
            wait_until(lambda: (panel_window_id(pid) is not None) == state_visible)

    # A: show 打断 hide（淡出在途时按唤起键，应立即出现且不闪烁）
    ensure(True)
    tap_hotkey(vk, flags)  # 发起 hide
    time.sleep(0.05)  # 淡出在途（110ms 窗口内）
    t2 = tap_hotkey(vk, flags)  # 硬需求：show
    ok, ms = wait_until(lambda: panel_window_id(pid) is not None)
    results.append(("show 打断 hide", ms if ok else float("inf"), ok and ms <= threshold_ms))
    # 打断后 400ms 仍应在（不允许闪现后消失）
    time.sleep(0.4)
    stable = panel_window_id(pid) is not None
    results.append(("show 打断后保持", 0.0, stable))

    # B: hide 打断 show（入场动画在途时按隐藏键，应立即消失）
    ensure(False)
    t1 = tap_hotkey(vk, flags)  # 发起 show
    time.sleep(0.05)
    t2 = tap_hotkey(vk, flags)  # 硬需求：hide
    ok, ms = wait_until(lambda: panel_window_id(pid) is None)
    results.append(("hide 打断 show", ms if ok else float("inf"), ok and ms <= threshold_ms))

    # C: 连打 6 次（120ms 间隔）——奇偶校验最终态，且不允许卡死或鬼影
    ensure(False)
    for _ in range(6):
        tap_hotkey(vk, flags)
        time.sleep(0.12)
    ok, ms = wait_until(lambda: panel_window_id(pid) is None, timeout_s=1.0)
    results.append(("连打 6 次收敛到隐藏", ms if ok else float("inf"), ok))
    return results


def main() -> int:
    parser = argparse.ArgumentParser(description="ClipForge 面板性能探针")
    parser.add_argument("--sandbox", action="store_true", help="测沙箱 dev 实例而非稳定版")
    parser.add_argument("--rounds", type=int, default=5, help="show/hide 各测几轮（默认 5）")
    parser.add_argument("--threshold-ms", type=float, default=180, help="show/hide 延迟阈值（默认 180）")
    parser.add_argument("--skip-phantom", action="store_true", help="跳过幻影 blur 自愈检查")
    args = parser.parse_args()

    pid = app_pid(args.sandbox)
    shortcut = read_shortcut(args.sandbox)
    vk, flags = shortcut_to_vk(shortcut)
    target = "sandbox" if args.sandbox else "stable"
    print(f"实例: {target} (pid={pid})  快捷键: {shortcut}  阈值: {args.threshold_ms:.0f}ms")

    # 初始状态归一：面板可见则先收起
    if panel_window_id(pid) is not None:
        tap_hotkey(vk, flags)
        wait_until(lambda: panel_window_id(pid) is None)

    show_lat, hide_lat = [], []
    for round_no in range(1, args.rounds + 1):
        # show: 确保收起 → 注入 → 等出现
        if panel_window_id(pid) is not None:
            tap_hotkey(vk, flags)
            wait_until(lambda: panel_window_id(pid) is None)
        tap_hotkey(vk, flags)
        ok, ms = wait_until(lambda: panel_window_id(pid) is not None)
        show_lat.append(ms if ok else float("inf"))
        # hide: 注入 → 等消失
        tap_hotkey(vk, flags)
        ok, ms = wait_until(lambda: panel_window_id(pid) is None)
        hide_lat.append(ms if ok else float("inf"))
        print(f"  round {round_no}: show={show_lat[-1]:6.0f}ms  hide={hide_lat[-1]:6.0f}ms")

    phantom_ok = None
    if not args.skip_phantom:
        # 幻影 blur：面板打开 → Finder 自激活（无输入）→ 1.5s 后应仍在（Rust 已夺回 key）。
        # 先等 700ms 让输入静默（探针自己注入的热键也算输入，350ms 阈值内不触发自愈，
        # 与真实用户「按完热键后不再操作」的场景一致）。
        if panel_window_id(pid) is None:
            tap_hotkey(vk, flags)
            wait_until(lambda: panel_window_id(pid) is not None)
        time.sleep(0.7)
        activate_other_app()
        time.sleep(1.5)
        phantom_ok = panel_window_id(pid) is not None
        print(f"  phantom-blur 自愈: {'存活 ✓' if phantom_ok else '被藏掉 ✗'}")
        tap_hotkey(vk, flags)
        wait_until(lambda: panel_window_id(pid) is None)

    print("\n=== 动画可打断性（Apple 流式交互第一原则）===")
    interrupt_results = interrupt_tests(pid, vk, flags, args.threshold_ms)
    for name, ms, passed in interrupt_results:
        mark = "✓" if passed else "✗"
        suffix = f"{ms:6.0f}ms" if ms > 0 else "     "
        print(f"  {mark} {name}: {suffix}")

    ghost_ok = ghost_check(pid, vk, flags)
    print(f"  {'✓' if ghost_ok else '✗'} 透明鬼影检测: 面板可见时截图与隐藏态不同（无 alpha=0 幽灵）")

    def summarize(name: str, values) -> bool:
        if any(v == float("inf") for v in values):
            print(f"✗ {name}: 有轮次超时未命中")
            return False
        worst = max(values)
        avg = sum(values) / len(values)
        status = "✓" if worst <= args.threshold_ms else "✗"
        print(f"{status} {name}: 平均 {avg:.0f}ms / 最差 {worst:.0f}ms（阈值 {args.threshold_ms:.0f}ms）")
        return worst <= args.threshold_ms

    ok = True
    print("\n=== 汇总 ===")
    ok &= summarize("show 延迟", show_lat)
    ok &= summarize("hide 延迟", hide_lat)
    if phantom_ok is not None:
        ok &= phantom_ok
        print(f"{'✓' if phantom_ok else '✗'} 幻影 blur 自愈: 面板在后台 app 抢 key 后保持可见")
    for name, _ms, passed in interrupt_results:
        ok &= passed
        print(f"{'✓' if passed else '✗'} {name}")
    ok &= ghost_ok
    print(f"{'✓' if ghost_ok else '✗'} 透明鬼影检测")
    print("结论:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
