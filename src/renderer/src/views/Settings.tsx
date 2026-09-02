import type { AppInfo } from "@shared/ipc";
import { useStore } from "../store";
import { IconServer, IconTrash } from "../ui/icons";
import {
  Button,
  Card,
  EmptyState,
  Kicker,
  List,
  ListRow,
  ViewHeader,
} from "../ui/kit";

function InfoRow({ k, v }: { k: string; v: string }): JSX.Element {
  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <span className="font-spacemono text-[10px] uppercase tracking-[0.14em] text-faint">
        {k}
      </span>
      <span className="font-mono text-[13px] text-text">{v}</span>
    </div>
  );
}

export function Settings({ info }: { info: AppInfo | null }): JSX.Element {
  const agents = useStore((s) => s.agents);
  const removeAgent = useStore((s) => s.removeAgent);

  return (
    <div className="flex h-full flex-col">
      <ViewHeader kicker="Eve Studio" title="Settings" />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-2xl space-y-8 px-4 py-6">
          <section className="space-y-2.5">
            <Kicker>Application</Kicker>
            <Card>
              <div className="divide-y divide-border/70">
                <InfoRow k="Version" v={info?.appVersion ?? "—"} />
                <InfoRow k="Electron" v={info?.electron ?? "—"} />
                <InfoRow k="Node" v={info?.node ?? "—"} />
                <InfoRow k="Chromium" v={info?.chrome ?? "—"} />
                <InfoRow k="Platform" v={info?.platform ?? "—"} />
              </div>
            </Card>
          </section>

          <section className="space-y-2.5">
            <div className="flex items-baseline gap-2">
              <Kicker>Registered agents</Kicker>
              <span className="font-mono text-2xs text-faint">
                {agents.length}
              </span>
            </div>
            {agents.length === 0 ? (
              <EmptyState
                icon={<IconServer className="h-6 w-6" />}
                kicker="Agents"
                title="No agents registered"
              >
                Registered agents appear here once you add them from the
                sidebar.
              </EmptyState>
            ) : (
              <List>
                {agents.map((a) => (
                  <ListRow
                    key={a.id}
                    icon={<IconServer className="h-3.5 w-3.5" />}
                    title={a.name}
                    desc={a.path}
                    right={
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeAgent(a.id)}
                      >
                        <IconTrash className="h-3.5 w-3.5" />
                        Remove
                      </Button>
                    }
                  />
                ))}
              </List>
            )}
          </section>

          <section className="space-y-2.5">
            <Kicker>About</Kicker>
            <p className="text-[13px] leading-relaxed text-muted">
              Eve Studio is an independent open-source project by Kybernesis.
              It is not an official Vercel product. Eve is Vercel's open-source
              agent framework — docs at https://eve.dev/docs, integrations at
              https://eve.dev/integrations. Agents need eve 0.49+ and Node 24.
            </p>
          </section>

          <section className="space-y-2.5">
            <Kicker>Storage &amp; secrets</Kicker>
            <p className="text-[13px] leading-relaxed text-muted">
              Agents, chat threads, and Arcana brain keys are stored locally in
              this app's user-data directory. Brain keys are held in plain JSON
              for now — an OS-keychain vault is a planned hardening pass.
              Nothing leaves your machine except calls to the agents' own dev
              servers, Vercel, the eve registry, and Arcana.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
