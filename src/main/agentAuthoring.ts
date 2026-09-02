import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  EnvState,
  ModelConfig,
  SandboxInfo,
  ScheduleInput,
  SubagentInput,
  ToolInput,
} from "../shared/ipc";

export function agentRoot(agentPath: string): string {
  return existsSync(join(agentPath, "agent"))
    ? join(agentPath, "agent")
    : agentPath;
}
export function nested(agentPath: string): string {
  return existsSync(join(agentPath, "agent")) ? "agent/" : "";
}
const SLUG = /[^a-z0-9-]/g;
function slugify(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, "-").replace(SLUG, "");
}
function snake(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

// ---------------- model / agent.ts ----------------
/** eve 0.49's default root-agent model when `agent.ts` doesn't set one. */
export const DEFAULT_MODEL = "openai/gpt-5.6-luna-fast";

function agentTsPath(agentPath: string): string {
  return join(agentRoot(agentPath), "agent.ts");
}

/** Parse the model + reasoning from agent.ts (string-model form only). */
export function readModelConfig(agentPath: string): ModelConfig {
  const path = agentTsPath(agentPath);
  if (!existsSync(path)) {
    return {
      model: DEFAULT_MODEL,
      reasoning: null,
      editable: false,
      note: `No agent.ts — Eve defaults the model to ${DEFAULT_MODEL}. Create agent.ts (or run \`eve init\`) to set it.`,
    };
  }
  const src = readFileSync(path, "utf8");
  const model = /\bmodel:\s*(["'])([^"']+)\1/.exec(src)?.[2] ?? null;
  const reasoning = /\breasoning:\s*(["'])([^"']+)\1/.exec(src)?.[2] ?? null;
  return {
    model,
    reasoning,
    // Editable only when model is a simple string literal (not defineDynamic/direct provider).
    editable: model !== null,
    note: model
      ? null
      : "The model isn't a plain gateway string (dynamic or direct-provider) — edit agent.ts by hand.",
  };
}

/** Rewrite the model (and optional reasoning) in agent.ts. */
export function writeModelConfig(
  agentPath: string,
  model: string,
  reasoning: string | null,
): void {
  const path = agentTsPath(agentPath);
  let src = readFileSync(path, "utf8");
  if (!/\bmodel:\s*(["'])[^"']+\1/.test(src)) {
    throw new Error("Could not locate a string model in agent.ts.");
  }
  src = src.replace(/(\bmodel:\s*)(["'])[^"']*\2/, `$1"${model}"`);

  const hasReasoning = /\breasoning:\s*(["'])[^"']*\1/.test(src);
  if (reasoning && reasoning !== "provider-default") {
    if (hasReasoning) {
      src = src.replace(/(\breasoning:\s*)(["'])[^"']*\2/, `$1"${reasoning}"`);
    } else {
      src = src.replace(
        /(\bmodel:\s*(["'])[^"']*\2,?)/,
        `$1\n  reasoning: "${reasoning}",`,
      );
    }
  } else if (hasReasoning) {
    src = src.replace(/\n?\s*reasoning:\s*(["'])[^"']*\1,?/, "");
  }
  writeFileSync(path, src);
}

// ---------------- env ----------------
/** Read .env and .env.local from the project root. */
export function readEnv(agentPath: string): EnvState {
  const files = [".env", ".env.local"].map((name) => {
    const p = join(agentPath, name);
    const exists = existsSync(p);
    return { name, exists, content: exists ? readFileSync(p, "utf8") : "" };
  });
  return { files };
}

/** Write one env file (.env or .env.local) at the project root. */
export function writeEnv(
  agentPath: string,
  name: string,
  content: string,
): void {
  if (name !== ".env" && name !== ".env.local") {
    throw new Error("Only .env and .env.local can be edited.");
  }
  writeFileSync(join(agentPath, name), content);
}

// ---------------- tool ----------------
export function createTool(
  agentPath: string,
  input: ToolInput,
): { relPath: string } {
  const name = snake(input.name);
  if (!name) {
    throw new Error("Invalid tool name.");
  }
  const dir = join(agentRoot(agentPath), "tools");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}.ts`);
  if (existsSync(file)) {
    throw new Error(`tools/${name}.ts already exists.`);
  }
  const gated = input.approval && input.approval !== "never";
  const src = `import { defineTool } from "eve/tools";${
    gated ? `\nimport { ${input.approval} } from "eve/tools/approval";` : ""
  }
import { z } from "zod";

/**
 * ${input.description}
 */
export default defineTool({
  description: ${JSON.stringify(input.description)},
  inputSchema: z.object({}),${gated ? `\n  approval: ${input.approval}(),` : ""}
  // biome-ignore lint/suspicious/useAwait: scaffold — add real async work
  async execute(input) {
    return {};
  },
});
`;
  writeFileSync(file, src);
  return { relPath: `${nested(agentPath)}tools/${name}.ts` };
}

// ---------------- subagent ----------------
export function createSubagent(
  agentPath: string,
  input: SubagentInput,
): { relPath: string } {
  const name = slugify(input.name);
  if (!name) {
    throw new Error("Invalid subagent name.");
  }
  const dir = join(agentRoot(agentPath), "subagents", name);
  if (existsSync(join(dir, "agent.ts"))) {
    throw new Error(`subagents/${name} already exists.`);
  }
  mkdirSync(dir, { recursive: true });
  const model = input.model || "anthropic/claude-opus-4.8";
  writeFileSync(
    join(dir, "agent.ts"),
    `import { defineAgent } from "eve";

/**
 * ${input.description}
 */
export default defineAgent({
  description: ${JSON.stringify(input.description)},
  model: "${model}",
});
`,
  );
  writeFileSync(
    join(dir, "instructions.md"),
    `# ${input.name}\n\n${input.instructions || "Describe how this specialist should work. The parent hands you everything you need in the delegation message."}\n`,
  );
  return { relPath: `${nested(agentPath)}subagents/${name}/agent.ts` };
}

// ---------------- hook ----------------
export function createHook(
  agentPath: string,
  name: string,
): { relPath: string } {
  const slug = slugify(name);
  if (!slug) {
    throw new Error("Invalid hook name.");
  }
  const dir = join(agentRoot(agentPath), "hooks");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${slug}.ts`);
  if (existsSync(file)) {
    throw new Error(`hooks/${slug}.ts already exists.`);
  }
  writeFileSync(
    file,
    `import { defineHook } from "eve/hooks";

/**
 * ${slug} — observe-only side effects on the session event stream.
 */
export default defineHook({
  events: {
    // biome-ignore lint/suspicious/useAwait: scaffold
    async "session.started"(_event, ctx) {
      console.info("session started", { sessionId: ctx.session.id });
    },
    // "*"(event) { /* catch-all */ },
  },
});
`,
  );
  return { relPath: `${nested(agentPath)}hooks/${slug}.ts` };
}

// ---------------- schedule ----------------
export function createSchedule(
  agentPath: string,
  input: ScheduleInput,
): { relPath: string } {
  const slug = slugify(input.name);
  if (!slug) {
    throw new Error("Invalid schedule name.");
  }
  const dir = join(agentRoot(agentPath), "schedules");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${slug}.ts`);
  if (existsSync(file)) {
    throw new Error(`schedules/${slug}.ts already exists.`);
  }
  writeFileSync(
    file,
    `import { defineSchedule } from "eve/schedules";

/**
 * ${slug} — cron is a 5-field spec evaluated in UTC on Vercel.
 */
export default defineSchedule({
  cron: ${JSON.stringify(input.cron)},
  markdown: ${JSON.stringify(input.prompt)},
});
`,
  );
  return { relPath: `${nested(agentPath)}schedules/${slug}.ts` };
}

// ---------------- sandbox ----------------
export function readSandbox(agentPath: string): SandboxInfo {
  const candidates = [
    join(agentRoot(agentPath), "sandbox.ts"),
    join(agentRoot(agentPath), "sandbox", "sandbox.ts"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      const rel = p.slice(agentPath.length + 1);
      return { exists: true, relPath: rel, content: readFileSync(p, "utf8") };
    }
  }
  return { exists: false, relPath: null, content: "" };
}

/** Create a default sandbox.ts using the Vercel backend. */
export function createSandbox(agentPath: string): { relPath: string } {
  const dir = agentRoot(agentPath);
  const file = join(dir, "sandbox.ts");
  if (existsSync(file)) {
    throw new Error("sandbox.ts already exists.");
  }
  writeFileSync(
    file,
    `import { defineSandbox } from "eve/sandbox";
import { vercel } from "eve/sandbox/vercel";

export default defineSandbox({
  backend: vercel(),
  description: "Default build sandbox",
});
`,
  );
  return { relPath: `${nested(agentPath)}sandbox.ts` };
}
