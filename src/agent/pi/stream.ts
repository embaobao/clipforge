/** pi sdk 流式补全封装：与 piComplete 同输入形状，text_delta 事件逐段回调增量文本。
 *  边界：业务代码不直接 import pi-ai 的 stream；onDelta 收到纯文本增量；写完即用，中止后置。 */
import {
  streamSimple,
  type AssistantMessage,
} from "@mariozechner/pi-ai";
import type { AgentProviderConfig } from "./provider-config";
import { resolvePiModel } from "./provider-config";

export type PiStreamInput = {
  system: string;
  prompt: string;
  providerConfig?: AgentProviderConfig;
  apiKey?: string;
  /** 每次增量文本回调（流式渲染用）。 */
  onDelta: (delta: string) => void;
};

/** 流式补全：AsyncIterable 消费 text_delta 事件，resolve 最终完整助手消息。 */
export async function piStream(input: PiStreamInput): Promise<AssistantMessage> {
  const config = input.providerConfig ?? { provider: "anthropic" as const };
  const model = resolvePiModel(config);
  const events = streamSimple(
    model,
    {
      systemPrompt: input.system,
      messages: [
        { role: "user", content: input.prompt, timestamp: Date.now() },
      ],
    },
    input.apiKey ? { apiKey: input.apiKey } : undefined,
  );

  for await (const event of events) {
    if (event.type === "text_delta") {
      input.onDelta(event.delta);
    }
  }

  return events.result();
}
