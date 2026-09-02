import type { AppInfo, ModelReadiness, ProdInfo } from "@shared/ipc";
import { useEffect, useState } from "react";
import { isNewerVersion } from "./lib/semver";
import { type Section, useStore } from "./store";
import {
  IconBot,
  IconBrain,
  IconCalendar,
  IconChat,
  IconCheck,
  IconExternal,
  IconFile,
  IconFolder,
  IconPlay,
  IconPlus,
  IconPlug,
  IconRocket,
  IconArchive,
  IconInbox,
  IconSettings,
  IconStop,
  IconTrash,
  IconWrench,
} from "./ui/icons";
import { EveLogo } from "./ui/EveLogo";
import { Button, Modal, StatusDot, type TabItem, Tabs } from "./ui/kit";
import { Chat } from "./views/Chat";
import { CreateAgent } from "./views/CreateAgent";
import { Evals } from "./views/Evals";
import {
  CapabilitiesGroup,
  DeployGroup,
  InstructionsGroup,
  IntegrationsGroup,
} from "./views/Grouped";
import { Memory } from "./views/Memory";
import { Schedules } from "./views/Schedules";
import { Settings } from "./views/Settings";
import { EveUpgradeModal } from "./components/EveUpgrade";
import { UpdateBadge } from "./components/UpdateBadge";
import { Welcome } from "./views/Welcome";

const TABS: TabItem[] = [
  { id: "chat", label: "Chat", icon: IconChat },
  { id: "instructions", label: "Instructions", icon: IconFile },
  { id: "capabilities", label: "Capabilities", icon: IconWrench },
  { id: "integrations", label: "Integrations", icon: IconPlug },
  { id: "memory", label: "Memory", icon: IconBrain },
  { id: "schedules", label: "Schedules", icon: IconCalendar },
  { id: "deploy", label: "Deploy", icon: IconRocket },
  { id: "evals", label: "Evals", icon: IconCheck },
];

