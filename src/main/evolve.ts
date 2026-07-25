import { del as blobDel, list as blobList } from "@vercel/blob";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import type {
  EvolveApplyResult,
  EvolveDetectResult,
  EvolveDraftResult,
  EvolveProposal,
  EvolveSuggestion,
  ProposalFileChange,
  ProposalKind,
  QueuedProposal,
} from "../shared/ipc";
import { agentRoot, nested, readModelConfig } from "./agentAuthoring";
import {
  alternateInstructionsForm,
  readInstructions,
  writeInstructions,
} from "./agentFiles";
import {
  arcanaBrainList,
  arcanaBrainRead,
  arcanaBrainWrite,
  arcanaRemember,
  arcanaTimeline,
} from "./arcana";
import { brainFromConnection } from "./arcanaWire";
import { vercelEnvNames, vercelEnvPull } from "./vercel";

const GATEWAY_URL = "https://ai-gateway.vercel.sh/v1/chat/completions";
const DEFAULT_MODEL = "anthropic/claude-opus-4.8";
const KINDS: readonly ProposalKind[] = [
  "memory",
  "instructions",
  "skill",
  "tool",
  "schedule",
];

/** Read a var from the agent's .env.local (falling back to .env). */
function readEnv(agentPath: string, key: string): string | null {
  for (const f of [".env.local", ".env"]) {
    try {
      const src = readFileSync(join(agentPath, f), "utf8");
      const m = new RegExp(`^${key}=(.*)$`, "m").exec(src);
      const v = m?.[1]?.trim().replace(/^["']|["']$/g, "");
      if (v) {
        return v;
      }
    } catch {
      // no such file — try the next
    }
  }
  return null;
}

/** The gateway credential Eve itself uses locally: OIDC token or a static key. */
function credential(agentPath: string): string | null {
  return (
    readEnv(agentPath, "AI_GATEWAY_API_KEY") ??
    readEnv(agentPath, "VERCEL_OIDC_TOKEN")
  );
}

interface GatewayReply {
  ok: boolean;
  content?: string;
  error?: string;
}

async function post(
  model: string,
  system: string,
  user: string,
  token: string,
): Promise<{ status: number; body: string }> {
  const res = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  return { status: res.status, body: await res.text() };
}

/**
 * Call the Vercel AI Gateway with the agent's own linked credential.
 *
 * @remarks
 * `VERCEL_OIDC_TOKEN` is short-lived (~12h). On a 401 we refresh it once via
 * `vercel env pull` — the same mechanism Eve relies on locally — then retry.
 */
async function callGateway(
  agentPath: string,
  model: string,
  system: string,
  user: string,
): Promise<GatewayReply> {
  let token = credential(agentPath);
  if (!token) {
    return {
      ok: false,
      error:
        "No AI Gateway credential found. Link the agent to Vercel (Deploy tab) so it can author changes with its own model.",
    };
  }
  let res: { status: number; body: string };
  try {
    res = await post(model, system, user, token);
  } catch (e) {
    return {
      ok: false,
      error: `Gateway request failed: ${(e as Error).message}`,
    };
  }
  if (res.status === 401) {
    // Stale OIDC token — refresh from the linked project and retry once.
    await vercelEnvPull(agentPath);
    token = credential(agentPath) ?? token;
    try {
      res = await post(model, system, user, token);
    } catch (e) {
      return {
        ok: false,
        error: `Gateway request failed: ${(e as Error).message}`,
      };
    }
  }
  if (res.status !== 200) {
    return {
      ok: false,
      error: `Gateway returned ${res.status}: ${res.body.slice(0, 300)}`,
    };
  }
  try {
    const json = JSON.parse(res.body);
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      return { ok: false, error: "Gateway returned no message content." };
    }
    return { ok: true, content };
  } catch {
    return { ok: false, error: "Could not parse the gateway response." };
  }
}

/** Extract the first balanced top-level JSON object from a model reply. */
function extractJson(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) {
    return null;
  }
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) {
        esc = false;
      } else if (c === "\\") {
        esc = true;
      } else if (c === '"') {
        inStr = false;
      }
      continue;
    }
    if (c === '"') {
      inStr = true;
    } else if (c === "{") {
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return null;
}

