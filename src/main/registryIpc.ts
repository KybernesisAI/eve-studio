import type { IpcMain, IpcMainInvokeEvent } from "electron";
import {
  type ArcanaResult,
  type ArcanaStats,
  type ConnectorsAttached,
  type DetectedBrain,
  IPC,
  type MemorySlotsResult,
  type MigrateBrainResult,
  type QueryHit,
  type RegistryInstallOptions,
  type RegistryInstallResult,
  type RegistryListResult,
  type SelfModStatus,
  type TimelineEvent,
  type WireBrainInput,
  type WireBrainResult,
} from "../shared/ipc";
import {
  arcanaQuery,
  arcanaStats,
  arcanaTimeline,
  arcanaValidate,
} from "./arcana";
import {
  ARCANA_KEY_VAR,
  ARCANA_WORKSPACE_VAR,
  addFileMemory,
  detectBrain,
  readExtensionMount,
  writeExtensionMount,
  listMemorySlots,
  migrateLegacyBrain,
  resolveBrainCredential,
  selfModificationStatus,
  wireBrain,
} from "./arcanaWire";
import { registryAdd, registryList, registryView } from "./registry";
import * as store from "./store";
import {
  vercelConnectProjectsMap,
  vercelEnvSetAll,
  vercelStatus,
} from "./vercel";

/** What the registry/memory handlers need from the main IPC module. */
export interface RegistryIpcDeps {
  /** Resolve a registered agent id to its project path (throws when unknown). */
  agentPathOf: (id: string) => string;
  /** Push a payload to every renderer window. */
  broadcast: (channel: string, payload: unknown) => void;
}

/**
 * Registry (`eve add` / `eve registry`), memory-slot and Arcana handlers for
 * eve 0.49. Registered from `ipc.ts` with one line so the handler bodies live
 * here.
 */
