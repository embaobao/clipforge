import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const sourcePath = path.join(root, "icons.png");
const bannerPath = path.join(root, "banner.png");
const outputRoot = path.join(root, "assets", "brand");
const sourceOutputRoot = path.join(outputRoot, "source");
const iconOutputRoot = path.join(outputRoot, "icons");

const icons = [
  ["clipboard-history", "剪贴板历史"],
  ["text", "文本"],
  ["image", "图片"],
  ["code", "代码"],
  ["file", "文件"],
  ["link", "链接"],
  ["pin", "固定"],
  ["favorite", "收藏"],
  ["later", "稍后查看"],
  ["delete", "删除"],
  ["search", "搜索"],
  ["filter", "筛选"],
  ["sync", "同步"],
  ["devices", "多端设备"],
  ["cross-platform", "跨平台"],
  ["import", "导入"],
  ["export", "导出"],
  ["copy", "复制"],
  ["success", "成功"],
  ["info", "信息"],
  ["warning", "警告"],
  ["error", "错误"],
  ["lock", "加密"],
  ["security", "安全"],
  ["agent-access", "Agent 访问"],
  ["chat", "对话"],
  ["integration", "集成"],
  ["api", "API"],
  ["database", "数据"],
  ["settings", "设置"],
];

const cols = 6;
const rows = 5;
const backgroundThreshold = 246;
const bboxAlphaThreshold = 12;

function isBackground(pixel) {
  const [r, g, b] = pixel;
  return r >= backgroundThreshold && g >= backgroundThreshold && b >= backgroundThreshold;
}

function floodBackgroundAlpha(data, width, height) {
  const visited = new Uint8Array(width * height);
  const queue = [];

  function push(x, y) {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const index = y * width + x;
    if (visited[index]) return;
    const offset = index * 4;
    if (!isBackground([data[offset], data[offset + 1], data[offset + 2]])) return;
    visited[index] = 1;
    queue.push(index);
  }

  for (let x = 0; x < width; x += 1) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    push(0, y);
    push(width - 1, y);
  }

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const index = queue[cursor];
    const x = index % width;
    const y = Math.floor(index / width);
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }

  for (let index = 0; index < visited.length; index += 1) {
    if (visited[index]) {
      data[index * 4 + 3] = 0;
    }
  }
}

function findBoundingBox(data, width, height) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha > bboxAlphaThreshold) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    return { left: 0, top: 0, width, height };
  }

  return {
    left: minX,
    top: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

async function makeCanvas(buffer, size) {
  const inner = Math.round(size * 0.76);
  const resized = await sharp(buffer)
    .resize(inner, inner, {
      fit: "inside",
      kernel: "nearest",
      withoutEnlargement: false,
    })
    .png()
    .toBuffer();
  const metadata = await sharp(resized).metadata();
  const left = Math.floor((size - (metadata.width ?? inner)) / 2);
  const top = Math.floor((size - (metadata.height ?? inner)) / 2);
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 0 },
    },
  })
    .composite([{ input: resized, left, top }])
    .png()
    .toBuffer();
}

await fs.rm(iconOutputRoot, { recursive: true, force: true });
await fs.mkdir(path.join(iconOutputRoot, "256"), { recursive: true });
await fs.mkdir(path.join(iconOutputRoot, "512"), { recursive: true });
await fs.mkdir(path.join(iconOutputRoot, "trimmed"), { recursive: true });
await fs.mkdir(sourceOutputRoot, { recursive: true });

await fs.copyFile(sourcePath, path.join(sourceOutputRoot, "icons-sheet.png"));

await sharp(bannerPath)
  .resize(1280, 640, { fit: "cover", position: "center" })
  .png()
  .toFile(path.join(outputRoot, "clipforge-banner.png"));

const source = sharp(sourcePath).ensureAlpha();
const metadata = await source.metadata();
const width = metadata.width ?? 0;
const height = metadata.height ?? 0;
const cellWidth = width / cols;
const cellHeight = height / rows;
const manifest = [];

