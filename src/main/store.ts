import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import type {
  BuzzCredInput, AgentRecord, EveEvent, ThreadRecord } from "../shared/ipc";

/**
 * Resume state for an Eve session (Eve has no server-side history — we own it).
 *
 * @remarks
 * Sessions are addressed by durable id only (eve 0.49). Records persisted by
 * older Studio builds may still carry a `continuationToken` field; it is
 * ignored on read and dropped on the next write.
 */
export interface SessionCursor {
  sessionId?: string;
  streamIndex: number;
}

/**
 * A stored Arcana brain credential, keyed by agent id.
 *
 * @remarks
 * Stored so Studio can browse a brain without re-parsing the agent's files.
 * Held in the local userData JSON for now; an OS-keychain vault is a later
 * hardening pass.
 */
export interface BrainCred {
  workspace: string;
  envVar: string;
  key: string;
}

/** Per-agent deployed-target settings for "chat with deployed". */
export interface DeploySettings {
  url?: string;
  bypassSecret?: string;
}

/**
 * Telegram bot credentials + webhook state, keyed by agent id.
 *
 * @remarks
 * Held so Studio can show a live connection badge and re-register the webhook
 * after a redeploy without the user re-pasting the token. `webhookSecret` must
 * match `TELEGRAM_WEBHOOK_SECRET_TOKEN` in the deployment — kept stable here so a
 * repair doesn't force a redeploy. Plaintext local JSON for now (same as brains);
 * an OS-keychain vault is a later hardening pass.
 */
export interface TelegramCred {
  botToken: string;
  webhookSecret: string;
  botUsername?: string;
  webhookUrl?: string;
}

/** Discord bot credentials + endpoint state, keyed by agent id (see {@link TelegramCred}). */
export interface DiscordCred {
  botToken: string;
  applicationId: string;
  publicKey: string;
  endpointUrl?: string;
  commandsRegistered?: boolean;
}

/** Twilio credentials + chosen number, keyed by agent id (see {@link TelegramCred}). */
export interface TwilioCred {
  accountSid: string;
  authToken: string;
  phoneSid: string;
  phoneNumber: string;
  allowFrom?: string;
}

/** Teams (Azure Bot) credentials, keyed by agent id (see {@link TelegramCred}). */
export interface TeamsCred {
  appId: string;
  appPassword: string;
  tenantId?: string;
}

interface Db {
  agents: AgentRecord[];
  threads: ThreadRecord[];
  cursors: Record<string, SessionCursor>;
  brains: Record<string, BrainCred>;
  deploy: Record<string, DeploySettings>;
  telegram: Record<string, TelegramCred>;
  discord: Record<string, DiscordCred>;
  twilio: Record<string, TwilioCred>;
  teams: Record<string, TeamsCred>;
  buzz: Record<string, BuzzCredInput>;
}

let dbPath = "";
let eventsDir = "";
let db: Db = {
  agents: [],
  threads: [],
  cursors: {},
  brains: {},
  deploy: {},
  telegram: {},
  discord: {},
  twilio: {},
  teams: {},
  buzz: {},
};

export function initStore(): void {
  const dataDir = app.getPath("userData");
  dbPath = join(dataDir, "studio-db.json");
  eventsDir = join(dataDir, "events");
  mkdirSync(eventsDir, { recursive: true });
  if (existsSync(dbPath)) {
    try {
      const parsed = JSON.parse(readFileSync(dbPath, "utf8")) as Partial<Db>;
      db = {
        agents: parsed.agents ?? [],
        threads: parsed.threads ?? [],
        cursors: parsed.cursors ?? {},
        brains: parsed.brains ?? {},
        deploy: parsed.deploy ?? {},
        telegram: parsed.telegram ?? {},
        discord: parsed.discord ?? {},
        twilio: parsed.twilio ?? {},
        teams: parsed.teams ?? {},
        buzz: (parsed as Partial<Db>).buzz ?? {},
      };
    } catch {
      db = {
        agents: [],
        threads: [],
        cursors: {},
        brains: {},
        deploy: {},
        telegram: {},
        discord: {},
        twilio: {},
        teams: {},
        buzz: {},
      };
    }
  } else {
    persist();
  }
}

function persist(): void {
  writeFileSync(dbPath, JSON.stringify(db, null, 2));
}

export function rid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// --- agents ---
export function listAgents(): AgentRecord[] {
  return [...db.agents].sort((a, b) => b.addedAt - a.addedAt);
}
export function getAgent(id: string): AgentRecord | undefined {
  return db.agents.find((a) => a.id === id);
}
export function upsertAgent(agent: AgentRecord): void {
  const i = db.agents.findIndex((a) => a.id === agent.id);
  if (i >= 0) {
    db.agents[i] = agent;
  } else {
    db.agents.push(agent);
  }
  persist();
}
export function removeAgent(id: string): void {
  db.agents = db.agents.filter((a) => a.id !== id);
  for (const t of db.threads.filter((x) => x.agentId === id)) {
    deleteThread(t.id);
  }
  persist();
}