function AgentWorkspace(): JSX.Element {
  const section = useStore((s) => s.section);
  const setSection = useStore((s) => s.setSection);
  const activeAgentId = useStore((s) => s.activeAgentId);
  const agents = useStore((s) => s.agents);
  const runtime = useStore((s) => s.runtime);
  const structure = useStore((s) =>
    activeAgentId ? s.structure[activeAgentId] : undefined,
  );
  const startAgent = useStore((s) => s.startAgent);
  const stopAgent = useStore((s) => s.stopAgent);
  const openDeploy = useStore((s) => s.openDeploy);
  const eveLatest = useStore((s) => s.eveLatest);

  const deployNonce = useStore((s) => s.deployNonce);
  const [prod, setProd] = useState<ProdInfo | null>(null);
  const [ready, setReady] = useState<ModelReadiness | null>(null);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  // Re-read the agent list (installed eve versions, link state) whenever the
  // window regains focus, so changes made in a terminal show up without a
  // restart. Throttled so alt-tabbing does not hammer the filesystem.
  useEffect(() => {
    let last = 0;
    const onFocus = (): void => {
      const now = Date.now();
      if (now - last < 5_000) {
        return;
      }
      last = now;
      void useStore.getState().refreshAgents();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  useEffect(() => {
    if (activeAgentId) {
      window.studio.vercel
        .prodInfo(activeAgentId)
        .then(setProd)
        .catch(() => setProd(null));
      window.studio.vercel
        .modelReadiness(activeAgentId)
        .then(setReady)
        .catch(() => setReady(null));
    }
  }, [activeAgentId, deployNonce]);

  const agent = agents.find((a) => a.id === activeAgentId);
  const rt = activeAgentId ? runtime[activeAgentId] : undefined;
  const status = rt?.status ?? "stopped";

  if (!agent) {
    return <div className="flex-1" />;
  }

  const tabs = TABS.map((t) =>
    t.id === "schedules" ? { ...t, count: structure?.schedules.length } : t,
  );

  const busy = status === "starting";
  const upgradeAvailable = isNewerVersion(eveLatest, agent.eveVersion);
  const linked = ready ? ready.linked : null;
  const prodHost = (() => {
    if (!prod?.url) {
      return null;
    }
    try {
      return new URL(prod.url).host;
    } catch {
      return prod.url;
    }
  })();

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {/* Agent header */}
      <header className="titlebar-drag flex items-center gap-4 border-b border-border px-6 pb-3.5 pt-3.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <h1 className="truncate text-[17px] font-semibold tracking-tight text-text">
              {agent.name}
            </h1>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-[3px] font-spacemono text-[10px] uppercase leading-none tracking-wider text-muted">
              <StatusDot status={status} />
              {status}
            </span>
          </div>
          <div className="no-drag mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 font-spacemono text-[11px] tracking-wide text-faint">
            <span className="inline-flex items-center gap-1.5">
              <span className="text-muted">eve {agent.eveVersion ?? "?"}</span>
              {upgradeAvailable && eveLatest ? (
                <button
                  type="button"
                  onClick={() => setUpgradeOpen(true)}
                  title={`eve ${eveLatest} is available. Click to upgrade this agent`}
                  className="rounded-full bg-accent/10 px-2 py-[2px] text-[10px] text-accent transition-colors hover:bg-accent/20"
                >
                  ↑ {eveLatest} available
                </button>
              ) : null}
              {structure && structure.diagnostics.errors > 0 ? (
                <button
                  type="button"
                  onClick={() => setSection("capabilities")}
                  title="eve info reports discovery errors. The agent will not compile until they are fixed. Open Capabilities for details."
                  className="rounded-full bg-danger/10 px-2 py-[2px] text-[10px] text-danger transition-colors hover:bg-danger/20"
                >
                  {structure.diagnostics.errors} build{" "}
                  {structure.diagnostics.errors === 1 ? "error" : "errors"}
                </button>
              ) : null}
            </span>
            <span className="text-border-strong">|</span>
            <span
              className="inline-flex min-w-0 items-center gap-1.5"
              title={prod?.url ?? undefined}
            >
              <span>Vercel</span>
              <span className="text-border-strong">·</span>
              {linked === false ? (
                <span className="text-warn">not linked</span>
              ) : (
                <>
                  <span className={linked ? "text-muted" : undefined}>
                    {linked ? "linked" : "…"}
                  </span>
                  <span className="text-border-strong">·</span>
                  {prodHost ? (
                    <span className="inline-flex min-w-0 items-center gap-1 text-success/80">
                      deployed{prod?.age ? ` ${prod.age} ago` : ""}
                      <span className="max-w-[220px] truncate text-faint">
                        {prodHost}
                      </span>
                    </span>
                  ) : (
                    <span>not deployed</span>
                  )}
                </>
              )}
            </span>
            <span className="text-border-strong">|</span>
            <span>
              local
              <span className="text-border-strong"> · </span>
              {status === "running" && rt?.port
                ? `:${rt.port}`
                : status === "starting"
                  ? "starting…"
                  : status === "error"
                    ? "error"
                    : "stopped"}
            </span>
          </div>
        </div>
        <div className="flex-1" />
        <div className="no-drag flex items-center gap-2">
          {rt?.url && status === "running" ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => window.open(`${rt.url}/eve/v1/info`, "_blank")}
              title="Open dev server"
            >
              <IconExternal className="h-3.5 w-3.5" />
            </Button>
          ) : null}
          {status === "running" ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => stopAgent(agent.id)}
            >
              <IconStop className="h-3.5 w-3.5" />
              Stop
            </Button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              disabled={busy}
              onClick={() => startAgent(agent.id)}
            >
              <IconPlay className="h-3.5 w-3.5" />
              {busy ? "Starting…" : "Start"}
            </Button>
          )}
          {linked === false ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => openDeploy("environment")}
              title="This project isn't linked to Vercel yet. Link it first"
            >
              <IconPlug className="h-3.5 w-3.5" />
              Link &amp; deploy
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => openDeploy("deploy")}
            >
              <IconRocket className="h-3.5 w-3.5" />
              Deploy
            </Button>
          )}
        </div>
      </header>
      {upgradeOpen && eveLatest ? (
        <EveUpgradeModal
          agentId={agent.id}
          agentName={agent.name}
          installed={agent.eveVersion}
          latest={eveLatest}
          onClose={() => setUpgradeOpen(false)}
        />
      ) : null}

      {/* Tabs */}
      <div className="border-b border-border px-5">
        <Tabs
          items={tabs}
          active={section}
          onChange={(id) => setSection(id as Section)}
        />
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {section === "chat" ? (
          <Chat />
        ) : section === "instructions" ? (
          <InstructionsGroup />
        ) : section === "capabilities" ? (
          <CapabilitiesGroup />
        ) : section === "integrations" ? (
          <IntegrationsGroup />
        ) : section === "schedules" ? (
          <Schedules />
        ) : section === "memory" ? (
          <Memory />
        ) : section === "deploy" ? (
          <DeployGroup />
        ) : section === "evals" ? (
          <Evals />
        ) : null}
      </div>
    </div>
  );
}

