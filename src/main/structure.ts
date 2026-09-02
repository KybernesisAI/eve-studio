import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type {
  AgentStructure,
  StructureHook,
  StructureOrigin,
} from "../shared/ipc";
import { readModelConfig } from "./agentAuthoring";
import { eveInfoJson } from "./cli";

function agentRootOf(agentPath: string): string {
  return existsSync(join(agentPath, "agent"))
    ? join(agentPath, "agent")
    : agentPath;
}

function manifestPath(agentPath: string): string {
  return join(agentPath, ".eve", "compile", "compiled-agent-manifest.json");
}

/** Names in a capability dir — `.ts` files (stripped) or subdirectories. */
function listDir(dir: string, mode: "ts" | "dirs"): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) =>
        mode === "dirs"
          ? e.isDirectory()
          : e.isFile() && e.name.endsWith(".ts"),
      )
      .map((e) => (mode === "dirs" ? e.name : e.name.slice(0, -3)));
  } catch {
    return [];
  }
}

/**
 * Fold in capabilities authored on disk that the compiled manifest misses.
 *
 * @remarks
 * Fallback only. The normal refresh path runs `eve info --json`, which
 * regenerates the manifest from source; this overlay keeps counts honest when
 * that fails (eve not installed yet, discovery error) and a file was just
 * scaffolded. The model is always read straight from `agent.ts` because it is
 * the one field users switch most often.
 */
function mergeAuthored(
  agentPath: string,
  base: AgentStructure,
): AgentStructure {
  const root = agentRootOf(agentPath);
  const named = <T extends { name: string }>(
    arr: T[],
    names: string[],
  ): T[] => {
    const out = [...arr];
    for (const n of names) {
      if (!out.some((x) => x.name === n)) {
        out.push({ name: n } as T);
      }
    }
    return out;
  };
  const hooks: StructureHook[] = [...base.hooks];
  for (const n of listDir(join(root, "hooks"), "ts")) {
    if (!hooks.some((h) => h.name === n)) {
      hooks.push({ name: n });
    }
  }
  const memories = [...base.memories];
  for (const n of listDir(join(root, "memory"), "ts")) {
    if (!memories.some((m) => m.slot === n)) {
      memories.push({ slot: n, logicalPath: `memory/${n}.ts` });
    }
  }
  const authoredModel = readModelConfig(agentPath).model;

  return {
    ...base,
    model: authoredModel ?? base.model,
    schedules: named(base.schedules, listDir(join(root, "schedules"), "ts")),
    tools: named(base.tools, listDir(join(root, "tools"), "ts")),
    skills: named(base.skills, listDir(join(root, "skills"), "dirs")),
    subagents: named(base.subagents, listDir(join(root, "subagents"), "dirs")),
    hooks,
    memories,
  };
}

function empty(
  source: AgentStructure["source"],
  error?: string,
): AgentStructure {
  return {
    source,
    model: null,
    tools: [],
    connections: [],
    skills: [],
    channels: [],
    schedules: [],
    subagents: [],
    remoteAgents: [],
    hooks: [],
    memories: [],
    extensions: [],
    sandbox: null,
    diagnostics: { errors: 0, warnings: 0 },
    ...(error ? { error } : {}),
  };
}

// biome-ignore lint/suspicious/noExplicitAny: manifest is external JSON
type Any = any;

function arr(v: Any): Any[] {
  return Array.isArray(v) ? v : [];
}

function dedupeBy<T>(items: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    const k = key(it);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(it);
    }
  }
  return out;
}

/** Framework defaults carry `sourceId` `eve:defaults:*` / `eve:root-defaults:*`. */
function isFrameworkSource(sourceId: unknown): boolean {
  return typeof sourceId === "string" && sourceId.startsWith("eve:");
}

/** Extension contributions carry `sourceId` `ext:<ns>:…` or `owner.kind === "extension"`. */
function extensionOf(entry: Any): string | undefined {
  if (entry?.owner?.kind === "extension" && entry.owner.namespace) {
    return String(entry.owner.namespace);
  }
  const src = entry?.sourceId;
  if (typeof src === "string" && src.startsWith("ext:")) {
    return src.split(":")[1] || undefined;
  }
  return undefined;
}

function originOf(entry: Any): { origin: StructureOrigin; extension?: string } {
  const extension = extensionOf(entry);
  if (extension) {
    return { origin: "extension", extension };
  }
  if (isFrameworkSource(entry?.sourceId)) {
    return { origin: "framework" };
  }
  return { origin: "application" };
}

