import { useState } from "react";
import { CapabilityEditor } from "../components/CapabilityEditor";
import { useActiveStructure } from "../lib/useStructure";
import { OriginBadge } from "./Structure";
import {
  IconChevronRight,
  IconPlus,
  IconRefresh,
  IconWrench,
} from "../ui/icons";
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
  Textarea,
  ViewHeader,
} from "../ui/kit";

function NewToolModal({
  agentId,
  onClose,
}: {
  agentId: string;
  onClose: () => void;
}): JSX.Element {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [approval, setApproval] = useState<"never" | "once" | "always">(
    "never",
  );
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    setBusy(true);
    setErr(null);
    const r = await window.studio.agents.createTool(agentId, {
      name,
      description,
      approval,
    });
    setBusy(false);
    if (r.ok) {
      setDone(r.relPath ?? "tool");
    } else {
      setErr(r.error ?? "Failed.");
    }
  };

  return (
    <Modal title="New tool" onClose={onClose} width="max-w-xl">
      {done ? (
        <div className="space-y-3 p-4">
          <div className="rounded-lg bg-success/10 px-3 py-2 text-[13px] text-success">
            Created <span className="font-mono">{done}</span>.
          </div>
          <p className="text-2xs leading-relaxed text-muted">
            It's scaffolded with an empty Zod input schema and a stub{" "}
            <span className="font-mono text-text">execute</span>. Fill in the
            schema and logic, then restart the agent.
          </p>
          <div className="flex justify-end">
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3 p-4">
          <Field label="Name" hint="snake_case — becomes tools/<name>.ts">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="get_weather"
              className="font-mono"
            />
          </Field>
          <Field label="Description" hint="written for the model">
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Get the current weather for a city."
            />
          </Field>
          <Field
            label="Approval gate"
            hint="human-in-the-loop for destructive tools"
          >
            <div className="inline-flex rounded-lg border border-border p-0.5">
              {(["never", "once", "always"] as const).map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setApproval(a)}
                  className={`rounded-[6px] px-3 py-1 text-[12.5px] capitalize transition-colors ${
                    approval === a
                      ? "bg-text text-white"
                      : "text-muted hover:text-text"
                  }`}
                >
                  {a}
                </button>
              ))}
            </div>
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
              {busy ? "Creating…" : "Create tool"}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

export function Tools(): JSX.Element {
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
  const tools = structure?.tools ?? [];

  return (
    <div className="flex h-full flex-col">
      <ViewHeader
        kicker="Capabilities"
        title="Tools"
        count={tools.length}
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
        {tools.length === 0 ? (
          <EmptyState
            icon={<IconWrench className="h-6 w-6" />}
            kicker="Tools"
            title="No tools yet"
            action={
              <Button
                variant="primary"
                size="sm"
                onClick={() => setAddOpen(true)}
                disabled={!id}
              >
                <IconPlus className="h-3.5 w-3.5" />
                New tool
              </Button>
            }
          >
            Tools are typed actions the agent can call. They run in the app
            runtime with full env access. Built-in tools (bash, read_file,
            web_search, …) are listed once the manifest is read.
          </EmptyState>
        ) : (
          <div className="mx-auto max-w-2xl px-4 py-4">
            <List>
              {tools.map((t) => (
                <ListRow
                  key={t.name}
                  icon={<IconWrench className="h-4 w-4" />}
                  title={t.name}
                  badge={
                    <>
                      <Badge>tool</Badge>
                      {t.requiresApproval ? (
                        <Badge tone="warn">approval</Badge>
                      ) : null}
                      {t.legacyStudio ? (
                        <Badge tone="warn">legacy Eve Studio (Evolve) tool</Badge>
                      ) : null}
                      <OriginBadge origin={t.origin} extension={t.extension} />
                    </>
                  }
                  desc={
                    t.legacyStudio
                      ? `${t.description ? `${t.description} — ` : ""}Evolve was retired; this tool is safe to delete.`
                      : t.description || undefined
                  }
                  onClick={
                    t.origin === "application" || !t.origin
                      ? () => setEditing(t.name)
                      : undefined
                  }
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
        <NewToolModal agentId={id} onClose={() => setAddOpen(false)} />
      ) : null}
      {editing && id ? (
        <CapabilityEditor
          agentId={id}
          kind="tool"
          name={editing}
          onClose={() => setEditing(null)}
          onChanged={reload}
        />
      ) : null}
    </div>
  );
}
