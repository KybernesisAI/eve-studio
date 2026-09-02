import type { AgentStructure, StructureOrigin } from "@shared/ipc";
import type { ReactNode } from "react";
import { useActiveStructure } from "../lib/useStructure";
import {
  IconBolt,
  IconBot,
  IconBrain,
  IconCalendar,
  IconLayers,
  IconPlug,
  IconRefresh,
  IconServer,
  IconWand,
  IconWrench,
} from "../ui/icons";
import { Badge, Card, EmptyState, IconButton, Spinner } from "../ui/kit";

function Meta({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}): JSX.Element {
  return (
    <div className="flex flex-col">
      <span className="text-2xs uppercase tracking-wide text-faint">
        {label}
      </span>
      <span className={`font-mono text-[13px] ${tone ?? "text-text"}`}>
        {value}
      </span>
    </div>
  );
}

function Group({
  icon,
  title,
  count,
  children,
}: {
  icon: ReactNode;
  title: string;
  count: number;
  children: ReactNode;
}): JSX.Element {
  return (
    <Card>
      <div className="flex items-center gap-2 border-b border-border px-3.5 py-2.5">
        <span className="text-muted">{icon}</span>
        <span className="text-[13px] font-medium text-text">{title}</span>
        <span className="rounded-full bg-black/[0.04] px-1.5 py-0.5 text-2xs text-muted">
          {count}
        </span>
      </div>
      {count === 0 ? (
        <div className="px-3.5 py-3 text-xs text-faint">none</div>
      ) : (
        <div className="divide-y divide-border/60">{children}</div>
      )}
    </Card>
  );
}

/** Small badge for who contributed a capability (extension / framework). */
export function OriginBadge({
  origin,
  extension,
}: {
  origin?: StructureOrigin;
  extension?: string;
}): JSX.Element | null {
  if (origin === "extension") {
    return <Badge tone="violet">{extension ?? "extension"}</Badge>;
  }
  if (origin === "framework") {
    return <Badge>built-in</Badge>;
  }
  return null;
}

function Item({
  name,
  tag,
  desc,
  extra,
}: {
  name: string;
  tag?: string;
  desc?: string;
  extra?: ReactNode;
}): JSX.Element {
  return (
    <div className="px-3.5 py-2">
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs text-text">{name}</span>
        {tag ? <Badge>{tag}</Badge> : null}
        {extra}
      </div>
      {desc ? (
        <div className="mt-0.5 line-clamp-2 text-2xs leading-snug text-muted">
          {desc}
        </div>
      ) : null}
    </div>
  );
}