/** List the names of an agent's existing capabilities, for context + collisions. */
function inventory(agentPath: string): {
  tools: string[];
  skills: string[];
  schedules: string[];
  channels: string[];
} {
  const root = agentRoot(agentPath);
  const dir = (name: string, ext?: string): string[] => {
    try {
      return readdirSync(join(root, name))
        .filter((e) => (ext ? e.endsWith(ext) : true))
        .map((e) => (ext ? e.slice(0, -ext.length) : e));
    } catch {
      return [];
    }
  };
  return {
    tools: dir("tools", ".ts"),
    skills: dir("skills"),
    schedules: dir("schedules", ".ts"),
    channels: dir("channels", ".ts"),
  };
}

/**
 * Env var NAMES (never values) that likely name a message target or connector —
 * so the model wires a schedule to the right channel-id var instead of guessing.
 */
async function targetEnvNames(agentPath: string): Promise<string[]> {
  const names = new Set<string>();
  const re = /SLACK|DISCORD|TELEGRAM|TWILIO|CHANNEL|WEBHOOK|CONNECTOR/;
  for (const f of [".env", ".env.local"]) {
    try {
      const src = readFileSync(join(agentPath, f), "utf8");
      // Require a non-empty value — an empty `VAR=` isn't really "set", and
      // treating it as set is what silently skipped a scheduled Slack DM.
      for (const m of src.matchAll(/^([A-Z][A-Z0-9_]*)=[ \t]*\S/gm)) {
        if (re.test(m[1])) {
          names.add(m[1]);
        }
      }
    } catch {
      // no such file
    }
  }
  // Deployed vars live on Vercel (not local .env), so check there too — else a
  // target that's already set gets wrongly flagged as a missing prereq.
  for (const n of await vercelEnvNames(agentPath)) {
    if (re.test(n)) {
      names.add(n);
    }
  }
  return [...names];
}

const SYSTEM = `You are the authoring engine inside Eve Studio. You turn a plain-English request to change an Eve agent into ONE concrete, minimal file change, following Eve's filesystem conventions exactly. Eve discovers capabilities from the filesystem — identity comes from the file path, never a name field.

Route the request to exactly one kind:
- "memory": a durable FACT about the user (preferences, context). Belongs in the agent's brain, not its code. Return no files.
- "instructions": a stable change to BEHAVIOR, policy, or persona. Patch instructions.md.
- "skill": a reusable procedure or body of knowledge. Create <prefix>skills/<slug>/SKILL.md with YAML frontmatter carrying ONLY a description key, then the guidance body. The name comes from the folder path — never add a name field. The description is the routing hint.
- "tool": a typed action the agent calls. Create <prefix>tools/<snake_name>.ts with a default-exported defineTool from "eve/tools", a zod inputSchema, and an async execute. Relative imports need a .js extension. TypeScript is strict — annotate every parameter, never leave an implicit any.
  Gate the tool if it does anything sensitive, irreversible, external-side-effecting, financial, or regulated (deleting, sending, posting, paying, calling a third party): import { always } from "eve/tools/approval" and set approval: always(), so the user confirms each call. Use once() only for repeat-safe actions.
- "schedule": recurring proactive work (a cron that wakes the agent). Create <prefix>schedules/<slug>.ts using defineSchedule from "eve/schedules".

Cron & time zones:
- Cron is a 5-field spec evaluated in UTC on Vercel. If the user gives a local time, convert it to UTC and state both the local time (with zone) and the UTC cron in the TSDoc.

Messaging a provider (Slack/Discord/etc.) from a schedule:
- To DM or post, the agent uses an existing CHANNEL — it does NOT need an MCP connection for this. If a channel for the provider is in "Existing channels", REUSE it; never propose a connection, and do not flag it as a prereq.
- Slack pattern — import the channel and post inside run():
    import { defineSchedule } from "eve/schedules";
    import slack from "../channels/slack.js";
    export default defineSchedule({
      cron: "0 2 * * 5",
      run({ receive, waitUntil, appAuth }) {
        const channelId = process.env.SLACK_NUDGE_CHANNEL;
        if (!channelId) return;
        waitUntil(receive(slack, { message: "…instruction to the agent…", target: { channelId }, auth: appAuth }));
      },
    });
  The channel import path is relative to the schedules dir ("../channels/<name>.js", keep the .js). "message" is an instruction to the agent, not the literal text to send.
- Target env var: REUSE an existing Slack channel-id var from "Relevant env vars" if there is one; otherwise use the single shared name SLACK_NUDGE_CHANNEL. NEVER invent a new per-task/per-reminder variable name (not SLACK_TESTOSTERONE_CHANNEL etc.) — one target var serves all reminders.
- If NO channel for the provider exists, still produce the schedule, but add a prereq: "Add a <provider> channel in Integrations (a channel, not an MCP connection)."
- Only if the target var is NOT in the "Relevant env vars" list above, add a prereq of the exact form "Set <VAR> to your Slack member id (U…) or a channel id (C…)" — nothing more (the UI turns that into an inline field). If the var IS listed, it's already set: use it, no prereq.

Rules:
- Prefer "memory" for facts and "instructions" only for behavior.
- For "instructions", return the COMPLETE new instructions.md content in files[0].content (the current content is provided; make the smallest sensible edit).
- Produce COMPLETE, valid file content — never stubs or TODOs.
- Every file relPath MUST start with the given path prefix.
- Reply with ONLY a JSON object, no prose, no code fences:
{"kind","title","rationale","prereqs":[],"memory":"(only for memory)","files":[{"relPath","content"}]}`;

