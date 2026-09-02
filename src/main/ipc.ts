import type { ChildProcess } from "node:child_process";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import {
  BrowserWindow,
  type IpcMainInvokeEvent,
  app,
  dialog,
  ipcMain,
} from "electron";
import {
  type AddAgentResult,
  type AgentRecord,
  type AppInfo,
  IPC,
  type RegistryAddResult,
} from "../shared/ipc";
import { AgentManager } from "./agentManager";
import {
  createHook,
  createSandbox,
  createSchedule,
  createSubagent,
  createTool,
  readEnv,
  readModelConfig,
  readSandbox,
  writeEnv,
  writeModelConfig,
} from "./agentAuthoring";
import {
  addConnection,
  createSkill,
  deleteConnectionFile,
  readConnectionFile,
  readInstructions,
  scanConnectorUsage,
  writeConnectionFile,
  writeInstructions,
} from "./agentFiles";
import {
  capabilityFiles,
  deleteCapability,
  writeCapabilityFile,
} from "./agentCapabilities";
import { ensureNodeRuntime, ensureVercelShim } from "./runtime";
import { registerRegistryIpc } from "./registryIpc";
import { registryAdd } from "./registry";
import { ChatController } from "./chat";
import {
  CliRunner,
  eveLatestVersion,
  eveSet,
  initAgent,
  listChannels,
  listEvals,
  upgradeEve,
} from "./cli";
import { checkHealth, getAgentInfo, type SessionConn } from "./eveSession";
import * as store from "./store";
import {
  discordRegisterCommands,
  discordSetEndpoint,
  discordVerify,
} from "./discord";
import {
  twilioListNumbers,
  twilioNumberStatus,
  twilioSetWebhooks,
  twilioVerify,
} from "./twilio";
import { teamsVerify } from "./teams";
import {
  telegramSetWebhook,
  telegramVerify,
  telegramWebhookInfo,
} from "./telegram";
import {
  buzzBridgeInstall,
  buzzBridgeStart,
  buzzBridgeStop,
  buzzBridgeUninstall,
  buzzBypassSecret,
  buzzGetProfile,
  buzzGenKey,
  buzzSave,
  buzzSetProfile,
  buzzStatus,
  buzzVerify,
} from "./buzz";
import { gatewayModels } from "./gateway";
import { refreshStructure } from "./structure";
import {
  channelConnectors,
  deleteChannelFile,
  writeChannel,
} from "./agentChannels";
import {
  openConnectExternal,
  openConnector,
  openConnectWindow,
} from "./connectWindow";
import {
  vercelConnectAttach,
  vercelConnectCreate,
  vercelConnectCreateStream,
  vercelConnectList,
  vercelConnectProjectsMap,
  vercelEnvAdd,
  vercelEnvLs,
  vercelEnvPull,
  vercelEnvSetAll,
  startVercelLogin,
  vercelLink,
  vercelProdAlias,
  vercelProdInfo,
  vercelStatus,
  vercelTeams,
  vercelWhoami,
} from "./vercel";
import { modelReadiness } from "./vercel";

