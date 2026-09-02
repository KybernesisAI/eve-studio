import type {
  ChannelItem,
  ChannelKind,
  ChannelWiring,
  DiscordStatus,
  RegistryItem,
  TeamsStatus,
  TelegramStatus,
  TwilioStatus,
} from "@shared/ipc";
import { useCallback, useEffect, useState } from "react";
import { BuzzProfileEdit } from "../components/BuzzProfileEdit";
import { BuzzSetup } from "../components/BuzzSetup";
import { ConnectorPicker } from "../components/ConnectorPicker";
import { ConnectSetup } from "../components/ConnectSetup";
import { DiscordSetup } from "../components/DiscordSetup";
import {
  GUIDED_CHANNELS,
  RegistryDocsLink,
  RegistryInstallModal,
} from "../components/RegistryGallery";
import { SlackSetup } from "../components/SlackSetup";
import { TeamsSetup } from "../components/TeamsSetup";
import { TelegramSetup } from "../components/TelegramSetup";
import { TwilioSetup } from "../components/TwilioSetup";
import { useStore } from "../store";
import { Console } from "../ui/Console";
import {
  IconChevronDown,
  IconPlus,
  IconRefresh,
  IconServer,
  IconTrash,
} from "../ui/icons";
import {
  Badge,
  Button,
  IconButton,
  Kicker,
  List,
  Modal,
  Spinner,
  StatusDot,
  ViewHeader,
  cx,
} from "../ui/kit";

type Auth = "connect" | "env" | "web" | "custom";
interface Cat {
  kind: ChannelKind | "web";
  label: string;
  desc: string;
  auth: Auth;
  service?: string;
  env?: string[];
  color: string;
}

const CATALOG: Cat[] = [
  {
    kind: "slack",
    label: "Slack",
    desc: "Mentions, DMs, buttons.",
    auth: "connect",
    service: "slack",
    color: "#611f69",
  },
  {
    kind: "discord",
    label: "Discord",
    desc: "Slash commands, components.",
    auth: "env",
    env: ["DISCORD_PUBLIC_KEY", "DISCORD_APPLICATION_ID", "DISCORD_BOT_TOKEN"],
    color: "#5865F2",
  },
  {
    kind: "teams",
    label: "Microsoft Teams",
    desc: "Messages + Adaptive Cards.",
    auth: "env",
    env: ["MICROSOFT_APP_ID", "MICROSOFT_APP_PASSWORD"],
    color: "#4b53bc",
  },
  {
    kind: "telegram",
    label: "Telegram",
    desc: "Bot messages.",
    auth: "env",
    env: ["TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET_TOKEN"],
    color: "#229ED9",
  },
  {
    kind: "twilio",
    label: "Twilio",
    desc: "SMS & speech phone calls.",
    auth: "env",
    env: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"],
    color: "#F22F46",
  },
  {
    kind: "github",
    label: "GitHub",
    desc: "@mentions, PR review w/ checkout.",
    auth: "connect",
    service: "github",
    color: "#24292f",
  },
  {
    kind: "linear",
    label: "Linear",
    desc: "Issue delegation, Agent Sessions.",
    auth: "connect",
    service: "linear",
    color: "#5E6AD2",
  },
  {
    kind: "buzz",
    label: "Buzz",
    desc: "Agent-native team chat by Block.",
    auth: "env",
    env: ["BUZZ_RELAY_URL", "BUZZ_PRIVATE_KEY", "BUZZ_WEBHOOK_SECRET"],
    color: "#F5B700",
  },
  {
    kind: "web",
    label: "Web Chat",
    desc: "A Next.js browser chat app.",
    auth: "web",
    color: "#000000",
  },
  {
    kind: "custom",
    label: "Custom",
    desc: "Your own webhook / WebSocket.",
    auth: "custom",
    color: "#666666",
  },
];

function Logo({
  label,
  color,
  className,
}: {
  label: string;
  color: string;
  className?: string;
}): JSX.Element {
  return (
    <div
      className={cx(
        "flex shrink-0 items-center justify-center rounded-lg font-semibold text-white",
        className ?? "h-9 w-9 text-sm",
      )}
      style={{ background: color }}
    >
      {label[0]}
    </div>
  );
}

