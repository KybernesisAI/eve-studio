import { electronAPI } from "@electron-toolkit/preload";
import { type IpcRendererEvent, contextBridge, ipcRenderer } from "electron";
import {
  type AddAgentResult,
  type AgentRecord,
  type AgentRuntimeState,
  type AgentStructure,
  type AppInfo,
  type ArcanaResult,
  type ArcanaStats,
  type ChatEventMessage,
  type ChatStatusMessage,
  type ChannelAddInput,
  type ChannelItem,
  type ChannelWiring,
  type ChannelWriteResult,
  type ChatTarget,
  type CliChunk,
  type CliExit,
  type CmdResult,
  type ConnectionInput,
  type ConnectorItem,
  type ConnectorUsage,
  type CreateAgentInput,
  type DeployHealth,
  type DeploySettings,
  type DetectedBrain,
  type CapabilityFilesResult,
  type CapabilityKind,
  type EnvState,
  type EvalItem,
  type EveEvent,
  type EveUpgradeResult,
  type FileWriteResult,
  IPC,
  type InstructionsFile,
  type LogChunk,
  type ModelConfig,
  type GatewayModelsResult,
  type ModelReadiness,
  type ProdInfo,
  type QueryHit,
  type RegistryAddResult,
  type SandboxInfo,
  type ScheduleInput,
  type SkillInput,
  type DiscordCredInput,
  type DiscordEndpointResult,
  type DiscordStatus,
  type DiscordVerifyResult,
  type SubagentInput,
  type TeamsCredInput,
  type TeamsStatus,
  type TeamsVerifyResult,
  type TelegramCredInput,
  type TwilioCredInput,
  type TwilioNumbersResult,
  type TwilioStatus,
  type TwilioVerifyResult,
  type TwilioWebhookResult,
  type TelegramStatus,
  type TelegramVerifyResult,
  type TelegramWebhookResult,
  type ThreadRecord,
  type TimelineEvent,
  type ToolInput,
  type UpdateState,
  type VercelStatus,
  type VercelTeamsResult,
  type VercelWhoami,
  type WireBrainInput,
  type WireBrainResult,
  type ConnectorsAttached,
  type MemorySlotsResult,
  type MigrateBrainResult,
  type RegistryAddChunk,
  type RegistryInstallOptions,
  type RegistryInstallResult,
  type RegistryListResult,
  type SelfModStatus,
} from "../shared/ipc";

type WriteResult = { ok: boolean; error?: string };
/** Outcome of a session control route (cancel / compact / clear / reset). */
type ControlResult = { ok: boolean; status: string; error?: string };

function sub<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T): void => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

