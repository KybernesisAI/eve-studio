import type { EveEvent } from "@shared/ipc";

export type ToolStatus = "pending" | "completed" | "failed" | "rejected";
export type SystemTone = "muted" | "warn" | "danger";

/**
 * Renderable projection of the eve session stream.
 *
 * @remarks
 * Field names verified against eve 0.49's `protocol/message.d.ts`:
 * `message.appended.{messageDelta,messageSoFar}`, `message.completed.
 * {message,finishReason}`, `reasoning.appended.{reasoningDelta,reasoningSoFar}`,
 * `actions.requested.actions[]` (`kind: "tool-call" | "subagent-call" |
 * "remote-agent-call" | "load-skill"`, `callId`, `toolName` | `subagentName` |
 * `remoteAgentName`), `action.partial.result.{callId,output}`,
 * `action.result.{result.{callId,output},status,error}`, `subagent.called.
 * {callId,name,childSessionId}`, `subagent.completed.{callId,subagentName,
 * output}`, `input.requested.requests[].{requestId,prompt,options,allowFreeform,
 * action.toolName}`, `input.resolved.resolutions[].{requestId,outcome}`,
 * `authorization.required.{name,description,authorization.{url,userCode,
 * instructions}}`, `authorization.completed.{name,outcome,reason}`,
 * `step.completed.usage.{inputTokens,outputTokens,costUsd}`, `step.failed` /
 * `turn.failed` / `session.failed` `{code,message}`, `turn.cancelled`,
 * `compaction.requested.{modelId,usageInputTokens}`, `compaction.completed`,
 * `context.cleared`, `result.completed.result`.
 */
export type Block =
  | { kind: "user"; id: string; text: string }
  | { kind: "assistant"; id: string; text: string; streaming: boolean }
  | { kind: "reasoning"; id: string; text: string; streaming: boolean }
  | {
      kind: "tool";
      id: string;
      callId: string;
      name: string;
      input: unknown;
      status: ToolStatus;
      output?: unknown;
      /** True while `output` is a preliminary `action.partial` snapshot. */
      partial?: boolean;
      error?: string;
    }
  | {
      kind: "subagent";
      id: string;
      callId: string;
      name: string;
      status: "pending" | "completed";
      childSessionId?: string;
      output?: unknown;
    }
  | {
      kind: "input";
      id: string;
      requestId: string;
      prompt: string;
      toolName?: string;
      /** `callId` of the tool call awaiting approval, when the request has one. */
      actionCallId?: string;
      options?: { id: string; label: string; style?: string }[];
      allowFreeform?: boolean;
      /** Authoritative outcome once eve emits `input.resolved`. */
      resolved?: string;
    }
  | {
      kind: "auth";
      id: string;
      name: string;
      url?: string;
      userCode?: string;
      instructions?: string;
      /** `authorized` | `declined` | `failed` | `timed-out` once completed. */
      outcome?: string;
      reason?: string;
    }
  | {
      /** Quiet inline notice: cancellation, compaction, context clear, … */
      kind: "system";
      id: string;
      text: string;
      tone: SystemTone;
    }
  | {
      /** Structured `result.completed` payload (turns with an output schema). */
      kind: "result";
      id: string;
      result: unknown;
    };

export interface Projection {
  blocks: Block[];
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  /** `turnId` of the most recent `turn.started` without a terminal turn event. */
  activeTurnId: string | null;
}

// biome-ignore lint: intentional loose typing over the untyped event payloads
type Any = Record<string, any>;

function failureText(label: string, data: Any): string {
  const code = typeof data.code === "string" ? data.code : null;
  const msg = typeof data.message === "string" ? data.message : null;
  return `${label}${code ? ` (${code})` : ""}${msg ? `: ${msg}` : ""}`;
}

