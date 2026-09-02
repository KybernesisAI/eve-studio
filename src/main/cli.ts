import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ChannelItem,
  CmdResult,
  EvalItem,
} from "../shared/ipc";

/**
 * Resolve the eve CLI: prefer the project-local bin, else fall back to npx.
 *
 * @remarks
 * The npx fallback passes `--yes` so npx auto-installs the public `eve` package
 * without the interactive "Ok to proceed?" prompt — our child processes run with
 * stdin ignored and can't answer it, which otherwise aborts `eve init` on a
 * machine that has never installed eve (surfacing as "No package.json").
 *
 * It also pins `eve@latest`: a bare `npx eve` lets npm's engine-aware version
 * picker fall back to an ancient, unrelated `eve@0.5.4` (no bin → "could not
 * determine executable to run") when the current Node is older than what the
 * real Eve requires. Pinning forces the real, current package.
 *
 * Every eve invocation in Studio (dev server, build, deploy, info, set, add,
 * eval, init) goes through this so they all agree on which eve runs.
 */
export function eveBin(cwd: string): { cmd: string; pre: string[] } {
  const local = join(cwd, "node_modules", ".bin", "eve");
  if (existsSync(local)) {
    return { cmd: local, pre: [] };
  }
  return {
    cmd: process.platform === "win32" ? "npx.cmd" : "npx",
    pre: ["--yes", "eve@latest"],
  };
}

const CLEAN_ENV = { NO_COLOR: "1", FORCE_COLOR: "0" };

/**
 * Streams long-running eve subcommands (build / deploy / eval / init) to the
 * renderer chunk-by-chunk, keyed by a caller-supplied runId.
 */
export class CliRunner {
  private readonly runs = new Map<string, ChildProcess>();

  constructor(
    private readonly onChunk: (runId: string, data: string) => void,
    private readonly onExit: (runId: string, code: number | null) => void,
  ) {}

  /** Spawn `eve <args>` in `cwd`, streaming output under `runId`. */
  run(runId: string, cwd: string, args: string[]): void {
    const bin = eveBin(cwd);
    const proc = spawn(bin.cmd, [...bin.pre, ...args], {
      cwd,
      env: { ...process.env, ...CLEAN_ENV },
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.runs.set(runId, proc);

    const emit = (b: Buffer): void => this.onChunk(runId, b.toString());
    proc.stdout?.on("data", emit);
    proc.stderr?.on("data", emit);
    proc.on("error", (err) => {
      this.onChunk(runId, `\n[failed to launch] ${err.message}\n`);
      this.runs.delete(runId);
      this.onExit(runId, -1);
    });
    proc.on("close", (code) => {
      this.runs.delete(runId);
      this.onExit(runId, code);
    });
  }

  cancel(runId: string): void {
    const p = this.runs.get(runId);
    if (p) {
      try {
        p.kill("SIGTERM");
      } catch {
        // already gone
      }
    }
  }

  cancelAll(): void {
    for (const [, p] of this.runs) {
      try {
        p.kill("SIGTERM");
      } catch {
        // already gone
      }
    }
    this.runs.clear();
  }
}

/** Run `eve <args>` to completion (blocking), returning stdout/stderr. */
function runSync(
  cwd: string,
  args: string[],
  timeout = 60_000,
): { status: number | null; stdout: string; stderr: string; error?: Error } {
  const bin = eveBin(cwd);
  const res = spawnSync(bin.cmd, [...bin.pre, ...args], {
    cwd,
    encoding: "utf8",
    timeout,
    env: { ...process.env, ...CLEAN_ENV },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    status: res.status,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
    error: res.error,
  };
}

/** Run `eve <args>` to completion without blocking the main process. */
function runAsync(
  cwd: string,
  args: string[],
  timeout = 60_000,
  /**
   * Capture stdout via a file instead of a pipe. Needed for commands that print
   * one large JSON document then `process.exit()`: on macOS Node writes to
   * pipes asynchronously, so a busy reader (Electron's main loop) can lose the
   * tail of the output at exit. File writes are synchronous.
   */
  stdoutToFile = false,
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const bin = eveBin(cwd);
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let capture: { dir: string; file: string; fd: number } | undefined;
    if (stdoutToFile) {
      try {
        const dir = mkdtempSync(join(tmpdir(), "eve-studio-out-"));
        const file = join(dir, "stdout");
        capture = { dir, file, fd: openSync(file, "w") };
      } catch {
        capture = undefined;
      }
    }
    const finish = (status: number | null): void => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        if (capture) {
          try {
            closeSync(capture.fd);
            stdout = readFileSync(capture.file, "utf8");
          } catch {
            // keep whatever we have
          }
          try {
            rmSync(capture.dir, { recursive: true, force: true });
          } catch {
            // best effort
          }
        }
        resolve({ status, stdout, stderr });
      }
    };
    let child: ChildProcess;
    try {
      child = spawn(bin.cmd, [...bin.pre, ...args], {
        cwd,
        env: { ...process.env, ...CLEAN_ENV },
        stdio: ["ignore", capture ? capture.fd : "pipe", "pipe"],
      });
    } catch (e) {
      stderr = e instanceof Error ? e.message : String(e);
      resolve({ status: -1, stdout, stderr });
      return;
    }
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // already gone
      }
      stderr += `\n[timed out after ${Math.round(timeout / 1000)}s]`;
      finish(-1);
    }, timeout);
    child.stdout?.on("data", (b: Buffer) => {
      stdout += b.toString();
    });
    child.stderr?.on("data", (b: Buffer) => {
      stderr += b.toString();
    });
    child.on("error", (err) => {
      stderr += err.message;
      finish(-1);
    });
    child.on("close", (code) => finish(code));
  });
}

