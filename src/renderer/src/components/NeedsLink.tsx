import type { ModelReadiness, VercelTeam, VercelWhoami } from "@shared/ipc";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCliRun } from "../lib/useCli";
import { useStore } from "../store";
import { Console } from "../ui/Console";
import { IconPlug } from "../ui/icons";
import { Button, Kicker } from "../ui/kit";

/** Terminal cursor/erase codes the CLI emits even under NO_COLOR, strip for display. */
const stripAnsi = (s: string): string =>
  // eslint-disable-next-line no-control-regex
  s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").replace(/\x1b[()][AB012]/g, "");

/** The OAuth device URL the CLI prints, surfaced as a button for non-technical users. */
const DEVICE_URL_RE = /(https?:\/\/vercel\.com\/oauth\/device\?\S+)/;

/**
 * Shown in Chat when an agent has no model credential (not linked to Vercel).
 * Handles the whole no-terminal path: sign in to Vercel (browser OAuth, no email,
 * no terminal) → pick a team → link + pull the AI Gateway token.
 */
export function NeedsLink({
  agentId,
}: {
  agentId: string;
}): JSX.Element | null {
  const runtime = useStore((s) => s.runtime[agentId]);
  const stopAgent = useStore((s) => s.stopAgent);
  const startAgent = useStore((s) => s.startAgent);
  const bumpDeploy = useStore((s) => s.bumpDeploy);

  const [ready, setReady] = useState<ModelReadiness | null>(null);
  const [auth, setAuth] = useState<VercelWhoami | null>(null);
  const [teams, setTeams] = useState<VercelTeam[]>([]);
  const [team, setTeam] = useState("");
  const [busy, setBusy] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [output, setOutput] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [linked, setLinked] = useState(false);

  const login = useCliRun();

  const loadTeams = useCallback(async () => {
    const t = await window.studio.vercel.teams(agentId);
    if (t.ok) {
      setTeams(t.teams);
      setTeam((cur) => cur || t.teams[0]?.id || "");
    }
  }, [agentId]);

  const refresh = useCallback(async () => {
    const rd = await window.studio.vercel.modelReadiness(agentId);
    setReady(rd);
    if (rd.hasCredential) {
      return; // already linked: no need to probe Vercel auth/teams
    }
    const who = await window.studio.vercel.whoami(agentId);
    setAuth(who);
    if (who.authed) {
      await loadTeams();
    }
  }, [agentId, loadTeams]);

  useEffect(() => {
    setLinked(false);
    void refresh();
  }, [refresh]);

  // While the browser sign-in is in flight, poll whoami, the CLI writes the auth
  // once the user approves in the browser, so this is how we detect success.
  useEffect(() => {
    if (!signingIn) {
      return;
    }
    const iv = setInterval(async () => {
      const who = await window.studio.vercel.whoami(agentId);
      if (who.authed) {
        setSigningIn(false);
        setAuth(who);
        await loadTeams();
      }
    }, 3000);
    return () => clearInterval(iv);
  }, [signingIn, agentId, loadTeams]);

  // When the login process exits, resolve the outcome so the button can never
  // get stuck on "Waiting…": success (authed) advances; anything else surfaces
  // the CLI's output as an error and re-enables Sign in.
  useEffect(() => {
    if (!signingIn || login.exitCode === undefined) {
      return;
    }
    let cancelled = false;
    void (async () => {
      const who = await window.studio.vercel.whoami(agentId);
      if (cancelled) {
        return;
      }
      if (who.authed) {
        setSigningIn(false);
        setAuth(who);
        await loadTeams();
      } else {
        setSigningIn(false);
        setErr(
          "Sign-in didn't complete. Open the Vercel page in your browser and approve, then try again.",
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [login.exitCode, signingIn, agentId, loadTeams]);

  // The CLI prints (and tries to open) a device URL; make sure it opens even if
  // the sandboxed child couldn't, and only once per URL.
  const deviceUrl = useMemo(
    () => DEVICE_URL_RE.exec(login.output)?.[1] ?? null,
    [login.output],
  );
  const openedRef = useRef<string | null>(null);
  useEffect(() => {
    if (deviceUrl && openedRef.current !== deviceUrl) {
      openedRef.current = deviceUrl;
      window.open(deviceUrl, "_blank");
    }
  }, [deviceUrl]);

  // Kill an in-flight sign-in if the user navigates away. `login.cancel` is a
  // fresh closure each render, so hold it in a ref and run cleanup on unmount only
  // (depending on it directly would cancel the login on every render).
  const cancelRef = useRef(login.cancel);
  cancelRef.current = login.cancel;
  useEffect(() => () => cancelRef.current(), []);

  if (!ready || ready.hasCredential) {
    return null;
  }

  const signIn = async (): Promise<void> => {
    setErr(null);
    openedRef.current = null;
    setSigningIn(true);
    await login.start(() => window.studio.vercel.loginStart(agentId));
  };

  const cancelSignIn = (): void => {
    login.cancel();
    setSigningIn(false);
    setErr(null);
  };

  const connect = async (): Promise<void> => {
    setBusy(true);
    setErr(null);
    setOutput(
      "Connecting to Vercel: creating/linking the project and pulling the AI Gateway credential…\n",
    );
    const r = await window.studio.vercel.link(agentId, team || undefined);
    setOutput(r.output);
    const now = await window.studio.vercel.modelReadiness(agentId);
    setReady(now);
    setBusy(false);
    if (now.hasCredential) {
      setLinked(true);
      bumpDeploy();
      if (runtime?.status === "running") {
        await stopAgent(agentId);
        await startAgent(agentId);
      }
    } else {
      setErr(
        r.ok
          ? "Linking didn't produce a credential. Check the output below."
          : "Couldn't connect to Vercel. Check the output below, then try again.",
      );
    }
  };

  if (linked && ready.hasCredential) {
    return (
      <div className="flex items-center gap-2.5 border-b border-border bg-success/[0.06] px-5 py-2.5">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-success" />
        <span className="text-[13px] text-text">
          Connected to Vercel: the model can run now.{" "}
          <span className="text-muted">
            {runtime?.status === "running"
              ? "Restarted."
              : "Hit Start (top right), then chat."}
          </span>
        </span>
      </div>
    );
  }

  const authed = auth?.authed === true;

  return (
    <div className="border-b border-border bg-subtle px-5 py-3">
      <div className="flex items-center gap-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-panel text-faint">
          <IconPlug className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <Kicker className="mb-1">
            {authed ? "Not connected to Vercel" : "Sign in to Vercel"}
          </Kicker>
          <div className="text-[13px] leading-snug text-muted">
            {authed
              ? "This agent's model runs through the Vercel AI Gateway. Pick a team and connect. No terminal."
              : "This agent's model runs through the Vercel AI Gateway. Sign in in your browser to continue: no email, no terminal."}
          </div>
        </div>

        {auth === null ? (
          <span className="shrink-0 text-2xs text-faint">Checking…</span>
        ) : authed ? (
          <>
            {teams.length > 1 ? (
              <select
                value={team}
                onChange={(e) => setTeam(e.target.value)}
                disabled={busy}
                title="Vercel team"
                className="no-drag shrink-0 rounded-lg border border-border bg-panel px-2.5 py-1.5 text-[13px] text-text outline-none hover:border-border-strong focus:border-border-strong"
              >
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            ) : null}
            <Button
              variant="primary"
              size="sm"
              onClick={connect}
              disabled={busy}
            >
              {busy ? "Connecting…" : "Connect to Vercel"}
            </Button>
          </>
        ) : signingIn ? (
          <div className="flex shrink-0 items-center gap-2">
            {deviceUrl ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => window.open(deviceUrl, "_blank")}
              >
                Open sign-in ↗
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" onClick={cancelSignIn}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" disabled>
              Waiting…
            </Button>
          </div>
        ) : (
          <Button variant="primary" size="sm" onClick={signIn}>
            Sign in with Vercel
          </Button>
        )}
      </div>

      {!authed && (signingIn || login.output) ? (
        <div className="mt-2.5">
          <div className="mb-1.5 text-2xs text-muted">
            {deviceUrl
              ? "A Vercel sign-in page opened in your browser. Approve it there. This updates automatically."
              : "Opening the Vercel sign-in page in your browser: this updates automatically once you approve."}
          </div>
          <Console
            text={stripAnsi(login.output)}
            busy={signingIn}
            className="max-h-40"
          />
        </div>
      ) : null}

      {err ? <div className="mt-2 text-2xs text-danger">{err}</div> : null}
      {output && busy ? (
        <Console text={output} busy={busy} className="mt-2 max-h-40" />
      ) : null}
    </div>
  );
}
