import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type {
  DetectedBrain,
  MemorySlot,
  MemorySlotsResult,
  MigrateBrainResult,
  WireBrainInput,
  WireBrainResult,
} from "../shared/ipc";
import { arcanaPing } from "./arcana";
import { eveInfo, registryAdd, runCommand } from "./registry";

/**
 * Arcana wiring around the official eve integration (`extension/arcana`).
 *
 * @remarks
 * Eve 0.49 ships Kybernesis Arcana as a registry extension: `eve add
 * extension/arcana` installs `@kybernesis/arcana` and writes
 * `agent/extensions/arcana.ts`, which reads `ARCANA_API_KEY` +
 * `ARCANA_WORKSPACE`. The extension contributes the MCP connection
 * (`arcana__memory`), the recall/remember/brain-note skills and its own
 * always-on instructions — so Studio no longer appends a "## Memory" snippet.
 *
 * Studio agents wired before 0.49 have a hand-written
 * `agent/connections/arcana.ts` ("legacy"); {@link migrateLegacyBrain} moves
 * them to the extension.
 */

export const ARCANA_PACKAGE = "@kybernesis/arcana";
export const ARCANA_KEY_VAR = "ARCANA_API_KEY";
export const ARCANA_WORKSPACE_VAR = "ARCANA_WORKSPACE";

/** The `agent/` root inside a project (flat layouts use the project root). */
export function agentRoot(agentPath: string): string {
  return existsSync(join(agentPath, "agent"))
    ? join(agentPath, "agent")
    : agentPath;
}

function rel(agentPath: string, ...parts: string[]): string {
  const nested = existsSync(join(agentPath, "agent"));
  return [nested ? "agent" : null, ...parts].filter(Boolean).join("/");
}

// ---------------------------------------------------------------- env files

/**
 * Read a single `KEY=value` from the agent's dotenv files (value may be quoted).
 *
 * @remarks
 * `.env.local` first, then `.env` — the order `eve dev` uses. Linked agents get
 * their keys from `vercel env pull`, which writes `.env.local` only.
 */
function readEnvVar(agentPath: string, name: string): string | null {
  const key = name.replace(/[^A-Z0-9_]/gi, "");
  const re = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=\\s*(.*)$`, "m");
  for (const file of [".env.local", ".env"]) {
    const p = join(agentPath, file);
    if (!existsSync(p)) {
      continue;
    }
    const m = re.exec(readFileSync(p, "utf8"));
    const v = m?.[1]?.trim().replace(/^["']|["']$/g, "");
    if (v) {
      return v;
    }
  }
  return null;
}

/** Read the key from an agent's dotenv files for a given env-var name. */
export function keyFromEnv(agentPath: string, envVar: string): string | null {
  return readEnvVar(agentPath, envVar);
}

/**
 * Set or replace `NAME=value` in a dotenv file, creating it if absent.
 *
 * @returns Whether the file was created or changed.
 */
function upsertEnvIn(file: string, name: string, value: string): boolean {
  const line = `${name}=${value}`;
  if (!existsSync(file)) {
    writeFileSync(file, `${line}\n`);
    return true;
  }
  const src = readFileSync(file, "utf8");
  const re = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=.*$`, "m");
  const next = re.test(src)
    ? src.replace(re, line)
    : `${src.replace(/\n?$/, "\n")}${line}\n`;
  if (next !== src) {
    writeFileSync(file, next);
    return true;
  }
  return false;
}

/**
 * Upsert an env var for local dev: always in `.env.local` (what `eve dev`
 * reads first), and also in `.env` when that file already defines it so a
 * stale value there can't shadow anything.
 *
 * @returns The repo-relative env files that changed.
 */
