import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { ChannelAddInput, ChannelKind } from "../shared/ipc";

/**
 * The Vercel Connect UID each channel file references, so the UI can show which
 * bot a channel is wired to (e.g. `slack/eve-health`) instead of just "added".
 */
export function channelConnectors(
  agentPath: string,
): { name: string; connector: string | null }[] {
  const dir = join(agentRoot(agentPath), "channels");
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
  } catch {
    return [];
  }
  const re =
    /connect\w*Credentials\(\s*(?:process\.env\.\w+\s*\?\?\s*)?["']([^"']+)["']/;
  return files.map((f) => {
    let connector: string | null = null;
    try {
      connector = re.exec(readFileSync(join(dir, f), "utf8"))?.[1] ?? null;
    } catch {
      // unreadable — leave connector null
    }
    return { name: f.slice(0, -3), connector };
  });
}

function agentRoot(agentPath: string): string {
  return existsSync(join(agentPath, "agent"))
    ? join(agentPath, "agent")
    : agentPath;
}
function nested(agentPath: string): string {
  return existsSync(join(agentPath, "agent")) ? "agent/" : "";
}

/** Vercel-Connect-backed platform channels (no secrets to manage). */
const CONNECT: Record<
  string,
  {
    factory: string;
    mod: string;
    cred: string;
    service: string;
    /** Emit a `botName` arg (derived from the connector uid) — GitHub gates
     * mention-driven turns on it, so the scaffold must set it. */
    botName?: boolean;
  }
> = {
  slack: {
    factory: "slackChannel",
    mod: "eve/channels/slack",
    cred: "connectSlackCredentials",
    service: "slack",
  },
  github: {
    factory: "githubChannel",
    mod: "eve/channels/github",
    cred: "connectGitHubCredentials",
    service: "github",
    botName: true,
  },
  linear: {
    factory: "linearChannel",
    mod: "eve/channels/linear",
    cred: "connectLinearCredentials",
    service: "linear",
  },
};

/** Env-var-backed platform channels. */
const ENVCH: Record<
  string,
  {
    factory: string;
    mod: string;
    body: string;
    env: string[];
    /** Extra guidance emitted as a comment in the scaffold, for knobs the user
     * must hand-edit before the channel does anything (e.g. an allow-list). */
    note?: string;
  }
> = {
  discord: {
    factory: "discordChannel",
    mod: "eve/channels/discord",
    body: "discordChannel()",
    env: ["DISCORD_PUBLIC_KEY", "DISCORD_APPLICATION_ID", "DISCORD_BOT_TOKEN"],
  },
  teams: {
    factory: "teamsChannel",
    mod: "eve/channels/teams",
    body: "teamsChannel()",
    env: ["MICROSOFT_APP_ID", "MICROSOFT_APP_PASSWORD"],
    note: "Single-tenant bots also need MICROSOFT_TENANT_ID.",
  },
  telegram: {
    factory: "telegramChannel",
    mod: "eve/channels/telegram",
    body: 'telegramChannel({ botUsername: "my_bot" })',
    env: ["TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET_TOKEN"],
    note: "Replace botUsername with your bot's @handle (no @) — group @mentions only wake the bot when it matches.",
  },
  twilio: {
    factory: "twilioChannel",
    mod: "eve/channels/twilio",
    body: "twilioChannel({ allowFrom: [] })",
    env: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"],
    note: 'allowFrom is required and starts empty (allows nobody) — add the numbers that may reach the agent, e.g. ["+15551234567"].',
  },
};

/** Which channels use a Vercel Connect connector (and their service name). */
export function connectService(kind: ChannelKind): string | null {
  return CONNECT[kind]?.service ?? null;
}

/** Metadata used by the renderer gallery. */
export const CHANNEL_CATALOG = { CONNECT, ENVCH };

