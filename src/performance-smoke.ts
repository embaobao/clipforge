export interface ClipForgePerfSample {
  label: string;
  durationMs: number;
  at: number;
  meta?: Record<string, string | number | boolean | null | undefined>;
}

export interface ClipForgePerfSummary {
  label: string;
  count: number;
  p50: number;
  p95: number;
  max: number;
}

export interface ClipForgePerfCollector {
  samples: ClipForgePerfSample[];
  record(sample: ClipForgePerfSample): void;
  summary(label?: string): ClipForgePerfSummary[];
  clear(label?: string): void;
}

declare global {
  interface Window {
    __clipforgePerf?: ClipForgePerfCollector;
  }
}

const MAX_SAMPLES_PER_LABEL = 120;

function nowMs() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function percentile(values: number[], ratio: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return Math.round(sorted[index]);
}

function createCollector(): ClipForgePerfCollector {
  const collector: ClipForgePerfCollector = {
    samples: [],
    record(sample) {
      this.samples.push(sample);
      const sameLabel = this.samples.filter((item) => item.label === sample.label);
      if (sameLabel.length > MAX_SAMPLES_PER_LABEL) {
        const removeCount = sameLabel.length - MAX_SAMPLES_PER_LABEL;
        let removed = 0;
        this.samples = this.samples.filter((item) => {
          if (item.label !== sample.label || removed >= removeCount) return true;
          removed += 1;
          return false;
        });
      }
    },
    summary(label) {
      const labels = label ? [label] : [...new Set(this.samples.map((item) => item.label))].sort();
      return labels.map((itemLabel) => {
        const values = this.samples
          .filter((item) => item.label === itemLabel)
          .map((item) => item.durationMs);
        return {
          label: itemLabel,
          count: values.length,
          p50: percentile(values, 0.5),
          p95: percentile(values, 0.95),
          max: percentile(values, 1),
        };
      });
    },
    clear(label) {
      this.samples = label ? this.samples.filter((item) => item.label !== label) : [];
    },
  };
  return collector;
}

function getCollector() {
  if (typeof window === "undefined") return null;
  window.__clipforgePerf ??= createCollector();
  return window.__clipforgePerf;
}

export function recordPerfSample(
  label: string,
  durationMs: number,
  meta?: ClipForgePerfSample["meta"],
) {
  getCollector()?.record({
    label,
    durationMs: Math.max(0, Math.round(durationMs)),
    at: Date.now(),
    meta,
  });
}

export function startPerfSpan(label: string, meta?: ClipForgePerfSample["meta"]) {
  const started = nowMs();
  return (extraMeta?: ClipForgePerfSample["meta"]) => {
    recordPerfSample(label, nowMs() - started, { ...meta, ...extraMeta });
  };
}

export function recordNextFramePerf(label: string, meta?: ClipForgePerfSample["meta"]) {
  const started = nowMs();
  let recorded = false;
  const finish = (sampleSource: "raf" | "fallback") => {
    if (recorded) return;
    recorded = true;
    recordPerfSample(label, nowMs() - started, { ...meta, sampleSource });
  };
  window.requestAnimationFrame(() => finish("raf"));
  // Tauri 设置窗在非 key/background 状态下可能暂停 rAF；fallback 保证采样不因窗口激活策略丢失。
  window.setTimeout(() => finish("fallback"), 120);
}