function langOf(relPath: string): ProposalFileChange["language"] {
  if (relPath.endsWith(".ts")) {
    return "ts";
  }
  if (relPath.endsWith(".md")) {
    return "md";
  }
  return "text";
}

/** Draft a self-change proposal from a natural-language intent. */
export async function draftProposal(
  agentPath: string,
  intent: string,
  timezone?: string,
): Promise<EvolveDraftResult> {
  const trimmed = intent.trim();
  if (!trimmed) {
    return { ok: false, error: "Describe the change you want first." };
  }
  const model = readModelConfig(agentPath).model || DEFAULT_MODEL;
  const prefix = nested(agentPath);
  const inv = inventory(agentPath);
  const instructions = readInstructions(agentPath).content;
  const envNames = await targetEnvNames(agentPath);
  const user = `Path prefix for every relPath: ${JSON.stringify(prefix)}
Existing tools: ${inv.tools.join(", ") || "(none)"}
Existing skills: ${inv.skills.join(", ") || "(none)"}
Existing schedules: ${inv.schedules.join(", ") || "(none)"}
Existing channels: ${inv.channels.join(", ") || "(none)"}
Relevant env vars (names only, for message targets — these ARE set, reuse them and do NOT flag them as prereqs): ${envNames.join(", ") || "(none)"}
User's timezone: ${timezone || "unknown"} — interpret any local clock time (e.g. "9am") in THIS zone and convert to the equivalent UTC cron; state the local time + zone and the UTC in the TSDoc.

Current instructions.md:
"""
${instructions.slice(0, 6000)}
"""

Change request: ${trimmed}`;

  const reply = await callGateway(agentPath, model, SYSTEM, user);
  if (!reply.ok || !reply.content) {
    return { ok: false, error: reply.error ?? "Authoring failed." };
  }
  const raw = extractJson(reply.content);
  if (!raw) {
    return { ok: false, error: "The model did not return a usable proposal." };
  }
  let parsed: {
    kind?: string;
    title?: string;
    rationale?: string;
    prereqs?: unknown;
    memory?: string;
    files?: { relPath?: string; content?: string }[];
  };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "The model returned malformed JSON." };
  }
  const kind = KINDS.includes(parsed.kind as ProposalKind)
    ? (parsed.kind as ProposalKind)
    : "instructions";

  const files: ProposalFileChange[] = [];
  for (const f of parsed.files ?? []) {
    if (!(f?.relPath && typeof f.content === "string")) {
      continue;
    }
    try {
      assertWritable(agentPath, f.relPath);
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
    const abs = resolve(agentPath, f.relPath);
    const before = existsSync(abs) ? readFileSync(abs, "utf8") : null;
    files.push({
      relPath: f.relPath,
      language: langOf(f.relPath),
      before,
      after: f.content,
    });
  }

  if (kind !== "memory" && files.length === 0) {
    return { ok: false, error: "The proposal produced no file changes." };
  }

  const proposal: EvolveProposal = {
    kind,
    title: parsed.title?.trim() || "Proposed change",
    rationale: parsed.rationale?.trim() || "",
    files,
    memory: kind === "memory" ? parsed.memory?.trim() : undefined,
    prereqs: Array.isArray(parsed.prereqs)
      ? parsed.prereqs.filter((p): p is string => typeof p === "string")
      : [],
    needsRebuild: kind !== "memory",
  };
  return { ok: true, proposal };
}

