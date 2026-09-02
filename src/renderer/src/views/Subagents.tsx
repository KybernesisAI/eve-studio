import type { RegistryInstallResult, SelfModStatus } from "@shared/ipc";
import { useCallback, useEffect, useState } from "react";
import { CapabilityEditor } from "../components/CapabilityEditor";
import {
  InstallConsole,
  InstallOutcome,
  useRegistryStream,
} from "../components/RegistryInstall";
import { compareSemver } from "../lib/semver";
import { useActiveStructure } from "../lib/useStructure";
import { useStore } from "../store";
import {
  IconBot,
  IconChevronDown,
  IconChevronRight,
  IconPlus,
  IconRefresh,
  IconWand,
} from "../ui/icons";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  IconButton,
  Input,
  List,
  ListRow,
  Modal,
  Spinner,
  Textarea,
  ViewHeader,
  cx,
} from "../ui/kit";

function NewSubagentModal({
  agentId,
  onClose,
}: {
  agentId: string;
  onClose: () => void;
}): JSX.Element {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    setBusy(true);
    setErr(null);
    const r = await window.studio.agents.createSubagent(agentId, {
      name,
      description,
      instructions: instructions || undefined,
    });
    setBusy(false);
    if (r.ok) {
      setDone(r.relPath ?? "subagent");
    } else {
      setErr(r.error ?? "Failed.");
    }
  };

  return (
    <Modal title="New subagent" onClose={onClose} width="max-w-xl">
      {done ? (
        <div className="space-y-3 p-4">
          <div className="rounded-lg bg-success/10 px-3 py-2 text-[13px] text-success">
            Created <span className="font-mono">{done}</span> + instructions.md.
          </div>
          <p className="text-2xs leading-relaxed text-muted">
            The parent delegates to it by its name; the description is the
            routing hint. It's its own agent root — add its own
            tools/skills/connections under the subagent folder. Restart the
            agent to load it.
          </p>
          <div className="flex justify-end">
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3 p-4">
          <Field
            label="Name"
            hint="becomes subagents/<name>/ — unique vs tools"
          >
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="researcher"
              className="font-mono"
            />
          </Field>
          <Field
            label="Description"
            hint="the delegation trigger, for the parent"
          >
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Investigate a topic and gather sources before drafting."
            />
          </Field>
          <Field label="Instructions" hint="optional — its system prompt">
            <Textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={4}
              placeholder="You are the research specialist…"
            />
          </Field>
          {err ? <div className="text-xs text-danger">{err}</div> : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={submit}
              disabled={busy || !name || !description}
            >
              {busy ? "Creating…" : "Create subagent"}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/**
 * "Enable self-modification" — eve's experimental, development-only source
 * editing subagent (`eve add experimental/self-modification`).
 */
function SelfModificationCard({
  agentId,
  onChanged,
}: {
  agentId: string;
  onChanged: () => void;
}): JSX.Element {
  const [status, setStatus] = useState<SelfModStatus | null>(null);
  const [result, setResult] = useState<RegistryInstallResult | null>(null);
  const [open, setOpen] = useState(false);
  const { output, running, run } = useRegistryStream();
  const eveVersion = useStore(
    (st) => st.agents.find((a) => a.id === agentId)?.eveVersion ?? null,
  );
  // `@eve/self-modification` ships a compatibility manifest that only current
  // eve understands; on an older eve it mounts with a discovery error and the
  // agent stops compiling. Gate on the release the registry item targets.
  const MIN_EVE = "0.49.0";
  const tooOld = eveVersion !== null && compareSemver(eveVersion, MIN_EVE) < 0;

  const refresh = useCallback(async () => {
    setStatus(await window.studio.registry.selfModStatus(agentId));
  }, [agentId]);

  useEffect(() => {
    setStatus(null);
    setResult(null);
    void refresh();
  }, [refresh]);

  const enable = async (): Promise<void> => {
    setResult(null);
    const r = await run((runId) =>
      window.studio.registry.enableSelfModification(agentId, runId),
    );
    setResult(r);
    if (r.status !== "failed") {
      void refresh();
      onChanged();
    }
  };

  const enabled = status?.enabled ?? false;
  const expanded = open || running || result !== null;
  return (
    <Card className="p-3">
      <div className="flex items-center gap-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-subtle text-faint">
          <IconWand className="h-3.5 w-3.5" />
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="min-w-0 flex-1 text-left"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-medium text-text">
              Self-modification
            </span>
            <Badge tone="warn">experimental · dev only</Badge>
            {status === null ? null : enabled ? (
              <Badge tone="success">enabled</Badge>
            ) : null}
          </div>
          <div className="mt-0.5 truncate text-2xs text-muted">
            Lets the agent edit its own source under eve dev via eve's
            @eve/self-modification subagent.
          </div>
        </button>
        {enabled ? (
          <span className="shrink-0 font-mono text-2xs text-faint">
            {status?.relPath}
          </span>
        ) : tooOld ? (
          <span
            className="shrink-0 font-mono text-2xs text-warn"
            title={`Needs eve ${MIN_EVE}+ — this agent runs eve ${eveVersion}. Upgrade from the header first.`}
          >
            needs eve {MIN_EVE}+
          </span>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void enable()}
            disabled={running || status === null}
          >
            {running ? "Installing…" : "Enable"}
          </Button>
        )}
        <IconChevronDown
          className={cx(
            "h-4 w-4 shrink-0 text-faint transition-transform",
            expanded && "rotate-180",
          )}
        />
      </div>
      {expanded ? (
        <div className="mt-3 space-y-3 border-t border-border pt-3">
          <p className="text-[13px] leading-relaxed text-muted">
            Installs eve's{" "}
            <span className="font-mono">@eve/self-modification</span> subagent
            at{" "}
            <span className="font-mono">
              agent/subagents/self-modification/
            </span>
            . Under <span className="font-mono">eve dev</span> the root agent
            can delegate "change your own source" requests to it: structured
            file tools over a read-write mount of{" "}
            <span className="font-mono">agent/</span>, plus{" "}
            <span className="font-mono">selfmod__registry_add</span> to run{" "}
            <span className="font-mono">eve add</span>. It does nothing in
            production builds.
          </p>
          <p className="font-mono text-2xs text-faint">
            $ eve add experimental/self-modification --non-interactive --yes
          </p>
          {output || running ? (
            <InstallConsole
              output={output}
              running={running}
              className="h-40"
            />
          ) : null}
          {result ? (
            <InstallOutcome
              agentId={agentId}
              result={result}
              what="self-modification"
            />
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

export function Subagents(): JSX.Element {
  const { id, structure, loading, reload } = useActiveStructure();
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  if (loading && !structure) {
    return (
      <div className="flex h-full items-center justify-center text-muted">
        <Spinner />
      </div>
    );
  }
  const subagents = structure?.subagents ?? [];

  return (
    <div className="flex h-full flex-col">
      <ViewHeader
        kicker="Capabilities"
        title="Subagents"
        count={subagents.length}
        right={
          <>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setAddOpen(true)}
              disabled={!id}
            >
              <IconPlus className="h-3.5 w-3.5" />
              New
            </Button>
            <IconButton onClick={reload} title="Reload">
              <IconRefresh className="h-3.5 w-3.5" />
            </IconButton>
          </>
        }
      />

      <div className="flex-1 overflow-auto">
        {subagents.length === 0 ? (
          <div className="h-[60vh]">
            <EmptyState
              icon={<IconBot className="h-6 w-6" />}
              kicker="Subagents"
              title="No subagents yet"
              action={
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => setAddOpen(true)}
                  disabled={!id}
                >
                  <IconPlus className="h-3.5 w-3.5" />
                  New subagent
                </Button>
              }
            >
              Declared subagents are specialists the root delegates to — each
              its own isolated agent with its own tools, skills, and memory.
            </EmptyState>
          </div>
        ) : (
          <div className="mx-auto max-w-2xl px-4 py-4">
            <List>
              {subagents.filter((a) => a.name !== "self-modification").map((a) => (
                <ListRow
                  key={a.name}
                  icon={<IconBot className="h-4 w-4" />}
                  title={a.name}
                  badge={<Badge tone="violet">subagent</Badge>}
                  desc={a.description || undefined}
                  onClick={() => setEditing(a.name)}
                  right={
                    <IconChevronRight className="mt-1.5 h-4 w-4 text-faint opacity-0 transition-opacity group-hover:opacity-100" />
                  }
                />
              ))}
            </List>
          </div>
        )}
        {id ? (
          <div className="mx-auto max-w-2xl px-4 pb-6 pt-2">
            <SelfModificationCard agentId={id} onChanged={reload} />
          </div>
        ) : null}
      </div>

      {addOpen && id ? (
        <NewSubagentModal agentId={id} onClose={() => setAddOpen(false)} />
      ) : null}
      {editing && id ? (
        <CapabilityEditor
          agentId={id}
          kind="subagent"
          name={editing}
          onClose={() => setEditing(null)}
          onChanged={reload}
        />
      ) : null}
    </div>
  );
}
