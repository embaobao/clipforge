/** pi agent 的剪贴板工具集：把本地剪贴板历史暴露给 Agent 的工具调用框架。
 *  边界：只读工具（搜索/读取）；写回类操作不作为 Agent 工具暴露（避免模型驱动写剪贴板）。 */
import { Type } from "@mariozechner/pi-ai";
import { invoke } from "@tauri-apps/api/core";

type SearchClipsResult = {
  items: Array<{
    id: string;
    content: string;
    payloadKind: string;
    analysis: { title: string; summary: string };
    tags: string[];
  }>;
  nextCursor?: string;
};

/** 按 id 或关键词查询剪贴板历史的 Tauri 命令（透传 search_clip_records）。 */
async function searchClips(input: { text?: string; limit: number }): Promise<SearchClipsResult> {
  return invoke<SearchClipsResult>("search_clip_records", { input });
}

/** 关键词搜索剪贴板历史：返回条目摘要列表（内容截断 600 字符防上下文爆炸）。 */
export const clipboardSearchTool = {
  name: "clipboard_search",
  description:
    "按关键词搜索用户的剪贴板历史（文本/链接/代码/文件路径等条目）。返回匹配条目的 id、类型、标题、摘要与标签。",
  parameters: Type.Object({
    query: Type.String({ description: "搜索关键词（支持条目内容与标题的模糊匹配）" }),
    limit: Type.Optional(Type.Number({ description: "返回条数上限，默认 10，最大 50", minimum: 1, maximum: 50 })),
  }),
  execute: async (_toolCallId: string, params: { query: string; limit?: number }) => {
    const payload = await searchClips({ text: params.query, limit: Math.min(params.limit ?? 10, 50) });
    const items = payload.items.map((item) => ({
      id: item.id,
      payloadKind: item.payloadKind,
      title: item.analysis.title,
      summary: item.analysis.summary,
      tags: item.tags,
      contentPreview: item.content.slice(0, 600),
    }));
    return {
      content: [{ type: "text", text: JSON.stringify(items, null, 2) }],
      details: { count: items.length },
    };
  },
};

/** 读最新一条剪贴板条目（等价于 clipboard_search limit=1 的快捷形态）。 */
export const clipboardReadLatestTool = {
  name: "clipboard_read_latest",
  description: "读取用户最近一条剪贴板条目（id、类型、标题、摘要与全文）。当用户问「我刚复制的内容」或需要最近条目上下文时使用。",
  parameters: Type.Object({}),
  execute: async () => {
    const payload = await searchClips({ limit: 1 });
    const item = payload.items[0];
    const result = item
      ? {
          id: item.id,
          payloadKind: item.payloadKind,
          title: item.analysis.title,
          summary: item.analysis.summary,
          tags: item.tags,
          content: item.content,
        }
      : { empty: true };
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      details: result,
    };
  },
};

/** ClipForge Agent 可用的全部工具（后续新增写回类工具需先过安全评审）。 */
export function clipForgeTools() {
  return [clipboardSearchTool, clipboardReadLatestTool];
}
