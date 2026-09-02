import type { SandboxInfo } from "@shared/ipc";
import { useCallback, useEffect, useState } from "react";
import { useStore } from "../store";
import { IconServer } from "../ui/icons";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Spinner,
  ViewHeader,
} from "../ui/kit";

export function Sandbox(): JSX.Element {
  const id = useStore((s) => s.activeAgentId);
  const reloadStructure = useStore((s) => s.loadStructure);
  const [info, setInfo] = useState<SandboxInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) {
      return;
    }
    setLoading(true);
    try {
      setInfo(await window.studio.agents.sandboxRead(id));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (): Promise<void> => {
    if (!id) {
      return;
    }
    setBusy(true);
    await window.studio.agents.sandboxCreate(id);
    setBusy(false);
    await load();
    void reloadStructure(id, true);
  };

  if (loading && !info) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <ViewHeader kicker="Deploy" title="Sandbox" />
      <div className="flex-1 overflow-auto p-5">
        <div className="mx-auto max-w-3xl">
          {info?.exists ? (
            <Card>
              <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
                <IconServer className="h-4 w-4 text-faint" />
                <span className="font-mono text-[13px] text-text">
                  {info.relPath}
                </span>
                <Badge tone="success">configured</Badge>
              </div>
              <pre className="overflow-x-auto p-4 font-mono text-[12px] leading-relaxed text-muted">
                {info.content}
              </pre>
            </Card>
          ) : (
            <EmptyState
              icon={<IconServer className="h-6 w-6" />}
              kicker="Sandbox"
              title="Default sandbox"
              action={
                <Button
                  variant="primary"
                  size="sm"
                  onClick={create}
                  disabled={busy || !id}
                >
                  {busy ? "Creating…" : "Add sandbox.ts (Vercel backend)"}
                </Button>
              }
            >
              No sandbox is authored: the agent uses the framework default (a
              /workspace bash env, best available backend). Add a sandbox.ts to
              pick a backend, seed files, or lock down the network.
            </EmptyState>
          )}
        </div>
      </div>
    </div>
  );
}