/** Read a variable from an agent's .env.local (for deployed route auth). */
function readEnvLocal(agentPath: string, name: string): string | null {
  const p = join(agentPath, ".env.local");
  if (!existsSync(p)) {
    return null;
  }
  const re = new RegExp(`^\\s*${name}\\s*=\\s*(.*)$`, "m");
  const m = re.exec(readFileSync(p, "utf8"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
}

function agentPathOf(id: string): string {
  const a = store.getAgent(id);
  if (!a) {
    throw new Error("Unknown agent.");
  }
  return a.path;
}
function tryWrite(fn: () => { relPath: string }): {
  ok: boolean;
  relPath?: string;
  error?: string;
} {
  try {
    return { ok: true, ...fn() };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** What registerIpc hands back for lifecycle cleanup on quit. */
export interface IpcHandles {
  agents: AgentManager;
  cli: CliRunner;
}

function broadcast(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send(channel, payload);
  }
}

function hashPath(p: string): string {
  let h = 0;
  for (let i = 0; i < p.length; i += 1) {
    h = (h * 31 + p.charCodeAt(i)) | 0;
  }
  return `a${(h >>> 0).toString(36)}`;
}

function addAgentFromPath(dir: string): AddAgentResult {
  const pkgPath = join(dir, "package.json");
  if (!existsSync(pkgPath)) {
    return { ok: false, error: "No package.json — this isn't an Eve project." };
  }
  const hasAgentDir = existsSync(join(dir, "agent"));
  const flatAgent =
    existsSync(join(dir, "agent.ts")) ||
    existsSync(join(dir, "instructions.md"));
  if (!(hasAgentDir || flatAgent)) {
    return { ok: false, error: "No agent/ directory found in that folder." };
  }

  let name = basename(dir);
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string };
    if (pkg.name) {
      name = pkg.name;
    }
  } catch {
    // fall back to dir name
  }

  const eveVersion = readEveVersion(dir);

  const id = hashPath(dir);
  const existing = store.getAgent(id);
  if (existing) {
    return { ok: true, agent: existing };
  }
  const agent: AgentRecord = {
    id,
    name,
    path: dir,
    eveVersion,
    addedAt: Date.now(),
  };
  store.upsertAgent(agent);
  return { ok: true, agent };
}

/** Installed eve version for an agent dir (`node_modules/eve/package.json`), or null. */
function readEveVersion(dir: string): string | null {
  try {
    return (
      JSON.parse(
        readFileSync(join(dir, "node_modules", "eve", "package.json"), "utf8"),
      ) as { version: string }
    ).version;
  } catch {
    return null;
  }
}

/** Registers every ipcMain handler. Returns handles so callers can clean up on quit. */
export function registerIpc(): IpcHandles {
  const agents = new AgentManager();
  agents.onStatus((state) => broadcast(IPC.agentStatusChanged, state));
  agents.onLog((agentId, data) => broadcast(IPC.agentLog, { agentId, data }));

  const cli = new CliRunner(
    (runId, data) => broadcast(IPC.cliChunk, { runId, data }),
    (runId, code) => broadcast(IPC.cliExit, { runId, code }),
  );

  // Live `vercel login` processes, keyed by runId, so cliCancel (or unmount) can
  // kill a sign-in that the user abandoned instead of leaking a waiting process.
  const loginChildren = new Map<string, ChildProcess>();

  const chat = new ChatController(
    (threadId, event) => broadcast(IPC.chatEvent, { threadId, event }),
    (msg) => broadcast(IPC.chatStatus, msg),
  );

  ipcMain.handle(IPC.appInfo, (): AppInfo => ({
    appVersion: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
    platform: process.platform,
  }));

  // --- agents ---
  // Re-read each agent's installed eve version on every list so the header
  // badge tracks `pnpm add eve@latest` instead of the version at add time.
  ipcMain.handle(IPC.agentsList, () =>
    store.listAgents().map((a) => {
      const v = readEveVersion(a.path);
      if (v !== a.eveVersion) {
        const next = { ...a, eveVersion: v };
        store.upsertAgent(next);
        return next;
      }
      return a;
    }),
  );

  // --- eve version / upgrade ---
  ipcMain.handle(IPC.eveLatest, (_e: IpcMainInvokeEvent, force?: boolean) =>
    eveLatestVersion(Boolean(force)),
  );
  ipcMain.handle(
    IPC.eveUpgrade,
    async (
      _e: IpcMainInvokeEvent,
      id: string,
      runId: string,
    ): Promise<import("../shared/ipc").EveUpgradeResult> => {
      const a = store.getAgent(id);
      if (!a) {
        return { ok: false, version: null, error: "Unknown agent." };
      }
      // A running dev server would hold the old eve in memory; stop it so the
      // next Start boots the upgraded runtime.
      agents.stop(id);
      try {
        await ensureNodeRuntime((msg) =>
          broadcast(IPC.cliChunk, { runId, data: msg }),
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        broadcast(IPC.cliChunk, { runId, data: `${msg}\n` });
        broadcast(IPC.cliExit, { runId, code: -1 });
        return { ok: false, version: readEveVersion(a.path), error: msg };
      }
      const result = await upgradeEve(a.path, (data) =>
        broadcast(IPC.cliChunk, { runId, data }),
      );
      store.upsertAgent({ ...a, eveVersion: result.version });
      broadcast(IPC.cliExit, { runId, code: result.ok ? 0 : 1 });
      return result;
    },
  );

  ipcMain.handle(IPC.agentsAdd, async (): Promise<AddAgentResult> => {
    const win = BrowserWindow.getFocusedWindow() ?? undefined;
    const picked = win
      ? await dialog.showOpenDialog(win, {
          properties: ["openDirectory"],
          title: "Select an Eve agent folder",
        })
      : await dialog.showOpenDialog({
          properties: ["openDirectory"],
          title: "Select an Eve agent folder",
        });
    if (picked.canceled || !picked.filePaths[0]) {
      return { ok: false, error: "cancelled" };
    }
    return addAgentFromPath(picked.filePaths[0]);
  });

  ipcMain.handle(IPC.agentsRemove, (_e: IpcMainInvokeEvent, id: string) => {
    agents.stop(id);
    store.removeAgent(id);
    return store.listAgents();
  });

  ipcMain.handle(IPC.dialogPickDir, async (): Promise<string | null> => {
    const win = BrowserWindow.getFocusedWindow() ?? undefined;
    const opts = {
      properties: ["openDirectory", "createDirectory"] as Array<
        "openDirectory" | "createDirectory"
      >,
      title: "Choose a folder",
    };
    const picked = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts);
    return picked.canceled ? null : (picked.filePaths[0] ?? null);
  });

  ipcMain.handle(
    IPC.agentCreate,
    (
      _e: IpcMainInvokeEvent,
      input: import("../shared/ipc").CreateAgentInput,
    ) => {
      const runId = store.rid();
      void (async () => {
        try {
          // Make sure Node/npm exist first (downloads a runtime on a fresh
          // machine), streaming setup progress into the same console.
          await ensureNodeRuntime((msg) =>
            broadcast(IPC.cliChunk, { runId, data: msg }),
          );
          initAgent(
            cli,
            runId,
            input.parentDir,
            input.name,
            Boolean(input.webChat),
            input.model,
          );
        } catch (err) {
          broadcast(IPC.cliChunk, {
            runId,
            data: `\n[setup failed] ${err instanceof Error ? err.message : String(err)}\n`,
          });
          broadcast(IPC.cliExit, { runId, code: -1 });
        }
      })();
      return runId;
    },
  );

  ipcMain.handle(IPC.agentRegister, (_e: IpcMainInvokeEvent, dir: string) =>
    addAgentFromPath(dir),
  );

  // --- runtime ---
  ipcMain.handle(IPC.agentStart, async (_e: IpcMainInvokeEvent, id: string) => {
    const a = store.getAgent(id);
    if (!a) {
      throw new Error("Unknown agent.");
    }
    // Running an agent needs `node` on PATH too.
    await ensureNodeRuntime();
    return agents.start(id, a.path);
  });
  ipcMain.handle(IPC.agentStop, (_e: IpcMainInvokeEvent, id: string) => {
    agents.stop(id);
    return agents.state(id);
  });
  ipcMain.handle(
    IPC.agentRestart,
    async (_e: IpcMainInvokeEvent, id: string) => {
      const a = store.getAgent(id);
      if (!a) {
        throw new Error("Unknown agent.");
      }
      await ensureNodeRuntime();
      return agents.restart(id, a.path);
    },
  );
  ipcMain.handle(IPC.agentStatus, (_e: IpcMainInvokeEvent, id: string) =>
    agents.state(id),
  );
  ipcMain.handle(
    IPC.scheduleRun,
    async (_e: IpcMainInvokeEvent, id: string, name: string) => {
      const st = agents.state(id);
      if (st.status !== "running" || !st.url) {
        return {
          ok: false,
          output:
            "Start the agent locally first — the test route only runs under eve dev.",
        };
      }
      try {
        const res = await fetch(
          `${st.url}/eve/v1/dev/schedules/${encodeURIComponent(name)}`,
          { method: "POST" },
        );
        const body = await res.text();
        return res.ok
          ? { ok: true, output: body.slice(0, 600) }
          : { ok: false, output: `HTTP ${res.status}: ${body.slice(0, 300)}` };
      } catch (e) {
        return {
          ok: false,
          output: e instanceof Error ? e.message : String(e),
        };
      }
    },
  );
  ipcMain.handle(IPC.agentInfo, (_e: IpcMainInvokeEvent, id: string) => {
    const url = agents.url(id);
    if (!url) {
      throw new Error("Agent is not running.");
    }
    return getAgentInfo(url);
  });
  ipcMain.handle(
    IPC.agentStructure,
    (_e: IpcMainInvokeEvent, id: string, refresh?: boolean) => {
      const a = store.getAgent(id);
      if (!a) {
        throw new Error("Unknown agent.");
      }
      // `eve info --json` regenerates the manifest from source (no server
      // boot); skipped when the manifest is already newer than agent/.
      return refreshStructure(a.path, Boolean(refresh));
    },
  );

  // --- model / config ---
  ipcMain.handle(IPC.modelRead, (_e: IpcMainInvokeEvent, id: string) =>
    readModelConfig(agentPathOf(id)),
  );
  ipcMain.handle(
    IPC.modelWrite,
    async (
      _e: IpcMainInvokeEvent,
      id: string,
      model: string,
      reasoning: string | null,
    ) => {
      try {
        const path = agentPathOf(id);
        // `eve set` is the same editor the dev TUI's /model uses; it refuses
        // defineDynamic / provider-SDK models, in which case Studio's regex
        // writer gets a go (it throws the same "edit by hand" error if the
        // model isn't a plain string either). `--reasoning provider-default`
        // is what removes an authored reasoning field, so it is always sent.
        const viaCli = await eveSet(path, model, reasoning);
        if (!viaCli.ok) {
          writeModelConfig(path, model, reasoning);
        }
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  // --- env ---
  ipcMain.handle(IPC.envRead, (_e: IpcMainInvokeEvent, id: string) =>
    readEnv(agentPathOf(id)),
  );
  ipcMain.handle(
    IPC.envWrite,
    (_e: IpcMainInvokeEvent, id: string, name: string, content: string) => {
      try {
        writeEnv(agentPathOf(id), name, content);
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  // --- authoring scaffolds ---
  ipcMain.handle(
    IPC.toolCreate,
    (
      _e: IpcMainInvokeEvent,
      id: string,
      input: import("../shared/ipc").ToolInput,
    ) => tryWrite(() => createTool(agentPathOf(id), input)),
  );
  ipcMain.handle(
    IPC.subagentCreate,
    (
      _e: IpcMainInvokeEvent,
      id: string,
      input: import("../shared/ipc").SubagentInput,
    ) => tryWrite(() => createSubagent(agentPathOf(id), input)),
  );
  ipcMain.handle(
    IPC.hookCreate,
    (_e: IpcMainInvokeEvent, id: string, name: string) =>
      tryWrite(() => createHook(agentPathOf(id), name)),
  );
  ipcMain.handle(
    IPC.scheduleCreate,
    (
      _e: IpcMainInvokeEvent,
      id: string,
      input: import("../shared/ipc").ScheduleInput,
    ) => tryWrite(() => createSchedule(agentPathOf(id), input)),
  );

  // --- capability read / edit / delete (tools, skills, subagents, hooks, schedules) ---
  ipcMain.handle(
    IPC.capabilityFiles,
    (
      _e: IpcMainInvokeEvent,
      id: string,
      kind: import("../shared/ipc").CapabilityKind,
      name: string,
    ) => capabilityFiles(agentPathOf(id), kind, name),
  );
  ipcMain.handle(
    IPC.capabilityWrite,
    (_e: IpcMainInvokeEvent, id: string, relPath: string, content: string) =>
      tryWrite(() => writeCapabilityFile(agentPathOf(id), relPath, content)),
  );
  ipcMain.handle(
    IPC.capabilityDelete,
    (
      _e: IpcMainInvokeEvent,
      id: string,
      kind: import("../shared/ipc").CapabilityKind,
      name: string,
    ) => tryWrite(() => deleteCapability(agentPathOf(id), kind, name)),
  );

  // --- sandbox ---
  ipcMain.handle(IPC.sandboxRead, (_e: IpcMainInvokeEvent, id: string) =>
    readSandbox(agentPathOf(id)),
  );
  ipcMain.handle(IPC.sandboxCreate, (_e: IpcMainInvokeEvent, id: string) =>
    tryWrite(() => createSandbox(agentPathOf(id))),
  );

  // --- channels ---
  ipcMain.handle(IPC.channelsList, (_e: IpcMainInvokeEvent, id: string) =>
    listChannels(agentPathOf(id)),
  );
  // Web Chat is a registry item in eve 0.49 (`eve channels add` is gone).
  ipcMain.handle(
    IPC.channelAdd,
    async (_e: IpcMainInvokeEvent, id: string): Promise<RegistryAddResult> => {
      let output = "";
      const r = await registryAdd(agentPathOf(id), "channel/web", {}, (line) => {
        output += line;
      });
      const needsInput = r.status === "needs-input";
      if (needsInput && r.nextCommand) {
        output += `\nSetup needs input. Continue in a terminal:\n  ${r.nextCommand}\n`;
      }
      return {
        ok: r.status === "done",
        needsInput,
        nextCommand: r.nextCommand,
        output: output.trim(),
      };
    },
  );
  ipcMain.handle(
    IPC.channelWrite,
    (
      _e: IpcMainInvokeEvent,
      id: string,
      input: import("../shared/ipc").ChannelAddInput,
    ) => {
      try {
        return { ok: true, ...writeChannel(agentPathOf(id), input) };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );
  ipcMain.handle(
    IPC.channelDelete,
    (_e: IpcMainInvokeEvent, id: string, name: string) => {
      try {
        deleteChannelFile(agentPathOf(id), name);
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );
  ipcMain.handle(
    IPC.channelWiring,
    async (_e: IpcMainInvokeEvent, id: string) => {
      const path = agentPathOf(id);
      const projectId = vercelStatus(path).projectId ?? "";
      const chans = channelConnectors(path);
      const map = await vercelConnectProjectsMap(path);
      return chans.map((c) => ({
        name: c.name,
        connector: c.connector,
        attached: c.connector
          ? (map[c.connector]?.includes(projectId) ?? false)
          : null,
      }));
    },
  );

  // --- vercel ---
  ipcMain.handle(IPC.vercelStatus, (_e: IpcMainInvokeEvent, id: string) =>
    vercelStatus(agentPathOf(id)),
  );
  ipcMain.handle(IPC.vercelEnvLs, (_e: IpcMainInvokeEvent, id: string) =>
    vercelEnvLs(agentPathOf(id)),
  );
  ipcMain.handle(IPC.vercelEnvPull, (_e: IpcMainInvokeEvent, id: string) =>
    vercelEnvPull(agentPathOf(id)),
  );
  ipcMain.handle(
    IPC.vercelEnvAdd,
    (
      _e: IpcMainInvokeEvent,
      id: string,
      name: string,
      value: string,
      target: string,
    ) => vercelEnvAdd(agentPathOf(id), name, value, target),
  );
  ipcMain.handle(
    IPC.vercelEnvSetAll,
    (_e: IpcMainInvokeEvent, id: string, name: string, value: string) =>
      vercelEnvSetAll(agentPathOf(id), name, value),
  );
  ipcMain.handle(
    IPC.connectorList,
    (_e: IpcMainInvokeEvent, id: string, service?: string) =>
      vercelConnectList(agentPathOf(id), service),
  );
  ipcMain.handle(
    IPC.connectorCreate,
    (
      _e: IpcMainInvokeEvent,
      id: string,
      type: string,
      name: string,
      triggers: boolean,
    ) => vercelConnectCreate(agentPathOf(id), type, name, triggers),
  );
  ipcMain.handle(
    IPC.vercelConnectorCreateStream,
    (
      _e: IpcMainInvokeEvent,
      id: string,
      type: string,
      name: string,
      triggers: boolean,
    ) =>
      vercelConnectCreateStream(
        agentPathOf(id),
        type,
        name,
        triggers,
        // The authorize URL is single-use and short-lived — get it on screen the
        // instant the CLI prints it, not when the command finally exits.
        (data) => broadcast(IPC.vercelConnectorCreateChunk, { id, data }),
      ),
  );
  ipcMain.handle(
    IPC.connectorAttach,
    (_e: IpcMainInvokeEvent, id: string, connector: string, kind?: string) =>
      vercelConnectAttach(
        agentPathOf(id),
        connector,
        kind ? `/eve/v1/${kind}` : undefined,
      ),
  );
  ipcMain.handle(IPC.connectOpen, (_e: IpcMainInvokeEvent, id: string) =>
    openConnectWindow(agentPathOf(id)),
  );
  ipcMain.handle(
    IPC.connectOpenExternal,
    (_e: IpcMainInvokeEvent, id: string) =>
      openConnectExternal(agentPathOf(id)),
  );
  ipcMain.handle(
    IPC.connectorOpenPage,
    (_e: IpcMainInvokeEvent, id: string, connector: string) =>
      openConnector(agentPathOf(id), connector),
  );

  ipcMain.handle(
    IPC.agentReadInstructions,
    (_e: IpcMainInvokeEvent, id: string) => {
      const a = store.getAgent(id);
      if (!a) {
        throw new Error("Unknown agent.");
      }
      return readInstructions(a.path);
    },
  );
  ipcMain.handle(
    IPC.agentWriteInstructions,
    (_e: IpcMainInvokeEvent, id: string, content: string) => {
      const a = store.getAgent(id);
      if (!a) {
        throw new Error("Unknown agent.");
      }
      writeInstructions(a.path, content);
      return true;
    },
  );

  // --- CLI (build / deploy / eval), logs, scaffolding ---
  ipcMain.handle(
    IPC.cliRun,
    (
      _e: IpcMainInvokeEvent,
      id: string,
      kind: "build" | "deploy" | "evalRun",
      extra?: { ids?: string[] },
    ) => {
      const a = store.getAgent(id);
      if (!a) {
        throw new Error("Unknown agent.");
      }
      const runId = store.rid();
      const args =
        kind === "build"
          ? ["build"]
          : kind === "deploy"
            ? ["deploy", "--non-interactive", "--yes"]
            : ["eval", ...(extra?.ids ?? []), "--json"];
      // eve deploy shells out to a bare `vercel`; re-assert the fallback shim on
      // PATH right before so it succeeds without any global Vercel install.
      if (kind === "deploy") {
        ensureVercelShim();
      }
      cli.run(runId, a.path, args);
      return runId;
    },
  );
  ipcMain.handle(IPC.cliCancel, (_e: IpcMainInvokeEvent, runId: string) => {
    cli.cancel(runId);
    const login = loginChildren.get(runId);
    if (login) {
      try {
        login.kill("SIGKILL");
      } catch {
        // already gone
      }
      loginChildren.delete(runId);
    }
    return true;
  });
  ipcMain.handle(IPC.evalList, (_e: IpcMainInvokeEvent, id: string) => {
    const a = store.getAgent(id);
    if (!a) {
      throw new Error("Unknown agent.");
    }
    return listEvals(a.path);
  });
  ipcMain.handle(IPC.agentLogs, (_e: IpcMainInvokeEvent, id: string) =>
    agents.logs(id),
  );

  ipcMain.handle(
    IPC.skillCreate,
    (
      _e: IpcMainInvokeEvent,
      id: string,
      input: import("../shared/ipc").SkillInput,
    ) => {
      const a = store.getAgent(id);
      if (!a) {
        throw new Error("Unknown agent.");
      }
      try {
        return { ok: true, ...createSkill(a.path, input) };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );
  ipcMain.handle(
    IPC.connectionAdd,
    (
      _e: IpcMainInvokeEvent,
      id: string,
      input: import("../shared/ipc").ConnectionInput,
    ) => {
      const a = store.getAgent(id);
      if (!a) {
        throw new Error("Unknown agent.");
      }
      try {
        return { ok: true, ...addConnection(a.path, input) };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );
  ipcMain.handle(
    IPC.connectionRead,
    (_e: IpcMainInvokeEvent, id: string, name: string) =>
      readConnectionFile(agentPathOf(id), name),
  );
  ipcMain.handle(
    IPC.connectionWrite,
    (_e: IpcMainInvokeEvent, id: string, name: string, content: string) => {
      try {
        writeConnectionFile(agentPathOf(id), name, content);
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );
  ipcMain.handle(
    IPC.connectionDelete,
    (_e: IpcMainInvokeEvent, id: string, name: string) => {
      try {
        deleteConnectionFile(agentPathOf(id), name);
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );
  ipcMain.handle(
    IPC.connectorUsage,
    (_e: IpcMainInvokeEvent, id: string, uids: string[]) =>
      scanConnectorUsage(agentPathOf(id), uids),
  );

  // --- registry, memory slots, Arcana (eve 0.49) — see registryIpc.ts ---
  registerRegistryIpc(ipcMain, { agentPathOf, broadcast });

  // --- chat ---
  ipcMain.handle(
    IPC.chatListThreads,
    (_e: IpcMainInvokeEvent, agentId: string) => store.listThreads(agentId),
  );
  ipcMain.handle(
    IPC.chatCreateThread,
    (_e: IpcMainInvokeEvent, agentId: string, title?: string) =>
      store.createThread(agentId, title || "New chat"),
  );
  ipcMain.handle(
    IPC.chatGetThread,
    (_e: IpcMainInvokeEvent, threadId: string) => store.readEvents(threadId),
  );
  ipcMain.handle(
    IPC.chatDeleteThread,
    (_e: IpcMainInvokeEvent, threadId: string) => {
      store.deleteThread(threadId);
      return true;
    },
  );
  ipcMain.handle(
    IPC.chatArchiveThread,
    (_e: IpcMainInvokeEvent, threadId: string, archived: boolean) => {
      store.setThreadArchived(threadId, archived);
      return true;
    },
  );
  /** Resolve the session connection for a chat target (local dev vs deployed). */
  const resolveConn = (
    agentId: string,
    target: "local" | "deployed",
  ): SessionConn => {
    if (target === "deployed") {
      const d = store.getDeploy(agentId);
      if (!d.url) {
        throw new Error("No deployed URL set — set it in Chat → Deployed.");
      }
      const a = store.getAgent(agentId);
      const path = a?.path;
      const oidc = path ? readEnvLocal(path, "VERCEL_OIDC_TOKEN") : null;
      // Prefer the secret the user pasted; else the one Vercel exposes in .env.local.
      const bypass =
        d.bypassSecret ||
        (path ? readEnvLocal(path, "VERCEL_AUTOMATION_BYPASS_SECRET") : null);
      const headers: Record<string, string> = {};
      if (bypass) {
        // Header alone grants per-request access; do NOT set-bypass-cookie —
        // that makes Vercel issue a redirect that reads as "still protected".
        headers["x-vercel-protection-bypass"] = bypass;
      }
      if (oidc) {
        headers.Authorization = `Bearer ${oidc}`;
      }
      return { baseUrl: d.url.replace(/\/$/, ""), headers };
    }
    const url = agents.url(agentId);
    if (!url) {
      throw new Error("Agent isn't running — start it first.");
    }
    return { baseUrl: url };
  };

  ipcMain.handle(
    IPC.chatSend,
    (
      _e: IpcMainInvokeEvent,
      threadId: string,
      text: string,
      target: "local" | "deployed" = "local",
    ) => {
      const t = store.getThread(threadId);
      if (!t) {
        throw new Error("Unknown thread.");
      }
      const conn = resolveConn(t.agentId, target);
      if (t.title === "New chat") {
        store.touchThread(threadId, text.slice(0, 48));
      }
      void chat.send(threadId, conn, text);
      return true;
    },
  );
  ipcMain.handle(
    IPC.chatRespond,
    (
      _e: IpcMainInvokeEvent,
      threadId: string,
      requestId: string,
      optionId?: string,
      text?: string,
      target: "local" | "deployed" = "local",
    ) => {
      const t = store.getThread(threadId);
      if (!t) {
        throw new Error("Unknown thread.");
      }
      const conn = resolveConn(t.agentId, target);
      void chat.respond(threadId, conn, requestId, optionId, text);
      return true;
    },
  );
  /** Resolve a thread's connection for a session control op. */
  const threadConn = (
    threadId: string,
    target: "local" | "deployed",
  ): SessionConn => {
    const t = store.getThread(threadId);
    if (!t) {
      throw new Error("Unknown thread.");
    }
    return resolveConn(t.agentId, target);
  };
  const controlResult = async (
    fn: () => Promise<{ ok: boolean; status: string }>,
  ): Promise<{ ok: boolean; status: string; error?: string }> => {
    try {
      return await fn();
    } catch (err) {
      return {
        ok: false,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  };
  ipcMain.handle(
    IPC.chatCancel,
    (
      _e: IpcMainInvokeEvent,
      threadId: string,
      target: "local" | "deployed" = "local",
      turnId?: string,
    ) =>
      controlResult(() =>
        chat.cancelTurn(threadId, threadConn(threadId, target), turnId),
      ),
  );
  ipcMain.handle(
    IPC.chatCompact,
    (
      _e: IpcMainInvokeEvent,
      threadId: string,
      target: "local" | "deployed" = "local",
    ) =>
      controlResult(() =>
        chat.compactContext(threadId, threadConn(threadId, target)),
      ),
  );
  ipcMain.handle(
    IPC.chatClear,
    (
      _e: IpcMainInvokeEvent,
      threadId: string,
      target: "local" | "deployed" = "local",
    ) =>
      controlResult(() =>
        chat.clearContext(threadId, threadConn(threadId, target)),
      ),
  );
  ipcMain.handle(
    IPC.chatReset,
    (
      _e: IpcMainInvokeEvent,
      threadId: string,
      target: "local" | "deployed" = "local",
    ) =>
      controlResult(async () => {
        // The agent may be unreachable (stopped, offline); the local cursor
        // must still be dropped so the thread can start a fresh session.
        let conn: SessionConn | null = null;
        try {
          conn = threadConn(threadId, target);
        } catch {
          conn = null;
        }
        if (!conn) {
          chat.abort(threadId);
          store.setCursor(threadId, { streamIndex: 0 });
          return { ok: true, status: "no_active_session" };
        }
        return chat.resetSession(threadId, conn);
      }),
  );

  // --- deploy target / status ---
  ipcMain.handle(IPC.deployGet, (_e: IpcMainInvokeEvent, id: string) =>
    store.getDeploy(id),
  );
  ipcMain.handle(
    IPC.deploySet,
    (
      _e: IpcMainInvokeEvent,
      id: string,
      settings: import("../shared/ipc").DeploySettings,
    ) => {
      store.setDeploy(id, settings);
      return store.getDeploy(id);
    },
  );
  ipcMain.handle(IPC.vercelProdInfo, (_e: IpcMainInvokeEvent, id: string) =>
    vercelProdInfo(agentPathOf(id)),
  );
  ipcMain.handle(IPC.modelReadiness, (_e: IpcMainInvokeEvent, id: string) =>
    modelReadiness(agentPathOf(id)),
  );
  ipcMain.handle(IPC.gatewayModels, (_e: IpcMainInvokeEvent, id: string) =>
    gatewayModels(agentPathOf(id)),
  );
  ipcMain.handle(
    IPC.vercelLink,
    async (_e: IpcMainInvokeEvent, id: string, team?: string) => {
      await ensureNodeRuntime();
      return vercelLink(agentPathOf(id), team);
    },
  );
  ipcMain.handle(
    IPC.vercelTeams,
    async (_e: IpcMainInvokeEvent, id: string) => {
      await ensureNodeRuntime();
      return vercelTeams(agentPathOf(id));
    },
  );
  ipcMain.handle(
    IPC.vercelWhoami,
    async (_e: IpcMainInvokeEvent, id: string) => {
      await ensureNodeRuntime();
      return vercelWhoami(agentPathOf(id));
    },
  );
  ipcMain.handle(
    IPC.buzzGenKey,
    (_e: IpcMainInvokeEvent, id: string, relayUrl: string) =>
      buzzGenKey(id, relayUrl),
  );
  ipcMain.handle(IPC.buzzVerify, (_e: IpcMainInvokeEvent, id: string) =>
    buzzVerify(id),
  );
  ipcMain.handle(
    IPC.buzzSetProfile,
    (
      _e: IpcMainInvokeEvent,
      id: string,
      input: {
        name: string;
        about?: string;
        avatarPath?: string;
        avatarData?: string;
        avatarMime?: string;
        currentPicture?: string;
      },
    ) => buzzSetProfile(id, input),
  );
  ipcMain.handle(
    IPC.buzzSave,
    async (
      _e: IpcMainInvokeEvent,
      id: string,
      patch: Partial<import("../shared/ipc").BuzzCredInput>,
    ) => {
      // Fill the bypass secret automatically when the target URL lands.
      if (patch.targetUrl && !patch.bypassSecret) {
        const bp = await buzzBypassSecret(agentPathOf(id));
        if (bp) {
          patch.bypassSecret = bp;
        }
      }
      return buzzSave(id, patch);
    },
  );
  ipcMain.handle(IPC.buzzStatus, (_e: IpcMainInvokeEvent, id: string) =>
    buzzStatus(id),
  );
  ipcMain.handle(IPC.buzzGetProfile, (_e: IpcMainInvokeEvent, id: string) =>
    buzzGetProfile(id),
  );
  ipcMain.handle(
    IPC.buzzWire,
    async (_e: IpcMainInvokeEvent, id: string): Promise<{ ok: boolean; output: string }> => {
      const cred = store.getBuzz(id);
      if (!cred) {
        return { ok: false, output: "No Buzz identity — run the earlier steps first." };
      }
      const path = agentPathOf(id);
      const lines: string[] = [];
      // 1. Env vars (all environments) so the deployed agent can post + verify.
      for (const [k, v] of [
        ["BUZZ_RELAY_URL", cred.relayUrl],
        ["BUZZ_PRIVATE_KEY", cred.privateKey],
        ["BUZZ_WEBHOOK_SECRET", cred.webhookSecret],
        ["BUZZ_AGENT_NAME", cred.agentName ?? ""],
      ] as const) {
        const r = await vercelEnvSetAll(path, k, v);
        lines.push(`${k}: ${r.ok ? "set" : "FAILED"}`);
        if (!r.ok) {
          return { ok: false, output: lines.concat(r.output).join("\n") };
        }
      }
      // 2. Channel file.
      try {
        const w = writeChannel(path, { kind: "buzz", overwrite: true });
        lines.push(`${w.relPath} written`);
      } catch (err) {
        return {
          ok: false,
          output: lines.concat(err instanceof Error ? err.message : String(err)).join("\n"),
        };
      }
      // 3. nostr-tools dependency in the agent project.
      const pm = existsSync(join(path, "pnpm-lock.yaml")) ? "pnpm" : "npm";
      const inst = spawnSync(pm, pm === "pnpm" ? ["add", "nostr-tools"] : ["install", "nostr-tools"], {
        cwd: path,
        encoding: "utf8",
        timeout: 180_000,
      });
      lines.push(inst.status === 0 ? "nostr-tools installed" : `nostr-tools install FAILED: ${inst.stderr}`);
      return { ok: inst.status === 0, output: lines.join("\n") };
    },
  );
  ipcMain.handle(IPC.buzzBridgeStart, (_e: IpcMainInvokeEvent, id: string) =>
    buzzBridgeStart(id),
  );
  ipcMain.handle(IPC.buzzBridgeStop, (_e: IpcMainInvokeEvent, id: string) =>
    buzzBridgeStop(id),
  );
  ipcMain.handle(IPC.buzzBridgeInstall, (_e: IpcMainInvokeEvent, id: string) =>
    buzzBridgeInstall(id),
  );
  ipcMain.handle(IPC.buzzBridgeUninstall, (_e: IpcMainInvokeEvent, id: string) =>
    buzzBridgeUninstall(id),
  );
  ipcMain.handle(IPC.telegramVerify, (_e: IpcMainInvokeEvent, token: string) =>
    telegramVerify(token),
  );
  ipcMain.handle(
    IPC.telegramSetWebhook,
    (_e: IpcMainInvokeEvent, token: string, url: string, secret: string) =>
      telegramSetWebhook(token, url, secret),
  );
  ipcMain.handle(
    IPC.telegramWebhookInfo,
    (_e: IpcMainInvokeEvent, token: string) => telegramWebhookInfo(token),
  );
  ipcMain.handle(
    IPC.telegramSave,
    (
      _e: IpcMainInvokeEvent,
      id: string,
      cred: import("../shared/ipc").TelegramCredInput,
    ) => {
      store.setTelegram(id, cred);
      return { ok: true };
    },
  );
  ipcMain.handle(
    IPC.telegramStatus,
    async (
      _e: IpcMainInvokeEvent,
      id: string,
    ): Promise<import("../shared/ipc").TelegramStatus> => {
      const cred = store.getTelegram(id);
      if (!cred?.botToken) {
        return { configured: false };
      }
      const info = await telegramWebhookInfo(cred.botToken);
      return {
        configured: true,
        live: info.ok ? info.live : false,
        url: info.url ?? null,
        pending: info.pending ?? 0,
        lastError: info.ok ? (info.lastError ?? null) : (info.error ?? null),
        botUsername: cred.botUsername ?? null,
      };
    },
  );
  ipcMain.handle(
    IPC.vercelProdAlias,
    async (_e: IpcMainInvokeEvent, id: string) => {
      await ensureNodeRuntime();
      return vercelProdAlias(agentPathOf(id));
    },
  );
  // --- Twilio ---
  ipcMain.handle(
    IPC.twilioVerify,
    (_e: IpcMainInvokeEvent, sid: string, token: string) =>
      twilioVerify(sid, token),
  );
  ipcMain.handle(
    IPC.twilioNumbers,
    (_e: IpcMainInvokeEvent, sid: string, token: string) =>
      twilioListNumbers(sid, token),
  );
  ipcMain.handle(
    IPC.twilioSave,
    (
      _e: IpcMainInvokeEvent,
      id: string,
      cred: import("../shared/ipc").TwilioCredInput,
    ) => {
      store.setTwilio(id, cred);
      return { ok: true };
    },
  );
  ipcMain.handle(
    IPC.twilioSetWebhooks,
    async (
      _e: IpcMainInvokeEvent,
      id: string,
      base: string,
    ): Promise<import("../shared/ipc").TwilioWebhookResult> => {
      const cred = store.getTwilio(id);
      if (!cred?.accountSid || !cred.phoneSid) {
        return { ok: false, error: "Finish the number step first." };
      }
      return twilioSetWebhooks(
        cred.accountSid,
        cred.authToken,
        cred.phoneSid,
        base,
      );
    },
  );
  ipcMain.handle(
    IPC.twilioStatus,
    async (
      _e: IpcMainInvokeEvent,
      id: string,
    ): Promise<import("../shared/ipc").TwilioStatus> => {
      const cred = store.getTwilio(id);
      if (!cred?.accountSid || !cred.phoneSid) {
        return { configured: false };
      }
      const r = await twilioNumberStatus(
        cred.accountSid,
        cred.authToken,
        cred.phoneSid,
      );
      return {
        configured: true,
        live: r.ok ? r.live : false,
        phoneNumber: cred.phoneNumber ?? null,
        smsUrl: r.ok ? (r.smsUrl ?? null) : null,
        lastError: r.ok ? null : (r.error ?? null),
      };
    },
  );
  // --- Microsoft Teams ---
  ipcMain.handle(
    IPC.teamsVerify,
    (
      _e: IpcMainInvokeEvent,
      appId: string,
      password: string,
      tenantId?: string,
    ) => teamsVerify(appId, password, tenantId),
  );
  ipcMain.handle(
    IPC.teamsSave,
    (
      _e: IpcMainInvokeEvent,
      id: string,
      cred: import("../shared/ipc").TeamsCredInput,
    ) => {
      store.setTeams(id, cred);
      return { ok: true };
    },
  );
  ipcMain.handle(
    IPC.teamsStatus,
    async (
      _e: IpcMainInvokeEvent,
      id: string,
    ): Promise<import("../shared/ipc").TeamsStatus> => {
      const cred = store.getTeams(id);
      if (!cred?.appId) {
        return { configured: false };
      }
      const r = await teamsVerify(cred.appId, cred.appPassword, cred.tenantId);
      return {
        configured: true,
        live: r.ok,
        lastError: r.ok ? null : (r.error ?? null),
      };
    },
  );
  ipcMain.handle(IPC.discordVerify, (_e: IpcMainInvokeEvent, token: string) =>
    discordVerify(token),
  );
  ipcMain.handle(
    IPC.discordSave,
    (
      _e: IpcMainInvokeEvent,
      id: string,
      cred: import("../shared/ipc").DiscordCredInput,
    ) => {
      store.setDiscord(id, cred);
      return { ok: true };
    },
  );
  ipcMain.handle(
    IPC.discordRegisterCommands,
    async (_e: IpcMainInvokeEvent, id: string) => {
      const cred = store.getDiscord(id);
      if (!cred?.botToken || !cred.applicationId) {
        return { ok: false, error: "Finish the Bot step first." };
      }
      const r = await discordRegisterCommands(
        cred.botToken,
        cred.applicationId,
      );
      if (r.ok) {
        store.setDiscord(id, { ...cred, commandsRegistered: true });
      }
      return r;
    },
  );
  ipcMain.handle(
    IPC.discordSetEndpoint,
    async (
      _e: IpcMainInvokeEvent,
      id: string,
      url: string,
    ): Promise<import("../shared/ipc").DiscordEndpointResult> => {
      const cred = store.getDiscord(id);
      if (!cred?.botToken) {
        return { ok: false, error: "Finish the Bot step first." };
      }
      const r = await discordSetEndpoint(cred.botToken, url);
      if (r.ok) {
        store.setDiscord(id, { ...cred, endpointUrl: url });
      }
      return r;
    },
  );
  ipcMain.handle(
    IPC.discordStatus,
    async (
      _e: IpcMainInvokeEvent,
      id: string,
    ): Promise<import("../shared/ipc").DiscordStatus> => {
      const cred = store.getDiscord(id);
      if (!cred?.botToken) {
        return { configured: false };
      }
      // getApplications/@me both validates the token and reports whether an
      // interactions endpoint is set (Discord only allows one once verified).
      const r = await discordVerify(cred.botToken);
      if (!r.ok) {
        return { configured: true, live: false, lastError: r.error ?? null };
      }
      const url = r.endpointUrl ?? cred.endpointUrl ?? null;
      return {
        configured: true,
        live: Boolean(url),
        url,
        name: r.name ?? null,
        lastError: null,
      };
    },
  );
  ipcMain.handle(
    IPC.telegramRegisterWebhook,
    async (
      _e: IpcMainInvokeEvent,
      id: string,
      url: string,
    ): Promise<import("../shared/ipc").TelegramWebhookResult> => {
      const cred = store.getTelegram(id);
      if (!cred?.botToken) {
        return {
          ok: false,
          error: "No saved bot — finish the Bot step first.",
        };
      }
      // Register with the STORED secret so it always matches the deployed env —
      // never a freshly generated one that would force a redeploy.
      const r = await telegramSetWebhook(
        cred.botToken,
        url,
        cred.webhookSecret,
      );
      if (r.ok) {
        store.setTelegram(id, { ...cred, webhookUrl: url });
      }
      return r;
    },
  );
  ipcMain.handle(
    IPC.vercelLogin,
    async (_e: IpcMainInvokeEvent, id: string) => {
      const runId = store.rid();
      try {
        await ensureNodeRuntime();
      } catch (err) {
        // Runtime couldn't be provisioned (e.g. offline first run) — report it as
        // a failed run so the UI shows the reason and re-enables the button,
        // rather than spawning against a missing Node and hanging.
        const msg = err instanceof Error ? err.message : String(err);
        broadcast(IPC.cliChunk, { runId, data: `${msg}\n` });
        broadcast(IPC.cliExit, { runId, code: -1 });
        return runId;
      }
      const child = startVercelLogin(
        agentPathOf(id),
        (data) => broadcast(IPC.cliChunk, { runId, data }),
        (code) => {
          loginChildren.delete(runId);
          broadcast(IPC.cliExit, { runId, code });
        },
      );
      loginChildren.set(runId, child);
      // The device code expires; don't leave a process waiting forever if the
      // user never finishes in the browser. Its exit drives the UI's failure path.
      const killTimer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // already gone
        }
      }, 5 * 60_000);
      child.on("exit", () => clearTimeout(killTimer));
      return runId;
    },
  );
  ipcMain.handle(
    IPC.deployHealth,
    async (_e: IpcMainInvokeEvent, id: string) => {
      let conn: SessionConn;
      try {
        conn = resolveConn(id, "deployed");
      } catch (err) {
        return {
          ok: false,
          status: 0,
          protected: false,
          reason: err instanceof Error ? err.message : String(err),
        };
      }
      const h = await checkHealth(conn);
      let reason: string | undefined;
      if (h.protected) {
        reason =
          "Blocked by Vercel Deployment Protection — add a Protection Bypass secret below.";
      } else if (h.status === 401 || h.status === 403) {
        reason =
          "Reached the agent but route auth rejected the request — run `vercel env pull` to refresh the OIDC token, or the agent's eve channel auth blocks external clients.";
      } else if (!h.ok && h.status === 0) {
        reason = "Couldn't reach the URL.";
      }
      return { ...h, reason };
    },
  );

  return { agents, cli };
}
