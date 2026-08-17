/**
 * @clipforge/dsh-plugin —— ClipForge 的 DSH（DeepSeek Harness）集成插件。
 *
 * 设计要点（盟哥 2026-08-17 决策：DSH 直接引用、通过它的插件做集成，不自己维护 prompt/解析）：
 * 1. 只注册一个 Cordis 工具 `clipboard_analyze`。模型调用该工具时填写的结构化字段，
 *    由 DSH 的 `output.schema`（JSON Schema）强校验 —— 结构化输出由 DSH 保证，Rust 侧不再手写正则。
 * 2. 本插件同时充当一次性 runner（替代 dsh-headless 的 headless-runner）：在 `apply` 阶段
 *    创建 Agent、把 task（剪贴板内容+分析指令）喂给模型、等待其调用 `clipboard_analyze` 工具，
 *    收集经 schema 校验后的结构化结果，打印 `DSH_RESULT::<json>` 一行并退出。
 * 3. 只读红线：profile 不挂载 bash/fs/web 执行类插件的能力边界由 DSH 自身控制；
 *    SKILL.md 进一步约束模型只做基于给定内容的只读分析。
 *
 * @module @clipforge/dsh-plugin
 */
import { defineTool } from "@deepseek-ai/dsh-tools";
import z from "@deepseek-ai/schemastery";
import { randomUUID } from "node:crypto";
import { SessionId } from "@deepseek-ai/dsh-session";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { installModelSelection } from "@deepseek-ai/dsh-agent";

/** 稳定 Cordis 插件名。 */
const name = "clipforge-dsh";

/** 本插件 mount 时需要的核心服务（由 dsh-base bundle 提供）。 */
const inject = ["agents", "agentDefaultModel", "sessions", "tools"];

/** 插件配置：task 可由 profile 的 cordis.patch.yml 通过 `!!js` 注入，否则回退到进程 argv。
 *  schemastery 中字段默认即可选（无 .optional() 方法），需要回退值用 .default()。 */
const Config = z.object({
  task: z.string().default(""),
});

/**
 * 模块级结果收集：模型调用 `clipboard_analyze` 工具时，`execute` 在 Agent 子上下文内运行，
 * 把经 schema 校验后的参数存到这里；runner 在 Agent 空闲后读取并输出。
 * 单进程单次分析，模块级变量足够，且避免依赖 stdout 文本解析。
 */
let captured = null;

/**
 * 注册 `clipboard_analyze` 工具并启动一次性分析。
 * @param {import('@deepseek-ai/cordis').Context} ctx - 已 settle 的 Cordis 上下文
 * @param {{ task?: string }} config - 插件配置（task 可选）
 */
