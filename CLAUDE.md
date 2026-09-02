# Eve Studio: working notes for Claude

Eve Studio is a macOS Electron control center for Vercel's open-source **Eve** agent framework. It is an independent open-source project by Kybernesis and **not an official Vercel product**; keep that line in any copy that describes the app. Site + docs live in a separate repo: `/Users/ianborders/eve-studio-site` (Next.js 16 + MDX, deployed at evestudio.dev from `main`).

## Current state (2026-09-02)

- Shipped **v0.4.0** (signed, notarized, `latest-mac.yml` published; 0.3.x installs get UPDATE → RESTART). Built for **eve 0.49**, Node 24.
- The 0.4.0 rebuild: Evolve retired; Memory tab on Eve memory slots + the official Arcana extension; registry-powered integrations (`eve add`); in-app eve upgrade; session protocol on 0.49 (no continuation tokens, 202/409, cancel/compact/clear/reset); structure via `eve info --json` and manifest v47; header chips (eve version, "↑ latest available", "N build errors", Vercel/local state).
- Registered agents on this machine (all upgraded to eve 0.49): eve-gtm (`~/eve-content-agent-template`, deployed), kyber (`~/kyber`), eve-health (`~/eve-health/eve-health`), eve-blob-test, eve-store-test, and the scratch agent `~/studio-e2e` (kept on purpose for testing; linked to the funded Vercel team with Deployment Protection on and a bypass secret saved in Studio).

## Repo layout and commands

```
src/main/       Electron main: agent processes, eve/vercel CLI, structure, chat, registry, arcana
src/preload/    context-isolated bridge → window.studio
src/renderer/   React + Tailwind + Zustand UI (views/, components/, lib/events.ts projector)
src/shared/ipc.ts  IPC channel names + shared types (single source of truth)
scripts/e2e/    CDP harness for driving the running app (see Testing)
.claude/skills/eve-release  release procedure (tag → CI build/sign/notarize/publish)
```

- `pnpm dev` (add `-- --remote-debugging-port=9222` for the harness), `pnpm typecheck`, `pnpm build`. Both typecheck and build must pass before any commit. The repo is not prettier-clean; do not reformat unrelated files.
- Main-process changes need an app restart; renderer changes hot-reload. `electron-vite dev --watch` did not restart main reliably here.
- Release: `/eve-release` skill (`pnpm release` patch, `pnpm release:minor`). Version in `package.json` is the source of truth.

## Eve facts to rely on (verify before asserting anything else)

