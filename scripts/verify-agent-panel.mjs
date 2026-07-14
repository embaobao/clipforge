import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const appPath = path.join(root, "src/App.tsx");
const agentPath = path.join(root, "src/agent-panel.tsx");
const agentChatPath = path.join(root, "src/agent-chat-page.tsx");
const contractsPath = path.join(root, "src/services/contracts.ts");
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
const css = read(cssPath);
const rust = read(rustPath);

["claude", "codex", "qwen"].forEach(checkLocalAgentCli);

assert(fs.existsSync(iconPath), "agent access icon asset is missing");
assert(fs.statSync(iconPath).size > 1024, "agent access icon asset looks empty");
assert(app.includes("agentAccessIcon"), "App does not import/use the Agent access icon");
assert(app.includes('useState<PanelSurface>("clipboard")'), "App does not default to clipboard surface");
assert(app.includes('className="footer-agent-slot"'), "Agent trigger is not in the bottom-left dock slot");
assert(app.includes('className={activeSurface === "agent" ? "agent-overlay open" : "agent-overlay"}'), "Agent panel is not rendered as an overlay");
assert(app.includes('{activeSurface === "agent" ? (\n            <AgentPanelBoundary'), "Agent panel boundary is mounted before the Agent surface is opened");
assert(app.includes("<ClipboardAgentPanel"), "Agent panel component is missing from the lazy Agent surface");
const openAgentBody = app.match(/onOpenAgent=\{\(\) => \{[\s\S]*?\n        \}\}/)?.[0] ?? "";
assert(openAgentBody.includes('setActiveSurface("agent")'), "Agent footer trigger does not open the overlay synchronously");
assert(!openAgentBody.includes("invoke(") && !openAgentBody.includes("await "), "Agent footer trigger waits on native work before opening");
assert(app.includes("async function saveAgentResultAsClip"), "Agent result save flow is missing");
assert(app.includes('normalizeTagList([...normalized.tags, "AI"])'), "Saved Agent result does not default to AI tag");
assert(app.includes('generatedBy: "agent"'), "Saved Agent result does not persist agent provenance");
const updateClipContentBody = app.match(/async function updateClipContent[\s\S]*?\n  async function/)?.[0] ?? "";
assert(updateClipContentBody.includes("save_editor_draft"), "Detail editor save flow does not use save_editor_draft");
assert(updateClipContentBody.includes("tags: tags ? normalizeTagList(tags) : normalizeTagList(item.tags)"), "Ordinary detail save may not preserve user-managed tags");
assert(!updateClipContentBody.includes('"AI"'), "Ordinary detail save appears to re-add AI tag");
assert(!app.includes("PanelSurfaceTabs"), "Top Agent tab component still exists");
assert(!css.includes("panel-surface-tabs"), "Top Agent tab styles still exist");
assert(!app.includes("{activeSurface === \"clipboard\" ? (\n          <GlassSearchBar"), "Search bar is still gated by Agent surface state");
assert(!app.includes('resetKey={`${activeSurface}:workspace'), "Workspace route is still remounted by Agent surface state");
assert(agent.includes('action.type === "copyResult"') && agent.includes("onCopyResult(text)"), "Agent copy result action is not wired");
assert(agent.includes('action.type === "saveAsClip"') && agent.includes("onSaveResult(text"), "Agent save result action is not wired");
assert(agent.includes('action.type === "favoriteSourceClip"') && agent.includes("onFavoriteClip(sourceClip)"), "Agent favorite source action is not wired");
assert(agent.includes('action.type === "archiveSourceClip"') && agent.includes("onArchiveClip(sourceClip)"), "Agent archive source action is not wired");
assert(agent.includes('action.type === "appendTag"') && agent.includes('onAppendTagToSource(sourceClip, "AI")'), "Agent append AI tag action is not wired");
assert(agent.includes("parseSmartTargets(clip.content)"), "Agent references do not expose SmartParsedTarget candidates");
assert(agent.includes("primaryUrl: clip.analysis.url"), "Agent link references do not expose primaryUrl");
assert(agent.includes("summary: clip.analysis.summary || compactText(clip.content, 120)"), "Agent text references do not default to summary");
assert(agent.includes("textPreview: metadataOnly ? \"\" : compactText(clip.content, allowFullContent ? 480 : 180)"), "Agent text references do not use a short summary preview by default");
assert(agent.includes('activeClip ? makeClipReference(activeClip, "current", permissionMode) : null'), "Agent current clip is not used as the default current reference");
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
assert(agent.includes('invoke<AgentProviderReadiness>("agent_check_provider"'), "Agent provider prewarm check is missing");
assert(!agent.includes("agent-provider-details"), "Agent provider detail row should stay hidden from the compact Agent panel");
assert(!agent.includes("agent-permission-strip"), "Agent permission segmented strip should stay hidden from the compact Agent panel");
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
assert(css.includes(".agent-suggestion-strip"), "Agent suggested prompt style is missing");
assert(!css.includes(".agent-permission-strip"), "Agent permission mode strip style should not be present in the compact Agent panel");
assert(!css.includes(".agent-provider-details"), "Agent provider detail style should not be present in the compact Agent panel");
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

if (!process.exitCode) {
  console.log("Agent panel verification passed");
}
