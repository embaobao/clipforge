/** 设置「图片文字识别」引擎卡：macOS 用系统 Vision 内置识别，无需端点；其他平台保留本地端点兜底。
 *  边界：只展示/写设置与调 `ocr_detect_endpoints` / `ocr_builtin_available`，不做提取动作。 */
import { Radar } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { TranslationKey } from "../../i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** `ocr_detect_endpoints` 返回的候选形状（Rust OcrEndpointCandidate）。 */
type OcrEndpointCandidate = {
  url: string;
  models: string[];
  source: string;
  vision: boolean | null;
};

export type OcrEndpointCardProps = {
  /** 当前设置里的端点 URL（settings.ocrEndpointUrl）。 */
  endpointUrl: string;
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
  onEndpointChange: (next: string) => void;
};

/** 端点输入 + 自动发现列表：内置 OCR 可用时只展示状态，不要求用户配置端点。 */
export function OcrEndpointCard({ endpointUrl, tr, onEndpointChange }: OcrEndpointCardProps) {
  const inputId = useId();
  const [builtin, setBuiltin] = useState(false);
  const [candidates, setCandidates] = useState<OcrEndpointCandidate[] | null>(null);
  const [detecting, setDetecting] = useState(false);

  useEffect(() => {
    let alive = true;
    invoke<boolean>("ocr_builtin_available")
      .then((available) => {
        if (alive) setBuiltin(available);
      })
      .catch(() => {
        if (alive) setBuiltin(false);
      });
    return () => {
      alive = false;
    };
  }, []);
  const detect = async () => {
    setDetecting(true);
    try {
      setCandidates(await invoke<OcrEndpointCandidate[]>("ocr_detect_endpoints"));
    } catch {
      setCandidates([]);
    } finally {
      setDetecting(false);
    }
  };

  return (
    <div className="grid gap-2 border-t pt-3" data-dev-probe="ocr-endpoint-card">
      {builtin ? (
        <div className="rounded-md bg-muted/50 px-3 py-2">
          <p className="text-[13px]">{tr("settings.content.ocr.builtinTitle")}</p>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">
            {tr("settings.content.ocr.builtinHint")}
          </p>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-8">
            <div className="min-w-0">
              <Label className="text-[13px]" htmlFor={inputId}>
                {tr("settings.content.ocr.endpoint")}
              </Label>
              <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                {tr("settings.content.ocr.endpointHint")}
              </p>
            </div>
            <Input
              className="h-7 w-56 rounded-md text-[12px]"
              id={inputId}
              onChange={(event) => onEndpointChange(event.currentTarget.value)}
              placeholder="http://127.0.0.1:8491"
              type="text"
              value={endpointUrl}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              className="h-7 rounded-md px-2.5 text-[12px]"
              disabled={detecting}
              onClick={detect}
              size="sm"
              variant="outline"
            >
              <Radar className="mr-1 size-3.5" />
              {detecting ? tr("settings.content.ocr.detecting") : tr("settings.content.ocr.detect")}
            </Button>
            {candidates !== null && candidates.length === 0 && (
              <span className="text-[11.5px] text-muted-foreground">
                {tr("settings.content.ocr.none")}
              </span>
            )}
          </div>
          {candidates !== null && candidates.length > 0 && (
            <div className="grid gap-1">
              {candidates.map((candidate) => (
                <button
                  className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[12px] hover:bg-muted"
                  key={candidate.url}
                  onClick={() => onEndpointChange(candidate.url)}
                  type="button"
                >
                  <span className="font-mono">{candidate.url}</span>
                  <span className="truncate text-[11px] text-muted-foreground">
                    {candidate.models.slice(0, 2).join(", ") || candidate.source}
                  </span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