function ArchivedModal({
  agentId,
  onClose,
}: {
  agentId: string;
  onClose: () => void;
}): JSX.Element {
  const threads = useStore((s) => s.threads[agentId] ?? []);
  const archiveThread = useStore((s) => s.archiveThread);
  const deleteThread = useStore((s) => s.deleteThread);
  const selectThread = useStore((s) => s.selectThread);
  const setSection = useStore((s) => s.setSection);
  const archived = threads.filter((t) => t.archived);

  return (
    <Modal title="Archived sessions" onClose={onClose} width="max-w-lg">
      <div className="max-h-[60vh] overflow-auto px-2 pb-3">
        {archived.length === 0 ? (
          <div className="px-4 py-12 text-center text-[13px] text-muted">
            No archived sessions.
          </div>
        ) : (
          <div className="divide-y divide-border/70">
            {archived.map((t) => (
              <div
                key={t.id}
                className="group flex items-center gap-3 px-3 py-2.5"
              >
                <IconInbox className="h-4 w-4 shrink-0 text-faint" />
                <span className="min-w-0 flex-1 truncate text-[13px] text-text">
                  {t.title}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    void archiveThread(t.id, false).then(() =>
                      selectThread(t.id),
                    );
                    setSection("chat");
                    onClose();
                  }}
                  className="rounded-md px-2 py-1 text-xs text-muted transition-colors hover:bg-black/[0.05] hover:text-text"
                >
                  Reopen
                </button>
                <button
                  type="button"
                  title="Delete permanently"
                  onClick={() => void deleteThread(t.id)}
                  className="rounded-md p-1 text-faint transition-colors hover:bg-danger/10 hover:text-danger"
                >
                  <IconTrash className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

export function App(): JSX.Element {
  const section = useStore((s) => s.section);
  const setSection = useStore((s) => s.setSection);
  const agents = useStore((s) => s.agents);
  const runtime = useStore((s) => s.runtime);
  const activeAgentId = useStore((s) => s.activeAgentId);
  const setActiveAgent = useStore((s) => s.setActiveAgent);
  const addAgent = useStore((s) => s.addAgent);
  const init = useStore((s) => s.init);
  const threads = useStore((s) => s.threads);
  const activeThreadId = useStore((s) => s.activeThreadId);
  const statusMap = useStore((s) => s.status);
  const newThread = useStore((s) => s.newThread);
  const selectThread = useStore((s) => s.selectThread);
  const archiveThread = useStore((s) => s.archiveThread);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [archivedFor, setArchivedFor] = useState<string | null>(null);

  useEffect(() => {
    void init();
    window.studio
      .getAppInfo()
      .then(setInfo)
      .catch(() => setInfo(null));
  }, [init]);

  const createModal = createOpen ? (
    <CreateAgent onClose={() => setCreateOpen(false)} />
  ) : null;

  if (agents.length === 0) {
    return (
      <>
        <Welcome
          onAdd={addAgent}
          onCreate={() => setCreateOpen(true)}
          info={info}
        />
        {createModal}
      </>
    );
  }

  const inSettings = section === "settings";

  return (
    <div className="flex h-full bg-bg text-text">
      {/* Rail: agents */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-subtle">
        <div className="titlebar-drag h-11 shrink-0" />
        <div className="no-drag flex items-center justify-between px-3.5 pb-2.5">
          <div className="flex items-center gap-2 text-text">
            <EveLogo className="h-6 w-auto" />
            <span className="font-spacemono text-[12px] font-normal uppercase tracking-widest text-muted">
              Studio
            </span>
          </div>
        </div>

        <div className="no-drag flex gap-1.5 px-2.5 pb-2">
          <Button
            variant="secondary"
            size="sm"
            className="flex-1"
            onClick={addAgent}
          >
            <IconFolder className="h-3.5 w-3.5" />
            Add existing
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setCreateOpen(true)}
            title="Create a new agent"
          >
            <IconPlus className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="mb-1.5 px-3 font-spacemono text-2xs uppercase tracking-widest text-faint">
          Agents
        </div>
        <nav className="no-drag flex-1 overflow-auto pb-2">
          {agents.map((a) => {
            const st = runtime[a.id]?.status ?? "stopped";
            const expanded = a.id === activeAgentId;
            const on = expanded && !inSettings;
            const agentThreads = threads[a.id] ?? [];
            const activeThreads = agentThreads.filter((t) => !t.archived);
            const archivedCount = agentThreads.length - activeThreads.length;
            return (
              <div key={a.id} className="pb-0.5">
                <button
                  type="button"
                  onClick={() => {
                    if (inSettings) {
                      setSection("chat");
                    }
                    void setActiveAgent(a.id);
                  }}
                  className={`flex w-full items-center gap-2.5 px-4 py-2 text-left transition-colors ${
                    on ? "bg-black/[0.03]" : "hover:bg-black/[0.02]"
                  }`}
                >
                  <StatusDot status={st} />
                  <div className="min-w-0 flex-1">
                    <div
                      className={`truncate text-[13px] ${expanded ? "font-semibold text-text" : "text-muted"}`}
                    >
                      {a.name}
                    </div>
                  </div>
                  {runtime[a.id]?.port ? (
                    <span className="font-mono text-2xs text-faint">
                      :{runtime[a.id]?.port}
                    </span>
                  ) : null}
                </button>

                {expanded ? (
                  <div className="relative ml-[26px] mt-0.5 pl-3">
                    <span className="absolute inset-y-1 left-0 w-px bg-border" />
                    {activeThreads.map((t) => {
                      const ts = statusMap[t.id];
                      const activeT =
                        t.id === activeThreadId && section === "chat";
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => {
                            void selectThread(t.id);
                            setSection("chat");
                          }}
                          className={`group flex w-full items-center gap-2.5 py-[7px] pr-2 text-left text-[13px] transition-colors ${
                            activeT ? "text-text" : "text-muted hover:text-text"
                          }`}
                        >
                          <span
                            className={`h-1.5 w-1.5 shrink-0 rounded-full transition-colors ${
                              ts === "streaming"
                                ? "animate-pulse bg-accent"
                                : ts === "error"
                                  ? "bg-danger"
                                  : activeT
                                    ? "bg-text"
                                    : "bg-border-strong"
                            }`}
                          />
                          <span className="flex-1 truncate">{t.title}</span>
                          <span
                            role="button"
                            title="Archive"
                            onClick={(e) => {
                              e.stopPropagation();
                              void archiveThread(t.id, true);
                            }}
                            className="hidden shrink-0 text-faint hover:text-text group-hover:inline"
                          >
                            <IconArchive className="h-3.5 w-3.5" />
                          </span>
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => {
                        void newThread(a.id);
                        setSection("chat");
                      }}
                      className="flex w-full items-center gap-2.5 py-[7px] pr-2 text-left text-[13px] text-faint transition-colors hover:text-muted"
                    >
                      <IconPlus className="h-3.5 w-3.5 shrink-0" />
                      New chat
                    </button>
                    {archivedCount > 0 ? (
                      <button
                        type="button"
                        onClick={() => setArchivedFor(a.id)}
                        className="flex w-full items-center gap-2.5 py-[7px] pr-2 text-left font-spacemono text-[10px] uppercase tracking-[0.12em] text-faint transition-colors hover:text-muted"
                      >
                        <IconArchive className="h-3 w-3 shrink-0" />
                        Archived · {archivedCount}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </nav>

        <div className="no-drag border-t border-border p-2">
          <UpdateBadge />
          <button
            type="button"
            onClick={() => setSection("settings")}
            className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors ${
              inSettings
                ? "bg-black/[0.05] text-text"
                : "text-muted hover:bg-black/[0.03]"
            }`}
          >
            <IconSettings className="h-4 w-4" />
            Settings
          </button>
        </div>
      </aside>

      {/* Main */}
      {inSettings ? (
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="titlebar-drag h-11 shrink-0 border-b border-border" />
          <Settings info={info} />
        </div>
      ) : activeAgentId ? (
        <AgentWorkspace />
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-muted">
          <div className="flex flex-col items-center gap-2">
            <IconBot className="h-6 w-6 opacity-50" />
            Select an agent
          </div>
        </div>
      )}

      {createModal}
      {archivedFor ? (
        <ArchivedModal
          agentId={archivedFor}
          onClose={() => setArchivedFor(null)}
        />
      ) : null}
    </div>
  );
}
