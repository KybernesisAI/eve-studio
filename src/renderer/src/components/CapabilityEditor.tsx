import type { CapabilityFile, CapabilityKind } from "@shared/ipc";
import { useCallback, useEffect, useState } from "react";
import { IconTrash } from "../ui/icons";
import { Button, Kicker, Modal, Spinner } from "../ui/kit";

/**
 * Open, edit, and delete a path-based capability (tool, skill, subagent, hook,
 * schedule). Single-file kinds show one editor; skills show SKILL.md; subagents
 * show agent.ts + instructions.md via a file switcher.
 */
export function CapabilityEditor({
  agentId,
  kind,
  name,
  onClose,
  onChanged,
}: {
  agentId: string;
  kind: CapabilityKind;
  name: string;
  onClose: () => void;
  onChanged: () => void;
}): JSX.Element {
  const [files, setFiles] = useState<CapabilityFile[] | null>(null);
  const [others, setOthers] = useState<string[]>([]);
  const [missing, setMissing] = useState(false);
  const [active, setActive] = useState(0);
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<null | "save" | "delete">(null);
  const [saved, setSaved] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await window.studio.agents.capabilityFiles(agentId, kind, name);
      setFiles(r.files);
      setOthers(r.otherPaths);
      setMissing(r.missing);
    } catch {
      // Read failed on disk, resolve the spinner into the fallback message.
      setFiles([]);
      setMissing(true);
    }
  }, [agentId, kind, name]);

  useEffect(() => {
    void load();
  }, [load]);

  const edit = (idx: number, content: string): void => {
    if (!files) {
      return;
    }
    const { relPath } = files[idx];
    setFiles(files.map((f, i) => (i === idx ? { ...f, content } : f)));
    setDirty((d) => ({ ...d, [relPath]: true }));
    setSaved(false);
  };

  const save = async (): Promise<void> => {
    if (!files) {
      return;
    }
    setBusy("save");
    setErr(null);
    for (const f of files) {
      if (dirty[f.relPath]) {
        const r = await window.studio.agents.capabilityWrite(
          agentId,
          f.relPath,
          f.content,
        );
        if (!r.ok) {
          setErr(r.error ?? `Failed to save ${f.relPath}.`);
          setBusy(null);
          return;
        }
      }
    }
    setBusy(null);
    setDirty({});
    setSaved(true);
    onChanged();
    setTimeout(() => setSaved(false), 1500);
  };

  const del = async (): Promise<void> => {
    setBusy("delete");
    const r = await window.studio.agents.capabilityDelete(agentId, kind, name);
    setBusy(null);
    if (!r.ok) {
      setErr(r.error ?? "Failed to delete.");
      return;
    }
    onChanged();
    onClose();
  };

  const hasDirty = Object.values(dirty).some(Boolean);
  const file = files?.[active];

  return (
    <Modal title={`${kind} · ${name}`} onClose={onClose} width="max-w-3xl">
      <div className="flex min-h-0 flex-col">
        {files === null ? (
          <div className="flex h-64 items-center justify-center text-faint">
            <Spinner />
          </div>
        ) : missing || files.length === 0 ? (
          <div className="px-5 py-12 text-center text-[13px] text-muted">
            Couldn't find this {kind}'s source on disk. It may live inside a
            subagent or extension.
          </div>
        ) : (
          <>
            {files.length > 1 ? (
              <div className="flex items-center gap-1 border-b border-border px-5 pb-2">
                {files.map((f, i) => (
                  <button
                    key={f.relPath}
                    type="button"
                    onClick={() => setActive(i)}
                    className={`rounded-md px-2.5 py-1 font-mono text-xs transition-colors ${
                      i === active
                        ? "bg-black/[0.06] text-text"
                        : "text-muted hover:text-text"
                    }`}
                  >
                    {f.relPath.split("/").pop()}
                    {dirty[f.relPath] ? (
                      <span className="ml-1 text-warn">•</span>
                    ) : null}
                  </button>
                ))}
              </div>
            ) : null}

            {file ? (
              <div className="px-5 pt-3">
                <div className="mb-1.5 font-mono text-2xs text-faint">
                  {file.relPath}
                </div>
                <textarea
                  value={file.content}
                  onChange={(e) => edit(active, e.target.value)}
                  spellCheck={false}
                  className="h-[52vh] w-full resize-none rounded-lg border border-border bg-subtle p-3 font-mono text-[12.5px] leading-relaxed text-text outline-none focus:border-border-strong"
                />
              </div>
            ) : null}

            {others.length > 0 ? (
              <div className="px-5 pt-2.5">
                <Kicker className="mb-1">Also includes</Kicker>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-2xs text-faint">
                  {others.map((p) => (
                    <span key={p}>{p.split("/").slice(-2).join("/")}</span>
                  ))}
                </div>
              </div>
            ) : null}

            {err ? (
              <div className="px-5 pt-2 text-xs text-danger">{err}</div>
            ) : null}

            <div className="flex items-center justify-between gap-2 px-5 py-4">
              {confirmDel ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted">
                    Delete this {kind}?
                  </span>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={del}
                    disabled={busy !== null}
                  >
                    {busy === "delete" ? "Deleting…" : "Confirm delete"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmDel(false)}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmDel(true)}
                  disabled={busy !== null}
                >
                  <IconTrash className="h-3.5 w-3.5" />
                  Delete
                </Button>
              )}
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={onClose}>
                  Close
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={save}
                  disabled={busy !== null || !hasDirty}
                >
                  {busy === "save" ? "Saving…" : saved ? "Saved ✓" : "Save"}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
