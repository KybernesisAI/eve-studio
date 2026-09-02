import type { ConnectorItem } from "@shared/ipc";
import { useCallback, useEffect, useState } from "react";
import { Console } from "../ui/Console";
import { IconExternal, IconPlus, IconRefresh } from "../ui/icons";
import { Badge, Button, IconButton, Input, Spinner } from "../ui/kit";

/**
 * Pick an existing Vercel Connect connector or create a new one, so the user
 * never has to paste a connector UID by hand.
 */
export function ConnectorPicker({
  agentId,
  service,
  value,
  onChange,
}: {
  agentId: string;
  /** Filter + create type (slack/github/linear). Omit to list all. */
  service?: string;
  value: string;
  onChange: (uid: string) => void;
}): JSX.Element {
  const [list, setList] = useState<ConnectorItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [output, setOutput] = useState("");

  const load = useCallback(async () => {
    setErr(null);
    const r = await window.studio.vercel.connectorList(agentId, service);
    if (r.ok) {
      setList(r.connectors);
      if (!value && r.connectors[0]) {
        onChange(r.connectors[0].uid);
      }
    } else {
      setErr(r.output ?? "Couldn't list connectors.");
      setList([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, service]);

  useEffect(() => {
    void load();
  }, [load]);

  // The CLI prints a single-use authorize URL then blocks on the browser step,
  // so stream its output, waiting for the command to return would only ever
  // surface a link whose code is already spent.
  useEffect(() => {
    return window.studio.vercel.onConnectorCreateChunk((c) => {
      if (c.id === agentId) {
        setOutput((o) => o + c.data);
      }
    });
  }, [agentId]);

  const create = async (): Promise<void> => {
    if (!service) {
      return;
    }
    setCreating(true);
    setOutput(
      `$ vercel connect create ${service} --name ${newName || "my-agent"} --triggers\n`,
    );
    const r = await window.studio.vercel.connectorCreateStream(
      agentId,
      service,
      newName || "my-agent",
      true,
    );
    setCreating(false);
    if (!r.ok) {
      setOutput((o) => (o.includes(r.output) ? o : `${o}\n${r.output}`));
    }
    await load();
  };

  if (list === null) {
    return (
      <div className="flex items-center gap-2 text-2xs text-muted">
        <Spinner className="h-3.5 w-3.5" /> Loading connectors…
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {err ? (
        <div className="rounded-lg border border-border bg-subtle p-2.5 text-2xs leading-relaxed text-muted">
          {err.includes("link") || err.includes("project")
            ? "Link the project to Vercel first (Environment tab)."
            : err}
        </div>
      ) : null}

      {list.length > 0 ? (
        <div className="flex items-center gap-1.5">
          <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="no-drag flex-1 rounded-lg border border-border bg-bg px-2.5 py-1.5 font-mono text-[13px] text-text transition-colors focus:border-border-strong"
          >
            {list.map((c) => (
              <option key={c.uid} value={c.uid}>
                {c.name} · {c.uid}
              </option>
            ))}
          </select>
          <IconButton onClick={() => void load()} title="Refresh">
            <IconRefresh className="h-3.5 w-3.5" />
          </IconButton>
        </div>
      ) : (
        <div className="font-spacemono text-[10px] uppercase tracking-[0.14em] text-faint">
          No connectors yet
        </div>
      )}

      {service ? (
        <div className="flex items-center gap-1.5">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={`new ${service} connector name`}
            className="flex-1 font-mono"
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={create}
            disabled={creating}
          >
            <IconPlus className="h-3.5 w-3.5" />
            {creating ? "Creating…" : "Create"}
          </Button>
        </div>
      ) : null}

      {output ? (
        <>
          {/^https?:\/\//m.test(output) ? (
            <div className="space-y-1.5 rounded-lg border border-accent/40 bg-accent/[0.05] p-3">
              <div className="font-medium text-[13px] text-foreground">
                {creating
                  ? "Authorize the bot to finish"
                  : "Authorization link (may have expired)"}
              </div>
              <div className="text-2xs leading-relaxed text-muted">
                Opens Slack in your browser. Pick the workspace and allow it.
                The link works once, so if it errors, hit Create again for a
                fresh one.
              </div>
              <a
                className="inline-flex items-center gap-1 text-2xs text-accent hover:underline"
                href={(output.match(/https?:\/\/\S+/) ?? [""])[0]}
                rel="noreferrer"
                target="_blank"
              >
                <IconExternal className="h-3 w-3" />
                Open to authorize
              </a>
            </div>
          ) : null}
          <Console text={output} busy={creating} className="max-h-40" />
        </>
      ) : null}

      {service ? (
        <div className="flex items-center gap-1.5 text-2xs text-faint">
          <Badge tone="accent">Vercel Connect</Badge>
          Credentials + webhook verification are managed for you: no tokens to
          store.
        </div>
      ) : null}
    </div>
  );
}