export function upsertLocalEnv(
  agentPath: string,
  name: string,
  value: string,
): string[] {
  const changed: string[] = [];
  if (upsertEnvIn(join(agentPath, ".env.local"), name, value)) {
    changed.push(".env.local");
  }
  const dotenv = join(agentPath, ".env");
  if (existsSync(dotenv)) {
    const re = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=`, "m");
    if (
      re.test(readFileSync(dotenv, "utf8")) &&
      upsertEnvIn(dotenv, name, value)
    ) {
      changed.push(".env");
    }
  }
  return changed;
}

// ------------------------------------------------------------ manifest read

interface Manifest {
  memories?: unknown;
  extensionMounts?: unknown;
  connections?: unknown;
  subagents?: unknown;
}

function readManifest(agentPath: string): Manifest | null {
  const p = join(agentPath, ".eve", "compile", "compiled-agent-manifest.json");
  if (!existsSync(p)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(p, "utf8")) as Manifest;
  } catch {
    return null;
  }
}

function arr(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v)
    ? v.filter(
        (x): x is Record<string, unknown> =>
          Boolean(x) && typeof x === "object",
      )
    : [];
}

// ------------------------------------------------------------- detection

/**
 * Parse an extension mount file for its workspace + key env-var names.
 *
 * @remarks
 * Real mounts vary: `workspace: process.env.ARCANA_WORKSPACE!`, a hoisted
 * `const workspace = process.env.ARCANA_GTM_WORKSPACE ?? "eve-gtm"` used as
 * shorthand, and key chains like `process.env.ARCANA_EVAL_API_KEY ??
 * process.env.ARCANA_GTM_API_KEY ?? ""`. Every `process.env.X` reference is
 * collected; workspace-shaped names (WORKSPACE / SLUG) give the workspace var,
 * key-shaped names (KEY / TOKEN / SECRET) the key candidates, and the literal
 * after a `??` / `||` is the workspace default.
 */
export function parseMount(src: string): {
  keyEnvVar?: string;
  keyEnvVars: string[];
  workspaceEnvVar?: string;
  workspaceLiteral?: string;
} {
  const refs = [
    ...new Set(
      [...src.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1]),
    ),
  ];
  const wsVars = refs.filter((v) => /WORKSPACE|SLUG|_WS$/.test(v));
  const keyVars = refs.filter((v) => /KEY|TOKEN|SECRET/.test(v));
  const preferred = keyVars.filter((v) => !/EVAL|TEST|STAGING/.test(v));
  const keyEnvVar =
    preferred[0] ?? keyVars[0] ?? refs.find((v) => !wsVars.includes(v));
  const workspaceEnvVar = wsVars[0];
  const lit = (re: RegExp): string | undefined => re.exec(src)?.[1];
  const workspaceLiteral =
    (workspaceEnvVar
      ? lit(
          new RegExp(
            `process\\.env\\.${workspaceEnvVar}\\s*(?:\\?\\?|\\|\\|)\\s*["'\`]([A-Za-z0-9_.-]+)["'\`]`,
          ),
        )
      : undefined) ??
    lit(
      /workspace\s*[:=]\s*(?:process\.env\.[A-Z0-9_]+\s*!?\s*(?:\?\?|\|\|)\s*)*["'`]([A-Za-z0-9_.-]+)["'`]/,
    );
  return {
    keyEnvVar,
    keyEnvVars: [
      ...preferred,
      ...keyVars.filter((v) => !preferred.includes(v)),
    ],
    workspaceEnvVar,
    workspaceLiteral,
  };
}

/**
 * Parse a legacy hand-written `connections/arcana.ts` for its workspace + key
 * env var, without needing the compiled structure.
 */
export function brainFromConnection(agentPath: string): {
  workspace?: string;
  envVar?: string;
} {
  const file = join(agentRoot(agentPath), "connections", "arcana.ts");
  if (!existsSync(file)) {
    return {};
  }
  const src = readFileSync(file, "utf8");
  // A connection often reads several ARCANA_* vars — the kb_ key, but also a
  // workspace-slug override. Take the credential-shaped one.
  const candidates = [
    ...src.matchAll(/process\.env\.([A-Z0-9_]*ARCANA[A-Z0-9_]*)/g),
  ].map((m) => m[1]);
  const envVar =
    candidates.find((v) => /(KEY|TOKEN|SECRET)$/.test(v)) ??
    candidates.find((v) => !/(WORKSPACE|AGENT|SLUG|URL)$/.test(v)) ??
    candidates[0];
  const workspace =
    /X-Kyberagent-Agent["']?\s*[:=]\s*["']([a-z0-9-]+)["']/i.exec(src)?.[1] ??
    /arcanaWorkspace\s*=\s*(?:process\.env\.[A-Z0-9_]+\s*\?\?\s*)?["']([a-z0-9-]+)["']/i.exec(
      src,
    )?.[1];
  return { workspace, envVar };
}

