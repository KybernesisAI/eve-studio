/**
 * Shared IPC contract between the main process and the renderer.
 * Channel names + payload types live here so both sides stay in sync.
 */

export interface AppInfo {
  appVersion: string;
  electron: string;
  node: string;
  chrome: string;
  platform: NodeJS.Platform;
}

/** A registered agent (a folder on disk containing an Eve `agent/`). */
export interface AgentRecord {
  id: string;
  name: string;
  path: string;
  eveVersion: string | null;
  addedAt: number;
}

export type AgentRunStatus = "stopped" | "starting" | "running" | "error";

export interface AgentRuntimeState {
  agentId: string;
  status: AgentRunStatus;
  port: number | null;
  url: string | null;
  error: string | null;
}

/** In-app auto-update status, pushed from main on every transition. */
export interface UpdateState {
  status:
    "idle" | "checking" | "available" | "downloading" | "downloaded" | "error";
  /** The available/downloaded version, when known. */
  version: string | null;
  /** Download progress 0–100 while status is "downloading". */
  percent?: number;
  error?: string;
}

export interface ThreadRecord {
  id: string;
  agentId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** Archived threads are hidden from the sidebar but kept for later reopen. */
  archived?: boolean;
}

/**
 * An Eve session stream event. Permissive by design — the UI switches on `type`.
 * Shapes are documented in Eve's protocol/message module (`MessageStreamEvent`).
 *
 * @remarks
 * `meta.id` is the durable ULID eve stamps on every persisted event (stream
 * version 20+). It is stable across reconnects and rewinds, so it is the key
 * used to drop duplicates when a stream is resumed from a lagging cursor.
 */
export interface EveEvent {
  type: string;
  data?: Record<string, unknown>;
  meta?: { at?: string; id?: string };
  sequence?: number;
  turnId?: string;
  stepIndex?: number;
}

export interface ChatEventMessage {
  threadId: string;
  event: EveEvent;
}

export type ChatStatus =
  "idle" | "streaming" | "waiting" | "completed" | "failed" | "error";

export interface ChatStatusMessage {
  threadId: string;
  status: ChatStatus;
  error?: string;
}

/** Result of adding an agent (validated on the main side). */
export interface AddAgentResult {
  ok: boolean;
  agent?: AgentRecord;
  error?: string;
}

// --- structure (read from the compiled manifest, v47 / eve 0.49) ---
/**
 * Who contributed a capability: the application itself, an extension mounted
 * under `agent/extensions/<ns>.ts` (contributions are prefixed `<ns>__`), or
 * eve's own framework defaults (`sourceId` starting `eve:defaults:` /
 * `eve:root-defaults:`).
 */
export type StructureOrigin = "application" | "extension" | "framework";
export interface StructureTool {
  name: string;
  description?: string;
  /** Tool declares an approval gate (`approval: always()/once()`). */
  requiresApproval?: boolean;
  /**
   * Source is a leftover from Eve Studio's retired Evolve feature (the
   * `propose_change` tool it used to write). Safe to delete.
   */
  legacyStudio?: boolean;
  origin?: StructureOrigin;
  /** Extension namespace when `origin === "extension"`. */
  extension?: string;
}
export interface StructureConnection {
  name: string;
  protocol?: string;
  url?: string;
  description?: string;
  origin?: StructureOrigin;
  extension?: string;
}
export interface StructureNamed {
  name: string;
  description?: string;
  origin?: StructureOrigin;
  extension?: string;
}
export interface StructureChannel {
  name: string;
  method?: string;
  urlPath?: string;
  kind?: string;
  origin?: StructureOrigin;
}
export interface StructureSchedule {
  name: string;
  cron?: string;
  /** Fire-and-forget prompt (markdown form); absent for `run()` handlers. */
  markdown?: string;
  hasRun?: boolean;
}
export interface StructureHook {
  name: string;
  eventNames?: string[];
}
export interface StructureRemote {
  name: string;
  url?: string;
}
/** A memory slot authored at `agent/memory/<slot>.ts` (`defineMemory`). */
export interface StructureMemory {
  slot: string;
  description?: string;
  visibility?: string;
  logicalPath: string;
}
/** An extension mounted at `agent/extensions/<ns>.ts`. */
export interface StructureExtension {
  namespace: string;
  packageName: string;
  mountLogicalPath: string;
}
export interface AgentStructure {
  source: "compiled" | "cli" | "none";
  model: string | null;
  displayName?: string | null;
  tools: StructureTool[];
  connections: StructureConnection[];
  skills: StructureNamed[];
  channels: StructureChannel[];
  schedules: StructureSchedule[];
  subagents: StructureNamed[];
  remoteAgents: StructureRemote[];
  hooks: StructureHook[];
  memories: StructureMemory[];
  extensions: StructureExtension[];
  /**
   * `"default"` when the agent runs on eve's framework sandbox, else the
   * authored sandbox's logical path (e.g. `sandbox.ts`); `null` when unknown.
   */
  sandbox: string | null;
  diagnostics: { errors: number; warnings: number };
  error?: string;
}