/** Fold the raw Eve event log into an ordered list of renderable blocks. */
export function projectEvents(events: EveEvent[]): Projection {
  const blocks: Block[] = [];
  const byCall = new Map<string, number>();
  const byRequest = new Map<string, number>();
  const authByName = new Map<string, number>();
  let curAssistant: number | null = null;
  let curReasoning: number | null = null;
  let activeTurnId: string | null = null;
  let costUsd = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let n = 0;

  const closeStreaming = (): void => {
    if (curAssistant !== null) {
      const b = blocks[curAssistant];
      if (b.kind === "assistant") {
        b.streaming = false;
      }
    }
    if (curReasoning !== null) {
      const b = blocks[curReasoning];
      if (b.kind === "reasoning") {
        b.streaming = false;
      }
    }
    curAssistant = null;
    curReasoning = null;
  };

  const system = (text: string, tone: SystemTone = "muted"): void => {
    blocks.push({ kind: "system", id: `sys${n}`, text, tone });
  };

  // step.failed → turn.failed → session.failed usually carry the same
  // code+message; collapse that cascade into one block titled by the most
  // severe stage instead of three identical red rows.
  let lastFailure: { idx: number; key: string; severity: number } | null =
    null;
  const failure = (label: string, severity: number, data: Any): void => {
    const key = `${data.code ?? ""}|${data.message ?? ""}`;
    if (
      lastFailure &&
      lastFailure.key === key &&
      lastFailure.idx === blocks.length - 1
    ) {
      if (severity > lastFailure.severity) {
        const b = blocks[lastFailure.idx];
        if (b.kind === "system") {
          b.text = failureText(label, data);
        }
        lastFailure.severity = severity;
      }
      return;
    }
    system(failureText(label, data), "danger");
    lastFailure = { idx: blocks.length - 1, key, severity };
  };

  for (const e of events) {
    n += 1;
    const data = (e.data ?? {}) as Any;

    if (e.type === "turn.started") {
      activeTurnId = typeof data.turnId === "string" ? data.turnId : null;
    } else if (e.type === "message.received") {
      const text = typeof data.message === "string" ? data.message : "";
      if (text) {
        blocks.push({ kind: "user", id: `u${n}`, text });
      }
      curAssistant = null;
      curReasoning = null;
    } else if (e.type === "message.appended") {
      const soFar =
        typeof data.messageSoFar === "string" ? data.messageSoFar : "";
      if (curAssistant === null) {
        blocks.push({
          kind: "assistant",
          id: `a${n}`,
          text: soFar,
          streaming: true,
        });
        curAssistant = blocks.length - 1;
      } else {
        const b = blocks[curAssistant];
        if (b.kind === "assistant") {
          b.text = soFar;
        }
      }
    } else if (e.type === "message.completed") {
      const msg = typeof data.message === "string" ? data.message : null;
      if (curAssistant !== null) {
        const b = blocks[curAssistant];
        if (b.kind === "assistant") {
          if (msg) {
            b.text = msg;
          }
          b.streaming = false;
        }
      } else if (msg) {
        blocks.push({
          kind: "assistant",
          id: `a${n}`,
          text: msg,
          streaming: false,
        });
      }
      curAssistant = null;
    } else if (e.type === "reasoning.appended") {
      const soFar =
        typeof data.reasoningSoFar === "string" ? data.reasoningSoFar : "";
      if (curReasoning === null) {
        blocks.push({
          kind: "reasoning",
          id: `r${n}`,
          text: soFar,
          streaming: true,
        });
        curReasoning = blocks.length - 1;
      } else {
        const b = blocks[curReasoning];
        if (b.kind === "reasoning") {
          b.text = soFar;
        }
      }
    } else if (e.type === "reasoning.completed") {
      if (curReasoning !== null) {
        const b = blocks[curReasoning];
        if (b.kind === "reasoning") {
          if (typeof data.reasoning === "string" && data.reasoning) {
            b.text = data.reasoning;
          }
          b.streaming = false;
        }
      }
      curReasoning = null;
    } else if (e.type === "actions.requested") {
      const actions: Any[] = Array.isArray(data.actions) ? data.actions : [];
      for (const a of actions) {
        const callId = String(a.callId ?? `c${n}`);
        if (byCall.has(callId)) {
          continue;
        }
        if (a.kind === "subagent-call" || a.kind === "remote-agent-call") {
          blocks.push({
            kind: "subagent",
            id: `s${callId}`,
            callId,
            name: String(
              a.subagentName ?? a.remoteAgentName ?? a.name ?? "subagent",
            ),
            status: "pending",
          });
        } else {
          const name =
            a.kind === "load-skill"
              ? "load_skill"
              : String(a.toolName ?? "tool");
          blocks.push({
            kind: "tool",
            id: `t${callId}`,
            callId,
            name,
            input: a.input,
            status: "pending",
          });
        }
        byCall.set(callId, blocks.length - 1);
      }
      curAssistant = null;
      curReasoning = null;
    } else if (e.type === "action.partial") {
      // Preliminary snapshot from a streaming tool generator; the final
      // value arrives as `action.result`.
      const result = (data.result ?? {}) as Any;
      const idx = byCall.get(String(result.callId ?? ""));
      if (idx !== undefined) {
        const b = blocks[idx];
        if (b.kind === "tool") {
          b.output = result.output;
          b.partial = true;
        }
      }
    } else if (e.type === "action.result") {
      const result = (data.result ?? {}) as Any;
      const callId = String(result.callId ?? "");
      const idx = byCall.get(callId);
      if (idx !== undefined) {
        const b = blocks[idx];
        const status = (data.status as ToolStatus) ?? "completed";
        if (b.kind === "tool") {
          b.status = status;
          b.output = result.output;
          b.partial = false;
          if (data.error) {
            b.error = String((data.error as Any).message ?? data.error);
          }
        } else if (b.kind === "subagent") {
          b.status = "completed";
          b.output = result.output;
        }
      }
      // A settled tool call also settles any approval prompt attached to it
      // (fallback for streams that predate `input.resolved`).
      for (const b of blocks) {
        if (b.kind === "input" && !b.resolved && b.actionCallId === callId) {
          b.resolved =
            (data.status as string) === "rejected" ? "denied" : "approved";
        }
      }
    } else if (e.type === "subagent.called") {
      // Parent-side start of a child workflow session: `name` is the
      // subagent; `childSessionId` identifies its own stream.
      const callId = String(data.callId ?? `c${n}`);
      const childSessionId =
        typeof data.childSessionId === "string" ? data.childSessionId : undefined;
      const existing = byCall.get(callId);
      if (existing === undefined) {
        blocks.push({
          kind: "subagent",
          id: `s${callId}`,
          callId,
          name: String(data.name ?? data.subagentName ?? "subagent"),
          status: "pending",
          childSessionId,
        });
        byCall.set(callId, blocks.length - 1);
      } else {
        const b = blocks[existing];
        if (b.kind === "subagent" && childSessionId) {
          b.childSessionId = childSessionId;
        }
      }
    } else if (e.type === "subagent.started") {
      const callId = String(data.callId ?? `c${n}`);
      if (!byCall.has(callId)) {
        blocks.push({
          kind: "subagent",
          id: `s${callId}`,
          callId,
          name: String(data.subagentName ?? "subagent"),
          status: "pending",
        });
        byCall.set(callId, blocks.length - 1);
      }
    } else if (e.type === "subagent.completed") {
      const idx = byCall.get(String(data.callId ?? ""));
      if (idx !== undefined) {
        const b = blocks[idx];
        if (b.kind === "subagent") {
          // A background-task receipt keeps the child running; leave it open.
          if (!data.backgroundTask) {
            b.status = "completed";
          }
          b.output = data.output;
        }
      }
    } else if (e.type === "input.requested") {
      const reqs: Any[] = Array.isArray(data.requests) ? data.requests : [];
      for (const r of reqs) {
        const requestId = String(r.requestId);
        if (byRequest.has(requestId)) {
          continue;
        }
        const options = Array.isArray(r.options)
          ? (r.options as Any[]).map((o) => ({
              id: String(o.id),
              label: String(o.label),
              style: o.style as string | undefined,
            }))
          : undefined;
        blocks.push({
          kind: "input",
          id: `i${requestId}`,
          requestId,
          prompt: String(r.prompt ?? "Approve?"),
          toolName: r.action?.toolName as string | undefined,
          actionCallId: r.action?.callId as string | undefined,
          options,
          allowFreeform: Boolean(r.allowFreeform),
        });
        byRequest.set(requestId, blocks.length - 1);
      }
      curAssistant = null;
    } else if (e.type === "input.resolved") {
      const res: Any[] = Array.isArray(data.resolutions) ? data.resolutions : [];
      for (const r of res) {
        const idx = byRequest.get(String(r.requestId ?? ""));
        if (idx !== undefined) {
          const b = blocks[idx];
          if (b.kind === "input") {
            b.resolved = String(r.outcome ?? "answered");
          }
        }
      }
    } else if (e.type === "authorization.required") {
      const auth = (data.authorization ?? {}) as Any;
      const name = String(data.name ?? "connection");
      blocks.push({
        kind: "auth",
        id: `auth${n}`,
        name,
        url: auth.url as string | undefined,
        userCode: auth.userCode as string | undefined,
        instructions: (auth.instructions ?? data.description) as
          string | undefined,
      });
      authByName.set(name, blocks.length - 1);
    } else if (e.type === "authorization.completed") {
      const idx = authByName.get(String(data.name ?? ""));
      if (idx !== undefined) {
        const b = blocks[idx];
        if (b.kind === "auth") {
          b.outcome = String(data.outcome ?? "authorized");
          b.reason = typeof data.reason === "string" ? data.reason : undefined;
        }
      }
    } else if (e.type === "result.completed") {
      blocks.push({ kind: "result", id: `res${n}`, result: data.result });
    } else if (e.type === "step.completed") {
      const usage = (data.usage ?? {}) as Any;
      if (typeof usage.costUsd === "number") {
        costUsd += usage.costUsd;
      }
      if (typeof usage.inputTokens === "number") {
        inputTokens += usage.inputTokens;
      }
      if (typeof usage.outputTokens === "number") {
        outputTokens += usage.outputTokens;
      }
    } else if (e.type === "step.failed") {
      closeStreaming();
      failure("Model call failed", 1, data);
    } else if (e.type === "turn.failed") {
      closeStreaming();
      activeTurnId = null;
      failure("Turn failed", 2, data);
    } else if (e.type === "turn.cancelled") {
      // Not a failure: eve follows it with `session.waiting`.
      closeStreaming();
      activeTurnId = null;
      system("Turn cancelled", "warn");
    } else if (e.type === "turn.completed") {
      activeTurnId = null;
    } else if (e.type === "compaction.requested") {
      const tokens =
        typeof data.usageInputTokens === "number"
          ? ` · ${data.usageInputTokens.toLocaleString()} input tokens`
          : "";
      system(`Compacting context${tokens}…`);
    } else if (e.type === "compaction.completed") {
      system("Context compacted: a summary checkpoint replaced older history");
    } else if (e.type === "context.cleared") {
      system("Context cleared: history dropped, session kept");
    } else if (e.type === "session.failed") {
      closeStreaming();
      activeTurnId = null;
      failure("Session failed", 3, data);
    } else if (e.type === "session.waiting") {
      closeStreaming();
      activeTurnId = null;
    }
  }

  return { blocks, costUsd, inputTokens, outputTokens, activeTurnId };
}
