import type {
  TwilioNumbersResult,
  TwilioVerifyResult,
  TwilioWebhookResult,
} from "../shared/ipc";

/**
 * Thin client for the Twilio REST API calls the guided setup needs: validate the
 * Account SID + Auth Token, list the account's phone numbers, and point a
 * number's SMS + Voice webhooks at the deployed agent. All calls run in the main
 * process (never the renderer) so the auth token stays out of the web context.
 *
 * @remarks
 * Twilio uses HTTP Basic auth (SID:token) and form-encoded bodies. Every call is
 * wrapped with a timeout so a network stall surfaces as an error instead of
 * hanging the setup flow. The eve Twilio channel validates the `X-Twilio-Signature`
 * header with the same auth token, so once the number's webhooks point here,
 * inbound SMS/voice are authenticated automatically — there's no separate secret.
 */

const API = "https://api.twilio.com/2010-04-01";

/** Routes the eve Twilio channel mounts, relative to the deployment base. */
export const TWILIO_SMS_PATH = "/eve/v1/twilio/messages";
export const TWILIO_VOICE_PATH = "/eve/v1/twilio/voice";

function authHeader(sid: string, token: string): string {
  return `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`;
}

async function twCall(
  sid: string,
  token: string,
  method: "GET" | "POST",
  path: string,
  form?: Record<string, string>,
): Promise<
  { ok: true; data: Record<string, unknown> } | { ok: false; error: string }
> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        authorization: authHeader(sid, token),
        ...(form
          ? { "content-type": "application/x-www-form-urlencoded" }
          : {}),
      },
      body: form ? new URLSearchParams(form).toString() : undefined,
      signal: controller.signal,
    });
    const data = (await res.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (res.ok) {
      return { ok: true, data };
    }
    const msg =
      typeof data.message === "string"
        ? data.message
        : `Twilio API error (HTTP ${res.status}).`;
    return { ok: false, error: msg };
  } catch (e) {
    const msg =
      e instanceof Error && e.name === "AbortError"
        ? "Twilio didn't respond (timed out). Check your connection and try again."
        : e instanceof Error
          ? e.message
          : String(e);
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

/** Validate the Account SID + Auth Token by fetching the account. */
export async function twilioVerify(
  sid: string,
  token: string,
): Promise<TwilioVerifyResult> {
  const s = sid.trim();
  const t = token.trim();
  if (!s || !t) {
    return { ok: false, error: "Enter both the Account SID and Auth Token." };
  }
  if (!/^AC[0-9a-f]{32}$/i.test(s)) {
    return {
      ok: false,
      error: "That doesn't look like an Account SID: it starts with 'AC'.",
    };
  }
  const r = await twCall(s, t, "GET", `/Accounts/${s}.json`);
  if (!r.ok) {
    return {
      ok: false,
      error: /401|authenticate/i.test(r.error)
        ? "Twilio rejected those credentials. Double-check the Account SID and Auth Token from the console."
        : r.error,
    };
  }
  return {
    ok: true,
    friendlyName:
      typeof r.data.friendly_name === "string" ? r.data.friendly_name : null,
  };
}

/** List the account's phone numbers so the user can pick which one is the bot. */
export async function twilioListNumbers(
  sid: string,
  token: string,
): Promise<TwilioNumbersResult> {
  const r = await twCall(
    sid.trim(),
    token.trim(),
    "GET",
    `/Accounts/${sid.trim()}/IncomingPhoneNumbers.json?PageSize=50`,
  );
  if (!r.ok) {
    return { ok: false, numbers: [], error: r.error };
  }
  const raw = Array.isArray(r.data.incoming_phone_numbers)
    ? (r.data.incoming_phone_numbers as Record<string, unknown>[])
    : [];
  const numbers = raw.map((n) => ({
    sid: String(n.sid ?? ""),
    phoneNumber: String(n.phone_number ?? ""),
    friendlyName: String(n.friendly_name ?? n.phone_number ?? ""),
    smsUrl: typeof n.sms_url === "string" ? n.sms_url : "",
  }));
  return { ok: true, numbers };
}

/**
 * Point a number's Messaging + Voice webhooks at the deployed agent, then read it
 * back to confirm. `base` is the stable production URL; the eve channel serves
 * `/messages` and `/voice` under `/eve/v1/twilio`.
 */
export async function twilioSetWebhooks(
  sid: string,
  token: string,
  phoneSid: string,
  base: string,
): Promise<TwilioWebhookResult> {
  const b = base.trim().replace(/\/+$/, "");
  const smsUrl = `${b}${TWILIO_SMS_PATH}`;
  const voiceUrl = `${b}${TWILIO_VOICE_PATH}`;
  const r = await twCall(
    sid.trim(),
    token.trim(),
    "POST",
    `/Accounts/${sid.trim()}/IncomingPhoneNumbers/${phoneSid}.json`,
    {
      SmsUrl: smsUrl,
      SmsMethod: "POST",
      VoiceUrl: voiceUrl,
      VoiceMethod: "POST",
    },
  );
  if (!r.ok) {
    return { ok: false, error: r.error };
  }
  const live = r.data.sms_url === smsUrl;
  return { ok: true, smsUrl: String(r.data.sms_url ?? ""), live };
}

/** Read a number's current SMS webhook to report live status for the badge. */
export async function twilioNumberStatus(
  sid: string,
  token: string,
  phoneSid: string,
  base?: string,
): Promise<TwilioWebhookResult> {
  const r = await twCall(
    sid.trim(),
    token.trim(),
    "GET",
    `/Accounts/${sid.trim()}/IncomingPhoneNumbers/${phoneSid}.json`,
  );
  if (!r.ok) {
    return { ok: false, error: r.error };
  }
  const smsUrl = typeof r.data.sms_url === "string" ? r.data.sms_url : "";
  const expected = base
    ? `${base.trim().replace(/\/+$/, "")}${TWILIO_SMS_PATH}`
    : "";
  return {
    ok: true,
    smsUrl,
    live: Boolean(smsUrl) && (!expected || smsUrl === expected),
  };
}
