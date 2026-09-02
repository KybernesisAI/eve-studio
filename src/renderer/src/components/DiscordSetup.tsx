import type { DiscordEndpointResult, DiscordVerifyResult } from "@shared/ipc";
import { useEffect, useState } from "react";
import { useStore } from "../store";
import { IconCheck, IconExternal, IconRocket } from "../ui/icons";
import { Button, Input, Modal, Spinner } from "../ui/kit";

/** Build the interactions-endpoint URL the deployed agent serves from a base URL. */
function endpointUrlFrom(base: string): string {
  const b = base.trim().replace(/\/+$/, "");
  if (!b) {
    return "";
  }
  return /\/eve\/v1\/discord$/.test(b) ? b : `${b}/eve/v1/discord`;
}

/** Bot invite: bot + slash-command scopes, view/send/read-history permissions. */
function inviteUrl(appId: string): string {
  return `https://discord.com/oauth2/authorize?client_id=${appId}&scope=bot+applications.commands&permissions=68608`;
}

/**
 * Guided, end-to-end Discord setup, mirrors the Telegram flow. Create the app +
 * bot and verify its token (which hands us the application id + public key), save
 * the credentials to Vercel + write the channel file + register the /ask command,
 * invite the bot to a server, then set + verify the interactions endpoint at the
 * deployed agent.
 */
