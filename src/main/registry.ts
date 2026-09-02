import { type ChildProcess, spawn } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  EveInfoResult,
  RegistryInstallResult,
  RegistryInstallStatus,
  RegistryItem,
} from "../shared/ipc";
import { eveBin } from "./cli";

/**
 * Eve 0.49 registry wrapper: `eve registry list --json`, `eve registry view`,
 * and `eve add <item> --non-interactive --yes`.
 *
 * @remarks
 * `eve add --non-interactive` prints human progress lines (spinners, "Created N
 * files:", "Added the following variables to .env.local:") interleaved with
 * NDJSON events. Observed event shapes (eve 0.49.0, `version: 1`):
 *
 * - `{ type: "progress", message }`
 * - `{ type: "completed", item, completedItems[], deploymentRequired?, next?: { command, args[] } }` → exit 0
 * - `{ type: "failed", item, completedItems[], message, failureCode, rolledBack }` → exit 1
 *   (`failureCode: "dependency_install"` is the npm peer-range case)
 * - `{ type: "blocked", item, installed, status: "prerequisite_required",
 *      prerequisite: { kind, code, message, command }, next: { command, args[] } }` → exit 2
 *
 * Env vars an item declares are not in the JSON; they are listed as `  + NAME`
 * lines under "Added the following variables", so those are scraped too.
 */

const CLEAN_ENV = { NO_COLOR: "1", FORCE_COLOR: "0", CI: "1" };
const LIST_TTL_MS = 10 * 60_000;

interface CacheEntry {
  at: number;
  items: RegistryItem[];
}
const listCache = new Map<string, CacheEntry>();

/** Outcome of one child process run. */
export interface RunOutcome {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: string;
}

/**
 * Spawn a command and resolve when it exits — never blocks the main process.
 *
 * @remarks
 * Every subprocess in this module and in arcanaWire goes through here (or
 * {@link registryAdd}, which has the same shape) so a 5-minute package
 * install can't freeze Electron's main thread, stall IPC, or stall chat
 * streams. `onLine` receives raw stdout/stderr chunks as they arrive.
 */
export function runCommand(
  cmd: string,
  args: string[],
  opts: {
    cwd: string;
    timeout: number;
    onLine?: (line: string) => void;
    /**
     * Capture stdout through a file instead of a pipe. Use for commands that
     * print one large JSON document and then `process.exit()`: on macOS Node
     * writes to pipes asynchronously, so when the reader (Electron's main
     * loop) is busy the tail of a 30 KB `eve registry list --json` is lost at
     * exit. Files are written synchronously, so nothing is dropped.
     */
    stdoutToFile?: boolean;
  },
): Promise<RunOutcome> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let capture: { dir: string; file: string; fd: number } | undefined;
    if (opts.stdoutToFile) {
      try {
        const dir = mkdtempSync(join(tmpdir(), "eve-studio-out-"));
        const file = join(dir, "stdout");
        capture = { dir, file, fd: openSync(file, "w") };
      } catch {
        capture = undefined; // fall back to a pipe
      }
    }
    const finish = (status: number | null, error?: string): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
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
      resolve({ status, stdout, stderr, error });
    };
    let child: ChildProcess;
    try {
      child = spawn(cmd, args, {
        cwd: opts.cwd,
        env: { ...process.env, ...CLEAN_ENV },
        stdio: ["ignore", capture ? capture.fd : "pipe", "pipe"],
      });
    } catch (err) {
      finish(-1, err instanceof Error ? err.message : String(err));
      return;
    }
    timer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {
        // already gone
      }
      finish(-1, `timed out after ${Math.round(opts.timeout / 1000)}s`);
    }, opts.timeout);
    child.stdout?.on("data", (b: Buffer) => {
      const s = b.toString();
      stdout += s;
      opts.onLine?.(s);
    });
    child.stderr?.on("data", (b: Buffer) => {
      const s = b.toString();
      stderr += s;
      opts.onLine?.(s);
    });
    child.on("error", (err) => finish(-1, err.message));
    // "close" (not "exit"): stdout can still be draining when the process exits,
    // and a 30 KB `eve registry list --json` was getting truncated at ~8 KB.
    child.on("close", (code) => finish(code));
  });
}

/** Extract the first complete JSON object/array from mixed CLI output. */
function firstJson(out: string, open: "{" | "["): unknown {
  const s = out.indexOf(open);
  if (s < 0) {
    throw new Error("No JSON in output.");
  }
  const close = open === "{" ? "}" : "]";
  const e = out.lastIndexOf(close);
  return JSON.parse(out.slice(s, e + 1));
}