/** Subagent ids that mount their own Arcana extension. */
function subagentMounts(agentPath: string): string[] {
  const dir = join(agentRoot(agentPath), "subagents");
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter(
        (e) =>
          e.isDirectory() &&
          existsSync(join(dir, e.name, "extensions", "arcana.ts")),
      )
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * Inspect an agent's Arcana wiring: the official extension mount, a legacy
 * connection file, or nothing — from the compiled manifest when present and
 * from the source files on disk always (so it works before any build).
 */
export function detectBrain(agentPath: string): DetectedBrain {
  const root = agentRoot(agentPath);
  const mountFile = join(root, "extensions", "arcana.ts");
  const legacyFile = join(root, "connections", "arcana.ts");
  const m = readManifest(agentPath);

  // The manifest corroborates, but the file on disk decides: a manifest is
  // only rebuilt by `eve info`/`eve dev`, so it lags deletes and scaffolds.
  const mountedInManifest = arr(m?.extensionMounts).some(
    (x) => x.packageName === ARCANA_PACKAGE,
  );
  const legacyInManifest = arr(m?.connections).some(
    (c) =>
      String(c.url ?? "")
        .toLowerCase()
        .includes("arcana") && !String(c.sourceId ?? "").startsWith("ext:"),
  );
  const hasMount = existsSync(mountFile);
  const hasLegacy = existsSync(legacyFile);

  const base: DetectedBrain = {
    mode: "none",
    keyEnvVar: ARCANA_KEY_VAR,
    workspaceEnvVar: ARCANA_WORKSPACE_VAR,
    hasKey: false,
    hasLegacyFile: existsSync(legacyFile),
    inManifest: hasMount
      ? mountedInManifest
      : hasLegacy
        ? legacyInManifest
        : false,
    subagentMounts: subagentMounts(agentPath),
    packageInstalled: existsSync(
      join(agentPath, "node_modules", ...ARCANA_PACKAGE.split("/")),
    ),
  };

  if (hasMount) {
    const parsed = parseMount(readFileSync(mountFile, "utf8"));
    const candidates = parsed.keyEnvVars.length
      ? parsed.keyEnvVars
      : [parsed.keyEnvVar ?? ARCANA_KEY_VAR];
    // The key var Studio reports is the first candidate that actually has a
    // value locally; else the mount's preferred one.
    const keyEnvVar =
      candidates.find((v) => readEnvVar(agentPath, v) !== null) ??
      candidates[0];
    const workspaceEnvVar = parsed.workspaceEnvVar;
    const fromEnv = workspaceEnvVar
      ? readEnvVar(agentPath, workspaceEnvVar)
      : null;
    const workspace = fromEnv ?? parsed.workspaceLiteral;
    return {
      ...base,
      mode: "extension",
      keyEnvVar,
      keyEnvVars: candidates,
      workspaceEnvVar: workspaceEnvVar ?? undefined,
      workspace: workspace ?? undefined,
      workspaceSource: fromEnv
        ? "env"
        : parsed.workspaceLiteral
          ? "default"
          : undefined,
      workspaceDefault: parsed.workspaceLiteral,
      hasKey: readEnvVar(agentPath, keyEnvVar) !== null,
      mountFile: rel(agentPath, "extensions", "arcana.ts"),
    };
  }

  if (hasLegacy) {
    const d = brainFromConnection(agentPath);
    const keyEnvVar = d.envVar ?? ARCANA_KEY_VAR;
    return {
      ...base,
      mode: "legacy",
      keyEnvVar,
      workspaceEnvVar: undefined,
      workspace:
        d.workspace ?? readEnvVar(agentPath, ARCANA_WORKSPACE_VAR) ?? undefined,
      hasKey: readEnvVar(agentPath, keyEnvVar) !== null,
      legacyFile: rel(agentPath, "connections", "arcana.ts"),
    };
  }

  // Nothing wired — but a key may already sit in the env (e.g. pulled from
  // Vercel), which lets the UI pre-fill the workspace.
  return {
    ...base,
    workspace: readEnvVar(agentPath, ARCANA_WORKSPACE_VAR) ?? undefined,
    hasKey: readEnvVar(agentPath, ARCANA_KEY_VAR) !== null,
  };
}

/**
 * Resolve the workspace + key Studio should use to browse this agent's brain
 * (read-only REST), from the detected wiring and the dotenv files.
 */
export function resolveBrainCredential(
  agentPath: string,
): { workspace: string; key: string } | null {
  const d = detectBrain(agentPath);
  const key = readEnvVar(agentPath, d.keyEnvVar);
  if (d.workspace && key) {
    return { workspace: d.workspace, key };
  }
  return null;
}

// ------------------------------------------------------------- wiring

/** Which package manager owns this project (by lockfile). */
export function detectPackageManager(
  agentPath: string,
): "pnpm" | "yarn" | "npm" {
  if (existsSync(join(agentPath, "pnpm-lock.yaml"))) {
    return "pnpm";
  }
  if (existsSync(join(agentPath, "yarn.lock"))) {
    return "yarn";
  }
  return "npm";
}

/** The mount file `eve add extension/arcana` would write (spec shape). */
function mountSource(): string {
  return `import arcana from "${ARCANA_PACKAGE}";

/**
 * Kybernesis Arcana — long-term memory for this agent (official eve extension).
 *
 * @remarks
 * Reads \`${ARCANA_KEY_VAR}\` (a workspace-scoped \`kb_\` key) and
 * \`${ARCANA_WORKSPACE_VAR}\`. Contributes the \`arcana__memory\` MCP connection,
 * the recall / remember / brain-note skills, and always-on memory instructions.
 * Wired by Eve Studio.
 *
 * @see {@link https://eve.dev/integrations/arcana | eve.dev/integrations/arcana}
 */
export default arcana({
  apiKey: process.env.${ARCANA_KEY_VAR}!,
  workspace: process.env.${ARCANA_WORKSPACE_VAR}!,
});
`;
}

/**
 * Install `@kybernesis/arcana` with the project's own package manager, working
 * around the published peer range (`eve >=0.38 <0.39`) that makes `eve add`
 * fail on npm-managed eve 0.49 projects.
 */
async function installPackageFallback(
  agentPath: string,
  onLine?: (line: string) => void,
): Promise<{ ok: boolean; pm: "pnpm" | "yarn" | "npm"; output: string }> {
  const pm = detectPackageManager(agentPath);
  const args =
    pm === "pnpm"
      ? ["add", ARCANA_PACKAGE]
      : pm === "yarn"
        ? ["add", ARCANA_PACKAGE]
        : ["install", ARCANA_PACKAGE, "--legacy-peer-deps"];
  const cmd = process.platform === "win32" ? `${pm}.cmd` : pm;
  onLine?.(`\n$ ${pm} ${args.join(" ")}\n`);
  // Streams stdout/stderr straight into the same console as the eve add step.
  const res = await runCommand(cmd, args, {
    cwd: agentPath,
    timeout: 5 * 60_000,
    onLine,
  });
  if (res.error) {
    onLine?.(`\n[${pm} failed] ${res.error}\n`);
  }
  const output = `${res.stdout}${res.stderr}${res.error ? `\n${res.error}` : ""}`;
  return { ok: !res.error && res.status === 0, pm, output };
}

/**
 * Attach an Arcana brain to an agent through the official extension.
 *
 * Steps: validate the key read-only → `eve add extension/arcana --skip-setup`
 * (falling back to a package-manager install + writing the mount file when the
 * registry install fails on the peer range) → upsert `ARCANA_API_KEY` +
 * `ARCANA_WORKSPACE` in `.env.local`. The Vercel push is the IPC layer's job.
 */
export async function wireBrain(
  agentPath: string,
  input: WireBrainInput,
  onLine?: (line: string) => void,
): Promise<WireBrainResult> {
  const workspace = input.workspace.trim();
  const key = input.key.trim();
  const files: string[] = [];
  const warnings: string[] = [];
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(workspace)) {
    return {
      ok: false,
      usedFallback: false,
      files,
      error: "Workspace slug looks wrong (letters, digits, dashes).",
    };
  }
  if (!key) {
    return {
      ok: false,
      usedFallback: false,
      files,
      error: "API key is required.",
    };
  }

  // (a) validate read-only before touching anything
  if (!input.skipValidate) {
    const ping = await arcanaPing(workspace, key);
    if (!ping.ok) {
      return {
        ok: false,
        usedFallback: false,
        files,
        error: `Key rejected: ${ping.error}`,
      };
    }
  }

  // (c) mount the extension unless it's already there
  const before = detectBrain(agentPath);
  let usedFallback = false;
  let packageManager: WireBrainResult["packageManager"];
  let addOutput = "";
  const collect = (l: string): void => {
    addOutput += l;
    onLine?.(l);
  };
  if (before.mode === "extension" && before.packageInstalled) {
    collect("Arcana extension already mounted: updating env only.\n");
  } else {
    const add = await registryAdd(
      agentPath,
      "extension/arcana",
      { skipSetup: true },
      collect,
    );
    if (add.status === "done") {
      files.push(...(add.files ?? [rel(agentPath, "extensions", "arcana.ts")]));
    } else if (add.failureCode === "dependency_install") {
      collect(
        `\n${ARCANA_PACKAGE} could not be installed by eve add (its published peer range predates eve 0.49). Installing directly…\n`,
      );
      const inst = await installPackageFallback(agentPath, collect);
      packageManager = inst.pm;
      if (!inst.ok) {
        return {
          ok: false,
          usedFallback: true,
          packageManager,
          files,
          addOutput,
          error: `Installing ${ARCANA_PACKAGE} with ${inst.pm} failed. See output.`,
        };
      }
      const dir = join(agentRoot(agentPath), "extensions");
      mkdirSync(dir, { recursive: true });
      const file = join(dir, "arcana.ts");
      if (!existsSync(file)) {
        writeFileSync(file, mountSource());
      }
      files.push(rel(agentPath, "extensions", "arcana.ts"));
      usedFallback = true;
      warnings.push(
        `Installed ${ARCANA_PACKAGE} with ${inst.pm}${inst.pm === "npm" ? " --legacy-peer-deps" : ""} because its published peerDependencies still pin eve 0.38. It mounts cleanly on 0.49; the package's peer range needs updating upstream.`,
      );
    } else if (add.status === "needs-input") {
      return {
        ok: false,
        usedFallback: false,
        files,
        addOutput,
        error: `eve add needs input: ${add.message ?? "see output"}${add.nextCommand ? `. Run \`${add.nextCommand}\` in a terminal.` : ""}`,
      };
    } else {
      return {
        ok: false,
        usedFallback: false,
        files,
        addOutput,
        error: add.message ?? "eve add extension/arcana failed.",
      };
    }
  }

  // (b) env — after the install so an `eve add` rollback can't undo it
  files.push(
    ...new Set([
      ...upsertLocalEnv(agentPath, ARCANA_WORKSPACE_VAR, workspace),
      ...upsertLocalEnv(agentPath, ARCANA_KEY_VAR, key),
    ]),
  );

  return {
    ok: true,
    usedFallback,
    packageManager,
    files,
    addOutput,
    warnings: warnings.length ? warnings : undefined,
    envVars: [ARCANA_KEY_VAR, ARCANA_WORKSPACE_VAR],
  };
}

/**
 * Move a legacy `connections/arcana.ts` agent onto the official extension:
 * wire the extension with the credential the legacy file reads, confirm with
 * `eve info` (0 errors + the mount present), and only then delete the legacy
 * connection file.
 */
export async function migrateLegacyBrain(
  agentPath: string,
  onLine?: (line: string) => void,
): Promise<MigrateBrainResult> {
  const d = detectBrain(agentPath);
  const legacyPath = join(agentRoot(agentPath), "connections", "arcana.ts");
  if (!existsSync(legacyPath)) {
    return {
      ok: false,
      removedLegacy: false,
      error: "No legacy connections/arcana.ts to migrate.",
    };
  }
  const legacy = brainFromConnection(agentPath);
  const workspace = d.workspace ?? legacy.workspace;
  const key = legacy.envVar ? keyFromEnv(agentPath, legacy.envVar) : null;
  if (!workspace || !key) {
    return {
      ok: false,
      removedLegacy: false,
      error: `Couldn't read the legacy workspace/key (${legacy.envVar ?? "no env var"} in .env.local). Wire the extension manually with the key, then delete connections/arcana.ts.`,
    };
  }
  const wired = await wireBrain(
    agentPath,
    { workspace, key, skipValidate: false },
    onLine,
  );
  if (!wired.ok) {
    return { ok: false, removedLegacy: false, wire: wired, error: wired.error };
  }
  onLine?.("\n$ eve info --json\n");
  const info = await eveInfo(agentPath);
  const mounted = detectBrain(agentPath).mode === "extension";
  if (!info.ok || info.errors !== 0 || !mounted) {
    return {
      ok: false,
      removedLegacy: false,
      wire: wired,
      info,
      error: !mounted
        ? "The extension is not reported as mounted yet: legacy connection kept."
        : `eve info reports ${info.errors} error(s): legacy connection kept. ${info.error ?? ""}`.trim(),
    };
  }
  unlinkSync(legacyPath);
  onLine?.(`removed ${rel(agentPath, "connections", "arcana.ts")}\n`);
  const after = await eveInfo(agentPath);
  // The migration itself is done at this point (extension mounted, legacy file
  // removed). Only a post-check that actually ran and found errors is a failure;
  // a post-check that could not run is a warning, not a rollback signal.
  if (!after.ok && after.errors < 0) {
    return {
      ok: true,
      removedLegacy: true,
      wire: wired,
      info: after,
      warning: `Migrated, but the follow-up \`eve info\` could not run: ${after.error ?? "unknown error"}. Reload the structure to confirm.`,
    };
  }
  return {
    ok: after.errors === 0,
    removedLegacy: true,
    wire: wired,
    info: after,
    error:
      after.errors === 0
        ? undefined
        : `Migrated, but eve info now reports ${after.errors} error(s). Open the Structure tab for diagnostics.`,
  };
}

