import type { TelegramVerifyResult, TelegramWebhookResult } from "@shared/ipc";
import { useEffect, useState } from "react";
import { useStore } from "../store";
import { IconCheck, IconExternal, IconRocket } from "../ui/icons";
import { Button, Input, Modal, Spinner } from "../ui/kit";

/** A random, Telegram-legal webhook secret (A–Za–z0–9, no separators to copy wrong). */
function genSecret(): string {
  return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "");
}

/** Build the webhook URL the deployed agent serves from a base deployment URL. */
function webhookUrlFrom(base: string): string {
  const b = base.trim().replace(/\/+$/, "");
  if (!b) {
    return "";
  }
  return /\/eve\/v1\/telegram$/.test(b) ? b : `${b}/eve/v1/telegram`;
}

/**
 * Guided, end-to-end Telegram setup, the flow Studio was missing (it used to
 * just write the file and tell you to set env vars in a tab that doesn't exist).
 * Walks through the four things that actually make Telegram work: create the bot
 * with BotFather + verify its token, save the credentials to Vercel and write the
 * channel file, register the webhook at the deployed agent, then deploy + test.
 */
export function TelegramSetup({
  agentId,
  onClose,
  onDone,
}: {
  agentId: string;
  onClose: () => void;
  onDone: () => void;
}): JSX.Element {
  const setSection = useStore((s) => s.setSection);
  const [step, setStep] = useState(0);

  // Step 1: bot token
  const [token, setToken] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState<TelegramVerifyResult | null>(null);
  const [verifyErr, setVerifyErr] = useState<string | null>(null);
  const [botUsername, setBotUsername] = useState("");

  // Step 2: credentials + channel file
  const [secret] = useState(genSecret);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  // Step 3: webhook
  const [hookUrl, setHookUrl] = useState("");
  const [loadingUrl, setLoadingUrl] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [hook, setHook] = useState<TelegramWebhookResult | null>(null);
  const [hookErr, setHookErr] = useState<string | null>(null);

  const verify = async (): Promise<void> => {
    setVerifying(true);
    setVerifyErr(null);
    const r = await window.studio.telegram.verify(token.trim());
    setVerifying(false);
    if (r.ok) {
      setVerified(r);
      setBotUsername((cur) => cur || r.username || "");
    } else {
      setVerified(null);
      setVerifyErr(r.error ?? "Couldn't verify that token.");
    }
  };

  const saveCreds = async (): Promise<void> => {
    setSaving(true);
    setSaveErr(null);
    // Both secrets go to every environment so the deployed agent can read them;
    // the webhook secret must match what we register with Telegram in step 3.
    const t = await window.studio.vercel.envSetAll(
      agentId,
      "TELEGRAM_BOT_TOKEN",
      token.trim(),
    );
    const s = await window.studio.vercel.envSetAll(
      agentId,
      "TELEGRAM_WEBHOOK_SECRET_TOKEN",
      secret,
    );
    const w = await window.studio.agents.channelWrite(agentId, {
      kind: "telegram",
      botUsername: botUsername.trim() || undefined,
      overwrite: true,
    });
    // Persist so the Channels badge can show live status and the webhook can be
    // re-registered after a redeploy without re-pasting the token or secret.
    await window.studio.telegram.save(agentId, {
      botToken: token.trim(),
      webhookSecret: secret,
      botUsername: botUsername.trim() || undefined,
    });
    setSaving(false);
    if (t.ok && s.ok && (w.ok || w.error?.includes("already exists"))) {
      setSaved(true);
    } else {
      setSaveErr(
        !t.ok || !s.ok
          ? t.output || s.output || "Couldn't save the credentials to Vercel."
          : (w.error ?? "Couldn't write the channel file."),
      );
    }
  };

  // Entering the webhook step, prefill the URL from the STABLE production alias
  // (never the per-deployment URL, which breaks on the next deploy).
  useEffect(() => {
    if (step !== 3 || hookUrl) {
      return;
    }
    setLoadingUrl(true);
    void window.studio.vercel
      .prodAlias(agentId)
      .then((p) => {
        if (p.ok && p.url) {
          setHookUrl(webhookUrlFrom(p.url));
        }
      })
      .finally(() => setLoadingUrl(false));
  }, [step, agentId, hookUrl]);

  const registerHook = async (): Promise<void> => {
    setRegistering(true);
    setHookErr(null);
    // Uses the saved token + secret in the main process, so it always matches
    // the deployed env.
    const r = await window.studio.telegram.registerWebhook(
      agentId,
      hookUrl.trim(),
    );
    setRegistering(false);
    if (r.ok) {
      setHook(r);
    } else {
      setHookErr(r.error ?? "Couldn't register the webhook.");
    }
  };

  const STEPS = ["How it works", "Bot", "Credentials", "Webhook", "Ship"];

  return (
    <Modal onClose={onClose} title="Set up Telegram" width="max-w-xl">
      <div className="p-4">
        {/* Step rail */}
        <div className="mb-4 flex items-center gap-1.5">
          {STEPS.map((label, i) => (
            <div className="flex flex-1 items-center gap-1.5" key={label}>
              <div
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
                  i < step
                    ? "bg-success text-white"
                    : i === step
                      ? "bg-text text-white"
                      : "bg-black/[0.06] text-faint"
                }`}
              >
                {i < step ? <IconCheck className="h-3 w-3" /> : i + 1}
              </div>
              {i < STEPS.length - 1 ? (
                <div
                  className={`h-px flex-1 ${i < step ? "bg-success" : "bg-border"}`}
                />
              ) : null}
            </div>
          ))}
        </div>

        {/* Step 0: explainer */}
        {step === 0 ? (
          <div className="space-y-3">
            <p className="text-[13px] leading-relaxed text-muted">
              Telegram talks to your agent through a <strong>bot</strong> you
              create with Telegram's <strong>BotFather</strong>. Four steps:
            </p>
            <ul className="space-y-1.5 text-[13px] text-muted">
              <li>
                <strong className="text-text">1. Bot</strong>: create it in
                BotFather and paste the token here. That's <em>who</em> messages
                come from.
              </li>
              <li>
                <strong className="text-text">2. Credentials</strong>: Studio
                saves the token + a generated webhook secret to Vercel and
                writes the channel file. No env tab, no copy-paste.
              </li>
              <li>
                <strong className="text-text">3. Webhook</strong>: point
                Telegram at your deployed agent so messages get delivered.
              </li>
              <li>
                <strong className="text-text">4. Ship</strong>: deploy, then DM
                the bot to test.
              </li>
            </ul>
            <p className="text-2xs text-faint">
              Telegram only reaches the <em>deployed</em> agent, never local
              dev.
            </p>
          </div>
        ) : null}

        {/* Step 1: bot + token */}
        {step === 1 ? (
          <div className="space-y-3">
            <ol className="space-y-1.5 text-[13px] text-muted">
              <li>
                1. Open{" "}
                <a
                  className="inline-flex items-center gap-1 text-accent hover:underline"
                  href="https://t.me/BotFather"
                  rel="noreferrer"
                  target="_blank"
                >
                  @BotFather <IconExternal className="h-3 w-3" />
                </a>{" "}
                in Telegram and send <span className="font-mono">/newbot</span>.
              </li>
              <li>
                2. Give it a display name, then a <strong>username</strong>{" "}
                ending in <span className="font-mono">bot</span> (e.g.{" "}
                <span className="font-mono">mythos_bot</span>).
              </li>
              <li>
                3. BotFather replies with an <strong>HTTP API token</strong>{" "}
                like <span className="font-mono">123456:AA…</span>. Paste it
                below.
              </li>
            </ol>
            <div className="flex gap-2">
              <Input
                className="flex-1 font-mono"
                onChange={(e) => {
                  setToken(e.target.value);
                  setVerified(null);
                  setVerifyErr(null);
                }}
                placeholder="123456789:AA…"
                type="password"
                value={token}
              />
              <Button
                disabled={verifying || !token.trim() || Boolean(verified)}
                onClick={verify}
                variant={verified ? "secondary" : "primary"}
              >
                {verifying ? (
                  <>
                    <Spinner /> Checking…
                  </>
                ) : verified ? (
                  <>
                    <IconCheck className="h-3.5 w-3.5" /> Verified
                  </>
                ) : (
                  "Verify"
                )}
              </Button>
            </div>
            {verified ? (
              <div className="rounded-lg bg-success/10 px-3 py-2 text-[13px] text-success">
                Connected to{" "}
                <strong>
                  {verified.name}
                  {verified.username ? ` (@${verified.username})` : ""}
                </strong>
                .
              </div>
            ) : null}
            {verifyErr ? (
              <div className="text-xs text-danger">{verifyErr}</div>
            ) : null}
          </div>
        ) : null}

        {/* Step 2: credentials + channel file */}
        {step === 2 ? (
          <div className="space-y-3">
            <p className="text-[13px] leading-relaxed text-muted">
              Studio will save these to Vercel (all environments) and write{" "}
              <span className="font-mono text-text">channels/telegram.ts</span>:
            </p>
            <div className="space-y-2 rounded-lg border border-border bg-subtle p-3">
              <div className="flex items-center justify-between gap-2 text-2xs">
                <span className="font-mono text-muted">TELEGRAM_BOT_TOKEN</span>
                <span className="text-faint">from BotFather ✓</span>
              </div>
              <div className="flex items-center justify-between gap-2 text-2xs">
                <span className="font-mono text-muted">
                  TELEGRAM_WEBHOOK_SECRET_TOKEN
                </span>
                <span className="truncate font-mono text-faint">
                  {secret.slice(0, 12)}… (generated)
                </span>
              </div>
            </div>
            <div>
              <div className="mb-1 text-xs font-medium text-muted">
                Bot @username{" "}
                <span className="text-faint">
                  so group @mentions wake this bot
                </span>
              </div>
              <Input
                className="font-mono"
                onChange={(e) =>
                  setBotUsername(e.target.value.replace(/^@/, ""))
                }
                placeholder="mythos_bot"
                value={botUsername}
              />
            </div>
            <Button
              disabled={saving || saved}
              onClick={saveCreds}
              variant={saved ? "secondary" : "primary"}
            >
              {saving ? (
                <>
                  <Spinner /> Saving…
                </>
              ) : saved ? (
                <>
                  <IconCheck className="h-3.5 w-3.5" /> Saved &amp; channel
                  added
                </>
              ) : (
                "Save credentials & add channel"
              )}
            </Button>
            {saveErr ? (
              <div className="text-xs text-danger">{saveErr}</div>
            ) : null}
          </div>
        ) : null}

        {/* Step 3: webhook */}
        {step === 3 ? (
          <div className="space-y-3">
            <p className="text-[13px] leading-relaxed text-muted">
              Point Telegram at your deployed agent. The webhook URL is your
              deployment +{" "}
              <span className="font-mono text-text">/eve/v1/telegram</span>.
            </p>
            <Input
              className="font-mono text-[12px]"
              disabled={loadingUrl}
              onChange={(e) => setHookUrl(e.target.value)}
              placeholder={
                loadingUrl
                  ? "Finding your deployment…"
                  : "https://your-agent.vercel.app/eve/v1/telegram"
              }
              value={hookUrl}
            />
            {!loadingUrl && !hookUrl ? (
              <p className="text-2xs text-faint">
                No deployment found yet. Deploy first (next step), then come
                back and register, or paste the URL manually.
              </p>
            ) : null}
            <Button
              disabled={registering || !hookUrl.trim()}
              onClick={registerHook}
              variant={hook?.live ? "secondary" : "primary"}
            >
              {registering ? (
                <>
                  <Spinner /> Registering…
                </>
              ) : hook?.live ? (
                <>
                  <IconCheck className="h-3.5 w-3.5" /> Webhook live. Re-check
                </>
              ) : (
                "Register webhook"
              )}
            </Button>
            {hook ? (
              <div
                className={`rounded-lg px-3 py-2 text-2xs ${
                  hook.lastError
                    ? "bg-warn/10 text-warn"
                    : "bg-success/10 text-success"
                }`}
              >
                {hook.lastError
                  ? /401|403|unauthorized|forbidden/i.test(hook.lastError)
                    ? `Registered, but Telegram is being blocked (${hook.lastError}): this is Vercel Deployment Protection. Turn off Vercel Authentication for Production (Vercel → project → Settings → Deployment Protection), then re-check.`
                    : `Registered, but Telegram's last delivery failed: ${hook.lastError}. This usually clears once the agent is deployed with the channel + env.`
                  : `Webhook registered${hook.pending ? ` · ${hook.pending} update(s) queued` : ""}. Deploy the agent (with the channel + env) to start handling messages.`}
              </div>
            ) : null}
            {hookErr ? (
              <div className="text-xs text-danger">{hookErr}</div>
            ) : null}
          </div>
        ) : null}

        {/* Step 4: ship */}
        {step === 4 ? (
          <div className="space-y-3">
            <div className="rounded-lg bg-success/10 px-3 py-2 text-[13px] text-success">
              Telegram is wired. Two things to finish:
            </div>
            <ol className="space-y-1.5 text-[13px] text-muted">
              <li>
                <strong className="text-text">Deploy</strong>: Telegram only
                reaches the deployed agent. The token + secret are already set
                for production.
              </li>
              <li>
                <strong className="text-text">Test</strong>: open{" "}
                {verified?.username ? (
                  <a
                    className="inline-flex items-center gap-1 text-accent hover:underline"
                    href={`https://t.me/${verified.username}`}
                    rel="noreferrer"
                    target="_blank"
                  >
                    @{verified.username} <IconExternal className="h-3 w-3" />
                  </a>
                ) : (
                  "your bot"
                )}{" "}
                and send it a DM. It replies in the chat.
              </li>
            </ol>
            {hook && !hook.live ? (
              <p className="text-2xs text-warn">
                Heads up: the webhook isn't registered yet. After deploying,
                come back to the Webhook step (or Set up again) to register it.
              </p>
            ) : null}
            <Button
              onClick={() => {
                onDone();
                onClose();
                setSection("deploy");
              }}
              variant="primary"
            >
              <IconRocket className="h-3.5 w-3.5" /> Go to Deploy
            </Button>
          </div>
        ) : null}

        {/* Nav */}
        <div className="mt-5 flex items-center justify-between">
          <Button
            disabled={step === 0}
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            variant="ghost"
          >
            Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button
              disabled={(step === 1 && !verified) || (step === 2 && !saved)}
              onClick={() => setStep((s) => s + 1)}
              variant="primary"
            >
              {step === 3 ? "Skip / Next" : "Next"}
            </Button>
          ) : (
            <Button
              onClick={() => {
                onDone();
                onClose();
              }}
              variant="primary"
            >
              Done
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
