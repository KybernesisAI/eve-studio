import { useState } from "react";
import { CapabilityEditor } from "../components/CapabilityEditor";
import { useActiveStructure } from "../lib/useStructure";
import { IconBolt, IconChevronRight, IconPlus, IconRefresh } from "../ui/icons";
import {
  Badge,
  Button,
  EmptyState,
  Field,
  IconButton,
  Input,
  List,
  ListRow,
  Modal,
  Spinner,
  ViewHeader,
} from "../ui/kit";

function NewHookModal({
  agentId,
  onClose,
}: {
  agentId: string;
  onClose: () => void;
}): JSX.Element {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    setBusy(true);
    setErr(null);
    const r = await window.studio.agents.createHook(agentId, name);
    setBusy(false);
    if (r.ok) {
      setDone(r.relPath ?? "hook");
    } else {
      setErr(r.error ?? "Failed.");
    }
  };

  return (
    <Modal title="New hook" onClose={onClose}>
      {done ? (
        <div className="space-y-3 p-4">
          <div className="rounded-lg bg-success/10 px-3 py-2 text-[13px] text-success">
            Created <span className="font-mono">{done}</span>.
          </div>
          <p className="text-2xs leading-relaxed text-muted">
            Hooks observe the session event stream (audit, metrics,
            persistence). Edit the events map, then restart the agent.
          </p>
          <div className="flex justify-end">
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3 p-4">
          <Field label="Name" hint="becomes hooks/<name>.ts">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="audit"
              className="font-mono"
            />
          </Field>
          {err ? <div className="text-xs text-danger">{err}</div> : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submit} disabled={busy || !name}>
              {busy ? "Creating…" : "Create hook"}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

export function Hooks(): JSX.Element {
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
  const hooks = structure?.hooks ?? [];

  return (
    <div className="flex h-full flex-col">
      <ViewHeader
        kicker="Capabilities"
        title="Hooks"
        count={hooks.length}
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
        {hooks.length === 0 ? (
          <EmptyState
            icon={<IconBolt className="h-6 w-6" />}
            kicker="Hooks"
            title="No hooks yet"
            action={
              <Button
                variant="primary"
                size="sm"
                onClick={() => setAddOpen(true)}
                disabled={!id}
              >
                <IconPlus className="h-3.5 w-3.5" />
                New hook
              </Button>
            }
          >
            Hooks run observe-only side effects on every session event: audit,
            metrics, alerting, persistence.
          </EmptyState>
        ) : (
          <div className="mx-auto max-w-2xl px-4 py-4">
            <List>
              {hooks.map((h) => (
                <ListRow
                  key={h.name}
                  icon={<IconBolt className="h-4 w-4" />}
                  title={h.name}
                  badge={<Badge>hook</Badge>}
                  desc={
                    h.eventNames && h.eventNames.length > 0
                      ? h.eventNames.join(", ")
                      : undefined
                  }
                  onClick={() => setEditing(h.name)}
                  right={
                    <IconChevronRight className="mt-1.5 h-4 w-4 text-faint opacity-0 transition-opacity group-hover:opacity-100" />
                  }
                />
              ))}
            </List>
          </div>
        )}
      </div>

      {addOpen && id ? (
        <NewHookModal agentId={id} onClose={() => setAddOpen(false)} />
      ) : null}
      {editing && id ? (
        <CapabilityEditor
          agentId={id}
          kind="hook"
          name={editing}
          onClose={() => setEditing(null)}
          onChanged={reload}
        />
      ) : null}
    </div>
  );
}
