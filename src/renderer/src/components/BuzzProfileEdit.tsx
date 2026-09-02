import { useEffect, useState } from "react";
import { IconCheck } from "../ui/icons";
import { Button, Input, Modal, Spinner } from "../ui/kit";

/**
 * Standalone Buzz profile editor, change the agent's name, bio, or avatar
 * without re-running the setup wizard. Prefills from the relay's current
 * kind:0 profile and pushes an updated one on save.
 */
export function BuzzProfileEdit({
  agentId,
  onClose,
  onDone,
}: {
  agentId: string;
  onClose: () => void;
  onDone: () => void;
}): JSX.Element {
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [about, setAbout] = useState("");
  const [currentPic, setCurrentPic] = useState<string | null>(null);
  const [avatarData, setAvatarData] = useState("");
  const [avatarMime, setAvatarMime] = useState("");
  const [avatarName, setAvatarName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void window.studio.buzz
      .getProfile(agentId)
      .then((p) => {
        if (p.ok) {
          setName(p.name ?? "");
          setAbout(p.about ?? "");
          setCurrentPic(p.picture ?? null);
        } else {
          setErr(p.error ?? "Couldn't load the current profile.");
        }
      })
      .finally(() => setLoading(false));
  }, [agentId]);

  const save = async (): Promise<void> => {
    setSaving(true);
    setErr(null);
    const r = await window.studio.buzz.setProfile(agentId, {
      name: name.trim(),
      about: about.trim() || undefined,
      avatarData: avatarData || undefined,
      avatarMime: avatarMime || undefined,
      // Retain the existing avatar when the user didn't pick a new one, kind:0
      // is replace-all, so omitting it would wipe the current picture.
      currentPicture: currentPic || undefined,
    });
    setSaving(false);
    if (r.ok) {
      setSaved(true);
      setTimeout(() => {
        onDone();
        onClose();
      }, 900);
    } else {
      setErr(r.error ?? "Couldn't push the profile.");
    }
  };

  return (
    <Modal onClose={onClose} title="Buzz profile" width="max-w-md">
      {loading ? (
        <div className="flex items-center justify-center p-8">
          <Spinner />
        </div>
      ) : (
        <div className="space-y-3 p-4">
          <div className="flex items-center gap-3">
            {currentPic ? (
              <img
                alt="Current avatar"
                className="h-10 w-10 rounded-lg object-cover"
                src={currentPic}
              />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-black/[0.06] text-sm font-semibold text-faint">
                {(name || "?")[0]}
              </div>
            )}
            <p className="text-2xs leading-relaxed text-muted">
              Changes push straight to the workspace: everyone sees them on the
              next refresh.
            </p>
          </div>
          <div>
            <div className="mb-1 text-xs font-medium text-muted">
              Display name{" "}
              <span className="text-faint">also wakes the agent on @mention</span>
            </div>
            <Input onChange={(e) => setName(e.target.value)} value={name} />
          </div>
          <div>
            <div className="mb-1 text-xs font-medium text-muted">Bio</div>
            <Input onChange={(e) => setAbout(e.target.value)} value={about} />
          </div>
          <div>
            <div className="mb-1 text-xs font-medium text-muted">
              Avatar{" "}
              <span className="text-faint">leave empty to keep the current one</span>
            </div>
            <input
              accept="image/png,image/jpeg,image/webp"
              className="block w-full text-2xs text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-black/[0.06] file:px-3 file:py-1.5 file:text-2xs file:font-medium file:text-text"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) {
                  setAvatarData("");
                  setAvatarName("");
                  return;
                }
                setAvatarMime(f.type || "image/png");
                setAvatarName(f.name);
                const reader = new FileReader();
                reader.onload = () => {
                  const s = String(reader.result ?? "");
                  setAvatarData(s.slice(s.indexOf(",") + 1));
                };
                reader.readAsDataURL(f);
              }}
              type="file"
            />
            {avatarName ? (
              <p className="mt-1 text-2xs text-faint">{avatarName} ready</p>
            ) : null}
          </div>
          {err ? <div className="text-xs text-danger">{err}</div> : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button onClick={onClose} variant="ghost">
              Cancel
            </Button>
            <Button
              disabled={saving || saved || !name.trim()}
              onClick={save}
              variant="primary"
            >
              {saving ? (
                <>
                  <Spinner /> Pushing…
                </>
              ) : saved ? (
                <>
                  <IconCheck className="h-3.5 w-3.5" /> Pushed
                </>
              ) : (
                "Push to Buzz"
              )}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
