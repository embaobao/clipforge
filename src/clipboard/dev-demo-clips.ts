/** 浏览器开发预览的演示数据源（dev-only）。
 *  仅作为数据源头供 web mock 服务播种使用；生产与 Tauri 运行时不会走到这里。 */
export type DemoClipSource = {
  content: string;
  favorite?: boolean;
  deletedAt?: number;
  sourceLabel?: string;
  minutesAgo: number;
};

/** 演示条目源数据：覆盖主面板全部行类型（文本/代码/链接/Markdown/表格/JSON/图片/文件/收藏/回收站）。 */
export const DEMO_CLIP_SOURCES: DemoClipSource[] = [
  {
    content:
      "设计走查：主面板在 420×400 悬浮窗下的视觉与交互验收 —— 搜索、行内操作、多选、回收站全链路",
    favorite: true,
    sourceLabel: "备忘录",
    minutesAgo: 2,
  },
  {
    content:
      "pnpm tauri dev\n\npnpm build\ncd src-tauri && cargo check\n\n# 涉及原生能力时启动完整验证",
    sourceLabel: "终端",
    minutesAgo: 9,
  },
  {
    content: "https://ui.shadcn.com/docs/components/dropdown-menu",
    sourceLabel: "Chrome",
    minutesAgo: 16,
  },
  {
    content:
      "## 发布检查清单\n\n- [x] 单文件 ≤ 500 行\n- [x] 中文注释覆盖公共能力\n- [ ] 悬浮窗小尺寸走查\n- [ ] pnpm build + cargo check",
    sourceLabel: "Obsidian",
    minutesAgo: 28,
  },
  {
    content: "名称\t状态\t负责人\n样式重建\t进行中\t设计\n交互闭环\t待验证\t前端\n小窗适配\t已完成\t前端",
    sourceLabel: "Numbers",
    minutesAgo: 41,
  },
  {
    content: "{\"name\":\"ClipForge\",\"stack\":[\"Tauri v2\",\"React\",\"Tailwind\"],\"goal\":\"替代 Clipy 核心能力\"}",
    sourceLabel: "VS Code",
    minutesAgo: 55,
  },
  {
    content: "截图 2026-09-24 15.58.27.png",
    sourceLabel: "访达",
    minutesAgo: 73,
  },
  {
    content: "/Users/embaobao/workspace/idea/clipforge/AGENTS.md",
    sourceLabel: "访达",
    minutesAgo: 96,
  },
  {
    content: "Wednesday standup moved to 10:30, bring the metrics dashboard link.",
    sourceLabel: "Slack",
    deletedAt: 1,
    minutesAgo: 130,
  },
  {
    content: "git log --oneline -5 && git status --short",
    sourceLabel: "终端",
    deletedAt: 1,
    minutesAgo: 150,
  },
  {
    content: "记住：Cmd+Shift+V 唤起面板，⌘K 打开全部操作，空格快速预览选中条目。",
    favorite: true,
    sourceLabel: "备忘录",
    minutesAgo: 190,
  },
];