function apply(ctx, config = {}) {
  // 常驻服务模式（sidecar --serve）：本插件只注册工具，交给 dsh-web-app 的 web carrier
  // 提供官方 Web UI；绝不跑一次性分析、绝不 process.exit，否则会杀掉常驻进程。
  const isServeMode = process.argv.includes("--serve");

  // —— 1. 注册工具：参数经 JSON Schema 校验，返回值经 output.schema 强校验 ——
  // 注意：defineTool 的 parameters 是「属性映射对象」，每个值是 JSON-Schema 形态的值 schema
  //（DSH 内部用 isJsonSchemaRecord 校验，不认 schemastery 的 z.object 包裹）。
  const analyzeTool = defineTool({
    name: "clipboard_analyze",
    description:
      "分析剪贴板内容后必须调用本工具提交结构化结果。一次性给出 summary / category / tags / suggestedFolder / extracted 全部字段。",
    parameters: {
      summary: { type: "string", required: true, description: "一句话摘要剪贴板内容" },
      category: { type: "string", required: true, description: "内容分类，如 会议/联系人/链接/代码/待办" },
      tags: { type: "array", items: { type: "string" }, description: "自由标签列表" },
      suggestedFolder: { type: "string", description: "建议归档到的文件夹名（可选）" },
      extracted: {
        type: "object",
        additionalProperties: false,
        description: "从内容中抽取的结构化信息",
        properties: {
          urls: { type: "array", items: { type: "string" } },
          emails: { type: "array", items: { type: "string" } },
          phones: { type: "array", items: { type: "string" } },
          keys: { type: "object", additionalProperties: true },
        },
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          summary: { type: "string" },
          category: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          suggestedFolder: { type: "string" },
          extracted: { type: "object", additionalProperties: true },
        },
      },
      render: (_args, value) => [
        { type: "text", text: `分析完成：${value?.summary ?? ""}` },
      ],
    },
    async execute(args) {
      captured = {
        summary: args.summary,
        category: args.category,
        tags: args.tags ?? [],
        suggestedFolder: args.suggestedFolder ?? null,
        extracted: args.extracted ?? {},
      };
      return captured;
    },
  });
  ctx.tools.register(analyzeTool);

  // 常驻服务模式：仅注册工具即返回，web carrier 自行持有事件循环。
  if (isServeMode) return;

  // —— 2. 一次性 runner：task 优先取 argv[2]（sidecar 传入），否则取插件配置 ——
  // 注意：常驻服务模式（sidecar --serve）下 argv[2] 是 --serve 这类 flag，
  // 不能当作分析任务；以 '-' 开头的参数视为非任务，回退到空（web carrier 仅注册工具）。
  const rawArg = process.argv[2];
  const task = rawArg && !rawArg.startsWith("-") ? rawArg : (config.task ?? "");
  if (!task.trim()) {
    emitDegraded("empty_task", "未提供 task（剪贴板内容）");
    return;
  }
  // run 内部自行管理生命周期并以 DSH_RESULT:: 行收尾（成功或降级），不在 apply 层 await。
  run(ctx, task).catch((err) => {
    emitDegraded("unexpected", err?.stack ?? err?.message ?? String(err));
  });
}

/**
 * 把分析结果以 `DSH_RESULT::<json>` 单行写入 stdout，再退出。
 * 必须用 write 回调后退出，确保该行在被 process.exit 杀掉前已 flush。
 * @param {object} result
 */
function emit(result) {
  process.stdout.write("DSH_RESULT::" + JSON.stringify(result) + "\n", () => process.exit(0));
}

/** 产出降级结果（无 key / 配额 / 网络 / 模型未调用工具等），让 Rust 侧总有可解析结果。
 *  字段名用 errorCode 以匹配 Rust 侧 DshAnalyzeResult.error_code 的解析。 */
function emitDegraded(reason, message) {
  emit({ degraded: true, errorCode: reason, message: String(message ?? "") });
}

/**
 * 创建 Agent、驱动一次分析、收集结构化结果并退出。
 * 样板复用自 @deepseek-ai/dsh-headless（headless-runner），但改为捕获工具结果而非打印模型文本。
 * 任何模型/网络/鉴权错误都被捕获并降级输出，不抛出到进程层。
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {string} task
 */
async function run(ctx, task) {
  const agents = ctx.get("agents");
  const defaultModel = ctx.get("agentDefaultModel");
  const sessions = ctx.get("sessions");
  if (agents === undefined || defaultModel === undefined || sessions === undefined) {
    emitDegraded("missing_service", "缺失核心服务 agents / agentDefaultModel / sessions");
    return;
  }
  try {
    const selection = defaultModel.currentSelection();
    const { agent } = await agents.create({
      sessionId: SessionId(`session-${randomUUID()}`),
      meta: { cwd: process.cwd() },
      agentOptions: {
        provider: selection.provider,
        model: selection.model,
      },
      setup: (agentCtx) => {
        installModelSelection(agentCtx, { current: selection, assembled: void 0 });
      },
    });
    await agent.whenIdle();
    agent.followup(
      createUserMessage({
        content: [{ type: "text", text: task }],
        source: { kind: "user" },
      }),
    );
    await agent.whenIdle();
    await sessions.flush(agent.session);
  } catch (err) {
    // 无 key / 配额超限 / 网络不通等：降级而非崩溃，Rust 侧据此提示用户配置模型。
    emitDegraded("llm_error", err?.message ?? String(err));
    return;
  }

  const result = captured ?? { degraded: true, errorCode: "model_did_not_call_tool" };
  emit(result);
}

// Cordis Loader 取 default export 作为插件对象（与 dsh-base 各 bundle 的 `X as default` 一致）。
export default { name, inject, Config, apply };
