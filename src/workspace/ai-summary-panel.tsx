import { AlertCircle, RefreshCw, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ClipItem } from "../App";
import type { TranslationKey } from "../i18n";
import {
  findSimilarClipRecommendations,
  generateClipAiSummary,
  getStoredClipAiSummary,
  type ClipAiRecommendation,
  type ClipAiSummary,
} from "../services/ai-summary";
import "./ai-summary-panel.css";

type AiSummaryTr = (key: TranslationKey, params?: Record<string, string | number>) => string;

export type DetailAiSummaryPanelProps = {
  clip: ClipItem;
  candidates?: ClipItem[];
  tr: AiSummaryTr;
  onGenerateSummary?: (clip: ClipItem) => Promise<ClipAiSummary | void> | ClipAiSummary | void;
  onOpenRecommendation?: (clip: ClipItem) => void;
};

const SUMMARY_BUSY_STATUSES = new Set<ClipAiSummary["status"]>(["pending"]);

function getErrorLabel(summary: ClipAiSummary, tr: AiSummaryTr) {
  if (summary.errorCode === "AI_PROVIDER_NOT_CONFIGURED") return tr("main.detail.aiSummary.noProvider");
  if (summary.errorCode === "AI_PROVIDER_KIND_UNSUPPORTED") return tr("main.detail.aiSummary.unsupportedProvider");
  if (summary.errorCode === "AI_SDK_NOT_ENABLED") return tr("main.detail.aiSummary.sdkPending");
  return tr("main.detail.aiSummary.failed");
}

function getRecommendationLabel(recommendation: ClipAiRecommendation) {
  const title = recommendation.clip.analysis.title || recommendation.clip.analysis.summary || recommendation.clip.content;
  return title.replace(/\s+/g, " ").trim().slice(0, 80) || recommendation.clip.id;
}

function getSummaryProviderLabel(summary: ClipAiSummary) {
  return [summary.providerId, summary.modelId].filter(Boolean).join(" / ") || summary.providerKind || "";
}

function getGeneratedAtLabel(summary: ClipAiSummary) {
  if (!summary.generatedAt) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(summary.generatedAt);
}

function getReasonLabel(reason: string, tr: AiSummaryTr) {
  if (reason === "tag") return tr("main.detail.aiRecommend.reasonTag");
  if (reason === "host") return tr("main.detail.aiRecommend.reasonHost");
  if (reason === "format") return tr("main.detail.aiRecommend.reasonFormat");
  if (reason === "source") return tr("main.detail.aiRecommend.reasonSource");
  if (reason === "favorite") return tr("main.detail.aiRecommend.reasonFavorite");
  return tr("main.detail.aiRecommend.reasonKeywords");
}

