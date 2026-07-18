import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const appPath = path.join(root, "src/App.tsx");
const agentPath = path.join(root, "src/agent-panel.tsx");
const agentChatPath = path.join(root, "src/agent-chat-page.tsx");
const contractsPath = path.join(root, "src/services/contracts.ts");
const settingsServicePath = path.join(root, "src/services/settings.ts");
const cssPath = path.join(root, "src/App.css");
const rustPath = path.join(root, "src-tauri/src/lib.rs");
const iconPath = path.join(root, "assets/brand/icons/256/agent-access.png");

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function assert(condition, message) {
  if (!condition) {
    console.error(`Agent panel verification failed: ${message}`);
    process.exitCode = 1;
  }
}

// 反向断言比 data-marker 断言更脆弱，保留时必须写清楚禁止原因。
function assertDoesNotInclude(source, token, message, rationale) {
  assert(!source.includes(token), `${message}；反向断言原因：${rationale}`);
}

function sectionBetween(source, startToken, endToken) {
  const start = source.indexOf(startToken);
  if (start < 0) return "";
  const end = source.indexOf(endToken, start + startToken.length);
  return end < 0 ? source.slice(start) : source.slice(start, end);
}

function checkLocalAgentCli(command) {
  const found = spawnSync("sh", ["-lc", `command -v ${command}`], {
    encoding: "utf8",
    timeout: 1200,
  });
  if (found.status !== 0) {
    console.log(`Agent CLI check skipped: ${command} is not installed`);
    return;
  }
  const version = spawnSync(command, ["--version"], {
    encoding: "utf8",
    timeout: 1800,
  });
  const label = (version.stdout || version.stderr || "").trim().split("\n")[0] || "available";
  console.log(`Agent CLI check usable: ${command} ${label}`);
}

const app = read(appPath);
const agent = `${read(agentPath)}\n${read(agentChatPath)}`;
const contracts = read(contractsPath);
const settingsService = read(settingsServicePath);
const css = read(cssPath);
const rust = read(rustPath);
const panelNativePath = sectionBetween(rust, "fn open_panel", "/// 面板「固定」状态");

["claude", "codex", "qwen"].forEach(checkLocalAgentCli);

