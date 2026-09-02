import { useEffect, useRef, useState } from "react";
import { useCliRun } from "../lib/useCli";
import { useStore } from "../store";
import { Console } from "../ui/Console";
import { IconFolder } from "../ui/icons";
import { Button, Field, Input, Kicker, Modal, cx } from "../ui/kit";

const NAME_RE = /^[a-z0-9][a-z0-9._-]*$/;

/** eve 0.49's own default for `eve init` when `--model` is omitted. */
const DEFAULT_MODEL = "openai/gpt-5.6-luna-fast";

/**
 * Curated AI Gateway ids offered at create time. The Model tab lists the full
 * gateway catalog once the agent is linked; this is just the fast path.
 */
const MODELS = [
  DEFAULT_MODEL,
  "anthropic/claude-opus-4.8",
  "anthropic/claude-sonnet-5",
  "anthropic/claude-fable-5",
  "openai/gpt-5.5",
  "openai/gpt-5.6-sol",
  "xai/grok-4.5",
  "google/gemini-3-pro-preview",
  "moonshotai/kimi-k3",
  "zai/glm-5.2",
];

export function CreateAgent({ onClose }: { onClose: () => void }): JSX.Element {
  const refreshAgents = useStore((s) => s.refreshAgents);
  const setActiveAgent = useStore((s) => s.setActiveAgent);

  const [parentDir, setParentDir] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [webChat, setWebChat] = useState(false);
  const [phase, setPhase] = useState<"form" | "running" | "done" | "error">(
    "form",
  );
  const [error, setError] = useState<string | null>(null);
  const { output, exitCode, start } = useCliRun();
  const finalized = useRef(false);

  const validName = NAME_RE.test(name);
  const validModel = /^[a-z0-9-]+\/[a-z0-9._-]+$/i.test(model.trim());

  const pickDir = async (): Promise<void> => {
    const dir = await window.studio.dialog.pickDir();
    if (dir) {
      setParentDir(dir);
    }
  };

  const create = async (): Promise<void> => {
    if (!parentDir || !validName || !validModel) {
      return;
    }
    setPhase("running");
    finalized.current = false;
    await start(() =>
      window.studio.agents.create({
        parentDir,
        name,
        webChat,
        model: model.trim(),
      }),
    );
  };

  // eve init can exit non-zero even on success, register by path, then trust it.
  useEffect(() => {
    if (phase !== "running" || exitCode === undefined || finalized.current) {
      return;
    }
    finalized.current = true;
    void (async () => {
      const dir = `${parentDir}/${name}`;
      const res = await window.studio.agents.register(dir);
      if (res.ok && res.agent) {
        await refreshAgents();
        await setActiveAgent(res.agent.id);
        setPhase("done");
        onClose();
      } else {
        const noProject = res.error?.includes("No package.json");
        setError(
          noProject
            ? "Couldn't scaffold the agent: setup didn't finish. Check the log below and make sure you're online: eve@latest (0.49+) and a Node 24 runtime download automatically on first use."
            : (res.error ??
                "Scaffolding finished but the agent could not be registered."),
        );
        setPhase("error");
      }
    })();
  }, [
    exitCode,
    phase,
    parentDir,
    name,
    refreshAgents,
    setActiveAgent,
    onClose,
  ]);

  return (
    <Modal title="Create a new agent" onClose={onClose} width="max-w-xl">
      {phase === "form" || phase === "error" ? (
        <div className="space-y-3.5 p-4">
          <Field label="Location" hint="parent folder for the new agent">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={pickDir}
                className="no-drag flex flex-1 items-center gap-2 rounded-lg border border-border bg-bg px-2.5 py-1.5 text-left text-[13px] text-muted hover:border-border-strong"
              >
                <IconFolder className="h-4 w-4 shrink-0 text-faint" />
                <span className="truncate">
                  {parentDir ?? "Choose a folder…"}
                </span>
              </button>
            </div>
          </Field>

          <Field label="Agent name" hint="lowercase, digits, . _ -">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-agent"
              className="font-mono"
            />
          </Field>

          <Field label="Model" hint="AI Gateway id: change later in Instructions → Model">
            <Input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={DEFAULT_MODEL}
              className="font-mono"
            />
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {MODELS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setModel(m)}
                  className={cx(
                    "rounded-md border px-2 py-0.5 font-mono text-2xs transition-colors",
                    model === m
                      ? "border-text bg-text text-white"
                      : "border-border text-muted hover:border-border-strong hover:text-text",
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
          </Field>

          <label className="flex items-center gap-2 text-[13px] text-muted">
            <input
              type="checkbox"
              checked={webChat}
              onChange={(e) => setWebChat(e.target.checked)}
              className="accent-accent"
            />
            Add a Web Chat app (Next.js)
          </label>

          {parentDir && validName ? (
            <div className="rounded-lg border border-border bg-subtle px-3 py-2.5">
              <Kicker className="mb-1.5">Command</Kicker>
              <div className="font-mono text-2xs text-muted">
                eve init {name} --model {model.trim() || DEFAULT_MODEL}
                {webChat ? " --channel-web-nextjs" : ""}
                <span className="text-faint"> · in {parentDir}</span>
              </div>
              <div className="mt-1 text-2xs text-faint">
                Installs eve@latest (0.49+); needs Node 24 (provisioned
                automatically when missing).
              </div>
            </div>
          ) : null}

          {phase === "error" && output ? (
            <div>
              <Kicker className="mb-1.5">eve init log</Kicker>
              <Console text={output} className="h-40" />
            </div>
          ) : null}

          {error ? <div className="text-xs text-danger">{error}</div> : null}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={create}
              disabled={!parentDir || !validName || !validModel}
            >
              Create agent
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3 p-4">
          <Kicker>Scaffolding</Kicker>
          <div className="text-[13px] text-muted">
            Creating <span className="font-mono text-text">{name}</span> and
            installing dependencies…
          </div>
          <Console
            text={output}
            busy={phase === "running"}
            className="h-64"
            placeholder="Starting eve init…"
          />
        </div>
      )}
    </Modal>
  );
}
