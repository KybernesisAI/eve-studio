import type {
  ArcanaStats,
  DetectedBrain,
  MemorySlot,
  MigrateBrainResult,
  QueryHit,
  RegistryInstallResult,
  TimelineEvent,
  WireBrainResult,
} from "@shared/ipc";
import { useCallback, useEffect, useState } from "react";
import {
  InstallConsole,
  InstallOutcome,
  RestartHint,
  useRegistryStream,
} from "../components/RegistryInstall";
import { useStore } from "../store";
import {
  IconBrain,
  IconChevronDown,
  IconExternal,
  IconLayers,
  IconPlus,
  IconRefresh,
  IconSearch,
} from "../ui/icons";
import {
  Badge,
  Button,
  Card,
  Field,
  IconButton,
  Input,
  Kicker,
  List,
  ListRow,
  Modal,
  Spinner,
  StatusDot,
  ViewHeader,
  cx,
} from "../ui/kit";

const ARCANA_DOCS = "https://eve.dev/integrations/arcana";
const ARCANA_SITE = "https://arcana.kybernesis.ai";
const STATE_DOCS = "https://eve.dev/docs/concepts/state";
const MEMORY_DOCS = "https://eve.dev/docs/memory/overview";

function ExtLink({
  href,
  children,
}: {
  href: string;
  children: string;
}): JSX.Element {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-text underline decoration-border underline-offset-2 hover:decoration-text"
    >
      {children}
      <IconExternal className="h-3 w-3" />
    </a>
  );
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) {
    return "";
  }
  const s = Math.floor((Date.now() - then) / 1000);
  if (s < 60) {
    return "just now";
  }
  const m = Math.floor(s / 60);
  if (m < 60) {
    return `${m}m ago`;
  }
  const h = Math.floor(m / 60);
  if (h < 24) {
    return `${h}h ago`;
  }
  return `${Math.floor(h / 24)}d ago`;
}

// ------------------------------------------------------------ (a) session memory

const NATIVE = [
  {
    title: "Durable sessions + compaction",
    body: "Every conversation persists and auto-summarizes as it approaches the context limit: nothing to author or configure.",
  },
  {
    title: "defineState",
    body: "Durable per-session state that survives steps, crashes and redeploys: the agent's own working memory for a session lineage.",
  },
  {
    title: "todo",
    body: "A built-in durable working list the agent uses to track multi-step tasks.",
  },
  {
    title: "Sandbox /workspace",
    body: "A filesystem the agent can read and write during a run.",
  },
];

function SessionMemory(): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <section>
      <Card className="px-4 py-2.5">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
          >
            <Badge tone="success">built in</Badge>
            <span className="shrink-0 text-[13px] text-text">
              Session memory:
            </span>
            <span className="truncate text-[13px] text-muted">
              durable sessions + compaction · defineState · todo · sandbox
              workspace
            </span>
            <IconChevronDown
              className={cx(
                "ml-auto h-4 w-4 shrink-0 text-faint transition-transform",
                open && "rotate-180",
              )}
            />
          </button>
          <ExtLink href={STATE_DOCS}>learn more</ExtLink>
        </div>
        {open ? (
          <div className="mt-2 border-t border-border">
            <List>
              {NATIVE.map((n) => (
                <ListRow key={n.title} title={n.title} desc={n.body} />
              ))}
            </List>
            <div className="border-t border-border px-1 py-3 text-[13px] leading-relaxed text-muted">
              Session memory dies with the session. What bridges sessions is a{" "}
              <b className="text-text">memory slot</b> (below) or a long-term
              brain.
            </div>
          </div>
        ) : null}
      </Card>
    </section>
  );
}

// ------------------------------------------------------------ (b) memory slots

const PROVIDER_LABEL: Record<MemorySlot["provider"], string> = {
  file: "fileMemory · built in",
  supermemory: "@supermemory/eve",
  custom: "custom provider",
  unknown: "provider unknown",
};

