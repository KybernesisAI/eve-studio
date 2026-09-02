import type { ChatStatus, ChatStatusMessage, EveEvent } from "../shared/ipc";
import {
  type ControlResponse,
  controlSession,
  type InputResponse,
  isSessionNotActive,
  postSession,
  type SessionConn,
  type SessionControl,
  streamSession,
} from "./eveSession";
import * as store from "./store";

const BOUNDARY = new Set([
  "session.waiting",
  "session.completed",
  "session.failed",
]);

/** Backoff for a follow-up that races the just-accepted session's inbox. */
const NOT_ACTIVE_RETRY_MS = [300, 900, 2700];

/** How long a control op may take to reach `session.waiting` on the stream. */
const CONTROL_DRAIN_MS: Record<SessionControl, number> = {
  cancel: 30_000,
  clear: 30_000,
  compact: 180_000,
  reset: 0,
};

interface TurnPayload {
  message?: string;
  inputResponses?: InputResponse[];
}

const NOT_ACTIVE_HINT =
  "This thread's session is no longer active on the agent (409 session_not_active). Use ⋯ → Reset session to start a fresh session in this thread.";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Orchestrates chat turns and session controls against eve's ID-addressed
 * session routes: pick create-vs-continue, POST, stream events (persist +
 * forward each), and advance the per-thread stream cursor. Eve keeps no
 * transcript for us, so the Studio store owns it.
 *
 * @remarks
 * Protocol notes (eve 0.49): create returns `202 accepted` before the command
 * inbox is ready, so an immediate follow-up can 409 `session_not_active` — that
 * is retried with exponential backoff and, only if it keeps failing, surfaced
 * as an error. Studio never silently starts a replacement session: a thread is
 * pinned to one durable session until the user resets it. Resumed streams are
 * deduplicated by `meta.id`, which is stable across reconnects and rewinds.
 */
export class ChatController {
  private readonly active = new Map<string, AbortController>();
  /** Last `turnId` seen on each thread's stream (for scoped cancels). */
  private readonly lastTurn = new Map<string, string>();

  constructor(
    private readonly emitEvent: (threadId: string, event: EveEvent) => void,
    private readonly emitStatus: (msg: ChatStatusMessage) => void,
  ) {}

  isBusy(threadId: string): boolean {
    return this.active.has(threadId);
  }

  send(threadId: string, conn: SessionConn, text: string): Promise<void> {
    return this.runTurn(threadId, conn, { message: text });
  }

  respond(
    threadId: string,
    conn: SessionConn,
    requestId: string,
    optionId?: string,
    text?: string,
  ): Promise<void> {
    return this.runTurn(threadId, conn, {
      inputResponses: [{ requestId, optionId, text }],
    });
  }

  /** Stop following the stream locally (does not cancel the agent's turn). */
  abort(threadId: string): void {
    this.active.get(threadId)?.abort();
  }

  /**
   * POST `/cancel` for the thread's session, scoped to the last observed turn.
   * When Studio is already streaming the turn, that loop sees
   * `turn.cancelled` → `session.waiting` and settles normally; otherwise a
   * short drain captures the boundary so the transcript stays complete.
   */
  async cancelTurn(
    threadId: string,
    conn: SessionConn,
    turnId?: string,
  ): Promise<ControlResponse> {
    const cursor = store.getCursor(threadId);
    if (!cursor.sessionId) {
      return { ok: true, status: "no_active_turn" };
    }
    const body = { turnId: turnId ?? this.lastTurn.get(threadId) };
    const res = await controlSession(conn, cursor.sessionId, "cancel", body);
    if (res.status === "accepted" && !this.active.has(threadId)) {
      void this.drain(threadId, conn, cursor.sessionId, "cancel");
    }
    return res;
  }

  /** POST `/compact`: summarize context, then drain to `session.waiting`. */
  compactContext(threadId: string, conn: SessionConn): Promise<ControlResponse> {
    return this.runControl(threadId, conn, "compact");
  }

  /** POST `/clear`: drop model-message history, then drain to `session.waiting`. */
  clearContext(threadId: string, conn: SessionConn): Promise<ControlResponse> {
    return this.runControl(threadId, conn, "clear");
  }

  /**
   * POST `/reset`: terminally retire the session and forget the thread's
   * cursor, so the next message in this thread starts a fresh session.
   */
  async resetSession(
    threadId: string,
    conn: SessionConn,
  ): Promise<ControlResponse> {
    this.abort(threadId);
    const cursor = store.getCursor(threadId);
    let res: ControlResponse = { ok: true, status: "no_active_session" };
    if (cursor.sessionId) {
      try {
        res = await controlSession(conn, cursor.sessionId, "reset", {
          reason: "Reset from Eve Studio",
        });
      } catch (err) {
        // A retired/unknown session is fine — we only need the cursor gone.
        if (!isSessionNotActive(err)) {
          throw err;
        }
      }
    }
    store.setCursor(threadId, { streamIndex: 0 });
    this.lastTurn.delete(threadId);
    this.emitStatus({ threadId, status: "idle" });
    return res;
  }

  private async runControl(
    threadId: string,
    conn: SessionConn,
    op: "clear" | "compact",
  ): Promise<ControlResponse> {
    const cursor = store.getCursor(threadId);
    if (!cursor.sessionId) {
      return { ok: false, status: "no_active_session" };
    }
    const res = await controlSession(conn, cursor.sessionId, op);
    if (res.status === "no_active_session") {
      this.emitStatus({ threadId, status: "error", error: NOT_ACTIVE_HINT });
      return res;
    }
    // Eve queues compaction behind an active turn; the live loop will render
    // the resulting events. Only drain when nothing is following the stream.
    if (!this.active.has(threadId)) {
      await this.drain(threadId, conn, cursor.sessionId, op);
    }
    return res;
  }