function AddChannelModal({
  agentId,
  cat,
  onClose,
  onDone,
}: {
  agentId: string;
  cat: Cat;
  onClose: () => void;
  onDone: () => void;
}): JSX.Element {
  const [connector, setConnector] = useState("");
  const [customName, setCustomName] = useState("intake");
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState("");
  const [done, setDone] = useState<{
    envVars?: string[];
    connect?: boolean;
  } | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [attachOut, setAttachOut] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const add = async (): Promise<void> => {
    setBusy(true);
    setErr(null);
    if (cat.kind === "web") {
      setOutput("Installing channel/web from the eve registry…\n");
      const r = await window.studio.agents.channelAdd(agentId);
      setBusy(false);
      setOutput(r.output);
      if (r.ok) {
        setDone({});
      } else if (r.needsInput) {
        setErr(
          r.nextCommand
            ? `Setup needs input — finish in a terminal: ${r.nextCommand}`
            : "Setup needs input — finish it in a terminal with eve add channel/web.",
        );
      } else {
        setErr("Install failed — see output.");
      }
      return;
    }
    const r = await window.studio.agents.channelWrite(agentId, {
      kind: cat.kind as ChannelKind,
      connector: cat.auth === "connect" ? connector : undefined,
      name: cat.kind === "custom" ? customName : undefined,
    });
    setBusy(false);
    if (r.ok) {
      setDone({ envVars: r.envVars, connect: r.connect });
    } else {
      setErr(r.error ?? "Failed.");
    }
  };

  const attach = async (): Promise<void> => {
    setAttaching(true);
    setAttachOut(
      `$ vercel connect attach ${connector} --triggers --trigger-path /eve/v1/${cat.kind}\n`,
    );
    const r = await window.studio.vercel.connectorAttach(
      agentId,
      connector,
      cat.kind,
    );
    setAttaching(false);
    setAttachOut((o) => o + r.output);
  };

  const canAdd =
    cat.auth === "connect"
      ? Boolean(connector)
      : cat.kind === "custom"
        ? Boolean(customName)
        : true;

  return (
    <Modal title={`Add ${cat.label}`} onClose={onClose} width="max-w-xl">
      {done ? (
        <div className="space-y-3 p-4">
          <div className="rounded-lg bg-success/10 px-3 py-2 text-[13px] text-success">
            {cat.kind === "web"
              ? "Web Chat app added."
              : `channels/${cat.kind}.ts written.`}
          </div>
          {done.envVars && done.envVars.length > 0 ? (
            <div className="space-y-1.5">
              <p className="text-2xs text-muted">
                Set these in the Environment tab, then restart:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {done.envVars.map((v) => (
                  <code
                    key={v}
                    className="rounded bg-black/[0.05] px-1.5 py-0.5 font-mono text-2xs text-text"
                  >
                    {v}
                  </code>
                ))}
              </div>
            </div>
          ) : null}
          {done.connect ? (
            <div className="space-y-2">
              <p className="text-2xs leading-relaxed text-muted">
                Attach the connector to this project so the platform can deliver
                events to{" "}
                <span className="font-mono text-text">/eve/v1/{cat.kind}</span>,
                then deploy.
              </p>
              <Button
                variant="secondary"
                size="sm"
                onClick={attach}
                disabled={attaching}
              >
                {attaching ? "Attaching…" : "Attach for triggers"}
              </Button>
              {attachOut ? (
                <Console
                  text={attachOut}
                  busy={attaching}
                  className="max-h-40"
                />
              ) : null}
            </div>
          ) : null}
          {output ? (
            <Console text={output} busy={busy} className="max-h-40" />
          ) : null}
          <div className="flex justify-end">
            <Button
              variant="primary"
              onClick={() => {
                onDone();
                onClose();
              }}
            >
              Done
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3 p-4">
          <div className="flex items-center gap-3">
            <Logo label={cat.label} color={cat.color} />
            <div>
              <div className="text-[14px] font-medium text-text">
                {cat.label}
              </div>
              <div className="text-2xs text-muted">{cat.desc}</div>
            </div>
          </div>

          {cat.auth === "connect" ? (
            <div>
              <div className="mb-1 text-xs font-medium text-muted">
                Vercel Connect connector
              </div>
              <ConnectorPicker
                agentId={agentId}
                service={cat.service}
                value={connector}
                onChange={setConnector}
              />
            </div>
          ) : null}

          {cat.auth === "env" ? (
            <div className="rounded-lg border border-border bg-subtle p-3 text-2xs leading-relaxed text-muted">
              Uses env-var credentials. After adding, set{" "}
              {cat.env?.map((v, i) => (
                <span key={v}>
                  {i > 0 ? ", " : ""}
                  <code className="rounded bg-black/[0.05] px-1 font-mono text-text">
                    {v}
                  </code>
                </span>
              ))}{" "}
              in the Environment tab.
            </div>
          ) : null}

          {cat.auth === "web" ? (
            <div className="rounded-lg border border-border bg-subtle p-3 text-2xs leading-relaxed text-muted">
              Runs{" "}
              <span className="font-mono text-text">
                eve add channel/web --non-interactive --yes
              </span>{" "}
              to install the Next.js Web Chat app from the eve registry.
            </div>
          ) : null}

          {cat.kind === "custom" ? (
            <div>
              <div className="mb-1 text-xs font-medium text-muted">
                File name{" "}
                <span className="text-faint">— channels/&lt;name&gt;.ts</span>
              </div>
              <input
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                className="no-drag w-full rounded-lg border border-border bg-bg px-2.5 py-1.5 font-mono text-[13px] text-text"
              />
            </div>
          ) : null}

          {err ? <div className="text-xs text-danger">{err}</div> : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={add} disabled={busy || !canAdd}>
              {busy ? "Adding…" : `Add ${cat.label}`}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

export function Channels(): JSX.Element {
  const id = useStore((s) => s.activeAgentId);
  const [channels, setChannels] = useState<ChannelItem[] | null>(null);
  const [wiring, setWiring] = useState<ChannelWiring[]>([]);
  const [loading, setLoading] = useState(false);
  const [add, setAdd] = useState<Cat | null>(null);
  const [remove, setRemove] = useState<ChannelItem | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeErr, setRemoveErr] = useState<string | null>(null);
  const [slackSetup, setSlackSetup] = useState(false);
  const [telegramSetup, setTelegramSetup] = useState(false);
  const [discordSetup, setDiscordSetup] = useState(false);
  const [twilioSetup, setTwilioSetup] = useState(false);
  const [teamsSetup, setTeamsSetup] = useState(false);
  const [buzzSetup, setBuzzSetup] = useState(false);
  const [buzzProfile, setBuzzProfile] = useState(false);
  const [connectSetup, setConnectSetup] = useState<"github" | "linear" | null>(
    null,
  );
  const [tg, setTg] = useState<TelegramStatus | null>(null);
  const [dc, setDc] = useState<DiscordStatus | null>(null);
  const [tw, setTw] = useState<TwilioStatus | null>(null);
  const [tm, setTm] = useState<TeamsStatus | null>(null);
  const [bz, setBz] = useState<import("@shared/ipc").BuzzStatus | null>(null);
  const [finishing, setFinishing] = useState<string | null>(null);
  const [registryChannels, setRegistryChannels] = useState<
    RegistryItem[] | null
  >(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [installItem, setInstallItem] = useState<RegistryItem | null>(null);
  const [finishMsg, setFinishMsg] = useState<{
    name: string;
    ok: boolean;
    text: string;
  } | null>(null);

  const load = useCallback(async () => {
    if (!id) {
      return;
    }
    setLoading(true);
    try {
      setChannels(await window.studio.agents.channelsList(id));
    } finally {
      setLoading(false);
    }
    // Wiring (connector + attachment) needs a Vercel call — load it separately
    // so the list renders immediately and the badges fill in when ready.
    window.studio.agents
      .channelWiring(id)
      .then(setWiring)
      .catch(() => setWiring([]));
    // Telegram isn't Connect-based, so its live status comes from getWebhookInfo
    // against the saved bot token (returns configured:false when never set up).
    window.studio.telegram
      .status(id)
      .then(setTg)
      .catch(() => setTg(null));
    window.studio.discord
      .status(id)
      .then(setDc)
      .catch(() => setDc(null));
    window.studio.twilio
      .status(id)
      .then(setTw)
      .catch(() => setTw(null));
    window.studio.teams
      .status(id)
      .then(setTm)
      .catch(() => setTm(null));
    window.studio.buzz
      .status(id)
      .then(setBz)
      .catch(() => setBz(null));
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Registry channels without a guided wizard (Google Chat, WhatsApp, X, …).
  useEffect(() => {
    if (!id) {
      return;
    }
    setRegistryChannels(null);
    window.studio.registry
      .list(id)
      .then((r) =>
        setRegistryChannels(
          r.items.filter(
            (it) =>
              it.name.startsWith("channel/") && !GUIDED_CHANNELS.has(it.name),
          ),
        ),
      )
      .catch(() => setRegistryChannels([]));
  }, [id]);

  /**
   * One-click completion for the deploy-then-verify step that env-webhook
   * channels can't do until the agent is live: resolve the stable production
   * URL and register the webhook (Telegram) / verify the interactions endpoint
   * (Discord) using the saved creds. This is what closes the setup loop after a
   * deploy without reopening the wizard.
   */
  const finishChannel = async (
    kind: "telegram" | "discord" | "twilio",
    name: string,
  ): Promise<void> => {
    if (!id) {
      return;
    }
    setFinishing(name);
    setFinishMsg(null);
    const alias = await window.studio.vercel.prodAlias(id);
    if (!alias.ok || !alias.url) {
      setFinishing(null);
      setFinishMsg({
        name,
        ok: false,
        text: "No production deployment found — deploy the agent first, then finish setup.",
      });
      return;
    }
    const base = alias.url.replace(/\/+$/, "");
    if (kind === "twilio") {
      const r = await window.studio.twilio.setWebhooks(id, base);
      setFinishMsg(
        r.ok && r.live
          ? { name, ok: true, text: "Number webhooks set — connected." }
          : {
              name,
              ok: false,
              text: r.error ?? "Couldn't set the number's webhooks.",
            },
      );
    } else if (kind === "telegram") {
      const r = await window.studio.telegram.registerWebhook(
        id,
        `${base}/eve/v1/telegram`,
      );
      setFinishMsg(
        r.ok && !r.lastError
          ? { name, ok: true, text: "Webhook registered — connected." }
          : {
              name,
              ok: false,
              text: r.lastError
                ? /401|403|unauthorized|forbidden/i.test(r.lastError)
                  ? "Telegram is blocked by Vercel Deployment Protection — turn off Vercel Authentication for Production, then retry."
                  : `Telegram couldn't deliver: ${r.lastError}`
                : (r.error ?? "Couldn't register the webhook."),
            },
      );
    } else {
      const r = await window.studio.discord.setEndpoint(
        id,
        `${base}/eve/v1/discord`,
      );
      setFinishMsg(
        r.ok && r.live
          ? { name, ok: true, text: "Endpoint verified — connected." }
          : {
              name,
              ok: false,
              text:
                r.error &&
                /could not be verified|not.*verif|401|403/i.test(r.error)
                  ? "Discord couldn't verify the endpoint — make sure the agent is deployed and Vercel Deployment Protection is off for Production, then retry."
                  : (r.error ?? "Couldn't verify the endpoint."),
            },
      );
    }
    setFinishing(null);
    void load();
  };

  if (loading && !channels) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }
  const list = channels ?? [];
  // The default eve HTTP channel is always-on and shown separately.
  const authored = list.filter((c) => (c.kind ?? c.name) !== "eve");
  const present = new Set(authored.map((c) => c.kind ?? c.name));

  return (
    <div className="flex h-full flex-col">
      <ViewHeader
        kicker="Integrations"
        title="Channels"
        count={authored.length + 1}
        right={
          <IconButton onClick={() => void load()} title="Reload">
            <IconRefresh className="h-3.5 w-3.5" />
          </IconButton>
        }
      />

      <div className="flex-1 overflow-auto px-4 py-4">
        <div className="mx-auto max-w-2xl space-y-7">
          {/* Configured */}
          <div className="space-y-2.5">
            <Kicker>Configured</Kicker>
            <p className="text-2xs leading-relaxed text-muted">
              “Added” means the channel file exists in the agent. Connect-based
              channels (Slack, GitHub, Linear) also need their connector
              attached &amp; authorized in Vercel, plus a redeploy, before they
              can send or receive. A channel lets the agent reply where its
              events arrive and be posted to by schedules — it is{" "}
              <span className="font-medium">not</span> a tool the agent can call
              to message you from a normal chat.
            </p>
            <List>
              <div className="flex items-center gap-3 px-3 py-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-subtle text-faint">
                  <IconServer className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] text-text">
                      eve HTTP channel
                    </span>
                    <Badge tone="success">always on</Badge>
                  </div>
                  <div className="mt-0.5 font-mono text-2xs text-faint">
                    /eve/v1/session*
                  </div>
                </div>
              </div>
              {authored.map((c) => {
                const cat = CATALOG.find((x) => x.kind === (c.kind ?? c.name));
                const kind = c.kind ?? c.name;
                const needsFinish =
                  (kind === "telegram" && tg?.configured && !tg.live) ||
                  (kind === "discord" && dc?.configured && !dc.live) ||
                  (kind === "twilio" && tw?.configured && !tw.live);
                return (
                  <div key={c.name} className="px-3 py-3">
                    <div className="flex items-center gap-3">
                      <Logo
                        label={cat?.label ?? c.name}
                        color={cat?.color ?? "#666"}
                        className="h-8 w-8 text-[13px]"
                      />
                      {(() => {
                        const w = wiring.find((x) => x.name === c.name);
                        return (
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-[13px] font-medium text-text">
                                {cat?.label ?? c.name}
                              </span>
                              {(c.kind ?? c.name) === "telegram" ? (
                                tg?.live ? (
                                  <Badge tone="success">
                                    <StatusDot status="running" />
                                    connected to this agent
                                  </Badge>
                                ) : tg?.lastError ? (
                                  <Badge tone="warn">
                                    webhook blocked — needs attention
                                  </Badge>
                                ) : tg?.configured ? (
                                  <Badge tone="warn">
                                    webhook not live — finish setup
                                  </Badge>
                                ) : (
                                  <Badge>added</Badge>
                                )
                              ) : (c.kind ?? c.name) === "discord" ? (
                                dc?.live ? (
                                  <Badge tone="success">
                                    <StatusDot status="running" />
                                    connected to this agent
                                  </Badge>
                                ) : dc?.lastError ? (
                                  <Badge tone="warn">
                                    endpoint blocked — needs attention
                                  </Badge>
                                ) : dc?.configured ? (
                                  <Badge tone="warn">
                                    endpoint not set — finish setup
                                  </Badge>
                                ) : (
                                  <Badge>added</Badge>
                                )
                              ) : (c.kind ?? c.name) === "twilio" ? (
                                tw?.live ? (
                                  <Badge tone="success">
                                    <StatusDot status="running" />
                                    connected to this agent
                                  </Badge>
                                ) : tw?.lastError ? (
                                  <Badge tone="warn">
                                    webhooks blocked — needs attention
                                  </Badge>
                                ) : tw?.configured ? (
                                  <Badge tone="warn">
                                    webhooks not set — finish setup
                                  </Badge>
                                ) : (
                                  <Badge>added</Badge>
                                )
                              ) : (c.kind ?? c.name) === "teams" ? (
                                tm?.live ? (
                                  <Badge tone="success">
                                    <StatusDot status="running" />
                                    credentials valid
                                  </Badge>
                                ) : tm?.lastError ? (
                                  <Badge tone="warn">
                                    credentials rejected — re-check
                                  </Badge>
                                ) : tm?.configured ? (
                                  <Badge tone="warn">
                                    set endpoint in Azure
                                  </Badge>
                                ) : (
                                  <Badge>added</Badge>
                                )
                              ) : (c.kind ?? c.name) === "buzz" ? (
                                bz?.member &&
                                (bz.bridgeRunning || bz.bridgeInstalled) ? (
                                  <Badge tone="success">
                                    <StatusDot status="running" />
                                    connected to this agent
                                  </Badge>
                                ) : bz?.member ? (
                                  <Badge tone="warn">
                                    member — bridge not running
                                  </Badge>
                                ) : bz?.configured ? (
                                  <Badge tone="warn">
                                    awaiting workspace admission
                                  </Badge>
                                ) : (
                                  <Badge>added</Badge>
                                )
                              ) : w?.attached === true ? (
                                <Badge tone="success">
                                  <StatusDot status="running" />
                                  connected to this agent
                                </Badge>
                              ) : w?.attached === false ? (
                                <Badge tone="warn">
                                  not attached — finish setup
                                </Badge>
                              ) : (
                                <Badge>added</Badge>
                              )}
                            </div>
                            <div className="mt-0.5 font-mono text-2xs text-faint">
                              channels/{c.name}.ts
                              {w?.connector ? ` · bot ${w.connector}` : ""}
                              {c.urlPath
                                ? ` · ${c.method ?? "POST"} ${c.urlPath}`
                                : ""}
                            </div>
                          </div>
                        );
                      })()}
                      {needsFinish ? (
                        <Button
                          onClick={() =>
                            finishChannel(
                              kind === "discord"
                                ? "discord"
                                : kind === "twilio"
                                  ? "twilio"
                                  : "telegram",
                              c.name,
                            )
                          }
                          disabled={finishing === c.name}
                          size="sm"
                          variant="primary"
                        >
                          {finishing === c.name ? (
                            <>
                              <Spinner /> Finishing…
                            </>
                          ) : (
                            "Finish setup"
                          )}
                        </Button>
                      ) : null}
                      {kind === "slack" ? (
                        <Button
                          onClick={() => setSlackSetup(true)}
                          size="sm"
                          variant="secondary"
                        >
                          Set up
                        </Button>
                      ) : kind === "telegram" ? (
                        <Button
                          onClick={() => setTelegramSetup(true)}
                          size="sm"
                          variant="secondary"
                        >
                          Set up
                        </Button>
                      ) : kind === "discord" ? (
                        <Button
                          onClick={() => setDiscordSetup(true)}
                          size="sm"
                          variant="secondary"
                        >
                          Set up
                        </Button>
                      ) : kind === "twilio" ? (
                        <Button
                          onClick={() => setTwilioSetup(true)}
                          size="sm"
                          variant="secondary"
                        >
                          Set up
                        </Button>
                      ) : kind === "teams" ? (
                        <Button
                          onClick={() => setTeamsSetup(true)}
                          size="sm"
                          variant="secondary"
                        >
                          Set up
                        </Button>
                      ) : kind === "buzz" ? (
                        <>
                          <Button
                            onClick={() => setBuzzProfile(true)}
                            size="sm"
                            variant="secondary"
                          >
                            Profile
                          </Button>
                          <Button
                            onClick={() => setBuzzSetup(true)}
                            size="sm"
                            variant="secondary"
                          >
                            Set up
                          </Button>
                        </>
                      ) : kind === "github" || kind === "linear" ? (
                        <Button
                          onClick={() => setConnectSetup(kind)}
                          size="sm"
                          variant="secondary"
                        >
                          Set up
                        </Button>
                      ) : null}
                      <IconButton
                        onClick={() => {
                          setRemoveErr(null);
                          setRemove(c);
                        }}
                        title="Remove channel"
                      >
                        <IconTrash className="h-3.5 w-3.5" />
                      </IconButton>
                    </div>
                    {finishMsg?.name === c.name ? (
                      <div
                        className={`mt-2 rounded-lg px-3 py-2 text-2xs ${
                          finishMsg.ok
                            ? "bg-success/10 text-success"
                            : "bg-warn/10 text-warn"
                        }`}
                      >
                        {finishMsg.text}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </List>
          </div>

          {/* Gallery */}
          <div className="space-y-2.5">
            <Kicker>Add a channel</Kicker>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {CATALOG.map((cat) => {
                const added = present.has(cat.kind);
                return (
                  <div
                    key={cat.kind}
                    className="flex items-center gap-3 rounded-lg border border-border/70 px-3 py-3 transition-colors hover:border-border-strong hover:bg-black/[0.02]"
                  >
                    <Logo
                      label={cat.label}
                      color={cat.color}
                      className="h-8 w-8 text-[13px]"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-medium text-text">
                          {cat.label}
                        </span>
                        {cat.auth === "connect" ? (
                          <Badge tone="accent">Connect</Badge>
                        ) : null}
                        {cat.auth === "env" ? <Badge>env</Badge> : null}
                      </div>
                      <div className="mt-0.5 text-2xs leading-snug text-muted">
                        {cat.desc}
                      </div>
                    </div>
                    {added ? (
                      <Badge>added</Badge>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={!id}
                        onClick={() =>
                          cat.kind === "slack"
                            ? setSlackSetup(true)
                            : cat.kind === "telegram"
                              ? setTelegramSetup(true)
                              : cat.kind === "discord"
                                ? setDiscordSetup(true)
                                : cat.kind === "twilio"
                                  ? setTwilioSetup(true)
                                  : cat.kind === "teams"
                                    ? setTeamsSetup(true)
                                    : cat.kind === "buzz"
                                      ? setBuzzSetup(true)
                                      : cat.kind === "github" ||
                                          cat.kind === "linear"
                                        ? setConnectSetup(cat.kind)
                                        : setAdd(cat)
                        }
                      >
                        <IconPlus className="h-3.5 w-3.5" />{" "}
                        {cat.kind === "slack" ||
                        cat.kind === "telegram" ||
                        cat.kind === "discord" ||
                        cat.kind === "twilio" ||
                        cat.kind === "teams" ||
                        cat.kind === "buzz" ||
                        cat.kind === "github" ||
                        cat.kind === "linear"
                          ? "Set up"
                          : "Add"}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* More channels from the registry (no guided wizard) */}
          <div className="space-y-2.5">
            <button
              type="button"
              onClick={() => setMoreOpen((v) => !v)}
              className="flex w-full items-center gap-1.5 text-left"
            >
              <IconChevronDown
                className={cx(
                  "h-3.5 w-3.5 text-faint transition-transform",
                  !moreOpen && "-rotate-90",
                )}
              />
              <Kicker>More channels from the eve registry</Kicker>
              <span className="font-mono text-2xs text-faint">
                {registryChannels === null ? "…" : registryChannels.length}
              </span>
            </button>
            {moreOpen ? (
              registryChannels === null ? (
                <div className="flex items-center gap-2 px-3 py-3 text-2xs text-muted">
                  <Spinner className="h-3.5 w-3.5" /> Reading the registry…
                </div>
              ) : registryChannels.length === 0 ? (
                <div className="px-3 py-3 text-2xs text-muted">
                  Nothing beyond the guided channels above.
                </div>
              ) : (
                <>
                  <p className="text-2xs leading-relaxed text-muted">
                    Installed with{" "}
                    <span className="font-mono text-text">eve add</span>; each
                    item's own setup flow runs non-interactively, and anything
                    it needs from you is shown as a command to finish in a
                    terminal.
                  </p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {registryChannels.map((it) => {
                      const kind = it.name.split("/")[1] ?? it.name;
                      const added = present.has(kind);
                      return (
                        <div
                          key={it.name}
                          className="flex items-center gap-3 rounded-lg border border-border/70 px-3 py-3 transition-colors hover:border-border-strong hover:bg-black/[0.02]"
                        >
                          <Logo
                            label={it.title || kind}
                            color="#666666"
                            className="h-8 w-8 text-[13px]"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-[13px] font-medium text-text">
                                {it.title || kind}
                              </span>
                              <span className="truncate font-mono text-2xs text-faint">
                                {it.name}
                              </span>
                            </div>
                            <div className="mt-0.5 line-clamp-2 text-2xs leading-snug text-muted">
                              {it.description}
                            </div>
                            <div className="mt-1">
                              <RegistryDocsLink item={it} />
                            </div>
                          </div>
                          {added ? (
                            <Badge>added</Badge>
                          ) : (
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={!id}
                              onClick={() => setInstallItem(it)}
                            >
                              <IconPlus className="h-3.5 w-3.5" /> Install
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )
            ) : null}
          </div>
        </div>
      </div>

      {installItem && id ? (
        <RegistryInstallModal
          agentId={id}
          item={installItem}
          onClose={() => setInstallItem(null)}
          onInstalled={load}
        />
      ) : null}

      {add && id ? (
        <AddChannelModal
          agentId={id}
          cat={add}
          onClose={() => setAdd(null)}
          onDone={load}
        />
      ) : null}

      {slackSetup && id ? (
        <SlackSetup
          agentId={id}
          onClose={() => setSlackSetup(false)}
          onDone={load}
        />
      ) : null}

      {telegramSetup && id ? (
        <TelegramSetup
          agentId={id}
          onClose={() => setTelegramSetup(false)}
          onDone={load}
        />
      ) : null}

      {discordSetup && id ? (
        <DiscordSetup
          agentId={id}
          onClose={() => setDiscordSetup(false)}
          onDone={load}
        />
      ) : null}

      {twilioSetup && id ? (
        <TwilioSetup
          agentId={id}
          onClose={() => setTwilioSetup(false)}
          onDone={load}
        />
      ) : null}

      {buzzProfile && id ? (
        <BuzzProfileEdit
          agentId={id}
          onClose={() => setBuzzProfile(false)}
          onDone={load}
        />
      ) : null}

      {buzzSetup && id ? (
        <BuzzSetup
          agentId={id}
          onClose={() => setBuzzSetup(false)}
          onDone={load}
        />
      ) : null}

      {teamsSetup && id ? (
        <TeamsSetup
          agentId={id}
          onClose={() => setTeamsSetup(false)}
          onDone={load}
        />
      ) : null}

      {connectSetup && id ? (
        <ConnectSetup
          agentId={id}
          service={connectSetup}
          onClose={() => setConnectSetup(null)}
          onDone={load}
        />
      ) : null}

      {remove && id ? (
        <Modal
          onClose={() => setRemove(null)}
          title={`Remove ${CATALOG.find((x) => x.kind === (remove.kind ?? remove.name))?.label ?? remove.name}?`}
          width="max-w-md"
        >
          <div className="space-y-3 p-4">
            <p className="text-[13px] leading-relaxed text-muted">
              Deletes{" "}
              <span className="font-mono text-text">
                channels/{remove.name}.ts
              </span>{" "}
              from the agent. Redeploy for it to take effect. The Vercel Connect
              connector stays attached — remove that in Vercel if you no longer
              want it.
            </p>
            {removeErr ? (
              <div className="text-xs text-danger">{removeErr}</div>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button onClick={() => setRemove(null)} variant="ghost">
                Cancel
              </Button>
              <Button
                disabled={removing}
                onClick={async () => {
                  setRemoving(true);
                  setRemoveErr(null);
                  const r = await window.studio.agents.channelDelete(
                    id,
                    remove.name,
                  );
                  setRemoving(false);
                  if (r.ok) {
                    setRemove(null);
                    void load();
                  } else {
                    setRemoveErr(r.error ?? "Failed to remove.");
                  }
                }}
                variant="danger"
              >
                {removing ? "Removing…" : "Remove"}
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
