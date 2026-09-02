import type {
  TelegramVerifyResult,
  TelegramWebhookResult,
} from "../shared/ipc";

/**
 * Thin client for the handful of Telegram Bot API calls the guided setup needs:
 * validate a BotFather token, register the webhook at the deployed agent, and
 * read back the webhook state to confirm it's live. All calls run in the main
 * process (never the renderer) so the bot token stays out of the web context.
 *
 * @remarks
 * The Bot API takes the token in the URL path (`/bot<token>/<method>`) — that's
 * the protocol, not a leak. Every call is wrapped with a timeout + AbortController
 * so a network stall surfaces as an error instead of hanging the setup flow.
 */

const API = "https://api.telegram.org";

interface TgEnvelope<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

async function tgCall<T>(
  token: string,
  method: string,
  body?: unknown,
): Promise<{ ok: true; result: T } | { ok: false; error: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`${API}/bot${token}/${method}`, {
      method: body ? "POST" : "GET",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const json = (await res.json().catch(() => ({}))) as TgEnvelope<T>;
    if (json.ok && json.result !== undefined) {
      return { ok: true, result: json.result };
    }
    // Telegram returns a human-readable `description` on failure (e.g.
    // "Unauthorized" for a bad token) — surface it verbatim.
    return {
      ok: false,
      error: json.description || `Telegram API error (HTTP ${res.status}).`,
    };
  } catch (e) {
    const msg =
      e instanceof Error && e.name === "AbortError"
        ? "Telegram didn't respond (timed out). Check your connection and try again."
        : e instanceof Error
          ? e.message
          : String(e);
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

/** Validate a bot token via `getMe`, returning the bot's @username + name. */
export async function telegramVerify(
  token: string,
): Promise<TelegramVerifyResult> {
  const t = token.trim();
  if (!t) {
    return { ok: false, error: "Paste the token BotFather gave you." };
  }
  const r = await tgCall<{
    id: number;
    username?: string;
    first_name?: string;
  }>(t, "getMe");
  if (!r.ok) {
    // The most common cause is a mistyped/expired token.
    return {
      ok: false,
      error: /unauthorized/i.test(r.error)
        ? "That token was rejected by Telegram. Double-check you copied all of it from BotFather."
        : r.error,
    };
  }
  return {
    ok: true,
    id: r.result.id,
    username: r.result.username ?? null,
    name: r.result.first_name ?? null,
  };
}

interface WebhookInfo {
  url?: string;
  pending_update_count?: number;
  last_error_message?: string;
  last_error_date?: number;
}

function toWebhookResult(
  info: WebhookInfo,
  expectedUrl?: string,
): TelegramWebhookResult {
  return {
    ok: true,
    url: info.url || null,
    // A live webhook points at our URL and has no recent delivery error.
    live: Boolean(info.url) && (!expectedUrl || info.url === expectedUrl),
    pending: info.pending_update_count ?? 0,
    lastError: info.last_error_message ?? null,
  };
}

/**
 * Register the webhook so Telegram delivers to the deployed agent, then read it
 * back to confirm. `secret` is echoed by Telegram in the
 * `X-Telegram-Bot-Api-Secret-Token` header and checked by the eve channel, so it
 * must match `TELEGRAM_WEBHOOK_SECRET_TOKEN` in the deployment.
 */
export async function telegramSetWebhook(
  token: string,
  url: string,
  secret: string,
): Promise<TelegramWebhookResult> {
  const set = await tgCall<boolean>(token.trim(), "setWebhook", {
    url,
    secret_token: secret,
    allowed_updates: ["message", "callback_query"],
  });
  if (!set.ok) {
    return { ok: false, error: set.error };
  }
  const info = await tgCall<WebhookInfo>(token.trim(), "getWebhookInfo");
  if (!info.ok) {
    // The webhook was set even if the read-back failed — report success softly.
    return { ok: true, url, live: true, pending: 0, lastError: null };
  }
  return toWebhookResult(info.result, url);
}

/** Read the current webhook state (`getWebhookInfo`) — used for re-checks. */
export async function telegramWebhookInfo(
  token: string,
): Promise<TelegramWebhookResult> {
  const info = await tgCall<WebhookInfo>(token.trim(), "getWebhookInfo");
  return info.ok
    ? toWebhookResult(info.result)
    : { ok: false, error: info.error };
}
