import type { EveEvent } from "../shared/ipc";

/**
 * Response of `POST /eve/v1/session` (create) and `POST /eve/v1/session/:id`
 * (follow-up). Create returns `202 { ok, sessionId, status: "accepted" }` as
 * soon as Workflow accepts the durable run; follow-ups reuse the session id.
 * There is no continuation token on the wire any more (eve 0.49): sessions are
 * addressed by their durable id only.
 */
export interface SessionResponse {
  sessionId: string;
  ok?: boolean;
  status?: string;
}

export interface InputResponse {
  requestId: string;
  optionId?: string;
  text?: string;
}

/** Body for the message routes: exactly one of `message` | `inputResponses`. */
export interface PostBody {
  message?: string;
  inputResponses?: InputResponse[];
}

/** Where a session lives: a base URL plus any auth headers (deployed = bypass + OIDC). */
export interface SessionConn {
  baseUrl: string;
  headers?: Record<string, string>;
}

/**
 * HTTP error from a session route, carrying eve's stable `code` when the body
 * had one (e.g. `session_not_active` on a 409).
 */
export class SessionHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    detail: string,
  ) {
    super(`session ${status}${code ? ` (${code})` : ""}: ${detail}`);
    this.name = "SessionHttpError";
  }
}

/** True for eve's "unknown, terminal, or not-yet-active session" reply. */
export function isSessionNotActive(err: unknown): boolean {
  return (
    err instanceof SessionHttpError &&
    (err.code === "session_not_active" || err.status === 409)
  );
}

/**
 * Probe the agent to see if a turn would succeed: hits the auth-gated
 * `/eve/v1/info` (not public `/health`), so a 200 means both Vercel platform
 * protection AND eve route auth are satisfied. 3xx = platform protection;
 * 401/403 = eve route auth rejected the token.
 */
export async function checkHealth(
  conn: SessionConn,
): Promise<{ ok: boolean; status: number; protected: boolean }> {
  try {
    const res = await fetch(`${conn.baseUrl}/eve/v1/info`, {
      headers: conn.headers,
      redirect: "manual",
      signal: AbortSignal.timeout(9000),
    });
    if (
      res.type === "opaqueredirect" ||
      (res.status >= 300 && res.status < 400)
    ) {
      return { ok: false, status: 302, protected: true };
    }
    return { ok: res.ok, status: res.status, protected: false };
  } catch {
    return { ok: false, status: 0, protected: false };
  }
}

/** GET /eve/v1/info — the running agent's runtime surface (agent-info v4). */
export async function getAgentInfo(
  baseUrl: string,
  headers?: Record<string, string>,
): Promise<unknown> {
  const res = await fetch(`${baseUrl}/eve/v1/info`, {
    headers,
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    throw new Error(`info ${res.status}`);
  }
  return res.json();
}

async function readError(res: Response): Promise<SessionHttpError> {
  const text = (await res.text()).slice(0, 400);
  let code: string | null = null;
  try {
    const parsed = JSON.parse(text) as { code?: unknown; error?: unknown };
    if (typeof parsed.code === "string") {
      code = parsed.code;
    }
  } catch {
    // plain-text body
  }
  return new SessionHttpError(res.status, code, text);
}

/**
 * POST /eve/v1/session (create) or /eve/v1/session/:id (follow-up).
 *
 * @remarks
 * Both `200` and `202` are success: `202 accepted` means Workflow queued the
 * run and the command inbox may still be starting, so an immediate follow-up
 * can 409 `session_not_active` — callers retry that with backoff instead of
 * starting a new session. Follow-ups default to `turnPolicy: "steer"`: a
 * message during an active turn cancels and replaces it.
 */
export async function postSession(
  conn: SessionConn,
  sessionId: string | null,
  body: PostBody,
): Promise<SessionResponse> {
  const url = sessionId
    ? `${conn.baseUrl}/eve/v1/session/${sessionId}`
    : `${conn.baseUrl}/eve/v1/session`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...conn.headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw await readError(res);
  }
  const parsed = (await res.json()) as Partial<SessionResponse>;
  return {
    sessionId: parsed.sessionId ?? sessionId ?? "",
    ok: parsed.ok,
    status: parsed.status,
  };
}

export type SessionControl = "cancel" | "clear" | "compact" | "reset";

/** Result of a session control route: `accepted`, `no_active_turn`, `no_active_session`, … */
export interface ControlResponse {
  ok: boolean;
  status: string;
  sessionId?: string;
}

/**
 * POST /eve/v1/session/:id/{cancel|clear|compact|reset}.
 *
 * @remarks
 * Cancel returns `202 accepted` (confirm on the stream as `turn.cancelled` →
 * `session.waiting`) or `200 no_active_turn`. Compact emits
 * `compaction.requested` / `compaction.completed` → `session.waiting`; clear
 * emits `context.cleared` → `session.waiting`; reset terminally retires the
 * id. All three report `no_active_session` when the target is already
 * inactive — treated as success so callers can fire and forget.
 */
export async function controlSession(
  conn: SessionConn,
  sessionId: string,
  op: SessionControl,
  body?: { turnId?: string; reason?: string },
): Promise<ControlResponse> {
  const res = await fetch(
    `${conn.baseUrl}/eve/v1/session/${sessionId}/${op}`,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...conn.headers },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!res.ok) {
    throw await readError(res);
  }
  const text = await res.text();
  let parsed: Partial<ControlResponse> = {};
  try {
    parsed = text ? (JSON.parse(text) as Partial<ControlResponse>) : {};
  } catch {
    // empty / non-JSON body — treat as accepted
  }
  return {
    ok: parsed.ok ?? true,
    status: parsed.status ?? (res.status === 202 ? "accepted" : "ok"),
    sessionId: parsed.sessionId,
  };
}

/** GET /eve/v1/session/:id/stream?startIndex=n — yields NDJSON events until the caller stops. */
export async function* streamSession(
  conn: SessionConn,
  sessionId: string,
  startIndex: number,
  signal?: AbortSignal,
): AsyncGenerator<EveEvent> {
  const res = await fetch(
    `${conn.baseUrl}/eve/v1/session/${sessionId}/stream?startIndex=${startIndex}`,
    { headers: { accept: "application/x-ndjson", ...conn.headers }, signal },
  );
  if (!(res.ok && res.body)) {
    throw new Error(`stream ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buf += decoder.decode(value, { stream: true });
      let nl = buf.indexOf("\n");
      while (nl >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) {
          try {
            yield JSON.parse(line) as EveEvent;
          } catch {
            // skip a malformed line
          }
        }
        nl = buf.indexOf("\n");
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // stream already closed
    }
  }
}
