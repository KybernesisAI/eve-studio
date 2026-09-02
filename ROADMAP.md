# Eve Studio Roadmap

Eve Studio is an independent open-source desktop control center for [Eve](https://eve.dev) agents, built by Kybernesis. It is not an official Vercel product. Current line: `v0.3.x`, macOS-first, built for **eve 0.49+**.

## Shipped

- **Chat** against the local dev server or the deployed agent, streaming turns, tool calls, subagent delegations, reasoning, approvals, compaction events, cancellations, and failures. Session controls: Cancel turn, Compact context, Clear context, Reset session. Studio owns transcript persistence and thread archiving.
- **Instructions & Model**: markdown editor over `instructions.md`; model and reasoning written with `eve set`; live AI Gateway model catalog.
- **Capabilities**: create, open, edit, delete tools, skills, subagents, and hooks; extension-contributed capabilities badged; **Enable self-modification** (Eve's experimental, development-only subagent) under Subagents.
- **Integrations**: **Add from registry** (browse/search the official eve registry and install with `eve add`), guided wizards for Slack, Discord, Telegram, Teams, Twilio, GitHub, Linear, and Buzz, Web Chat via `eve add channel/web`, connections (MCP / OpenAPI), and Vercel Connect connectors.
- **Memory**: Eve session memory, memory slots (file memory scaffold, Supermemory via `eve add memory/supermemory`), and **Kybernesis Arcana** as an official eve extension (`eve add extension/arcana`), with key validation, local and Vercel env wiring, legacy-connection migration, and a brain browser (stats, timeline, search).
- **Schedules**: list and create cron jobs.
- **Deploy**: `eve deploy --non-interactive --yes`, env pull/push, secrets, logs, sandbox view.
- **Evals**: list and run the agent's evals.
- **Structure** refreshed with `eve info --json`; header chips for the installed eve version, a newer release on npm, build errors, Vercel link state, and the local server.
- **Keep eve current**: in-app eve upgrade per agent with its own package manager (npm retried with `--legacy-peer-deps`), bumping `@kybernesis/arcana` alongside, then `eve info --json` with diagnostics.
- **Integrations layout**: this agent's connections (extension rows badged), Vercel Connect split into attached and other team connectors, registry gallery, and a "More channels from the eve registry" list.
- **Onboarding**: Node 24 provisioned by the app; Eve installed with `npx eve@latest`; Vercel sign-in and link in-app.
- Signed, notarized macOS builds with an in-app updater.

## Next

- **Registry setup-answer prompts**: a UI for the answers `eve add` asks for (exit code `2` / `next.command`) instead of surfacing the continuation command.
- **Per-subagent Arcana mounts**: wire a separate brain to a subagent (`agent/subagents/<id>/extensions/arcana.ts`) from the Memory tab.
- **Memory-slot editor**: edit a slot's provider, scope, namespace, and visibility in a form.
- **Traces viewer**: read local traces through `eve traces` and show the span tree per session.
- **Evals authoring**: scaffold `evals/*.eval.ts` and show per-assertion results from the run artifacts.
- **`eve link` in-app**: replace the `vercel link` + `vercel env pull` pair with `eve link --non-interactive`.
- **Self-modification chat UX**: surface the self-modification subagent's file changes and registry installs as reviewable diffs in Chat.
- **Windows and Linux** builds.

## Known issues

- `eve add extension/arcana` can fail with `{"type":"failed","failureCode":"dependency_install"}` on npm-managed projects whenever the published `@kybernesis/arcana` peer range does not cover the agent's eve version (0.3.0 was pinned to eve 0.38; 0.4.0 is pinned to 0.49, so the next eve minor will hit it again). Studio falls back to installing the package with the project's package manager (`npm install --legacy-peer-deps`, `pnpm add`, or `yarn add`) and writes `agent/extensions/arcana.ts` itself. The permanent fix is a wildcard `eve` peer range in the package, as Eve's extension docs recommend.
- Slack and Buzz reach the **deployed** agent only. Local dev is never reachable from those platforms; deploy to test them.
- macOS only. The Buzz background bridge is a macOS LaunchAgent.