const DETECT_SYSTEM = `You analyze an Eve agent's recent activity to find recurring work worth turning into a reusable capability. Eve capabilities: a skill (a repeatable procedure/knowledge), a tool (a typed action), or a schedule (recurring proactive work).

Find at most 3 patterns that recur often enough to be worth automating. Be strict — a one-off is not a pattern. Skip anything already covered by the agent's existing capabilities.

For each, return:
- "title": short label
- "rationale": what recurs and why a capability helps (reference the evidence)
- "kind": "skill" | "tool" | "schedule"
- "intent": a concrete, first-person instruction that could create it, phrased like the user asking for it (e.g. "Create a skill that drafts a weekly investor update from my notes.")

Reply with ONLY a JSON object: {"suggestions":[{"title","rationale","kind","intent"}]}. Return {"suggestions":[]} if nothing clearly recurs.`;

/**
 * Emergent detection: scan recent chat + memory activity for recurring tasks
 * that would be better as a skill, tool, or schedule.
 */
export async function detectPatterns(
  agentPath: string,
  threadTitles: string[],
  brain?: { workspace: string; key: string } | null,
): Promise<EvolveDetectResult> {
  const model = readModelConfig(agentPath).model || DEFAULT_MODEL;
  const inv = inventory(agentPath);

  let timeline: string[] = [];
  if (brain) {
    const t = await arcanaTimeline(brain.workspace, brain.key, 40);
    if (t.ok && t.data) {
      timeline = t.data.map((e) => e.title).filter(Boolean);
    }
  }

  if (threadTitles.length === 0 && timeline.length === 0) {
    return {
      ok: false,
      suggestions: [],
      error:
        "Not enough activity yet. Chat with the agent (or connect its brain) so Studio has patterns to learn from.",
    };
  }

  const user = `Existing skills: ${inv.skills.join(", ") || "(none)"}
Existing tools: ${inv.tools.join(", ") || "(none)"}
Existing schedules: ${inv.schedules.join(", ") || "(none)"}

Recent conversation topics (newest first):
${
  threadTitles
    .slice(0, 30)
    .map((t) => `- ${t}`)
    .join("\n") || "(none)"
}

Recent things the agent did (from memory, newest first):
${
  timeline
    .slice(0, 40)
    .map((t) => `- ${t}`)
    .join("\n") || "(none)"
}`;

  const reply = await callGateway(agentPath, model, DETECT_SYSTEM, user);
  if (!reply.ok || !reply.content) {
    return { ok: false, suggestions: [], error: reply.error ?? "Scan failed." };
  }
  const raw = extractJson(reply.content);
  if (!raw) {
    return {
      ok: false,
      suggestions: [],
      error: "The model returned no usable result.",
    };
  }
  let parsed: { suggestions?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      suggestions: [],
      error: "The model returned malformed JSON.",
    };
  }
  const kinds = new Set(["skill", "tool", "schedule"]);
  const suggestions: EvolveSuggestion[] = Array.isArray(parsed.suggestions)
    ? parsed.suggestions
        .filter(
          (s): s is EvolveSuggestion =>
            Boolean(s) &&
            typeof (s as EvolveSuggestion).intent === "string" &&
            typeof (s as EvolveSuggestion).title === "string" &&
            kinds.has((s as EvolveSuggestion).kind),
        )
        .slice(0, 3)
    : [];
  return { ok: true, suggestions };
}