function AddFileMemoryModal({
  agentId,
  onClose,
  onDone,
}: {
  agentId: string;
  onClose: () => void;
  onDone: () => void;
}): JSX.Element {
  const [slot, setSlot] = useState("profile");
  const [description, setDescription] = useState(
    "Remember stable facts and preferences about the caller.",
  );
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    setBusy(true);
    setErr(null);
    const r = await window.studio.memory.addFile(agentId, slot, description);
    setBusy(false);
    if (r.ok) {
      setDone(r.relPath ?? "memory slot");
      onDone();
    } else {
      setErr(r.error ?? "Failed.");
    }
  };

  return (
    <Modal title="Add file memory" onClose={onClose} width="max-w-xl">
      {done ? (
        <div className="space-y-3 p-4">
          <div className="rounded-lg bg-success/10 px-3 py-2 text-[13px] text-success">
            Wrote <span className="font-mono">{done}</span>.
          </div>
          <p className="text-2xs leading-relaxed text-muted">
            Eve's built-in provider: shared local storage under{" "}
            <span className="font-mono text-text">eve dev</span>, Vercel Blob
            when deployed. Tools surface as{" "}
            <span className="font-mono text-text">{slot}__save_memory</span> /{" "}
            <span className="font-mono text-text">{slot}__remove_memory</span>,
            scoped per authenticated principal.
          </p>
          <RestartHint agentId={agentId} what="the memory slot" />
          <div className="flex justify-end">
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3 p-4">
          <Field label="Slot" hint="becomes agent/memory/<slot>.ts">
            <Input
              value={slot}
              onChange={(e) => setSlot(e.target.value)}
              placeholder="profile"
              className="font-mono"
            />
          </Field>
          <Field
            label="Description"
            hint="prepended to every provider tool description"
          >
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <p className="text-2xs leading-relaxed text-muted">
            <span className="font-mono text-text">defineMemory</span> with{" "}
            <span className="font-mono text-text">fileMemory()</span> and{" "}
            <span className="font-mono text-text">byPrincipal</span> scope.{" "}
            <ExtLink href={MEMORY_DOCS}>eve.dev/docs/memory</ExtLink>
          </p>
          {err ? <div className="text-xs text-danger">{err}</div> : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={submit}
              disabled={busy || !slot.trim()}
            >
              {busy ? "Writing…" : "Add slot"}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function AddSupermemoryModal({
  agentId,
  onClose,
  onDone,
}: {
  agentId: string;
  onClose: () => void;
  onDone: () => void;
}): JSX.Element {
  const { output, running, run } = useRegistryStream();
  const [result, setResult] = useState<RegistryInstallResult | null>(null);

  const install = async (): Promise<void> => {
    setResult(null);
    const r = await run((runId) =>
      window.studio.memory.addSupermemory(agentId, runId),
    );
    setResult(r);
    if (r.status !== "failed") {
      onDone();
    }
  };

  return (
    <Modal title="Add Supermemory" onClose={onClose} width="max-w-2xl">
      <div className="space-y-3 p-4">
        <p className="text-[13px] leading-relaxed text-muted">
          Installs <span className="font-mono text-text">@supermemory/eve</span>{" "}
          and writes a <span className="font-mono text-text">supermemory</span>{" "}
          slot (semantic search over stored memories, automatic capture after
          each turn). Set{" "}
          <span className="font-mono text-text">SUPERMEMORY_API_KEY</span> in
          the agent's environment afterwards.
        </p>
        <div className="rounded-lg border border-border bg-subtle px-3 py-2 font-mono text-2xs text-muted">
          $ eve add memory/supermemory --non-interactive --yes
        </div>
        {output || running ? (
          <InstallConsole output={output} running={running} />
        ) : null}
        {result ? (
          <InstallOutcome
            agentId={agentId}
            result={result}
            what="Supermemory"
          />
        ) : null}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose} disabled={running}>
            {result ? "Close" : "Cancel"}
          </Button>
          {!result || result.status === "failed" ? (
            <Button variant="primary" onClick={install} disabled={running}>
              {running ? "Installing…" : result ? "Retry" : "Install"}
            </Button>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}

function MemorySlots({ agentId }: { agentId: string }): JSX.Element {
  const [slots, setSlots] = useState<MemorySlot[] | null>(null);
  const [adding, setAdding] = useState<null | "file" | "supermemory">(null);
  const loadStructure = useStore((s) => s.loadStructure);

  const refresh = useCallback(async () => {
    const r = await window.studio.memory.slots(agentId);
    setSlots(r.slots);
  }, [agentId]);

  useEffect(() => {
    setSlots(null);
    void refresh();
  }, [refresh]);

  const changed = (): void => {
    void refresh();
    void loadStructure(agentId, true, true);
  };

  return (
    <section className="space-y-2.5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Kicker>Memory slots</Kicker>
            <Badge>defineMemory</Badge>
          </div>
          <div className="mt-1.5 text-[13px] leading-relaxed text-muted">
            Eve owns the slot (
            <span className="font-mono">agent/memory/&lt;slot&gt;.ts</span>,
            scope, tools); a provider owns storage and recall.{" "}
            <ExtLink href={MEMORY_DOCS}>docs</ExtLink>
          </div>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setAdding("file")}
          >
            <IconPlus className="h-3.5 w-3.5" />
            Add file memory
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setAdding("supermemory")}
          >
            <IconPlus className="h-3.5 w-3.5" />
            Add Supermemory
          </Button>
        </div>
      </div>
      <Card>
        {slots === null ? (
          <div className="flex items-center gap-2 px-4 py-4 text-sm text-muted">
            <Spinner /> Reading slots…
          </div>
        ) : slots.length === 0 ? (
          <div className="px-4 py-5 text-[13px] leading-relaxed text-muted">
            No memory slots yet. Add the built-in file provider for a per-user
            "profile" slot, or install Supermemory.
          </div>
        ) : (
          <List>
            {slots.map((s) => (
              <ListRow
                key={s.slot}
                icon={<IconLayers className="h-4 w-4" />}
                title={s.slot}
                badge={
                  <Badge
                    tone={
                      s.provider === "file"
                        ? "success"
                        : s.provider === "supermemory"
                          ? "violet"
                          : "default"
                    }
                  >
                    {PROVIDER_LABEL[s.provider]}
                  </Badge>
                }
                desc={s.description || undefined}
                meta={
                  <div className="flex items-center gap-2 font-mono text-2xs text-faint">
                    <span>{s.relPath}</span>
                    {s.visibility ? (
                      <span>· visibility {s.visibility}</span>
                    ) : null}
                    <span>· tools {s.slot}__*</span>
                  </div>
                }
              />
            ))}
          </List>
        )}
      </Card>
      {adding === "file" ? (
        <AddFileMemoryModal
          agentId={agentId}
          onClose={() => setAdding(null)}
          onDone={changed}
        />
      ) : null}
      {adding === "supermemory" ? (
        <AddSupermemoryModal
          agentId={agentId}
          onClose={() => setAdding(null)}
          onDone={changed}
        />
      ) : null}
    </section>
  );
}

// ------------------------------------------------------------ (c) Arcana brain

function Stat({ label, value }: { label: string; value: number }): JSX.Element {
  return (
    <Card className="px-4 py-3">
      <div className="text-2xl font-semibold tracking-tight text-text">
        {value.toLocaleString()}
      </div>
      <div className="mt-1 font-spacemono text-[10px] uppercase tracking-[0.14em] text-faint">
        {label}
      </div>
    </Card>
  );
}

function Browse({ agentId }: { agentId: string }): JSX.Element {
  const [stats, setStats] = useState<ArcanaStats | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<QueryHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    const [s, t] = await Promise.all([
      window.studio.arcana.stats(agentId),
      window.studio.arcana.timeline(agentId, 40),
    ]);
    if (s.ok && s.data) {
      setStats(s.data);
    } else {
      setErr(s.error ?? "Failed to load stats.");
    }
    if (t.ok && t.data) {
      setTimeline(t.data);
    }
  }, [agentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const runQuery = async (): Promise<void> => {
    const query = q.trim();
    if (!query) {
      return;
    }
    setBusy(true);
    setErr(null);
    const r = await window.studio.arcana.query(agentId, query);
    setBusy(false);
    if (r.ok && r.data) {
      setHits(r.data);
    } else {
      setErr(r.error ?? "Query failed.");
    }
  };

  return (
    <div className="space-y-5">
      {err ? (
        <div className="rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">
          {err}
        </div>
      ) : null}

      {stats ? (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <Stat label="events" value={stats.timeline.total_events} />
          <Stat label="entities" value={stats.entityGraph.total_entities} />
          <Stat label="mentions" value={stats.entityGraph.total_mentions} />
          <Stat label="relations" value={stats.entityGraph.total_relations} />
        </div>
      ) : null}

      <div className="flex items-center gap-2 rounded-xl border border-border bg-panel px-3 py-2">
        <IconSearch className="h-4 w-4 text-faint" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              void runQuery();
            }
          }}
          placeholder="Ask the brain: hybrid semantic + graph search…"
          className="no-drag flex-1 bg-transparent text-[13px] text-text outline-none placeholder:text-faint"
        />
        <Button
          size="sm"
          variant="primary"
          onClick={() => void runQuery()}
          disabled={busy || !q.trim()}
        >
          {busy ? "…" : "Search"}
        </Button>
      </div>

      {hits ? (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <Kicker>
              {hits.length} result{hits.length === 1 ? "" : "s"}
            </Kicker>
            <button
              type="button"
              onClick={() => setHits(null)}
              className="font-spacemono text-[10px] uppercase tracking-[0.14em] text-faint transition-colors hover:text-text"
            >
              back to timeline
            </button>
          </div>
          {hits.map((h) => (
            <Card key={h.id} className="p-3">
              <div className="flex items-center gap-2">
                <Badge>{h.type}</Badge>
                <span className="font-spacemono text-[10px] uppercase tracking-[0.14em] text-faint">
                  {timeAgo(h.timestamp)}
                </span>
                {typeof h.hybridScore === "number" ? (
                  <span className="ml-auto font-mono text-2xs text-faint">
                    {h.hybridScore.toFixed(3)}
                  </span>
                ) : null}
              </div>
              {h.title && h.title !== "Untitled" ? (
                <div className="mt-1.5 text-[13px] text-text">{h.title}</div>
              ) : null}
              {h.content ? (
                <div className="mt-1 line-clamp-3 text-xs leading-snug text-muted">
                  {h.content}
                </div>
              ) : null}
            </Card>
          ))}
        </div>
      ) : (
        <div className="space-y-2.5">
          <Kicker>Recent timeline</Kicker>
          {timeline.map((e) => (
            <Card key={String(e.id)} className="p-3">
              <div className="flex items-center gap-2">
                <Badge>{e.type}</Badge>
                <span className="font-spacemono text-[10px] uppercase tracking-[0.14em] text-faint">
                  {timeAgo(e.timestamp)}
                </span>
              </div>
              <div className="mt-1.5 text-[13px] leading-snug text-text">
                {e.title}
              </div>
              {e.entities && e.entities.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {e.entities.slice(0, 8).map((ent) => (
                    <span
                      key={ent}
                      className="rounded bg-black/[0.04] px-1.5 py-0.5 font-mono text-2xs text-muted"
                    >
                      {ent}
                    </span>
                  ))}
                </div>
              ) : null}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/** Result panel after wiring (or migrating). */
function WireOutcome({
  agentId,
  result,
}: {
  agentId: string;
  result: WireBrainResult;
}): JSX.Element {
  if (!result.ok) {
    return (
      <div className="rounded-lg bg-danger/10 px-3 py-2.5 text-[13px] text-danger">
        {result.error ?? "Wiring failed."}
      </div>
    );
  }
  return (
    <div className="space-y-2 rounded-lg bg-success/10 px-3 py-2.5 text-[13px] text-text">
      <div className="flex items-center gap-2">
        <Badge tone="success">wired</Badge>
        <span>Arcana extension mounted.</span>
      </div>
      {result.files.length > 0 ? (
        <div className="font-mono text-2xs leading-relaxed text-muted">
          {result.files.join(" · ")}
        </div>
      ) : null}
      <div className="text-2xs leading-relaxed text-muted">
        <span className="font-mono text-text">ARCANA_API_KEY</span> +{" "}
        <span className="font-mono text-text">ARCANA_WORKSPACE</span> set in{" "}
        <span className="font-mono text-text">.env.local</span>
        {result.pushedToVercel
          ? " and pushed to the linked Vercel project (production, preview, development)."
          : ". Link the agent to Vercel and push them from Deploy → Environment so the deployed agent has memory too."}
      </div>
      {result.usedFallback ? (
        <div className="rounded-lg border border-warn/40 bg-warn/[0.06] px-2.5 py-2 text-2xs leading-relaxed text-muted">
          <b className="text-text">Fallback used.</b>{" "}
          <span className="font-mono">eve add extension/arcana</span> failed on
          the published peer range, so Studio installed{" "}
          <span className="font-mono">@kybernesis/arcana</span> with{" "}
          <span className="font-mono">
            {result.packageManager ?? "npm"}
            {result.packageManager === "npm" || !result.packageManager
              ? " --legacy-peer-deps"
              : ""}
          </span>{" "}
          and wrote the mount itself. It runs cleanly on eve 0.49; the fix
          belongs in the package's peerDependencies.
        </div>
      ) : null}
      <RestartHint agentId={agentId} what="Arcana" />
    </div>
  );
}

type Stream = ReturnType<typeof useRegistryStream>;

/** What the last wire / migrate run produced, owned by ArcanaSection so it
 * survives the form or status card re-rendering when detection flips. */
type Outcome =
  | { kind: "wire"; result: WireBrainResult }
  | { kind: "migrate"; result: MigrateBrainResult };

function WireForm({
  agentId,
  detected,
  stream,
  onResult,
}: {
  agentId: string;
  detected: DetectedBrain;
  stream: Stream;
  onResult: (r: WireBrainResult) => void;
}): JSX.Element {
  const [workspace, setWorkspace] = useState(detected.workspace ?? "");
  const [key, setKey] = useState("");
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState<null | "ok" | string>(null);
  const running = stream.running;

  const validate = async (): Promise<boolean> => {
    setChecking(true);
    setChecked(null);
    const r = await window.studio.arcana.validate(workspace.trim(), key.trim());
    setChecking(false);
    setChecked(r.ok ? "ok" : (r.error ?? "Key rejected."));
    return r.ok;
  };

  const wire = async (): Promise<void> => {
    const r = await stream.run((runId) =>
      window.studio.arcana.wire(
        agentId,
        { workspace: workspace.trim(), key: key.trim() },
        runId,
      ),
    );
    if (r.ok) {
      setKey("");
    }
    onResult(r);
  };

  const ready =
    Boolean(workspace.trim() && key.trim()) && !running && !checking;

  return (
    <Card className="space-y-3 p-4">
      <Field label="Workspace slug" hint="ARCANA_WORKSPACE">
        <Input
          value={workspace}
          onChange={(e) => {
            setWorkspace(e.target.value);
            setChecked(null);
          }}
          placeholder="my-agent"
          className="font-mono"
          disabled={running}
        />
      </Field>
      <Field
        label="API key"
        hint="ARCANA_API_KEY · kb_… scoped to that workspace"
      >
        <Input
          value={key}
          onChange={(e) => {
            setKey(e.target.value);
            setChecked(null);
          }}
          type="password"
          placeholder="kb_live_…"
          className="font-mono"
          disabled={running}
        />
      </Field>
      {checked === "ok" ? (
        <div className="text-xs text-success">
          Key accepted for {workspace.trim()}.
        </div>
      ) : checked ? (
        <div className="text-xs text-danger">{checked}</div>
      ) : null}
      <div className="flex gap-2 pt-1">
        <Button
          variant="secondary"
          className="flex-1"
          disabled={!ready}
          onClick={() => void validate()}
        >
          {checking ? "Checking…" : "Validate key"}
        </Button>
        <Button
          variant="primary"
          className="flex-1"
          disabled={!ready}
          onClick={() => void wire()}
        >
          {running
            ? "Wiring…"
            : detected.mode === "extension"
              ? "Update credentials"
              : "Wire Arcana"}
        </Button>
      </div>
      <p className="text-2xs leading-relaxed text-faint">
        Runs{" "}
        <span className="font-mono text-muted">eve add extension/arcana</span>{" "}
        (installs{" "}
        <span className="font-mono text-muted">@kybernesis/arcana</span>, writes{" "}
        <span className="font-mono text-muted">agent/extensions/arcana.ts</span>
        ), then sets{" "}
        <span className="font-mono text-muted">ARCANA_API_KEY</span> and{" "}
        <span className="font-mono text-muted">ARCANA_WORKSPACE</span> in{" "}
        <span className="font-mono text-muted">.env.local</span>, and on the
        linked Vercel project, so the deployed agent remembers too. The
        extension brings its own recall/remember skills and instructions; no
        prompt edits needed.
      </p>
    </Card>
  );
}

function BrainStatus({
  agentId,
  detected,
  stream,
  onResult,
}: {
  agentId: string;
  detected: DetectedBrain;
  stream: Stream;
  onResult: (o: Outcome) => void;
}): JSX.Element {
  const [editing, setEditing] = useState(false);
  const running = stream.running;

  const migrate = async (): Promise<void> => {
    const r = await stream.run((runId) =>
      window.studio.arcana.migrate(agentId, runId),
    );
    onResult({ kind: "migrate", result: r });
  };

  const legacy = detected.mode === "legacy";
  return (
    <div className="space-y-3">
      <Card className="flex items-start gap-3 p-4">
        <StatusDot
          status={detected.hasKey ? "running" : "error"}
          className="mt-1"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-semibold tracking-tight text-text">
              {legacy ? "Legacy Arcana connection" : "Arcana extension mounted"}
            </span>
            {legacy ? (
              <Badge tone="warn">legacy · migrate</Badge>
            ) : (
              <Badge tone="success">official extension</Badge>
            )}
            {!detected.hasKey ? <Badge tone="danger">key missing</Badge> : null}
          </div>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">
            <span className="font-mono text-text">
              {detected.workspace ?? "workspace unknown"}
            </span>
            {detected.workspaceEnvVar ? (
              <>
                {" · "}
                <span className="font-mono text-text">
                  {detected.workspaceEnvVar}
                </span>
                {detected.workspaceSource === "default"
                  ? " (default)"
                  : detected.workspaceSource === "env"
                    ? " (from env)"
                    : " (not set)"}
              </>
            ) : null}
            {" · key "}
            <span className="font-mono text-text">
              {detected.keyEnvVar}
            </span>{" "}
            {detected.hasKey ? "present" : "not set"}
            {detected.keyEnvVars && detected.keyEnvVars.length > 1
              ? ` (also reads ${detected.keyEnvVars
                  .filter((v) => v !== detected.keyEnvVar)
                  .join(", ")})`
              : ""}
          </p>
          <p className="mt-1 font-mono text-2xs text-faint">
            {legacy ? detected.legacyFile : detected.mountFile}
            {detected.subagentMounts.length > 0
              ? ` · subagents: ${detected.subagentMounts.join(", ")}`
              : ""}
          </p>
          {legacy ? (
            <p className="mt-2 text-[13px] leading-relaxed text-muted">
              This agent wires Arcana through a hand-written{" "}
              <span className="font-mono">connections/arcana.ts</span>. The
              official extension replaces it with the same MCP connection plus
              the recall/remember/brain-note skills and always-on memory
              instructions. Migrate installs the extension with the credential
              this connection reads, confirms{" "}
              <span className="font-mono">eve info</span> reports no errors,
              then removes the legacy file.
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col gap-1.5">
          {legacy ? (
            <Button
              size="sm"
              variant="primary"
              onClick={() => void migrate()}
              disabled={running}
            >
              {running ? "Migrating…" : "Migrate to extension"}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setEditing((v) => !v)}
            disabled={running}
          >
            {editing ? "Hide" : detected.hasKey ? "Update key" : "Set key"}
          </Button>
        </div>
      </Card>

      {editing ? (
        <WireForm
          agentId={agentId}
          detected={detected}
          stream={stream}
          onResult={(r) => {
            if (r.ok) {
              setEditing(false);
            }
            onResult({ kind: "wire", result: r });
          }}
        />
      ) : null}
    </div>
  );
}

/** The persistent result panel (wire or migrate) with a Dismiss control. */
function OutcomePanel({
  agentId,
  outcome,
  onDismiss,
}: {
  agentId: string;
  outcome: Outcome;
  onDismiss: () => void;
}): JSX.Element {
  let body: JSX.Element;
  if (outcome.kind === "wire") {
    body = <WireOutcome agentId={agentId} result={outcome.result} />;
  } else if (outcome.result.ok) {
    const m = outcome.result;
    body = (
      <div className="space-y-2 rounded-lg bg-success/10 px-3 py-2.5 text-[13px] text-text">
        <div className="flex items-center gap-2">
          <Badge tone="success">migrated</Badge>
          <span>
            Extension mounted, legacy connection removed, eve info reports{" "}
            {m.info?.errors ?? 0} errors.
          </span>
        </div>
        {m.wire?.usedFallback ? (
          <div className="text-2xs text-muted">
            Installed via {m.wire.packageManager ?? "npm"} fallback (peer-range
            workaround).
          </div>
        ) : null}
        {m.wire?.pushedToVercel ? (
          <div className="text-2xs text-muted">
            ARCANA_API_KEY + ARCANA_WORKSPACE pushed to the linked Vercel
            project.
          </div>
        ) : null}
        {m.warning ? (
          <div className="rounded-lg border border-warn/40 bg-warn/[0.06] px-2.5 py-2 text-2xs leading-relaxed text-muted">
            {m.warning}
          </div>
        ) : null}
        <RestartHint agentId={agentId} what="the extension" />
      </div>
    );
  } else {
    body = (
      <div className="rounded-lg bg-danger/10 px-3 py-2.5 text-[13px] text-danger">
        {outcome.result.error ?? "Migration failed."}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {body}
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}

function ArcanaSection({ agentId }: { agentId: string }): JSX.Element {
  const [detected, setDetected] = useState<DetectedBrain | null>(null);
  const [loading, setLoading] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const stream = useRegistryStream();
  const loadStructure = useStore((s) => s.loadStructure);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setDetected(await window.studio.arcana.detect(agentId));
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    setDetected(null);
    setOutcome(null);
    void refresh();
  }, [refresh]);

  // Store the outcome first, then re-detect: the form/status card may swap
  // when the mode flips to "extension", but the panel below stays.
  const handleOutcome = (o: Outcome): void => {
    setOutcome(o);
    if (o.result.ok) {
      void loadStructure(agentId, true, true);
      void refresh();
    }
  };

  const dismiss = (): void => {
    setOutcome(null);
    stream.reset();
  };

  const browsable = Boolean(
    detected &&
    detected.mode !== "none" &&
    detected.hasKey &&
    detected.workspace,
  );

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Kicker>Long-term brain · Arcana</Kicker>
        <Badge tone="violet">official eve integration</Badge>
        {detected?.mode === "extension" ? (
          <Badge tone="success">active · {detected.workspace ?? "?"}</Badge>
        ) : detected?.mode === "legacy" ? (
          <Badge tone="warn">legacy</Badge>
        ) : (
          <Badge>optional</Badge>
        )}
        <div className="flex-1" />
        <IconButton
          onClick={() => void refresh()}
          title="Re-detect"
          disabled={loading || stream.running}
        >
          <IconRefresh className="h-3.5 w-3.5" />
        </IconButton>
      </div>

      <Card className="flex items-start gap-3 p-4">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-subtle text-faint">
          <IconBrain className="h-4 w-4" />
        </div>
        <div className="min-w-0 text-[13px] leading-relaxed text-muted">
          Cross-conversation semantic recall: a workspace-scoped timeline,
          entity graph, facts and brain notes. The extension mounts an MCP
          connection (<span className="font-mono">arcana__memory</span>), the{" "}
          <span className="font-mono">recall</span> /{" "}
          <span className="font-mono">remember</span> /{" "}
          <span className="font-mono">brain-note</span> skills and always-on
          memory instructions. Subagents can mount their own under{" "}
          <span className="font-mono">
            subagents/&lt;id&gt;/extensions/arcana.ts
          </span>
          . <ExtLink href={ARCANA_DOCS}>eve.dev/integrations/arcana</ExtLink>
          {" · "}
          <ExtLink href={ARCANA_SITE}>arcana.kybernesis.ai</ExtLink>
        </div>
      </Card>

      {loading && !detected ? (
        <div className="flex items-center gap-2 text-sm text-muted">
          <Spinner /> Inspecting…
        </div>
      ) : detected ? (
        detected.mode === "none" ? (
          <WireForm
            agentId={agentId}
            detected={detected}
            stream={stream}
            onResult={(r) => handleOutcome({ kind: "wire", result: r })}
          />
        ) : (
          <BrainStatus
            agentId={agentId}
            detected={detected}
            stream={stream}
            onResult={handleOutcome}
          />
        )
      ) : null}

      {stream.output || stream.running ? (
        <InstallConsole
          output={stream.output}
          running={stream.running}
          className="h-44"
        />
      ) : null}
      {outcome ? (
        <OutcomePanel agentId={agentId} outcome={outcome} onDismiss={dismiss} />
      ) : null}

      {browsable ? (
        <div className="space-y-2.5 border-t border-border pt-4">
          <Kicker>Brain browser</Kicker>
          <Browse agentId={agentId} />
        </div>
      ) : null}
    </section>
  );
}

// ------------------------------------------------------------ view

export function Memory(): JSX.Element {
  const activeAgentId = useStore((s) => s.activeAgentId);
  const [nonce, setNonce] = useState(0);

  return (
    <div className="flex h-full flex-col">
      <ViewHeader
        kicker="Memory"
        title="Memory"
        right={
          <IconButton onClick={() => setNonce((n) => n + 1)} title="Reload">
            <IconRefresh className="h-3.5 w-3.5" />
          </IconButton>
        }
      />
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl space-y-8 px-4 py-6">
          <SessionMemory />
          {activeAgentId ? (
            <>
              <MemorySlots
                key={`slots-${activeAgentId}-${nonce}`}
                agentId={activeAgentId}
              />
              <ArcanaSection
                key={`arcana-${activeAgentId}-${nonce}`}
                agentId={activeAgentId}
              />
            </>
          ) : (
            <div className="text-[13px] text-muted">
              Select an agent to manage its memory.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