/**
 * Whether an application tool's source is a leftover from Eve Studio's retired
 * Evolve feature (its generated `propose_change` tool carried a
 * `eve-studio-proposal` marker / "Eve Studio … propose" header).
 */
function isLegacyStudioTool(agentRoot: unknown, logicalPath: unknown): boolean {
  if (typeof agentRoot !== "string" || typeof logicalPath !== "string") {
    return false;
  }
  try {
    const src = readFileSync(join(agentRoot, logicalPath), "utf8");
    return (
      src.includes("eve-studio-proposal") ||
      (src.includes("Eve Studio") && /propose/i.test(src))
    );
  } catch {
    return false;
  }
}

/**
 * Normalize `.eve/compile/compiled-agent-manifest.json`.
 *
 * @remarks
 * Shapes verified against eve 0.49's compiled manifest (`version: 47`):
 * `config.model.id`, `tools[].{name,description,requiresApproval,sourceId}`,
 * `connections[].{connectionName,protocol,url,description,sourceId}`,
 * `skills[].{name,skillId,description,owner}`, `channelRoutes.effective[]`
 * (no top-level `channels[]` any more; the default `eve` channel appears once
 * per route → dedupe by name), `schedules[].{name,cron,markdown,hasRun}`,
 * `subagents[].{name,description,owner,agent.config.description}`,
 * `hooks[].{slug,eventNames}`, `memories[].{slot,description,visibility,
 * logicalPath}`, `extensionMounts[].{namespace,packageName,mountLogicalPath}`,
 * `sandbox.sourceId` (`eve:defaults:sandbox.ts` = framework default),
 * `diagnosticsSummary`.
 */
