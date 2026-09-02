import { useState } from "react";
import { useStore } from "../store";
import { IconCheck, IconExternal, IconRocket } from "../ui/icons";
import { Button, Input, Modal, Spinner } from "../ui/kit";
import { ConnectorPicker } from "./ConnectorPicker";

/**
 * Guided, end-to-end Slack setup — the flow Studio was missing. Walks the user
 * through the four things that actually make Slack work: authorize the bot
 * (a team-level Vercel Connect client), route its events to THIS agent, write
 * the channel file, and (optionally) set a target for proactive messages.
 */
export function SlackSetup({
  agentId,
  initialConnector,
  onClose,
  onDone,
}: {
  agentId: string;
  /** Pre-selected connector UID when finishing setup for an existing channel. */
  initialConnector?: string;
  onClose: () => void;
  onDone: () => void;
}): JSX.Element {
  const setSection = useStore((s) => s.setSection);
  const [step, setStep] = useState(0);
  const [connector, setConnector] = useState(initialConnector ?? "");

  const [attaching, setAttaching] = useState(false);
  const [attached, setAttached] = useState(false);
  const [attachErr, setAttachErr] = useState<string | null>(null);

  const [writing, setWriting] = useState(false);
  const [wrote, setWrote] = useState(false);
  const [writeErr, setWriteErr] = useState<string | null>(null);

  const [targetId, setTargetId] = useState("");
  const [envName, setEnvName] = useState("SLACK_NUDGE_CHANNEL");
  const [savingTarget, setSavingTarget] = useState(false);
  const [savedTarget, setSavedTarget] = useState(false);
  const [targetErr, setTargetErr] = useState<string | null>(null);

  const attach = async (): Promise<void> => {
    setAttaching(true);
    setAttachErr(null);
    const r = await window.studio.vercel.connectorAttach(
      agentId,
      connector,
      "slack",
    );
    setAttaching(false);
    if (r.ok) {
      setAttached(true);
    } else {
      setAttachErr(
        r.output || "Attach failed — is the project linked to Vercel?",
      );
    }
  };

  const writeFile = async (): Promise<void> => {
    setWriting(true);
    setWriteErr(null);
    const r = await window.studio.agents.channelWrite(agentId, {
      kind: "slack",
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

  const saveTarget = async (): Promise<void> => {
    setSavingTarget(true);
    setTargetErr(null);
    const r = await window.studio.vercel.envSetAll(
      agentId,
      envName.trim(),
      targetId.trim(),
    );
    setSavingTarget(false);
    if (r.ok) {
      setSavedTarget(true);
    } else {
      setTargetErr(r.output || "Couldn't save the env var.");
    }
  };

  const STEPS = ["How it works", "Bot", "Connect", "Channel", "Target", "Ship"];

  return (
    <Modal onClose={onClose} title="Set up Slack" width="max-w-xl">
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

        {/* Step 0 — explainer */}
        {step === 0 ? (
          <div className="space-y-3">
            <p className="text-[13px] leading-relaxed text-muted">
              Slack talks to your agent through a <strong>bot</strong>. Setting
              it up is four steps:
            </p>
            <ul className="space-y-1.5 text-[13px] text-muted">
              <li>
                <strong className="text-text">1. Bot</strong> — a Vercel Connect
                “Slack client”, created once for your team and installed into
                your workspace. This is <em>who</em> messages come from.
              </li>
              <li>
                <strong className="text-text">2. Connect</strong> — route that
                bot’s events to <em>this</em> agent (per-agent).
              </li>
              <li>
                <strong className="text-text">3. Channel</strong> — the code
                file in the agent that uses the bot.
              </li>
              <li>
                <strong className="text-text">4. Target</strong> — a Slack
                channel/DM id, only needed if the agent should message you
                proactively (e.g. a scheduled reminder).
              </li>
            </ul>
            <p className="text-2xs text-faint">
              For @mentions and DMs, no target is needed — the agent just
              replies in the thread. Slack only reaches the <em>deployed</em>{" "}
              agent.
            </p>
          </div>
        ) : null}

        {/* Step 1 — bot */}
        {step === 1 ? (
          <div className="space-y-3">
            <div className="text-[13px] text-muted">
              Pick an existing Slack bot, or <strong>Create</strong> one, then{" "}
              <strong>Open to authorize</strong> — that installs the Eve app
              into your Slack workspace. Reuse one bot across agents, or give
              each its own.
            </div>
            <ConnectorPicker
              agentId={agentId}
              onChange={setConnector}
              service="slack"
              value={connector}
            />
          </div>
        ) : null}

        {/* Step 2 — attach */}
        {step === 2 ? (
          <div className="space-y-3">
            <p className="text-[13px] leading-relaxed text-muted">
              Route <span className="font-mono text-text">{connector}</span>’s
              Slack events to this agent (adds a trigger at{" "}
              <span className="font-mono text-text">/eve/v1/slack</span>).
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

        {/* Step 3 — channel file */}
        {step === 3 ? (
          <div className="space-y-3">
            <p className="text-[13px] leading-relaxed text-muted">
              Write{" "}
              <span className="font-mono text-text">
                agent/channels/slack.ts
              </span>{" "}
              wired to this bot.
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

        {/* Step 4 — target (optional) */}
        {step === 4 ? (
          <div className="space-y-3">
            <p className="text-[13px] leading-relaxed text-muted">
              <strong>Optional.</strong> For proactive messages (like a
              scheduled reminder), give a destination:
            </p>
            <ul className="space-y-1 text-2xs text-muted">
              <li>
                • DM to you: your Slack <strong>member ID</strong> (profile →
                “⋯” → “Copy member ID”, looks like{" "}
                <span className="font-mono">U012ABC</span>).
              </li>
              <li>
                • A channel: its <strong>channel ID</strong> (
                <span className="font-mono">C012ABC</span>, in the channel’s
                details) — and <strong>invite the bot</strong> to it.
              </li>
            </ul>
            <div className="flex gap-2">
              <Input
                className="flex-1 font-mono"
                onChange={(e) => setEnvName(e.target.value)}
                value={envName}
              />
              <Input
                className="flex-1 font-mono"
                onChange={(e) => setTargetId(e.target.value)}
                placeholder="U012ABC / C012ABC"
                value={targetId}
              />
            </div>
            <Button
              disabled={savingTarget || savedTarget || !targetId.trim()}
              onClick={saveTarget}
              size="sm"
              variant={savedTarget ? "secondary" : "primary"}
            >
              {savingTarget ? (
                <>
                  <Spinner /> Saving…
                </>
              ) : savedTarget ? (
                <>
                  <IconCheck className="h-3.5 w-3.5" /> Saved to Vercel
                </>
              ) : (
                "Save target"
              )}
            </Button>
            {targetErr ? (
              <div className="text-xs text-danger">{targetErr}</div>
            ) : null}
            <p className="text-2xs text-faint">
              Saved as a production env var. A schedule handler delivers to it
              via{" "}
              <span className="font-mono">
                to(slack, {"{"} channelId {"}"}).send(message, {"{"} auth:
                appAuth {"}"})
              </span>
              .
            </p>
          </div>
        ) : null}

        {/* Step 5 — ship */}
        {step === 5 ? (
          <div className="space-y-3">
            <div className="rounded-lg bg-success/10 px-3 py-2 text-[13px] text-success">
              Slack is wired. Two things to finish:
            </div>
            <ol className="space-y-1.5 text-[13px] text-muted">
              <li>
                <strong className="text-text">Deploy</strong> — Slack only
                reaches the deployed agent, never local dev.
              </li>
              <li>
                <strong className="text-text">Test</strong> — invite the bot to
                a channel and <span className="font-mono">@mention</span> it, or
                DM it. It replies in-thread.
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
              href="https://vercel.com/d?to=/%5Bteam%5D/~/connect"
              rel="noreferrer"
              target="_blank"
            >
              <IconExternal className="h-3 w-3" /> Manage the bot in Vercel
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
