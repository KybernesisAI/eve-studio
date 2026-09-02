import { useState } from "react";
import { CapabilityEditor } from "../components/CapabilityEditor";
import { useActiveStructure } from "../lib/useStructure";
import { OriginBadge } from "./Structure";
import { IconChevronRight, IconPlus, IconRefresh, IconWand } from "../ui/icons";
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

function NewSkillModal({
  agentId,
  onClose,
}: {
  agentId: string;
  onClose: () => void;
}): JSX.Element {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    setBusy(true);
    setErr(null);
    const r = await window.studio.agents.createSkill(agentId, {
      name,
      description,
      body: body || undefined,
    });
    setBusy(false);
    if (r.ok) {
      setDone(r.relPath ?? "skill");
    } else {
      setErr(r.error ?? "Failed.");
    }
  };

  return (
    <Modal title="New skill" onClose={onClose} width="max-w-xl">
      {done ? (
        <div className="space-y-3 p-4">
          <div className="rounded-lg bg-accent/10 px-3 py-2 text-[13px] text-accent">
            Created <span className="font-mono">{done}</span>.
          </div>
          <p className="text-2xs leading-relaxed text-muted">
            Restart the agent to load it. The description is the routing hint
            that decides when the skill loads.
          </p>
          <div className="flex justify-end">
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3 p-4">
          <Field label="Name" hint="becomes skills/<name>/SKILL.md">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="pricing-play"
              className="font-mono"
            />
          </Field>
          <Field
            label="Description"
            hint="routing hint — when should this load?"
          >
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="How to talk about pricing. Load when the user asks about cost."
            />
          </Field>
          <Field label="Body (Markdown)" hint="optional">
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={6}
              placeholder="# Pricing play&#10;&#10;Steps the agent should follow…"
              className="font-mono"
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
              {busy ? "Creating…" : "Create skill"}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

export function Skills(): JSX.Element {
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
  const skills = structure?.skills ?? [];

  return (
    <div className="flex h-full flex-col">
      <ViewHeader
        kicker="Capabilities"
        title="Skills"
        count={skills.length}
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
        {skills.length === 0 ? (
          <EmptyState
            icon={<IconWand className="h-6 w-6" />}
            kicker="Skills"
            title="No skills yet"
            action={
              <Button
                variant="primary"
                size="sm"
                onClick={() => setAddOpen(true)}
                disabled={!id}
              >
                <IconPlus className="h-3.5 w-3.5" />
                New skill
              </Button>
            }
          >
            Skills are load-on-demand instructions the agent pulls in when
            relevant. The description is the routing hint that decides when a
            skill loads.
          </EmptyState>
        ) : (
          <div className="mx-auto max-w-2xl px-4 py-4">
            <List>
              {skills.map((s) => (
                <ListRow
                  key={s.name}
                  icon={<IconWand className="h-4 w-4" />}
                  title={s.name}
                  badge={
                    <>
                      <Badge>skill</Badge>
                      <OriginBadge origin={s.origin} extension={s.extension} />
                    </>
                  }
                  desc={s.description || undefined}
                  onClick={
                    s.origin === "extension" ? undefined : () => setEditing(s.name)
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
        <NewSkillModal agentId={id} onClose={() => setAddOpen(false)} />
      ) : null}
      {editing && id ? (
        <CapabilityEditor
          agentId={id}
          kind="skill"
          name={editing}
          onClose={() => setEditing(null)}
          onChanged={reload}
        />
      ) : null}
    </div>
  );
}