// --- arcana (memory) ---
/** A brain credential as surfaced to the renderer — never includes the key. */
export interface BrainInfo {
  workspace: string;
  envVar: string;
  hasKey: boolean;
}
export interface ArcanaStats {
  workspace: string;
  timeline: {
    total_events: number;
    by_type: Record<string, number>;
    date_range?: { earliest?: string; latest?: string };
  };
  entityGraph: {
    total_entities: number;
    total_mentions: number;
    total_relations: number;
    by_type: Record<string, number>;
  };
}
export interface TimelineEvent {
  id: number | string;
  type: string;
  timestamp: string;
  title: string;
  summary?: string;
  entities?: string[];
  topics?: string[];
}
export interface QueryHit {
  id: string;
  title: string;
  content: string;
  type: string;
  timestamp: string;
  hybridScore?: number;
  matchType?: string;
}
export interface ArcanaResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}
/**
 * What Studio can infer about an agent's Arcana wiring (eve 0.49).
 *
 * @remarks
 * `extension` = the official `extension/arcana` mount (`agent/extensions/arcana.ts`,
 * `@kybernesis/arcana`); `legacy` = a hand-written `connections/arcana.ts` from
 * older Studio builds; `none` = nothing wired. The key itself never crosses IPC.
 */
export interface DetectedBrain {
  mode: "extension" | "legacy" | "none";
  workspace?: string;
  /** Env var holding the `kb_` key (`ARCANA_API_KEY` for the extension). */
  keyEnvVar: string;
  /** Every key-shaped env var the mount reads (e.g. eval + prod keys). */
  keyEnvVars?: string[];
  /** Env var holding the workspace slug (`ARCANA_WORKSPACE`); unset for legacy. */
  workspaceEnvVar?: string;
  /** Where `workspace` came from: the env var, or the mount's literal default. */
  workspaceSource?: "env" | "default";
  /** The literal after `??` in the mount, when present. */
  workspaceDefault?: string;
  hasKey: boolean;
  /** `agent/extensions/arcana.ts` when mounted. */
  mountFile?: string;
  /** `agent/connections/arcana.ts` when a legacy connection exists. */
  legacyFile?: string;
  hasLegacyFile: boolean;
  /** `@kybernesis/arcana` is present in node_modules. */
  packageInstalled: boolean;
  /** The compiled manifest agrees with what's on disk (false ⇒ restart/`eve info` pending). */
  inManifest: boolean;
  /** Subagent ids with their own `extensions/arcana.ts` mount. */
  subagentMounts: string[];
}
export interface WireBrainInput {
  workspace: string;
  key: string;
  /** Skip the read-only key check (used when re-wiring a validated credential). */
  skipValidate?: boolean;
}
export interface WireBrainResult {
  ok: boolean;
  /** Repo-relative files written or changed. */
  files: string[];
  /** `eve add extension/arcana` failed on the peer range; Studio installed + mounted directly. */
  usedFallback: boolean;
  packageManager?: "pnpm" | "yarn" | "npm";
  /** Both env vars were pushed to the linked Vercel project (all targets). */
  pushedToVercel?: boolean;
  /** Transcript of `eve add` / the fallback install, for the console. */
  addOutput?: string;
  envVars?: string[];
  warnings?: string[];
  error?: string;
}
/** Result of `eve info --json` as Studio reads it. */
export interface EveInfoResult {
  ok: boolean;
  status?: string;
  layout?: string;
  errors: number;
  warnings: number;
  skills?: string[];
  subagents?: string[];
  error?: string;
}
export interface MigrateBrainResult {
  ok: boolean;
  removedLegacy: boolean;
  wire?: WireBrainResult;
  info?: EveInfoResult;
  error?: string;
  /** Set when the migration succeeded but the post-check could not run. */
  warning?: string;
}

