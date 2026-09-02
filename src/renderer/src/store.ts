import type {
  AgentRecord,
  AgentRuntimeState,
  AgentStructure,
  ChatStatus,
  ChatTarget,
  EveEvent,
  ThreadRecord,
} from "@shared/ipc";
import { create } from "zustand";

/** Per-agent workspace tabs (plus the global "settings"). */
export type Section =
  | "chat"
  | "instructions"
  | "capabilities"
  | "integrations"
  | "memory"
  | "schedules"
  | "deploy"
  | "evals"
  | "settings";

interface State {
  section: Section;
  agents: AgentRecord[];
  runtime: Record<string, AgentRuntimeState>;
  activeAgentId: string | null;
  threads: Record<string, ThreadRecord[]>;
  activeThreadId: string | null;
  events: Record<string, EveEvent[]>;
  status: Record<string, ChatStatus>;
  /** Last error text per thread (set alongside `status: "error"`). */
  statusError: Record<string, string>;
  structure: Record<string, AgentStructure>;
  structureLoading: Record<string, boolean>;
  chatTarget: Record<string, ChatTarget>;
  deployNonce: number;
  booted: boolean;
  /** `eve@latest` on npm (null while unknown / offline). */
  eveLatest: string | null;
  /** Which Deploy sub-tab to show when the Deploy section opens. */
  deploySub: "deploy" | "environment" | "sandbox";

  init: () => Promise<void>;
  setSection: (s: Section) => void;
  refreshAgents: () => Promise<void>;
  addAgent: () => Promise<void>;
  removeAgent: (id: string) => Promise<void>;
  startAgent: (id: string) => Promise<void>;
  stopAgent: (id: string) => Promise<void>;
  setActiveAgent: (id: string) => Promise<void>;
  /**
   * Load the compiled structure. `force` bypasses the renderer cache;
   * `refresh` additionally makes main re-run `eve info --json`.
   */
  loadStructure: (id: string, force?: boolean, refresh?: boolean) => Promise<void>;
  openAgentChat: (id: string) => Promise<void>;
  loadThreads: (agentId: string) => Promise<void>;
  newThread: (agentId: string) => Promise<void>;
  selectThread: (threadId: string) => Promise<void>;
  deleteThread: (threadId: string) => Promise<void>;
  archiveThread: (threadId: string, archived: boolean) => Promise<void>;
  send: (text: string) => Promise<void>;
  respond: (
    requestId: string,
    optionId?: string,
    text?: string,
  ) => Promise<void>;
  setChatTarget: (agentId: string, target: ChatTarget) => void;
  bumpDeploy: () => void;
  /** Refresh the npm `eve@latest` version (cached in main). */
  loadEveLatest: (force?: boolean) => Promise<void>;
  /** Jump to the Deploy section on a given sub-tab. */
  openDeploy: (sub: "deploy" | "environment" | "sandbox") => void;
  /** Cancel the active turn on the current thread (eve `/cancel`). */
  cancelTurn: () => Promise<void>;
  /** Summarize the current thread's context in place (eve `/compact`). */
  compactContext: () => Promise<void>;
  /** Drop the current thread's model history (eve `/clear`). */
  clearContext: () => Promise<void>;
  /** Retire the session and archive the thread locally (eve `/reset`). */
  resetSession: () => Promise<void>;
  /** Last control-op outcome for the active thread (transient notice). */
  controlNotice: { threadId: string; text: string; ok: boolean } | null;
  clearControlNotice: () => void;
}