/** Write `channels/<kind>.ts` for the given kind. */
export function writeChannel(
  agentPath: string,
  input: ChannelAddInput,
): { relPath: string; envVars?: string[]; connect?: boolean } {
  const dir = join(agentRoot(agentPath), "channels");
  mkdirSync(dir, { recursive: true });

  if (input.kind === "custom") {
    const slug = (input.name ?? "intake")
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "");
    const file = join(dir, `${slug || "intake"}.ts`);
    if (existsSync(file)) {
      throw new Error(`channels/${slug}.ts already exists.`);
    }
    const name = slug || "intake";
    writeFileSync(
      file,
      `import { defineChannel, GET, POST } from "eve/channels";

/**
 * ${name} — custom HTTP channel. Added by Eve Studio.
 *
 * Routes mount at the app root (the file name is not a prefix). Each
 * conversation is a channel-local address — here the \`threadId\` path param —
 * and \`from(address)\` starts or continues the session bound to it. Docs:
 * https://eve.dev/docs/channels/custom
 */
export default defineChannel({
  routes: [
    POST("/${name}/threads/:threadId/messages", async (request, { from, params }) => {
      const body = (await request.json()) as { message: string };
      const session = await from(params.threadId).send(body.message, {
        auth: null,
      });
      return Response.json({ sessionId: session.id });
    }),
    POST("/${name}/threads/:threadId/cancel", async (_request, { from, params }) =>
      Response.json(await from(params.threadId).cancel()),
    ),
    GET(
      "/${name}/sessions/:sessionId/stream",
      async (_request, { attachSession, params }) => {
        const stream = await attachSession(params.sessionId).getEventStream();
        return new Response(stream, {
          headers: { "content-type": "application/x-ndjson; charset=utf-8" },
        });
      },
    ),
  ],
  events: {
    "message.completed"(eventData, _channel, ctx) {
      // Deliver the reply back to your surface.
      console.info("[${name}] reply", {
        sessionId: ctx.session.id,
        message: eventData.message,
      });
    },
  },
});
`,
    );
    return { relPath: `${nested(agentPath)}channels/${slug || "intake"}.ts` };
  }

  const file = join(dir, `${input.kind}.ts`);
  if (existsSync(file) && !input.overwrite) {
    throw new Error(`channels/${input.kind}.ts already exists.`);
  }

  if (input.kind === "buzz") {
    writeFileSync(file, BUZZ_TEMPLATE);
    return {
      relPath: `${nested(agentPath)}channels/buzz.ts`,
      envVars: [
        "BUZZ_RELAY_URL",
        "BUZZ_PRIVATE_KEY",
        "BUZZ_WEBHOOK_SECRET",
        "BUZZ_AGENT_NAME",
      ],
    };
  }

  const c = CONNECT[input.kind];
  if (c) {
    const uid = input.connector ?? `${c.service}/my-agent`;
    const botName = c.botName
      ? `  botName: ${JSON.stringify(uid.split("/")[1] ?? "my-agent")},\n`
      : "";
    writeFileSync(
      file,
      `import { ${c.cred} } from "@vercel/connect/eve";
import { ${c.factory} } from "${c.mod}";

/**
 * ${c.factory} — credentials brokered by Vercel Connect (no secrets to manage).
 * Added by Eve Studio.
 */
export default ${c.factory}({
${botName}  credentials: ${c.cred}(${JSON.stringify(uid)}),
});
`,
    );
    return {
      relPath: `${nested(agentPath)}channels/${input.kind}.ts`,
      connect: true,
    };
  }

  const e = ENVCH[input.kind];
  if (e) {
    const note = e.note ? `\n * ${e.note}` : "";
    // Telegram bakes the verified @handle into the factory so group @mentions
    // wake the right bot; Twilio bakes the allow-list + outbound number so it
    // gates inbound and can reply/originate SMS. Other env channels use e.body.
    let body = e.body;
    if (input.kind === "telegram" && input.botUsername) {
      body = `telegramChannel({ botUsername: ${JSON.stringify(input.botUsername)} })`;
    } else if (input.kind === "twilio") {
      const allow = (input.twilioAllowFrom ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const from = input.twilioFrom?.trim();
      const opts: string[] = [`allowFrom: ${JSON.stringify(allow)}`];
      if (from) {
        opts.push(`messaging: { from: ${JSON.stringify(from)} }`);
      }
      body = `twilioChannel({ ${opts.join(", ")} })`;
    }
    writeFileSync(
      file,
      `import { ${e.factory} } from "${e.mod}";

/**
 * ${e.factory} — reads credentials from env (${e.env.join(", ")}). Added by Eve Studio.${note}
 */
export default ${body};
`,
    );
    return {
      relPath: `${nested(agentPath)}channels/${input.kind}.ts`,
      envVars: e.env,
    };
  }

  throw new Error(`Unknown channel kind: ${input.kind}`);
}

/**
 * Buzz (github.com/block/buzz) channel scaffold. Buzz is a NIP-29 Nostr relay:
 * outbound messages are signed kind:9 events submitted over REST with NIP-98
 * auth; inbound arrives on POST /inbound (delivered by a relay-side workflow on
 * relays that support push, or by Studio's local bridge on hosted relays that
 * don't). Requires the `nostr-tools` package in the agent. Uses eve 0.49's
 * custom channel API (`from(address).send`, `receive(input, { from })`).
 */