export interface InstructionsFile {
  path: string;
  relPath: string;
  content: string;
  exists: boolean;
}

// --- CLI runner (build / deploy / eval / init) ---
export type CliKind = "build" | "deploy" | "evalRun";
export interface CliChunk {
  runId: string;
  data: string;
}
export interface CliExit {
  runId: string;
  code: number | null;
}
export interface LogChunk {
  agentId: string;
  data: string;
}
export interface EvalItem {
  id: string;
  description?: string;
}
export interface CreateAgentInput {
  parentDir: string;
  name: string;
  webChat?: boolean;
  /** AI Gateway model id passed to `eve init --model` (default: eve's own). */
  model?: string;
}

/** Outcome of upgrading an agent's eve package to `eve@latest`. */
export interface EveUpgradeResult {
  ok: boolean;
  /** Installed eve version after the run (from node_modules), when readable. */
  version: string | null;
  /** `eve info --json` diagnostics after the upgrade, when it ran. */
  diagnostics?: { errors: number; warnings: number };
  /** Package manager used (pnpm / yarn / npm). */
  packageManager?: string;
  /** True when @kybernesis/arcana was bumped in the same install. */
  bumpedArcana?: boolean;
  error?: string;
}

/** Outcome of `eve add <item> --non-interactive --yes` (registry install). */
export interface RegistryAddResult {
  ok: boolean;
  /** Exit 2: setup needs an answer or an unmet prerequisite. */
  needsInput?: boolean;
  /** The continuation command eve printed on the final event, if any. */
  nextCommand?: string;
  /** Raw NDJSON/plain output for the console. */
  output: string;
}
export interface CreateAgentResult {
  ok: boolean;
  agent?: AgentRecord;
  error?: string;
  runId?: string;
}
export interface SkillInput {
  name: string;
  description: string;
  body?: string;
}
export interface ConnectionInput {
  name: string;
  description?: string;
  kind?: "mcp" | "openapi";
  /** MCP endpoint URL (kind=mcp). */
  url?: string;
  /** OpenAPI spec URL (kind=openapi). */
  spec?: string;
  /** OpenAPI base URL override (kind=openapi). */
  baseUrl?: string;
  authMode?: "static" | "header" | "connect-user" | "connect-app" | "none";
  /** Static bearer env var (authMode=static). */
  envVar?: string;
  /** Custom header name (authMode=header). */
  headerName?: string;
  /** Vercel Connect connector UID (authMode=connect-*). */
  connector?: string;
}
export interface FileWriteResult {
  ok: boolean;
  relPath?: string;
  error?: string;
}

// --- model / config ---
export interface ModelConfig {
  model: string | null;
  reasoning: string | null;
  editable: boolean;
  note: string | null;
}

/** A chat model offered by the agent's linked AI Gateway. */
export interface GatewayModel {
  id: string;
  name: string;
  owner: string;
  contextWindow?: number;
}
export interface GatewayModelsResult {
  ok: boolean;
  models: GatewayModel[];
  error?: string;
}

// --- env ---
export interface EnvFile {
  name: string;
  exists: boolean;
  content: string;
}
export interface EnvState {
  files: EnvFile[];
}
export interface VercelStatus {
  linked: boolean;
  projectName?: string | null;
  projectId?: string | null;
  orgId?: string | null;
}
/** A Vercel team/scope the signed-in user belongs to. */
export interface VercelTeam {
  id: string;
  name: string;
}
export interface VercelTeamsResult {
  ok: boolean;
  teams: VercelTeam[];
  error?: string;
}
/** Vercel CLI auth state. */
export interface VercelWhoami {
  authed: boolean;
  user?: string;
}
/** Whether an agent can actually run its model locally. */
export interface ModelReadiness {
  linked: boolean;
  hasCredential: boolean;
}
export interface CmdResult {
  ok: boolean;
  output: string;
}
/** Latest production deployment info from `vercel ls --prod`. */
export interface ProdInfo {
  ok: boolean;
  url?: string;
  age?: string;
  ready?: boolean;
  error?: string;
}
export interface DeploySettings {
  url?: string;
  bypassSecret?: string;
}
export type ChatTarget = "local" | "deployed";
export interface DeployHealth {
  ok: boolean;
  status: number;
  protected: boolean;
  reason?: string;
}

