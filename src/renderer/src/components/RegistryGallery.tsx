import type { RegistryInstallResult, RegistryItem } from "@shared/ipc";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import { IconExternal, IconRefresh, IconSearch } from "../ui/icons";
import {
  Badge,
  Button,
  Card,
  IconButton,
  Kicker,
  Modal,
  Spinner,
  cx,
} from "../ui/kit";
import {
  InstallConsole,
  InstallOutcome,
  useRegistryStream,
} from "./RegistryInstall";

/** Channels with a guided wizard in the Channels tab, the primary path. */
export const GUIDED_CHANNELS = new Set([
  "channel/slack",
  "channel/discord",
  "channel/telegram",
  "channel/teams",
  "channel/twilio",
  "channel/github",
  "channel/linear",
  "channel/buzz",
]);

export type RegistryCategory =
  | "all"
  | "channel"
  | "connection"
  | "extension"
  | "memory"
  | "instrumentation"
  | "other";

const CATEGORIES: { id: RegistryCategory; label: string }[] = [
  { id: "all", label: "All" },
  { id: "channel", label: "Channels" },
  { id: "connection", label: "Connections" },
  { id: "extension", label: "Extensions" },
  { id: "memory", label: "Memory" },
  { id: "instrumentation", label: "Instrumentation" },
  { id: "other", label: "Other" },
];

export function registryCategoryOf(item: RegistryItem): RegistryCategory {
  const p = item.name.split("/")[0];
  return (
    (
      [
        "channel",
        "connection",
        "extension",
        "memory",
        "instrumentation",
      ] as const
    ).find((c) => c === p) ?? "other"
  );
}

const CAT_TONE: Record<
  RegistryCategory,
  "info" | "accent" | "violet" | "success" | "warn" | "default"
> = {
  all: "default",
  channel: "info",
  connection: "accent",
  extension: "violet",
  memory: "success",
  instrumentation: "warn",
  other: "default",
};

/** Docs link for a registry item (`https://eve.dev${docs}`). */
export function RegistryDocsLink({
  item,
}: {
  item: RegistryItem;
}): JSX.Element | null {
  if (!item.docs) {
    return null;
  }
  return (
    <a
      href={`https://eve.dev${item.docs}`}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 font-spacemono text-[10px] uppercase tracking-[0.14em] text-faint hover:text-text"
    >
      docs <IconExternal className="h-3 w-3" />
    </a>
  );
}

/**
 * Install one registry item with `eve add`, streaming the transcript and
 * showing the structured outcome (done / needs-input / failed).
 */