/**
 * Guard: a proposal may only write instructions.md or files under the
 * tools/skills/schedules capability dirs — never agent.ts, .env, or package.json.
 */
function assertWritable(agentPath: string, relPath: string): void {
  const abs = resolve(agentPath, relPath);
  const rootAbs = resolve(agentPath);
  if (abs !== rootAbs && !abs.startsWith(rootAbs + sep)) {
    throw new Error(`Refusing to write outside the agent: ${relPath}`);
  }
  const fromRoot = abs.slice(resolve(agentRoot(agentPath)).length + 1);
  const seg = fromRoot.split(sep)[0];
  const ok =
    fromRoot === "instructions.md" ||
    seg === "skills" ||
    seg === "tools" ||
    seg === "schedules";
  if (!ok) {
    throw new Error(`Refusing to write a protected path: ${relPath}`);
  }
  // Authoring instructions.md next to an instructions.ts (or instructions/ dir)
  // is an eve build error — refuse rather than break the agent's build.
  if (fromRoot === "instructions.md") {
    const other = alternateInstructionsForm(agentPath);
    if (other) {
      throw new Error(
        `This agent's prompt lives in ${other}, which Studio can't edit — adding instructions.md alongside it would break the build. Edit ${other} by hand.`,
      );
    }
  }
}

/** Best-effort: commit the written files so the change has a revert point. */
function commit(agentPath: string, paths: string[], title: string): boolean {
  const inRepo = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: agentPath,
    encoding: "utf8",
  });
  if (inRepo.status !== 0 || inRepo.stdout.trim() !== "true") {
    return false;
  }
  const add = spawnSync("git", ["add", "--", ...paths], {
    cwd: agentPath,
    encoding: "utf8",
  });
  if (add.status !== 0) {
    return false;
  }
  const msg = `studio: ${title}`;
  const done = spawnSync(
    "git",
    ["commit", "--no-verify", "-m", msg, "--", ...paths],
    { cwd: agentPath, encoding: "utf8" },
  );
  return done.status === 0;
}

/** A resolved Arcana brain credential for memory writes. */
export interface BrainCred {
  workspace: string;
  key: string;
}

/** Apply an approved proposal: write the files (or remember the fact), then commit. */
export async function applyProposal(
  agentPath: string,
  proposal: EvolveProposal,
  brain?: BrainCred | null,
): Promise<EvolveApplyResult> {
  if (proposal.kind === "memory") {
    const text = proposal.memory?.trim();
    if (!text) {
      return {
        ok: false,
        written: [],
        committed: false,
        needsRebuild: false,
        error: "No fact to remember.",
      };
    }
    if (!brain) {
      return {
        ok: true,
        written: [],
        committed: false,
        needsRebuild: false,
        note: "This is a fact for the agent's memory, but no brain is configured. Set one up in the Memory tab, then try again.",
      };
    }
    const r = await arcanaRemember(brain.workspace, brain.key, text);
    return {
      ok: r.ok,
      written: [],
      committed: false,
      needsRebuild: false,
      note: r.ok
        ? `Remembered — added to the “${brain.workspace}” brain.`
        : undefined,
      error: r.ok ? undefined : r.error,
    };
  }
  const written: string[] = [];
  try {
    for (const f of proposal.files) {
      assertWritable(agentPath, f.relPath);
      const abs = resolve(agentPath, f.relPath);
      const fromRoot = abs.slice(resolve(agentRoot(agentPath)).length + 1);
      if (fromRoot === "instructions.md") {
        writeInstructions(agentPath, f.after);
      } else {
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, f.after);
      }
      written.push(f.relPath);
    }
  } catch (e) {
    return {
      ok: false,
      written,
      committed: false,
      needsRebuild: proposal.needsRebuild,
      error: (e as Error).message,
    };
  }
  const committed = commit(agentPath, written, proposal.title);
  return {
    ok: true,
    written,
    committed,
    needsRebuild: proposal.needsRebuild,
  };
}

// ---------------- agent-initiated proposals (opt-in tool) ----------------

/** The Studio-managed tool the agent calls to propose a change to itself. */
export const PROPOSE_TOOL = "propose_change";