  /** Follow the stream from the cursor until the next session boundary. */
  private async drain(
    threadId: string,
    conn: SessionConn,
    sessionId: string,
    op: SessionControl,
  ): Promise<void> {
    if (this.active.has(threadId)) {
      return;
    }
    const abort = new AbortController();
    this.active.set(threadId, abort);
    this.emitStatus({ threadId, status: "streaming" });
    const signal = AbortSignal.any([
      abort.signal,
      AbortSignal.timeout(CONTROL_DRAIN_MS[op] || 30_000),
    ]);
    try {
      const cursor = store.getCursor(threadId);
      const finalStatus = await this.follow(
        threadId,
        conn,
        sessionId,
        cursor.streamIndex,
        signal,
      );
      this.emitStatus({ threadId, status: finalStatus });
    } catch (err) {
      // A manual abort or the drain timeout both just mean "stop following":
      // whatever events arrived were persisted, and a control op on a parked
      // session (e.g. cancel with no active turn) legitimately emits nothing.
      if (signal.aborted) {
        this.emitStatus({ threadId, status: "waiting" });
      } else {
        this.emitStatus({
          threadId,
          status: "error",
          error: (err as Error).message,
        });
      }
    } finally {
      this.active.delete(threadId);
    }
  }

  /** POST a follow-up, retrying eve's startup-window 409 with backoff. */
  private async postFollowUp(
    conn: SessionConn,
    sessionId: string,
    payload: TurnPayload,
  ): Promise<void> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await postSession(conn, sessionId, payload);
        return;
      } catch (err) {
        if (!isSessionNotActive(err) || attempt >= NOT_ACTIVE_RETRY_MS.length) {
          throw err;
        }
        await sleep(NOT_ACTIVE_RETRY_MS[attempt]);
      }
    }
  }

  /**
   * Read the stream from `startIndex`, persisting + forwarding each new event,
   * until a session boundary. Returns the chat status that boundary implies.
   */
  private async follow(
    threadId: string,
    conn: SessionConn,
    sessionId: string,
    startIndex: number,
    signal: AbortSignal,
  ): Promise<ChatStatus> {
    // Events already in the transcript, keyed by eve's durable `meta.id`. A
    // resumed read overlapping the cursor replays them; drop those copies.
    const seen = new Set<string>();
    for (const e of store.readEvents(threadId)) {
      if (e.meta?.id) {
        seen.add(e.meta.id);
      }
    }
    let idx = startIndex;
    let finalStatus: ChatStatus = "waiting";
    // A just-accepted (202) run's stream can briefly refuse reads before the
    // workflow publishes it; retry the open a few times before giving up.
    const open = async (): Promise<AsyncGenerator<EveEvent>> => {
      for (let attempt = 0; ; attempt += 1) {
        const gen = streamSession(conn, sessionId, idx, signal);
        try {
          const first = await gen.next();
          return (async function* () {
            if (!first.done) {
              yield first.value;
            }
            yield* gen;
          })();
        } catch (err) {
          if (signal.aborted || attempt >= NOT_ACTIVE_RETRY_MS.length) {
            throw err;
          }
          await sleep(NOT_ACTIVE_RETRY_MS[attempt]);
        }
      }
    };
    for await (const event of await open()) {
      idx += 1;
      const id = event.meta?.id;
      if (id) {
        if (seen.has(id)) {
          continue;
        }
        seen.add(id);
      }
      const turnId = (event.data as { turnId?: unknown } | undefined)?.turnId;
      if (typeof turnId === "string") {
        this.lastTurn.set(threadId, turnId);
      }
      store.appendEvent(threadId, event);
      this.emitEvent(threadId, event);
      if (BOUNDARY.has(event.type)) {
        if (event.type === "session.waiting") {
          store.setCursor(threadId, { sessionId, streamIndex: idx });
          finalStatus = "waiting";
        } else {
          store.setCursor(threadId, { streamIndex: 0 });
          this.lastTurn.delete(threadId);
          finalStatus =
            event.type === "session.failed" ? "failed" : "completed";
        }
        break;
      }
    }
    return finalStatus;
  }

  private async runTurn(
    threadId: string,
    conn: SessionConn,
    payload: TurnPayload,
  ): Promise<void> {
    if (this.active.has(threadId)) {
      return;
    }
    const abort = new AbortController();
    this.active.set(threadId, abort);
    this.emitStatus({ threadId, status: "streaming" });

    try {
      const cursor = store.getCursor(threadId);
      let sessionId: string;
      let startIndex: number;

      if (cursor.sessionId) {
        sessionId = cursor.sessionId;
        startIndex = cursor.streamIndex;
        try {
          await this.postFollowUp(conn, sessionId, payload);
        } catch (err) {
          if (isSessionNotActive(err)) {
            throw new Error(NOT_ACTIVE_HINT);
          }
          throw err;
        }
      } else {
        if (!payload.message) {
          throw new Error("No active session to respond to.");
        }
        const resp = await postSession(conn, null, { message: payload.message });
        sessionId = resp.sessionId;
        startIndex = 0;
      }

      const finalStatus = await this.follow(
        threadId,
        conn,
        sessionId,
        startIndex,
        abort.signal,
      );
      store.touchThread(threadId);
      this.emitStatus({ threadId, status: finalStatus });
    } catch (err) {
      this.emitStatus({
        threadId,
        status: "error",
        error: (err as Error).message,
      });
    } finally {
      this.active.delete(threadId);
    }
  }
}
