/**
 * OCR 错误提示脱敏编排（clipboard-interaction-repair 第 3 项，提案 §14 / §27）。
 *
 * 背景：Rust `ocr_extract` 以 `OCR_<CODE>: <detail>` 返回失败，detail 常含本地端点
 * URL、图片绝对路径、端口与 HTTP 响应片段。旧实现把 `truncateText(String(error), 120)`
 * 直接塞进 toast，既截断原因又泄露本机信息，且没有关闭入口与可复制修复方案。
 *
 * 本模块是零依赖纯函数：把任意异常收敛成「白名单错误码 + 静态 i18n 文案」，
 * 输出中绝不混入原始 detail。所有用户可见文案由调用方注入的 translate 提供，
 * 便于静态单测独立编译（tsc 单文件），也便于门禁验证 i18n key 对齐。
 * 边界：只做展示与复制的文本编排，不做端点探测、配置修改或任何外部调用。
 */

/** Rust 侧 `src-tauri/src/ocr/*.rs` 冻结的 14 个 `OCR_*` 错误码（含 macOS Vision 内置路径）。
 *  与 `scripts/verify-ocr-error-guidance.mjs` 的源码一致性断言互相校验，新增错误码必须两处同步。 */
export const OCR_ERROR_CODES = [
  "OCR_BAD_RESPONSE",
  "OCR_BUILTIN_FAILED",
  "OCR_BUILTIN_NO_TEXT",
  "OCR_BUILTIN_UNAVAILABLE",
  "OCR_CLIENT_BUILD_FAILED",
  "OCR_DB_ERROR",
  "OCR_DISABLED",
  "OCR_ENDPOINT_ERROR",
  "OCR_ENDPOINT_NOT_LOCAL",
  "OCR_ENDPOINT_UNAVAILABLE",
  "OCR_IMAGE_READ_FAILED",
  "OCR_IMAGE_TOO_LARGE",
  "OCR_NOT_AN_IMAGE",
  "OCR_TIMEOUT",
] as const;

/** 白名单内的稳定错误码。 */
export type OcrErrorCode = (typeof OCR_ERROR_CODES)[number];

/** 解析结果：未知码、非 OCR 码、无前缀异常一律收敛为 UNKNOWN，不回传任何原始 detail。 */
export type ResolvedOcrCode = OcrErrorCode | "UNKNOWN";

/**
 * 每个错误码对应的静态文案 key。
 * reasonKey 逐码精确描述原因；fixKey 按修复策略分组复用，避免 14 份重复步骤。
 * key 值均为 `main.error.ocr.*` 下的字面量，由 verify-ocr-error-guidance.mjs 断言两个语言字典都存在。
 */
export const OCR_GUIDANCE_KEYS: Record<OcrErrorCode, { reasonKey: string; fixKey: string }> = {
  OCR_BAD_RESPONSE: { reasonKey: "main.error.ocr.reason.BAD_RESPONSE", fixKey: "main.error.ocr.fix.response" },
  OCR_BUILTIN_FAILED: { reasonKey: "main.error.ocr.reason.BUILTIN_FAILED", fixKey: "main.error.ocr.fix.builtin" },
  OCR_BUILTIN_NO_TEXT: { reasonKey: "main.error.ocr.reason.BUILTIN_NO_TEXT", fixKey: "main.error.ocr.fix.builtin" },
  OCR_BUILTIN_UNAVAILABLE: { reasonKey: "main.error.ocr.reason.BUILTIN_UNAVAILABLE", fixKey: "main.error.ocr.fix.builtin" },
  OCR_CLIENT_BUILD_FAILED: { reasonKey: "main.error.ocr.reason.CLIENT_BUILD_FAILED", fixKey: "main.error.ocr.fix.response" },
  OCR_DB_ERROR: { reasonKey: "main.error.ocr.reason.DB_ERROR", fixKey: "main.error.ocr.fix.internal" },
  OCR_DISABLED: { reasonKey: "main.error.ocr.reason.DISABLED", fixKey: "main.error.ocr.fix.config" },
  OCR_ENDPOINT_ERROR: { reasonKey: "main.error.ocr.reason.ENDPOINT_ERROR", fixKey: "main.error.ocr.fix.endpoint" },
  OCR_ENDPOINT_NOT_LOCAL: { reasonKey: "main.error.ocr.reason.ENDPOINT_NOT_LOCAL", fixKey: "main.error.ocr.fix.endpoint" },
  OCR_ENDPOINT_UNAVAILABLE: { reasonKey: "main.error.ocr.reason.ENDPOINT_UNAVAILABLE", fixKey: "main.error.ocr.fix.endpoint" },
  OCR_IMAGE_READ_FAILED: { reasonKey: "main.error.ocr.reason.IMAGE_READ_FAILED", fixKey: "main.error.ocr.fix.image" },
  OCR_IMAGE_TOO_LARGE: { reasonKey: "main.error.ocr.reason.IMAGE_TOO_LARGE", fixKey: "main.error.ocr.fix.image" },
  OCR_NOT_AN_IMAGE: { reasonKey: "main.error.ocr.reason.NOT_AN_IMAGE", fixKey: "main.error.ocr.fix.image" },
  OCR_TIMEOUT: { reasonKey: "main.error.ocr.reason.TIMEOUT", fixKey: "main.error.ocr.fix.endpoint" },
};

/** UNKNOWN 兜底文案 key：原因只说「未识别」，不引用异常里的任何动态内容。 */
export const OCR_UNKNOWN_KEYS = {
  reasonKey: "main.error.ocr.reason.UNKNOWN",
  fixKey: "main.error.ocr.fix.unknown",
} as const;