const BUZZ_TEMPLATE = `import { createHash } from "node:crypto";
import { defineChannel, POST } from "eve/channels";
import { finalizeEvent } from "nostr-tools/pure";

/**
 * buzz — two-way channel for a Buzz (block/buzz) workspace. Added by Eve Studio.
 *
 * Env: BUZZ_RELAY_URL, BUZZ_PRIVATE_KEY (agent's Nostr key, hex),
 *      BUZZ_WEBHOOK_SECRET (gates /inbound), BUZZ_AGENT_NAME (mention strip).
 */

interface BuzzTarget {
  /** Buzz channel UUID (DM conversations are hidden channels — same shape). */
  channelId: string;
}

/** Durable adapter state: where the reply for the current session goes. */
interface BuzzState {
  targetChannelId: string | null;
}

const buzzChannel = defineChannel<BuzzState, { state: BuzzState }, BuzzTarget>({
  state: { targetChannelId: null },

  context(state) {
    return { state };
  },

  routes: [
    POST<BuzzState>("/inbound", async (req, { from, waitUntil }) => {
      const secret = process.env.BUZZ_WEBHOOK_SECRET;
      if (!secret || req.headers.get("x-buzz-secret") !== secret) {
        return new Response("unauthorized", { status: 401 });
      }
      const body = (await req.json()) as {
        text?: string;
        author?: string;
        channelId?: string;
        messageId?: string;
      };
      const channelId = (body.channelId || "").trim();
      const author = (body.author || "").trim();
      const name = process.env.BUZZ_AGENT_NAME || "";
      const mention = name
        ? new RegExp("@\\\\s*" + name.replace(/[.*+?^\${}()|[\\]\\\\]/g, "\\\\$&"), "gi")
        : null;
      let text = (body.text || "").replace(/nostr:npub1[a-z0-9]+/gi, "");
      if (mention) {
        text = text.replace(mention, "");
      }
      text = text.trim();
      if (!channelId || !text) {
        return new Response("ignored", { status: 200 });
      }
      // One session per Buzz channel: the channel id is the continuation
      // address, so follow-ups in the same channel land in the same session.
      waitUntil(
        from(channelId).send(text, {
          auth: {
            authenticator: "buzz",
            principalType: "user",
            principalId: author || "unknown",
            attributes: { channelId, messageId: body.messageId ?? "" },
          },
          state: { targetChannelId: channelId },
        }),
      );
      return Response.json({ ok: true });
    }),
  ],

  /** Cross-channel hand-off: \`to(buzz, { channelId }).send(...)\` from a schedule or route. */
  async receive(input, { from }) {
    return from(input.target.channelId).send(input.message, {
      auth: input.auth,
      state: { targetChannelId: input.target.channelId },
    });
  },

  events: {
    async "message.completed"(event, channel) {
      if (event.finishReason === "tool-calls") {
        return;
      }
      const text = (event.message ?? "").trim();
      const channelId = channel.state.targetChannelId;
      if (!text || !channelId) {
        return;
      }
      await postToBuzz(channelId, text);
    },
  },
});

export default buzzChannel;

/** Publish text as a kind:9 message (NIP-29) via the relay's REST /events. */
async function postToBuzz(channelId: string, text: string): Promise<void> {
  const relay = (process.env.BUZZ_RELAY_URL || "")
    .replace(/^ws/, "http")
    .replace(/\\/+$/, "");
  const keyHex = process.env.BUZZ_PRIVATE_KEY || "";
  if (!relay || !keyHex) {
    console.warn("[buzz] BUZZ_RELAY_URL / BUZZ_PRIVATE_KEY not set — skipping");
    return;
  }
  const sk = Uint8Array.from(keyHex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
  const message = finalizeEvent(
    {
      kind: 9,
      created_at: Math.floor(Date.now() / 1000),
      tags: [["h", channelId]],
      content: text,
    },
    sk,
  );
  const url = \`\${relay}/events\`;
  const body = JSON.stringify(message);
  const auth = finalizeEvent(
    {
      kind: 27235,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["u", url],
        ["method", "POST"],
        ["nonce", crypto.randomUUID()],
        ["payload", createHash("sha256").update(body).digest("hex")],
      ],
      content: "",
    },
    sk,
  );
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: \`Nostr \${Buffer.from(JSON.stringify(auth)).toString("base64")}\`,
      "Content-Type": "application/json",
    },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(\`[buzz] relay rejected message: HTTP \${res.status}\`);
  }
}
`;

/**
 * Delete a channel by removing its `channels/<name>.ts` file.
 *
 * @remarks
 * `name` must be a simple slug (no path separators) so it can never escape the
 * channels directory. Deployed events routed to a removed channel simply stop.
 */
export function deleteChannelFile(agentPath: string, name: string): void {
  if (!/^[a-z0-9-]+$/i.test(name)) {
    throw new Error("Invalid channel name.");
  }
  const file = join(agentRoot(agentPath), "channels", `${name}.ts`);
  if (existsSync(file)) {
    rmSync(file);
  }
}
