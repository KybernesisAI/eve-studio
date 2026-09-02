import type { ChannelKind } from "@shared/ipc";
import { useState } from "react";
import { useStore } from "../store";
import { IconCheck, IconExternal, IconRocket } from "../ui/icons";
import { Button, Modal, Spinner } from "../ui/kit";
import { ConnectorPicker } from "./ConnectorPicker";

/** Per-service copy for the Vercel Connect channels (GitHub, Linear). */
const SERVICES: Record<
  string,
  {
    label: string;
    /** What the app/bot is, shown in step 0. */
    what: string;
    /** How you trigger the agent once wired, shown in the ship step. */
    test: string;
    manageUrl: string;
  }
> = {
  github: {
    label: "GitHub",
    what: "a GitHub App (a Vercel Connect “GitHub client”) installed into your org/repos",
    test: "@mention the bot in an issue or PR comment: it checks out the ref and replies.",
    manageUrl: "https://vercel.com/d?to=/%5Bteam%5D/~/connect",
  },
  linear: {
    label: "Linear",
    what: "a Linear app (a Vercel Connect “Linear client”) authorized in your workspace",
    test: "delegate or @mention the agent on a Linear issue: it runs an Agent Session and posts back.",
    manageUrl: "https://vercel.com/d?to=/%5Bteam%5D/~/connect",
  },
};

/**
 * Guided setup for the Vercel-Connect-backed channels (GitHub, Linear), the same
 * shape as Slack: authorize the app (a team-level Connect client), route its
 * events to THIS agent (attach at /eve/v1/<service>), write the channel file, then
 * deploy. Credentials are brokered by Connect, so there are no secrets to store:
 * the "connected" badge comes from the channel's attachment state (wiring).
 */
export function ConnectSetup({
  agentId,
  service,
  onClose,
  onDone,
}: {
  agentId: string;
  service: "github" | "linear";
  onClose: () => void;
  onDone: () => void;
}): JSX.Element {
  const setSection = useStore((s) => s.setSection);
  const cfg = SERVICES[service];
  const [step, setStep] = useState(0);
  const [connector, setConnector] = useState("");

  const [attaching, setAttaching] = useState(false);
  const [attached, setAttached] = useState(false);
  const [attachErr, setAttachErr] = useState<string | null>(null);

  const [writing, setWriting] = useState(false);
  const [wrote, setWrote] = useState(false);
  const [writeErr, setWriteErr] = useState<string | null>(null);

  const attach = async (): Promise<void> => {
    setAttaching(true);
    setAttachErr(null);
    const r = await window.studio.vercel.connectorAttach(
      agentId,
      connector,
      service,
    );
    setAttaching(false);
    if (r.ok) {
      setAttached(true);
    } else {
      setAttachErr(
        r.output || "Attach failed: is the project linked to Vercel?",
      );
    }
  };

  const writeFile = async (): Promise<void> => {
    setWriting(true);
    setWriteErr(null);
    const r = await window.studio.agents.channelWrite(agentId, {
      kind: service as ChannelKind,
      connector,
      overwrite: true,
    });
    setWriting(false);
    if (r.ok || r.error?.includes("already exists")) {
      setWrote(true);
    } else {
      setWriteErr(r.error ?? "Couldn't write the channel file.");
    }
  };

  const STEPS = ["How it works", "App", "Connect", "Channel", "Ship"];

  return (
    <Modal onClose={onClose} title={`Set up ${cfg.label}`} width="max-w-xl">
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
              {cfg.label} talks to your agent through {cfg.what}, brokered by
              Vercel Connect: no secrets to manage. Three steps:
            </p>
            <ul className="space-y-1.5 text-[13px] text-muted">
              <li>
                <strong className="text-text">1. App</strong>: pick or create
                the Connect {cfg.label} client and authorize it.
              </li>
              <li>
                <strong className="text-text">2. Connect</strong>: route its
                events to <em>this</em> agent (attaches at{" "}
                <span className="font-mono">/eve/v1/{service}</span>).
              </li>
              <li>
                <strong className="text-text">3. Channel</strong>: write the
                channel file, then deploy.
              </li>
            </ul>
            <p className="text-2xs text-faint">
              Connect verifies events with a Vercel OIDC signature and forwards
              them to the <em>deployed</em> agent.
            </p>
          </div>
        ) : null}

        {/* Step 1: app / connector */}
        {step === 1 ? (
          <div className="space-y-3">
            <div className="text-[13px] text-muted">
              Pick an existing {cfg.label} client, or <strong>Create</strong>{" "}
              one, then <strong>Open to authorize</strong>: that installs the
              app. Reuse one across agents, or give each its own.
            </div>
            <ConnectorPicker
              agentId={agentId}
              onChange={setConnector}
              service={service}
              value={connector}
            />
          </div>
        ) : null}

        {/* Step 2: attach */}
        {step === 2 ? (
          <div className="space-y-3">
            <p className="text-[13px] leading-relaxed text-muted">
              Route <span className="font-mono text-text">{connector}</span>'s
              events to this agent (adds a trigger at{" "}
              <span className="font-mono text-text">/eve/v1/{service}</span>).
            </p>
            <Button
              disabled={attaching || attached}
              onClick={attach}
              variant={attached ? "secondary" : "primary"}
            >
              {attaching ? (
                <>
                  <Spinner /> Connecting…
                </>
              ) : attached ? (
                <>
                  <IconCheck className="h-3.5 w-3.5" /> Connected to this agent
                </>
              ) : (
                "Connect to this agent"
              )}
            </Button>
            {attachErr ? (
              <div className="text-xs text-danger">{attachErr}</div>
            ) : null}
          </div>
        ) : null}

        {/* Step 3: channel file */}
        {step === 3 ? (
          <div className="space-y-3">
            <p className="text-[13px] leading-relaxed text-muted">
              Write{" "}
              <span className="font-mono text-text">channels/{service}.ts</span>{" "}
              wired to this app.
            </p>
            <Button
              disabled={writing || wrote}
              onClick={writeFile}
              variant={wrote ? "secondary" : "primary"}
            >
              {writing ? (
                <>
                  <Spinner /> Writing…
                </>
              ) : wrote ? (
                <>
                  <IconCheck className="h-3.5 w-3.5" /> Channel file ready
                </>
              ) : (
                "Add the channel file"
              )}
            </Button>
            {writeErr ? (
              <div className="text-xs text-danger">{writeErr}</div>
            ) : null}
          </div>
        ) : null}

        {/* Step 4: ship */}
        {step === 4 ? (
          <div className="space-y-3">
            <div className="rounded-lg bg-success/10 px-3 py-2 text-[13px] text-success">
              {cfg.label} is wired. Two things to finish:
            </div>
            <ol className="space-y-1.5 text-[13px] text-muted">
              <li>
                <strong className="text-text">Deploy</strong>: {cfg.label} only
                reaches the deployed agent.
              </li>
              <li>
                <strong className="text-text">Test</strong>: {cfg.test}
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
            <a
              className="inline-flex items-center gap-1 text-2xs text-accent hover:underline"
              href={cfg.manageUrl}
              rel="noreferrer"
              target="_blank"
            >
              <IconExternal className="h-3 w-3" /> Manage the app in Vercel
              Connect
            </a>
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
                (step === 1 && !connector) ||
                (step === 2 && !attached) ||
                (step === 3 && !wrote)
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