export const useStore = create<State>((set, get) => ({
  section: "chat",
  agents: [],
  runtime: {},
  activeAgentId: null,
  threads: {},
  activeThreadId: null,
  events: {},
  status: {},
  statusError: {},
  structure: {},
  structureLoading: {},
  chatTarget: {},
  deployNonce: 0,
  booted: false,
  eveLatest: null,
  deploySub: "deploy",

  init: async () => {
    if (get().booted) {
      return;
    }
    set({ booted: true });

    window.studio.agents.onStatusChanged((s) =>
      set((st) => ({ runtime: { ...st.runtime, [s.agentId]: s } })),
    );
    window.studio.chat.onEvent(({ threadId, event }) =>
      set((st) => ({
        events: {
          ...st.events,
          [threadId]: [...(st.events[threadId] ?? []), event],
        },
      })),
    );
    window.studio.chat.onStatus(({ threadId, status, error }) =>
      set((st) => ({
        status: { ...st.status, [threadId]: status },
        statusError: {
          ...st.statusError,
          [threadId]: status === "error" ? (error ?? "Turn failed.") : "",
        },
      })),
    );

    await get().refreshAgents();
    void get().loadEveLatest();
  },

  setSection: (s) => set({ section: s }),

  loadEveLatest: async (force) => {
    try {
      set({ eveLatest: await window.studio.agents.eveLatest(force) });
    } catch {
      // offline, keep whatever we had
    }
  },

  openDeploy: (sub) => set({ section: "deploy", deploySub: sub }),

  refreshAgents: async () => {
    const agents = await window.studio.agents.list();
    const runtime: Record<string, AgentRuntimeState> = { ...get().runtime };
    for (const a of agents) {
      runtime[a.id] = await window.studio.agents.status(a.id);
    }
    set({ agents, runtime });
    // Auto-select the first agent so the workspace is never empty-with-agents.
    if (!get().activeAgentId && agents[0]) {
      void get().setActiveAgent(agents[0].id);
    }
  },

  addAgent: async () => {
    const res = await window.studio.agents.add();
    if (!res.ok) {
      if (res.error && res.error !== "cancelled") {
        window.alert(res.error);
      }
      return;
    }
    await get().refreshAgents();
  },

  removeAgent: async (id) => {
    await window.studio.agents.remove(id);
    if (get().activeAgentId === id) {
      set({ activeAgentId: null, activeThreadId: null });
    }
    await get().refreshAgents();
  },

  startAgent: async (id) => {
    const s = await window.studio.agents.start(id);
    set((st) => ({ runtime: { ...st.runtime, [id]: s } }));
  },

  stopAgent: async (id) => {
    const s = await window.studio.agents.stop(id);
    set((st) => ({ runtime: { ...st.runtime, [id]: s } }));
  },

  setActiveAgent: async (id) => {
    if (get().activeAgentId === id) {
      return;
    }
    set({ activeAgentId: id, activeThreadId: null });
    void get().loadStructure(id);
    await get().loadThreads(id);
    // Only auto-open a live (non-archived) thread, never a hidden/archived one.
    const first = (get().threads[id] ?? []).find((t) => !t.archived);
    if (first) {
      await get().selectThread(first.id);
    }
  },

  loadStructure: async (id, force, refresh) => {
    if (!force && (get().structure[id] || get().structureLoading[id])) {
      return;
    }
    set((st) => ({ structureLoading: { ...st.structureLoading, [id]: true } }));
    try {
      const s = await window.studio.agents.structure(id, refresh);
      set((st) => ({ structure: { ...st.structure, [id]: s } }));
      // An explicit reload usually follows an outside change (eve upgrade,
      // `eve add`, git pull); re-read installed eve versions at the same time.
      if (force) {
        void get().refreshAgents();
      }
    } finally {
      set((st) => ({
        structureLoading: { ...st.structureLoading, [id]: false },
      }));
    }
  },

  openAgentChat: async (id) => {
    const rt = get().runtime[id];
    if (!rt || rt.status !== "running") {
      await get().startAgent(id);
    }
    set({ activeAgentId: id, section: "chat" });
    await get().loadThreads(id);
    const first = (get().threads[id] ?? []).find((t) => !t.archived);
    if (first) {
      await get().selectThread(first.id);
    } else {
      await get().newThread(id);
    }
  },

  loadThreads: async (agentId) => {
    const threads = await window.studio.chat.listThreads(agentId);
    set((st) => ({ threads: { ...st.threads, [agentId]: threads } }));
  },

  newThread: async (agentId) => {
    const t = await window.studio.chat.createThread(agentId);
    await get().loadThreads(agentId);
    set((st) => ({
      activeThreadId: t.id,
      events: { ...st.events, [t.id]: [] },
    }));
  },

  selectThread: async (threadId) => {
    const events = await window.studio.chat.getThread(threadId);
    set((st) => ({
      activeThreadId: threadId,
      events: { ...st.events, [threadId]: events },
    }));
  },

  deleteThread: async (threadId) => {
    await window.studio.chat.deleteThread(threadId);
    const aid = get().activeAgentId;
    if (aid) {
      await get().loadThreads(aid);
    }
    if (get().activeThreadId === threadId) {
      set({ activeThreadId: null });
    }
  },

  archiveThread: async (threadId, archived) => {
    await window.studio.chat.archiveThread(threadId, archived);
    const aid = get().activeAgentId;
    if (aid) {
      await get().loadThreads(aid);
    }
    // Leaving the conversation when its thread is archived.
    if (archived && get().activeThreadId === threadId) {
      set({ activeThreadId: null });
    }
  },

  send: async (text) => {
    const tid = get().activeThreadId;
    const aid = get().activeAgentId;
    if (tid) {
      const target = aid ? (get().chatTarget[aid] ?? "local") : "local";
      // Show the outgoing message at once. The server echoes it back as
      // `message.received` only once the run is accepted, which on a cold
      // production deployment can take a while; the projector drops the echo
      // when it matches this provisional bubble.
      set((st) => ({
        events: {
          ...st.events,
          [tid]: [
            ...(st.events[tid] ?? []),
            {
              type: "studio.user",
              data: { message: text },
              meta: { at: new Date().toISOString() },
            },
          ],
        },
      }));
      await window.studio.chat.send(tid, text, target);
    }
  },

  respond: async (requestId, optionId, text) => {
    const tid = get().activeThreadId;
    const aid = get().activeAgentId;
    if (tid) {
      const target = aid ? (get().chatTarget[aid] ?? "local") : "local";
      await window.studio.chat.respond(tid, requestId, optionId, text, target);
    }
  },

  setChatTarget: (agentId, target) =>
    set((st) => ({ chatTarget: { ...st.chatTarget, [agentId]: target } })),

  bumpDeploy: () => set((st) => ({ deployNonce: st.deployNonce + 1 })),

  controlNotice: null,
  clearControlNotice: () => set({ controlNotice: null }),

  cancelTurn: async () => {
    const tid = get().activeThreadId;
    const aid = get().activeAgentId;
    if (!tid) {
      return;
    }
    const target = aid ? (get().chatTarget[aid] ?? "local") : "local";
    const r = await window.studio.chat.cancel(tid, target);
    if (!r.ok) {
      set({
        controlNotice: {
          threadId: tid,
          ok: false,
          text: r.error ?? `Cancel failed (${r.status}).`,
        },
      });
    }
  },

  compactContext: async () => {
    const tid = get().activeThreadId;
    const aid = get().activeAgentId;
    if (!tid) {
      return;
    }
    const target = aid ? (get().chatTarget[aid] ?? "local") : "local";
    const r = await window.studio.chat.compact(tid, target);
    set({
      controlNotice: {
        threadId: tid,
        ok: r.ok,
        text: r.ok
          ? r.status === "no_active_session"
            ? "No active session to compact. Send a message first."
            : "Compaction requested: eve summarizes the context in place."
          : (r.error ?? `Compact failed (${r.status}).`),
      },
    });
  },

  clearContext: async () => {
    const tid = get().activeThreadId;
    const aid = get().activeAgentId;
    if (!tid) {
      return;
    }
    const target = aid ? (get().chatTarget[aid] ?? "local") : "local";
    const r = await window.studio.chat.clear(tid, target);
    set({
      controlNotice: {
        threadId: tid,
        ok: r.ok,
        text: r.ok
          ? r.status === "no_active_session"
            ? "No active session to clear. Send a message first."
            : "Context cleared: the session keeps its id, tools and state."
          : (r.error ?? `Clear failed (${r.status}).`),
      },
    });
  },

  resetSession: async () => {
    const tid = get().activeThreadId;
    const aid = get().activeAgentId;
    if (!tid) {
      return;
    }
    const target = aid ? (get().chatTarget[aid] ?? "local") : "local";
    const r = await window.studio.chat.reset(tid, target);
    if (!r.ok) {
      set({
        controlNotice: {
          threadId: tid,
          ok: false,
          text: r.error ?? `Reset failed (${r.status}).`,
        },
      });
      return;
    }
    // The session is retired; close the thread locally and start a fresh one.
    await get().archiveThread(tid, true);
    if (aid) {
      await get().newThread(aid);
    }
  },
}));
