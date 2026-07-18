import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function assert(condition, message) {
  if (!condition) {
    console.error(`AI summary verification failed: ${message}`);
    process.exitCode = 1;
  }
}

function assertMetadataOnly(value, message) {
  const serialized = JSON.stringify(value);
  for (const forbidden of [
    "apiKey",
    "sk-test",
    "prompt",
    "output",
    "ClipForge AI summary recommendation test",
    "https://example.com/docs",
  ]) {
    assert(!serialized.includes(forbidden), `${message}: leaked ${forbidden}`);
  }
}

const service = read("src/services/ai-summary.ts");
const panel = read("src/workspace/ai-summary-panel.tsx");
const workspace = read("src/workspace/workspace-panels.tsx");
const app = read("src/App.tsx");
const zh = readJson("src/i18n/locales/zh-CN.json");
const en = readJson("src/i18n/locales/en-US.json");

function makeClip(overrides = {}) {
  return {
    id: "clip-current",
    content: "https://example.com/docs ClipForge AI summary recommendation test",
    createdAt: 1,
    updatedAt: 3,
    lastSeenAt: 3,
    source: "Example",
    kind: "link",
    bucket: "history",
    favorite: false,
    tags: ["docs", "ai"],
    copyCount: 0,
    analysis: {
      source: "link",
      sourceName: "Link",
      badge: "URL",
      title: "ClipForge AI docs",
      summary: "AI summary recommendation test",
      url: "https://example.com/docs",
      host: "example.com",
      isMarkdown: false,
    },
    payloadKind: "link",
    contentHash: "hash-current",
    primaryFormat: "text/plain",
    availableFormats: ["text/plain"],
    representations: [],
    plainText: "ClipForge AI summary recommendation test",
    searchText: "ClipForge AI docs recommendation",
    captureContext: {},
    metadata: {},
    agentContext: {},
    ...overrides,
  };
}

