import type { ConnectorItem, ConnectorUsage } from "@shared/ipc";
import { useCallback, useEffect, useState } from "react";
import { Console } from "../ui/Console";
import { IconChevronDown, IconExternal, IconRefresh } from "../ui/icons";
import {
  Badge,
  Button,
  Field,
  IconButton,
  Input,
  Kicker,
  Modal,
  Spinner,
  cx,
} from "../ui/kit";

const CHANNEL_TYPES = new Set(["slack", "github", "linear"]);
const MCP_URL: Record<string, string> = {
  linear: "https://mcp.linear.app/mcp",
};

function UseConnectorModal({
  agentId,
  connector,
  onClose,
}: {
  agentId: string;
  connector: ConnectorItem;
  onClose: () => void;
}): JSX.Element {
  const canChannel = CHANNEL_TYPES.has(connector.type);
  const [mode, setMode] = useState<"channel" | "connection">(
    canChannel ? "channel" : "connection",
  );
  const [connName, setConnName] = useState(connector.type);
  const [url, setUrl] = useState(MCP_URL[connector.type] ?? "");
  const [scope, setScope] = useState<"connect-app" | "connect-user">(
    "connect-app",
  );
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ what: string; channel?: boolean } | null>(
    null,
  );
  const [attaching, setAttaching] = useState(false);
  const [attachOut, setAttachOut] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const addChannel = async (): Promise<void> => {
    setBusy(true);
    setErr(null);
    const r = await window.studio.agents.channelWrite(agentId, {
      kind: connector.type as "slack" | "github" | "linear",
      connector: connector.uid,
    });
    setBusy(false);
    if (r.ok) {
      setDone({
        what: r.relPath ?? `channels/${connector.type}.ts`,
        channel: true,
      });
    } else {
      setErr(r.error ?? "Failed.");
    }
  };

  const attach = async (): Promise<void> => {
    setAttaching(true);
    setAttachOut(
      `$ vercel connect attach ${connector.uid} --triggers --trigger-path /eve/v1/${connector.type}\n`,
    );
    const r = await window.studio.vercel.connectorAttach(
      agentId,
      connector.uid,
      connector.type,
    );
    setAttaching(false);
    setAttachOut((o) => o + r.output);
  };

  const addConnection = async (): Promise<void> => {
    setBusy(true);
    setErr(null);
    const r = await window.studio.agents.addConnection(agentId, {
      name: connName,
      kind: "mcp",
      url,
      description: `${connector.name}, via Vercel Connect (${connector.uid})`,
      authMode: scope,
      connector: connector.uid,
    });
    setBusy(false);
    if (r.ok) {
      setDone({ what: r.relPath ?? "connection" });
    } else {
      setErr(r.error ?? "Failed.");
    }
  };

  return (
    <Modal
      title={`Use ${connector.name} in the agent`}
      onClose={onClose}
      width="max-w-xl"
    >
      {done ? (
        <div className="space-y-3 p-4">
          <div className="rounded-lg bg-success/10 px-3 py-2 text-[13px] text-success">
            Wrote <span className="font-mono">{done.what}</span>.
          </div>
          {done.channel ? (
            <div className="space-y-2">
              <p className="text-2xs leading-relaxed text-muted">
                Attach the connector so the platform delivers events to
                <span className="font-mono"> /eve/v1/{connector.type}</span>,
                then deploy.
              </p>
              <Button
                variant="secondary"
                size="sm"
                onClick={attach}
                disabled={attaching}
              >
                {attaching ? "Attaching…" : "Attach for triggers"}
              </Button>
              {attachOut ? (
                <Console
                  text={attachOut}
                  busy={attaching}
                  className="max-h-40"
                />
              ) : null}
            </div>
          ) : (
            <p className="text-2xs leading-relaxed text-muted">
              Restart the agent to load the connection.
            </p>
          )}
          <div className="flex justify-end">
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3 p-4">
          <div className="flex items-center gap-2 text-2xs text-muted">
            <Badge tone="accent">{connector.type}</Badge>
            <span className="font-mono">{connector.uid}</span>
          </div>

          <div className="rounded-lg border border-border bg-subtle p-3 text-2xs leading-relaxed text-muted">
            You already attached this connector to the project in Vercel. That
            grants permission to mint tokens. This step writes the{" "}
            <b className="text-text">agent code</b> that actually uses it: as a{" "}
            <b className="text-text">connection</b> (the agent gets this
            provider's tools) or a <b className="text-text">channel</b> (the
            agent talks where its events arrive).
          </div>

          {canChannel ? (
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => setMode("channel")}
                className={`rounded-lg border px-2.5 py-1 text-2xs ${mode === "channel" ? "border-text bg-text text-white" : "border-border text-muted hover:bg-hover"}`}
              >
                As a channel
              </button>
              <button
                type="button"
                onClick={() => setMode("connection")}
                className={`rounded-lg border px-2.5 py-1 text-2xs ${mode === "connection" ? "border-text bg-text text-white" : "border-border text-muted hover:bg-hover"}`}
              >
                As a connection
              </button>
            </div>
          ) : null}

          {mode === "channel" && canChannel ? (
            <>
              <p className="text-2xs leading-relaxed text-muted">
                Adds{" "}
                <span className="font-mono">channels/{connector.type}.ts</span>{" "}
                wired to this connector: the agent replies where{" "}
                {connector.type} events arrive.
              </p>
              {err ? <div className="text-xs text-danger">{err}</div> : null}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={onClose}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={addChannel} disabled={busy}>
                  {busy ? "Adding…" : `Add ${connector.type} channel`}
                </Button>
              </div>
            </>
          ) : (
            <>
              {canChannel ? (
                <div className="rounded-lg border border-warn/40 bg-warn/[0.06] p-2.5 text-2xs leading-relaxed text-muted">
                  Heads up:{" "}
                  <span className="font-mono text-text">{connector.uid}</span>{" "}
                  is the <b className="text-text">managed {connector.type}</b>{" "}
                  connector, built for the {connector.type}{" "}
                  <b className="text-text">channel</b>. For MCP{" "}
                  <b className="text-text">tools</b> you usually need a separate{" "}
                  <b className="text-text">Custom OAuth</b> connector for the
                  provider's MCP host (e.g.{" "}
                  <span className="font-mono">mcp.linear.app</span>). If tools
                  return "authorization required", that's why. Create that
                  connector in Vercel Connect and use it here instead.
                </div>
              ) : null}
              <Field
                label="Connection name"
                hint="becomes connections/<name>.ts"
              >
                <Input
                  value={connName}
                  onChange={(e) => setConnName(e.target.value)}
                  className="font-mono"
                />
              </Field>
              <Field label="MCP URL">
                <Input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://mcp.example.com/mcp"
                  className="font-mono"
                />
              </Field>
              <Field label="Scope">
                <div className="flex gap-1.5">
                  {(["connect-app", "connect-user"] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setScope(s)}
                      className={`rounded-lg border px-2.5 py-1 text-2xs ${scope === s ? "border-text bg-text text-white" : "border-border text-muted hover:bg-hover"}`}
                    >
                      {s === "connect-app" ? "App (bot)" : "User (per-caller)"}
                    </button>
                  ))}
                </div>
              </Field>
              {err ? <div className="text-xs text-danger">{err}</div> : null}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={onClose}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  onClick={addConnection}
                  disabled={busy || !connName || !url}
                >
                  {busy ? "Adding…" : "Add connection"}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

const TYPE_COLOR: Record<string, string> = {
  slack: "#611f69",
  github: "#24292f",
  linear: "#5E6AD2",
  discord: "#5865F2",
  notion: "#000000",
  figma: "#a259ff",
  mcp: "#0070f3",
  oauth: "#0070f3",
};
function color(type: string): string {
  return TYPE_COLOR[type] ?? "#888888";
}

function Logo({ name, type }: { name: string; type: string }): JSX.Element {
  return (
    <div
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[13px] font-semibold text-white"
      style={{ background: color(type) }}
    >
      {(name || type || "?")[0]?.toUpperCase()}
    </div>
  );
}

function ConnectorRow({
  agentId,
  c,
  used,
  attached,
  onUse,
}: {
  agentId: string;
  c: ConnectorItem;
  used: ConnectorUsage[];
  attached: boolean;
  onUse: () => void;
}): JSX.Element {
  const asConnection = used.some((u) => u.kind === "connection");
  const asChannel = used.some((u) => u.kind === "channel");
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/70 px-3 py-3 transition-colors hover:border-border-strong hover:bg-black/[0.02]">
      <Logo name={c.name} type={c.type} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate text-[13px] font-medium text-text">
            {c.name}
          </span>
          <Badge tone="accent">{c.type}</Badge>
          {asConnection ? <Badge tone="success">✓ connection</Badge> : null}
          {asChannel ? <Badge tone="success">✓ channel</Badge> : null}
          {attached && !asConnection && !asChannel ? (
            <Badge tone="info">attached to project</Badge>
          ) : null}
        </div>
        <div className="mt-0.5 truncate font-mono text-2xs text-faint">
          {c.uid}
        </div>
      </div>
      <IconButton
        onClick={() => window.studio.vercel.openConnectorPage(agentId, c.uid)}
        title="Open in Vercel (authorize / manage)"
      >
        <IconExternal className="h-3.5 w-3.5" />
      </IconButton>
      <Button variant="secondary" size="sm" onClick={onUse}>
        {used.length > 0 ? "Manage" : "Use in agent"}
      </Button>
    </div>
  );
}