// --- authoring inputs ---
export interface ToolInput {
  name: string;
  description: string;
  approval?: "never" | "once" | "always";
}

/** A path-based capability whose source files can be opened, edited, deleted. */
export type CapabilityKind =
  "tool" | "skill" | "subagent" | "hook" | "schedule";
export interface CapabilityFile {
  relPath: string;
  content: string;
  language: "ts" | "md" | "text";
}
export interface CapabilityFilesResult {
  kind: CapabilityKind;
  name: string;
  /** Editable source files (single file for tools/hooks; SKILL.md for skills; agent.ts + instructions.md for subagents). */
  files: CapabilityFile[];
  /** Extra files that exist under the capability but aren't opened for editing (e.g. skill references). */
  otherPaths: string[];
  missing: boolean;
}
export interface SubagentInput {
  name: string;
  description: string;
  model?: string;
  instructions?: string;
}
export interface ScheduleInput {
  name: string;
  cron: string;
  prompt: string;
}
export interface SandboxInfo {
  exists: boolean;
  relPath: string | null;
  content: string;
}

// --- channels ---
export interface ChannelItem {
  name: string;
  kind?: string;
  method?: string;
  urlPath?: string;
}
export type ChannelKind =
  | "slack"
  | "discord"
  | "teams"
  | "telegram"
  | "twilio"
  | "github"
  | "linear"
  | "buzz"
  | "custom";
export interface ChannelAddInput {
  kind: ChannelKind;
  /** Vercel Connect connector UID (slack/github/linear). */
  connector?: string;
  /** File name for a custom channel. */
  name?: string;
  /** Rewrite the channel file if it already exists (e.g. to change the bot). */
  overwrite?: boolean;
  /** Telegram bot @handle (no @) baked into telegramChannel({ botUsername }). */
  botUsername?: string;
  /** Twilio outbound "from" number, baked into twilioChannel({ messaging: { from } }). */
  twilioFrom?: string;
  /** Twilio allow-list (comma-separated E.164), baked into twilioChannel({ allowFrom }). */
  twilioAllowFrom?: string;
}

/** Result of validating a Telegram bot token via getMe. */
export interface TelegramVerifyResult {
  ok: boolean;
  id?: number;
  username?: string | null;
  name?: string | null;
  error?: string;
}

/** Result of registering / inspecting the Telegram webhook. */
export interface TelegramWebhookResult {
  ok: boolean;
  /** The webhook URL Telegram currently has, if any. */
  url?: string | null;
  /** True when a webhook is set (and matches the expected URL, when given). */
  live?: boolean;
  /** Queued updates Telegram hasn't delivered yet (nonzero ⇒ agent not answering). */
  pending?: number;
  /** Last delivery error Telegram saw, if any. */
  lastError?: string | null;
  error?: string;
}

/** Persisted Telegram credentials + webhook state Studio holds for an agent. */
export interface TelegramCredInput {
  botToken: string;
  webhookSecret: string;
  botUsername?: string;
  webhookUrl?: string;
}

/** Persisted Buzz credentials + wiring Studio holds for an agent. */
export interface BuzzCredInput {
  relayUrl: string;
  privateKey: string;
  publicKey: string;
  npub: string;
  webhookSecret: string;
  agentName?: string;
  /** Optional Vercel protection-bypass secret the bridge sends as a header. */
  bypassSecret?: string;
  /** Stable production target the bridge forwards inbound messages to. */
  targetUrl?: string;
}

/** Generated Buzz identity for an agent. */
export interface BuzzKeyResult {
  ok: boolean;
  publicKey?: string;
  npub?: string;
  error?: string;
}

/** Result of probing relay membership with the agent identity. */
export interface BuzzVerifyResult {
  ok: boolean;
  member?: boolean;
  channels?: number;
  error?: string;
}

/** Result of pushing the agent profile (kind:0) to the relay. */
export interface BuzzProfileResult {
  ok: boolean;
  avatarUrl?: string | null;
  error?: string;
}

/** Live status for the Buzz channel badge + bridge controls. */
export interface BuzzStatus {
  configured: boolean;
  member?: boolean;
  bridgeRunning: boolean;
  bridgeInstalled: boolean;
  npub?: string;
  relayUrl?: string;
  lastError?: string | null;
}

/** Result of validating Twilio Account SID + Auth Token. */
export interface TwilioVerifyResult {
  ok: boolean;
  friendlyName?: string | null;
  error?: string;
}

