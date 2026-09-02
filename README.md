# Eve Studio

**A desktop control center for [Eve](https://eve.dev) agents.** Run, chat with, build, wire up, and deploy every Eve agent on your machine from one native app, without living in a terminal.

Eve Studio is an Electron app that discovers the Eve agents on your disk and gives each one a full workspace: a chat console (local **and** deployed) with session controls, a prompt and model editor, first-class editing for every capability (tools, skills, subagents, hooks, schedules), integrations from the official eve registry plus guided wizards, long-term memory, one-click Vercel deploys, and evals.

> **Eve Studio is an independent open-source project by [Kybernesis](https://kybernesis.ai). It is not an official Vercel product.** Eve is Vercel's open-source agent framework; "Eve" and "Vercel" are Vercel's.

![Eve Studio](docs/screenshot.png)

**→ [evestudio.dev](https://evestudio.dev)** · signed & notarized macOS builds with an in-app auto-updater.

> Status: `v0.3.x`, macOS-first. Built for **eve 0.49+**.

---

## What it does

Point it at a folder that contains an Eve agent (or create a new one in-app) and you get, per agent:

- **Chat**: a conversation console that streams the agent's turns, tool calls, subagent delegations, reasoning, approval prompts, compaction events, and cancellations or failures. Talk to the **local dev server** or your **deployed production** agent from the same window. Session controls in the composer: **Cancel turn**, **Compact context**, **Clear context**, and **Reset session**. The usage bar shows the model the session is running alongside live token and cost figures. Threads live in the sidebar and can be archived.
- **Instructions & Model**: edit the system prompt (`instructions.md`) directly, and pick the model from the **live AI Gateway catalog**. Model and reasoning changes are written with `eve set --model … --reasoning …`, the same editor the Eve TUI uses. Reasoning effort: `provider-default`, `none`, `minimal`, `low`, `medium`, `high`, `xhigh`.
- **Capabilities**: browse **tools, skills, subagents, and hooks**, scaffold new ones, and **open · edit · delete** their source files in an in-app editor. Capabilities contributed by a mounted extension are badged. Under Subagents, **Enable self-modification** installs Eve's experimental, development-only source-editing subagent so the agent can change its own files under `eve dev`.
- **Integrations**: **Add from registry** lets you browse and search the official eve registry (channels, connections, extensions, memory providers, instrumentation) and install anything with `eve add`. Guided wizards remain for Slack, Discord, Telegram, Teams, Twilio, GitHub, Linear, and Buzz. Manage **connections** (MCP / OpenAPI), Vercel **Connect** connectors, and **channels**.
- **Memory**: three layers in one tab. Eve's built-in session memory (durable sessions, compaction, `defineState`, the todo tool, the sandbox workspace); **memory slots** (`agent/memory/<slot>.ts`, file memory or Supermemory); and **Kybernesis Arcana**, an official eve integration installed as an extension for workspace-scoped long-term memory, with an in-app brain browser.
- **Schedules**: view and create cron-driven jobs.
- **Deploy**: link the agent to Vercel and ship to production in-app with `eve deploy`, with logs, environment and secrets management, and a sandbox view.
- **Evals**: run the agent's eval suite and read results.
- **Keep eve current**: the header shows the agent's eve version with an **↑ latest available** chip when npm has a newer release, and a red **build errors** chip when `eve info` reports discovery errors. One click upgrades eve (and `@kybernesis/arcana` when present) with the agent's own package manager, re-runs `eve info --json`, and shows the diagnostics.

The guiding principle: **a non-technical operator should never have to open a terminal.** Linking to Vercel, pulling env, pushing secrets, installing integrations, deploying, and editing capabilities all happen through the UI.

---

## How it works

Eve is **filesystem-first**: an agent's capabilities are discovered from its directory layout (`agent/tools/*.ts`, `agent/skills/<name>/SKILL.md`, `agent/hooks/*.ts`, `agent/subagents/<id>/`, `agent/memory/<slot>.ts`, `agent/extensions/<ns>.ts`, …). Eve Studio leans on that and on the Eve CLI:

```
┌─────────────────────────────────────────────────────────────┐
│  Renderer (React + TS + Tailwind + Zustand)                  │
│  agent rail · per-agent workspace tabs · chat · editors      │
└───────────────▲───────────────────────────┬─────────────────┘
                │  window.studio (preload)   │  IPC (contextIsolated)
┌───────────────┴───────────────────────────▼─────────────────┐
│  Main process (Electron / Node)                              │
│  • spawns `eve dev` per agent, adopts existing servers       │
│  • refreshes structure with `eve info --json` + manifest     │
│  • authors / edits / deletes capability files on disk        │
│  • `eve add` (registry) · `eve set` (model) · `eve deploy`   │
│  • drives the Vercel CLI (link, env, connect)                │
└───────────────▲───────────────────────────┬─────────────────┘
                │  HTTP  /eve/v1/session…    │  child processes
                │  cancel · compact · clear  │
                │  reset · stream            │
        ┌───────┴────────┐          ┌────────▼─────────┐
        │  Eve dev server │          │  eve CLI · Vercel │
        │  (local agent)  │          │  CLI · AI Gateway │
        └─────────────────┘          └──────────────────┘
```

- **Chat** talks to the Eve session HTTP API: `POST /eve/v1/session` to create, `POST /eve/v1/session/:id` for follow-ups and input responses, `POST …/:id/cancel|compact|clear|reset` for session controls, and `GET …/:id/stream` for the NDJSON event stream. The same contract works locally and against a deployed URL (with a Deployment Protection bypass header for protected deployments). Create returns as soon as Workflow accepts the run; Studio waits for `session.waiting` before sending a follow-up and retries a `409 session_not_active` with backoff.
- **Structure** (the tabs' contents) is refreshed with `eve info --json`, which regenerates Eve's discovery and compiled manifest without booting a server. Studio reads channel routes, tools, skills, hooks, schedules, subagents, memory slots, and extension mounts from that manifest.
- **Model** changes go through `eve set`. **Integrations** install through `eve add <item> --non-interactive --yes`, with the NDJSON progress streamed to the in-app console. **Deploy** runs `eve deploy --non-interactive --yes`.
- **Model catalog** is fetched live from the linked gateway's `/v1/models`, filtered to chat models, so the picker always reflects what is actually available.
- **Vercel** linking, env pull and push, and Connect connector management shell out to the Vercel CLI.

### Project layout

```
src/
  main/       Electron main: agent process mgmt, IPC, structure, authoring, registry, Vercel
  preload/    context-isolated bridge exposed as window.studio
  renderer/   React app: agent rail, per-agent tabs, chat, editors, ui kit
  shared/     IPC channel names + shared types
```

---

## Getting started

**Prerequisites:** Node **24** or newer (the packaged app provisions its own runtime), [pnpm](https://pnpm.io), and at least one Eve agent on disk or the intent to create one. Eve itself is installed on demand with `npx eve@latest`. For deploys, the [Vercel CLI](https://vercel.com/docs/cli) is run through `npx` and signed in from the app.

```bash
pnpm install     # install dependencies
pnpm dev         # launch the app (electron-vite dev)
pnpm typecheck   # tsc, no emit (node + web projects)
pnpm build       # electron-vite build
pnpm package     # build a distributable via electron-builder
```

On first run, **Add existing** to point at an agent folder, or **Create new** to scaffold one (`eve init`) from inside the app.

---

## Tech stack

- **[Electron](https://www.electronjs.org)** + **[electron-vite](https://electron-vite.org)**: CJS main/preload, ESM renderer, context-isolated preload bridge (`window.studio`).
- **React 18 + TypeScript (strict)**: renderer UI.
- **[Tailwind CSS](https://tailwindcss.com)** + **[Zustand](https://zustand-demo.pmnd.rs)**: styling and state.
- **[Geist](https://vercel.com/font)** + **Space Mono** (self-hosted via `@fontsource`): typography.
- Packaged with **[electron-builder](https://www.electron.build)**.

---

## About Eve

Eve is Vercel's open-source agent framework. An agent is a folder, deploys as Vercel Functions with durable Workflow runs, and integrates with the Vercel platform.

- **Eve docs**: <https://eve.dev/docs>
- **Eve integrations registry**: <https://eve.dev/integrations> (Arcana: <https://eve.dev/integrations/arcana>)
- **Vercel AI Gateway** (model access): <https://vercel.com/docs/ai-gateway>
- **Vercel CLI**: <https://vercel.com/docs/cli>
- **Deployment Protection** (bypass for automation): <https://vercel.com/docs/deployment-protection>

Eve ships its own docs inside each agent's `node_modules/eve/docs/` (tools, skills, subagents, hooks, channels, connections, memory, extensions, schedules, sandbox, evals), the authoritative reference for authoring.

---

## Notes

- macOS-first today. `.env*`, `node_modules`, and build output are gitignored; the app never stores or commits secrets (Vercel Connect connectors and OIDC tokens are used instead of keys where possible).
- Slack and Buzz reach the **deployed** agent only; local dev is never reachable from those platforms.
- Installing Arcana with `eve add extension/arcana` can fail with `dependency_install` on npm-managed projects whenever the published `@kybernesis/arcana` peer range does not cover the agent's eve version. Studio falls back to installing the package with your package manager and writing the mount itself. See [ROADMAP.md](ROADMAP.md).
- Not affiliated with Vercel. This is an independent tool for working with Eve agents.