// --- threads ---
export function listThreads(agentId: string): ThreadRecord[] {
  return db.threads
    .filter((t) => t.agentId === agentId)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
export function getThread(id: string): ThreadRecord | undefined {
  return db.threads.find((t) => t.id === id);
}
export function createThread(agentId: string, title: string): ThreadRecord {
  const now = Date.now();
  const thread: ThreadRecord = {
    id: rid(),
    agentId,
    title,
    createdAt: now,
    updatedAt: now,
  };
  db.threads.push(thread);
  persist();
  return thread;
}
export function touchThread(id: string, title?: string): void {
  const t = getThread(id);
  if (!t) {
    return;
  }
  t.updatedAt = Date.now();
  if (title) {
    t.title = title;
  }
  persist();
}
export function setThreadArchived(id: string, archived: boolean): void {
  const t = getThread(id);
  if (!t) {
    return;
  }
  t.archived = archived;
  persist();
}
export function deleteThread(id: string): void {
  db.threads = db.threads.filter((t) => t.id !== id);
  delete db.cursors[id];
  persist();
  try {
    rmSync(eventFile(id));
  } catch {
    // no event file yet — fine
  }
}

// --- brains (Arcana credentials, keyed by agent id) ---
export function getBrain(agentId: string): BrainCred | undefined {
  return db.brains[agentId];
}
export function setBrain(agentId: string, cred: BrainCred): void {
  db.brains[agentId] = cred;
  persist();
}
export function deleteBrain(agentId: string): void {
  delete db.brains[agentId];
  persist();
}

// --- telegram credentials (keyed by agent id) ---
export function getTelegram(agentId: string): TelegramCred | undefined {
  return db.telegram[agentId];
}
export function setTelegram(agentId: string, cred: TelegramCred): void {
  db.telegram[agentId] = { ...db.telegram[agentId], ...cred };
  persist();
}
export function deleteTelegram(agentId: string): void {
  delete db.telegram[agentId];
  persist();
}

// --- buzz credentials (keyed by agent id) ---
export function getBuzz(agentId: string): BuzzCredInput | undefined {
  return db.buzz[agentId];
}
export function setBuzz(agentId: string, cred: BuzzCredInput): void {
  db.buzz[agentId] = { ...db.buzz[agentId], ...cred };
  persist();
}
export function deleteBuzz(agentId: string): void {
  delete db.buzz[agentId];
  persist();
}

// --- discord credentials (keyed by agent id) ---
export function getDiscord(agentId: string): DiscordCred | undefined {
  return db.discord[agentId];
}
export function setDiscord(agentId: string, cred: DiscordCred): void {
  db.discord[agentId] = { ...db.discord[agentId], ...cred };
  persist();
}
export function deleteDiscord(agentId: string): void {
  delete db.discord[agentId];
  persist();
}

// --- twilio credentials (keyed by agent id) ---
export function getTwilio(agentId: string): TwilioCred | undefined {
  return db.twilio[agentId];
}
export function setTwilio(agentId: string, cred: TwilioCred): void {
  db.twilio[agentId] = { ...db.twilio[agentId], ...cred };
  persist();
}
export function deleteTwilio(agentId: string): void {
  delete db.twilio[agentId];
  persist();
}

// --- teams credentials (keyed by agent id) ---
export function getTeams(agentId: string): TeamsCred | undefined {
  return db.teams[agentId];
}
export function setTeams(agentId: string, cred: TeamsCred): void {
  db.teams[agentId] = { ...db.teams[agentId], ...cred };
  persist();
}
export function deleteTeams(agentId: string): void {
  delete db.teams[agentId];
  persist();
}

// --- deploy settings ---
export function getDeploy(agentId: string): DeploySettings {
  return db.deploy[agentId] ?? {};
}
export function setDeploy(agentId: string, settings: DeploySettings): void {
  db.deploy[agentId] = { ...db.deploy[agentId], ...settings };
  persist();
}

// --- cursors ---
export function getCursor(threadId: string): SessionCursor {
  return db.cursors[threadId] ?? { streamIndex: 0 };
}
export function setCursor(threadId: string, cursor: SessionCursor): void {
  db.cursors[threadId] = cursor;
  persist();
}

// --- events (jsonl per thread) ---
function eventFile(threadId: string): string {
  return join(eventsDir, `${threadId}.jsonl`);
}
export function appendEvent(threadId: string, event: EveEvent): void {
  appendFileSync(eventFile(threadId), `${JSON.stringify(event)}\n`);
}
export function readEvents(threadId: string): EveEvent[] {
  const f = eventFile(threadId);
  if (!existsSync(f)) {
    return [];
  }
  const out: EveEvent[] = [];
  for (const line of readFileSync(f, "utf8").split("\n")) {
    if (!line) {
      continue;
    }
    try {
      out.push(JSON.parse(line) as EveEvent);
    } catch {
      // skip a corrupt line
    }
  }
  return out;
}