const api = {
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke(IPC.appInfo),

  agents: {
    list: (): Promise<AgentRecord[]> => ipcRenderer.invoke(IPC.agentsList),
    add: (): Promise<AddAgentResult> => ipcRenderer.invoke(IPC.agentsAdd),
    remove: (id: string): Promise<AgentRecord[]> =>
      ipcRenderer.invoke(IPC.agentsRemove, id),
    start: (id: string): Promise<AgentRuntimeState> =>
      ipcRenderer.invoke(IPC.agentStart, id),
    stop: (id: string): Promise<AgentRuntimeState> =>
      ipcRenderer.invoke(IPC.agentStop, id),
    restart: (id: string): Promise<AgentRuntimeState> =>
      ipcRenderer.invoke(IPC.agentRestart, id),
    status: (id: string): Promise<AgentRuntimeState> =>
      ipcRenderer.invoke(IPC.agentStatus, id),
    info: (id: string): Promise<unknown> =>
      ipcRenderer.invoke(IPC.agentInfo, id),
    /** Structure from the compiled manifest; `refresh` forces `eve info --json`. */
    structure: (id: string, refresh?: boolean): Promise<AgentStructure> =>
      ipcRenderer.invoke(IPC.agentStructure, id, refresh),
    readInstructions: (id: string): Promise<InstructionsFile> =>
      ipcRenderer.invoke(IPC.agentReadInstructions, id),
    writeInstructions: (id: string, content: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC.agentWriteInstructions, id, content),
    logs: (id: string): Promise<string> =>
      ipcRenderer.invoke(IPC.agentLogs, id),
    create: (input: CreateAgentInput): Promise<string> =>
      ipcRenderer.invoke(IPC.agentCreate, input),
    register: (dir: string): Promise<AddAgentResult> =>
      ipcRenderer.invoke(IPC.agentRegister, dir),
    /** `eve@latest` from the npm registry (cached ~1h; null when offline). */
    eveLatest: (force?: boolean): Promise<string | null> =>
      ipcRenderer.invoke(IPC.eveLatest, force),
    /** Install eve@latest (+ @kybernesis/arcana@latest) and re-run eve info; streams to cli.onChunk under `runId`. */
    upgradeEve: (id: string, runId: string): Promise<EveUpgradeResult> =>
      ipcRenderer.invoke(IPC.eveUpgrade, id, runId),
    createSkill: (id: string, input: SkillInput): Promise<FileWriteResult> =>
      ipcRenderer.invoke(IPC.skillCreate, id, input),
    addConnection: (
      id: string,
      input: ConnectionInput,
    ): Promise<FileWriteResult> =>
      ipcRenderer.invoke(IPC.connectionAdd, id, input),
    readConnection: (
      id: string,
      name: string,
    ): Promise<{ relPath: string; content: string; exists: boolean }> =>
      ipcRenderer.invoke(IPC.connectionRead, id, name),
    writeConnection: (
      id: string,
      name: string,
      content: string,
    ): Promise<WriteResult> =>
      ipcRenderer.invoke(IPC.connectionWrite, id, name, content),
    deleteConnection: (id: string, name: string): Promise<WriteResult> =>
      ipcRenderer.invoke(IPC.connectionDelete, id, name),
    connectorUsage: (id: string, uids: string[]): Promise<ConnectorUsage[]> =>
      ipcRenderer.invoke(IPC.connectorUsage, id, uids),
    getDeploy: (id: string): Promise<DeploySettings> =>
      ipcRenderer.invoke(IPC.deployGet, id),
    setDeploy: (
      id: string,
      settings: DeploySettings,
    ): Promise<DeploySettings> =>
      ipcRenderer.invoke(IPC.deploySet, id, settings),
    deployHealth: (id: string): Promise<DeployHealth> =>
      ipcRenderer.invoke(IPC.deployHealth, id),
    modelRead: (id: string): Promise<ModelConfig> =>
      ipcRenderer.invoke(IPC.modelRead, id),
    modelWrite: (
      id: string,
      model: string,
      reasoning: string | null,
    ): Promise<WriteResult> =>
      ipcRenderer.invoke(IPC.modelWrite, id, model, reasoning),
    envRead: (id: string): Promise<EnvState> =>
      ipcRenderer.invoke(IPC.envRead, id),
    envWrite: (
      id: string,
      name: string,
      content: string,
    ): Promise<WriteResult> =>
      ipcRenderer.invoke(IPC.envWrite, id, name, content),
    createTool: (id: string, input: ToolInput): Promise<FileWriteResult> =>
      ipcRenderer.invoke(IPC.toolCreate, id, input),
    createSubagent: (
      id: string,
      input: SubagentInput,
    ): Promise<FileWriteResult> =>
      ipcRenderer.invoke(IPC.subagentCreate, id, input),
    createHook: (id: string, name: string): Promise<FileWriteResult> =>
      ipcRenderer.invoke(IPC.hookCreate, id, name),
    createSchedule: (
      id: string,
      input: ScheduleInput,
    ): Promise<FileWriteResult> =>
      ipcRenderer.invoke(IPC.scheduleCreate, id, input),
    runSchedule: (id: string, name: string): Promise<CmdResult> =>
      ipcRenderer.invoke(IPC.scheduleRun, id, name),
    capabilityFiles: (
      id: string,
      kind: CapabilityKind,
      name: string,
    ): Promise<CapabilityFilesResult> =>
      ipcRenderer.invoke(IPC.capabilityFiles, id, kind, name),
    capabilityWrite: (
      id: string,
      relPath: string,
      content: string,
    ): Promise<FileWriteResult> =>
      ipcRenderer.invoke(IPC.capabilityWrite, id, relPath, content),
    capabilityDelete: (
      id: string,
      kind: CapabilityKind,
      name: string,
    ): Promise<FileWriteResult> =>
      ipcRenderer.invoke(IPC.capabilityDelete, id, kind, name),
    sandboxRead: (id: string): Promise<SandboxInfo> =>
      ipcRenderer.invoke(IPC.sandboxRead, id),
    sandboxCreate: (id: string): Promise<FileWriteResult> =>
      ipcRenderer.invoke(IPC.sandboxCreate, id),
    channelsList: (id: string): Promise<ChannelItem[]> =>
      ipcRenderer.invoke(IPC.channelsList, id),
    /** Install Web Chat via `eve add channel/web --non-interactive --yes`. */
    channelAdd: (id: string): Promise<RegistryAddResult> =>
      ipcRenderer.invoke(IPC.channelAdd, id),
    channelWrite: (
      id: string,
      input: ChannelAddInput,
    ): Promise<ChannelWriteResult> =>
      ipcRenderer.invoke(IPC.channelWrite, id, input),
    channelDelete: (
      id: string,
      name: string,
    ): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.channelDelete, id, name),
    channelWiring: (id: string): Promise<ChannelWiring[]> =>
      ipcRenderer.invoke(IPC.channelWiring, id),
    onStatusChanged: (cb: (s: AgentRuntimeState) => void): (() => void) =>
      sub(IPC.agentStatusChanged, cb),
    onLog: (cb: (m: LogChunk) => void): (() => void) => sub(IPC.agentLog, cb),
  },

  vercel: {
    status: (id: string): Promise<VercelStatus> =>
      ipcRenderer.invoke(IPC.vercelStatus, id),
    envLs: (id: string): Promise<CmdResult> =>
      ipcRenderer.invoke(IPC.vercelEnvLs, id),
    envPull: (id: string): Promise<CmdResult> =>
      ipcRenderer.invoke(IPC.vercelEnvPull, id),
    envAdd: (
      id: string,
      name: string,
      value: string,
      target: string,
    ): Promise<CmdResult> =>
      ipcRenderer.invoke(IPC.vercelEnvAdd, id, name, value, target),
    envSetAll: (id: string, name: string, value: string): Promise<CmdResult> =>
      ipcRenderer.invoke(IPC.vercelEnvSetAll, id, name, value),
    prodInfo: (id: string): Promise<ProdInfo> =>
      ipcRenderer.invoke(IPC.vercelProdInfo, id),
    prodAlias: (
      id: string,
    ): Promise<{ ok: boolean; url?: string; error?: string }> =>
      ipcRenderer.invoke(IPC.vercelProdAlias, id),
    modelReadiness: (id: string): Promise<ModelReadiness> =>
      ipcRenderer.invoke(IPC.modelReadiness, id),
    gatewayModels: (id: string): Promise<GatewayModelsResult> =>
      ipcRenderer.invoke(IPC.gatewayModels, id),
    link: (id: string, team?: string): Promise<CmdResult> =>
      ipcRenderer.invoke(IPC.vercelLink, id, team),
    teams: (id: string): Promise<VercelTeamsResult> =>
      ipcRenderer.invoke(IPC.vercelTeams, id),
    whoami: (id: string): Promise<VercelWhoami> =>
      ipcRenderer.invoke(IPC.vercelWhoami, id),
    loginStart: (id: string): Promise<string> =>
      ipcRenderer.invoke(IPC.vercelLogin, id),
    connectorList: (
      id: string,
      service?: string,
    ): Promise<{ ok: boolean; connectors: ConnectorItem[]; output?: string }> =>
      ipcRenderer.invoke(IPC.connectorList, id, service),
    connectorCreate: (
      id: string,
      type: string,
      name: string,
      triggers: boolean,
    ): Promise<CmdResult> =>
      ipcRenderer.invoke(IPC.connectorCreate, id, type, name, triggers),
    /** Create a connector, streaming output so the authorize link shows live. */
    connectorCreateStream: (
      id: string,
      type: string,
      name: string,
      triggers: boolean,
    ): Promise<CmdResult> =>
      ipcRenderer.invoke(
        IPC.vercelConnectorCreateStream,
        id,
        type,
        name,
        triggers,
      ),
    onConnectorCreateChunk: (
      cb: (c: { id: string; data: string }) => void,
    ): (() => void) => sub(IPC.vercelConnectorCreateChunk, cb),
    connectorAttach: (
      id: string,
      connector: string,
      kind?: string,
    ): Promise<CmdResult> =>
      ipcRenderer.invoke(IPC.connectorAttach, id, connector, kind),
    openConnect: (id: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.connectOpen, id),
    openConnectExternal: (
      id: string,
    ): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.connectOpenExternal, id),
    openConnectorPage: (
      id: string,
      connector: string,
    ): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.connectorOpenPage, id, connector),
  },

  buzz: {
    /** Generate (or reuse) the agent's Buzz identity keypair. */
    genKey: (id: string, relayUrl: string): Promise<import("@shared/ipc").BuzzKeyResult> =>
      ipcRenderer.invoke(IPC.buzzGenKey, id, relayUrl),
    /** Probe the relay: is the identity an admitted member? */
    verify: (id: string): Promise<import("@shared/ipc").BuzzVerifyResult> =>
      ipcRenderer.invoke(IPC.buzzVerify, id),
    /** Push the agent's profile (kind:0) with optional avatar upload. */
    setProfile: (
      id: string,
      input: {
        name: string;
        about?: string;
        avatarPath?: string;
        avatarData?: string;
        avatarMime?: string;
        currentPicture?: string;
      },
    ): Promise<import("@shared/ipc").BuzzProfileResult> =>
      ipcRenderer.invoke(IPC.buzzSetProfile, id, input),
    /** Write env vars + channel file + agent dep (nostr-tools) in one shot. */
    wire: (id: string): Promise<{ ok: boolean; output: string }> =>
      ipcRenderer.invoke(IPC.buzzWire, id),
    /** Current relay-side profile (kind:0) for edit prefill. */
    getProfile: (
      id: string,
    ): Promise<{ ok: boolean; name?: string; about?: string; picture?: string; error?: string }> =>
      ipcRenderer.invoke(IPC.buzzGetProfile, id),
    /** Persist wiring (target URL, bypass secret auto-filled main-side). */
    save: (
      id: string,
      patch: Partial<import("@shared/ipc").BuzzCredInput>,
    ): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.buzzSave, id, patch),
    /** Live status for the Channels badge + bridge controls. */
    status: (id: string): Promise<import("@shared/ipc").BuzzStatus> =>
      ipcRenderer.invoke(IPC.buzzStatus, id),
    bridgeStart: (id: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.buzzBridgeStart, id),
    bridgeStop: (id: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(IPC.buzzBridgeStop, id),
    bridgeInstall: (id: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.buzzBridgeInstall, id),
    bridgeUninstall: (id: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(IPC.buzzBridgeUninstall, id),
  },

  telegram: {
    /** Validate a BotFather token (getMe) → bot @username + name. */
    verify: (token: string): Promise<TelegramVerifyResult> =>
      ipcRenderer.invoke(IPC.telegramVerify, token),
    /** Register the webhook at `url` with `secret`, then read it back. */
    setWebhook: (
      token: string,
      url: string,
      secret: string,
    ): Promise<TelegramWebhookResult> =>
      ipcRenderer.invoke(IPC.telegramSetWebhook, token, url, secret),
    /** Re-read the current webhook state (getWebhookInfo). */
    webhookInfo: (token: string): Promise<TelegramWebhookResult> =>
      ipcRenderer.invoke(IPC.telegramWebhookInfo, token),
    /** Persist the bot creds so the badge + repair survive without re-pasting. */
    save: (id: string, cred: TelegramCredInput): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(IPC.telegramSave, id, cred),
    /** Live connection status for the Channels badge. */
    status: (id: string): Promise<TelegramStatus> =>
      ipcRenderer.invoke(IPC.telegramStatus, id),
    /** Register the webhook using the saved bot token + secret (survives redeploys). */
    registerWebhook: (
      id: string,
      url: string,
    ): Promise<TelegramWebhookResult> =>
      ipcRenderer.invoke(IPC.telegramRegisterWebhook, id, url),
  },

  discord: {
    /** Validate a bot token → application id + public key + name. */
    verify: (token: string): Promise<DiscordVerifyResult> =>
      ipcRenderer.invoke(IPC.discordVerify, token),
    /** Persist the derived creds so the badge + repair survive redeploys. */
    save: (id: string, cred: DiscordCredInput): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(IPC.discordSave, id, cred),
    /** Live connection status for the Channels badge. */
    status: (id: string): Promise<DiscordStatus> =>
      ipcRenderer.invoke(IPC.discordStatus, id),
    /** Register the default /ask slash command (uses saved creds). */
    registerCommands: (id: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.discordRegisterCommands, id),
    /** Set + verify the interactions endpoint at the deployed agent. */
    setEndpoint: (id: string, url: string): Promise<DiscordEndpointResult> =>
      ipcRenderer.invoke(IPC.discordSetEndpoint, id, url),
  },

  twilio: {
    /** Validate Account SID + Auth Token. */
    verify: (sid: string, token: string): Promise<TwilioVerifyResult> =>
      ipcRenderer.invoke(IPC.twilioVerify, sid, token),
    /** List the account's phone numbers. */
    numbers: (sid: string, token: string): Promise<TwilioNumbersResult> =>
      ipcRenderer.invoke(IPC.twilioNumbers, sid, token),
    /** Persist the creds + chosen number. */
    save: (id: string, cred: TwilioCredInput): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(IPC.twilioSave, id, cred),
    /** Point the saved number's SMS + Voice webhooks at the deployment base. */
    setWebhooks: (id: string, base: string): Promise<TwilioWebhookResult> =>
      ipcRenderer.invoke(IPC.twilioSetWebhooks, id, base),
    /** Live connection status for the Channels badge. */
    status: (id: string): Promise<TwilioStatus> =>
      ipcRenderer.invoke(IPC.twilioStatus, id),
  },

  teams: {
    /** Validate the App ID + client secret (and optional tenant). */
    verify: (
      appId: string,
      password: string,
      tenantId?: string,
    ): Promise<TeamsVerifyResult> =>
      ipcRenderer.invoke(IPC.teamsVerify, appId, password, tenantId),
    /** Persist the Azure Bot creds. */
    save: (id: string, cred: TeamsCredInput): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(IPC.teamsSave, id, cred),
    /** Live status for the Channels badge (credential validity). */
    status: (id: string): Promise<TeamsStatus> =>
      ipcRenderer.invoke(IPC.teamsStatus, id),
  },

  dialog: {
    pickDir: (): Promise<string | null> =>
      ipcRenderer.invoke(IPC.dialogPickDir),
  },

  cli: {
    run: (
      id: string,
      kind: "build" | "deploy" | "evalRun",
      extra?: { ids?: string[] },
    ): Promise<string> => ipcRenderer.invoke(IPC.cliRun, id, kind, extra),
    cancel: (runId: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC.cliCancel, runId),
    onChunk: (cb: (c: CliChunk) => void): (() => void) => sub(IPC.cliChunk, cb),
    onExit: (cb: (c: CliExit) => void): (() => void) => sub(IPC.cliExit, cb),
  },

  evals: {
    list: (id: string): Promise<EvalItem[]> =>
      ipcRenderer.invoke(IPC.evalList, id),
  },

  arcana: {
    detect: (id: string): Promise<DetectedBrain> =>
      ipcRenderer.invoke(IPC.arcanaDetect, id),
    validate: (
      workspace: string,
      key: string,
    ): Promise<ArcanaResult<ArcanaStats>> =>
      ipcRenderer.invoke(IPC.arcanaValidate, workspace, key),
    stats: (id: string): Promise<ArcanaResult<ArcanaStats>> =>
      ipcRenderer.invoke(IPC.arcanaStats, id),
    timeline: (
      id: string,
      limit?: number,
    ): Promise<ArcanaResult<TimelineEvent[]>> =>
      ipcRenderer.invoke(IPC.arcanaTimeline, id, limit),
    query: (id: string, q: string): Promise<ArcanaResult<QueryHit[]>> =>
      ipcRenderer.invoke(IPC.arcanaQuery, id, q),
    /** Wire the official extension; `runId` streams the install to registry.onChunk. */
    wire: (
      id: string,
      input: WireBrainInput,
      runId?: string,
    ): Promise<WireBrainResult> =>
      ipcRenderer.invoke(IPC.arcanaWire, id, input, runId),
    /** Move a legacy connections/arcana.ts agent onto the extension. */
    migrate: (id: string, runId?: string): Promise<MigrateBrainResult> =>
      ipcRenderer.invoke(IPC.arcanaMigrate, id, runId),
  },

  chat: {
    listThreads: (agentId: string): Promise<ThreadRecord[]> =>
      ipcRenderer.invoke(IPC.chatListThreads, agentId),
    createThread: (agentId: string, title?: string): Promise<ThreadRecord> =>
      ipcRenderer.invoke(IPC.chatCreateThread, agentId, title),
    getThread: (threadId: string): Promise<EveEvent[]> =>
      ipcRenderer.invoke(IPC.chatGetThread, threadId),
    deleteThread: (threadId: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC.chatDeleteThread, threadId),
    archiveThread: (threadId: string, archived: boolean): Promise<boolean> =>
      ipcRenderer.invoke(IPC.chatArchiveThread, threadId, archived),
    send: (
      threadId: string,
      text: string,
      target: ChatTarget = "local",
    ): Promise<boolean> =>
      ipcRenderer.invoke(IPC.chatSend, threadId, text, target),
    respond: (
      threadId: string,
      requestId: string,
      optionId?: string,
      text?: string,
      target: ChatTarget = "local",
    ): Promise<boolean> =>
      ipcRenderer.invoke(
        IPC.chatRespond,
        threadId,
        requestId,
        optionId,
        text,
        target,
      ),
    /** POST /cancel for the thread's session (scoped to the last observed turn). */
    cancel: (
      threadId: string,
      target: ChatTarget = "local",
      turnId?: string,
    ): Promise<ControlResult> =>
      ipcRenderer.invoke(IPC.chatCancel, threadId, target, turnId),
    /** POST /compact — summarize context in place. */
    compact: (
      threadId: string,
      target: ChatTarget = "local",
    ): Promise<ControlResult> =>
      ipcRenderer.invoke(IPC.chatCompact, threadId, target),
    /** POST /clear — drop model-message history, keep the session. */
    clear: (
      threadId: string,
      target: ChatTarget = "local",
    ): Promise<ControlResult> =>
      ipcRenderer.invoke(IPC.chatClear, threadId, target),
    /** POST /reset — retire the session; the thread's next message starts fresh. */
    reset: (
      threadId: string,
      target: ChatTarget = "local",
    ): Promise<ControlResult> =>
      ipcRenderer.invoke(IPC.chatReset, threadId, target),
    onEvent: (cb: (m: ChatEventMessage) => void): (() => void) =>
      sub(IPC.chatEvent, cb),
    onStatus: (cb: (m: ChatStatusMessage) => void): (() => void) =>
      sub(IPC.chatStatus, cb),
  },

  updates: {
    getState: (): Promise<UpdateState> =>
      ipcRenderer.invoke(IPC.updaterGetState),
    check: (): Promise<WriteResult> => ipcRenderer.invoke(IPC.updaterCheck),
    download: (): Promise<WriteResult> =>
      ipcRenderer.invoke(IPC.updaterDownload),
    install: (): Promise<void> => ipcRenderer.invoke(IPC.updaterInstall),
    onState: (cb: (s: UpdateState) => void): (() => void) =>
      sub(IPC.updaterState, cb),
  },

  // ---- Registry & memory (eve 0.49) ----
  registry: {
    /** `eve registry list --json` (cached ~10 min per agent). */
    list: (id: string, force?: boolean): Promise<RegistryListResult> =>
      ipcRenderer.invoke(IPC.registryList, id, force),
    /** `eve registry view <item>` — plain text. */
    view: (id: string, item: string): Promise<string> =>
      ipcRenderer.invoke(IPC.registryView, id, item),
    /** `eve add <item> --non-interactive --yes`; output streams to onChunk under `runId`. */
    add: (
      id: string,
      item: string,
      runId: string,
      opts?: RegistryInstallOptions,
    ): Promise<RegistryInstallResult> =>
      ipcRenderer.invoke(IPC.registryAdd, id, item, runId, opts),
    onChunk: (cb: (c: RegistryAddChunk) => void): (() => void) =>
      sub(IPC.registryAddChunk, cb),
    selfModStatus: (id: string): Promise<SelfModStatus> =>
      ipcRenderer.invoke(IPC.selfModStatus, id),
    /** `eve add experimental/self-modification` (dev-only subagent). */
    enableSelfModification: (
      id: string,
      runId: string,
    ): Promise<RegistryInstallResult> =>
      ipcRenderer.invoke(IPC.selfModEnable, id, runId),
    /** Connector UIDs attached to this agent's linked Vercel project. */
    connectorsAttached: (id: string): Promise<ConnectorsAttached> =>
      ipcRenderer.invoke(IPC.connectorsAttached, id),
    /** Read `agent/extensions/<ns>.ts`. */
    readExtensionMount: (
      id: string,
      ns: string,
    ): Promise<{ relPath: string; content: string; exists: boolean }> =>
      ipcRenderer.invoke(IPC.extensionMountRead, id, ns),
    writeExtensionMount: (
      id: string,
      ns: string,
      content: string,
    ): Promise<{ ok: boolean; relPath?: string; error?: string }> =>
      ipcRenderer.invoke(IPC.extensionMountWrite, id, ns, content),
  },

  memory: {
    slots: (id: string): Promise<MemorySlotsResult> =>
      ipcRenderer.invoke(IPC.memorySlots, id),
    /** Scaffold agent/memory/<slot>.ts with eve's built-in fileMemory(). */
    addFile: (
      id: string,
      slot?: string,
      description?: string,
    ): Promise<{ ok: boolean; relPath?: string; error?: string }> =>
      ipcRenderer.invoke(IPC.memoryAddFile, id, slot, description),
    /** `eve add memory/supermemory`; output streams to registry.onChunk. */
    addSupermemory: (id: string, runId: string): Promise<RegistryInstallResult> =>
      ipcRenderer.invoke(IPC.memoryAddSupermemory, id, runId),
  },
};

export type StudioApi = typeof api;

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("electron", electronAPI);
    contextBridge.exposeInMainWorld("studio", api);
  } catch (error) {
    // biome-ignore lint/suspicious/noConsole: preload bridge setup failure must be visible
    console.error(error);
  }
} else {
  // @ts-ignore — contextIsolation is expected on; this is the fallback
  window.electron = electronAPI;
  // @ts-ignore — see above
  window.studio = api;
}
