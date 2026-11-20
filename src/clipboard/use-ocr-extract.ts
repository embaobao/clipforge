/** 图片文字识别（OCR）提取动作（ocr-image-text-extraction 提案 Phase 2）。
 *  从 use-clip-writeback 拆出（500 行门禁）：依赖经参数注入，不持有 hook 状态。 */
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import type { ClipItem } from "../App";
import type { TranslationKey } from "../i18n";
import { truncateText } from "./clip-model";
import { buildOcrErrorGuidance, findOcrGuidanceLeaks } from "./ocr-error-guidance";

/** `ocr_extract` command 返回载荷（Rust OcrExtractPayload 的 camelCase 映射）。 */
type OcrExtractPayload = {
  text: string;
  model: string;
  elapsedMs: number;
  endpoint: string;
};

export type OcrExtractDeps = {
  /** 写回 hook 的显式入库动作（写回抑制会拦住复制回采，落条目必须显式 capture）。 */
  captureStandardTextClip: (text: string, source: string, context?: Record<string, unknown>) => Promise<unknown>;
  setNativeStatus: (status: string) => void;
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
};

/** 图片提取文字并复制：invoke ocr_extract → 文本进剪贴板 → 显式入库 → toast 反馈。
 *  失败按 `OCR_*` 错误码映射为脱敏原因 + 可复制修复方案，提示可关闭；
 *  原始异常（含本地端点 URL / 图片路径 / 端口）绝不进入展示或复制文本（提案 §27）。 */
export async function ocrExtractAndCopy(item: ClipItem, deps: OcrExtractDeps) {
  const { captureStandardTextClip, setNativeStatus, tr } = deps;
  try {
    const result = await invoke<OcrExtractPayload>("ocr_extract", { id: item.id });
    await navigator.clipboard.writeText(result.text);
    await captureStandardTextClip(result.text, "ocr", {
      // spec 要求 metadata 顶层 sourceImageId；其余诊断字段仍进 clipforgeContext。
      sourceImageId: item.id,
      ocrModel: result.model,
      ocrElapsedMs: result.elapsedMs,
    });
    toast.success(tr("main.toast.ocrCopied"), { description: truncateText(result.text, 42) });
    setNativeStatus(tr("main.status.ocrCopied"));
  } catch (error) {
    // 文案由纯函数编排，展示前再做一次脱敏兜底：一旦文案被改坏带出敏感片段，退化为纯静态兜底句。
    const translate = (key: string) => tr(key as TranslationKey);
    const guidance = buildOcrErrorGuidance(error, translate);
    const leaks = findOcrGuidanceLeaks(guidance);
    const safe = leaks.length === 0;
    const description = safe ? guidance.description : translate("main.error.ocr.safeFallback");
    const copyText = safe ? guidance.copyText : translate("main.error.ocr.safeFallback");
    toast.error(tr("main.toast.ocrFailed"), {
      description,
      closeButton: true,
      duration: 15000,
      action: {
        label: tr("main.error.ocr.copyFix"),
        onClick: () => {
          void navigator.clipboard.writeText(copyText).then(
            () => toast.success(tr("main.error.ocr.fixCopied")),
            () => toast.error(tr("main.error.ocr.copyFailed")),
          );
        },
      },
    });
  }
}