/** A phone number on the Twilio account. */
export interface TwilioNumber {
  sid: string;
  phoneNumber: string;
  friendlyName: string;
  smsUrl: string;
}

/** List of the account's phone numbers. */
export interface TwilioNumbersResult {
  ok: boolean;
  numbers: TwilioNumber[];
  error?: string;
}

/** Result of pointing a Twilio number's webhooks at the agent (or reading them). */
export interface TwilioWebhookResult {
  ok: boolean;
  smsUrl?: string;
  /** The number's SMS webhook points at this deployment. */
  live?: boolean;
  error?: string;
}

/** Persisted Twilio credentials Studio holds for an agent. */
export interface TwilioCredInput {
  accountSid: string;
  authToken: string;
  phoneSid: string;
  phoneNumber: string;
  allowFrom?: string;
}

/** Live Twilio connection status for the Channels badge. */
export interface TwilioStatus {
  configured: boolean;
  live?: boolean;
  phoneNumber?: string | null;
  smsUrl?: string | null;
  lastError?: string | null;
}

/** Result of validating Microsoft Teams (Azure Bot) credentials. */
export interface TeamsVerifyResult {
  ok: boolean;
  error?: string;
}

/** Persisted Teams credentials Studio holds for an agent. */
export interface TeamsCredInput {
  appId: string;
  appPassword: string;
  tenantId?: string;
}

/** Live Teams connection status for the Channels badge (credential validity). */
export interface TeamsStatus {
  configured: boolean;
  /** Credentials still mint a Bot Connector token. */
  live?: boolean;
  lastError?: string | null;
}

/** Result of validating a Discord bot token (derives app id + public key). */
export interface DiscordVerifyResult {
  ok: boolean;
  applicationId?: string;
  name?: string | null;
  publicKey?: string | null;
  /** Interactions endpoint already set on the app, if any. */
  endpointUrl?: string | null;
  error?: string;
}

/** Result of setting/verifying the Discord interactions endpoint. */
export interface DiscordEndpointResult {
  ok: boolean;
  url?: string | null;
  live?: boolean;
  error?: string;
}

/** Persisted Discord credentials Studio holds for an agent. */
export interface DiscordCredInput {
  botToken: string;
  applicationId: string;
  publicKey: string;
  endpointUrl?: string;
  commandsRegistered?: boolean;
}

/** Live Discord connection status for the Channels badge. */
export interface DiscordStatus {
  configured: boolean;
  /** The interactions endpoint is set (Discord only allows that once verified). */
  live?: boolean;
  url?: string | null;
  name?: string | null;
  /** Error reaching Discord / reading the app (e.g. a revoked token). */
  lastError?: string | null;
}

/** Live Telegram connection status for the Channels badge. */
export interface TelegramStatus {
  /** Studio has a bot token saved for this agent. */
  configured: boolean;
  /** A webhook is registered and points somewhere. */
  live?: boolean;
  url?: string | null;
  /** Undelivered updates queued at Telegram (nonzero ⇒ the agent isn't answering). */
  pending?: number;
  /** Telegram's last delivery error — e.g. a 401 from Deployment Protection. */
  lastError?: string | null;
  botUsername?: string | null;
}
/** Live wiring for one channel: which connector it uses + attachment state. */
export interface ChannelWiring {
  name: string;
  /** Connector UID the channel file references, if any. */
  connector: string | null;
  /** Whether that connector is attached to this agent's Vercel project. */
  attached: boolean | null;
}
export interface ChannelWriteResult {
  ok: boolean;
  relPath?: string;
  envVars?: string[];
  connect?: boolean;
  error?: string;
}

// --- vercel connect ---
export interface ConnectorItem {
  uid: string;
  id: string;
  name: string;
  type: string;
}
/** Where a connector UID is referenced in the agent's files. */
export interface ConnectorUsage {
  uid: string;
  kind: "connection" | "channel";
  name: string;
}

