import type { RegistryInstallResult } from "@shared/ipc";
import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { Console } from "../ui/Console";
import { Badge, Button } from "../ui/kit";

/**
 * Drive one streamed `eve add` (or Arcana wire/migrate) run: output lines
 * arrive on `registry.onChunk` keyed by a runId this hook mints.
 */
export function useRegistryStream(): {
  output: string;
  running: boolean;
  run: <T>(launch: (runId: string) => Promise<T>) => Promise<T>;
  reset: () => void;
} {
  const [output, setOutput] = useState("");
  const [running, setRunning] = useState(false);
  const runIdRef = useRef<string | null>(null);

  useEffect(
    () =>
      window.studio.registry.onChunk(({ runId, data }) => {
        if (runId === runIdRef.current) {
          setOutput((o) => o + data);
        }
      }),
    [],
  );

  const run = useCallback(
    async <T,>(launch: (runId: string) => Promise<T>): Promise<T> => {
      const runId = `reg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      runIdRef.current = runId;
      setOutput("");
      setRunning(true);
      try {
        return await launch(runId);
      } finally {
        setRunning(false);
      }
    },
    [],
  );

  return {
    output,
    running,
    run,
    reset: () => {
      runIdRef.current = null;
      setOutput("");
      setRunning(false);
    },
  };
}

/** "Restart the dev server" affordance — a button when it's running, else a hint. */
export function RestartHint({
  agentId,
  what = "the change",
}: {
  agentId: string;
  what?: string;
}): JSX.Element {
  const status = useStore((s) => s.runtime[agentId]?.status);
  const [busy, setBusy] = useState(false);
  const restart = async (): Promise<void> => {
    setBusy(true);
    try {
      const s = await window.studio.agents.restart(agentId);
      useStore.setState((st) => ({ runtime: { ...st.runtime, [agentId]: s } }));
    } finally {
      setBusy(false);
    }
  };
  if (status === "running" || status === "starting") {
    return (
      <div className="flex items-center gap-2 text-[13px] text-muted">
        <span>Restart the dev server to load {what}.</span>
        <Button size="sm" variant="primary" onClick={restart} disabled={busy}>
          {busy ? "Restarting…" : "Restart"}
        </Button>
      </div>
    );
  }
  return (
    <div className="text-[13px] text-muted">
      Start the agent (or run{" "}
      <span className="font-mono text-text">eve dev</span>) to load {what}.
    </div>
  );
}

/** Outcome of a registry install: done / needs-input / failed, with next steps. */
export function InstallOutcome({
  agentId,
  result,
  what,
}: {
  agentId: string;
  result: RegistryInstallResult;
  what: string;
}): JSX.Element {
  if (result.status === "done") {
    return (
      <div className="space-y-2 rounded-lg bg-success/10 px-3 py-2.5 text-[13px] text-text">
        <div className="flex items-center gap-2">
          <Badge tone="success">installed</Badge>
          <span>{what} installed.</span>
        </div>
        {result.files && result.files.length > 0 ? (
          <div className="font-mono text-2xs leading-relaxed text-muted">
            {result.files.slice(0, 8).join(" · ")}
            {result.files.length > 8
              ? ` · +${result.files.length - 8} more`
              : ""}
          </div>
        ) : null}
        {result.envVars && result.envVars.length > 0 ? (
          <div className="text-2xs leading-relaxed text-muted">
            Added to <span className="font-mono text-text">.env.local</span> —
            fill in:{" "}
            {result.envVars.map((v) => (
              <span key={v} className="mr-1.5 font-mono text-text">
                {v}
              </span>
            ))}
            (Deploy → Environment pushes them to Vercel.)
          </div>
        ) : null}
        {result.deploymentRequired ? (
          <div className="text-2xs text-muted">
            Needs a deploy to take effect in production
            {result.nextCommand ? (
              <>
                {" "}
                —{" "}
                <span className="font-mono text-text">
                  {result.nextCommand}
                </span>
              </>
            ) : null}
            .
          </div>
        ) : null}
        <RestartHint agentId={agentId} what={what} />
      </div>
    );
  }
  if (result.status === "needs-input") {
    return (
      <div className="space-y-2 rounded-lg border border-warn/40 bg-warn/[0.06] px-3 py-2.5 text-[13px] text-text">
        <div className="flex items-center gap-2">
          <Badge tone="warn">needs input</Badge>
          <span>Setup needs an answer Studio can't guess.</span>
        </div>
        {result.message ? (
          <div className="text-2xs leading-relaxed text-muted">
            {result.message}
          </div>
        ) : null}
        {result.prerequisiteCommand ? (
          <div className="text-2xs text-muted">
            First:{" "}
            <span className="font-mono text-text">
              {result.prerequisiteCommand}
            </span>
          </div>
        ) : null}
        {result.nextCommand ? (
          <div className="text-2xs text-muted">
            Then finish in a terminal, in the agent folder:
            <pre className="mt-1 overflow-auto rounded bg-black/[0.04] px-2 py-1.5 font-mono text-2xs text-text">
              {result.nextCommand.replace(/\s--non-interactive\b/, "")}
            </pre>
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <div className="space-y-1.5 rounded-lg bg-danger/10 px-3 py-2.5 text-[13px] text-danger">
      <div className="flex items-center gap-2">
        <Badge tone="danger">failed</Badge>
        <span>
          {result.failureCode ? `${result.failureCode}: ` : ""}
          {result.message ?? `eve add exited ${result.exitCode ?? "?"}`}
        </span>
      </div>
      {result.failureCode === "dependency_install" ? (
        <div className="text-2xs leading-relaxed text-danger/80">
          The package's dependency install failed (often a peerDependencies
          range that predates this eve). eve rolled the change back. Try the
          command in a terminal to see npm's output, or install the package with{" "}
          <span className="font-mono">--legacy-peer-deps</span>.
        </div>
      ) : null}
    </div>
  );
}

/** Inline console for a streamed install. */
export function InstallConsole({
  output,
  running,
  className,
}: {
  output: string;
  running: boolean;
  className?: string;
}): JSX.Element {
  return (
    <Console
      text={output}
      busy={running}
      placeholder="eve add output appears here…"
      className={className ?? "h-56"}
    />
  );
}