export function DetailAiSummaryPanel({
  clip,
  candidates = [],
  tr,
  onGenerateSummary,
  onOpenRecommendation,
}: DetailAiSummaryPanelProps) {
  const [summary, setSummary] = useState<ClipAiSummary | null>(() => getStoredClipAiSummary(clip));
  const isRunning = Boolean(summary && SUMMARY_BUSY_STATUSES.has(summary.status));
  const requestSeqRef = useRef(0);
  const recommendations = useMemo(() => {
    try {
      return findSimilarClipRecommendations(clip, candidates, 4);
    } catch {
      return [];
    }
  }, [clip, candidates]);

  useEffect(() => {
    requestSeqRef.current += 1;
    setSummary(getStoredClipAiSummary(clip));
  }, [clip.id, clip.metadata]);

  const runSummary = async () => {
    const requestSeq = requestSeqRef.current + 1;
    requestSeqRef.current = requestSeq;
    const targetClipId = clip.id;
    const pending: ClipAiSummary = {
      status: "pending",
      jobId: `clip_ai_${clip.id}_${Date.now().toString(36)}`,
    };
    setSummary(pending);
    try {
      const result = (await onGenerateSummary?.(clip)) ?? (await generateClipAiSummary(clip, pending.jobId));
      if (requestSeqRef.current === requestSeq && clip.id === targetClipId) {
        setSummary(result);
      }
    } catch (error) {
      if (requestSeqRef.current === requestSeq && clip.id === targetClipId) {
        setSummary({
          status: "failed",
          jobId: pending.jobId,
          generatedAt: Date.now(),
          errorCode: "AI_SUMMARY_CLIENT_FAILED",
          message: String(error),
        });
      }
    }
  };

  const hasReadySummary = summary?.status === "ready" && Boolean(summary.oneLine);
  const hasFailedSummary = summary?.status === "failed";
  const providerLabel = summary ? getSummaryProviderLabel(summary) : "";
  const generatedAtLabel = summary ? getGeneratedAtLabel(summary) : "";

  return (
    <section className="detail-ai-summary-panel" aria-label={tr("main.detail.aiSummary.aria")}>
      <div className="detail-ai-summary-header">
        <div className="detail-ai-summary-title">
          <Sparkles size={13} />
          <span>{tr("main.detail.aiSummary.title")}</span>
        </div>
        <button
          className="detail-ai-summary-action"
          disabled={isRunning}
          onClick={() => void runSummary()}
          type="button"
        >
          <RefreshCw size={12} />
          <span>{isRunning ? tr("main.detail.aiSummary.pending") : tr("main.detail.aiSummary.generate")}</span>
        </button>
      </div>
      <div className="detail-ai-summary-body">
        {summary?.status === "pending" ? <p>{tr("main.detail.aiSummary.pendingBody")}</p> : null}
        {hasReadySummary ? <p>{summary.oneLine}</p> : null}
        {hasReadySummary && summary.keyPoints?.length ? (
          <ul className="detail-ai-summary-points" aria-label={tr("main.detail.aiSummary.keyPoints")}>
            {summary.keyPoints.slice(0, 4).map((point, index) => (
              <li key={`${index}-${point}`}>{point}</li>
            ))}
          </ul>
        ) : null}
        {hasReadySummary && summary.tags?.length ? (
          <div className="detail-ai-summary-tags" aria-label={tr("main.detail.aiSummary.tags")}>
            {summary.tags.slice(0, 8).map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
        ) : null}
        {summary && (summary.category || providerLabel || generatedAtLabel) ? (
          <dl className="detail-ai-summary-meta">
            {summary.category ? (
              <>
                <dt>{tr("main.detail.aiSummary.category")}</dt>
                <dd>{summary.category}</dd>
              </>
            ) : null}
            {providerLabel ? (
              <>
                <dt>{tr("main.detail.aiSummary.provider")}</dt>
                <dd>{providerLabel}</dd>
              </>
            ) : null}
            {generatedAtLabel ? (
              <>
                <dt>{tr("main.detail.aiSummary.generatedAt")}</dt>
                <dd>{generatedAtLabel}</dd>
              </>
            ) : null}
          </dl>
        ) : null}
        {hasFailedSummary ? (
          <p className="detail-ai-summary-error">
            <AlertCircle size={12} /> {getErrorLabel(summary, tr)}
          </p>
        ) : null}
        {!summary ? <p>{tr("main.detail.aiSummary.empty")}</p> : null}
      </div>
      <div className="detail-ai-recommendations" aria-label={tr("main.detail.aiRecommend.aria")}>
        <div className="detail-ai-recommendations-title">
          <span>{tr("main.detail.aiRecommend.title")}</span>
          <em>{recommendations.length}</em>
        </div>
        {recommendations.length ? (
          <div className="detail-ai-recommendation-list">
            {recommendations.map((recommendation) => (
              <button
                key={recommendation.clip.id}
                onClick={() => onOpenRecommendation?.(recommendation.clip)}
                type="button"
              >
                <span>{getRecommendationLabel(recommendation)}</span>
                <em>
                  {recommendation.reasons.slice(0, 3).map((reason) => getReasonLabel(reason, tr)).join(" / ")}
                </em>
              </button>
            ))}
          </div>
        ) : (
          <p>{tr("main.detail.aiRecommend.empty")}</p>
        )}
      </div>
    </section>
  );
}
