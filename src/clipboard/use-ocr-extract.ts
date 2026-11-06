/** 图片文字识别（OCR）提取动作（ocr-image-text-extraction 提案 Phase 2）。
 *  从 use-clip-writeback 拆出（500 行门禁）：依赖经参数注入，不持有 hook 状态。 */
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import type { ClipItem } from "../App";
import type { TranslationKey } from "../i18n";
import { truncateText } from "./clip-model";

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

/** 图片提取文字并复制：invoke ocr_extract → 文本进剪贴板 → 显式入库 → toast 反馈；
 *  失败 toast 携带 `OCR_*` 错误码原文（前端不吞错误，提示可定位）。 */
export async function ocrExtractAndCopy(item: ClipItem, deps: OcrExtractDeps) {
  const { captureStandardTextClip, setNativeStatus, tr } = deps;
  try {
    const result = await invoke<OcrExtractPayload>("ocr_extract", { id: item.id });
    await navigator.clipboard.writeText(result.text);
    await captureStandardTextClip(result.text, "ocr", {
      ocrSourceImageId: item.id,
      ocrModel: result.model,
      ocrElapsedMs: result.elapsedMs,
    });
    toast.success(tr("main.toast.ocrCopied"), { description: truncateText(result.text, 42) });
    setNativeStatus(tr("main.status.ocrCopied"));
  } catch (error) {
    toast.error(tr("main.toast.ocrFailed"), { description: truncateText(String(error), 120) });
  }
}
