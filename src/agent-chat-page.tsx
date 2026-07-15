import {
  Archive,
  Bot,
  Check,
  Clipboard,
  Code2,
  Copy,
  File,
  FileText,
  Heart,
  Image,
  Link,
  MessageSquare,
  RefreshCw,
  Save,
  Send,
  Square,
  Tags,
  X,
} from "lucide-react";
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent, ReactNode, RefObject, UIEvent } from "react";
import type { Transition } from "motion";
import type { ClipItem } from "./App";
import type {
  AgentContextReference,
  AgentProviderReadiness,
  AgentResultAction,
  AgentTranscriptRow,
  ClipboardAgentMessagePart,
  ClipboardAgentProviderConfig,
} from "./services/contracts";
import type { TranslationKey } from "./i18n";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
} from "./components/ui/attachment";
import { Bubble, BubbleContent } from "./components/ui/bubble";
import { Message, MessageContent, MessageFooter, MessageHeader } from "./components/ui/message";
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "./components/ui/message-scroller";

export type AgentPanelStatus = "idle" | "drafting" | "waiting_confirmation" | "succeeded" | "failed";
export type AgentPermissionMode = "metadata" | "summary" | "content";

export type AgentReferenceScope = "current" | "selection" | "favorites" | "search-result" | "all" | "file" | "skill-context";

export type AgentReferenceScopeOption = {
  scope: AgentReferenceScope;
  label: string;
  count: number;
  icon: ReactNode;
  active: boolean;
  disabled: boolean;
};

export type AgentRunPreview = {
  commandPreview: string;
  allowFullContent: boolean;
};

type AgentChatPageProps = {
  activeProviderId: string | null;
  activeProvider?: ClipboardAgentProviderConfig;
  activeReadiness?: AgentProviderReadiness;
  canSubmit: boolean;
  contextReferences: AgentContextReference[];
  hasUnread: boolean;
  input: string;
  liveEdge: boolean;
  pendingRun: AgentRunPreview | null;
  providers: ClipboardAgentProviderConfig[];
  referenceCandidates: ClipItem[];
  referencePickerOpen: boolean;
  referenceScopes: AgentReferenceScopeOption[];
  referenceSearch: string;
  rows: AgentTranscriptRow[];
  runStatusLabel: string;
  showReferencePopover: boolean;
  status: AgentPanelStatus;
  suggestedPrompts: string[];
  viewportRef: RefObject<HTMLDivElement | null>;
  onAction: (action: AgentResultAction, text: string) => void;
  onAttachClip: (clip: ClipItem) => void;
  onAttachScope: (scope: AgentReferenceScope) => void;
  onBackToClipboard: () => void;
  onBeforeExpand: () => void;
  onCancelPreview: () => void;
  onCloseReferencePicker: () => void;
  onConfirmPendingRun: () => void | Promise<void>;
  onInputChange: (value: string) => void;
  onJumpToLatest: () => void;
  onOpenReference: (reference: AgentContextReference) => void;
  onPointerReadStart: () => void;
  onReferenceSearchChange: (value: string) => void;
  onRemoveReference: (reference: AgentContextReference) => void;
  onRetry: (row: AgentTranscriptRow) => void;
  onScroll: (event: UIEvent<HTMLDivElement>) => void;
  onSelectProvider: (providerId: string) => void;
  onStopRun: () => void;
  onSubmit: (event?: FormEvent<HTMLFormElement>) => void | Promise<void>;
  onUseSuggestedPrompt: (prompt: string) => void;
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
};

const itemTransition = { type: "spring", stiffness: 380, damping: 34, mass: 0.6 } satisfies Transition;
const popoverTransition = { type: "spring", stiffness: 420, damping: 32, mass: 0.55 } satisfies Transition;