/**
 * Vercel Connect connectors, split into the ones this agent actually uses
 * (referenced by its channel/connection files, or attached to its Vercel
 * project) and the rest of the team's connectors, collapsed.
 */
export function ConnectorsGallery({
  agentId,
}: {
  agentId: string;
}): JSX.Element {
  const [list, setList] = useState<ConnectorItem[] | null>(null);
  const [usage, setUsage] = useState<ConnectorUsage[]>([]);
  const [attached, setAttached] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [use, setUse] = useState<ConnectorItem | null>(null);
  const [othersOpen, setOthersOpen] = useState(false);

  const refreshUsage = useCallback(async () => {
    const uids = (list ?? []).map((c) => c.uid);
    setUsage(await window.studio.agents.connectorUsage(agentId, uids));
  }, [agentId, list]);

  const load = useCallback(async () => {
    setErr(null);
    const r = await window.studio.vercel.connectorList(agentId);
    const connectors = r.ok ? r.connectors : [];
    if (!r.ok) {
      setErr(r.output ?? "Couldn't list connectors.");
    }
    setList(connectors);
    const [u, a] = await Promise.all([
      window.studio.agents.connectorUsage(
        agentId,
        connectors.map((c) => c.uid),
      ),
      window.studio.registry
        .connectorsAttached(agentId)
        .catch(() => ({ projectId: null, attached: [] as string[] })),
    ]);
    setUsage(u);
    setAttached(new Set(a.attached));
  }, [agentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const openGallery = async (external: boolean): Promise<void> => {
    setOpening(true);
    const r = external
      ? await window.studio.vercel.openConnectExternal(agentId)
      : await window.studio.vercel.openConnect(agentId);
    setOpening(false);
    if (!r.ok) {
      setErr(r.error ?? "Couldn't open Vercel Connect.");
    } else {
      // give the user a moment to add one, then refresh on next focus
      setTimeout(() => void load(), 4000);
    }
  };

  const usedBy = (uid: string): ConnectorUsage[] =>
    usage.filter((u) => u.uid === uid);
  const isMine = (c: ConnectorItem): boolean =>
    usedBy(c.uid).length > 0 || attached.has(c.uid);
  const mine = (list ?? []).filter(isMine);
  const others = (list ?? []).filter((c) => !isMine(c));

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <Kicker className="mb-1.5">Vercel Connect</Kicker>
          <div className="text-[13px] leading-relaxed text-muted">
            Managed OAuth &amp; API-key connectors. "Attached" = referenced by
            this agent's channel/connection files or attached to its Vercel
            project.
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="primary"
            size="sm"
            onClick={() => openGallery(true)}
            disabled={opening}
          >
            <IconExternal className="h-3.5 w-3.5" />
            {opening ? "Opening…" : "Add connector"}
          </Button>
          <IconButton onClick={() => void load()} title="Refresh">
            <IconRefresh className="h-3.5 w-3.5" />
          </IconButton>
        </div>
      </div>

      {list === null ? (
        <div className="flex items-center gap-2 px-3 py-4 text-2xs text-muted">
          <Spinner className="h-3.5 w-3.5" /> Loading connectors…
        </div>
      ) : err ? (
        <div className="rounded-lg border border-border bg-subtle px-3 py-3 text-2xs leading-relaxed text-muted">
          {err.toLowerCase().includes("link") ||
          err.toLowerCase().includes("project")
            ? "Link this project to Vercel first (Environment tab), then reload."
            : err.toLowerCase().includes("enoent")
              ? "The Vercel CLI isn't installed. Install it: npm i -g vercel"
              : err}
        </div>
      ) : list.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
          <div className="max-w-sm text-[13px] leading-relaxed text-muted">
            No connectors yet. Browse the full provider catalog (Slack, GitHub,
            Notion, Figma, Shopify, and hundreds more) and add one.
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={() => openGallery(true)}
            disabled={opening}
          >
            <IconExternal className="h-3.5 w-3.5" />
            Add connector
          </Button>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            <div className="font-spacemono text-[10px] uppercase tracking-[0.14em] text-faint">
              Attached to this agent
              <span className="ml-1.5 font-mono normal-case tracking-normal">
                {mine.length}
              </span>
            </div>
            {mine.length === 0 ? (
              <div className="rounded-lg border border-border bg-subtle px-3 py-3 text-2xs leading-relaxed text-muted">
                None yet. Pick one of your team's connectors below and "Use in
                agent", or add a new one.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {mine.map((c) => (
                  <ConnectorRow
                    key={c.uid}
                    agentId={agentId}
                    c={c}
                    used={usedBy(c.uid)}
                    attached={attached.has(c.uid)}
                    onUse={() => setUse(c)}
                  />
                ))}
              </div>
            )}
          </div>

          {others.length > 0 ? (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setOthersOpen((v) => !v)}
                className="flex w-full items-center gap-1.5 text-left font-spacemono text-[10px] uppercase tracking-[0.14em] text-faint transition-colors hover:text-text"
              >
                <IconChevronDown
                  className={cx(
                    "h-3.5 w-3.5 transition-transform",
                    !othersOpen && "-rotate-90",
                  )}
                />
                Other connectors on your team ({others.length})
              </button>
              {othersOpen ? (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {others.map((c) => (
                    <ConnectorRow
                      key={c.uid}
                      agentId={agentId}
                      c={c}
                      used={[]}
                      attached={false}
                      onUse={() => setUse(c)}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      )}

      {use ? (
        <UseConnectorModal
          agentId={agentId}
          connector={use}
          onClose={() => {
            setUse(null);
            void refreshUsage();
            void load();
          }}
        />
      ) : null}
    </div>
  );
}