// ------------------------------------------------------------- memory slots

function inferProvider(src: string): MemorySlot["provider"] {
  if (/@supermemory\/eve/.test(src)) {
    return "supermemory";
  }
  if (/eve\/memory\/file|fileMemory\s*\(/.test(src)) {
    return "file";
  }
  return "custom";
}

/**
 * List the agent's memory slots (`agent/memory.ts` → slot "memory",
 * `agent/memory/<slot>.ts`), merging the compiled manifest's `memories[]`
 * with what's on disk, and inferring the provider from each slot's source.
 */
export function listMemorySlots(agentPath: string): MemorySlotsResult {
  const root = agentRoot(agentPath);
  const m = readManifest(agentPath);
  const bySlot = new Map<string, MemorySlot>();
  for (const x of arr(m?.memories)) {
    const slot = String(x.slot ?? "");
    const logical = String(x.logicalPath ?? `memory/${slot}.ts`);
    // Skip manifest entries whose source is gone (stale manifest after a delete).
    if (!slot || !existsSync(join(root, logical))) {
      continue;
    }
    bySlot.set(slot, {
      slot,
      description:
        typeof x.description === "string" ? x.description : undefined,
      visibility: typeof x.visibility === "string" ? x.visibility : undefined,
      logicalPath: String(x.logicalPath ?? `memory/${slot}.ts`),
      relPath: rel(agentPath, String(x.logicalPath ?? `memory/${slot}.ts`)),
      provider: "unknown",
      fromManifest: true,
    });
  }
  const onDisk: { slot: string; file: string; logical: string }[] = [];
  const single = join(root, "memory.ts");
  if (existsSync(single)) {
    onDisk.push({ slot: "memory", file: single, logical: "memory.ts" });
  }
  try {
    for (const e of readdirSync(join(root, "memory"), {
      withFileTypes: true,
    })) {
      if (e.isFile() && /\.tsx?$/.test(e.name)) {
        const slot = e.name.replace(/\.tsx?$/, "");
        onDisk.push({
          slot,
          file: join(root, "memory", e.name),
          logical: `memory/${e.name}`,
        });
      }
    }
  } catch {
    // no memory/ dir
  }
  for (const f of onDisk) {
    const src = readFileSync(f.file, "utf8");
    const existing = bySlot.get(f.slot);
    const desc = /description\s*:\s*(["'`])((?:(?!\1)[\s\S])*)\1/.exec(
      src,
    )?.[2];
    bySlot.set(f.slot, {
      slot: f.slot,
      description: existing?.description ?? desc,
      visibility: existing?.visibility,
      logicalPath: existing?.logicalPath ?? f.logical,
      relPath: rel(agentPath, f.logical),
      provider: inferProvider(src),
      fromManifest: existing?.fromManifest ?? false,
    });
  }
  return {
    slots: [...bySlot.values()].sort((a, b) => a.slot.localeCompare(b.slot)),
    source: m ? "manifest" : "disk",
  };
}

/** Scaffold `agent/memory/<slot>.ts` with the built-in file provider. */
export function addFileMemory(
  agentPath: string,
  slot = "profile",
  description = "Remember stable facts and preferences about the caller.",
): { ok: boolean; relPath?: string; error?: string } {
  const safe = slot
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-");
  if (!safe) {
    return { ok: false, error: "Slot name is required." };
  }
  const dir = join(agentRoot(agentPath), "memory");
  const file = join(dir, `${safe}.ts`);
  if (existsSync(file) || existsSync(join(agentRoot(agentPath), "memory.ts"))) {
    return {
      ok: false,
      error: `A memory slot already exists at ${rel(agentPath, "memory", `${safe}.ts`)} (or memory.ts).`,
    };
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    file,
    `import { defineMemory } from "eve/memory";
import { byPrincipal } from "eve/memory/scope";
import { fileMemory } from "eve/memory/file";

/**
 * "${safe}" memory slot — eve's built-in file provider.
 *
 * @remarks
 * Shared local storage under \`eve dev\`, Vercel Blob when deployed. Tools
 * surface to the model as \`${safe}__save_memory\` / \`${safe}__remove_memory\`.
 * Scoped per authenticated principal. Wired by Eve Studio.
 *
 * @see {@link https://eve.dev/docs/memory/overview | eve.dev/docs/memory}
 */
export default defineMemory({
  description: ${JSON.stringify(description)},
  provider: fileMemory(),
  scope: byPrincipal,
});
`,
  );
  return { ok: true, relPath: rel(agentPath, "memory", `${safe}.ts`) };
}

/** Whether the experimental self-modification subagent is installed. */
export function selfModificationStatus(agentPath: string): {
  enabled: boolean;
  relPath: string;
} {
  const dir = join(agentRoot(agentPath), "subagents", "self-modification");
  return {
    enabled: existsSync(dir),
    relPath: rel(agentPath, "subagents", "self-modification"),
  };
}

/** Safe extension namespace → `agent/extensions/<ns>.ts` (or flat). */
function mountPathFor(
  agentPath: string,
  ns: string,
): { abs: string; relPath: string } {
  const safe = ns
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "");
  if (!safe) {
    throw new Error("Extension namespace is required.");
  }
  return {
    abs: join(agentRoot(agentPath), "extensions", `${safe}.ts`),
    relPath: rel(agentPath, "extensions", `${safe}.ts`),
  };
}

/** Read an extension mount file (e.g. `agent/extensions/arcana.ts`). */
export function readExtensionMount(
  agentPath: string,
  ns: string,
): { relPath: string; content: string; exists: boolean } {
  const p = mountPathFor(agentPath, ns);
  const exists = existsSync(p.abs);
  return {
    relPath: p.relPath,
    content: exists ? readFileSync(p.abs, "utf8") : "",
    exists,
  };
}

/** Overwrite an existing extension mount file (never creates one). */
export function writeExtensionMount(
  agentPath: string,
  ns: string,
  content: string,
): { ok: boolean; relPath?: string; error?: string } {
  const p = mountPathFor(agentPath, ns);
  if (!existsSync(p.abs)) {
    return { ok: false, error: `${p.relPath} does not exist.` };
  }
  writeFileSync(p.abs, content);
  return { ok: true, relPath: p.relPath };
}