function compactText(value: string, max = 160) {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}...`;
}

function getClipTitle(clip: ClipItem) {
  return clip.analysis.title || clip.analysis.host || compactText(clip.content, 52) || clip.id;
}

function providerLabel(provider?: ClipboardAgentProviderConfig, readiness?: AgentProviderReadiness) {
  if (!provider) return "Agent";
  const suffix = readiness?.status ? ` - ${readiness.status}` : "";
  return `${provider.label || provider.id}${suffix}`;
}

function providerHint(provider?: ClipboardAgentProviderConfig, readiness?: AgentProviderReadiness) {
  if (!provider) return "Agent";
  return [provider.label || provider.id, provider.kind, readiness?.status, readiness?.reason]
    .filter(Boolean)
    .join(" / ");
}

function statusPart(parts: ClipboardAgentMessagePart[]) {
  return parts.find((part): part is Extract<ClipboardAgentMessagePart, { type: "data-status" }> => part.type === "data-status")?.data.status;
}

function statusMessagePart(parts: ClipboardAgentMessagePart[]) {
  return parts.find((part): part is Extract<ClipboardAgentMessagePart, { type: "data-status" }> => part.type === "data-status")?.data.message;
}

function resultActionsPart(parts: ClipboardAgentMessagePart[]) {
  return parts.find((part): part is Extract<ClipboardAgentMessagePart, { type: "data-result-actions" }> => part.type === "data-result-actions")?.data ?? [];
}

type AgentToolPart = Extract<ClipboardAgentMessagePart, { type: "data-tool-call" | "data-tool-result" }>;

function toolParts(parts: ClipboardAgentMessagePart[]) {
  return parts.filter((part): part is AgentToolPart => part.type === "data-tool-call" || part.type === "data-tool-result");
}

function customParts(parts: ClipboardAgentMessagePart[]) {
  return parts.filter((part): part is Extract<ClipboardAgentMessagePart, { type: "data-custom" }> => part.type === "data-custom");
}

function compactUnknownPayload(payload: Record<string, unknown>) {
  return compactText(JSON.stringify(payload), 180);
}

function referenceIcon(payloadKind: string) {
  if (payloadKind === "image") return <Image size={13} />;
  if (payloadKind === "file") return <File size={13} />;
  if (payloadKind === "link") return <Link size={13} />;
  if (payloadKind === "code" || payloadKind === "json" || payloadKind === "command") return <Code2 size={13} />;
  return <FileText size={13} />;
}

export function AgentChatPage({
  activeProviderId,
  activeProvider,
  activeReadiness,
  canSubmit,
  contextReferences,
  hasUnread,
  input,
  liveEdge,
  pendingRun,
  providers,
  referenceCandidates,
  referencePickerOpen,
  referenceScopes,
  referenceSearch,
  rows,
  runStatusLabel,
  showReferencePopover,
  status,
  viewportRef,
  onAction,
  onAttachClip,
  onAttachScope,
  onBackToClipboard,
  onBeforeExpand,
  onCancelPreview,
  onCloseReferencePicker,
  onConfirmPendingRun,
  onInputChange,
  onJumpToLatest,
  onOpenReference,
  onPointerReadStart,
  onReferenceSearchChange,
  onRemoveReference,
  onRetry,
  onScroll,
  onSelectProvider,
  onStopRun,
  onSubmit,
  tr,
}: AgentChatPageProps) {
  const reduceMotion = useReducedMotion();
  const motionEnabled = !reduceMotion;
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = "0px";
    node.style.height = `${Math.min(Math.max(node.scrollHeight, 34), 104)}px`;
  }, [input]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const node = viewportRef.current;
      if (!node) return;
      node.scrollTop = Math.max(0, node.scrollHeight - node.clientHeight);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <motion.section
        animate={motionEnabled ? { opacity: 1, y: 0 } : { opacity: 1 }}
        aria-label={tr("agent.aria.panel")}
        className="agent-panel"
        initial={motionEnabled ? { opacity: 0, y: 8 } : false}
        transition={itemTransition}
      >
        <header className="agent-panel-head">
          <div className="agent-provider-select">
            <motion.span
              aria-hidden="true"
              className="agent-provider-logo"
              transition={itemTransition}
              whileHover={motionEnabled ? { y: -1, scale: 1.06 } : undefined}
              whileTap={motionEnabled ? { scale: 0.94 } : undefined}
            >
              <Bot size={13} />
            </motion.span>
            <select
              aria-label={tr("agent.aria.selectAgent")}
              onChange={(event) => onSelectProvider(event.currentTarget.value)}
              value={activeProviderId ?? ""}
            >
              {providers.length ? (
                providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.label || provider.id}
                  </option>
                ))
              ) : (
                <option value="">Agent</option>
              )}
            </select>
            <span title={providerHint(activeProvider, activeReadiness)}>{providerLabel(activeProvider, activeReadiness)}</span>
          </div>
          <div className="agent-head-actions">
            {status === "drafting" ? (
              <MotionIconButton className="icon-button subtle" label={tr("agent.aria.stopRun")} onClick={onStopRun}>
                <Square size={12} />
              </MotionIconButton>
            ) : null}
            <MotionIconButton className="icon-button subtle" label={tr("agent.aria.backToClipboard")} onClick={onBackToClipboard}>
              <X size={14} />
            </MotionIconButton>
          </div>
        </header>

        <MessageScrollerProvider>
        <div
          className="agent-message-scroller-provider"
          data-auto-scroll={liveEdge ? "true" : "false"}
          data-default-scroll-position="end"
          data-message-scroller-provider
        >
          <MessageScroller className="agent-message-scroller" data-message-scroller>
            <MessageScrollerViewport
              className="agent-message-viewport"
              aria-label={tr("agent.aria.messages")}
              aria-live="polite"
              onKeyDown={(event) => {
                if (["ArrowUp", "PageUp", "Home", "End"].includes(event.key)) onPointerReadStart();
              }}
              onPointerDown={onPointerReadStart}
              onScroll={onScroll}
              ref={viewportRef}
              role="log"
              tabIndex={0}
            >
              <MessageScrollerContent className="agent-message-content" aria-busy={status === "drafting"}>
                <AnimatePresence initial={false}>
                  {rows.length ? (
                    rows.map((row) => (
                      <AgentMessageScrollerItem
                        key={row.id}
                        motionEnabled={motionEnabled}
                        onAction={onAction}
                        onBeforeExpand={onBeforeExpand}
                        onRetry={onRetry}
                        row={row}
                        tr={tr}
                      />
                    ))
                  ) : (
                    <motion.div
                      animate={motionEnabled ? { opacity: 1, y: 0 } : { opacity: 1 }}
                      className="agent-empty-state"
                      exit={motionEnabled ? { opacity: 0, y: -4 } : { opacity: 0 }}
                      initial={motionEnabled ? { opacity: 0, y: 6 } : false}
                      key="agent-empty"
                      transition={{ duration: 0.16 }}
                    >
                      <MessageSquare size={14} />
                      <span>{tr("agent.empty")}</span>
                    </motion.div>
                  )}
                  {status === "drafting" ? <AgentRunMarker key="agent-running" label={runStatusLabel || tr("agent.run.running")} motionEnabled={motionEnabled} /> : null}
                </AnimatePresence>
              </MessageScrollerContent>
            </MessageScrollerViewport>
            <AnimatePresence>
              {hasUnread || !liveEdge ? (
                <motion.button
                  animate={motionEnabled ? { opacity: 1, y: 0, scale: 1 } : { opacity: 1 }}
                  aria-label={tr("agent.run.latest")}
                  className="agent-message-scroller-button agent-jump-latest"
                  data-message-scroller-button
                  exit={motionEnabled ? { opacity: 0, y: 6, scale: 0.98 } : { opacity: 0 }}
                  initial={motionEnabled ? { opacity: 0, y: 6, scale: 0.98 } : false}
                  onClick={onJumpToLatest}
                  transition={itemTransition}
                  type="button"
                >
                  <MessageSquare size={12} />
                  {tr("agent.run.latest")}
                </motion.button>
              ) : null}
            </AnimatePresence>
          </MessageScroller>
        </div>
        </MessageScrollerProvider>

        <AnimatePresence>
          {pendingRun ? (
            <motion.div
              animate={motionEnabled ? { opacity: 1, y: 0 } : { opacity: 1 }}
              aria-label={tr("agent.aria.runPreview")}
              className="agent-run-confirmation"
              exit={motionEnabled ? { opacity: 0, y: 6 } : { opacity: 0 }}
              initial={motionEnabled ? { opacity: 0, y: 6 } : false}
              transition={itemTransition}
            >
              <div>
                <span>{tr("agent.run.confirm")}</span>
                <code>{pendingRun.commandPreview}</code>
                <em>{pendingRun.allowFullContent ? tr("agent.run.fullContent") : tr("agent.run.summaryOnly")}</em>
              </div>
              <motion.button type="button" whileTap={motionEnabled ? { scale: 0.97 } : undefined} onClick={() => void onConfirmPendingRun()}>
                <Check size={12} />
                {tr("agent.action.run")}
              </motion.button>
              <motion.button type="button" whileTap={motionEnabled ? { scale: 0.97 } : undefined} onClick={onCancelPreview}>
                <X size={12} />
                {tr("agent.action.cancel")}
              </motion.button>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <form className="agent-composer" onSubmit={(event) => void onSubmit(event)}>
          <AnimatePresence initial={false}>
            {contextReferences.length ? (
              <motion.div
                animate={motionEnabled ? { opacity: 1, y: 0 } : { opacity: 1 }}
                aria-label={tr("agent.aria.attachmentBar")}
                className="agent-attachment-bar"
                exit={motionEnabled ? { opacity: 0, y: 4 } : { opacity: 0 }}
                initial={motionEnabled ? { opacity: 0, y: 4 } : false}
                key="agent-attachments"
                role="group"
                tabIndex={0}
                transition={itemTransition}
              >
                {contextReferences.slice(0, 8).map((reference) => (
                  <AttachmentChip
                    key={reference.id}
                    motionEnabled={motionEnabled}
                    reference={reference}
                    onOpen={() => onOpenReference(reference)}
                    onRemove={() => onRemoveReference(reference)}
                    removeLabel={tr("agent.aria.removeReference", { title: reference.title })}
                  />
                ))}
              </motion.div>
            ) : null}
          </AnimatePresence>
          <div className="agent-composer-main">
            <textarea
              aria-label={tr("agent.aria.composer")}
              onChange={(event) => onInputChange(event.currentTarget.value)}
              onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void onSubmit();
                if (event.key === "Escape") onCloseReferencePicker();
              }}
              placeholder={tr("agent.placeholder")}
              ref={textareaRef}
              rows={1}
              value={input}
            />
            <motion.button disabled={!canSubmit} type="submit" whileTap={canSubmit && motionEnabled ? { scale: 0.97 } : undefined}>
              <Send size={14} />
            </motion.button>
          </div>
          <AnimatePresence>
            {showReferencePopover ? (
              <motion.div
                animate={motionEnabled ? { opacity: 1, y: 0, scale: 1 } : { opacity: 1 }}
                aria-label={tr("agent.aria.referenceCandidates")}
                className="agent-reference-popover"
                exit={motionEnabled ? { opacity: 0, y: 6, scale: 0.985 } : { opacity: 0 }}
                initial={motionEnabled ? { opacity: 0, y: 8, scale: 0.985 } : false}
                role="listbox"
                transition={popoverTransition}
              >
                {referencePickerOpen ? (
                  <input
                    aria-label={tr("agent.aria.searchReference")}
                    autoFocus
                    onChange={(event) => onReferenceSearchChange(event.currentTarget.value)}
                    placeholder={tr("agent.referenceSearchPlaceholder")}
                    value={referenceSearch}
                  />
                ) : null}
                {referencePickerOpen ? (
                  <div className="agent-reference-scope-grid" aria-label={tr("agent.aria.referenceScopes")} role="group">
                    {referenceScopes.map((item) => (
                      <motion.button
                        aria-pressed={item.active}
                        className={item.active ? "active" : ""}
                        disabled={item.disabled}
                        key={item.scope}
                        layout
                        onClick={() => onAttachScope(item.scope)}
                        title={tr("agent.scope.add", { label: item.label, count: item.count })}
                        type="button"
                        whileTap={!item.disabled && motionEnabled ? { scale: 0.98 } : undefined}
                      >
                        {item.active ? <motion.span className="agent-scope-selection" layoutId="agent-reference-scope-selection" transition={itemTransition} /> : null}
                        {item.icon}
                        <span>{item.label}</span>
                        <em>{item.count}</em>
                      </motion.button>
                    ))}
                  </div>
                ) : null}
                {referenceCandidates.map((clip, index) => (
                  <motion.button
                    animate={motionEnabled ? { opacity: 1, y: 0 } : { opacity: 1 }}
                    exit={motionEnabled ? { opacity: 0, y: 4 } : { opacity: 0 }}
                    initial={motionEnabled ? { opacity: 0, y: 4 } : false}
                    key={clip.id}
                    onClick={() => onAttachClip(clip)}
                    role="option"
                    transition={{ duration: 0.14, delay: motionEnabled ? index * 0.018 : 0 }}
                    type="button"
                    whileTap={motionEnabled ? { scale: 0.99 } : undefined}
                  >
                    {referenceIcon(clip.payloadKind)}
                    <span>
                      <strong>{getClipTitle(clip)}</strong>
                      <em>{clip.payloadKind} - {compactText(clip.content, 72)}</em>
                    </span>
                  </motion.button>
                ))}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </form>
      </motion.section>
    </MotionConfig>
  );
}

function MotionIconButton({ children, className, label, onClick }: { children: ReactNode; className: string; label: string; onClick: () => void }) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.button
      aria-label={label}
      className={className}
      onClick={onClick}
      type="button"
      whileTap={reduceMotion ? undefined : { scale: 0.96 }}
    >
      {children}
    </motion.button>
  );
}

function AgentRunMarker({ label, motionEnabled }: { label: string; motionEnabled: boolean }) {
  return (
    <MessageScrollerItem
      className="agent-message-scroller-item agent-row run-marker"
      data-agent-message-id="run-marker:active"
      data-agent-row-id="run-marker:active"
      data-message-scroller-item
      data-scroll-anchor="true"
      scrollAnchor
    >
      <motion.div
        animate={motionEnabled ? { opacity: 1, y: 0 } : { opacity: 1 }}
        className="agent-message-body"
        exit={motionEnabled ? { opacity: 0, y: -4 } : { opacity: 0 }}
        initial={motionEnabled ? { opacity: 0, y: 6 } : false}
        layout
        role="status"
        transition={itemTransition}
      >
        <motion.span
          animate={motionEnabled ? { rotate: 360 } : { rotate: 0 }}
          className="agent-run-icon"
          transition={motionEnabled ? { duration: 1.1, ease: "linear", repeat: Infinity } : undefined}
        >
          <RefreshCw size={12} />
        </motion.span>
        <span>{label}</span>
      </motion.div>
    </MessageScrollerItem>
  );
}

function AttachmentChip({
  motionEnabled,
  reference,
  onOpen,
  onRemove,
  removeLabel,
}: {
  motionEnabled: boolean;
  reference: AgentContextReference;
  onOpen: () => void;
  onRemove: () => void;
  removeLabel: string;
}) {
  const clickable = Boolean(reference.clipId);
  return (
    <motion.div
      animate={motionEnabled ? { opacity: 1, x: 0, scale: 1 } : { opacity: 1 }}
      className="agent-attachment-shell"
      exit={motionEnabled ? { opacity: 0, x: -8, scale: 0.98 } : { opacity: 0 }}
      initial={motionEnabled ? { opacity: 0, x: -8, scale: 0.98 } : false}
      layout
      transition={itemTransition}
    >
      <Attachment
        aria-disabled={!clickable}
        className={clickable ? "agent-attachment compact clickable" : "agent-attachment compact"}
        onClick={clickable ? onOpen : undefined}
        onKeyDown={
          clickable
            ? (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onOpen();
                }
              }
            : undefined
        }
        role={clickable ? "button" : undefined}
        tabIndex={clickable ? 0 : undefined}
        title={reference.summary || reference.textPreview || reference.title}
      >
        <AttachmentMedia className="agent-attachment-media">{referenceIcon(reference.payloadKind)}</AttachmentMedia>
        <AttachmentContent>
          <AttachmentTitle>{reference.title}</AttachmentTitle>
          <AttachmentDescription>{reference.payloadKind} - {reference.permissionScope}</AttachmentDescription>
        </AttachmentContent>
        <AttachmentActions>
          <AttachmentAction
            aria-label={removeLabel}
            className="agent-attachment-remove"
            onClick={(event) => {
              event.stopPropagation();
              onRemove();
            }}
          >
            <X size={11} />
          </AttachmentAction>
        </AttachmentActions>
      </Attachment>
    </motion.div>
  );
}

function AgentMessageScrollerItem({
  motionEnabled,
  row,
  onAction,
  onBeforeExpand,
  onRetry,
  tr,
}: {
  motionEnabled: boolean;
  row: AgentTranscriptRow;
  onAction: (action: AgentResultAction, text: string) => void;
  onBeforeExpand: () => void;
  onRetry: (row: AgentTranscriptRow) => void;
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
}) {
  return (
    <MessageScrollerItem
      className={`agent-message-scroller-item agent-row ${row.kind}`}
      data-agent-message-id={row.messageId ?? row.id}
      data-agent-row-id={row.id}
      data-message-scroller-item
      data-scroll-anchor={row.scrollAnchor ? "true" : "false"}
      scrollAnchor={row.scrollAnchor}
    >
      <motion.div
        animate={motionEnabled ? { opacity: 1, y: 0 } : { opacity: 1 }}
        exit={motionEnabled ? { opacity: 0, y: -4 } : { opacity: 0 }}
        initial={motionEnabled ? { opacity: 0, y: 8 } : false}
        layout
        transition={itemTransition}
      >
        <AgentMessageRow row={row} onAction={onAction} onBeforeExpand={onBeforeExpand} onRetry={onRetry} tr={tr} />
      </motion.div>
    </MessageScrollerItem>
  );
}

function AgentMessageRow({
  row,
  onAction,
  onBeforeExpand,
  onRetry,
  tr,
}: {
  row: AgentTranscriptRow;
  onAction: (action: AgentResultAction, text: string) => void;
  onBeforeExpand: () => void;
  onRetry: (row: AgentTranscriptRow) => void;
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
}) {
  const text = row.parts.find((part): part is { type: "text"; text: string } => part.type === "text")?.text ?? "";
  const status = statusPart(row.parts);
  const statusMessage = statusMessagePart(row.parts);
  const actions = resultActionsPart(row.parts);
  const tools = toolParts(row.parts);
  const customEvents = customParts(row.parts);
  const actor = row.kind === "user-message" ? tr("agent.actor.user") : row.kind === "assistant-message" ? tr("agent.actor.agent") : tr("agent.actor.run");
  const canRetry = row.kind === "assistant-message" && (status === "failed" || status === "cancelled");
  const align = row.kind === "user-message" ? "end" : "start";
  const bubbleVariant = row.kind === "user-message" ? "default" : status === "failed" ? "destructive" : "outline";
  return (
    <Message align={align} className="agent-message-body">
      <MessageContent>
      <MessageHeader className="agent-row-meta">
        <span>{actor}</span>
        {status ? <em>{statusMessage ? `${status} - ${statusMessage}` : status}</em> : null}
      </MessageHeader>
      <Bubble align={align} className="agent-message-bubble" variant={bubbleVariant}>
        <BubbleContent className="agent-message-bubble-content">
          {text ? <pre>{text}</pre> : null}
          {tools.map((part, index) => (
            <AgentToolPartPreview key={`${part.type}:${part.data.name}:${index}`} onBeforeToggle={onBeforeExpand} part={part} tr={tr} />
          ))}
          {customEvents.map((part, index) => (
            <AgentCustomEventPreview key={`${part.data.event}:${index}`} event={part.data.event} payload={part.data.payload} tr={tr} />
          ))}
        </BubbleContent>
      </Bubble>
      {actions.length || canRetry ? (
        <MessageFooter className="agent-message-actions">
          {canRetry ? (
            <motion.button aria-label={tr("agent.action.retry")} onClick={() => onRetry(row)} type="button" whileTap={{ scale: 0.98 }}>
              <RefreshCw size={12} />
              {tr("agent.action.retry")}
            </motion.button>
          ) : null}
          {actions.map((action) => (
            <motion.button aria-label={action.label} key={action.type} onClick={() => onAction(action, text)} type="button" whileTap={{ scale: 0.98 }}>
              {action.type === "copyResult" ? <Copy size={12} /> : null}
              {action.type === "pasteResult" ? <Clipboard size={12} /> : null}
              {action.type === "saveAsClip" ? <Save size={12} /> : null}
              {action.type === "favoriteSourceClip" ? <Heart size={12} /> : null}
              {action.type === "archiveSourceClip" ? <Archive size={12} /> : null}
              {action.type === "appendTag" ? <Tags size={12} /> : null}
              {action.label}
            </motion.button>
          ))}
        </MessageFooter>
      ) : null}
      </MessageContent>
    </Message>
  );
}

function AgentToolPartPreview({
  onBeforeToggle,
  part,
  tr,
}: {
  onBeforeToggle: () => void;
  part: AgentToolPart;
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
}) {
  const reduceMotion = useReducedMotion();
  const isCall = part.type === "data-tool-call";
  const preview = isCall ? part.data.argumentsPreview : part.data.resultPreview;
  const label = isCall ? tr("agent.tool.call", { name: part.data.name }) : tr("agent.tool.result", { name: part.data.name });
  const [expanded, setExpanded] = useState(false);
  return (
    <motion.div className="agent-tool-preview" data-agent-tool-part={part.type} data-expanded={expanded ? "true" : "false"} layout>
      <motion.button
        className="agent-tool-preview-toggle"
        onClick={() => {
          onBeforeToggle();
          setExpanded((current) => !current);
        }}
        type="button"
        whileTap={reduceMotion ? undefined : { scale: 0.99 }}
      >
        <Code2 size={12} />
        <span>{label}</span>
        <em>{part.data.status}</em>
      </motion.button>
      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.pre animate={{ opacity: 1 }} exit={{ opacity: 0 }} initial={reduceMotion ? false : { opacity: 0 }} key="expanded">
            {preview || part.data.name}
          </motion.pre>
        ) : (
          <motion.span animate={{ opacity: 1 }} exit={{ opacity: 0 }} initial={reduceMotion ? false : { opacity: 0 }} key="compact">
            {compactText(preview || part.data.name, 132)}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function AgentCustomEventPreview({
  event,
  payload,
  tr,
}: {
  event: string;
  payload: Record<string, unknown>;
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
}) {
  if (event === "tagPatchPreview") {
    const add = Array.isArray(payload.add) ? payload.add.map(String) : [];
    const remove = Array.isArray(payload.remove) ? payload.remove.map(String) : [];
    const keep = Array.isArray(payload.keep) ? payload.keep.map(String) : [];
    return (
      <div className="agent-custom-preview" data-agent-custom-event={event}>
        <strong>{tr("agent.custom.tagPatch")}</strong>
        <span>{[add.length ? `+ ${add.join(", ")}` : "", remove.length ? `- ${remove.join(", ")}` : "", keep.length ? `= ${keep.length}` : ""].filter(Boolean).join(" - ") || compactUnknownPayload(payload)}</span>
      </div>
    );
  }
  if (event === "previewPatch" || event === "suggestUpdate") {
    const preview = typeof payload.preview === "string" ? payload.preview : typeof payload.rationale === "string" ? payload.rationale : compactUnknownPayload(payload);
    const risk = typeof payload.riskLevel === "string" ? payload.riskLevel : "";
    return (
      <div className="agent-custom-preview" data-agent-custom-event={event}>
        <strong>{event === "previewPatch" ? tr("agent.custom.patchPreview") : tr("agent.custom.suggestUpdate")}</strong>
        <span>{risk ? `${risk} - ${compactText(preview, 160)}` : compactText(preview, 160)}</span>
      </div>
    );
  }
  if (event === "renderPanel") {
    const title = typeof payload.title === "string" ? payload.title : tr("agent.custom.panel");
    const description = typeof payload.description === "string" ? payload.description : compactUnknownPayload(payload);
    return (
      <div className="agent-custom-preview" data-agent-custom-event={event}>
        <strong>{title}</strong>
        <span>{compactText(description, 160)}</span>
      </div>
    );
  }
  return (
    <div className="agent-custom-preview" data-agent-custom-event={event}>
      <strong>{event}</strong>
      <span>{compactUnknownPayload(payload)}</span>
    </div>
  );
}
