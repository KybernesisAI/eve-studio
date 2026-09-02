import { useCallback, useEffect, useState } from "react";
import { useCliRun } from "../lib/useCli";
import { useStore } from "../store";
import { Console } from "../ui/Console";
import { IconRefresh, IconRocket, IconTerminal, IconWrench } from "../ui/icons";
import { Badge, Button, IconButton, Kicker, ViewHeader } from "../ui/kit";

export function Deploy(): JSX.Element {
  const activeAgentId = useStore((s) => s.activeAgentId);
  const runtime = useStore((s) =>
    activeAgentId ? s.runtime[activeAgentId] : undefined,
  );
  const bumpDeploy = useStore((s) => s.bumpDeploy);
  const { output, running, exitCode, start, cancel } = useCliRun();
  const [devLogs, setDevLogs] = useState("");
  const [action, setAction] = useState<"build" | "deploy" | null>(null);

  // Refresh the header's deployed badge when a deploy finishes successfully.
  useEffect(() => {
    if (action === "deploy" && exitCode === 0) {
      bumpDeploy();
    }
  }, [exitCode, action, bumpDeploy]);

  const seedLogs = useCallback(async () => {
    if (activeAgentId) {
      setDevLogs(await window.studio.agents.logs(activeAgentId));
    }
  }, [activeAgentId]);

  useEffect(() => {
    void seedLogs();
    const off = window.studio.agents.onLog(({ agentId, data }) => {
      if (agentId === activeAgentId) {
        setDevLogs((l) => (l + data).slice(-20_000));
      }
    });
    return off;
  }, [activeAgentId, seedLogs]);

  const run = (kind: "build" | "deploy"): void => {
    if (!activeAgentId) {
      return;
    }
    setAction(kind);
    void start(() => window.studio.cli.run(activeAgentId, kind));
  };

  return (
    <div className="flex h-full flex-col">
      <ViewHeader
        kicker="Deploy"
        title="Deploy & Logs"
        right={
          running ? (
            <>
              <Badge tone="warn">running {action}…</Badge>
              <Button variant="secondary" size="sm" onClick={cancel}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              {exitCode !== undefined ? (
                <Badge tone={exitCode === 0 ? "success" : "danger"}>
                  {action} {exitCode === 0 ? "ok" : `exit ${exitCode}`}
                </Badge>
              ) : null}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => run("build")}
              >
                <IconWrench className="h-3.5 w-3.5" />
                Build
              </Button>
              <Button variant="primary" size="sm" onClick={() => run("deploy")}>
                <IconRocket className="h-3.5 w-3.5" />
                Deploy
              </Button>
            </>
          )
        }
      />

      <div className="grid min-h-0 flex-1 grid-rows-2 gap-3 p-4">
        <div className="flex min-h-0 flex-col">
          <Kicker className="mb-2 flex items-center gap-1.5">
            <IconTerminal className="h-3.5 w-3.5" />
            Command output
          </Kicker>
          <Console
            text={output}
            busy={running}
            placeholder="Run Build or Deploy to see output. Deploy runs `eve deploy --non-interactive --yes`. Link the project first (Environment tab, or `eve link` in a terminal)."
            className="min-h-0 flex-1"
          />
        </div>

        <div className="flex min-h-0 flex-col">
          <div className="mb-2 flex items-center justify-between">
            <Kicker className="flex items-center gap-1.5">
              <IconTerminal className="h-3.5 w-3.5" />
              Dev server logs
              {runtime?.status === "running" ? (
                <span className="text-success">· live</span>
              ) : null}
            </Kicker>
            <IconButton onClick={() => void seedLogs()} title="Refresh">
              <IconRefresh className="h-3.5 w-3.5" />
            </IconButton>
          </div>
          <Console
            text={devLogs}
            placeholder="Start the agent to stream its dev-server logs here."
            className="min-h-0 flex-1"
          />
        </div>
      </div>
    </div>
  );
}