async function verifyRuntimeBehavior() {
  const { createServer } = await import("vite");
  const server = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  try {
    const module = await server.ssrLoadModule("/src/services/ai-summary.ts");
    const settingsModule = await server.ssrLoadModule("/src/services/settings.ts");
    const current = makeClip();
    globalThis.__CLIPFORGE_AI_TEST_FLAGS__ = { VITE_CLIPFORGE_AI_MOCK: true };
    const ready = await module.generateClipAiSummary(current, "job-ready");
    assert(ready.status === "ready", "mock provider did not produce a ready summary");
    assert(ready.jobId === "job-ready", "mock provider did not preserve job id");
    assert(ready.providerId === "mock-provider", "mock provider did not preserve provider provenance");
    const readyLogMetadata = module.getClipAiSummaryLogMetadata(current.id, ready, "job-ready-fallback");
    assert(readyLogMetadata.jobId === "job-ready", "summary log metadata did not preserve job id");
    assert(readyLogMetadata.status === "ready", "summary log metadata did not preserve status");
    assert(readyLogMetadata.providerId === "mock-provider", "summary log metadata did not preserve provider id");
    assertMetadataOnly(readyLogMetadata, "ready summary log metadata");

    const stored = module.getStoredClipAiSummary(makeClip({ metadata: { aiSummary: ready } }));
    assert(stored?.status === "ready" && stored.oneLine, "stored ready summary cannot be read back from metadata");

    globalThis.__CLIPFORGE_AI_TEST_FLAGS__ = {
      VITE_CLIPFORGE_AI_MOCK: true,
      VITE_CLIPFORGE_AI_MOCK_FAILURE: true,
    };
    const failed = await module.generateClipAiSummary(current, "job-failed");
    assert(failed.status === "failed", "mock failure flag did not produce a failed summary");
    assert(failed.errorCode === "AI_MOCK_FAILED", "mock failure did not preserve its error code");

    const similar = makeClip({
      id: "clip-similar",
      updatedAt: 4,
      content: "ClipForge AI docs recommendation with matching tags",
      tags: ["docs", "ai"],
      analysis: {
        source: "link",
        sourceName: "Link",
        badge: "URL",
        title: "Related ClipForge docs",
        summary: "AI recommendation",
        url: "https://example.com/guide",
        host: "example.com",
        isMarkdown: false,
      },
    });
    const recommendations = module.findSimilarClipRecommendations(current, [similar], 4);
    assert(recommendations.length === 1, "local recommendation service did not return a matching candidate");
    assert(recommendations[0].clip.id === "clip-similar", "local recommendation returned the wrong candidate");
    assert(recommendations[0].reasons.includes("tag"), "local recommendation did not include reason metadata");

    delete globalThis.__CLIPFORGE_AI_TEST_FLAGS__;
    let fetchCalls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      throw new Error("fetch must not be called by metadata-only AI summary boundary");
    };
    settingsModule.settingsService.agent.providers = async () => ({
      activeProviderId: "openai-compatible-test",
      providers: [
        {
          id: "openai-compatible-test",
          label: "OpenAI Compatible Test",
          kind: "openai-compatible",
          configured: true,
          commandPreview: "",
          redactedConfig: {
            modelId: "gpt-test",
            apiKey: "sk-test-redacted-input-must-not-leak",
            prompt: "redacted prompt input must not leak",
            output: "redacted output input must not leak",
          },
        },
      ],
      revision: "test",
    });
    try {
      const boundary = module.prepareOpenAiCompatibleSummaryBoundary(
        {
          id: "openai-compatible-test",
          label: "OpenAI Compatible Test",
          kind: "openai-compatible",
          configured: true,
          commandPreview: "",
          redactedConfig: {
            modelId: "gpt-test",
            apiKey: "sk-test-redacted-input-must-not-leak",
            prompt: "redacted prompt input must not leak",
            output: "redacted output input must not leak",
          },
        },
        "job-boundary",
      );
      assert(boundary.boundary === "openai-compatible", "OpenAI-compatible boundary marker is missing");
      assert(boundary.status === "blocked", "OpenAI-compatible boundary must remain blocked without SDK");
      assert(boundary.errorCode === "AI_SDK_NOT_ENABLED", "OpenAI-compatible boundary must report SDK blocked code");
      assert(typeof boundary.createdAt === "number", "OpenAI-compatible boundary must include createdAt metadata");
      assert(typeof boundary.durationMs === "number", "OpenAI-compatible boundary must include durationMs metadata");
      assertMetadataOnly(boundary, "OpenAI-compatible call boundary");

      const blocked = await module.generateClipAiSummary(current, "job-sdk-blocked");
      assert(blocked.status === "failed", "SDK blocked provider should return a failed summary state");
      assert(blocked.jobId === "job-sdk-blocked", "SDK blocked state did not preserve job id");
      assert(blocked.providerId === "openai-compatible-test", "SDK blocked state did not preserve provider id");
      assert(blocked.providerKind === "openai-compatible", "SDK blocked state did not preserve provider kind");
      assert(blocked.modelId === "gpt-test", "SDK blocked state did not preserve model id");
      assert(blocked.errorCode === "AI_SDK_NOT_ENABLED", "SDK blocked state did not preserve error code");
      assert(blocked.blockedReason === "AI_SDK_NOT_ENABLED", "SDK blocked state did not preserve blocked reason");
      assert(typeof blocked.createdAt === "number", "SDK blocked state did not include createdAt metadata");
      assert(typeof blocked.durationMs === "number", "SDK blocked state did not include durationMs metadata");
      assert(fetchCalls === 0, "metadata-only SDK blocked boundary must not call fetch");
      assertMetadataOnly(blocked, "SDK blocked summary result");
      assertMetadataOnly(
        module.getClipAiSummaryLogMetadata(current.id, blocked, "job-sdk-blocked-fallback"),
        "SDK blocked summary log metadata",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }

    const errorMetadata = module.getClipAiSummaryErrorLogMetadata(
      current.id,
      "job-error",
      "AI_SUMMARY_UPDATE_FAILED",
      new Error("prompt output https://example.com/docs ClipForge AI summary recommendation test"),
    );
    assert(errorMetadata.errorName === "Error", "summary error log metadata did not preserve error type");
    assertMetadataOnly(errorMetadata, "summary error log metadata");
  } finally {
    delete globalThis.__CLIPFORGE_AI_TEST_FLAGS__;
    await server.close();
  }
}

assert(service.includes('readEnvFlag("VITE_CLIPFORGE_AI_MOCK")'), "mock provider env gate is missing");
assert(service.includes('providerId: "mock-provider"'), "mock provider provenance is missing");
assert(service.includes('modelId: "clipforge-local-mock"'), "mock provider model id is missing");
assert(service.includes('errorCode: "AI_MOCK_FAILED"'), "mock provider failed state is missing");
assert(service.includes("function makeMockSummary"), "mock ready summary generator is missing");
assert(service.includes("export function findSimilarClipRecommendations"), "local recommendation service is missing");
assert(service.includes("clip.metadata.aiSummary"), "recommendations do not consider stored AI summary metadata");
assert(service.includes("prepareOpenAiCompatibleSummaryBoundary"), "OpenAI-compatible metadata-only call boundary is missing");
assert(service.includes("getClipAiSummaryLogMetadata"), "AI summary metadata-only log helper is missing");
assert(service.includes("getClipAiSummaryErrorLogMetadata"), "AI summary error metadata-only log helper is missing");
assert(service.includes('boundary: "openai-compatible"'), "OpenAI-compatible boundary marker is missing");
assert(service.includes('blockedReason: "AI_SDK_NOT_ENABLED"'), "SDK blocked boundary reason is missing");
assert(!service.includes("generateText("), "real AI SDK generateText call must remain blocked until Context7 docs are available");
assert(!service.includes("streamText("), "real AI SDK streamText call must remain blocked until Context7 docs are available");
assert(!service.includes("fetch("), "AI summary provider boundary must not perform network fetch while SDK is unavailable");
assert(!service.includes("console.log("), "AI summary service must not log prompt/output bodies");
assert(service.includes("__CLIPFORGE_AI_TEST_FLAGS__"), "AI summary runtime test flags are missing");