/** `eve registry list --json`, cached per agent dir for ~10 minutes. */
export async function registryList(
  agentDir: string,
  force = false,
): Promise<{
  ok: boolean;
  items: RegistryItem[];
  cachedAt?: number;
  error?: string;
}> {
  const hit = listCache.get(agentDir);
  if (!force && hit && Date.now() - hit.at < LIST_TTL_MS) {
    return { ok: true, items: hit.items, cachedAt: hit.at };
  }
  const bin = eveBin(agentDir);
  const res = await runCommand(
    bin.cmd,
    [...bin.pre, "registry", "list", "--json"],
    { cwd: agentDir, timeout: 90_000, stdoutToFile: true },
  );
  if (res.error) {
    return { ok: false, items: hit?.items ?? [], error: res.error };
  }
  try {
    const parsed = firstJson(res.stdout ?? "", "{") as {
      items?: unknown;
    };
    const items = (Array.isArray(parsed.items) ? parsed.items : []).map(
      (raw) => {
        const o = raw as Record<string, unknown>;
        const item: RegistryItem = {
          name: String(o.name ?? ""),
          title: String(o.title ?? o.name ?? ""),
          type: String(o.type ?? "registry:item"),
          description: String(o.description ?? ""),
          registry: String(o.registry ?? ""),
          addCommandArgument: String(o.addCommandArgument ?? o.name ?? ""),
        };
        if (typeof o.docs === "string") {
          item.docs = o.docs;
        }
        if (typeof o.implementation === "string") {
          item.implementation = o.implementation;
        }
        return item;
      },
    );
    const at = Date.now();
    listCache.set(agentDir, { at, items });
    return { ok: true, items, cachedAt: at };
  } catch (err) {
    const tail = `${res.stdout ?? ""}${res.stderr ?? ""}`.trim().slice(-400);
    return {
      ok: false,
      items: hit?.items ?? [],
      error: `${err instanceof Error ? err.message : String(err)}${tail ? `\n${tail}` : ""}`,
    };
  }
}

/** `eve registry view <item>` — plain text (title, address, packages, files). */
export async function registryView(
  agentDir: string,
  item: string,
): Promise<string> {
  const bin = eveBin(agentDir);
  const res = await runCommand(
    bin.cmd,
    [...bin.pre, "registry", "view", safeItem(item)],
    { cwd: agentDir, timeout: 60_000 },
  );
  return `${res.stdout}${res.stderr}${res.error ? `\n${res.error}` : ""}`.trim();
}

/** Only registry item names / URLs — never shell-ish input. */
function safeItem(item: string): string {
  const s = item.trim();
  if (!/^[A-Za-z0-9@][A-Za-z0-9@._\-\/:]*$/.test(s)) {
    throw new Error(
      `Refusing to install "${item}": not a registry item name.`,
    );
  }
  return s;
}

interface AddEvent {
  version?: number;
  type?: string;
  item?: string;
  message?: string;
  failureCode?: string;
  rolledBack?: boolean;
  installed?: boolean;
  status?: string;
  deploymentRequired?: boolean;
  prerequisite?: {
    kind?: string;
    code?: string;
    message?: string;
    command?: string;
  };
  next?: { command?: string; args?: string[] };
}

/**
 * Fold the raw `eve add` transcript into a structured result.
 *
 * @param exitCode - Process exit code (0 done, 1 failed, 2 needs an answer).
 * @param transcript - Everything the process printed (stdout + stderr).
 */
