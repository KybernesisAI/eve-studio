import type { TwilioNumber, TwilioWebhookResult } from "@shared/ipc";
import { useEffect, useState } from "react";
import { useStore } from "../store";
import { IconCheck, IconExternal, IconRocket } from "../ui/icons";
import { Button, Input, Modal, Spinner } from "../ui/kit";

/**
 * Guided, end-to-end Twilio setup, mirrors the Telegram/Discord flow. Verify the
 * Account SID + Auth Token, pick which of the account's numbers is the bot and who
 * may reach it, save the credentials to Vercel + write the channel file, then
 * point the number's SMS + Voice webhooks at the deployed agent, all via the
 * Twilio API, no console hunting.
 */
export function TwilioSetup({
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

  // Step 1: credentials
  const [sid, setSid] = useState("");
  const [tokenVal, setTokenVal] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState<{
    friendlyName?: string | null;
  } | null>(null);
  const [verifyErr, setVerifyErr] = useState<string | null>(null);

  // Step 2: number + allow-list
  const [numbers, setNumbers] = useState<TwilioNumber[] | null>(null);
  const [phoneSid, setPhoneSid] = useState("");
  const [allowFrom, setAllowFrom] = useState("");

  // Step 3: save
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  // Step 4: webhooks
  const [loadingUrl, setLoadingUrl] = useState(false);
  const [base, setBase] = useState("");
  const [registering, setRegistering] = useState(false);
  const [hook, setHook] = useState<TwilioWebhookResult | null>(null);
  const [hookErr, setHookErr] = useState<string | null>(null);

  const chosen = numbers?.find((n) => n.sid === phoneSid);

  const verify = async (): Promise<void> => {
    setVerifying(true);
    setVerifyErr(null);
    const r = await window.studio.twilio.verify(sid.trim(), tokenVal.trim());
    if (r.ok) {
      setVerified({ friendlyName: r.friendlyName });
      const list = await window.studio.twilio.numbers(
        sid.trim(),
        tokenVal.trim(),
      );
      if (list.ok) {
        setNumbers(list.numbers);
        setPhoneSid((cur) => cur || list.numbers[0]?.sid || "");
      }
    } else {
      setVerified(null);
      setVerifyErr(r.error ?? "Couldn't verify those credentials.");
    }
    setVerifying(false);
  };

  const saveCreds = async (): Promise<void> => {
    if (!chosen) {
      return;
    }
    setSaving(true);
    setSaveErr(null);
    const a = await window.studio.vercel.envSetAll(
      agentId,
      "TWILIO_ACCOUNT_SID",
      sid.trim(),
    );
    const t = await window.studio.vercel.envSetAll(
      agentId,
      "TWILIO_AUTH_TOKEN",
      tokenVal.trim(),
    );
    const w = await window.studio.agents.channelWrite(agentId, {
      kind: "twilio",
      overwrite: true,
      twilioFrom: chosen.phoneNumber,
      twilioAllowFrom: allowFrom,
    });
    await window.studio.twilio.save(agentId, {
      accountSid: sid.trim(),
      authToken: tokenVal.trim(),
      phoneSid: chosen.sid,
      phoneNumber: chosen.phoneNumber,
      allowFrom,
    });
    if (a.ok && t.ok && (w.ok || w.error?.includes("already exists"))) {
      setSaved(true);
    } else {
      setSaveErr(
        !a.ok || !t.ok
          ? "Couldn't save the credentials to Vercel. Check you're linked."
          : (w.error ?? "Couldn't write the channel file."),
      );
    }
    setSaving(false);
  };

  // Entering the webhook step, prefill the base from the STABLE production alias.
  useEffect(() => {
    if (step !== 4 || base) {
      return;
    }
    setLoadingUrl(true);
    void window.studio.vercel
      .prodAlias(agentId)
      .then((p) => {
        if (p.ok && p.url) {
          setBase(p.url);
        }
      })
      .finally(() => setLoadingUrl(false));
  }, [step, agentId, base]);

  const registerHooks = async (): Promise<void> => {
    setRegistering(true);
    setHookErr(null);
    const r = await window.studio.twilio.setWebhooks(agentId, base.trim());
    setRegistering(false);
    if (r.ok) {
      setHook(r);
    } else {
      setHookErr(r.error ?? "Couldn't set the number's webhooks.");
    }
  };

  const STEPS = ["How it works", "Account", "Number", "Save", "Webhooks"];

  return (
    <Modal onClose={onClose} title="Set up Twilio" width="max-w-xl">
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
              Twilio gives your agent an <strong>SMS + phone number</strong>.
              Four steps:
            </p>
            <ul className="space-y-1.5 text-[13px] text-muted">
              <li>
                <strong className="text-text">1. Account</strong>: paste your
                Account SID + Auth Token; Studio reads your numbers.
              </li>
              <li>
                <strong className="text-text">2. Number</strong>: pick which
                number is the bot and who's allowed to text/call it.
              </li>
              <li>
                <strong className="text-text">3. Save</strong>: credentials to
                Vercel + the channel file, no env tab.
              </li>
              <li>
                <strong className="text-text">4. Webhooks</strong>: point the
                number's SMS + Voice webhooks at your deployed agent.
              </li>
            </ul>
            <p className="text-2xs text-faint">
              Twilio only reaches the <em>deployed</em> agent, and it must be
              publicly reachable (Vercel Deployment Protection off for
              Production).
            </p>
          </div>
        ) : null}

        {/* Step 1: credentials */}
        {step === 1 ? (
          <div className="space-y-3">
            <p className="text-[13px] leading-relaxed text-muted">
              From the{" "}
              <a
                className="inline-flex items-center gap-1 text-accent hover:underline"
                href="https://console.twilio.com/"
                rel="noreferrer"
                target="_blank"
              >
                Twilio Console <IconExternal className="h-3 w-3" />
              </a>{" "}
              home page: Account SID and Auth Token.
            </p>
            <Input
              className="font-mono"
              onChange={(e) => {
                setSid(e.target.value);
                setVerified(null);
              }}
              placeholder="Account SID (AC…)"
              value={sid}
            />
            <div className="flex gap-2">
              <Input
                className="flex-1 font-mono"
                onChange={(e) => {
                  setTokenVal(e.target.value);
                  setVerified(null);
                }}
                placeholder="Auth Token"
                type="password"
                value={tokenVal}
              />
              <Button
                disabled={
                  verifying ||
                  !sid.trim() ||
                  !tokenVal.trim() ||
                  Boolean(verified)
                }
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
                  {verified.friendlyName || "your Twilio account"}
                </strong>
                {numbers ? `: ${numbers.length} number(s) found.` : "."}
              </div>
            ) : null}
            {verifyErr ? (
              <div className="text-xs text-danger">{verifyErr}</div>
            ) : null}
          </div>
        ) : null}

        {/* Step 2: number + allow-list */}
        {step === 2 ? (
          <div className="space-y-3">
            {numbers && numbers.length > 0 ? (
              <>
                <div>
                  <div className="mb-1 text-xs font-medium text-muted">
                    Bot number{" "}
                    <span className="text-faint">
                      replies are sent from this
                    </span>
                  </div>
                  <select
                    value={phoneSid}
                    onChange={(e) => setPhoneSid(e.target.value)}
                    className="no-drag w-full rounded-lg border border-border bg-bg px-2.5 py-1.5 font-mono text-[13px] text-text outline-none focus:border-border-strong"
                  >
                    {numbers.map((n) => (
                      <option key={n.sid} value={n.sid}>
                        {n.phoneNumber}
                        {n.friendlyName && n.friendlyName !== n.phoneNumber
                          ? ` (${n.friendlyName})`
                          : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <div className="mb-1 text-xs font-medium text-muted">
                    Allowed senders{" "}
                    <span className="text-faint">
                      E.164, comma-separated (who may text/call)
                    </span>
                  </div>
                  <Input
                    className="font-mono"
                    onChange={(e) => setAllowFrom(e.target.value)}
                    placeholder="+15551234567, +15557654321"
                    value={allowFrom}
                  />
                  <p className="mt-1 text-2xs text-faint">
                    Required: the channel ignores anyone not listed. Add your
                    own mobile to test.
                  </p>
                </div>
              </>
            ) : (
              <div className="rounded-lg border border-border bg-subtle p-3 text-2xs text-muted">
                No phone numbers on this account yet. Buy one in the Twilio
                Console, then reopen this setup.
              </div>
            )}
          </div>
        ) : null}

        {/* Step 3: save */}
        {step === 3 ? (
          <div className="space-y-3">
            <p className="text-[13px] leading-relaxed text-muted">
              Save to Vercel and write{" "}
              <span className="font-mono text-text">channels/twilio.ts</span>{" "}
              wired to{" "}
              <span className="font-mono text-text">{chosen?.phoneNumber}</span>
              .
            </p>
            <Button
              disabled={saving || saved || !chosen || !allowFrom.trim()}
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
            {!allowFrom.trim() ? (
              <p className="text-2xs text-warn">
                Add at least one allowed sender in the previous step first.
              </p>
            ) : null}
            {saveErr ? (
              <div className="text-xs text-danger">{saveErr}</div>
            ) : null}
          </div>
        ) : null}

        {/* Step 4: webhooks */}
        {step === 4 ? (
          <div className="space-y-3">
            <p className="text-[13px] leading-relaxed text-muted">
              Point{" "}
              <span className="font-mono text-text">{chosen?.phoneNumber}</span>
              's Messaging + Voice webhooks at your deployed agent.
            </p>
            <Input
              className="font-mono text-[12px]"
              disabled={loadingUrl}
              onChange={(e) => setBase(e.target.value)}
              placeholder={
                loadingUrl
                  ? "Finding your deployment…"
                  : "https://your-agent.vercel.app"
              }
              value={base}
            />
            {!loadingUrl && !base ? (
              <p className="text-2xs text-faint">
                No deployment found yet. Deploy first, then come back and set
                the webhooks, or paste the base URL manually.
              </p>
            ) : null}
            <Button
              disabled={registering || !base.trim()}
              onClick={registerHooks}
              variant={hook?.live ? "secondary" : "primary"}
            >
              {registering ? (
                <>
                  <Spinner /> Setting…
                </>
              ) : hook?.live ? (
                <>
                  <IconCheck className="h-3.5 w-3.5" /> Webhooks set. Re-check
                </>
              ) : (
                "Set SMS + Voice webhooks"
              )}
            </Button>
            {hook ? (
              <div className="rounded-lg bg-success/10 px-3 py-2 text-2xs text-success">
                Webhooks set on {chosen?.phoneNumber}. Deploy the agent, then
                text the number to test.
              </div>
            ) : null}
            {hookErr ? (
              <div className="text-xs text-danger">{hookErr}</div>
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
              disabled={
                (step === 1 && !verified) ||
                (step === 2 && (!chosen || !allowFrom.trim())) ||
                (step === 3 && !saved)
              }
              onClick={() => setStep((s) => s + 1)}
              variant="primary"
            >
              Next
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