for (let row = 0; row < rows; row += 1) {
  for (let col = 0; col < cols; col += 1) {
    const index = row * cols + col;
    const [slug, label] = icons[index];
    const left = Math.round(col * cellWidth);
    const top = Math.round(row * cellHeight);
    const right = Math.round((col + 1) * cellWidth);
    const bottom = Math.round((row + 1) * cellHeight);
    const cell = {
      left,
      top,
      width: right - left,
      height: bottom - top,
    };
    const iconBandHeight = Math.min(cell.height - 26, Math.round(cell.height * 0.84));
    const crop = {
      left: cell.left,
      top: cell.top,
      width: cell.width,
      height: iconBandHeight,
    };

    const raw = await sharp(sourcePath)
      .ensureAlpha()
      .extract(crop)
      .raw()
      .toBuffer({ resolveWithObject: true });
    const data = Buffer.from(raw.data);
    floodBackgroundAlpha(data, raw.info.width, raw.info.height);

    const bbox = findBoundingBox(data, raw.info.width, raw.info.height);
    const padding = 8;
    const trim = {
      left: Math.max(0, bbox.left - padding),
      top: Math.max(0, bbox.top - padding),
      width: Math.min(raw.info.width - Math.max(0, bbox.left - padding), bbox.width + padding * 2),
      height: Math.min(raw.info.height - Math.max(0, bbox.top - padding), bbox.height + padding * 2),
    };

    const transparentCrop = await sharp(data, {
      raw: {
        width: raw.info.width,
        height: raw.info.height,
        channels: 4,
      },
    })
      .extract(trim)
      .png()
      .toBuffer();

    const trimmedPath = path.join(iconOutputRoot, "trimmed", `${slug}.png`);
    const path256 = path.join(iconOutputRoot, "256", `${slug}.png`);
    const path512 = path.join(iconOutputRoot, "512", `${slug}.png`);
    await fs.writeFile(trimmedPath, transparentCrop);
    await fs.writeFile(path256, await makeCanvas(transparentCrop, 256));
    await fs.writeFile(path512, await makeCanvas(transparentCrop, 512));

    manifest.push({
      slug,
      label,
      source: "assets/brand/source/icons-sheet.png",
      sourceCell: { row: row + 1, col: col + 1 },
      crop,
      trim,
      outputs: {
        "256": `assets/brand/icons/256/${slug}.png`,
        "512": `assets/brand/icons/512/${slug}.png`,
        trimmed: `assets/brand/icons/trimmed/${slug}.png`,
      },
    });
  }
}

await fs.writeFile(
  path.join(iconOutputRoot, "manifest.json"),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), source: "icons.png", icons: manifest }, null, 2)}\n`,
);

const rowsMd = manifest
  .map(
    (item) =>
      `| ${item.label} | \`${item.slug}\` | \`${item.outputs["256"]}\` | \`${item.outputs["512"]}\` | ${item.sourceCell.row}/${item.sourceCell.col} |`,
  )
  .join("\n");

await fs.writeFile(
  path.join(outputRoot, "ASSETS.md"),
  `# ClipForge Brand Assets\n\n` +
    `本目录保存从根目录视觉源文件派生出的正式品牌资源。根目录原始图不直接改动；需要更新资源时，重新运行 \`node scripts/extract-brand-icons.mjs\`。\n\n` +
    `## Primary Assets\n\n` +
    `| Asset | Path | Usage |\n` +
    `| --- | --- | --- |\n` +
    `| Product banner | \`assets/brand/clipforge-banner.png\` | README 顶部封面、GitHub social preview 候选 |\n` +
    `| Icon sheet source copy | \`assets/brand/source/icons-sheet.png\` | 图标集裁切母版备份 |\n\n` +
    `## Icon Set\n\n` +
    `所有图标都输出为透明底 PNG，并统一居中到 256 和 512 方形画布。\n\n` +
    `| Name | Slug | 256px | 512px | Source cell row/col |\n` +
    `| --- | --- | --- | --- | --- |\n` +
    `${rowsMd}\n`,
);
