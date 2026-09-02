import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import type { AgentRuntimeState } from "../shared/ipc";
import { eveBin } from "./cli";
import { getFreePort } from "./ports";

interface Running {
  /** Null when adopted from a recorded dev server we never spawned. */
  proc: ChildProcess | null;
  port: number;
  status: AgentRuntimeState["status"];
  error: string | null;
  stopping: boolean;
  /** True when we connected to a pre-existing dev server we didn't spawn. */
  adopted: boolean;
  logs: string[];
}

type StatusListener = (state: AgentRuntimeState) => void;
type LogListener = (agentId: string, data: string) => void;

const DETACHED = process.platform !== "win32";

/**
 * Port of the dev server eve recorded for this app root, if the record exists
 * and points at loopback. eve writes `{ url }` to `.eve/dev-server-state.v1.json`
 * when a server becomes ready and removes it on clean shutdown; a stale
 * record is harmless because the caller health-checks before adopting.
 */
function readRecordedDevServer(agentPath: string): number | null {
  const p = join(agentPath, ".eve", "dev-server-state.v1.json");
  if (!existsSync(p)) {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(p, "utf8")) as { url?: unknown };
    if (typeof parsed.url !== "string") {
      return null;
    }
    const u = new URL(parsed.url);
    const loopback =
      u.hostname === "127.0.0.1" ||
      u.hostname === "localhost" ||
      u.hostname === "[::1]" ||
      u.hostname === "::1";
    const port = Number(u.port);
    return loopback && Number.isInteger(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

/** Kill whatever is LISTENing on a loopback port (best-effort, POSIX). */
function killPort(port: number): void {
  if (process.platform === "win32") {
    return;
  }
  try {
    const out = spawnSync("lsof", ["-nP", `-tiTCP:${port}`, "-sTCP:LISTEN"], {
      encoding: "utf8",
    }).stdout;
    for (const pid of out
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)) {
      try {
        process.kill(Number(pid), "SIGKILL");
      } catch {
        // already gone
      }
    }
  } catch {
    // lsof unavailable — nothing we can do
  }
}

/**
 * Spawns and supervises one `eve dev --no-ui --port <N>` child per agent.
 * Loopback needs no auth, so the renderer/session-proxy just talks to the port.
 *
 * @remarks
 * Children are spawned in their own process group so {@link AgentManager.stop}
 * can tear down the whole tree (eve + its sandbox helpers). If a stale server is
 * already holding the agent's lock, {@link AgentManager.start} adopts it instead
 * of failing — eve prints the URL and only allows one dev server per agent.
 */
export class AgentManager {
  private readonly running = new Map<string, Running>();
  private readonly listeners = new Set<StatusListener>();
  private readonly logListeners = new Set<LogListener>();

  onStatus(cb: StatusListener): void {
    this.listeners.add(cb);
  }

  onLog(cb: LogListener): void {
    this.logListeners.add(cb);
  }

  /** The captured dev-server output for an agent (most recent lines). */
  logs(agentId: string): string {
    return this.running.get(agentId)?.logs.join("") ?? "";
  }

  private emit(agentId: string): void {
    const state = this.state(agentId);
    for (const cb of this.listeners) {
      cb(state);
    }
  }

  url(agentId: string): string | null {
    const r = this.running.get(agentId);
    return r && r.status === "running" ? `http://127.0.0.1:${r.port}` : null;
  }

  state(agentId: string): AgentRuntimeState {
    const r = this.running.get(agentId);
    if (!r) {
      return { agentId, status: "stopped", port: null, url: null, error: null };
    }
    return {
      agentId,
      status: r.status,
      port: r.port,
      url: `http://127.0.0.1:${r.port}`,
      error: r.error,
    };
  }

  async start(agentId: string, agentPath: string): Promise<AgentRuntimeState> {
    const existing = this.running.get(agentId);
    if (
      existing &&
      (existing.status === "running" || existing.status === "starting")
    ) {
      return this.state(agentId);
    }

    // A dev server for this agent may already be up (another terminal, a
    // previous Studio run that lost track of it). eve records its last ready
    // URL in `.eve/dev-server-state.v1.json`; adopt it only when it is
    // loopback, healthy, not already owned by another agent entry here, and
    // /eve/v1/info confirms it serves THIS app root — a stale record can point
    // at a port since reused by a different agent's server.
    const recorded = readRecordedDevServer(agentPath);
    if (
      recorded &&
      !this.portInUse(recorded, agentId) &&
      (await this.waitHealthy(recorded, 3000)) &&
      (await this.servesAppRoot(recorded, agentPath))
    ) {
      const rec: Running = {
        proc: null,
        port: recorded,
        status: "running",
        error: null,
        stopping: false,
        adopted: true,
        logs: [`[studio] adopted existing dev server on :${recorded}\n`],
      };
      this.running.set(agentId, rec);
      this.emit(agentId);
      return this.state(agentId);
    }

    const port = await getFreePort();
    const bin = eveBin(agentPath);
    const proc = spawn(
      bin.cmd,
      [...bin.pre, "dev", "--no-ui", "--port", String(port)],
      {
        cwd: agentPath,
        env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
        stdio: ["ignore", "pipe", "pipe"],
        detached: DETACHED,
      },
    );

    const rec: Running = {
      proc,
      port,
      status: "starting",
      error: null,
      stopping: false,
      adopted: false,
      logs: [],
    };
    this.running.set(agentId, rec);
    this.emit(agentId);

    // Resolves once the agent reaches a terminal state (running / error).
    let settle: () => void = () => {
      // replaced below
    };
    const settled = new Promise<void>((res) => {
      settle = res;
    });

    const capture = (buf: Buffer): void => {
      const text = buf.toString();
      rec.logs.push(text);
      if (rec.logs.length > 400) {
        rec.logs.shift();
      }
      for (const cb of this.logListeners) {
        cb(agentId, text);
      }
    };
    proc.stdout?.on("data", capture);
    proc.stderr?.on("data", capture);

    proc.on("error", (err) => {
      if (this.running.get(agentId) !== rec) {
        return;
      }
      rec.status = "error";
      rec.error = err.message;
      this.emit(agentId);
      settle();
    });

    proc.on("exit", async (code) => {
      if (this.running.get(agentId) !== rec) {
        return;
      }
      if (rec.stopping) {
        this.running.delete(agentId);
        this.emit(agentId);
        settle();
        return;
      }
      // Eve refuses to start a second dev server for the same agent and prints
      // the URL of the one already running. Adopt it rather than erroring.
      const adoptPort = this.adoptPortFromLogs(rec.logs);
      if (adoptPort && (await this.waitHealthy(adoptPort, 8000))) {
        rec.adopted = true;
        rec.port = adoptPort;
        rec.status = "running";
        rec.error = null;
        this.emit(agentId);
        settle();
        return;
      }
      rec.status = "error";
      if (!rec.error) {
        rec.error =
          `Dev server exited (code ${code}).\n${rec.logs.slice(-4).join("")}`.slice(
            0,
            600,
          );
      }
      this.emit(agentId);
      settle();
    });

    // Race health-on-our-port against the exit handler above.
    void this.waitHealthy(port, 60_000).then((healthy) => {
      if (this.running.get(agentId) !== rec || rec.status !== "starting") {
        return;
      }
      if (healthy) {
        rec.status = "running";
        rec.error = null;
      } else {
        rec.status = "error";
        rec.error = "Dev server did not become healthy in time.";
      }
      this.emit(agentId);
      settle();
    });

    await settled;
    return this.state(agentId);
  }

  stop(agentId: string): void {
    const r = this.running.get(agentId);
    if (!r) {
      return;
    }
    r.stopping = true;
    if (r.adopted) {
      // We didn't spawn it — its process is already gone; free the port.
      killPort(r.port);
      this.running.delete(agentId);
      this.emit(agentId);
      return;
    }
    this.killTree(r);
  }

  /**
   * Stop, wait for the old child to actually exit, then start.
   *
   * @remarks
   * A naive stop-then-start no-ops: `stop()` kills the child but its `exit`
   * fires asynchronously, so `start()` still sees the old record as "running"
   * and returns early — then the dying child flips status to "stopped". Waiting
   * for the record to clear (or a short cap) before starting avoids that race.
   */
  async restart(
    agentId: string,
    agentPath: string,
  ): Promise<AgentRuntimeState> {
    const r = this.running.get(agentId);
    if (r) {
      const gone = new Promise<void>((res) => {
        if (r.adopted || !r.proc) {
          res();
          return;
        }
        r.proc.once("exit", () => res());
      });
      this.stop(agentId);
      await Promise.race([
        gone,
        new Promise<void>((res) => setTimeout(res, 5000)),
      ]);
    }
    // Ensure the record is cleared so start() doesn't early-return.
    for (let i = 0; i < 20 && this.running.has(agentId); i++) {
      await new Promise<void>((res) => setTimeout(res, 100));
    }
    return this.start(agentId, agentPath);
  }

  stopAll(): void {
    for (const [, r] of this.running) {
      r.stopping = true;
      if (r.adopted) {
        killPort(r.port);
      } else {
        this.killTree(r);
      }
    }
    this.running.clear();
  }

  /** Kill the child's whole process group (SIGTERM), falling back to the pid. */
  private killTree(r: Running): void {
    if (!r.proc) {
      killPort(r.port);
      return;
    }
    const pid = r.proc.pid;
    try {
      if (DETACHED && pid) {
        process.kill(-pid, "SIGTERM");
      } else {
        r.proc.kill("SIGTERM");
      }
    } catch {
      // already gone
    }
  }

  /** True when another agent's record (spawned or adopted) already holds `port`. */
  private portInUse(port: number, exceptAgentId: string): boolean {
    for (const [id, r] of this.running) {
      if (id !== exceptAgentId && r.port === port) {
        return true;
      }
    }
    return false;
  }

  /**
   * Confirm via `GET /eve/v1/info` (agent-info v4: `agent.appRoot`) that the
   * server on `port` serves `agentPath`. Any failure — auth-gated route,
   * unexpected shape, path mismatch — means "do not adopt".
   */
  private async servesAppRoot(
    port: number,
    agentPath: string,
  ): Promise<boolean> {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/eve/v1/info`, {
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) {
        return false;
      }
      const info = (await res.json()) as {
        agent?: { appRoot?: unknown; agentRoot?: unknown };
      };
      const remote =
        typeof info.agent?.appRoot === "string" ? info.agent.appRoot : null;
      if (!remote) {
        return false;
      }
      const norm = (p: string): string => {
        try {
          return realpathSync(p);
        } catch {
          return p;
        }
      };
      return norm(remote) === norm(agentPath);
    } catch {
      return false;
    }
  }

  /** Extract a loopback port from eve's "already running" conflict message. */
  private adoptPortFromLogs(logs: string[]): number | null {
    const text = logs.join("");
    if (!/already running/i.test(text)) {
      return null;
    }
    const m = /http:\/\/127\.0\.0\.1:(\d{2,5})/.exec(text);
    return m ? Number(m[1]) : null;
  }

  private async waitHealthy(port: number, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/eve/v1/health`, {
          signal: AbortSignal.timeout(2000),
        });
        if (res.ok) {
          return true;
        }
      } catch {
        // not up yet
      }
      await new Promise((r) => setTimeout(r, 800));
    }
    return false;
  }
}