/** Extract the first top-level JSON value (object or array) from mixed output. */
function firstJson(out: string, open: "{" | "["): unknown | null {
  const close = open === "{" ? "}" : "]";
  const s = out.indexOf(open);
  const e = out.lastIndexOf(close);
  if (s < 0 || e < s) {
    return null;
  }
  try {
    return JSON.parse(out.slice(s, e + 1));
  } catch {
    return null;
  }
}

/** Discover evals via `eve eval --list --json` (fast, no model calls). */
export function listEvals(cwd: string): EvalItem[] {
  try {
    const res = runSync(cwd, ["eval", "--list", "--json"]);
    const parsed = firstJson(res.stdout, "[");
    return Array.isArray(parsed) ? (parsed as EvalItem[]) : [];
  } catch {
    return [];
  }
}

/** Discover user-authored channels via `eve channels list --json`. */
export function listChannels(cwd: string): ChannelItem[] {
  try {
    const res = runSync(cwd, ["channels", "list", "--json"]);
    // `eve channels list --json` prints { "channels": ["slack", ...] } (names).
    const parsed = firstJson(res.stdout, "{") as { channels?: unknown } | null;
    const list = Array.isArray(parsed?.channels) ? parsed.channels : [];
    return list.map((c) => {
      if (typeof c === "string") {
        return { name: c, kind: c };
      }
      const o = c as Record<string, unknown>;
      const name = String(o.name ?? "");
      return {
        name,
        kind: (o.kind as string | undefined) ?? name,
        method: o.method as string | undefined,
        urlPath: o.urlPath as string | undefined,
      };
    });
  } catch {
    return [];
  }
}

/** Shape of `eve info --json` (eve 0.49) — only the fields Studio reads. */
export interface EveInfoJson {
  appRoot?: string;
  agentRoot?: string;
  layout?: string;
  status?: string;
  diagnostics?: { errors?: number; warnings?: number };
  model?: unknown;
  channels?: { name: string; kind?: string; method?: string; urlPath?: string }[];
  artifacts?: {
    compiledManifest?: string;
    discoveryManifest?: string;
    diagnostics?: string;
  };
}

/**
 * Run `eve info --json`: regenerates `.eve/discovery/*` and the compiled
 * manifest without booting a server (fast), and returns the parsed summary.
 *
 * @remarks
 * Studio uses this as the cheap, reliable "refresh structure" path instead of
 * trusting a possibly stale `.eve/compile/compiled-agent-manifest.json`.
 */
export async function eveInfoJson(
  cwd: string,
): Promise<{ ok: boolean; info?: EveInfoJson; output: string }> {
  const res = await runAsync(cwd, ["info", "--json"], 60_000, true);
  const parsed = firstJson(res.stdout, "{") as EveInfoJson | null;
  const output = `${res.stdout}${res.stderr}`.trim();
  if (res.status !== 0 && !parsed) {
    return { ok: false, output };
  }
  return { ok: res.status === 0, info: parsed ?? undefined, output };
}

