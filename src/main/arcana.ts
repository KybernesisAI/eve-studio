import type {
  ArcanaResult,
  ArcanaStats,
  QueryHit,
  TimelineEvent,
} from "../shared/ipc";

/**
 * Arcana brain REST base.
 *
 * @remarks
 * Every call authenticates with `Authorization: Bearer <kb_ key>` and pins the
 * workspace via both the `:workspace` path segment and the
 * `X-Kyberagent-Agent` header (the daemon accepts either; we send both).
 */
const BASE = "https://api.arcana.kybernesis.ai";
const TIMEOUT_MS = 20_000;

async function call<T>(
  path: string,
  workspace: string,
  key: string,
): Promise<ArcanaResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(
      `${BASE}/brain/${encodeURIComponent(workspace)}${path}`,
      {
        headers: {
          Authorization: `Bearer ${key}`,
          "X-Kyberagent-Agent": workspace,
        },
        signal: controller.signal,
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      let msg = `HTTP ${res.status}`;
      try {
        const parsed = JSON.parse(body) as { error?: string; message?: string };
        msg = parsed.error || parsed.message || msg;
      } catch {
        if (body) {
          msg = body.slice(0, 200);
        }
      }
      return { ok: false, error: msg };
    }
    return { ok: true, data: (await res.json()) as T };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: msg.includes("abort") ? "Request timed out." : msg,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Timeline + entity-graph aggregates for a workspace. */
export function arcanaStats(
  workspace: string,
  key: string,
): Promise<ArcanaResult<ArcanaStats>> {
  return call<ArcanaStats>("/stats", workspace, key);
}

/** Most-recent timeline events (newest first). */
export function arcanaTimeline(
  workspace: string,
  key: string,
  limit = 30,
): Promise<ArcanaResult<TimelineEvent[]>> {
  return call<TimelineEvent[]>(`/timeline?limit=${limit}`, workspace, key);
}

/** Hybrid (semantic + FTS + graph) search over the brain. */
export function arcanaQuery(
  workspace: string,
  key: string,
  q: string,
  limit = 20,
): Promise<ArcanaResult<QueryHit[]>> {
  return call<QueryHit[]>(
    `/query?q=${encodeURIComponent(q)}&limit=${limit}`,
    workspace,
    key,
  );
}

/** Validate a key/workspace pair by fetching stats (read-only). */
export async function arcanaValidate(
  workspace: string,
  key: string,
): Promise<ArcanaResult<ArcanaStats>> {
  return await arcanaStats(workspace, key);
}

/**
 * Cheapest read-only credential check: `GET /brain/<ws>/timeline?limit=1`
 * → 200 means the key is valid for that workspace.
 */
export async function arcanaPing(
  workspace: string,
  key: string,
): Promise<ArcanaResult<null>> {
  const r = await call<unknown>("/timeline?limit=1", workspace, key);
  return r.ok ? { ok: true, data: null } : { ok: false, error: r.error };
}