- Authoritative docs ship inside any agent: `node_modules/eve/docs/` (also https://eve.dev/llms.txt). The stream event types are in `node_modules/eve/dist/src/protocol/message.d.ts`.
- CLI: `eve init <name> [--model]`, `eve dev --no-ui --port N`, `eve info --json` (regenerates `.eve/` without booting), `eve set --model --reasoning`, `eve add <item> --non-interactive --yes [--skip-setup]` (NDJSON; exit 0 done, 1 failed, 2 needs input with `next.command`), `eve registry list --json`, `eve deploy --non-interactive --yes`, `eve eval --list --json`. `eve channels add` no longer exists.
- HTTP: `/eve/v1/{health,info,session,session/:id,session/:id/{stream,cancel,clear,compact,reset}}`. Create returns 202; an immediate follow-up can 409 `session_not_active` (retry with backoff, never silently start a new session). A session id is only valid on the server that minted it.
- Manifest v47: `channelRoutes.effective[]` (older manifests: top-level `channels[]`), `memories[]`, `extensionMounts[]`, `tools[].requiresApproval`, `skills[].owner`, `hooks[].slug/eventNames`, `config.model.id`.
- Memory: slots `agent/memory/<slot>.ts` with `defineMemory` (fileMemory / Supermemory / custom). **Arcana is an official extension**: `eve add extension/arcana` → `agent/extensions/arcana.ts`, env `ARCANA_API_KEY` + `ARCANA_WORKSPACE`; contributes connection `arcana__memory`, skills `arcana__recall|remember|brain-note`, and its own instructions. Studio's wiring falls back to a package-manager install + hand-written mount when `eve add` fails with `dependency_install` (peer-range mismatch). `@kybernesis/arcana` pins one eve minor per release (0.4.1 → eve 0.49).
- Self-modification: `eve add experimental/self-modification` (dev-only subagent). It needs eve 0.49+; installing on an older eve produces a discovery error and the agent stops compiling.
- Default model for new agents: `openai/gpt-5.6-luna-fast`. Reasoning values: `provider-default|none|minimal|low|medium|high|xhigh`.

## Hard-won gotchas

- **Spawned CLI output**: resolve on `close`, not `exit`, and capture large JSON stdout through a file (`runCommand(..., { stdoutToFile: true })` / `runAsync(..., true)`). On macOS, Node writes to pipes asynchronously and eve exits before flushing, so a busy Electron main loop lost the tail of `eve registry list --json`.
- **Never block the main thread**: no `spawnSync` for anything that talks to the network or installs packages; stream to the renderer instead.
- **Dev-server adoption**: only adopt a recorded `.eve/dev-server-state.v1.json` server after `/eve/v1/info` confirms the same `appRoot`; otherwise a stale record attaches to another agent's server.
- **Deployed chat** needs the project's OIDC token (from `.env.local`) and, when Vercel Authentication is on, a **Protection Bypass for Automation** secret pasted in Chat → Deployed → Save. The first production turn can take over two minutes (cold Workflow start).
- **Vercel team choice** in the link flow decides which AI Gateway is billed; a team without a card fails every model call with a credit-card error.
- **Permission classifier** blocks `eve deploy` / deployment-protection changes for real agents in agent sessions. Ask the user or let them click Deploy in Studio.
- `eve dev` on an upgraded agent may log `CorruptedEventLogError` for sessions parked under an older Workflow SDK in `.eve/.workflow-data`; delete that dev-only directory.
- Copy rules: **no em dashes** anywhere user-facing; keep the not-official line; link https://eve.dev/docs and https://eve.dev/integrations.

## Testing

- `pnpm typecheck && pnpm build` is the minimum bar.
- Scaffolds Studio writes (tools, skills, subagents, hooks, schedules, channels incl. Buzz/custom, connections, memory slots, Arcana mount) must validate in a real eve 0.49 agent: drop the file in, `CI=1 npx eve info` → 0 errors / 0 warnings, `npx tsc --noEmit`.
- End-to-end through the real UI: start the app with `pnpm dev -- --remote-debugging-port=9222`, then from `scripts/e2e/` run `node tour.mjs <agent> <prefix>` (screenshots + text dumps of every tab into `scripts/e2e/shots/`), `node e2e-create.mjs <name>` (create + register through the app's IPC; the folder picker is a native dialog), `node e2e-chat.mjs <agent> Local|Deployed "<message>" <out>`, `node e2e-deploy.mjs <agent> <out>`, `node shot.mjs <out> "<js to eval>"`. Screenshots can be read back as images.

## Where to go next (open items)

- Production deploys of kyber, eve-health, eve-blob-test, eve-store-test after their 0.49 upgrades (user's click; eve-gtm is deployed).
- `grok login` on this machine before kyber's local chat or local build works (the expired token was cleared during a smoke test).
- Upstream: widen `@kybernesis/arcana`'s eve peer to `*` (platform repo); `@github-tools/eve-extension` still pins eve `<0.48`, so kyber carries `.npmrc legacy-peer-deps=true`.
- Studio roadmap (ROADMAP.md): registry setup-answer prompts in-app, per-subagent Arcana mounts UI, memory-slot editor, traces viewer (`eve traces`), evals authoring, `eve link` in-app instead of `vercel link`, keychain for brain keys, Windows/Linux.
- Untracked scratch in the repo root (`ARCHITECTURE.md`, `diagram.py`, `eve-studio-architecture.*`, `tools/arch_diagram.py`) predates 0.4.0 and still describes Evolve; regenerate or delete.
