import type { GatewayModel, ModelConfig } from "@shared/ipc";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  Spinner,
  ViewHeader,
  cx,
} from "../ui/kit";

/**
 * Quick-pick favorites across providers, shown as chips. The full catalog comes
 * live from the agent's linked AI Gateway (hundreds of models); these are just
 * the fast path. Keep them valid gateway ids.
 */
const FAVORITES = [
  "openai/gpt-5.6-luna-fast",
  "anthropic/claude-opus-4.8",
  "anthropic/claude-sonnet-5",
  "anthropic/claude-fable-5",
  "openai/gpt-5.5",
  "openai/gpt-5.6-sol",
  "xai/grok-4.5",
  "google/gemini-3-pro-preview",
  "moonshotai/kimi-k3",
  "zai/glm-5.2",
];
const REASONING = [
  "provider-default",
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
];

export function Model(): JSX.Element {
  const id = useStore((s) => s.activeAgentId);
  const reloadStructure = useStore((s) => s.loadStructure);
  const [cfg, setCfg] = useState<ModelConfig | null>(null);
  const [model, setModel] = useState("");
  const [reasoning, setReasoning] = useState("provider-default");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<GatewayModel[] | null>(null);
  const [query, setQuery] = useState("");
  const [browsing, setBrowsing] = useState(false);

  const load = useCallback(async () => {
    if (!id) {
      return;
    }
    setLoading(true);
    try {
      const c = await window.studio.agents.modelRead(id);
      setCfg(c);
      setModel(c.model ?? "");
      setReasoning(c.reasoning ?? "provider-default");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Pull the live catalog from the linked gateway. Best-effort: on failure the
  // favorites chips still work, and the field still accepts any id by hand.
  useEffect(() => {
    setCatalog(null);
    setQuery("");
    setBrowsing(false);
    if (id) {
      void window.studio.vercel
        .gatewayModels(id)
        .then((r) => setCatalog(r.ok ? r.models : []));
    }
  }, [id]);

  const matches = useMemo(() => {
    if (!(catalog && query.trim())) {
      return [];
    }
    const q = query.toLowerCase();
    return catalog.filter(
      (m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q),
    );
  }, [catalog, query]);

  const dirty =
    cfg !== null &&
    (model !== (cfg.model ?? "") ||
      reasoning !== (cfg.reasoning ?? "provider-default"));

  const save = async (): Promise<void> => {
    if (!id) {
      return;
    }
    setSaving(true);
    setErr(null);
    const r = await window.studio.agents.modelWrite(id, model, reasoning);
    setSaving(false);
    if (r.ok) {
      setCfg((c) => (c ? { ...c, model, reasoning } : c));
      setSaved(true);
      setTimeout(() => setSaved(false), 1600);
      void reloadStructure(id, true);
    } else {
      setErr(r.error ?? "Failed to write agent.ts.");
    }
  };

  if (loading && !cfg) {
    return (
      <div className="flex h-full items-center justify-center text-muted">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <ViewHeader
        kicker="Instructions"
        title="Model"
        right={
          <>
            {dirty ? (
              <span className="font-spacemono text-[10px] uppercase tracking-[0.14em] text-warn">
                unsaved
              </span>
            ) : null}
            {saved ? (
              <span className="font-spacemono text-[10px] uppercase tracking-[0.14em] text-success">
                saved
              </span>
            ) : null}
            <Button
              variant="primary"
              size="sm"
              onClick={save}
              disabled={!dirty || saving || !cfg?.editable}
            >
              {saving ? "Saving…" : "Save"}
            </Button>
          </>
        }
      />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-2xl space-y-6 px-4 py-6">
          {cfg && !cfg.editable ? (
            <Card className="bg-warn/[0.06] px-3 py-2.5 text-[13px] leading-relaxed text-muted">
              {cfg.note}
            </Card>
          ) : null}

          <Field
            label="Model"
            hint="Vercel AI Gateway id: provider/model · saved with eve set"
          >
            <Input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={!cfg?.editable}
              placeholder="openai/gpt-5.6-luna-fast"
              className="font-mono"
            />
          </Field>
          <div className="-mt-2 flex flex-wrap items-center gap-1.5">
            {FAVORITES.map((m) => (
              <button
                key={m}
                type="button"
                disabled={!cfg?.editable}
                onClick={() => setModel(m)}
                className={cx(
                  "rounded-md border px-2.5 py-1 font-mono text-2xs transition-colors disabled:opacity-40",
                  model === m
                    ? "border-text bg-text text-white"
                    : "border-border text-muted hover:border-border-strong hover:text-text",
                )}
              >
                {m}
              </button>
            ))}
            {catalog && catalog.length > 0 ? (
              <button
                type="button"
                disabled={!cfg?.editable}
                onClick={() => setBrowsing((b) => !b)}
                className="rounded-md border border-dashed border-border-strong px-2.5 py-1 text-2xs text-muted transition-colors hover:text-text disabled:opacity-40"
              >
                {browsing ? "Hide" : `Browse all ${catalog.length}`}
              </button>
            ) : null}
          </div>

          {browsing && catalog ? (
            <div className="-mt-2 space-y-2 rounded-lg border border-border bg-canvas p-2.5">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search 300+ gateway models: grok, kimi, glm, gemini…"
                autoFocus
              />
              {query.trim() ? (
                <div className="max-h-64 space-y-0.5 overflow-auto">
                  {matches.length === 0 ? (
                    <div className="px-1 py-2 text-2xs text-muted">
                      No model matches “{query}”.
                    </div>
                  ) : (
                    matches.slice(0, 40).map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          setModel(m.id);
                          setBrowsing(false);
                          setQuery("");
                        }}
                        className={cx(
                          "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                          model === m.id ? "bg-text/[0.06]" : "hover:bg-hover",
                        )}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-mono text-2xs text-text">
                            {m.id}
                          </span>
                          <span className="block truncate text-[10px] text-faint">
                            {m.name}
                          </span>
                        </span>
                        {m.contextWindow ? (
                          <span className="shrink-0 font-spacemono text-[10px] text-faint">
                            {Math.round(m.contextWindow / 1000)}k ctx
                          </span>
                        ) : null}
                      </button>
                    ))
                  )}
                  {matches.length > 40 ? (
                    <div className="px-1 py-1 text-[10px] text-faint">
                      +{matches.length - 40} more: keep typing to narrow.
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="px-1 py-1 text-2xs text-muted">
                  Live from this agent’s linked gateway. Type to filter by name
                  or id.
                </div>
              )}
            </div>
          ) : null}

          <Field label="Reasoning effort" hint="provider-agnostic">
            <div className="flex flex-wrap gap-1.5">
              {REASONING.map((r) => (
                <button
                  key={r}
                  type="button"
                  disabled={!cfg?.editable}
                  onClick={() => setReasoning(r)}
                  className={cx(
                    "rounded-md border px-2.5 py-1 text-2xs transition-colors disabled:opacity-40",
                    reasoning === r
                      ? "border-text bg-text text-white"
                      : "border-border text-muted hover:border-border-strong hover:text-text",
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
          </Field>

          {err ? <div className="text-xs text-danger">{err}</div> : null}

          <div className="flex items-start gap-2 border-t border-border pt-4 text-2xs leading-relaxed text-faint">
            <Badge>gateway</Badge>
            <span>
              Routed through the Vercel AI Gateway. Any{" "}
              <span className="font-mono">provider/model</span> from the catalog
              works: type it above. Saving runs{" "}
              <span className="font-mono">eve set --model … --reasoning …</span>{" "}
              (the same editor as the dev TUI's /model). Full catalog at
              vercel.com/ai-gateway/models · docs at https://eve.dev/docs.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