export function DiscordSetup({
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
  const [verified, setVerified] = useState<DiscordVerifyResult | null>(null);
  const [verifyErr, setVerifyErr] = useState<string | null>(null);

  // Step 2: credentials + channel file + command
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [cmdNote, setCmdNote] = useState<string | null>(null);

  // Step 4: interactions endpoint
  const [epUrl, setEpUrl] = useState("");
  const [loadingUrl, setLoadingUrl] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [ep, setEp] = useState<DiscordEndpointResult | null>(null);
  const [epErr, setEpErr] = useState<string | null>(null);

  const verify = async (): Promise<void> => {
    setVerifying(true);
    setVerifyErr(null);
    const r = await window.studio.discord.verify(token.trim());
    setVerifying(false);
    if (r.ok && r.applicationId && r.publicKey) {
      setVerified(r);
    } else {
      setVerified(null);
      setVerifyErr(
        r.error ??
          "That token didn't return an application. Check it's the Bot token.",
      );
    }
  };

  const saveCreds = async (): Promise<void> => {
    if (!verified?.applicationId || !verified.publicKey) {
      return;
    }
    setSaving(true);
    setSaveErr(null);
    setCmdNote(null);
    const b = await window.studio.vercel.envSetAll(
      agentId,
      "DISCORD_BOT_TOKEN",
      token.trim(),
    );
    const a = await window.studio.vercel.envSetAll(
      agentId,
      "DISCORD_APPLICATION_ID",
      verified.applicationId,
    );
    const k = await window.studio.vercel.envSetAll(
      agentId,
      "DISCORD_PUBLIC_KEY",
      verified.publicKey,
    );
    const w = await window.studio.agents.channelWrite(agentId, {
      kind: "discord",
      overwrite: true,
    });
    await window.studio.discord.save(agentId, {
      botToken: token.trim(),
      applicationId: verified.applicationId,
      publicKey: verified.publicKey,
    });
    if (a.ok && b.ok && k.ok && (w.ok || w.error?.includes("already exists"))) {
      // Slash-command registration is separate: report it but don't block.
      const cmd = await window.studio.discord.registerCommands(agentId);
      setCmdNote(
        cmd.ok
          ? "Registered the /ask command (can take a few minutes to show in Discord)."
          : `Saved, but registering /ask failed: ${cmd.error ?? "unknown"}. You can retry from Set up.`,
      );
      setSaved(true);
    } else {
      setSaveErr(
        !a.ok || !b.ok || !k.ok
          ? "Couldn't save the credentials to Vercel. Check you're linked."
          : (w.error ?? "Couldn't write the channel file."),
      );
    }
    setSaving(false);
  };

  // Entering the endpoint step, prefill from the STABLE production alias.
  useEffect(() => {
    if (step !== 4 || epUrl) {
      return;
    }
    setLoadingUrl(true);
    void window.studio.vercel
      .prodAlias(agentId)
      .then((p) => {
        if (p.ok && p.url) {
          setEpUrl(endpointUrlFrom(p.url));
        }
      })
      .finally(() => setLoadingUrl(false));
  }, [step, agentId, epUrl]);

  const registerEndpoint = async (): Promise<void> => {
    setRegistering(true);
    setEpErr(null);
    const r = await window.studio.discord.setEndpoint(agentId, epUrl.trim());
    setRegistering(false);
    if (r.ok) {
      setEp(r);
    } else {
      setEpErr(r.error ?? "Couldn't set the interactions endpoint.");
    }
  };

  const STEPS = ["How it works", "Bot", "Credentials", "Invite", "Endpoint"];

  return (
    <Modal onClose={onClose} title="Set up Discord" width="max-w-xl">
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
              Discord talks to your agent through an <strong>app + bot</strong>{" "}
              you create in the Developer Portal. Steps:
            </p>
            <ul className="space-y-1.5 text-[13px] text-muted">
              <li>
                <strong className="text-text">1. Bot</strong>: create the app,
                add a bot, paste its token. Studio reads the app id + public key
                from it: no hunting for three secrets.
              </li>
              <li>
                <strong className="text-text">2. Credentials</strong>: saved to
                Vercel; the channel file +{" "}
                <span className="font-mono">/ask</span> command are created for
                you.
              </li>
              <li>
                <strong className="text-text">3. Invite</strong>: add the bot
                to your server.
              </li>
              <li>
                <strong className="text-text">4. Endpoint</strong>: point
                Discord at your deployed agent; Discord verifies it on the spot.
              </li>
            </ul>
            <p className="text-2xs text-faint">
              Discord only reaches the <em>deployed</em> agent, and it must be
              publicly reachable (turn off Vercel Deployment Protection for
              Production).
            </p>
          </div>
        ) : null}

        {/* Step 1: bot + token */}
        {step === 1 ? (
          <div className="space-y-3">
            <ol className="space-y-1.5 text-[13px] text-muted">
              <li>
                1. Open the{" "}
                <a
                  className="inline-flex items-center gap-1 text-accent hover:underline"
                  href="https://discord.com/developers/applications"
                  rel="noreferrer"
                  target="_blank"
                >
                  Developer Portal <IconExternal className="h-3 w-3" />
                </a>{" "}
                → <strong>New Application</strong>.
              </li>
              <li>
                2. Open the <strong>Bot</strong> tab →{" "}
                <strong>Reset Token</strong> → copy it.
              </li>
              <li>3. Paste the bot token below.</li>
            </ol>
            <div className="flex gap-2">
              <Input
                className="flex-1 font-mono"
                onChange={(e) => {
                  setToken(e.target.value);
                  setVerified(null);
                  setVerifyErr(null);
                }}
                placeholder="Bot token"
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
                Connected to <strong>{verified.name}</strong>: read its app id
                and public key.
              </div>
            ) : null}
            {verifyErr ? (
              <div className="text-xs text-danger">{verifyErr}</div>
            ) : null}
          </div>
        ) : null}

        {/* Step 2: credentials + channel file + command */}
        {step === 2 ? (
          <div className="space-y-3">
            <p className="text-[13px] leading-relaxed text-muted">
              Studio will save these to Vercel (all environments), write{" "}
              <span className="font-mono text-text">channels/discord.ts</span>,
              and register the <span className="font-mono">/ask</span> command:
            </p>
            <div className="space-y-1.5 rounded-lg border border-border bg-subtle p-3 text-2xs">
              {[
                ["DISCORD_BOT_TOKEN", "from the Bot tab ✓"],
                ["DISCORD_APPLICATION_ID", verified?.applicationId ?? ""],
                [
                  "DISCORD_PUBLIC_KEY",
                  verified?.publicKey
                    ? `${verified.publicKey.slice(0, 16)}…`
                    : "",
                ],
              ].map(([k, v]) => (
                <div
                  className="flex items-center justify-between gap-2"
                  key={k}
                >
                  <span className="font-mono text-muted">{k}</span>
                  <span className="truncate font-mono text-faint">{v}</span>
                </div>
              ))}
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
            {cmdNote ? (
              <div className="text-2xs text-muted">{cmdNote}</div>
            ) : null}
            {saveErr ? (
              <div className="text-xs text-danger">{saveErr}</div>
            ) : null}
          </div>
        ) : null}

        {/* Step 3: invite */}
        {step === 3 ? (
          <div className="space-y-3">
            <p className="text-[13px] leading-relaxed text-muted">
              Add the bot to a server so it can receive commands. This grants
              the <span className="font-mono">bot</span> +{" "}
              <span className="font-mono">applications.commands</span> scopes.
            </p>
            <Button
              disabled={!verified?.applicationId}
              onClick={() =>
                verified?.applicationId &&
                window.open(inviteUrl(verified.applicationId), "_blank")
              }
              variant="primary"
            >
              <IconExternal className="h-3.5 w-3.5" /> Open invite
            </Button>
            <p className="text-2xs text-faint">
              Pick a server you manage and authorize. You can invite it to more
              servers anytime with the same link.
            </p>
          </div>
        ) : null}

        {/* Step 4: interactions endpoint */}
        {step === 4 ? (
          <div className="space-y-3">
            <p className="text-[13px] leading-relaxed text-muted">
              Point Discord at your deployed agent (
              <span className="font-mono text-text">/eve/v1/discord</span>).
              Discord verifies it immediately: this only works once the agent
              is <strong>deployed</strong> with the credentials.
            </p>
            <Input
              className="font-mono text-[12px]"
              disabled={loadingUrl}
              onChange={(e) => setEpUrl(e.target.value)}
              placeholder={
                loadingUrl
                  ? "Finding your deployment…"
                  : "https://your-agent.vercel.app/eve/v1/discord"
              }
              value={epUrl}
            />
            {!loadingUrl && !epUrl ? (
              <p className="text-2xs text-faint">
                No deployment found yet. Deploy first (next step), then come
                back to verify, or paste the URL manually.
              </p>
            ) : null}
            <Button
              disabled={registering || !epUrl.trim()}
              onClick={registerEndpoint}
              variant={ep?.live ? "secondary" : "primary"}
            >
              {registering ? (
                <>
                  <Spinner /> Verifying…
                </>
              ) : ep?.live ? (
                <>
                  <IconCheck className="h-3.5 w-3.5" /> Endpoint verified:
                  re-check
                </>
              ) : (
                "Set & verify endpoint"
              )}
            </Button>
            {ep?.live ? (
              <div className="rounded-lg bg-success/10 px-3 py-2 text-2xs text-success">
                Discord verified the endpoint. Slash commands will reach this
                agent.
              </div>
            ) : null}
            {epErr ? (
              <div className="rounded-lg bg-warn/10 px-3 py-2 text-2xs text-warn">
                {/could not be verified|not.*verif|401|403/i.test(epErr)
                  ? "Discord couldn't verify the endpoint. Make sure the agent is deployed with DISCORD_PUBLIC_KEY, and that Vercel Deployment Protection is off for Production (it blocks Discord's check)."
                  : epErr}
              </div>
            ) : null}
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
              {step === 3 ? "Next" : "Next"}
            </Button>
          ) : (
            <Button
              onClick={() => {
                onDone();
                onClose();
                setSection("deploy");
              }}
              variant="primary"
            >
              <IconRocket className="h-3.5 w-3.5" /> Deploy
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