/**
 * `eve set --model <id> --reasoning <effort>` — edits `agent/agent.ts` with
 * the same editor as the dev TUI's `/model`. Non-zero exit when the model is
 * `defineDynamic` / provider-SDK authored (the caller falls back to Studio's
 * regex writer).
 *
 * @remarks
 * `--reasoning` is always passed: `provider-default` is how eve removes an
 * authored `reasoning:` field, so a null/absent choice maps to it instead of
 * being omitted (omitting it would leave a stale field in place).
 */
export async function eveSet(
  cwd: string,
  model: string,
  reasoning: string | null | undefined,
): Promise<CmdResult> {
  const args = [
    "set",
    "--model",
    model,
    "--reasoning",
    reasoning || "provider-default",
  ];
  const res = await runAsync(cwd, args, 60_000);
  const out = `${res.stdout}${res.stderr}`.trim();
  return { ok: res.status === 0, output: out || `(exit ${res.status})` };
}

/**
 * Scaffold a new agent with `eve init <name>` (run from the parent dir).
 *
 * @remarks
 * eve init derives the project name from the bare target argument, so it must
 * be run with `cwd` = parent and a slash-free name. It installs dependencies as
 * part of scaffolding, so this streams under `runId` like other CLI runs.
 * `--model` pins the root agent's AI Gateway model (eve's own default is
 * `openai/gpt-5.6-luna-fast`).
 */
export function initAgent(
  runner: CliRunner,
  runId: string,
  parentDir: string,
  name: string,
  webChat: boolean,
  model?: string,
): void {
  const args = ["init", name];
  if (model) {
    args.push("--model", model);
  }
  if (webChat) {
    args.push("--channel-web-nextjs");
  }
  runner.run(runId, parentDir, args);
}

// ---------------- eve upgrade ----------------

let latestCache: { version: string | null; at: number } | null = null;
const LATEST_TTL_MS = 60 * 60 * 1000;

/**
 * The current `eve@latest` version from the npm registry, cached ~1h.
 * Never throws: returns `null` when offline or the registry misbehaves.
 */
export async function eveLatestVersion(force = false): Promise<string | null> {
  if (
    !force &&
    latestCache?.version &&
    Date.now() - latestCache.at < LATEST_TTL_MS
  ) {
    return latestCache.version;
  }
  try {
    const res = await fetch("https://registry.npmjs.org/eve/latest", {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      throw new Error(`registry ${res.status}`);
    }
    const body = (await res.json()) as { version?: unknown };
    const version = typeof body.version === "string" ? body.version : null;
    latestCache = { version, at: Date.now() };
    return version;
  } catch {
    // Keep a stale value if we had one; otherwise report unknown.
    return latestCache?.version ?? null;
  }
}

/** Installed eve version in the project's node_modules, or null. */
export function installedEveVersion(cwd: string): string | null {
  try {
    return (
      JSON.parse(
        readFileSync(join(cwd, "node_modules", "eve", "package.json"), "utf8"),
      ) as { version: string }
    ).version;
  } catch {
    return null;
  }
}

/** Package manager for a project, by lockfile (npm when unsure). */
export function detectPackageManager(cwd: string): "pnpm" | "yarn" | "npm" {
  if (existsSync(join(cwd, "pnpm-lock.yaml"))) {
    return "pnpm";
  }
  if (existsSync(join(cwd, "yarn.lock"))) {
    return "yarn";
  }
  return "npm";
}

/** Spawn any command, streaming merged stdout/stderr; resolves the exit code. */
function streamCommand(
  cmd: string,
  args: string[],
  cwd: string,
  onLine: (line: string) => void,
  timeout: number,
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    let output = "";
    let settled = false;
    const finish = (code: number | null): void => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ code, output });
      }
    };
    let child: ChildProcess;
    try {
      child = spawn(cmd, args, {
        cwd,
        env: { ...process.env, ...CLEAN_ENV },
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      onLine(`[failed to launch] ${msg}\n`);
      resolve({ code: -1, output: msg });
      return;
    }
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // already gone
      }
      onLine(`\n[timed out after ${Math.round(timeout / 1000)}s]\n`);
      finish(-1);
    }, timeout);
    const capture = (b: Buffer): void => {
      const text = b.toString();
      output += text;
      onLine(text);
    };
    child.stdout?.on("data", capture);
    child.stderr?.on("data", capture);
    child.on("error", (err) => {
      onLine(`[failed to launch] ${err.message}\n`);
      finish(-1);
    });
    child.on("close", (code) => finish(code));
  });
}

