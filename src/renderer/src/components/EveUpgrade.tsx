import type { EveUpgradeResult } from "@shared/ipc";
import { useRef, useState } from "react";
import { useCliRun } from "../lib/useCli";
import { useStore } from "../store";
import { Console } from "../ui/Console";
import { Badge, Button, Kicker, Modal } from "../ui/kit";

function rid(): string {
  return `up-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

/**
 * "↑ x.y.z available" modal: installs `eve@latest` in the agent (bumping
 * `@kybernesis/arcana` alongside when present), then runs `eve info` and
 * shows the resulting version + diagnostics.
 */
export function EveUpgradeModal({
  agentId,
  agentName,
  installed,
  latest,
  onClose,
}: {
  agentId: string;
  agentName: string;
  installed: string | null;
  latest: string;
  onClose: () => void;
}): JSX.Element {
  const refreshAgents = useStore((s) => s.refreshAgents);
  const loadStructure = useStore((s) => s.loadStructure);
  const { output, running, start } = useCliRun();
  const [result, setResult] = useState<EveUpgradeResult | null>(null);
  const [phase, setPhase] = useState<"idle" | "running" | "done">("idle");
  const resultRef = useRef<Promise<EveUpgradeResult> | null>(null);

  const upgrade = async (): Promise<void> => {
    setPhase("running");
    setResult(null);
    const runId = rid();
    await start(() => {
      // The invoke resolves only when the whole upgrade finishes; chunks
      // stream under `runId` meanwhile, so hand the id back immediately.
      resultRef.current = window.studio.agents.upgradeEve(agentId, runId);
      return Promise.resolve(runId);
    });
    const r = await (resultRef.current as Promise<EveUpgradeResult>);
    setResult(r);
    setPhase("done");
    if (r.ok) {
      await refreshAgents();
      void loadStructure(agentId, true, true);
    }
  };

  return (
    <Modal title="Upgrade eve" onClose={onClose} width="max-w-xl">
      <div className="space-y-3.5 p-4">
        <div className="flex items-center gap-2 text-[13px] text-text">
          <span className="font-mono">{agentName}</span>
          <Badge>eve {installed ?? "?"}</Badge>
          <span className="text-faint">→</span>
          <Badge tone="accent">eve {latest}</Badge>
        </div>

        {phase === "idle" ? (
          <>
            <p className="text-[13px] leading-relaxed text-muted">
              Installs <span className="font-mono text-text">eve@latest</span>{" "}
              in this agent's project with its own package manager (pnpm, yarn
              or npm, by lockfile). If the project depends on{" "}
              <span className="font-mono text-text">@kybernesis/arcana</span>{" "}
              it is bumped to latest in the same install. Then{" "}
              <span className="font-mono text-text">eve info</span> rebuilds the
              manifest and reports diagnostics, so you see straight away whether
              anything in <span className="font-mono text-text">agent/</span>{" "}
              needs attention after the version jump.
            </p>
            <div className="rounded-lg border border-border bg-subtle px-3 py-2.5 text-2xs leading-relaxed text-muted">
              eve 0.49 needs Node 24. Studio provisions a Node 24 runtime for the
              local dev server automatically; production runs on Vercel's Node.
              A running dev server is stopped first so the next Start boots the
              new version. Your source files are not modified — review the
              changelog at https://eve.dev/docs if the diagnostics flag an API
              change.
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={onClose}>
                Not now
              </Button>
              <Button variant="primary" onClick={upgrade}>
                Upgrade to {latest}
              </Button>
            </div>
          </>
        ) : (
          <>
            <Kicker>{running ? "Upgrading…" : "Upgrade log"}</Kicker>
            <Console
              text={output}
              busy={running}
              className="h-64"
              placeholder="Starting the package manager…"
            />
            {result ? (
              <div
                className={`rounded-lg px-3 py-2.5 text-[13px] leading-relaxed ${
                  result.ok
                    ? "bg-success/10 text-success"
                    : "bg-danger/10 text-danger"
                }`}
              >
                {result.ok ? (
                  <>
                    Now on <span className="font-mono">eve {result.version}</span>
                    {result.bumpedArcana ? " (and @kybernesis/arcana@latest)" : ""}
                    {result.diagnostics
                      ? ` · ${result.diagnostics.errors} errors, ${result.diagnostics.warnings} warnings`
                      : ""}
                    .
                    {result.diagnostics && result.diagnostics.errors > 0
                      ? " Review the Structure diagnostics before starting the agent."
                      : " Start the agent to run on the new version."}
                  </>
                ) : (
                  <>
                    Upgrade failed
                    {result.version ? ` (eve ${result.version} installed)` : ""}
                    : {result.error ?? "see the log above."}
                  </>
                )}
              </div>
            ) : null}
            <div className="flex justify-end gap-2 pt-1">
              <Button
                variant={result?.ok ? "primary" : "secondary"}
                onClick={onClose}
                disabled={running}
              >
                {running ? "Working…" : "Close"}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
