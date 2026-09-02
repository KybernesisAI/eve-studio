import type { TeamsVerifyResult } from "../shared/ipc";

/**
 * Validate Microsoft Teams (Azure Bot) credentials by doing exactly what the Bot
 * Framework does on every inbound Activity: request a Bot Connector token with
 * the app id + secret. If Azure hands back a token, the credentials are valid.
 * Runs in the main process so the secret never reaches the renderer.
 *
 * @remarks
 * There's no API to set the Azure messaging endpoint — that's configured in the
 * portal — so setup verifies the credentials here and hands the user the exact
 * endpoint URL to paste. Multi-tenant bots authenticate against the shared
 * `botframework.com` authority; single-tenant bots use their own tenant id.
 */

export const TEAMS_ENDPOINT_PATH = "/eve/v1/teams";

/** Confirm the App ID + password (client secret) can mint a Bot Connector token. */
export async function teamsVerify(
  appId: string,
  password: string,
  tenantId?: string,
): Promise<TeamsVerifyResult> {
  const id = appId.trim();
  const secret = password.trim();
  if (!id || !secret) {
    return { ok: false, error: "Enter both the App ID and its client secret." };
  }
  const authority = tenantId?.trim() || "botframework.com";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(
      `https://login.microsoftonline.com/${authority}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: id,
          client_secret: secret,
          scope: "https://api.botframework.com/.default",
        }).toString(),
        signal: controller.signal,
      },
    );
    const data = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };
    if (res.ok && data.access_token) {
      return { ok: true };
    }
    // AADSTS errors are verbose; the first line is the useful part.
    const desc = data.error_description?.split("\n")[0];
    return {
      ok: false,
      error:
        desc ||
        data.error ||
        "Azure rejected those credentials. Check the App ID, client secret, and (for single-tenant bots) the tenant id.",
    };
  } catch (e) {
    const msg =
      e instanceof Error && e.name === "AbortError"
        ? "Microsoft didn't respond (timed out). Check your connection and try again."
        : e instanceof Error
          ? e.message
          : String(e);
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}
