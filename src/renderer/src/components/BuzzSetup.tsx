import type { BuzzKeyResult, BuzzVerifyResult } from "@shared/ipc";
import { useEffect, useState } from "react";
import { useStore } from "../store";
import { IconCheck, IconExternal, IconRocket } from "../ui/icons";
import { Button, Input, Modal, Spinner } from "../ui/kit";

/**
 * Guided, end-to-end Buzz (github.com/block/buzz) setup. Buzz agents are
 * first-class workspace members with their own Nostr identity, so the flow is:
 * generate the identity → the user admits it in their Buzz app → push the
 * agent's profile (name/bio/avatar) → wire credentials + channel file → start
 * the inbound bridge → deploy & test.
 *
 * The bridge exists because hosted Buzz relays don't push events out yet:
 * see resources/buzz-bridge.mjs. Replies always come from the DEPLOYED agent.
 */
export function BuzzSetup({
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

  // Step 1: relay + identity
  const [relay, setRelay] = useState("");
  const [key, setKey] = useState<BuzzKeyResult | null>(null);
  const [genErr, setGenErr] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [member, setMember] = useState<BuzzVerifyResult | null>(null);
  const [copied, setCopied] = useState(false);

  // Step 2: profile
  const [name, setName] = useState("");
  const [about, setAbout] = useState("");
  const [avatarData, setAvatarData] = useState("");
  const [avatarMime, setAvatarMime] = useState("");
  const [avatarName, setAvatarName] = useState("");
  const [pushing, setPushing] = useState(false);
  const [pushed, setPushed] = useState(false);
  const [pushErr, setPushErr] = useState<string | null>(null);

  // Step 3: wire
  const [wiring, setWiring] = useState(false);
  const [wired, setWired] = useState(false);
  const [wireOut, setWireOut] = useState("");

  // Step 4: bridge
  const [targetUrl, setTargetUrl] = useState("");
  const [loadingUrl, setLoadingUrl] = useState(false);
  const [bridgeMsg, setBridgeMsg] = useState<string | null>(null);
  const [bridgeBusy, setBridgeBusy] = useState(false);

  const generate = async (): Promise<void> => {
    setGenErr(null);
    const r = await window.studio.buzz.genKey(agentId, relay.trim());
    if (r.ok) {
      setKey(r);
    } else {
      setGenErr(r.error ?? "Couldn't generate an identity.");
    }
  };

  const verify = async (): Promise<void> => {
    setChecking(true);
    const r = await window.studio.buzz.verify(agentId);
    setChecking(false);
    setMember(r);
  };

  const pushProfile = async (): Promise<void> => {
    setPushing(true);
    setPushErr(null);
    const r = await window.studio.buzz.setProfile(agentId, {
      name: name.trim(),
      about: about.trim() || undefined,
      avatarData: avatarData || undefined,
      avatarMime: avatarMime || undefined,
    });
    setPushing(false);
    if (r.ok) {
      setPushed(true);
    } else {
      setPushErr(r.error ?? "Couldn't push the profile.");
    }
  };

  const wire = async (): Promise<void> => {
    setWiring(true);
    setWireOut("");
    const r = await window.studio.buzz.wire(agentId);
    setWiring(false);
    setWireOut(r.output);
    setWired(r.ok);
  };

  // Entering the bridge step, prefill the target from the stable prod alias.
  useEffect(() => {
    if (step !== 4 || targetUrl) {
      return;
    }
    setLoadingUrl(true);
    void window.studio.vercel
      .prodAlias(agentId)
      .then((p) => {
        if (p.ok && p.url) {
          setTargetUrl(`${p.url.replace(/\/+$/, "")}/inbound`);
        }
      })
      .finally(() => setLoadingUrl(false));
  }, [step, agentId, targetUrl]);

  const startBridge = async (install: boolean): Promise<void> => {
    setBridgeBusy(true);
    setBridgeMsg(null);
    await window.studio.buzz.save(agentId, { targetUrl: targetUrl.trim() });
    const r = install
      ? await window.studio.buzz.bridgeInstall(agentId)
      : await window.studio.buzz.bridgeStart(agentId);
    setBridgeBusy(false);
    setBridgeMsg(
      r.ok
        ? install
          ? "Background bridge installed: listens even when Studio is closed."
          : "Bridge running (while Studio is open)."
        : ((r as { error?: string }).error ?? "Couldn't start the bridge."),
    );
  };

  const STEPS = ["How it works", "Identity", "Profile", "Wire", "Bridge", "Ship"];

  return (
    <Modal onClose={onClose} title="Set up Buzz" width="max-w-xl">
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
                <div className={`h-px flex-1 ${i < step ? "bg-success" : "bg-border"}`} />
              ) : null}
            </div>
          ))}
        </div>

        {/* Step 0: explainer */}
        {step === 0 ? (
          <div className="space-y-3">
            <p className="text-[13px] leading-relaxed text-muted">
              <a
                className="inline-flex items-center gap-1 text-accent hover:underline"
                href="https://github.com/block/buzz"
                rel="noreferrer"
                target="_blank"
              >
                Buzz <IconExternal className="h-3 w-3" />
              </a>{" "}
              treats agents as <strong>first-class members</strong>: your agent
              gets its own identity, profile, and audit trail in the workspace.
            </p>
            <ul className="space-y-1.5 text-[13px] text-muted">
              <li>
                <strong className="text-text">1. Identity</strong>: Studio
                generates a keypair; you admit it in your Buzz app.
              </li>
              <li>
                <strong className="text-text">2. Profile</strong>: name, bio
                and avatar, pushed into the workspace.
              </li>
              <li>
                <strong className="text-text">3. Wire</strong>: credentials go
                to Vercel and the channel file is written.
              </li>
              <li>
                <strong className="text-text">4. Bridge</strong>: hosted Buzz
                relays can't push events out yet, so a small local bridge
                forwards messages to your deployed agent. Replies always come
                from the deployed agent itself.
              </li>
              <li>
                <strong className="text-text">5. Ship</strong>: deploy, then DM
                the agent in Buzz.
              </li>
            </ul>
          </div>
        ) : null}

        {/* Step 1: relay + identity */}
        {step === 1 ? (
          <div className="space-y-3">
            <div>
              <div className="mb-1 text-xs font-medium text-muted">
                Relay URL{" "}
                <span className="text-faint">your workspace's Buzz relay</span>
              </div>
              <Input
                className="font-mono text-[12px]"
                onChange={(e) => setRelay(e.target.value)}
                placeholder="wss://yourteam.communities.buzz.xyz"
                value={relay}
              />
            </div>
            <Button
              disabled={!relay.trim() || Boolean(key)}
              onClick={generate}
              variant={key ? "secondary" : "primary"}
            >
              {key ? (
                <>
                  <IconCheck className="h-3.5 w-3.5" /> Identity ready
                </>
              ) : (
                "Generate identity"
              )}
            </Button>
            {genErr ? <div className="text-xs text-danger">{genErr}</div> : null}
            {key?.npub ? (
              <div className="space-y-2">
                <div className="rounded-lg border border-border bg-subtle p-3">
                  <div className="mb-1 text-2xs text-muted">
                    Admit this member in your Buzz app (workspace → invite /
                    add member):
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded bg-black/[0.05] px-1.5 py-1 font-mono text-2xs text-text">
                      {key.npub}
                    </code>
                    <Button
                      onClick={() => {
                        void navigator.clipboard.writeText(key.npub ?? "");
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                      }}
                      size="sm"
                      variant="secondary"
                    >
                      {copied ? "Copied" : "Copy"}
                    </Button>
                  </div>
                </div>
                <Button disabled={checking} onClick={verify} variant="primary">
                  {checking ? (
                    <>
                      <Spinner /> Checking…
                    </>
                  ) : (
                    "Verify membership"
                  )}
                </Button>
                {member ? (
                  member.member ? (
                    <div className="rounded-lg bg-success/10 px-3 py-2 text-[13px] text-success">
                      Admitted to the workspace
                      {member.channels
                        ? `, member of ${member.channels} channel(s).`
                        : ". Channels come later. DM the agent or add it to a channel after deploy."}
                    </div>
                  ) : (
                    <div className="rounded-lg bg-warn/10 px-3 py-2 text-2xs text-warn">
                      {member.error ??
                        "Not admitted yet. Add the member in Buzz, then re-check."}
                    </div>
                  )
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Step 2: profile */}
        {step === 2 ? (
          <div className="space-y-3">
            <p className="text-[13px] leading-relaxed text-muted">
              How the agent appears to everyone in the workspace:
            </p>
            <div>
              <div className="mb-1 text-xs font-medium text-muted">
                Display name{" "}
                <span className="text-faint">also wakes the agent on @mention</span>
              </div>
              <Input
                onChange={(e) => setName(e.target.value)}
                placeholder="Eve Health"
                value={name}
              />
            </div>
            <div>
              <div className="mb-1 text-xs font-medium text-muted">Bio</div>
              <Input
                onChange={(e) => setAbout(e.target.value)}
                placeholder="What this agent does"
                value={about}
              />
            </div>
            <div>
              <div className="mb-1 text-xs font-medium text-muted">
                Avatar <span className="text-faint">PNG/JPEG, uploaded to the relay</span>
              </div>
              <input
                accept="image/png,image/jpeg,image/webp"
                className="block w-full text-2xs text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-black/[0.06] file:px-3 file:py-1.5 file:text-2xs file:font-medium file:text-text"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) {
                    setAvatarData("");
                    setAvatarName("");
                    return;
                  }
                  setAvatarMime(f.type || "image/png");
                  setAvatarName(f.name);
                  const reader = new FileReader();
                  reader.onload = () => {
                    const s = String(reader.result ?? "");
                    setAvatarData(s.slice(s.indexOf(",") + 1)); // strip data: prefix
                  };
                  reader.readAsDataURL(f);
                }}
                type="file"
              />
              {avatarName ? (
                <p className="mt-1 text-2xs text-faint">{avatarName} ready</p>
              ) : null}
            </div>
            <Button
              disabled={pushing || pushed || !name.trim()}
              onClick={pushProfile}
              variant={pushed ? "secondary" : "primary"}
            >
              {pushing ? (
                <>
                  <Spinner /> Pushing…
                </>
              ) : pushed ? (
                <>
                  <IconCheck className="h-3.5 w-3.5" /> Profile live in Buzz
                </>
              ) : (
                "Push profile to Buzz"
              )}
            </Button>
            {pushErr ? <div className="text-xs text-danger">{pushErr}</div> : null}
          </div>
        ) : null}

        {/* Step 3: wire */}
        {step === 3 ? (
          <div className="space-y-3">
            <p className="text-[13px] leading-relaxed text-muted">
              Studio saves{" "}
              <code className="rounded bg-black/[0.05] px-1 font-mono text-2xs text-text">
                BUZZ_RELAY_URL · BUZZ_PRIVATE_KEY · BUZZ_WEBHOOK_SECRET ·
                BUZZ_AGENT_NAME
              </code>{" "}
              to Vercel, writes{" "}
              <span className="font-mono text-text">channels/buzz.ts</span>, and
              adds <span className="font-mono text-text">nostr-tools</span> to
              the agent.
            </p>
            <Button
              disabled={wiring || wired}
              onClick={wire}
              variant={wired ? "secondary" : "primary"}
            >
              {wiring ? (
                <>
                  <Spinner /> Wiring…
                </>
              ) : wired ? (
                <>
                  <IconCheck className="h-3.5 w-3.5" /> Wired
                </>
              ) : (
                "Wire credentials & channel"
              )}
            </Button>
            {wireOut ? (
              <pre className="max-h-40 overflow-auto rounded-lg border border-border bg-subtle p-3 font-mono text-2xs text-muted">
                {wireOut}
              </pre>
            ) : null}
          </div>
        ) : null}

        {/* Step 4: bridge */}
        {step === 4 ? (
          <div className="space-y-3">
            <p className="text-[13px] leading-relaxed text-muted">
              Hosted Buzz relays don't push events out yet, so a local bridge
              polls the relay and forwards DMs + @mentions to your deployed
              agent. Replies come from the deployed agent: the bridge is
              inbound-only.
            </p>
            <Input
              className="font-mono text-[12px]"
              disabled={loadingUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              placeholder={
                loadingUrl
                  ? "Finding your deployment…"
                  : "https://your-agent.vercel.app/inbound"
              }
              value={targetUrl}
            />
            {!loadingUrl && !targetUrl ? (
              <p className="text-2xs text-faint">
                No deployment yet. Deploy first (next step), then come back and
                start the bridge, or paste the URL manually.
              </p>
            ) : null}
            <div className="flex gap-2">
              <Button
                disabled={bridgeBusy || !targetUrl.trim()}
                onClick={() => void startBridge(false)}
                variant="secondary"
              >
                Run while Studio is open
              </Button>
              <Button
                disabled={bridgeBusy || !targetUrl.trim()}
                onClick={() => void startBridge(true)}
                variant="primary"
              >
                {bridgeBusy ? (
                  <>
                    <Spinner /> Working…
                  </>
                ) : (
                  "Install background bridge"
                )}
              </Button>
            </div>
            {bridgeMsg ? (
              <div className="rounded-lg bg-subtle px-3 py-2 text-2xs text-muted">
                {bridgeMsg}
              </div>
            ) : null}
            <p className="text-2xs text-faint">
              Self-hosted relay with workflow webhooks enabled? Skip the bridge
              and point a <span className="font-mono">call_webhook</span>{" "}
              workflow at <span className="font-mono">/inbound</span> instead:
              the channel file serves either path.
            </p>
          </div>
        ) : null}

        {/* Step 5: ship */}
        {step === 5 ? (
          <div className="space-y-3">
            <div className="rounded-lg bg-success/10 px-3 py-2 text-[13px] text-success">
              Buzz is wired. Two things to finish:
            </div>
            <ol className="space-y-1.5 text-[13px] text-muted">
              <li>
                <strong className="text-text">Deploy</strong>: the channel +
                credentials only take effect on the deployed agent.
              </li>
              <li>
                <strong className="text-text">Test</strong>: DM{" "}
                <strong>{name || "the agent"}</strong> in Buzz, or @mention it
                in a channel it's a member of.
              </li>
            </ol>
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
              disabled={
                (step === 1 && !member?.member) ||
                (step === 2 && !pushed) ||
                (step === 3 && !wired)
              }
              onClick={() => setStep((s) => s + 1)}
              variant="primary"
            >
              {step === 4 ? "Skip / Next" : "Next"}
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