assert(fs.existsSync(iconPath), "agent access icon asset is missing");
assert(fs.statSync(iconPath).size > 1024, "agent access icon asset looks empty");
assert(app.includes("agentAccessIcon"), "App does not import/use the Agent access icon");
assert(app.includes('useState<PanelSurface>("clipboard")'), "App does not default to clipboard surface");
assert(
  app.includes('data-agent-trigger="top-toolbar"') &&
    app.includes("onClick={onOpenAgent}"),
  "Agent trigger marker is not wired to the top toolbar open action",
);
assert(
  app.includes('data-agent-overlay={activeSurface === "agent" ? "open" : "closed"}') &&
    app.includes("data-agent-overlay-panel"),
  "Agent overlay stable data markers are missing",
);
assert(app.includes('className={activeSurface === "agent" ? "agent-overlay open" : "agent-overlay"}'), "Agent panel is not rendered as an overlay");
assert(app.includes('{activeSurface === "agent" ? (\n            <AgentPanelBoundary'), "Agent panel boundary is mounted before the Agent surface is opened");
assert(app.includes("<ClipboardAgentPanel"), "Agent panel component is missing from the lazy Agent surface");
const openAgentBody = app.match(/onOpenAgent=\{\(\) => \{[\s\S]*?\n        \}\}/)?.[0] ?? "";
assert(openAgentBody.includes('setActiveSurface("agent")'), "Agent toolbar trigger does not open the overlay synchronously");
assertDoesNotInclude(openAgentBody, "invoke(", "Agent toolbar trigger waits on native work before opening", "打开 Agent 面板必须同步切 surface，不能等待 Tauri/native 控制面调用");
assertDoesNotInclude(openAgentBody, "await ", "Agent toolbar trigger waits on async work before opening", "打开 Agent 面板必须在 300ms 内给出可见反馈，不能被异步工作阻塞");
assert(app.includes("async function saveAgentResultAsClip"), "Agent result save flow is missing");
assert(app.includes('normalizeTagList([...normalized.tags, "AI"])'), "Saved Agent result does not default to AI tag");
assert(app.includes('generatedBy: "agent"'), "Saved Agent result does not persist agent provenance");
const updateClipContentBody = app.match(/async function updateClipContent[\s\S]*?\n  async function/)?.[0] ?? "";
assert(updateClipContentBody.includes("save_editor_draft"), "Detail editor save flow does not use save_editor_draft");
assert(updateClipContentBody.includes("tags: tags ? normalizeTagList(tags) : normalizeTagList(item.tags)"), "Ordinary detail save may not preserve user-managed tags");
assertDoesNotInclude(updateClipContentBody, '"AI"', "Ordinary detail save appears to re-add AI tag", "用户手动移除 AI tag 后，普通保存不得自动加回");
assertDoesNotInclude(app, "PanelSurfaceTabs", "Top Agent tab component still exists", "Agent 已改为 overlay surface，顶部 tab 会重新占用主面板空间");
assertDoesNotInclude(css, "panel-surface-tabs", "Top Agent tab styles still exist", "旧顶部 tab 样式残留会让已移除的导航形态回流");
assertDoesNotInclude(app, "{activeSurface === \"clipboard\" ? (\n          <GlassSearchBar", "Search bar is still gated by Agent surface state", "搜索栏必须属于剪贴板主路径，不应被 Agent surface 条件挂载影响焦点");
assertDoesNotInclude(app, 'resetKey={`${activeSurface}:workspace', "Workspace route is still remounted by Agent surface state", "切换 Agent overlay 不应重挂 workspace 路由或丢失详情/滚动状态");
assert(agent.includes('action.type === "copyResult"') && agent.includes("onCopyResult(text)"), "Agent copy result action is not wired");
assert(agent.includes('action.type === "saveAsClip"') && agent.includes("onSaveResult(text"), "Agent save result action is not wired");
assert(agent.includes('action.type === "favoriteSourceClip"') && agent.includes("onFavoriteClip(sourceClip)"), "Agent favorite source action is not wired");
assert(agent.includes('action.type === "archiveSourceClip"') && agent.includes("onArchiveClip(sourceClip)"), "Agent archive source action is not wired");
assert(agent.includes('action.type === "appendTag"') && agent.includes('onAppendTagToSource(sourceClip, "AI")'), "Agent append AI tag action is not wired");
assert(agent.includes("parseSmartTargets(clip.content)"), "Agent references do not expose SmartParsedTarget candidates");
assert(agent.includes("primaryUrl: clip.analysis.url"), "Agent link references do not expose primaryUrl");
assert(agent.includes("summary: clip.analysis.summary || compactText(clip.content, 120)"), "Agent text references do not default to summary");
assert(agent.includes("textPreview: metadataOnly ? \"\" : compactText(clip.content, allowFullContent ? 480 : 180)"), "Agent text references do not use a short summary preview by default");
// 断言核心不变量（current clip 被用作默认 current 引用），对 hasCurrentScope 守卫的演进鲁棒。
assert(agent.includes('makeClipReference(activeClip, "current", permissionMode)'), "Agent current clip is not used as the default current reference");
assert(agent.includes('type AgentReferenceScope = "current" | "selection" | "favorites" | "search-result" | "all" | "file" | "skill-context"'), "Agent reference scopes do not cover current/selection/favorites/search/all/file/skill-context");
assert(agent.includes('function referenceSourceForScope'), "Agent reference scopes are not normalized to standard reference sources");
assert(agent.includes('if (scope === "favorites") return "favorites"') && agent.includes('if (scope === "search-result") return "search-result"') && agent.includes('if (scope === "all") return "all"'), "Agent reference scope source mapping is incomplete");
assert(agent.includes('if (scope === "file") return uniqueClips(options.allClips.filter((clip) => clip.payloadKind === "file" || clip.payloadKind === "image"))'), "Agent file scope does not use file/image metadata references");
assert(agent.includes('if (scope === "skill-context") return uniqueClips(options.allClips.filter(hasSkillContext))'), "Agent skill-context scope does not derive skill context references");
assert(agent.includes('className="agent-reference-scope-grid"'), "Agent reference scope grid is missing from the reference picker");
assert(agent.includes('onAttachScope(item.scope)') && agent.includes("const attachScope = useCallback"), "Agent reference scope quick actions are not wired");
assert(agent.includes("allowFullContentForRun"), "Agent full-content run authorization state is missing");
assert(agent.includes('type AgentPermissionMode = "metadata" | "summary" | "content"'), "Agent permission mode configuration is missing");
assert(agent.includes("suggestedPromptsForClip"), "Agent default suggested prompts are missing");
assert(agent.includes("await settingsService.agent.check(providerId)"), "Agent provider prewarm check is not routed through settingsService");
assert(agent.includes("providerCheckSeq") && agent.includes("providerModelsSeq"), "Agent provider check/models do not guard stale async results");
assert(
  agent.includes('status: "checking"') &&
    agent.indexOf('status: "checking"') < agent.indexOf("await settingsService.agent.check(providerId)"),
  "Agent provider check does not publish checking state before awaiting network/native work",
);
assert(
  agent.includes('status: "loading"') &&
    agent.indexOf('status: "loading"') < agent.indexOf("await settingsService.agent.models(providerId)"),
  "Agent provider models does not publish loading state before awaiting network/native work",
);
assert(
  settingsService.includes("AGENT_OPERATION_TIMEOUT_MS") &&
    settingsService.includes("withTimeout") &&
    settingsService.includes('"agent.check"') &&
    settingsService.includes('"agent.models"'),
  "Agent provider check/models are not wrapped with a bounded timeout in settingsService",
);
assert(
  agent.includes('status: isTimeout ? "health-timeout" : "check-failed"') &&
    agent.includes('status: isTimeout ? "models-timeout" : "models-failed"'),
  "Agent provider timeout/error states are not surfaced without blocking the panel",
);
assertDoesNotInclude(agent, "agent-provider-details", "Agent provider detail row should stay hidden from the compact Agent panel", "紧凑面板中 provider 详情属于设置面控制项，会挤压对话主路径");
assertDoesNotInclude(agent, "agent-permission-strip", "Agent permission segmented strip should stay hidden from the compact Agent panel", "权限模式选择已收敛到受控运行态，常驻 strip 会增加主交互噪声");
assert(agent.includes('clip.payloadKind === "file" || clip.payloadKind === "image" || source === "skill-context"'), "File/image/skill references are not metadata-only by default");
assert(agent.includes("allowFullContent: allowFullContentForRun"), "Agent run does not carry the single-run full-content authorization");
assert(agent.includes("getMentionQuery(input)") && agent.includes("referenceCandidates"), "Agent references should be driven by @ mention autocomplete");
assert(agent.includes("CONVERSATION_STORAGE_KEY"), "Agent minimal conversation persistence is missing");
assert(agent.includes("currentAnchorId"), "Agent last-anchor restore state is missing");
assert(agent.includes("agent_restore_session"), "Agent runtime session restore call is missing");
assert(agent.includes("messagesFromRunSnapshot"), "Agent runtime transcript restore mapping is missing");
assert(agent.includes("panelStatusFromRun"), "Agent runtime status restore mapping is missing");
assert(agent.includes('invoke<AgentSessionSnapshotPayload>("agent_restore_session")'), "Agent panel does not restore runtime runs after remount");
assert(agent.includes('const detectTimer = window.setTimeout(() => {') && agent.includes('invoke<AgentProviderReadiness[]>("agent_detect")'), "Agent detect is not deferred after panel mount");
assert(agent.includes("pendingRun"), "Agent command preview confirmation state is missing");
assert(agent.includes("agent-run-confirmation"), "Agent command confirmation UI is missing");
assert(agent.includes('from "./components/ui/attachment"'), "Agent attachments do not reuse the local Attachment primitive");
assert(agent.includes("AttachmentMedia") && agent.includes("AttachmentActions"), "Agent attachment media/content/actions structure is missing");
assert(agent.includes("data-message-scroller-provider"), "Agent message scroller provider marker is missing");
assert(agent.includes("data-message-scroller"), "Agent message scroller marker is missing");
assert(agent.includes("AgentMessageScrollerItem"), "Agent scroller item wrapper is missing");
assert(agent.includes("AgentRunMarker"), "Agent run marker does not use the MessageScroller item structure");
assert(agent.includes("data-message-scroller-item"), "Agent messages do not expose MessageScroller item markers");
assert(agent.includes("data-message-scroller-button"), "Agent latest button does not expose MessageScroller button marker");
assert(agent.includes('className="agent-message-body"'), "Agent message body layer is missing");
assert(agent.includes('data-default-scroll-position="end"'), "Agent scroller does not default to end positioning on entry");
assert(agent.includes("pendingTurnAnchorRef"), "Agent scroller does not preserve the active turn anchor");
assert(agent.includes("visibleRowRef") && agent.includes("rememberVisibleRow"), "Agent scroller does not preserve the current visible row while reading history");
assert(agent.includes("restoreVisibleRow") && agent.includes("preserveVisibleRowDuring"), "Agent scroller does not use a shared visible-row preservation path");
assert(agent.includes("preserveVisibleRowForDomChange"), "Agent expandable message content does not preserve visible rows before DOM height changes");
assert(agent.includes("onPointerReadStart={() => {\n        rememberVisibleRow();\n        setLiveEdge(false);") && agent.includes("onPointerDown={onPointerReadStart}"), "Agent scroller does not release live-edge on direct reading interaction");
assert(agent.includes('data-scroll-anchor="true"'), "Agent run marker is not marked as a scroll anchor");
assert(agent.includes('if (!liveEdge) {\n      setHasUnread(true);\n      return;\n    }'), "Agent stream updates can still force-scroll after leaving live-edge");
assert(agent.includes("data-agent-message-id"), "Agent messages do not expose stable message ids");
assert(agent.includes("agent-message-actions"), "Agent result actions are not rendered inside messages");
assert(agent.includes("AgentCustomEventPreview"), "Agent custom event preview renderer is missing");
assert(agent.includes('event === "tagPatchPreview"'), "Agent tag patch preview event is not rendered");
assert(agent.includes('event === "previewPatch"'), "Agent patch preview event is not rendered");
assert(agent.includes('event === "suggestUpdate"'), "Agent suggest update event is not rendered");
assert(agent.includes('event === "renderPanel"'), "Agent render panel event is not rendered");
assert(agent.includes("function AgentToolPartPreview"), "Agent tool call/result preview renderer is missing");
assert(agent.includes('data-agent-tool-part={part.type}'), "Agent tool preview does not expose stable data markers");
assert(agent.includes("onBeforeToggle();\n          setExpanded"), "Agent tool expand/collapse does not preserve scroll before DOM changes");
assert(agent.includes("retryRunFromRow"), "Agent failed/cancelled runs do not expose retry behavior");
assert(agent.includes('tr("agent.action.retry")'), "Agent retry action is missing from failed/cancelled messages");
assert(agent.includes("contextSetPart(previousUserMessage.parts) ?? contextSet"), "Agent retry does not reuse the original user turn context set");
assert(css.includes(".agent-overlay.open"), "Agent overlay open style is missing");
assert(css.includes("transform: translateY(0) scale(1)"), "Agent overlay enter animation is missing");
assert(css.includes(".agent-access-icon"), "Agent icon style is missing");
assert(css.includes(".agent-run-confirmation"), "Agent command confirmation style is missing");
assertDoesNotInclude(agent, "agent-reference-empty", "Agent empty reference pill should not render in the compact composer", "空引用 pill 会在无上下文时制造无效控件并压缩输入框");
assertDoesNotInclude(agent, "agent-suggestion-strip", "Agent default suggested prompts should not render before the user types", "默认提示条不应抢占紧凑 composer 首屏空间");
assertDoesNotInclude(css, ".agent-reference-empty", "Agent empty reference pill style should not remain", "组件移除后样式残留会误导后续拆分判断");
assertDoesNotInclude(css, ".agent-suggestion-strip", "Agent suggested prompt strip style should not remain in the compact composer", "组件移除后样式残留会让紧凑 composer 回退到旧布局");
assertDoesNotInclude(css, ".agent-permission-strip", "Agent permission mode strip style should not be present in the compact Agent panel", "权限 strip 已退出紧凑面板，样式残留会鼓励重新挂载");
assertDoesNotInclude(css, ".agent-provider-details", "Agent provider detail style should not be present in the compact Agent panel", "provider 详情属于设置面，样式残留会鼓励重新挂载");
assert(css.includes("grid-template-columns: minmax(0, 1fr) 34px"), "Agent compact composer should only keep input plus send button");
assert(css.includes(".agent-reference-scope-grid"), "Agent reference scope grid style is missing");
assert(css.includes(".agent-message-scroller-provider"), "Agent message scroller provider style is missing");
assert(css.includes(".agent-message-scroller-item"), "Agent message scroller item style is missing");
assert(css.includes(".agent-message-body"), "Agent message body style is missing");
assert(css.includes(".agent-message-actions"), "Agent inline message action style is missing");
assert(css.includes(".agent-tool-preview"), "Agent tool preview style is missing");
assert(css.includes(".agent-row.user-message"), "Agent user message transcript style is missing");
assert(css.includes(".agent-attachment.attachment.compact"), "Agent attachments are not scoped over the shared Attachment primitive");
assert(css.includes(".agent-custom-preview"), "Agent custom event preview style is missing");
assert(contracts.includes("AgentAgUiEventPayload"), "Agent AG-UI event payload contract is missing");
assert(rust.includes("struct AgentAgUiEventPayload"), "Rust AG-UI event payload is missing");
assert(rust.includes("enum AgentRunStatus"), "Rust Agent run status machine enum is missing");
assert(rust.includes("fn set_agent_run_status"), "Rust Agent run status transition helper is missing");
assert(rust.includes("fn agent_restore_session"), "Rust Agent session restore command is missing");
assert(rust.includes("AgentSessionSnapshotPayload"), "Rust Agent session snapshot payload is missing");
assert(rust.includes("openai_compatible_agent_candidate"), "OpenAI-compatible provider registry entry is missing");
assert(rust.includes("configured_agent_providers_from_settings"), "Settings-backed Agent provider registry is missing");
assert(rust.includes('settings.get("agentProviders")') && rust.includes('agent.get("providers")'), "Agent providers are not read from settings JSON");
assert(rust.includes("CLIPFORGE_AGENT_OPENAI_BASE_URL") && rust.includes("CLIPFORGE_AGENT_OPENAI_MODEL"), "OpenAI-compatible baseURL/model config is missing");
assert(rust.includes("CLIPFORGE_AGENT_OPENAI_API_KEY") && rust.includes('"apiKey": "not-sent-to-react"'), "OpenAI-compatible API key redaction is missing");
assert(rust.includes("openai_compatible_bridge_script"), "OpenAI-compatible streaming bridge is missing");
assert(rust.includes("AgentOutputMode::StandardJsonEvents"), "streamText-style standard event normalization is missing");
assert(rust.includes('"TOOL_CALL"') && rust.includes('"data-tool-call"'), "Tool call normalization is missing");
assert(rust.includes('"TOOL_RESULT"') && rust.includes('"data-tool-result"'), "Tool result normalization is missing");
assert(rust.includes("child: Some(child)"), "Rust Agent run child is not stored outside React lifecycle");
assert(rust.includes("if let Some(child) = state.child.as_mut()") && rust.includes("let _ = child.kill();"), "Rust Agent cancel path does not terminate the child process");
assert(rust.includes("fn log_agent_event"), "Rust Agent redacted log helper is missing");
assert(rust.includes('"redactedFields": ["prompt", "output", "contextSummary", "commandPreview"'), "Rust Agent logs do not declare redacted fields");
assert(rust.includes('"chunkLength": line.chars().count()'), "Rust Agent output logs do not use chunk lengths");
assert(rust.includes("fn agent_agui_event_parts"), "Rust AG-UI to message part mapper is missing");
assert(rust.includes('app.emit("agent_agui_event"'), "Rust does not emit agent_agui_event");
assert(rust.includes('app.emit("agent_ui_message"'), "Rust no longer emits derived agent_ui_message");
assert(panelNativePath.includes("fn open_panel"), "Panel native open path is missing from verification slice");
assert(panelNativePath.includes("fn hide_panel"), "Panel native hide path is missing from verification slice");
assert(panelNativePath.includes("fn toggle_quick_panel"), "Panel native toggle path is missing from verification slice");
assertDoesNotInclude(
  panelNativePath,
  "agent_detect",
  "Panel open/hide/toggle path calls Agent detect",
  "Agent detect 超时不得影响主面板定位、隐藏或再次唤起",
);
assertDoesNotInclude(
  panelNativePath,
  "agent_check_provider",
  "Panel open/hide/toggle path calls provider check",
  "provider 健康检查属于 Agent 面板控制面，不得进入主面板热路径",
);
assertDoesNotInclude(
  panelNativePath,
  "settings_service",
  "Panel open/hide/toggle path calls Settings Service",
  "主面板热路径不得等待设置服务或 provider 控制面",
);

if (!process.exitCode) {
  console.log("Agent panel verification passed");
}
