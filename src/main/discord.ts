import type { DiscordEndpointResult, DiscordVerifyResult } from "../shared/ipc";

/**
 * Thin client for the Discord API calls the guided setup needs: validate a bot
 * token (which also hands us the application id + public key), register the
 * default slash command, and set + verify the interactions endpoint on the
 * deployed agent. All calls run in the main process so the bot token never
 * reaches the renderer.
 *
 * @remarks
 * `GET /applications/@me` returns the whole application object for the token's
 * app — so from ONE token we derive `DISCORD_APPLICATION_ID` (id) and
 * `DISCORD_PUBLIC_KEY` (verify_key), instead of making the user paste three
 * secrets. `PATCH /applications/@me { interactions_endpoint_url }` makes Discord
 * PING the endpoint and reject the change unless it answers with a valid signed
 * PONG — so a successful set IS the verification (mirrors Telegram's setWebhook).
 */

const API = "https://discord.com/api/v10";

async function dCall(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<
  { ok: true; data: Record<string, unknown> } | { ok: false; error: string }
> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        authorization: `Bot ${token}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const data = (await res.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (res.ok) {
      return { ok: true, data };
    }
    // Discord surfaces the real reason under `message` (and nested `errors`).
    const nested = JSON.stringify(data.errors ?? "");
    const msg =
      typeof data.message === "string"
        ? `${data.message}${nested && nested !== '""' ? ` (${nested})` : ""}`
        : `Discord API error (HTTP ${res.status}).`;
    return { ok: false, error: msg };
  } catch (e) {
    const msg =
      e instanceof Error && e.name === "AbortError"
        ? "Discord didn't respond (timed out). Check your connection and try again."
        : e instanceof Error
          ? e.message
          : String(e);
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

/** Validate a bot token and derive the application id + public key from it. */
export async function discordVerify(
  token: string,
): Promise<DiscordVerifyResult> {
  const t = token.trim();
  if (!t) {
    return { ok: false, error: "Paste your Discord bot token." };
  }
  const r = await dCall(t, "GET", "/applications/@me");
  if (!r.ok) {
    return {
      ok: false,
      error: /401|unauthorized/i.test(r.error)
        ? "That bot token was rejected. Copy it from the Developer Portal → Bot → Reset Token."
        : r.error,
    };
  }
  const app = r.data;
  return {
    ok: true,
    applicationId: String(app.id ?? ""),
    name: typeof app.name === "string" ? app.name : null,
    publicKey: typeof app.verify_key === "string" ? app.verify_key : null,
    endpointUrl:
      typeof app.interactions_endpoint_url === "string"
        ? app.interactions_endpoint_url
        : null,
  };
}

/**
 * Register the default `/ask` slash command (global). `message` is a required
 * string option so it lines up with eve's default prompt extraction.
 */
export async function discordRegisterCommands(
  token: string,
  applicationId: string,
): Promise<{ ok: boolean; error?: string }> {
  const r = await dCall(
    token.trim(),
    "PUT",
    `/applications/${applicationId}/commands`,
    [
      {
        name: "ask",
        description: "Ask the eve agent",
        type: 1,
        options: [
          {
            name: "message",
            description: "What should the agent do?",
            type: 3,
            required: true,
          },
        ],
      },
    ],
  );
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

/**
 * Set the interactions endpoint on the Discord app. Discord validates it by
 * PINGing the URL and requiring a signed PONG, so success means the deployed
 * agent is reachable and its `DISCORD_PUBLIC_KEY` is correct.
 */
export async function discordSetEndpoint(
  token: string,
  url: string,
): Promise<DiscordEndpointResult> {
  const r = await dCall(token.trim(), "PATCH", "/applications/@me", {
    interactions_endpoint_url: url,
  });
  if (!r.ok) {
    return { ok: false, error: r.error };
  }
  const set =
    typeof r.data.interactions_endpoint_url === "string"
      ? r.data.interactions_endpoint_url
      : url;
  return { ok: true, url: set, live: Boolean(set) };
}