export function registerRegistryIpc(
  ipcMain: IpcMain,
  deps: RegistryIpcDeps,
): void {
  const { agentPathOf, broadcast } = deps;
  const streamer =
    (runId: string) =>
    (data: string): void =>
      broadcast(IPC.registryAddChunk, { runId, data });

  /** Push both Arcana env vars to the linked Vercel project (all targets). */
  const pushArcanaEnv = async (
    path: string,
    workspace: string,
    key: string,
  ): Promise<boolean> => {
    if (!vercelStatus(path).linked) {
      return false;
    }
    const a = await vercelEnvSetAll(path, ARCANA_WORKSPACE_VAR, workspace);
    const b = await vercelEnvSetAll(path, ARCANA_KEY_VAR, key);
    return a.ok && b.ok;
  };

  // ---- registry ----
  ipcMain.handle(
    IPC.registryList,
    (
      _e: IpcMainInvokeEvent,
      id: string,
      force?: boolean,
    ): Promise<RegistryListResult> =>
      registryList(agentPathOf(id), Boolean(force)),
  );
  ipcMain.handle(
    IPC.registryView,
    (_e: IpcMainInvokeEvent, id: string, item: string): Promise<string> =>
      registryView(agentPathOf(id), item),
  );
  ipcMain.handle(
    IPC.registryAdd,
    (
      _e: IpcMainInvokeEvent,
      id: string,
      item: string,
      runId: string,
      opts?: RegistryInstallOptions,
    ): Promise<RegistryInstallResult> =>
      registryAdd(agentPathOf(id), item, opts ?? {}, streamer(runId)),
  );

  // ---- memory slots ----
  ipcMain.handle(
    IPC.memorySlots,
    (_e: IpcMainInvokeEvent, id: string): MemorySlotsResult =>
      listMemorySlots(agentPathOf(id)),
  );
  ipcMain.handle(
    IPC.memoryAddFile,
    (
      _e: IpcMainInvokeEvent,
      id: string,
      slot?: string,
      description?: string,
    ): { ok: boolean; relPath?: string; error?: string } => {
      try {
        return addFileMemory(agentPathOf(id), slot || "profile", description);
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );
  ipcMain.handle(
    IPC.memoryAddSupermemory,
    (
      _e: IpcMainInvokeEvent,
      id: string,
      runId: string,
    ): Promise<RegistryInstallResult> =>
      registryAdd(agentPathOf(id), "memory/supermemory", {}, streamer(runId)),
  );

  // ---- self-modification (experimental, dev only) ----
  ipcMain.handle(
    IPC.selfModStatus,
    (_e: IpcMainInvokeEvent, id: string): SelfModStatus =>
      selfModificationStatus(agentPathOf(id)),
  );
  ipcMain.handle(
    IPC.selfModEnable,
    (
      _e: IpcMainInvokeEvent,
      id: string,
      runId: string,
    ): Promise<RegistryInstallResult> =>
      registryAdd(
        agentPathOf(id),
        "experimental/self-modification",
        {},
        streamer(runId),
      ),
  );

  // ---- Vercel Connect: which connectors are attached to this project ----
  ipcMain.handle(
    IPC.connectorsAttached,
    async (_e: IpcMainInvokeEvent, id: string): Promise<ConnectorsAttached> => {
      const path = agentPathOf(id);
      const projectId = vercelStatus(path).projectId ?? null;
      if (!projectId) {
        return { projectId: null, attached: [] };
      }
      try {
        const map = await vercelConnectProjectsMap(path);
        return {
          projectId,
          attached: Object.entries(map)
            .filter(([, projects]) => projects.includes(projectId))
            .map(([uid]) => uid),
        };
      } catch {
        return { projectId, attached: [] };
      }
    },
  );

  // ---- extension mount files (agent/extensions/<ns>.ts) ----
  ipcMain.handle(
    IPC.extensionMountRead,
    (_e: IpcMainInvokeEvent, id: string, ns: string) =>
      readExtensionMount(agentPathOf(id), ns),
  );
  ipcMain.handle(
    IPC.extensionMountWrite,
    (_e: IpcMainInvokeEvent, id: string, ns: string, content: string) => {
      try {
        return writeExtensionMount(agentPathOf(id), ns, content);
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  // ---- arcana (long-term brain) ----
  ipcMain.handle(
    IPC.arcanaDetect,
    (_e: IpcMainInvokeEvent, id: string): DetectedBrain =>
      detectBrain(agentPathOf(id)),
  );
  ipcMain.handle(
    IPC.arcanaValidate,
    (
      _e: IpcMainInvokeEvent,
      workspace: string,
      key: string,
    ): Promise<ArcanaResult<ArcanaStats>> => arcanaValidate(workspace, key),
  );

  /**
   * Browse credential: the agent's own env (`ARCANA_API_KEY` + workspace from
   * the mount / legacy file), else a credential an older Studio saved.
   */
  const credOf = (id: string): { workspace: string; key: string } => {
    const fromEnv = resolveBrainCredential(agentPathOf(id));
    if (fromEnv) {
      return fromEnv;
    }
    const saved = store.getBrain(id);
    if (saved?.workspace && saved.key) {
      return { workspace: saved.workspace, key: saved.key };
    }
    throw new Error(
      `No Arcana credential for this agent — set ${ARCANA_KEY_VAR} and ${ARCANA_WORKSPACE_VAR} in .env.local or wire the brain.`,
    );
  };
  const guarded = async <T>(
    fn: () => Promise<ArcanaResult<T>>,
  ): Promise<ArcanaResult<T>> => {
    try {
      return await fn();
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  };
  ipcMain.handle(
    IPC.arcanaStats,
    (_e: IpcMainInvokeEvent, id: string): Promise<ArcanaResult<ArcanaStats>> =>
      guarded(() => {
        const c = credOf(id);
        return arcanaStats(c.workspace, c.key);
      }),
  );
  ipcMain.handle(
    IPC.arcanaTimeline,
    (
      _e: IpcMainInvokeEvent,
      id: string,
      limit?: number,
    ): Promise<ArcanaResult<TimelineEvent[]>> =>
      guarded(() => {
        const c = credOf(id);
        return arcanaTimeline(c.workspace, c.key, limit ?? 30);
      }),
  );
  ipcMain.handle(
    IPC.arcanaQuery,
    (
      _e: IpcMainInvokeEvent,
      id: string,
      q: string,
    ): Promise<ArcanaResult<QueryHit[]>> =>
      guarded(() => {
        const c = credOf(id);
        return arcanaQuery(c.workspace, c.key, q);
      }),
  );

  ipcMain.handle(
    IPC.arcanaWire,
    async (
      _e: IpcMainInvokeEvent,
      id: string,
      input: WireBrainInput,
      runId?: string,
    ): Promise<WireBrainResult> => {
      const path = agentPathOf(id);
      try {
        const r = await wireBrain(
          path,
          input,
          runId ? streamer(runId) : undefined,
        );
        if (!r.ok) {
          return r;
        }
        // Deploys don't ship local .env files — push both vars so the DEPLOYED
        // agent has memory too.
        const pushedToVercel = await pushArcanaEnv(
          path,
          input.workspace.trim(),
          input.key.trim(),
        );
        // Older Studio builds browsed via a saved credential; drop it so the
        // env-based one is authoritative.
        store.deleteBrain(id);
        return { ...r, pushedToVercel };
      } catch (err) {
        return {
          ok: false,
          usedFallback: false,
          files: [],
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  ipcMain.handle(
    IPC.arcanaMigrate,
    async (
      _e: IpcMainInvokeEvent,
      id: string,
      runId?: string,
    ): Promise<MigrateBrainResult> => {
      const path = agentPathOf(id);
      try {
        const r = await migrateLegacyBrain(
          path,
          runId ? streamer(runId) : undefined,
        );
        if (r.ok && r.wire?.ok) {
          const cred = resolveBrainCredential(path);
          if (cred) {
            const pushedToVercel = await pushArcanaEnv(
              path,
              cred.workspace,
              cred.key,
            );
            r.wire = { ...r.wire, pushedToVercel };
          }
          store.deleteBrain(id);
        }
        return r;
      } catch (err) {
        return {
          ok: false,
          removedLegacy: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );
}
