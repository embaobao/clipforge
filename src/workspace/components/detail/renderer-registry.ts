/** 详情页类型渲染注册表（设计 §6）：宿主内置 8 分支迁移为声明式 matcher，
 *  resolve 顺序 payloadKind 精确 > extensions/mime > heuristic，同层按 order 升序。
 *  迁移行为零变化：golden 测试锁命中顺序（scripts 迁移前 if/else 语义）。
 *  插件 detail-renderer 经 mergePluginRenderers 声明式合入（无函数 matcher，组件白名单）。 */
import type { ClipItem } from "../../../App";
import { isLikelyJson, isLikelyMarkdown } from "../workspace-detail-shared";

/** 白名单渲染组件名（宿主编译期集合，插件只能引用不能新增）。 */
export type DetailRendererComponent =
  | "readonly-image"
  | "file-list"
  | "image-url"
  | "html"
  | "link"
  | "json-tree"
  | "markdown"
  | "smart-format";

export type DetailRendererMatch = {
  payloadKind?: ClipItem["payloadKind"];
  extensions?: string[];
  mimePrefix?: string;
  /** 仅宿主内置可用：插件声明经运行时剔除。 */
  heuristic?: (clip: ClipItem) => boolean;
  order?: number;
};

export type DetailRendererEntry = {
  id: string;
  match: DetailRendererMatch;
  component: DetailRendererComponent;
};

/** 宿主内置渲染表：顺序即迁移前 if/else 链（golden 依据，勿调整顺序）。 */
export const builtinRenderers: DetailRendererEntry[] = [
  { id: "builtin.image", match: { payloadKind: "image", order: 100 }, component: "readonly-image" },
  { id: "builtin.file", match: { payloadKind: "file", order: 100 }, component: "file-list" },
  {
    id: "builtin.image-url",
    match: {
      heuristic: (clip) =>
        Boolean(clip.analysis.attachment?.isImage && clip.analysis.attachment.targetType === "url"),
      order: 100,
    },
    component: "image-url",
  },
  { id: "builtin.html", match: { payloadKind: "html", order: 100 }, component: "html" },
  {
    id: "builtin.link",
    match: {
      heuristic: (clip) => Boolean(clip.analysis.url) || clip.kind === "link",
      order: 100,
    },
    component: "link",
  },
  { id: "builtin.json", match: { heuristic: (clip) => isLikelyJson(clip), order: 100 }, component: "json-tree" },
  {
    id: "builtin.markdown",
    match: { heuristic: (clip) => isLikelyMarkdown(clip), order: 100 },
    component: "markdown",
  },
  { id: "builtin.fallback", match: { order: 900 }, component: "smart-format" },
];

/** 插件渲染项声明（运行时侧 manifest → 宿主纯数据；无函数/组件引用）。 */
export type PluginRendererDeclaration = {
  id: string;
  match: Omit<DetailRendererMatch, "heuristic">;
  component: DetailRendererComponent;
};

/** 合并宿主与插件渲染表：剔除插件函数 matcher；image 恒由宿主渲染（信任边界）。 */
export function mergePluginRenderers(
  plugins: PluginRendererDeclaration[],
  base: DetailRendererEntry[] = builtinRenderers,
): DetailRendererEntry[] {
  const safe: DetailRendererEntry[] = plugins
    .filter((plugin) => plugin.match.payloadKind !== "image")
    .map((plugin) => ({ id: plugin.id, match: { ...plugin.match, order: plugin.match.order ?? 200 }, component: plugin.component }));
  return [...base, ...safe];
}

/** 解析条目命中的渲染项：payloadKind 精确 > extensions/mime > heuristic > 兜底。 */
export function resolveDetailRenderer(
  clip: ClipItem,
  renderers: DetailRendererEntry[] = builtinRenderers,
): DetailRendererEntry {
  let best: DetailRendererEntry | null = null;
  let bestScore = -1;
  for (const entry of renderers) {
    let score = -1;
    if (entry.match.payloadKind && entry.match.payloadKind === clip.payloadKind) score = 3;
    else if (entry.match.extensions || entry.match.mimePrefix) {
      const fileName = clip.representations?.find((rep) => rep.format === "application/file-list")?.fileName;
      const ext = fileName?.slice(fileName.lastIndexOf(".")).toLowerCase() ?? "";
      if (ext && entry.match.extensions?.includes(ext)) score = 2;
      else if (entry.match.mimePrefix && clip.primaryFormat.startsWith(entry.match.mimePrefix)) score = 2;
    }
    if (score < 0 && entry.match.heuristic?.(clip)) score = 1;
    // 无任何条件 = 兜底，分数 0。
    if (score < 0 && !entry.match.payloadKind && !entry.match.extensions && !entry.match.mimePrefix && !entry.match.heuristic) score = 0;
    if (score < 0) continue;
    const rank = score * 1000 + (entry.match.order ?? 100);
    if (rank > bestScore) {
      best = entry;
      bestScore = rank;
    }
  }
  return best ?? renderers[renderers.length - 1];
}