function proposeToolFile(agentPath: string): string {
  return join(agentRoot(agentPath), "tools", `${PROPOSE_TOOL}.ts`);
}

/** Brain note that backs a single queued proposal (Arcana backend). */
const PROPOSAL_NOTE_PREFIX = "eve-studio-proposal-";

/** Blob pathname prefix that backs queued proposals (default backend). */
const PROPOSAL_BLOB_PREFIX = "eve-studio-proposals/";

/** Shared by both backends' generated sources, so they can't drift apart. */
const PROPOSE_TOOL_DESCRIPTION =
  "Propose a change to yourself — a new skill, tool, or schedule, an edit to your instructions, or a fact to remember — when the user asks you to change how you work or what you know. You cannot edit your own files; the operator approves a diff in Eve Studio. Call this instead of claiming you already changed yourself.";

const PROPOSE_TOOL_DOC = `/**
 * propose_change — let the agent ask to change itself. Managed by Eve Studio.
 *
 * @remarks
 * The agent cannot edit its own files. When the user asks it to change how it
 * works or what it knows, it calls this tool; the proposal is queued for the
 * operator to approve in Eve Studio. Do not hand-edit — toggle it from Studio's
 * Evolve tab.
 */`;

/**
 * Make sure the agent can compile a Blob-backed propose_change tool.
 *
 * @remarks
 * Best-effort: adds `@vercel/blob` to the agent's dependencies and installs it
 * when absent. Without this the generated tool's import fails to build in an
 * agent that has never used Blob.
 */
function ensureBlobDependency(agentPath: string): void {
  const pkgPath = join(agentPath, "package.json");
  if (!existsSync(pkgPath)) {
    return;
  }
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    if (
      pkg.dependencies?.["@vercel/blob"] ||
      pkg.devDependencies?.["@vercel/blob"]
    ) {
      return;
    }
    const pm = existsSync(join(agentPath, "pnpm-lock.yaml"))
      ? "pnpm"
      : existsSync(join(agentPath, "yarn.lock"))
        ? "yarn"
        : "npm";
    spawnSync(pm, ["add", "@vercel/blob"], {
      cwd: agentPath,
      encoding: "utf8",
      timeout: 120_000,
      env: { ...process.env, NO_COLOR: "1" },
    });
  } catch {
    // leave the agent's manifest alone if it isn't parseable
  }
}

/**
 * Generate the propose_change tool. When the agent has an Arcana brain, the
 * tool queues each proposal into a brain note so Studio can pick it up even
 * when the agent runs deployed (Slack, prod) with Studio not watching.
 */
function proposeToolSource(workspace: string, keyEnv: string): string {
  return `import { defineTool } from "eve/tools";
import { z } from "zod";

const ARCANA_WORKSPACE = ${JSON.stringify(workspace)};
const ARCANA_KEY_ENV = ${JSON.stringify(keyEnv)};
const ARCANA_MCP = "https://mcp.arcana.kybernesis.ai/mcp";

interface Proposal {
  id: string;
  intent: string;
  kind: string;
  status: string;
  title: string;
  ts: string;
}

/** Queue a proposal into an Arcana brain note for Eve Studio to review. */
async function queueProposal(proposal: Proposal): Promise<boolean> {
  const key = ARCANA_KEY_ENV ? process.env[ARCANA_KEY_ENV] : undefined;
  if (!(key && ARCANA_WORKSPACE)) {
    return false;
  }
  const headers: Record<string, string> = {
    Authorization: \`Bearer \${key}\`,
    "X-Kyberagent-Agent": ARCANA_WORKSPACE,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  const rpc = (
    body: unknown,
    extra?: Record<string, string>
  ): Promise<Response> =>
    fetch(ARCANA_MCP, {
      method: "POST",
      headers: { ...headers, ...(extra ?? {}) },
      body: JSON.stringify(body),
    });
  const init = await rpc({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "eve", version: "1" },
    },
  });
  if (!init.ok) {
    return false;
  }
  const sid = init.headers.get("mcp-session-id");
  await init.text();
  const session = sid ? { "Mcp-Session-Id": sid } : undefined;
  await rpc({ jsonrpc: "2.0", method: "notifications/initialized" }, session);
  const res = await rpc(
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "arcana_brain_write",
        arguments: {
          name: \`${PROPOSAL_NOTE_PREFIX}\${proposal.id}.md\`,
          content: JSON.stringify(proposal),
        },
      },
    },
    session
  );
  return res.ok;
}

${PROPOSE_TOOL_DOC}
export default defineTool({
  description:
    ${JSON.stringify(PROPOSE_TOOL_DESCRIPTION)},
  inputSchema: z.object({
    kind: z
      .enum(["skill", "tool", "schedule", "instructions", "memory"])
      .describe("What kind of change this is."),
    title: z.string().describe("A short label for the change."),
    intent: z
      .string()
      .describe(
        "A concrete, first-person instruction describing exactly what to create or change, phrased as the user would ask for it."
      ),
  }),
  async execute({ kind, title, intent }) {
    const proposal: Proposal = {
      id: String(Date.now()),
      kind,
      title,
      intent,
      ts: new Date().toISOString(),
      status: "pending",
    };
    const queued = await queueProposal(proposal).catch(() => false);
    return queued
      ? {
          status: "queued",
          message: \`Proposed "\${title}" — approve it in Eve Studio's Proposals inbox.\`,
        }
      : {
          status: "failed",
          message: \`I could not queue "\${title}" — nothing is waiting for approval. Ask the operator to make this change in Eve Studio directly.\`,
        };
  },
});
`;
}