export function RegistryInstallModal({
  agentId,
  item,
  onClose,
  onInstalled,
}: {
  agentId: string;
  item: RegistryItem;
  onClose: () => void;
  onInstalled?: () => void;
}): JSX.Element {
  const { output, running, run } = useRegistryStream();
  const [skipSetup, setSkipSetup] = useState(false);
  const [result, setResult] = useState<RegistryInstallResult | null>(null);
  const loadStructure = useStore((s) => s.loadStructure);
  const cat = registryCategoryOf(item);

  const install = async (): Promise<void> => {
    setResult(null);
    const r = await run((runId) =>
      window.studio.registry.add(agentId, item.name, runId, { skipSetup }),
    );
    setResult(r);
    if (r.status !== "failed") {
      void loadStructure(agentId, true, true);
      onInstalled?.();
    }
  };

  return (
    <Modal title={`Install ${item.title}`} onClose={onClose} width="max-w-2xl">
      <div className="space-y-3 p-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[13px] text-text">
                {item.name}
              </span>
              <Badge tone={CAT_TONE[cat]}>{cat}</Badge>
            </div>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">
              {item.description}
            </p>
          </div>
          <RegistryDocsLink item={item} />
        </div>

        <div className="rounded-lg border border-border bg-subtle px-3 py-2 font-mono text-2xs text-muted">
          $ eve add {item.name} --non-interactive --yes
          {skipSetup ? " --skip-setup" : ""}
        </div>
        <label className="flex items-center gap-2 text-2xs text-muted">
          <input
            type="checkbox"
            checked={skipSetup}
            onChange={(e) => setSkipSetup(e.target.checked)}
            disabled={running}
          />
          Skip the item's setup flow (install files + deps only; configure env
          by hand)
        </label>

        {output || running ? (
          <InstallConsole output={output} running={running} />
        ) : null}
        {result ? (
          <InstallOutcome agentId={agentId} result={result} what={item.title} />
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

function ItemCard({
  item,
  onInstall,
}: {
  item: RegistryItem;
  onInstall: () => void;
}): JSX.Element {
  const guided = GUIDED_CHANNELS.has(item.name);
  const cat = registryCategoryOf(item);
  return (
    <Card className="flex flex-col gap-2 p-3.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium text-text">
            {item.title || item.name}
          </div>
          {item.title !== item.name ? (
            <div className="truncate font-mono text-2xs text-faint">
              {item.name}
            </div>
          ) : null}
        </div>
        <Badge tone={CAT_TONE[cat]}>{cat}</Badge>
      </div>
      <p className="line-clamp-3 min-h-[2.5rem] text-xs leading-relaxed text-muted">
        {item.description}
      </p>
      <div className="mt-auto flex items-center gap-2 pt-1">
        <RegistryDocsLink item={item} />
        {item.implementation === "chat-sdk" ? (
          <span className="font-spacemono text-[10px] uppercase tracking-[0.14em] text-faint">
            chat-sdk
          </span>
        ) : null}
        <div className="flex-1" />
        {guided ? (
          <Badge tone="success">guided setup · Channels</Badge>
        ) : (
          <Button size="sm" variant="secondary" onClick={onInstall}>
            Install
          </Button>
        )}
      </div>
    </Card>
  );
}

/**
 * "Add from registry", official eve 0.49 registry items, filterable by
 * category + search, installed with `eve add` streamed into an inline console.
 *
 * @param mode - `"connections"` hides `channel/*` items (the Channels tab owns
 *   those) and drops the Channels chip; `"all"` shows everything.
 */
export function RegistryGallery({
  agentId,
  mode = "all",
}: {
  agentId: string;
  mode?: "all" | "connections";
}): JSX.Element {
  const [items, setItems] = useState<RegistryItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<RegistryCategory>("all");
  const [installing, setInstalling] = useState<RegistryItem | null>(null);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(
    async (force = false) => {
      setLoading(true);
      setErr(null);
      try {
        const r = await window.studio.registry.list(agentId, force);
        setItems(r.items);
        if (!r.ok) {
          setErr(r.error ?? "Couldn't read the registry.");
        }
      } finally {
        setLoading(false);
      }
    },
    [agentId],
  );

  useEffect(() => {
    setItems(null);
    void load();
  }, [load]);

  const scoped = useMemo(
    () =>
      (items ?? []).filter(
        (it) => mode !== "connections" || registryCategoryOf(it) !== "channel",
      ),
    [items, mode],
  );
  const chips = useMemo(
    () =>
      CATEGORIES.filter((c) => mode !== "connections" || c.id !== "channel"),
    [mode],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return scoped.filter((it) => {
      if (cat !== "all" && registryCategoryOf(it) !== cat) {
        return false;
      }
      if (!needle) {
        return true;
      }
      return `${it.title} ${it.name} ${it.description} ${it.addCommandArgument}`
        .toLowerCase()
        .includes(needle);
    });
  }, [scoped, q, cat]);

  const counts = useMemo(() => {
    const c: Partial<Record<RegistryCategory, number>> = {};
    for (const it of scoped) {
      const k = registryCategoryOf(it);
      c[k] = (c[k] ?? 0) + 1;
    }
    return c;
  }, [scoped]);

  const LIMIT = 12;
  const shown =
    expanded || q || cat !== "all" ? filtered : filtered.slice(0, LIMIT);

  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <Kicker className="mb-1.5">Add from registry · eve add</Kicker>
          <div className="text-[13px] leading-relaxed text-muted">
            {mode === "connections"
              ? "Connections, extensions, memory providers and instrumentation from the official eve registry"
              : "Channels, connections, extensions, memory providers and instrumentation from the official eve registry"}
            {items ? ` (${scoped.length})` : ""}.
            {mode === "connections"
              ? " Channels live in the Channels tab."
              : " Guided channels (Slack, Discord, Telegram, Teams, Twilio, GitHub, Linear, Buzz) have wizards in the Channels tab."}{" "}
            <a
              href="https://eve.dev/integrations"
              target="_blank"
              rel="noreferrer"
              className="text-text underline decoration-border underline-offset-2 hover:decoration-text"
            >
              eve.dev/integrations
            </a>
          </div>
        </div>
        <IconButton
          onClick={() => void load(true)}
          title="Refresh registry"
          disabled={loading}
        >
          <IconRefresh className="h-3.5 w-3.5" />
        </IconButton>
      </div>

      <div className="flex items-center gap-2 rounded-xl border border-border bg-panel px-3 py-2">
        <IconSearch className="h-4 w-4 text-faint" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name, address or description: notion, browser, hindsight, otel…"
          className="no-drag flex-1 bg-transparent text-[13px] text-text outline-none placeholder:text-faint"
        />
      </div>
      <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
        {chips.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setCat(c.id)}
            className={cx(
              "shrink-0 rounded-lg border px-2.5 py-1 text-2xs transition-colors",
              cat === c.id
                ? "border-text bg-text text-white"
                : "border-border text-muted hover:bg-hover",
            )}
          >
            {c.label}
            {c.id !== "all" && counts[c.id] ? (
              <span className="ml-1 font-mono opacity-70">{counts[c.id]}</span>
            ) : null}
          </button>
        ))}
      </div>

      {err ? (
        <div className="rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">
          {err}
        </div>
      ) : null}

      {items === null ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted">
          <Spinner /> Reading the registry…
        </div>
      ) : shown.length === 0 ? (
        <div className="py-6 text-center text-[13px] text-muted">
          No items match.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {shown.map((it) => (
              <ItemCard
                key={it.name}
                item={it}
                onInstall={() => setInstalling(it)}
              />
            ))}
          </div>
          {!expanded && !q && cat === "all" && filtered.length > LIMIT ? (
            <div className="flex justify-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setExpanded(true)}
              >
                Show all {filtered.length}
              </Button>
            </div>
          ) : null}
        </>
      )}

      {installing ? (
        <RegistryInstallModal
          agentId={agentId}
          item={installing}
          onClose={() => setInstalling(null)}
        />
      ) : null}
    </section>
  );
}