export const IPC = {
  appInfo: "app:info",

  agentsList: "agents:list",
  eveLatest: "eve:latest",
  eveUpgrade: "eve:upgrade",
  agentsAdd: "agents:add",
  agentsRemove: "agents:remove",

  agentStart: "agent:start",
  agentStop: "agent:stop",
  agentRestart: "agent:restart",
  agentStatus: "agent:status",
  agentInfo: "agent:info",
  agentStructure: "agent:structure",
  agentReadInstructions: "agent:readInstructions",
  agentWriteInstructions: "agent:writeInstructions",
  agentLogs: "agent:logs",
  agentCreate: "agent:create",
  agentRegister: "agent:register",
  skillCreate: "agent:skillCreate",
  connectionAdd: "agent:connectionAdd",
  connectionRead: "agent:connectionRead",
  connectionWrite: "agent:connectionWrite",
  connectionDelete: "agent:connectionDelete",
  connectorUsage: "agent:connectorUsage",
  dialogPickDir: "dialog:pickDir",

  modelRead: "agent:modelRead",
  modelWrite: "agent:modelWrite",
  envRead: "agent:envRead",
  envWrite: "agent:envWrite",
  toolCreate: "agent:toolCreate",
  subagentCreate: "agent:subagentCreate",
  hookCreate: "agent:hookCreate",
  scheduleCreate: "agent:scheduleCreate",
  scheduleRun: "agent:scheduleRun",
  capabilityFiles: "agent:capabilityFiles",
  capabilityWrite: "agent:capabilityWrite",
  capabilityDelete: "agent:capabilityDelete",
  sandboxRead: "agent:sandboxRead",
  sandboxCreate: "agent:sandboxCreate",
  channelsList: "agent:channelsList",
  channelAdd: "agent:channelAdd",
  channelWrite: "agent:channelWrite",
  channelDelete: "agent:channelDelete",
  channelWiring: "agent:channelWiring",

  vercelStatus: "vercel:status",
  vercelEnvLs: "vercel:envLs",
  vercelEnvPull: "vercel:envPull",
  vercelEnvAdd: "vercel:envAdd",
  vercelEnvSetAll: "vercel:envSetAll",
  vercelProdInfo: "vercel:prodInfo",
  vercelLink: "vercel:link",
  vercelTeams: "vercel:teams",
  vercelWhoami: "vercel:whoami",
  vercelLogin: "vercel:login",
  modelReadiness: "vercel:modelReadiness",
  gatewayModels: "vercel:gatewayModels",
  buzzGenKey: "buzz:genKey",
  buzzWire: "buzz:wire",
  buzzVerify: "buzz:verify",
  buzzSetProfile: "buzz:setProfile",
  buzzGetProfile: "buzz:getProfile",
  buzzSave: "buzz:save",
  buzzStatus: "buzz:status",
  buzzBridgeStart: "buzz:bridgeStart",
  buzzBridgeStop: "buzz:bridgeStop",
  buzzBridgeInstall: "buzz:bridgeInstall",
  buzzBridgeUninstall: "buzz:bridgeUninstall",
  telegramVerify: "telegram:verify",
  telegramSetWebhook: "telegram:setWebhook",
  telegramWebhookInfo: "telegram:webhookInfo",
  telegramSave: "telegram:save",
  telegramStatus: "telegram:status",
  telegramRegisterWebhook: "telegram:registerWebhook",
  discordVerify: "discord:verify",
  discordSave: "discord:save",
  discordStatus: "discord:status",
  discordRegisterCommands: "discord:registerCommands",
  discordSetEndpoint: "discord:setEndpoint",
  twilioVerify: "twilio:verify",
  twilioNumbers: "twilio:numbers",
  twilioSave: "twilio:save",
  twilioStatus: "twilio:status",
  twilioSetWebhooks: "twilio:setWebhooks",
  teamsVerify: "teams:verify",
  teamsSave: "teams:save",
  teamsStatus: "teams:status",
  vercelProdAlias: "vercel:prodAlias",
  deployGet: "agent:deployGet",
  deploySet: "agent:deploySet",
  deployHealth: "agent:deployHealth",
  connectorList: "vercel:connectorList",
  connectorCreate: "vercel:connectorCreate",
  connectorAttach: "vercel:connectorAttach",
  connectOpen: "vercel:connectOpen",
  connectOpenExternal: "vercel:connectOpenExternal",
  connectorOpenPage: "vercel:connectorOpenPage",

  cliRun: "cli:run",
  cliCancel: "cli:cancel",
  vercelConnectorCreateStream: "vercel:connectorCreateStream",
  vercelConnectorCreateChunk: "vercel:connectorCreateChunk",
  evalList: "eval:list",

  // push channels
  cliChunk: "cli:chunk",
  cliExit: "cli:exit",
  agentLog: "agent:log",

  arcanaDetect: "arcana:detect",
  arcanaValidate: "arcana:validate",
  arcanaStats: "arcana:stats",
  arcanaTimeline: "arcana:timeline",
  arcanaQuery: "arcana:query",
  arcanaWire: "arcana:wire",
  arcanaMigrate: "arcana:migrate",

  // ---- Registry & memory (eve 0.49) ----
  registryList: "registry:list",
  registryAdd: "registry:add",
  registryView: "registry:view",
  /** push: streamed `eve add` output lines ({ runId, data }) */
  registryAddChunk: "registry:addChunk",
  memorySlots: "memory:slots",
  memoryAddFile: "memory:addFile",
  memoryAddSupermemory: "memory:addSupermemory",
  selfModStatus: "selfmod:status",
  selfModEnable: "selfmod:enable",
  /** Vercel Connect connectors attached to this agent's linked project. */
  connectorsAttached: "connectors:attached",
  extensionMountRead: "extension:mountRead",
  extensionMountWrite: "extension:mountWrite",

  chatListThreads: "chat:listThreads",
  chatCreateThread: "chat:createThread",
  chatGetThread: "chat:getThread",
  chatDeleteThread: "chat:deleteThread",
  chatArchiveThread: "chat:archiveThread",
  chatSend: "chat:send",
  chatRespond: "chat:respond",
  chatCancel: "chat:cancel",
  chatClear: "chat:clear",
  chatCompact: "chat:compact",
  chatReset: "chat:reset",

  // auto-update (electron-updater)
  updaterGetState: "updater:getState",
  updaterCheck: "updater:check",
  updaterDownload: "updater:download",
  updaterInstall: "updater:install",

  // push channels (main -> renderer)
  chatEvent: "chat:event",
  chatStatus: "chat:status",
  agentStatusChanged: "agent:statusChanged",
  updaterState: "updater:state",
} as const;