/** 可复制诊断文本的公共文案 key：标题、标签、脱敏声明，以及复制按钮 / 反馈 / 兜底文案。
 *  统一登记便于 verify-ocr-error-guidance.mjs 断言中英字典齐全。 */
export const OCR_COPY_KEYS = {
  title: "main.error.ocr.copyTitle",
  codeLabel: "main.error.ocr.codeLabel",
  reasonLabel: "main.error.ocr.reasonLabel",
  fixLabel: "main.error.ocr.fixLabel",
  redactNotice: "main.error.ocr.redactNotice",
  copyAction: "main.error.ocr.copyFix",
  copySuccess: "main.error.ocr.fixCopied",
  copyFailure: "main.error.ocr.copyFailed",
  safeFallback: "main.error.ocr.safeFallback",
} as const;

/** 高置信敏感片段模式：URL、IP/端口、本机地址、绝对路径、凭据、邮箱。
 *  刻意不收录泛词（如 secret/password）与换行，避免误伤中文静态文案。
 *  每次调用重建正则，保证 lastIndex 不跨调用残留（纯函数语义）。 */
function sensitivePatterns(): RegExp[] {
  return [
    /https?:\/\/[^\s"'<>]+/gi,
    /\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?/g,
    /\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d{1,5})?/gi,
    /(?:\/Users\/|\/home\/|\/private\/|\/var\/|\/tmp\/)[^\s"']+/g,
    /[A-Za-z]:\\(?:Users|Windows|Temp)[^\s"']*/g,
    // 凭据连同取值一起命中（apiKey=xxx / access_token: xxx / sk-xxx / Bearer xxx）。
    /\b(?:api[_-]?key|access[_-]?token)\s*[=:]\s*[^\s,;"']+|\bsk-[A-Za-z0-9]{8,}|\bBearer\s+[A-Za-z0-9._-]+/gi,
    /\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g,
  ];
}

/**
 * 检出文本里的敏感片段，返回去重后的命中列表。
 * 用途：静态断言 OCR 错误展示与复制文本零泄露；也可用于后续日志脱敏复用。
 */
export function findSensitiveFragments(text: string): string[] {
  const hits = new Set<string>();
  for (const pattern of sensitivePatterns()) {
    for (const match of text.matchAll(pattern)) hits.add(match[0]);
  }
  return [...hits];
}

/**
 * 从任意异常解析出白名单错误码，绝不返回 detail。
 * 未知 `OCR_*` 码、非 OCR 码（如 CLIP_NOT_FOUND）、无前缀字符串、null 全部收敛为 UNKNOWN。
 */
export function parseOcrErrorCode(error: unknown): ResolvedOcrCode {
  // Tauri command 的 Err(String) 原样到达前端，但上层包装可能把它塞进 message/error 字段。
  // 只提取白名单码，detail 永不进入返回值。
  let raw = error instanceof Error ? error.message : "";
  if (!raw && error && typeof error === "object") {
    const fields = error as Record<string, unknown>;
    for (const key of ["message", "error", "detail"]) {
      if (typeof fields[key] === "string") {
        raw = fields[key] as string;
        break;
      }
    }
  }
  if (!raw) raw = String(error ?? "");
  // 不锚定行首：兼容 `Error: OCR_BUILTIN_FAILED: ...` 与 JSON 包装。
  const match = raw.match(/OCR_[A-Z0-9_]+(?=:)/);
  const code = match?.[0];
  if (code && (OCR_ERROR_CODES as readonly string[]).includes(code)) return code as OcrErrorCode;
  return "UNKNOWN";
}

/** OCR 错误展示契约：脱敏错误码、明确原因、可复制修复步骤、展示文本、复制文本。 */
export type OcrErrorGuidance = {
  code: ResolvedOcrCode;
  reason: string;
  fixSteps: string[];
  description: string;
  copyText: string;
};

/** i18n 注入函数：由调用方把 key 转成当前语言文案，纯函数侧不依赖 React / i18n 模块。 */
export type OcrTranslate = (key: string) => string;

/**
 * 构造 OCR 错误展示编排。输入只用于取错误码，原始 detail 全程不进入输出。
 * fix 文案以换行分隔多个步骤，由本函数编号，保证展示与复制文本结构一致。
 */
export function buildOcrErrorGuidance(error: unknown, translate: OcrTranslate): OcrErrorGuidance {
  const code = parseOcrErrorCode(error);
  const keys = code === "UNKNOWN" ? OCR_UNKNOWN_KEYS : OCR_GUIDANCE_KEYS[code];
  const reason = translate(keys.reasonKey);
  const fixSteps = translate(keys.fixKey)
    .split("\n")
    .map((step) => step.trim())
    .filter(Boolean);
  const description = [reason, ...fixSteps].join("\n");
  const copyText = [
    translate(OCR_COPY_KEYS.title),
    `${translate(OCR_COPY_KEYS.codeLabel)}${code}`,
    `${translate(OCR_COPY_KEYS.reasonLabel)}${reason}`,
    translate(OCR_COPY_KEYS.fixLabel),
    ...fixSteps.map((step, index) => `${index + 1}. ${step}`),
    translate(OCR_COPY_KEYS.redactNotice),
  ].join("\n");
  return { code, reason, fixSteps, description, copyText };
}

/** 静态防护：检出展示/复制文本中残留的敏感片段；调用方或单测据此断言零泄露。 */
export function findOcrGuidanceLeaks(guidance: OcrErrorGuidance): string[] {
  return findSensitiveFragments(`${guidance.description}\n${guidance.copyText}`);
}