export function parseAddTranscript(
  exitCode: number | null,
  transcript: string,
): RegistryInstallResult {
  const lines = transcript.split(/\r?\n/);
  let last: AddEvent | null = null;
  const envVars: string[] = [];
  const files: string[] = [];
  let mode: "env" | "files" | null = null;
  for (const raw of lines) {
    const line = raw.replace(/^[\s✔✓-]+(?=\{)/, "").trim();
    if (line.startsWith("{") && line.endsWith("}")) {
      try {
        const ev = JSON.parse(line) as AddEvent;
        if (ev && typeof ev === "object" && ev.type) {
          last = ev;
        }
      } catch {
        // not an NDJSON line
      }
      mode = null;
      continue;
    }
    if (/Added the following variables/i.test(raw)) {
      mode = "env";
      continue;
    }
    if (/^\s*[✔✓-]?\s*(Created|Updated|Wrote)\s+\d+\s+files?:/i.test(raw)) {
      mode = "files";
      continue;
    }
    const m = /^\s+[+-]\s+(\S.*)$/.exec(raw);
    if (m && mode === "env" && /^[A-Z][A-Z0-9_]*$/.test(m[1].trim())) {
      envVars.push(m[1].trim());
      continue;
    }
    if (m && mode === "files") {
      files.push(m[1].trim());
      continue;
    }
    if (raw.trim() === "") {
      mode = null;
    }
  }

  let status: RegistryInstallStatus;
  if (exitCode === 0 || last?.type === "completed") {
    status = exitCode === 0 ? "done" : "failed";
  } else if (exitCode === 2 || last?.type === "blocked") {
    status = "needs-input";
  } else {
    status = "failed";
  }
  const nextCommand = last?.next?.command
    ? [last.next.command, ...(last.next.args ?? [])].join(" ")
    : undefined;
  const message =
    last?.message ??
    last?.prerequisite?.message ??
    (status === "failed"
      ? transcript
          .split(/\r?\n/)
          .filter((l) => l.trim() && !l.trim().startsWith("{"))
          .slice(-3)
          .join("\n")
          .trim() || undefined
      : undefined);

  const result: RegistryInstallResult = { exitCode, status };
  if (message) {
    result.message = message;
  }
  if (nextCommand) {
    result.nextCommand = nextCommand;
  }
  if (envVars.length) {
    result.envVars = [...new Set(envVars)];
  }
  if (files.length) {
    result.files = files;
  }
  if (last?.failureCode) {
    result.failureCode = last.failureCode;
  }
  if (last?.deploymentRequired) {
    result.deploymentRequired = true;
  }
  if (last?.prerequisite?.command) {
    result.prerequisiteCommand = last.prerequisite.command;
  }
  return result;
}

/**
 * `eve add <item> --non-interactive --yes [--skip-setup]`, streaming output
 * lines to `onLine` and resolving with the parsed final NDJSON event.
 */
export function registryAdd(
  agentDir: string,
  item: string,
  opts: { skipSetup?: boolean; overwrite?: boolean } = {},
  onLine?: (line: string) => void,
): Promise<RegistryInstallResult> {
  const name = safeItem(item);
  const bin = eveBin(agentDir);
  const args = [...bin.pre, "add", name, "--non-interactive", "--yes"];
  if (opts.skipSetup) {
    args.push("--skip-setup");
  }
  if (opts.overwrite) {
    args.push("--overwrite");
  }
  onLine?.(`$ eve ${args.slice(bin.pre.length).join(" ")}\n`);
  return new Promise((resolve) => {
    let transcript = "";
    let settled = false;
    const finish = (code: number | null, extra?: string): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (extra) {
        transcript += extra;
        onLine?.(extra);
      }
      resolve(parseAddTranscript(code, transcript));
    };
    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn(bin.cmd, args, {
        cwd: agentDir,
        env: { ...process.env, ...CLEAN_ENV },
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      finish(
        -1,
        `\n[failed to launch] ${err instanceof Error ? err.message : String(err)}\n`,
      );
      return;
    }
    const timer = setTimeout(() => {
      try {
        proc.kill("SIGTERM");
      } catch {
        // already gone
      }
      finish(-1, "\n[timed out after 10 minutes]\n");
    }, 10 * 60_000);
    const emit = (b: Buffer): void => {
      const s = b.toString();
      transcript += s;
      onLine?.(s);
    };
    proc.stdout?.on("data", emit);
    proc.stderr?.on("data", emit);
    proc.on("error", (err) => {
      clearTimeout(timer);
      finish(-1, `\n[failed to launch] ${err.message}\n`);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      finish(code);
    });
  });
}

/**
 * `eve info --json` — regenerates `.eve/discovery/*` and the compiled manifest
 * without booting a server. Used after installs to confirm 0 diagnostics.
 */
export async function eveInfo(agentDir: string): Promise<EveInfoResult> {
  const bin = eveBin(agentDir);
  const res = await runCommand(bin.cmd, [...bin.pre, "info", "--json"], {
    cwd: agentDir,
    timeout: 120_000,
    stdoutToFile: true,
  });
  if (res.error && !res.stdout) {
    return { ok: false, errors: -1, warnings: 0, error: res.error };
  }
  try {
    const j = firstJson(res.stdout ?? "", "{") as {
      status?: string;
      diagnostics?: { errors?: number; warnings?: number };
      skills?: string[];
      subagents?: string[];
      layout?: string;
    };
    return {
      ok: res.status === 0,
      status: j.status,
      layout: j.layout,
      errors: Number(j.diagnostics?.errors ?? 0),
      warnings: Number(j.diagnostics?.warnings ?? 0),
      skills: Array.isArray(j.skills) ? j.skills.map(String) : [],
      subagents: Array.isArray(j.subagents) ? j.subagents.map(String) : [],
    };
  } catch {
    const tail = `${res.stdout ?? ""}${res.stderr ?? ""}`.trim().slice(-600);
    return {
      ok: false,
      errors: -1,
      warnings: 0,
      error: tail || `eve info exited ${res.status}`,
    };
  }
}