// ---- Registry & memory (eve 0.49) ----
/** One item from `eve registry list --json` (official registry, 91 items). */
export interface RegistryItem {
  /** e.g. `channel/slack`, `extension/arcana`, `memory/supermemory`. */
  name: string;
  title: string;
  /** Always `registry:item` today. */
  type: string;
  description: string;
  registry: string;
  addCommandArgument: string;
  /** Site-relative docs path, e.g. `/docs/channels/slack` → `https://eve.dev${docs}`. */
  docs?: string;
  /** `native` | `chat-sdk` when the registry says how it's implemented. */
  implementation?: string;
}
export interface RegistryListResult {
  ok: boolean;
  items: RegistryItem[];
  cachedAt?: number;
  error?: string;
}
/** Exit 0 → done, 1 → failed, 2 → needs an answer / prerequisite. */
export type RegistryInstallStatus = "done" | "failed" | "needs-input";
/** Structured outcome of `eve add <item> --non-interactive --yes`. */
export interface RegistryInstallResult {
  exitCode: number | null;
  status: RegistryInstallStatus;
  /** Final event `message` (or `prerequisite.message` when blocked). */
  message?: string;
  /** `next.command next.args…` from the final event — run it in a terminal. */
  nextCommand?: string;
  /** `prerequisite.command` when blocked (e.g. `eve link`). */
  prerequisiteCommand?: string;
  /** Env vars the item added to `.env.local` (scraped from the transcript). */
  envVars?: string[];
  /** Files the item created (scraped from the transcript). */
  files?: string[];
  /** e.g. `dependency_install` (peer-range failure, rolled back). */
  failureCode?: string;
  deploymentRequired?: boolean;
}
export interface RegistryInstallOptions {
  skipSetup?: boolean;
  overwrite?: boolean;
}
/** Streamed `eve add` output for the renderer console. */
export interface RegistryAddChunk {
  runId: string;
  data: string;
}
export interface MemorySlot {
  slot: string;
  description?: string;
  visibility?: string;
  /** `memory/<slot>.ts` or `memory.ts`. */
  logicalPath: string;
  relPath: string;
  /** Inferred from the slot's source; `unknown` when only the manifest knows it. */
  provider: "file" | "supermemory" | "custom" | "unknown";
  fromManifest: boolean;
}
export interface MemorySlotsResult {
  slots: MemorySlot[];
  source: "manifest" | "disk";
}
export interface SelfModStatus {
  enabled: boolean;
  relPath: string;
}
export interface ConnectorsAttached {
  projectId: string | null;
  /** Connector UIDs attached to the linked project (empty when unlinked). */
  attached: string[];
}