assert(panel.includes("findSimilarClipRecommendations(clip, candidates, 4)"), "detail panel does not compute recommendations from current candidates");
assert(panel.includes('aria-label={tr("main.detail.aiRecommend.aria")}'), "recommendation section is missing an accessible label");
assert(panel.includes("onOpenRecommendation?.(recommendation.clip)"), "recommendation click does not use the detail navigation callback");
assert(panel.includes('summary?.status === "pending"'), "pending summary state is not rendered");
assert(panel.includes('summary?.status === "ready"'), "ready summary state is not rendered");
assert(panel.includes('summary?.status === "failed"'), "failed summary state is not rendered");
assert(panel.includes("detail-ai-summary-points"), "ready summary key points are not rendered");
assert(panel.includes("detail-ai-summary-meta"), "summary provenance metadata is not rendered");
assert(panel.includes("getSummaryProviderLabel"), "summary provider/model label helper is missing");
assert(panel.includes("getGeneratedAtLabel"), "summary generated-at label helper is missing");

assert(workspace.includes("candidates?: ClipItem[]"), "ClipDetailWorkspace props do not accept recommendation candidates");
assert(workspace.includes("onOpenRecommendation?: (clip: ClipItem) => void"), "ClipDetailWorkspace props do not accept recommendation navigation");
assert(
  workspace.includes("<DetailAiSummaryPanel") &&
    workspace.includes("candidates={candidates}") &&
    workspace.includes("onGenerateSummary={onGenerateAiSummary}") &&
    workspace.includes("onOpenRecommendation={onOpenRecommendation}"),
  "DetailAiSummaryPanel is not wired with candidates, generation, and navigation",
);
assert(app.includes("candidates={detailItems}"), "App does not pass current detail context as recommendation candidates");
assert(app.includes("onOpenRecommendation={navigateDetailClip}"), "App does not reuse detail navigation for recommendations");
assert(app.includes("async function generateAiSummaryForClip"), "App does not provide a manual AI summary action");
assert(app.includes('input: { id: item.id, metadata }'), "AI summary action does not persist metadata through update_clip_record");
assert(app.includes("getClipAiSummaryLogMetadata(item.id, result, jobId)"), "AI summary completion log does not use metadata-only helper");
assert(app.includes("getClipAiSummaryErrorLogMetadata(item.id, jobId"), "AI summary failure log does not use metadata-only helper");
assert(service.includes("clip.metadata.aiSummary"), "AI summary service does not read persisted metadata");
assert(app.includes("getStoredClipAiSummary(item)"), "quick list does not read AI summary status");
assert(app.includes("quick-ai-summary-badge"), "quick list AI summary badge is missing");
assert(app.includes('tr("main.context.generateAiSummary")'), "context menu generate summary label is missing");
assert(app.includes("onGenerateAiSummary={onGenerateAiSummary}"), "context menu does not receive the generate summary action");
assert(app.includes("onGenerateAiSummary={(item) =>"), "QuickPastePanel is not wired to generate summaries");
assert(app.includes('logAppError("info", "ai-summary: job finished"'), "AI summary metadata-only completion log is missing");

for (const key of [
  "main.detail.aiRecommend.aria",
  "main.detail.aiRecommend.title",
  "main.detail.aiRecommend.empty",
  "main.detail.aiRecommend.reasonTag",
  "main.detail.aiRecommend.reasonHost",
  "main.detail.aiRecommend.reasonFormat",
  "main.detail.aiRecommend.reasonSource",
  "main.detail.aiRecommend.reasonFavorite",
  "main.detail.aiRecommend.reasonKeywords",
  "main.context.generateAiSummary",
  "main.detail.aiSummary.keyPoints",
  "main.detail.aiSummary.category",
  "main.detail.aiSummary.provider",
  "main.detail.aiSummary.generatedAt",
  "main.list.aiSummaryReady",
  "main.list.aiSummaryPending",
  "main.list.aiSummaryFailed",
  "main.status.aiSummaryPending",
  "main.status.aiSummaryReady",
  "main.status.aiSummaryFailed",
  "main.toast.aiSummaryReady",
]) {
  assert(typeof zh[key] === "string" && zh[key].length > 0, `missing zh-CN key ${key}`);
  assert(typeof en[key] === "string" && en[key].length > 0, `missing en-US key ${key}`);
}

await verifyRuntimeBehavior();

if (!process.exitCode) {
  console.log("AI summary verification passed");
}
