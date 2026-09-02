import { useEffect, useMemo, useRef, useState } from "react";
import { type Block, projectEvents } from "../lib/events";
import { useActiveStructure } from "../lib/useStructure";
import { useStore } from "../store";
import {
  IconArrowUp,
  IconChat,
  IconExternal,
  IconPlus,
  IconStop,
  IconWrench,
} from "../ui/icons";
import { Badge, Button, EmptyState, Spinner } from "../ui/kit";
import { NeedsLink } from "../components/NeedsLink";
import { ChatTargetBar } from "./ChatTargetBar";

function json(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** Quiet mono label above a turn, e.g. "YOU" or the agent name. */
function TurnLabel({ label }: { label: string }): JSX.Element {
  return (
    <div className="mb-1 font-spacemono text-2xs uppercase tracking-widest text-faint">
      {label}
    </div>
  );
}

function BlockView({
  block,
  agentName,
  onRespond,
}: {
  block: Block;
  agentName: string;
  onRespond: (requestId: string, optionId?: string) => void;
}): JSX.Element | null {
  if (block.kind === "user") {
    return (
      <div>
        <TurnLabel label="You" />
        <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-text">
          {block.text}
        </div>
      </div>
    );
  }
  if (block.kind === "assistant") {
    return (
      <div>
        <TurnLabel label={agentName} />
        <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-text">
          {block.text}
          {block.streaming ? (
            <span className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 animate-pulse bg-text" />
          ) : null}
        </div>
      </div>
    );
  }
  if (block.kind === "reasoning") {
    return (
      <details className="text-xs text-muted">
        <summary className="cursor-pointer select-none text-faint">
          thinking…
        </summary>
        <div className="mt-1 whitespace-pre-wrap border-l-2 border-border pl-3 italic">
          {block.text}
        </div>
      </details>
    );
  }
  if (block.kind === "tool") {
    const tone =
      block.status === "completed"
        ? "accent"
        : block.status === "pending"
          ? "warn"
          : "danger";
    return (
      <details className="overflow-hidden rounded-lg border border-border bg-panel text-xs">
        <summary className="flex cursor-pointer select-none items-center gap-2 px-2.5 py-1.5">
          <IconWrench className="h-3.5 w-3.5 text-faint" />
          <span className="font-mono text-text">{block.name}</span>
          <Badge tone={tone}>{block.status}</Badge>
          {block.partial ? <Badge tone="info">streaming</Badge> : null}
        </summary>
        <div className="space-y-1 px-2.5 pb-2">
          <pre className="overflow-x-auto rounded border border-border bg-subtle p-2 text-2xs text-muted">
            {json(block.input)}
          </pre>
          {block.output !== undefined ? (
            <pre className="overflow-x-auto rounded border border-border bg-subtle p-2 text-2xs text-muted">
              {json(block.output)}
            </pre>
          ) : null}
          {block.error ? (
            <div className="text-2xs text-danger">{block.error}</div>
          ) : null}
        </div>
      </details>
    );
  }
  if (block.kind === "subagent") {
    return (
      <details className="overflow-hidden rounded-lg border border-violet/30 bg-violet/[0.04] text-xs">
        <summary className="flex cursor-pointer select-none items-center gap-2 px-2.5 py-1.5">
          <span className="text-violet">◆</span>
          <span className="text-text">delegated to {block.name}</span>
          <Badge tone={block.status === "completed" ? "accent" : "warn"}>
            {block.status}
          </Badge>
          {block.childSessionId ? (
            <span
              className="truncate font-mono text-[10px] text-faint"
              title="Child session id"
            >
              {block.childSessionId}
            </span>
          ) : null}
        </summary>
        {block.output !== undefined ? (
          <pre className="mx-2.5 mb-2 overflow-x-auto rounded border border-border bg-subtle p-2 text-2xs text-muted">
            {json(block.output)}
          </pre>
        ) : null}
      </details>
    );
  }
  if (block.kind === "input") {
    if (block.resolved) {
      return (
        <div className="rounded-lg border border-border bg-subtle px-3 py-2 text-[13px] text-muted">
          <span className="text-text">{block.prompt}</span>
          <span className="ml-2 font-spacemono text-[10px] uppercase tracking-wider text-faint">
            {block.resolved}
          </span>
        </div>
      );
    }
    return (
      <div className="rounded-lg border border-warn/40 bg-warn/[0.06] p-3 text-[13px]">
        <div className="text-text">{block.prompt}</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {(
            block.options ?? [
              { id: "approve", label: "Approve" },
              { id: "deny", label: "Deny" },
            ]
          ).map((o) => (
            <Button
              key={o.id}
              size="sm"
              variant={o.style === "danger" ? "danger" : "secondary"}
              onClick={() => onRespond(block.requestId, o.id)}
            >
              {o.label}
            </Button>
          ))}
        </div>
      </div>
    );
  }
  if (block.kind === "auth") {
    return (
      <div className="rounded-lg border border-info/40 bg-info/[0.06] p-3 text-[13px]">
        <div className="flex items-center gap-2 text-text">
          Sign in to {block.name}
          {block.outcome ? (
            <Badge tone={block.outcome === "authorized" ? "success" : "warn"}>
              {block.outcome}
            </Badge>
          ) : null}
        </div>
        {block.instructions ? (
          <div className="mt-1 text-xs text-muted">{block.instructions}</div>
        ) : null}
        {block.reason ? (
          <div className="mt-1 text-xs text-muted">{block.reason}</div>
        ) : null}
        {block.url && !block.outcome ? (
          <a
            href={block.url}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex items-center gap-1 rounded-lg bg-black/[0.05] px-3 py-1.5 text-xs text-text hover:bg-black/[0.08]"
          >
            <IconExternal className="h-3.5 w-3.5" />
            Open sign-in
          </a>
        ) : null}
        {block.userCode && !block.outcome ? (
          <div className="mt-2 font-mono text-xs text-muted">
            Code: {block.userCode}
          </div>
        ) : null}
      </div>
    );
  }
  if (block.kind === "system") {
    const cls =
      block.tone === "danger"
        ? "text-danger"
        : block.tone === "warn"
          ? "text-warn"
          : "text-faint";
    return (
      <div
        className={`flex items-center gap-2 font-spacemono text-[10px] uppercase tracking-[0.14em] ${cls}`}
      >
        <span className="h-px min-w-4 flex-1 bg-border" />
        <span className="min-w-0 max-w-[80%] whitespace-pre-wrap break-words text-center normal-case tracking-normal">
          {block.text}
        </span>
        <span className="h-px min-w-4 flex-1 bg-border" />
      </div>
    );
  }
  if (block.kind === "result") {
    return (
      <details className="overflow-hidden rounded-lg border border-border bg-panel text-xs" open>
        <summary className="flex cursor-pointer select-none items-center gap-2 px-2.5 py-1.5">
          <span className="text-text">structured result</span>
          <Badge tone="accent">result.completed</Badge>
        </summary>
        <pre className="mx-2.5 mb-2 overflow-x-auto rounded border border-border bg-subtle p-2 text-2xs text-muted">
          {json(block.result)}
        </pre>
      </details>
    );
  }
  return null;
}

/** ⋯ menu with the session controls eve exposes beside "send". */
function SessionMenu({
  disabled,
  onCompact,
  onClear,
  onReset,
}: {
  disabled: boolean;
  onCompact: () => void;
  onClear: () => void;
  onReset: () => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onDoc = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const item = (
    label: string,
    hint: string,
    fn: () => void,
    danger = false,
  ): JSX.Element => (
    <button
      type="button"
      onClick={() => {
        setOpen(false);
        fn();
      }}
      className={`flex w-full flex-col items-start rounded-md px-2.5 py-1.5 text-left transition-colors hover:bg-black/[0.04] ${
        danger ? "text-danger" : "text-text"
      }`}
    >
      <span className="text-[12.5px]">{label}</span>
      <span className="text-[10.5px] text-faint">{hint}</span>
    </button>
  );

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        title="Session controls"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-faint transition-colors hover:bg-black/[0.05] hover:text-text disabled:opacity-40"
      >
        <span className="text-[16px] leading-none">⋯</span>
      </button>
      {open ? (
        <div className="absolute bottom-10 right-0 z-20 w-64 space-y-0.5 rounded-lg border border-border bg-panel p-1 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.2)]">
          {item(
            "Compact context",
            "Summarize history in place (POST /compact)",
            onCompact,
          )}
          {item(
            "Clear context",
            "Drop model history, keep the session (POST /clear)",
            onClear,
          )}
          {item(
            "Reset session",
            "Retire the session and archive this thread (POST /reset)",
            onReset,
            true,
          )}
        </div>
      ) : null}
    </div>
  );
}

export function Chat(): JSX.Element {
  const activeAgentId = useStore((s) => s.activeAgentId);
  const agents = useStore((s) => s.agents);
  const runtime = useStore((s) => s.runtime);
  const activeThreadId = useStore((s) => s.activeThreadId);
  const events = useStore((s) => s.events);
  const statusMap = useStore((s) => s.status);
  const statusErrors = useStore((s) => s.statusError);
  const newThread = useStore((s) => s.newThread);
  const send = useStore((s) => s.send);
  const respond = useStore((s) => s.respond);
  const cancelTurn = useStore((s) => s.cancelTurn);
  const compactContext = useStore((s) => s.compactContext);
  const clearContext = useStore((s) => s.clearContext);
  const resetSession = useStore((s) => s.resetSession);
  const controlNotice = useStore((s) => s.controlNotice);
  const clearControlNotice = useStore((s) => s.clearControlNotice);
  const chatTargetMap = useStore((s) => s.chatTarget);

  const [draft, setDraft] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { structure } = useActiveStructure();
  const model = structure?.model ?? null;

  const threadEvents = activeThreadId ? (events[activeThreadId] ?? []) : [];
  const projection = useMemo(() => projectEvents(threadEvents), [threadEvents]);
  const chatStatus = activeThreadId ? statusMap[activeThreadId] : undefined;
  const streaming = chatStatus === "streaming";

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [projection.blocks]);

  useEffect(() => {
    if (!streaming) {
      setCancelling(false);
    }
  }, [streaming]);

  if (!activeAgentId) {
    return <div className="flex-1" />;
  }

  const rt = runtime[activeAgentId];
  const running = rt?.status === "running";
  const target = chatTargetMap[activeAgentId] ?? "local";
  const ready = target === "deployed" ? true : running;
  const agentName = agents.find((a) => a.id === activeAgentId)?.name ?? "Agent";
  const contextWindow = 200_000;

  const submit = (): void => {
    const text = draft.trim();
    if (!text || streaming || !ready || !activeThreadId) {
      return;
    }
    setDraft("");
    void send(text);
  };

  const cancel = (): void => {
    if (!streaming) {
      return;
    }
    setCancelling(true);
    void cancelTurn();
  };

  const canSend =
    !streaming && draft.trim().length > 0 && ready && !!activeThreadId;
  const notice =
    controlNotice && controlNotice.threadId === activeThreadId
      ? controlNotice
      : null;

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <NeedsLink agentId={activeAgentId} />
      <ChatTargetBar agentId={activeAgentId} />

      <div className="flex-1 overflow-auto px-8 py-8">
        <div className="mx-auto w-full max-w-3xl space-y-7">
          {!activeThreadId ? (
            <EmptyState
              icon={<IconChat className="h-5 w-5" />}
              title="No thread selected"
              action={
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => newThread(activeAgentId)}
                >
                  <IconPlus className="h-3.5 w-3.5" />
                  New chat
                </Button>
              }
            >
              Pick a thread in the sidebar, or start a new one.
            </EmptyState>
          ) : projection.blocks.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
              <div className="text-[15px] font-medium text-text">
                {agentName}
              </div>
              <div className="text-[13px] text-muted">
                {ready
                  ? "What can I help you with?"
                  : "Start the agent (or switch to Deployed) to chat."}
              </div>
            </div>
          ) : (
            projection.blocks.map((b) => (
              <BlockView
                key={b.id}
                block={b}
                agentName={agentName}
                onRespond={(r, o) => respond(r, o)}
              />
            ))
          )}
          {chatStatus === "error" ? (
            <div className="rounded-lg bg-danger/10 px-3 py-2 text-xs leading-relaxed text-danger">
              {(activeThreadId && statusErrors[activeThreadId]) ||
                "Turn failed — see the agent logs."}
            </div>
          ) : null}
          {notice ? (
            <div
              className={`flex items-start justify-between gap-3 rounded-lg px-3 py-2 text-2xs ${
                notice.ok
                  ? "bg-black/[0.03] text-muted"
                  : "bg-danger/10 text-danger"
              }`}
            >
              <span className="leading-relaxed">{notice.text}</span>
              <button
                type="button"
                className="shrink-0 opacity-70 hover:opacity-100"
                onClick={clearControlNotice}
              >
                ✕
              </button>
            </div>
          ) : null}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="mx-auto w-full max-w-3xl px-5 pb-5 pt-1">
        {streaming ? (
          <div className="mb-2 flex justify-center">
            <button
              type="button"
              onClick={cancel}
              disabled={cancelling}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-canvas px-3 py-1 text-2xs text-muted transition-colors hover:border-border-strong hover:text-text disabled:opacity-60"
              title="POST /eve/v1/session/:id/cancel — confirmed on the stream as turn.cancelled"
            >
              <IconStop className="h-3 w-3" />
              {cancelling ? "Cancelling…" : "Cancel turn"}
            </button>
          </div>
        ) : null}
        <div className="flex items-end gap-2.5 rounded-[18px] border border-border bg-panel px-4 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.12)]">
          <SessionMenu
            disabled={!activeThreadId || !ready}
            onCompact={() => void compactContext()}
            onClear={() => void clearContext()}
            onReset={() => void resetSession()}
          />
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder={
              ready
                ? target === "deployed"
                  ? "Message the deployed agent…"
                  : "Message the agent…"
                : "Start the agent to chat"
            }
            disabled={!ready || !activeThreadId}
            className="field-auto max-h-44 flex-1 resize-none self-center border-0 bg-transparent text-[14px] leading-6 text-text outline-none placeholder:text-faint disabled:opacity-50"
          />
          {streaming ? (
            <button
              type="button"
              onClick={cancel}
              disabled={cancelling}
              title="Cancel turn"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-text text-white transition-[background-color,transform] duration-150 hover:bg-text/80 active:scale-95 disabled:bg-black/[0.05] disabled:text-faint"
            >
              {cancelling ? (
                <Spinner className="h-[18px] w-[18px]" />
              ) : (
                <IconStop className="h-[14px] w-[14px]" />
              )}
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!canSend}
              title="Send"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-text text-white transition-[background-color,transform] duration-150 hover:bg-text/80 active:scale-95 disabled:bg-black/[0.05] disabled:text-faint"
            >
              <IconArrowUp className="h-[18px] w-[18px]" />
            </button>
          )}
        </div>
        {model || projection.costUsd > 0 || projection.outputTokens > 0 ? (
          <div className="mt-2.5 flex items-center gap-3 px-1">
            {model ? (
              <span
                className="shrink-0 truncate font-spacemono text-[10px] tracking-wider text-faint"
                title={`Model configured for this agent: ${model}`}
              >
                {model}
              </span>
            ) : null}
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-black/[0.05]">
              <div
                className="h-full rounded-full bg-text/25 transition-[width] duration-500"
                style={{
                  width: `${Math.min(100, (projection.inputTokens / contextWindow) * 100)}%`,
                }}
              />
            </div>
            {projection.costUsd > 0 || projection.outputTokens > 0 ? (
              <span className="shrink-0 font-spacemono text-[10px] uppercase tracking-wider text-faint">
                ${projection.costUsd.toFixed(4)} ·{" "}
                {projection.inputTokens.toLocaleString()}↑{" "}
                {projection.outputTokens.toLocaleString()}↓
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