/**
 * Generate the propose_change tool backed by Vercel Blob — the default when the
 * agent has no Arcana brain.
 *
 * @remarks
 * The write needs no credential in code: on Vercel, `put` resolves the ambient
 * OIDC token, the same way the agent's other Blob tools already work. Studio
 * reads these back with a `BLOB_READ_WRITE_TOKEN`, since it runs outside Vercel
 * and OIDC is not accepted there. Proposals are private blobs — an intent string
 * is not something to publish at a guessable URL.
 */
function proposeToolBlobSource(): string {
  return `import { put } from "@vercel/blob";
import { defineTool } from "eve/tools";
import { z } from "zod";

const PROPOSAL_PREFIX = ${JSON.stringify(PROPOSAL_BLOB_PREFIX)};

interface Proposal {
  id: string;
  intent: string;
  kind: string;
  status: string;
  title: string;
  ts: string;
}

/** Queue a proposal as a private blob for Eve Studio to review. */
async function queueProposal(proposal: Proposal): Promise<boolean> {
  const blob = await put(
    \`\${PROPOSAL_PREFIX}\${proposal.id}.json\`,
    JSON.stringify(proposal),
    {
      access: "private",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
    }
  );
  return Boolean(blob.url);
}

${PROPOSE_TOOL_DOC}
export default defineTool({
  description:
    ${JSON.stringify(PROPOSE_TOOL_DESCRIPTION)},
  inputSchema: z.object({
    kind: z
      .enum(["skill", "tool", "schedule", "instructions", "memory"])
      .describe("What kind of change this is."),
    title: z.string().describe("A short label for the change."),
    intent: z
      .string()
      .describe(
        "A concrete, first-person instruction describing exactly what to create or change, phrased as the user would ask for it."
      ),
  }),
  async execute({ kind, title, intent }) {
    const proposal: Proposal = {
      id: String(Date.now()),
      kind,
      title,
      intent,
      ts: new Date().toISOString(),
      status: "pending",
    };
    const queued = await queueProposal(proposal).catch(() => false);
    return queued
      ? {
          status: "queued",
          message: \`Proposed "\${title}" — approve it in Eve Studio's Proposals inbox.\`,
        }
      : {
          status: "failed",
          message: \`I could not queue "\${title}" — nothing is waiting for approval. Ask the operator to make this change in Eve Studio directly.\`,
        };
  },
});
`;
}

/** Whether the opt-in propose_change tool is installed in the agent. */
export function getProposeTool(agentPath: string): boolean {
  return existsSync(proposeToolFile(agentPath));
}

/**
 * Install or remove the opt-in propose_change tool.
 *
 * @remarks
 * The queue backend is baked in at authoring time: an Arcana brain when the
 * agent has one, else Vercel Blob. Blob is the default because every eve agent
 * deploys to Vercel, so the loop works with no third-party account.
 */
