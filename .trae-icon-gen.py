#!/usr/bin/env python3
"""生成符合 macOS 风格的 ClipForge 应用图标"""
import os
import subprocess
from PIL import Image, ImageDraw, ImageFilter

SIZE = 1024
CORNER_RADIUS_RATIO = 0.2237
BOARD_RATIO = 0.65

BG_GRADIENT_TOP = (28, 28, 36, 255)
BG_GRADIENT_BOTTOM = (54, 42, 88, 255)
BOARD_GRADIENT_TOP = (98, 130, 240, 255)
BOARD_GRADIENT_BOTTOM = (160, 80, 220, 255)


def lerp_color(c1, c2, t):
    return tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(len(c1)))


def rounded_rectangle_mask(size, radius):
    mask = Image.new("L", size, 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle([(0, 0), (size[0] - 1, size[1] - 1)], radius=radius, fill=255)
    return mask


def draw_gradient(size, top_color, bottom_color, direction="vertical"):
    width, height = size
    img = Image.new("RGBA", size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    steps = height if direction == "vertical" else width
    for i in range(steps):
        t = i / max(1, steps - 1)
        color = lerp_color(top_color, bottom_color, t)
        if direction == "vertical":
            draw.line([(0, i), (width, i)], fill=color)
        else:
            draw.line([(i, 0), (i, height)], fill=color)
    return img


def create_base_icon(size):
    s = size
    radius = int(s * CORNER_RADIUS_RATIO)
    bg = draw_gradient((s, s), BG_GRADIENT_TOP, BG_GRADIENT_BOTTOM, "vertical")
    highlight = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    hdraw = ImageDraw.Draw(highlight)
    for i in range(s // 2):
        t = i / (s // 2)
        alpha = int(60 * (1 - t) ** 1.5)
        hdraw.line([(0, i), (s, i)], fill=(255, 255, 255, alpha))
    bg = Image.alpha_composite(bg, highlight)
    mask = rounded_rectangle_mask((s, s), radius)
    result = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    result.paste(bg, (0, 0), mask)
    return result


def draw_clipboard(canvas, s):
    draw = ImageDraw.Draw(canvas)
    board_w = int(s * BOARD_RATIO)
    board_h = int(board_w * 1.25)
    board_x = (s - board_w) // 2
    board_y = (s - board_h) // 2
    board_radius = int(board_w * 0.12)
    board = draw_gradient((board_w, board_h), BOARD_GRADIENT_TOP, BOARD_GRADIENT_BOTTOM, "vertical")
    shadow = Image.new("RGBA", (board_w + 20, board_h + 20), (0, 0, 0, 0))
    sdraw = ImageDraw.Draw(shadow)
    sdraw.rounded_rectangle(
        [(10, 14), (board_w + 9, board_h + 13)],
        radius=board_radius,
        fill=(0, 0, 0, 120),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(8))
    canvas.alpha_composite(shadow, (board_x - 10, board_y - 10))
    board_mask = rounded_rectangle_mask((board_w, board_h), board_radius)
    canvas.paste(board, (board_x, board_y), board_mask)

    clip_w = int(board_w * 0.5)
    clip_h = int(board_w * 0.12)
    clip_x = board_x + (board_w - clip_w) // 2
    clip_y = board_y - int(clip_h * 0.3)
    clip_radius = int(clip_h * 0.3)
    clip = Image.new("RGBA", (clip_w, clip_h), (0, 0, 0, 0))
    cdraw = ImageDraw.Draw(clip)
    cdraw.rounded_rectangle(
        [(0, 0), (clip_w - 1, clip_h - 1)],
        radius=clip_radius,
        fill=(255, 255, 255, 235),
    )
    canvas.alpha_composite(clip, (clip_x, clip_y))

    line_pad = int(board_w * 0.16)
    line_top = board_y + int(board_h * 0.32)
    line_left = board_x + line_pad
    line_right = board_x + board_w - line_pad
    line_h = max(3, int(s * 0.008))
    line_gap = int(s * 0.025)
    for i in range(3):
        y = line_top + i * line_gap
        line_w = line_right - line_left - (i * int(line_gap * 2))
        if line_w < int(board_w * 0.3):
            line_w = int(board_w * 0.3)
        draw.rounded_rectangle(
            [(line_left, y), (line_left + line_w, y + line_h)],
            radius=line_h // 2,
            fill=(255, 255, 255, 160),
        )

    check_size = int(board_w * 0.45)
    cx, cy = s // 2, board_y + int(board_h * 0.65)
    check_thickness = max(4, int(check_size * 0.16))
    p1 = (cx - check_size // 3, cy)
    p2 = (cx - check_size // 8, cy + check_size // 4)
    p3 = (cx + check_size // 3, cy - check_size // 5)
    draw.line([p1, p2], fill=(255, 255, 255, 255), width=check_thickness)
    draw.line([p2, p3], fill=(255, 255, 255, 255), width=check_thickness)
    r = check_thickness // 2
    for pt in [p1, p3]:
        draw.ellipse(
            [(pt[0] - r, pt[1] - r), (pt[0] + r, pt[1] + r)],
            fill=(255, 255, 255, 255),
        )
    p2r = int(check_thickness * 0.6)
    draw.ellipse(
        [(p2[0] - p2r, p2[1] - p2r), (p2[0] + p2r, p2[1] + p2r)],
        fill=(255, 255, 255, 255),
    )

    gloss = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(gloss)
    for i in range(s // 3):
        t = i / (s // 3)
        alpha = int(35 * (1 - t) ** 2)
        gdraw.line([(0, i), (s, i)], fill=(255, 255, 255, alpha))
    canvas.alpha_composite(gloss, (0, 0))


def create_icon(size):
    canvas = create_base_icon(size)
    draw_clipboard(canvas, size)
    return canvas


def make_icns(png_path, icns_path):
    iconset_dir = "/tmp/ClipForge.iconset"
    os.makedirs(iconset_dir, exist_ok=True)
    sizes = [
        (16, "16x16"),
        (32, "16x16@2x"),
        (32, "32x32"),
        (64, "32x32@2x"),
        (128, "128x128"),
        (256, "128x128@2x"),
        (256, "256x256"),
        (512, "256x256@2x"),
        (512, "512x512"),
        (1024, "512x512@2x"),
    ]
    base_img = Image.open(png_path)
    for px, name in sizes:
        out = base_img.resize((px, px), Image.LANCZOS)
        out.save(os.path.join(iconset_dir, f"icon_{name}.png"), "PNG")
    subprocess.run(
        ["iconutil", "-c", "icns", iconset_dir, "-o", icns_path],
        check=True,
    )


def make_ico(png_path, ico_path):
    base_img = Image.open(png_path)
    sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    base_img.save(ico_path, format="ICO", sizes=sizes)


def main():
    out_dir = "/Users/embaobao/workspace/idea/clipforge/src-tauri/icons"
    print("生成 1024x1024 主图...")
    icon_1024 = create_icon(1024)
    icon_1024.save(os.path.join(out_dir, "icon.png"), "PNG", optimize=True)
    icon_1024.save(os.path.join(out_dir, "icon@1024.png"), "PNG", optimize=True)
    sizes = [32, 64, 128, 256, 512]
    for sz in sizes:
        print(f"生成 {sz}x{sz}...")
        icon = create_icon(sz)
        if sz == 128:
            icon.save(os.path.join(out_dir, "128x128.png"), "PNG", optimize=True)
        if sz == 32:
            icon.save(os.path.join(out_dir, "32x32.png"), "PNG", optimize=True)
        if sz == 64:
            icon.save(os.path.join(out_dir, "128x128@2x.png"), "PNG", optimize=True)
        if sz == 256:
            icon.save(os.path.join(out_dir, "256x256.png"), "PNG", optimize=True)
        if sz == 512:
            icon.save(os.path.join(out_dir, "icon-512.png"), "PNG", optimize=True)
    print("生成 macOS icns...")
    make_icns(os.path.join(out_dir, "icon.png"), os.path.join(out_dir, "icon.icns"))
    print("生成 Windows ico...")
    make_ico(os.path.join(out_dir, "icon.png"), os.path.join(out_dir, "icon.ico"))
    print("完成")


if __name__ == "__main__":
    main()
