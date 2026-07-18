// 统一设置服务前端适配层（settings-service-unified-protocol Phase 4）
//
// 封装 settings_service_* Tauri command，提供 get/patch/replace/reset/agent.* 能力，
// 并暴露 settings_changed 订阅。设置页、Agent 配置区都应通过本服务读写设置，
// 不再各自 invoke 底层命令，保证 schema / revision / redaction / 写入策略一致。
//
// 设计要点（见 openspec/changes/settings-service-unified-protocol/design.md）：
// - 推荐用 patch 局部更新；replace / reset 必须显式 confirmed。
// - schema 按 revision 缓存，同 revision 刷新不重复拉完整 schema。
// - 每次调用记录 durationMs，开发环境超 300ms 输出 warn（300ms 是控制面硬预算）。
// - settings_changed 事件只携带小字段，不含 settings body / schema / apiKey。

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AgentProviderReadiness,
  SettingsChangedEvent,
  SettingsAgentModelsResult,
  SettingsAgentProvidersResult,
  SettingsDocument,
  SettingsPatchRequest,
  SettingsReplaceRequest,
  SettingsResetRequest,
  SettingsWriteResult,
} from "./contracts.js";

const PERF_BUDGET_MS = 300;
const AGENT_OPERATION_TIMEOUT_MS = 3500;

/** 普通浏览器预览没有 Tauri event runtime；设置页截图/Story 只需要跳过订阅。 */
function hasTauriEventRuntime(): boolean {
  const runtime = globalThis as typeof globalThis & {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
  };
  return Boolean(runtime.__TAURI__ || runtime.__TAURI_INTERNALS__);
}

/** 开发环境记录调用耗时，超 300ms 输出 warn。 */
function withTiming<T>(label: string, promise: Promise<T>): Promise<T> {
  const started =
typeof performance !== "undefined" ? performance.now() : Date.now();
  return promise.then((value) => {
    const durationMs =
      ((typeof performance !== "undefined" ? performance.now() : Date.now()) -
        started) |
      0;
    if (durationMs > PERF_BUDGET_MS && import.meta.env?.DEV) {
      console.warn(`[settings] slow ${label} durationMs=${durationMs} > ${PERF_BUDGET_MS}`);
    }
    return value;
  });
}

/** 控制面 Agent 操作不能无限挂起；真实底层调用可能继续完成，但调用方会按请求序号忽略过期结果。 */
function withTimeout<T>(label: string, promise: Promise<T>, timeoutMs = AGENT_OPERATION_TIMEOUT_MS): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`SETTINGS_AGENT_TIMEOUT: ${label} exceeded ${timeoutMs}ms`));
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

/** schema 缓存：同 revision 复用，避免每次表单控件 mount 都拉完整 schema。 */
let cachedSchemaRevision: string | null = null;
let cachedSchema: unknown = null;

export const settingsService = {
  /** 读取设置文档。同 revision 下复用 schema 缓存，减少传输。 */
  async get(includeSchema = true): Promise<SettingsDocument> {
    return withTiming(
      "get",
      invoke<SettingsDocument>("settings_service_get", { includeSchema }),
    ).then((document) => {
      if (includeSchema && document.schema && document.revision) {
        cachedSchemaRevision = document.revision;
        cachedSchema = document.schema;
      } else if (!includeSchema && cachedSchemaRevision === document.revision) {
        // 复用缓存 schema，避免调用方因 includeSchema=false 拿不到 schema 而重复请求。
        document.schema = cachedSchema;
      }
      return document;
    });
  },

  /** 局部更新设置（推荐写入方式）。 */
  patch(request: SettingsPatchRequest): Promise<SettingsWriteResult> {
    return withTiming(
      "patch",
      invoke<SettingsWriteResult>("settings_service_patch", request),
    );
  },

  /** 全量替换设置，必须 confirmed=true。 */
  replace(request: SettingsReplaceRequest): Promise<SettingsWriteResult> {
    return withTiming(
      "replace",
      invoke<SettingsWriteResult>("settings_service_replace", request),
    );
  },

  /** 按 scope 重置设置，必须 confirmed=true。 */
  reset(request: SettingsResetRequest): Promise<SettingsWriteResult> {
    return withTiming(
      "reset",
      invoke<SettingsWriteResult>("settings_service_reset", request),
    );
  },

  /** Agent provider 配置能力；复用 Settings Service 的 redaction / provider 解析边界。 */
  agent: {
    providers(): Promise<SettingsAgentProvidersResult> {
      return withTiming(
        "agent.providers",
        invoke<SettingsAgentProvidersResult>("settings_service_agent_providers"),
      );
    },

    check(providerId?: string | null) {
      return withTimeout(
        "agent.check",
        withTiming(
          "agent.check",
          invoke<AgentProviderReadiness>("settings_service_agent_check", { providerId }),
        ),
      );
    },

    models(providerId?: string | null): Promise<SettingsAgentModelsResult> {
      return withTimeout(
        "agent.models",
        withTiming(
          "agent.models",
          invoke<SettingsAgentModelsResult>("settings_service_agent_models", { providerId }),
        ),
      );
    },
  },

  /** 订阅 settings_changed 事件。返回取消订阅函数。 */
  async subscribe(
    handler: (event: SettingsChangedEvent) => void,
  ): Promise<UnlistenFn> {
    if (!hasTauriEventRuntime()) return () => {};
    return listen<SettingsChangedEvent>("settings_changed", (event) => {
      handler(event.payload);
    });
  },
};

export type { SettingsDocument, SettingsChangedEvent };