/** Result of {@link upgradeEve}. */
export interface UpgradeOutcome {
  ok: boolean;
  version: string | null;
  diagnostics?: { errors: number; warnings: number };
  packageManager: string;
  bumpedArcana: boolean;
  error?: string;
}

/**
 * Upgrade a project to `eve@latest` (and `@kybernesis/arcana@latest` when the
 * project depends on it), then run `eve info --json` to rebuild the manifest
 * and report diagnostics.
 *
 * @remarks
 * The package manager is chosen by lockfile. npm's peer-dependency resolver
 * can refuse the bump (`ERESOLVE`, e.g. a pinned arcana peer range); in that
 * case the install is retried with `--legacy-peer-deps`. Every line of output
 * is streamed to `onLine` so the UI can show a live console.
 */
export async function upgradeEve(
  cwd: string,
  onLine: (line: string) => void,
): Promise<UpgradeOutcome> {
  const pm = detectPackageManager(cwd);
  let hasArcana = false;
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    hasArcana =
      Boolean(pkg.dependencies?.["@kybernesis/arcana"]) ||
      Boolean(pkg.devDependencies?.["@kybernesis/arcana"]);
  } catch {
    return {
      ok: false,
      version: installedEveVersion(cwd),
      packageManager: pm,
      bumpedArcana: false,
      error: "No readable package.json in this project.",
    };
  }
  const specs = [
    "eve@latest",
    ...(hasArcana ? ["@kybernesis/arcana@latest"] : []),
  ];
  const before = installedEveVersion(cwd);
  onLine(
    `Upgrading ${specs.join(" + ")} with ${pm}${before ? ` (currently eve ${before})` : ""}…\n`,
  );

  const cmd = process.platform === "win32" ? `${pm}.cmd` : pm;
  const argsFor = (legacy: boolean): string[] =>
    pm === "npm"
      ? ["install", ...specs, ...(legacy ? ["--legacy-peer-deps"] : [])]
      : ["add", ...specs];

  onLine(`$ ${pm} ${argsFor(false).join(" ")}\n`);
  let res = await streamCommand(cmd, argsFor(false), cwd, onLine, 600_000);
  if (res.code !== 0 && pm === "npm" && /ERESOLVE/.test(res.output)) {
    onLine(
      `\nnpm refused the peer-dependency graph (ERESOLVE) — retrying with --legacy-peer-deps.\n$ ${pm} ${argsFor(true).join(" ")}\n`,
    );
    res = await streamCommand(cmd, argsFor(true), cwd, onLine, 600_000);
  }
  const version = installedEveVersion(cwd);
  if (res.code !== 0) {
    return {
      ok: false,
      version,
      packageManager: pm,
      bumpedArcana: hasArcana,
      error: `${pm} exited with code ${res.code}.`,
    };
  }
  onLine(
    `\nInstalled eve ${version ?? "(unknown)"}. Running eve info --json…\n`,
  );
  const info = await eveInfoJson(cwd);
  const diagnostics = info.info?.diagnostics
    ? {
        errors: info.info.diagnostics.errors ?? 0,
        warnings: info.info.diagnostics.warnings ?? 0,
      }
    : undefined;
  if (!info.ok) {
    onLine(`${info.output.split("\n").slice(-12).join("\n")}\n`);
  }
  onLine(
    diagnostics
      ? `Diagnostics: ${diagnostics.errors} errors, ${diagnostics.warnings} warnings.\n`
      : "eve info did not report diagnostics — check the Structure tab.\n",
  );
  return {
    ok: info.ok,
    version,
    diagnostics,
    packageManager: pm,
    bumpedArcana: hasArcana,
    error: info.ok
      ? undefined
      : "eve info reported a problem after the upgrade.",
  };
}
