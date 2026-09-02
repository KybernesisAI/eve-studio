import { useState } from "react";
import { CapabilityEditor } from "../components/CapabilityEditor";
import { useActiveStructure } from "../lib/useStructure";
import { useStore } from "../store";
import {
  IconCalendar,
  IconChevronRight,
  IconPlus,
  IconRefresh,
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

function NewScheduleModal({
  agentId,
  onClose,
}: {
  agentId: string;
  onClose: () => void;
}): JSX.Element {
  const [name, setName] = useState("");
  const [cron, setCron] = useState("0 9 * * *");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    setBusy(true);
    setErr(null);
    const r = await window.studio.agents.createSchedule(agentId, {
      name,
      cron,
      prompt,
    });
    setBusy(false);
    if (r.ok) {
      setDone(r.relPath ?? "schedule");
    } else {
      setErr(r.error ?? "Failed.");
    }
  };

  return (
    <Modal title="New schedule" onClose={onClose} width="max-w-xl">
      {done ? (
        <div className="space-y-3 p-4">
          <div className="rounded-lg bg-success/10 px-3 py-2 text-[13px] text-success">
            Created <span className="font-mono">{done}</span>.
          </div>
          <p className="text-2xs leading-relaxed text-muted">
            Cron runs in UTC on Vercel. Restart the agent to register it; in
            dev, fire it once via the dev schedules route.
          </p>
          <div className="flex justify-end">
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3 p-4">
          <Field label="Name" hint="becomes schedules/<name>.ts">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="daily-summary"
              className="font-mono"
            />
          </Field>
          <Field label="Cron" hint="5-field, UTC (min hour dom mon dow)">
            <Input
              value={cron}
              onChange={(e) => setCron(e.target.value)}
              placeholder="0 9 * * *"
              className="font-mono"
            />
          </Field>
          <Field label="Prompt" hint="fire-and-forget task the agent runs">
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              placeholder="Pull open issues and post a summary to the metrics endpoint."
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
              disabled={busy || !name || !cron || !prompt}
            >
              {busy ? "Creating…" : "Create schedule"}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** `HH:MM` UTC → the same instant in the user's local zone, as `HH:MM`. */
function utcToLocal(hr: number, min: number): string {
  const now = new Date();
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hr, min),
  );
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Turn a 5-field cron into a rough human phrase (best-effort). Crons run in
 * UTC on Vercel, so a fixed time is shown in UTC with the local equivalent.
 */
function describeCron(cron?: string): string | null {
  if (!cron) {
    return null;
  }
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) {
    return null;
  }
  const [min, hr, dom, , dow] = parts;
  const fixed = /^\d+$/.test(hr) && /^\d+$/.test(min);
  const at = fixed
    ? `${hr.padStart(2, "0")}:${min.padStart(2, "0")} UTC · ${utcToLocal(Number(hr), Number(min))} local`
    : null;
  const days = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  if (dow !== "*" && /^\d$/.test(dow)) {
    return `Weekly on ${days[Number(dow)]}${at ? ` at ${at}` : " (UTC)"}`;
  }
  if (dom === "*" && at) {
    return `Daily at ${at}`;
  }
  return `${cron.trim()} (UTC)`;
}

export function Schedules(): JSX.Element {
  const { id, structure, loading, reload } = useActiveStructure();
  const running = useStore((s) =>
    id ? s.runtime[id]?.status === "running" : false,
  );
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  const runTest = async (name: string): Promise<void> => {
    if (!id) {
      return;
    }
    setTesting(name);
    setTestMsg(null);
    const r = await window.studio.agents.runSchedule(id, name);
    setTesting(null);
    setTestMsg({
      ok: r.ok,
      text: r.ok
        ? `Fired “${name}” once. Check where it delivers (e.g. your Slack DM). If it targets a channel, that only sends when the target env var is set locally too.`
        : r.output,
    });
  };

  if (loading && !structure) {
    return (
      <div className="flex h-full items-center justify-center text-muted">
        <Spinner />
      </div>
    );
  }
  const schedules = structure?.schedules ?? [];

  return (
    <div className="flex h-full flex-col">
      <ViewHeader
        kicker="Schedules"
        title="Schedules"
        count={schedules.length}
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
        {testMsg ? (
          <div className="mx-auto max-w-2xl px-4 pt-4">
            <div
              className={`flex items-start justify-between gap-3 rounded-lg px-3 py-2 text-2xs ${
                testMsg.ok
                  ? "bg-success/10 text-success"
                  : "bg-danger/10 text-danger"
              }`}
            >
              <span className="leading-relaxed">{testMsg.text}</span>
              <button
                className="shrink-0 opacity-70 hover:opacity-100"
                onClick={() => setTestMsg(null)}
                type="button"
              >
                ✕
              </button>
            </div>
          </div>
        ) : null}
        {schedules.length === 0 ? (
          <EmptyState
            icon={<IconCalendar className="h-6 w-6" />}
            kicker="Schedules"
            title="No schedules"
            action={
              <Button
                variant="primary"
                size="sm"
                onClick={() => setAddOpen(true)}
                disabled={!id}
              >
                <IconPlus className="h-3.5 w-3.5" />
                New schedule
              </Button>
            }
          >
            Scheduled jobs wake the agent on a cron (root agent only). A
            markdown schedule is a fire-and-forget prompt; a run() handler can
            deliver to a channel with to(channel, target).send().
          </EmptyState>
        ) : (
          <div className="mx-auto max-w-2xl px-4 py-4">
            <List>
              {schedules.map((s) => {
                const human = describeCron(s.cron);
                return (
                  <ListRow
                    key={s.name}
                    icon={<IconCalendar className="h-4 w-4" />}
                    title={s.name}
                    badge={s.hasRun ? <Badge tone="info">run()</Badge> : null}
                    desc={
                      [human, s.markdown].filter(Boolean).join(" · ") ||
                      undefined
                    }
                    onClick={() => setEditing(s.name)}
                    right={
                      <div className="flex items-center gap-2">
                        {s.cron ? <Badge>{s.cron}</Badge> : null}
                        <Button
                          disabled={!running || testing === s.name}
                          onClick={(e) => {
                            e.stopPropagation();
                            void runTest(s.name);
                          }}
                          size="sm"
                          title={
                            running
                              ? "Fire this schedule once now"
                              : "Start the agent to test"
                          }
                          variant="secondary"
                        >
                          {testing === s.name ? "Testing…" : "Test"}
                        </Button>
                        <IconChevronRight className="h-4 w-4 text-faint opacity-0 transition-opacity group-hover:opacity-100" />
                      </div>
                    }
                  />
                );
              })}
            </List>
          </div>
        )}
      </div>

      {addOpen && id ? (
        <NewScheduleModal agentId={id} onClose={() => setAddOpen(false)} />
      ) : null}
      {editing && id ? (
        <CapabilityEditor
          agentId={id}
          kind="schedule"
          name={editing}
          onClose={() => setEditing(null)}
          onChanged={reload}
        />
      ) : null}
    </div>
  );
}
