#!/usr/bin/env python3
"""使用外部 PNG 作为 ClipForge 应用图标源，生成 macOS/Windows/Linux 全套图标。"""
import os
import shutil
import subprocess
import sys
from PIL import Image


ICON_DIR = "/Users/embaobao/workspace/idea/clipforge/src-tauri/icons"
SOURCE_PNG = sys.argv[1] if len(sys.argv) > 1 else "/Users/embaobao/workspace/idea/clipforge/new-icon-1024.png"

PNG_SIZES = [
    (32, "32x32.png"),
    (64, "64x64.png"),
    (128, "128x128.png"),
    (256, "128x128@2x.png"),
    (256, "256x256.png"),
    (512, "icon-512.png"),
    (1024, "icon.png"),
    (1024, "icon@1024.png"),
]

ICONSET_DIR = "/tmp/ClipForge.iconset"


def ensure_rgba(img: Image.Image) -> Image.Image:
    if img.mode != "RGBA":
        background = Image.new("RGBA", img.size, (0, 0, 0, 0))
        if img.mode == "RGB":
            background.paste(img, (0, 0))
        else:
            background.paste(img.convert("RGBA"), (0, 0))
        return background
    return img


def make_iconset(source: Image.Image) -> None:
    if os.path.exists(ICONSET_DIR):
        shutil.rmtree(ICONSET_DIR)
    os.makedirs(ICONSET_DIR, exist_ok=True)
    sizes = [
        (16, "icon_16x16.png"),
        (32, "icon_16x16@2x.png"),
        (32, "icon_32x32.png"),
        (64, "icon_32x32@2x.png"),
        (128, "icon_128x128.png"),
        (256, "icon_128x128@2x.png"),
        (256, "icon_256x256.png"),
        (512, "icon_256x256@2x.png"),
        (512, "icon_512x512.png"),
        (1024, "icon_512x512@2x.png"),
    ]
    for px, name in sizes:
        out = source.resize((px, px), Image.LANCZOS)
        out.save(os.path.join(ICONSET_DIR, name), "PNG", optimize=True)


def make_ico(source: Image.Image, out_path: str) -> None:
    sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    source.save(out_path, format="ICO", sizes=sizes)


def main() -> None:
    print(f"读取源图：{SOURCE_PNG}")
    base = Image.open(SOURCE_PNG)
    base = ensure_rgba(base)
    base_1024 = base.resize((1024, 1024), Image.LANCZOS)
    base_1024.save(os.path.join(ICON_DIR, "icon.png"), "PNG", optimize=True)
    base_1024.save(os.path.join(ICON_DIR, "icon@1024.png"), "PNG", optimize=True)
    print("生成 PNG 多尺寸...")
    for px, name in PNG_SIZES:
        if name in {"icon.png", "icon@1024.png"}:
            continue
        out = base_1024.resize((px, px), Image.LANCZOS)
        out.save(os.path.join(ICON_DIR, name), "PNG", optimize=True)
        print(f"  - {name} ({px}x{px})")

    print("生成 macOS icns...")
    make_iconset(base_1024)
    subprocess.run(
        ["iconutil", "-c", "icns", ICONSET_DIR, "-o", os.path.join(ICON_DIR, "icon.icns")],
        check=True,
    )

    print("生成 Windows ico...")
    make_ico(base_1024, os.path.join(ICON_DIR, "icon.ico"))

    print("完成 ✓")


if __name__ == "__main__":
    main()