function Body({ s }: { s: AgentStructure }): JSX.Element {
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Card className="flex flex-wrap items-center gap-x-8 gap-y-3 px-4 py-3.5">
        <Meta label="model" value={s.model ?? "none"} />
        <Meta label="sandbox" value={s.sandbox ?? "none"} />
        <Meta label="source" value={s.source} tone="text-muted" />
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <Badge tone={s.diagnostics.errors > 0 ? "danger" : "accent"}>
            {s.diagnostics.errors} errors
          </Badge>
          <Badge tone={s.diagnostics.warnings > 0 ? "warn" : "default"}>
            {s.diagnostics.warnings} warnings
          </Badge>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Group
          icon={<IconWrench className="h-4 w-4" />}
          title="Tools"
          count={s.tools.length}
        >
          {s.tools.map((t) => (
            <Item
              key={t.name}
              name={t.name}
              desc={t.description}
              extra={
                <>
                  {t.requiresApproval ? (
                    <Badge tone="warn">approval</Badge>
                  ) : null}
                  <OriginBadge origin={t.origin} extension={t.extension} />
                </>
              }
            />
          ))}
        </Group>
        <Group
          icon={<IconPlug className="h-4 w-4" />}
          title="Connections"
          count={s.connections.length}
        >
          {s.connections.map((c) => (
            <Item
              key={c.name}
              name={c.name}
              tag={c.protocol}
              desc={c.description}
              extra={<OriginBadge origin={c.origin} extension={c.extension} />}
            />
          ))}
        </Group>
        <Group
          icon={<IconWand className="h-4 w-4" />}
          title="Skills"
          count={s.skills.length}
        >
          {s.skills.map((k) => (
            <Item
              key={k.name}
              name={k.name}
              desc={k.description}
              extra={<OriginBadge origin={k.origin} extension={k.extension} />}
            />
          ))}
        </Group>
        <Group
          icon={<IconBot className="h-4 w-4" />}
          title="Subagents"
          count={s.subagents.length}
        >
          {s.subagents.map((a) => (
            <Item
              key={a.name}
              name={a.name}
              tag="subagent"
              desc={a.description}
              extra={<OriginBadge origin={a.origin} extension={a.extension} />}
            />
          ))}
        </Group>
        <Group
          icon={<IconServer className="h-4 w-4" />}
          title="Channels"
          count={s.channels.length}
        >
          {s.channels.map((c) => (
            <Item
              key={c.name}
              name={c.name}
              tag={c.kind}
              desc={
                c.method && c.urlPath ? `${c.method} ${c.urlPath}` : undefined
              }
              extra={<OriginBadge origin={c.origin} />}
            />
          ))}
        </Group>
        <Group
          icon={<IconCalendar className="h-4 w-4" />}
          title="Schedules"
          count={s.schedules.length}
        >
          {s.schedules.map((sch) => (
            <Item
              key={sch.name}
              name={sch.name}
              tag={sch.cron}
              desc={sch.markdown}
              extra={
                sch.hasRun ? <Badge tone="info">run()</Badge> : undefined
              }
            />
          ))}
        </Group>
        <Group
          icon={<IconBrain className="h-4 w-4" />}
          title="Memory slots"
          count={s.memories.length}
        >
          {s.memories.map((m) => (
            <Item
              key={m.slot}
              name={m.slot}
              tag={m.visibility}
              desc={m.description ?? m.logicalPath}
            />
          ))}
        </Group>
        <Group
          icon={<IconLayers className="h-4 w-4" />}
          title="Extensions"
          count={s.extensions.length}
        >
          {s.extensions.map((x) => (
            <Item
              key={x.namespace}
              name={x.namespace}
              tag={x.packageName}
              desc={x.mountLogicalPath}
            />
          ))}
        </Group>
        {s.remoteAgents.length > 0 ? (
          <Group
            icon={<IconServer className="h-4 w-4" />}
            title="Remote agents"
            count={s.remoteAgents.length}
          >
            {s.remoteAgents.map((r) => (
              <Item key={r.name} name={r.name} desc={r.url} />
            ))}
          </Group>
        ) : null}
        {s.hooks.length > 0 ? (
          <Group
            icon={<IconBolt className="h-4 w-4" />}
            title="Hooks"
            count={s.hooks.length}
          >
            {s.hooks.map((h) => (
              <Item
                key={h.name}
                name={h.name}
                desc={h.eventNames?.join(", ")}
              />
            ))}
          </Group>
        ) : null}
      </div>
    </div>
  );
}

export function Structure(): JSX.Element {
  const { structure, loading, reload } = useActiveStructure();

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-5 py-2.5">
        <div className="text-[13px] font-medium text-text">Structure</div>
        <IconButton onClick={reload} title="Re-run eve info and reload">
          <IconRefresh className="h-3.5 w-3.5" />
        </IconButton>
      </div>
      <div className="flex-1 overflow-auto p-5">
        {loading && !structure ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted">
            <Spinner /> Reading manifest…
          </div>
        ) : structure?.error ? (
          <EmptyState
            icon={<IconServer className="h-5 w-5" />}
            title="Can't read structure"
          >
            {structure.error}
          </EmptyState>
        ) : structure ? (
          <Body s={structure} />
        ) : null}
      </div>
    </div>
  );
}