function normalizeCompiled(m: Any): AgentStructure {
  // Manifest v47 exposes `channelRoutes.effective[]`; older manifests (eve
  // < 0.45) still carry a top-level `channels[]` with the same row shape.
  const routes = arr(m?.channelRoutes?.effective).length
    ? arr(m?.channelRoutes?.effective)
    : arr(m?.channels);
  return {
    source: "compiled",
    model: m?.config?.model?.id ?? null,
    displayName: m?.config?.name ?? null,
    tools: arr(m.tools).map((t: Any) => {
      const origin = originOf(t);
      return {
        name: t.name,
        description: t.description,
        requiresApproval: Boolean(t.requiresApproval),
        ...origin,
        ...(origin.origin === "application" &&
        isLegacyStudioTool(m?.agentRoot, t.logicalPath)
          ? { legacyStudio: true }
          : {}),
      };
    }),
    connections: arr(m.connections).map((c: Any) => ({
      name: c.connectionName ?? c.name,
      protocol: c.protocol,
      url: c.url,
      description: c.description,
      ...originOf(c),
    })),
    skills: arr(m.skills).map((s: Any) => ({
      name:
        s.name ??
        s.skillId ??
        String(s.logicalPath ?? "")
          .replace(/^skills\//, "")
          .replace(/\/SKILL\.md$/i, ""),
      description: s.description,
      ...originOf(s),
    })),
    channels: dedupeBy(
      routes.map((c: Any) => ({
        name: c.name,
        method: c.method,
        urlPath: c.urlPath,
        kind: c.adapterKind ?? c.kind,
        ...originOf(c),
      })),
      (c) => String(c.name),
    ),
    schedules: arr(m.schedules).map((s: Any) => ({
      name: s.name,
      cron: s.cron,
      markdown: typeof s.markdown === "string" ? s.markdown : undefined,
      hasRun: Boolean(s.hasRun),
    })),
    subagents: arr(m.subagents).map((s: Any) => ({
      name: s.name ?? s?.agent?.config?.name,
      description: s.description ?? s?.agent?.config?.description,
      ...originOf(s),
    })),
    remoteAgents: arr(m.remoteAgents).map((r: Any) => ({
      name: r.name ?? r.remoteAgentName,
      url: r.url,
    })),
    hooks: arr(m.hooks).map((h: Any) => ({
      name:
        h.slug ??
        h.name ??
        String(h.logicalPath ?? "hook")
          .replace(/^hooks\//, "")
          .replace(/\.tsx?$/, ""),
      eventNames: Array.isArray(h.eventNames)
        ? h.eventNames.map(String)
        : undefined,
    })),
    memories: arr(m.memories).map((mem: Any) => ({
      slot: String(mem.slot ?? ""),
      description: mem.description,
      visibility: mem.visibility,
      logicalPath: String(mem.logicalPath ?? `memory/${mem.slot}.ts`),
    })),
    extensions: arr(m.extensionMounts).map((x: Any) => ({
      namespace: String(x.namespace ?? ""),
      packageName: String(x.packageName ?? ""),
      mountLogicalPath: String(x.mountLogicalPath ?? ""),
    })),
    sandbox: m?.sandbox
      ? isFrameworkSource(m.sandbox.sourceId)
        ? "default"
        : String(m.sandbox.logicalPath ?? "sandbox.ts")
      : (m?.sandbox?.backendName ?? null),
    diagnostics: {
      errors: m?.diagnosticsSummary?.errors ?? 0,
      warnings: m?.diagnosticsSummary?.warnings ?? 0,
    },
  };
}

function readCompiledFile(path: string): AgentStructure | null {
  if (!existsSync(path)) {
    return null;
  }
  try {
    return normalizeCompiled(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return null;
  }
}

const NO_MANIFEST =
  "No compiled manifest. Install eve in the project (or run `eve info` in its folder) to inspect its structure.";

/**
 * Read an agent's structure from whatever manifest is on disk (no eve run).
 *
 * @param agentPath - The agent project's root directory.
 * @returns A normalized {@link AgentStructure}; `source: "none"` with an
 *   `error` when no manifest exists.
 */
export function readStructure(agentPath: string): AgentStructure {
  const existing = readCompiledFile(manifestPath(agentPath));
  if (existing) {
    return mergeAuthored(agentPath, existing);
  }
  return mergeAuthored(agentPath, empty("none", NO_MANIFEST));
}

/** Newest mtime under `agent/` (recursive, skipping node_modules), or 0. */
function newestSourceMtime(dir: string): number {
  let newest = 0;
  const walk = (d: string, depth: number): void => {
    if (depth > 6) {
      return;
    }
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === "node_modules" || e.name.startsWith(".")) {
        continue;
      }
      const p = join(d, e.name);
      try {
        const st = statSync(p);
        if (st.mtimeMs > newest) {
          newest = st.mtimeMs;
        }
        if (e.isDirectory()) {
          walk(p, depth + 1);
        }
      } catch {
        // unreadable entry
      }
    }
  };
  walk(dir, 0);
  return newest;
}

/** True when a source file under `agent/` is newer than the compiled manifest. */
function manifestStale(agentPath: string): boolean {
  const mp = manifestPath(agentPath);
  if (!existsSync(mp)) {
    return true;
  }
  try {
    const manifestAt = statSync(mp).mtimeMs;
    return newestSourceMtime(agentRootOf(agentPath)) > manifestAt;
  } catch {
    return true;
  }
}

const inflight = new Map<string, Promise<AgentStructure>>();

/**
 * Refresh + read an agent's structure.
 *
 * @remarks
 * Runs `eve info --json` (regenerates the compiled manifest from source
 * without booting a server) when the manifest is missing or older than a
 * source file under `agent/`, or when `force` is set. Falls back to the
 * on-disk manifest with the authored-files overlay when eve fails.
 * Concurrent refreshes of the same agent share one run.
 */
export function refreshStructure(
  agentPath: string,
  force = false,
): Promise<AgentStructure> {
  const pending = inflight.get(agentPath);
  if (pending) {
    return pending;
  }
  const task = (async (): Promise<AgentStructure> => {
    if (!(force || manifestStale(agentPath))) {
      return readStructure(agentPath);
    }
    const res = await eveInfoJson(agentPath);
    const fresh = readCompiledFile(manifestPath(agentPath));
    if (fresh) {
      const s = res.ok ? fresh : mergeAuthored(agentPath, fresh);
      if (res.info?.diagnostics) {
        s.diagnostics = {
          errors: res.info.diagnostics.errors ?? s.diagnostics.errors,
          warnings: res.info.diagnostics.warnings ?? s.diagnostics.warnings,
        };
      }
      return s;
    }
    return mergeAuthored(
      agentPath,
      empty(
        "none",
        res.output
          ? `eve info failed:\n${res.output.split("\n").slice(-8).join("\n").slice(0, 600)}`
          : NO_MANIFEST,
      ),
    );
  })().finally(() => inflight.delete(agentPath));
  inflight.set(agentPath, task);
  return task;
}
