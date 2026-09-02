import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  CmdResult,
  ConnectorItem,
  ModelReadiness,
  ProdInfo,
  VercelStatus,
  VercelTeam,
  VercelTeamsResult,
  VercelWhoami,
} from "../shared/ipc";

function vercelBin(): string {
  return process.platform === "win32" ? "vercel.cmd" : "vercel";
}
function npxBin(): string {
  return process.platform === "win32" ? "npx.cmd" : "npx";
}

/**
 * Resolve how to invoke the Vercel CLI once: a global `vercel` if on PATH, else
 * `npx vercel@latest` on our provisioned Node. Cached so we probe only once.
 */
let vcResolved: { cmd: string; pre: string[] } | null = null;
function resolveVercel(): { cmd: string; pre: string[] } {
  if (vcResolved) {
    return vcResolved;
  }
  const probe = spawnSync(vercelBin(), ["--version"], { timeout: 15_000 });
  vcResolved =
    (probe.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT"
      ? { cmd: npxBin(), pre: ["--yes", "vercel@latest"] }
      : { cmd: vercelBin(), pre: [] };
  return vcResolved;
}

/** Read link state from .vercel/project.json. */
export function vercelStatus(agentPath: string): VercelStatus {
  const p = join(agentPath, ".vercel", "project.json");
  if (!existsSync(p)) {
    return { linked: false };
  }
  try {
    const j = JSON.parse(readFileSync(p, "utf8")) as {
      projectName?: string;
      projectId?: string;
      orgId?: string;
    };
    return {
      linked: true,
      projectName: j.projectName ?? null,
      projectId: j.projectId ?? null,
      orgId: j.orgId ?? null,
    };
  } catch {
    return { linked: false };
  }
}

function run(agentPath: string, args: string[], input?: string): CmdResult {
  try {
    const v = resolveVercel();
    const res = spawnSync(v.cmd, [...v.pre, ...args], {
      cwd: agentPath,
      encoding: "utf8",
      timeout: 180_000,
      input,
      env: { ...process.env, NO_COLOR: "1" },
    });
    if (res.error) {
      const msg =
        (res.error as NodeJS.ErrnoException).code === "ENOENT"
          ? "Couldn't run Vercel — the runtime isn't ready yet. Try again in a moment."
          : res.error.message;
      return { ok: false, output: msg };
    }
    const out = `${res.stdout ?? ""}${res.stderr ?? ""}`.trim();
    return { ok: res.status === 0, output: out || `(exit ${res.status})` };
  } catch (e) {
    return { ok: false, output: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Non-blocking variant of {@link run} for slow/interactive commands.
 *
 * @remarks
 * `spawnSync` freezes the Electron main process (and the whole UI) until the
 * command returns — fine for quick reads, fatal for `connect create`/`attach`,
 * which wait on browser OAuth. This spawns asynchronously so the event loop
 * stays free, closes stdin so the CLI can never block waiting for input, and
 * kills the child on timeout instead of hanging.
 */
function runAsync(
  agentPath: string,
  args: string[],
  timeoutMs = 180_000,
  input?: string,
): Promise<CmdResult> {
  return new Promise((resolve) => {
    let v: { cmd: string; pre: string[] };
    try {
      v = resolveVercel();
    } catch (e) {
      resolve({
        ok: false,
        output: e instanceof Error ? e.message : String(e),
      });
      return;
    }
    const child = spawn(v.cmd, [...v.pre, ...args], {
      cwd: agentPath,
      env: { ...process.env, NO_COLOR: "1" },
      // Pipe stdin only when we have input to feed (e.g. `env add`); otherwise
      // ignore it so an interactive command can never hang waiting on input.
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    if (input !== undefined) {
      child.stdin?.end(input);
    }
    let out = "";
    let done = false;
    const finish = (r: CmdResult): void => {
      if (!done) {
        done = true;
        resolve(r);
      }
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({
        ok: false,
        output:
          `${out}\n(timed out after ${Math.round(timeoutMs / 1000)}s — the command may need a browser step; continue in Vercel Connect)`.trim(),
      });
    }, timeoutMs);
    child.stdout?.on("data", (d) => {
      out += d.toString();
    });
    child.stderr?.on("data", (d) => {
      out += d.toString();
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      const msg =
        (e as NodeJS.ErrnoException).code === "ENOENT"
          ? "Couldn't run Vercel — the runtime isn't ready yet. Try again in a moment."
          : e.message;
      finish({ ok: false, output: msg });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      finish({ ok: code === 0, output: out.trim() || `(exit ${code})` });
    });
  });
}

/** `vercel env ls` — list production/preview/development env var names. */
export function vercelEnvLs(agentPath: string): CmdResult {
  return run(agentPath, ["env", "ls"]);
}

/** `vercel env pull .env.local --yes` — sync remote env down. */
export function vercelEnvPull(agentPath: string): Promise<CmdResult> {
  // Async on purpose: callers refresh a stale VERCEL_OIDC_TOKEN mid-request
  // (gateway catalog, Arcana wiring), and a spawnSync pull would freeze the UI for
  // the several seconds the CLI takes.
  return runAsync(agentPath, ["env", "pull", ".env.local", "--yes"], 120_000);
}

/** Env var NAMES set on the linked Vercel project (across all targets). */
export async function vercelEnvNames(agentPath: string): Promise<string[]> {
  const r = await runAsync(agentPath, ["env", "ls"], 60_000);
  if (!r.ok) {
    return [];
  }
  const names = new Set<string>();
  for (const line of r.output.split("\n")) {
    const tok = line.trim().split(/\s+/)[0];
    if (/^[A-Z][A-Z0-9_]{2,}$/.test(tok)) {
      names.add(tok);
    }
  }
  return [...names];
}

const MODEL_CRED_VARS = [
  "VERCEL_OIDC_TOKEN",
  "AI_GATEWAY_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
];

/** Can this agent's model actually run locally? (linked + a gateway/provider credential) */
export function modelReadiness(agentPath: string): ModelReadiness {
  const linked = existsSync(join(agentPath, ".vercel", "project.json"));
  let hasCredential = false;
  for (const f of [".env.local", ".env"]) {
    const p = join(agentPath, f);
    if (!existsSync(p)) {
      continue;
    }
    const src = readFileSync(p, "utf8");
    for (const v of MODEL_CRED_VARS) {
      const m = new RegExp(`^\\s*${v}\\s*=\\s*(.+)$`, "m").exec(src);
      if (m && m[1].trim().replace(/^["']|["']$/g, "")) {
        hasCredential = true;
        break;
      }
    }
    if (hasCredential) {
      break;
    }
  }
  return { linked, hasCredential };
}

/**
 * Link the agent to Vercel and pull an AI Gateway credential — all non-interactively.
 * `vercel link --yes` creates/links a project under the default team; `env pull`
 * drops VERCEL_OIDC_TOKEN into .env.local so the model can run locally.
 *
 * @remarks
 * Async on purpose: `spawnSync` freezes the whole Electron UI until it returns,
 * and `link` + `env pull` can each take many seconds (or download the CLI on a
 * first run). Running them via {@link runAsync} keeps the app responsive.
 */
export async function vercelLink(
  agentPath: string,
  team?: string,
): Promise<CmdResult> {
  // Accounts with >1 team can't be auto-selected non-interactively, so pass the
  // chosen team explicitly (from the UI's team picker) to both commands.
  const scope = team ? ["--team", team] : [];
  const link = await runAsync(agentPath, ["link", "--yes", ...scope], 120_000);
  const pull = await runAsync(
    agentPath,
    ["env", "pull", ".env.local", "--yes", ...scope],
    120_000,
  );
  return {
    ok: link.ok && pull.ok,
    output: `$ vercel link --yes${team ? ` --team ${team}` : ""}\n${link.output}\n\n$ vercel env pull\n${pull.output}`,
  };
}

/** List the teams/scopes the signed-in user belongs to (`vercel teams ls`). */
export async function vercelTeams(
  agentPath: string,
): Promise<VercelTeamsResult> {
  const r = await runAsync(agentPath, ["teams", "ls"], 60_000);
  if (!r.ok) {
    return { ok: false, teams: [], error: r.output };
  }
  const teams: VercelTeam[] = [];
  for (const raw of r.output.split("\n")) {
    // Strip a leading "current team" marker (● / > / *) and normalize.
    const line = raw.replace(/^\s*[●>*]\s*/, "").trim();
    if (!line || /vercel cli|fetching|^id\b/i.test(line)) {
      continue;
    }
    const parts = line.split(/\s{2,}/);
    const id = parts[0]?.trim();
    // Team slugs never contain spaces — guards against stray output lines.
    if (id && !id.includes(" ")) {
      teams.push({ id, name: (parts[1] ?? id).trim() });
    }
  }
  return { ok: true, teams };
}

/** Who is signed in to the Vercel CLI, if anyone (`vercel whoami`). */
export async function vercelWhoami(agentPath: string): Promise<VercelWhoami> {
  // Polled every few seconds during sign-in — must be async so each probe never
  // blocks the UI thread (see {@link vercelLink}).
  const r = await runAsync(agentPath, ["whoami"], 30_000);
  if (
    !r.ok ||
    /no existing credentials|not authenticated|vercel login/i.test(r.output)
  ) {
    return { authed: false };
  }
  const user = r.output
    .split("\n")
    .map((l) => l.trim())
    .filter(
      (l) =>
        l &&
        !/vercel cli|fetching|telemetry|learn more|^>|^error|https?:\/\//i.test(
          l,
        ),
    )
    .pop();
  return user ? { authed: true, user } : { authed: false };
}

/**
 * Start the browser-based Vercel sign-in, streaming the CLI's output (it prints a
 * `vercel.com/oauth/device` URL and opens the browser). The caller detects success
 * by polling {@link vercelWhoami} and reacts to exit for the failure path. Returns
 * the child process so the caller can kill it on cancel/timeout.
 *
 * @remarks
 * Uses the modern OAuth device flow — no email, no terminal. `--non-interactive`
 * is required, not optional: without a TTY, a bare `vercel login` blocks forever
 * on an interactive provider prompt it can never receive (the indefinite hang
 * users hit). With the flag the CLI goes straight to the device URL and waits on
 * the browser step. stdin is ignored so nothing can ever wait on input. (The old
 * `vercel login <email>` positional is deprecated and prints a warning.)
 */
export function startVercelLogin(
  agentPath: string,
  onData: (s: string) => void,
  onExit: (code: number | null) => void,
): ChildProcess {
  const v = resolveVercel();
  const child = spawn(v.cmd, [...v.pre, "login", "--non-interactive"], {
    cwd: agentPath,
    env: { ...process.env, NO_COLOR: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (b: Buffer) => onData(b.toString()));
  child.stderr?.on("data", (b: Buffer) => onData(b.toString()));
  child.on("error", (e) => {
    onData(`\n[failed to launch] ${e.message}\n`);
    onExit(-1);
  });
  child.on("exit", (code) => onExit(code));
  return child;
}

/** Latest production deployment for the linked project, from `vercel ls --prod`. */
export function vercelProdInfo(agentPath: string): ProdInfo {
  let project = "";
  try {
    project =
      (
        JSON.parse(
          readFileSync(join(agentPath, ".vercel", "project.json"), "utf8"),
        ) as { projectName?: string }
      ).projectName ?? "";
  } catch {
    // not linked
  }
  const r = run(agentPath, ["ls", "--prod"]);
  if (!r.ok && !r.output.includes("https://")) {
    return { ok: false, error: r.output };
  }
  for (const line of r.output.split("\n")) {
    if (!line.includes("https://")) {
      continue;
    }
    if (
      project &&
      !line.includes(`/${project} `) &&
      !line.includes(`/${project}\t`)
    ) {
      continue;
    }
    const url = (/https:\/\/\S+/.exec(line) ?? [""])[0];
    const age = (/^\s*(\S+)/.exec(line) ?? ["", ""])[1];
    return { ok: true, url, age, ready: /Ready|●/i.test(line) };
  }
  return { ok: true };
}

/**
 * The stable production alias (auto-tracks the latest prod deploy), for webhooks
 * that must survive redeploys.
 *
 * @remarks
 * `vercel ls --prod` returns the *per-deployment* immutable URL — registering a
 * webhook there breaks on the next deploy. The production aliases (from
 * `vercel inspect`) always point at current prod, so we prefer the shortest one
 * (a custom domain if present, else the clean `<project>-<hash>.vercel.app`).
 */
export async function vercelProdAlias(
  agentPath: string,
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const ls = await runAsync(agentPath, ["ls", "--prod"], 60_000);
  const deployUrl = (/https:\/\/\S+/.exec(ls.output) ?? [""])[0];
  if (!deployUrl) {
    return {
      ok: false,
      error: ls.output || "No production deployment found — deploy first.",
    };
  }
  const insp = await runAsync(agentPath, ["inspect", deployUrl], 60_000);
  const aliases = [
    ...insp.output.matchAll(/https:\/\/[a-z0-9.-]+\.vercel\.app/gi),
  ]
    .map((m) => m[0])
    .filter((u) => u !== deployUrl);
  if (aliases.length === 0) {
    return { ok: true, url: deployUrl };
  }
  const best = aliases.sort((a, b) => a.length - b.length)[0];
  return { ok: true, url: best.replace(/\/+$/, "") };
}

/** `vercel env add <NAME> <target>` with the value fed on stdin (non-interactive). */
export function vercelEnvAdd(
  agentPath: string,
  name: string,
  value: string,
  target: string,
): CmdResult {
  return run(agentPath, ["env", "add", name, target], `${value}\n`);
}

/** Idempotently set an env var for a target (remove any existing, then add). */
export async function vercelEnvSet(
  agentPath: string,
  name: string,
  value: string,
  target: string,
): Promise<CmdResult> {
  await runAsync(agentPath, ["env", "rm", name, target, "--yes"], 60_000); // ignore "not found"
  return runAsync(
    agentPath,
    ["env", "add", name, target],
    60_000,
    `${value}\n`,
  );
}

/** Set an env var across production/preview/development so it works everywhere. */
export async function vercelEnvSetAll(
  agentPath: string,
  name: string,
  value: string,
): Promise<CmdResult> {
  let ok = true;
  let output = "";
  for (const target of ["production", "preview", "development"]) {
    const r = await vercelEnvSet(agentPath, name, value, target);
    ok = ok && r.ok;
    output += `[${target}] ${r.output}\n`;
  }
  return { ok, output };
}

// ---------------- Vercel Connect ----------------
/** List Connect connectors for the linked project (optionally by service). */
export async function vercelConnectList(
  agentPath: string,
  service?: string,
): Promise<{ ok: boolean; connectors: ConnectorItem[]; output?: string }> {
  const args = [
    "connect",
    "list",
    "--format",
    "json",
    "--non-interactive",
    "--all-projects",
  ];
  if (service) {
    args.push("--service", service);
  }
  const r = await runAsync(agentPath, args);
  if (!r.ok) {
    return { ok: false, connectors: [], output: r.output };
  }
  // The CLI prints a banner to stderr; extract just the JSON object
  // (first "{" through the matching last "}") so trailing text can't break parse.
  const start = r.output.indexOf("{");
  const end = r.output.lastIndexOf("}");
  if (start < 0 || end < start) {
    return { ok: true, connectors: [] };
  }
  try {
    const parsed = JSON.parse(r.output.slice(start, end + 1)) as {
      connectors?: Array<Record<string, unknown>>;
    };
    const connectors = (parsed.connectors ?? []).map((c) => ({
      uid: String(c.uid ?? ""),
      id: String(c.id ?? ""),
      name: String(c.name ?? c.uid ?? ""),
      type: String(c.type ?? ""),
    }));
    return { ok: true, connectors };
  } catch {
    return { ok: true, connectors: [], output: r.output };
  }
}

/**
 * Create a Connect connector, streaming the CLI's output as it arrives.
 *
 * @remarks
 * Managed services (slack/github/linear) print a **single-use** authorize URL
 * and then block until the browser step finishes. Buffering the output until the
 * command returns is therefore a deadlock: the link only surfaces once its code
 * is already spent or expired, so every click 409s with "Request code is already
 * in use" and the connector is never created. Streaming puts the link on screen
 * the moment it's printed, while it still works.
 *
 * @param onChunk - Called with each stdout/stderr chunk as it arrives.
 * @returns The full output once the command exits (or times out).
 */
export function vercelConnectCreateStream(
  agentPath: string,
  type: string,
  name: string,
  triggers: boolean,
  onChunk: (data: string) => void,
): Promise<CmdResult> {
  const args = ["connect", "create", type, "--name", name];
  if (triggers) {
    args.push("--triggers");
  }
  return new Promise((resolve) => {
    let v: { cmd: string; pre: string[] };
    try {
      v = resolveVercel();
    } catch (e) {
      resolve({
        ok: false,
        output: e instanceof Error ? e.message : String(e),
      });
      return;
    }
    const child = spawn(v.cmd, [...v.pre, ...args], {
      cwd: agentPath,
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let done = false;
    const finish = (r: CmdResult): void => {
      if (!done) {
        done = true;
        resolve(r);
      }
    };
    // Generous: the clock is the user's browser step, not the CLI.
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({
        ok: false,
        output:
          `${out}\n(timed out — finish authorizing in the browser, then Refresh)`.trim(),
      });
    }, 300_000);
    const emit = (d: Buffer): void => {
      const s = d.toString();
      out += s;
      onChunk(s);
    };
    child.stdout?.on("data", emit);
    child.stderr?.on("data", emit);
    child.on("error", (e) => {
      clearTimeout(timer);
      finish({ ok: false, output: e.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      finish({ ok: code === 0, output: out.trim() || `(exit ${code})` });
    });
  });
}

/**
 * Create a Connect connector: `vercel connect create <type> --name <n> [--triggers]`.
 * Managed services (slack/github/linear) may return an authorize URL to complete
 * app installation in the browser.
 */
export function vercelConnectCreate(
  agentPath: string,
  type: string,
  name: string,
  triggers: boolean,
): Promise<CmdResult> {
  const args = ["connect", "create", type, "--name", name, "--format", "json"];
  if (triggers) {
    args.push("--triggers");
  }
  // Managed services open a browser OAuth step — cap the wait so a stalled
  // authorization surfaces a message instead of hanging the UI.
  return runAsync(agentPath, args, 120_000);
}

/** Map each Connect connector UID → the Vercel project ids it's attached to. */
export async function vercelConnectProjectsMap(
  agentPath: string,
): Promise<Record<string, string[]>> {
  const map: Record<string, string[]> = {};
  const r = await runAsync(agentPath, [
    "connect",
    "list",
    "--format",
    "json",
    "--non-interactive",
    "--all-projects",
  ]);
  if (!r.ok) {
    return map;
  }
  const start = r.output.indexOf("{");
  const end = r.output.lastIndexOf("}");
  if (start < 0 || end < start) {
    return map;
  }
  try {
    const parsed = JSON.parse(r.output.slice(start, end + 1)) as {
      connectors?: { uid?: string; projects?: { id?: string }[] }[];
    };
    for (const c of parsed.connectors ?? []) {
      if (c.uid) {
        map[String(c.uid)] = (c.projects ?? []).map((p) => String(p.id));
      }
    }
  } catch {
    // leave the map as-is
  }
  return map;
}

/**
 * Attach the current project to a connector (with an eve trigger path for channels).
 *
 * When re-pointing a trigger, the Connect docs prescribe a detach → attach dance:
 * `create --triggers` provisions a trigger at the default Connect path (which eve
 * doesn't serve), so we detach it first, then re-attach at `/eve/v1/<svc>`. The
 * detach is best-effort (project-scoped, harmless if nothing is attached) which
 * also makes re-running setup idempotent instead of stacking a stale trigger.
 */
export async function vercelConnectAttach(
  agentPath: string,
  connector: string,
  triggerPath?: string,
): Promise<CmdResult> {
  if (triggerPath) {
    await runAsync(
      agentPath,
      ["connect", "detach", connector, "--yes"],
      60_000,
    );
  }
  const args = ["connect", "attach", connector, "--yes"];
  if (triggerPath) {
    args.push("--triggers", "--trigger-path", triggerPath);
  }
  return runAsync(agentPath, args, 120_000);
}