export function setProposeTool(
  agentPath: string,
  enabled: boolean,
): { enabled: boolean; backend?: "arcana" | "blob" } {
  const file = proposeToolFile(agentPath);
  if (!enabled) {
    if (existsSync(file)) {
      rmSync(file);
    }
    return { enabled: getProposeTool(agentPath) };
  }
  const brain = brainFromConnection(agentPath);
  const useArcana = Boolean(brain.workspace && brain.envVar);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    useArcana
      ? proposeToolSource(brain.workspace ?? "", brain.envVar ?? "")
      : proposeToolBlobSource(),
  );
  if (!useArcana) {
    ensureBlobDependency(agentPath);
  }
  return {
    enabled: getProposeTool(agentPath),
    backend: useArcana ? "arcana" : "blob",
  };
}

/**
 * Where an agent's queued proposals live.
 *
 * @remarks
 * Blob is the default and needs no third-party account; Arcana is used when the
 * agent already has a brain wired, so existing setups keep working.
 */
export type ProposalQueue =
  { kind: "arcana"; brain: BrainCred } | { kind: "blob"; token: string };

/** Shape a stored proposal into an inbox row, or null if it isn't pending. */
function toQueuedProposal(raw: string, note: string): QueuedProposal | null {
  try {
    const p = JSON.parse(raw) as Partial<QueuedProposal> & { status?: string };
    if (p.status !== "pending" || !(p.intent && p.kind)) {
      return null;
    }
    return {
      id: String(p.id ?? note),
      kind: p.kind,
      title: p.title ?? "Proposed change",
      intent: p.intent,
      ts: p.ts ?? "",
      note,
    };
  } catch {
    return null;
  }
}

async function listFromArcana(brain: BrainCred): Promise<QueuedProposal[]> {
  const list = await arcanaBrainList(brain.workspace, brain.key);
  if (!(list.ok && list.data)) {
    return [];
  }
  const out: QueuedProposal[] = [];
  for (const note of list.data.filter((n) =>
    n.startsWith(PROPOSAL_NOTE_PREFIX),
  )) {
    const rd = await arcanaBrainRead(brain.workspace, brain.key, note);
    if (rd.ok && rd.data) {
      const p = toQueuedProposal(rd.data, note);
      if (p) {
        out.push(p);
      }
    }
  }
  return out;
}

async function listFromBlob(token: string): Promise<QueuedProposal[]> {
  const res = await blobList({ prefix: PROPOSAL_BLOB_PREFIX, token });
  const out: QueuedProposal[] = [];
  for (const b of res.blobs) {
    // Proposals are private blobs, so the content needs the token too.
    const r = await fetch(b.url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) {
      continue;
    }
    const p = toQueuedProposal(await r.text(), b.url);
    if (p) {
      out.push(p);
    }
  }
  return out;
}

/** Read pending proposals the agent queued while deployed (e.g. from Slack). */
export async function listQueuedProposals(
  queue: ProposalQueue,
): Promise<QueuedProposal[]> {
  const out =
    queue.kind === "arcana"
      ? await listFromArcana(queue.brain)
      : await listFromBlob(queue.token);
  out.sort((a, b) => (a.ts < b.ts ? 1 : -1));
  return out;
}

/** Resolve a queued proposal so it stops showing in the inbox. */
export async function resolveQueuedProposal(
  queue: ProposalQueue,
  note: string,
): Promise<void> {
  if (queue.kind === "blob") {
    // Nothing to preserve once it's applied or turned down — drop the blob.
    await blobDel(note, { token: queue.token }).catch(() => undefined);
    return;
  }
  const { brain } = queue;
  const rd = await arcanaBrainRead(brain.workspace, brain.key, note);
  if (!(rd.ok && rd.data)) {
    return;
  }
  try {
    const p = JSON.parse(rd.data) as Record<string, unknown>;
    p.status = "resolved";
    await arcanaBrainWrite(brain.workspace, brain.key, note, JSON.stringify(p));
  } catch {
    // leave it as-is if unparseable
  }
}
