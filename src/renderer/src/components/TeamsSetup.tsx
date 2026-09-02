import type { TeamsVerifyResult } from "@shared/ipc";
import { useEffect, useState } from "react";
import { useStore } from "../store";
import { IconCheck, IconExternal, IconRocket } from "../ui/icons";
import { Button, Input, Modal, Spinner } from "../ui/kit";

/** Messaging-endpoint URL the Azure Bot must point at. */
function endpointUrlFrom(base: string): string {
  const b = base.trim().replace(/\/+$/, "");
  return b ? (/\/eve\/v1\/teams$/.test(b) ? b : `${b}/eve/v1/teams`) : "";
}

/**
 * Guided Microsoft Teams setup. Verify the Azure Bot credentials (App ID + client
 * secret) by minting a Bot Connector token (exactly what inbound Activities do),
 * save them to Vercel + write the channel file, then hand the user the exact
 * messaging endpoint URL to paste into the Azure portal (Azure has no API to set
 * it, so this step is copy-paste rather than automatic).
 */
export function TeamsSetup({
  agentId,
  onClose,
  onDone,
}: {
  agentId: string;
  onClose: () => void;
  onDone: () => void;
}): JSX.Element {
  const setSection = useStore((s) => s.setSection);
  const [step, setStep] = useState(0);

  // Step 1: credentials
  const [appId, setAppId] = useState("");
  const [password, setPassword] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState<TeamsVerifyResult | null>(null);
  const [verifyErr, setVerifyErr] = useState<string | null>(null);

  // Step 2: save
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  // Step 3: endpoint
  const [endpoint, setEndpoint] = useState("");
  const [loadingUrl, setLoadingUrl] = useState(false);
  const [copied, setCopied] = useState(false);

  const verify = async (): Promise<void> => {
    setVerifying(true);
    setVerifyErr(null);
    const r = await window.studio.teams.verify(
      appId.trim(),
      password.trim(),
      tenantId.trim() || undefined,
    );
    setVerifying(false);
    if (r.ok) {
      setVerified(r);
    } else {
      setVerified(null);
      setVerifyErr(r.error ?? "Couldn't verify those credentials.");
    }
  };

  const saveCreds = async (): Promise<void> => {
    setSaving(true);
    setSaveErr(null);
    const a = await window.studio.vercel.envSetAll(
      agentId,
      "MICROSOFT_APP_ID",
      appId.trim(),
    );
    const p = await window.studio.vercel.envSetAll(
      agentId,
      "MICROSOFT_APP_PASSWORD",
      password.trim(),
    );
    let tenantOk = true;
    if (tenantId.trim()) {
      const t = await window.studio.vercel.envSetAll(
        agentId,
        "MICROSOFT_TENANT_ID",
        tenantId.trim(),
      );
      tenantOk = t.ok;
    }
    const w = await window.studio.agents.channelWrite(agentId, {
      kind: "teams",
      overwrite: true,
    });
    await window.studio.teams.save(agentId, {
      appId: appId.trim(),
      appPassword: password.trim(),
      tenantId: tenantId.trim() || undefined,
    });
    if (
      a.ok &&
      p.ok &&
      tenantOk &&
      (w.ok || w.error?.includes("already exists"))
    ) {
      setSaved(true);
    } else {
      setSaveErr(
        !a.ok || !p.ok || !tenantOk
          ? "Couldn't save the credentials to Vercel. Check you're linked."
          : (w.error ?? "Couldn't write the channel file."),
      );
    }
    setSaving(false);
  };

  useEffect(() => {
    if (step !== 3 || endpoint) {
      return;
    }
    setLoadingUrl(true);
    void window.studio.vercel
      .prodAlias(agentId)
      .then((p) => {
        if (p.ok && p.url) {
          setEndpoint(endpointUrlFrom(p.url));
        }
      })
      .finally(() => setLoadingUrl(false));
  }, [step, agentId, endpoint]);

  const STEPS = ["How it works", "Azure Bot", "Save", "Endpoint"];

  return (
    <Modal onClose={onClose} title="Set up Microsoft Teams" width="max-w-xl">
      <div className="p-4">
        {/* Step rail */}
        <div className="mb-4 flex items-center gap-1.5">
          {STEPS.map((label, i) => (
            <div className="flex flex-1 items-center gap-1.5" key={label}>
              <div
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
                  i < step
                    ? "bg-success text-white"
                    : i === step
                      ? "bg-text text-white"
                      : "bg-black/[0.06] text-faint"
                }`}
              >
                {i < step ? <IconCheck className="h-3 w-3" /> : i + 1}
              </div>
              {i < STEPS.length - 1 ? (
                <div
                  className={`h-px flex-1 ${i < step ? "bg-success" : "bg-border"}`}
                />
              ) : null}
            </div>
          ))}
        </div>

        {/* Step 0: explainer */}
        {step === 0 ? (
          <div className="space-y-3">
            <p className="text-[13px] leading-relaxed text-muted">
              Teams talks to your agent through an <strong>Azure Bot</strong>.
              Three steps:
            </p>
            <ul className="space-y-1.5 text-[13px] text-muted">
              <li>
                <strong className="text-text">1. Azure Bot</strong>: create it,
                copy the App ID + a client secret, verify here.
              </li>
              <li>
                <strong className="text-text">2. Save</strong>: credentials to
                Vercel + the channel file, no env tab.
              </li>
              <li>
                <strong className="text-text">3. Endpoint</strong>: paste your
                agent's messaging endpoint into the Azure Bot.
              </li>
            </ul>
            <p className="text-2xs text-faint">
              Teams only reaches the <em>deployed</em> agent, and it must be
              publicly reachable (Vercel Deployment Protection off for
              Production).
            </p>
          </div>
        ) : null}

        {/* Step 1: Azure Bot credentials */}
        {step === 1 ? (
          <div className="space-y-3">
            <ol className="space-y-1.5 text-[13px] text-muted">
              <li>
                1. In the{" "}
                <a
                  className="inline-flex items-center gap-1 text-accent hover:underline"
                  href="https://portal.azure.com/#create/Microsoft.AzureBot"
                  rel="noreferrer"
                  target="_blank"
                >
                  Azure portal <IconExternal className="h-3 w-3" />
                </a>{" "}
                create an <strong>Azure Bot</strong> (multi-tenant).
              </li>
              <li>
                2. Copy the <strong>Microsoft App ID</strong>, then under
                Certificates &amp; secrets create a{" "}
                <strong>client secret</strong> and copy its value.
              </li>
              <li>
                3. Paste both below (tenant id only for single-tenant bots).
              </li>
            </ol>
            <Input
              className="font-mono"
              onChange={(e) => {
                setAppId(e.target.value);
                setVerified(null);
              }}
              placeholder="Microsoft App ID"
              value={appId}
            />
            <Input
              className="font-mono"
              onChange={(e) => {
                setPassword(e.target.value);
                setVerified(null);
              }}
              placeholder="Client secret"
              type="password"
              value={password}
            />
            <div className="flex gap-2">
              <Input
                className="flex-1 font-mono"
                onChange={(e) => {
                  setTenantId(e.target.value);
                  setVerified(null);
                }}
                placeholder="Tenant ID (single-tenant only, optional)"
                value={tenantId}
              />
              <Button
                disabled={
                  verifying ||
                  !appId.trim() ||
                  !password.trim() ||
                  Boolean(verified)
                }
                onClick={verify}
                variant={verified ? "secondary" : "primary"}
              >
                {verifying ? (
                  <>
                    <Spinner /> Checking…
                  </>
                ) : verified ? (
                  <>
                    <IconCheck className="h-3.5 w-3.5" /> Verified
                  </>
                ) : (
                  "Verify"
                )}
              </Button>
            </div>
            {verified ? (
              <div className="rounded-lg bg-success/10 px-3 py-2 text-[13px] text-success">
                Credentials valid. Azure issued a Bot Connector token.
              </div>
            ) : null}
            {verifyErr ? (
              <div className="text-xs text-danger">{verifyErr}</div>
            ) : null}
          </div>
        ) : null}

        {/* Step 2: save */}
        {step === 2 ? (
          <div className="space-y-3">
            <p className="text-[13px] leading-relaxed text-muted">
              Save to Vercel (all environments) and write{" "}
              <span className="font-mono text-text">channels/teams.ts</span>:
            </p>
            <div className="space-y-1.5 rounded-lg border border-border bg-subtle p-3 text-2xs">
              {[
                ["MICROSOFT_APP_ID", appId.trim()],
                ["MICROSOFT_APP_PASSWORD", "••••••"],
                ...(tenantId.trim()
                  ? [["MICROSOFT_TENANT_ID", tenantId.trim()]]
                  : []),
              ].map(([k, v]) => (
                <div
                  className="flex items-center justify-between gap-2"
                  key={k}
                >
                  <span className="font-mono text-muted">{k}</span>
                  <span className="truncate font-mono text-faint">{v}</span>
                </div>
              ))}
            </div>
            <Button
              disabled={saving || saved}
              onClick={saveCreds}
              variant={saved ? "secondary" : "primary"}
            >
              {saving ? (
                <>
                  <Spinner /> Saving…
                </>
              ) : saved ? (
                <>
                  <IconCheck className="h-3.5 w-3.5" /> Saved &amp; channel
                  added
                </>
              ) : (
                "Save credentials & add channel"
              )}
            </Button>
            {saveErr ? (
              <div className="text-xs text-danger">{saveErr}</div>
            ) : null}
          </div>
        ) : null}

        {/* Step 3: endpoint */}
        {step === 3 ? (
          <div className="space-y-3">
            <p className="text-[13px] leading-relaxed text-muted">
              In the Azure portal, open your Bot →{" "}
              <strong>Configuration</strong> →{" "}
              <strong>Messaging endpoint</strong>, paste this, and Apply:
            </p>
            <div className="flex gap-2">
              <Input
                className="flex-1 font-mono text-[12px]"
                disabled={loadingUrl}
                onChange={(e) => setEndpoint(e.target.value)}
                placeholder={
                  loadingUrl
                    ? "Finding your deployment…"
                    : "https://your-agent.vercel.app/eve/v1/teams"
                }
                value={endpoint}
              />
              <Button
                disabled={!endpoint.trim()}
                onClick={() => {
                  void navigator.clipboard.writeText(endpoint.trim());
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                variant="secondary"
              >
                {copied ? (
                  <>
                    <IconCheck className="h-3.5 w-3.5" /> Copied
                  </>
                ) : (
                  "Copy"
                )}
              </Button>
            </div>
            {!loadingUrl && !endpoint ? (
              <p className="text-2xs text-faint">
                No deployment found yet. Deploy first, then copy the endpoint
                here.
              </p>
            ) : null}
            <p className="text-2xs text-faint">
              Azure has no API to set this, so it's the one manual paste. Once
              applied and the agent is deployed, Teams messages reach it.
            </p>
          </div>
        ) : null}

        {/* Nav */}
        <div className="mt-5 flex items-center justify-between">
          <Button
            disabled={step === 0}
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            variant="ghost"
          >
            Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button
              disabled={(step === 1 && !verified) || (step === 2 && !saved)}
              onClick={() => setStep((s) => s + 1)}
              variant="primary"
            >
              Next
            </Button>
          ) : (
            <Button
              onClick={() => {
                onDone();
                onClose();
                setSection("deploy");
              }}
              variant="primary"
            >
              <IconRocket className="h-3.5 w-3.5" /> Deploy
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
