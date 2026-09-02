import type { AppInfo } from "@shared/ipc";
import { EveLogo } from "../ui/EveLogo";
import { IconFolder, IconPlus } from "../ui/icons";
import { Button, Kicker } from "../ui/kit";

export function Welcome({
  onAdd,
  onCreate,
  info,
}: {
  onAdd: () => void;
  onCreate: () => void;
  info: AppInfo | null;
}): JSX.Element {
  return (
    <div className="relative flex h-full flex-col bg-bg text-text">
      <div className="titlebar-drag h-11 shrink-0" />

      <div className="flex flex-1 flex-col items-center justify-center px-6">
        <div className="flex w-full max-w-md flex-col items-center text-center">
          <EveLogo className="mb-7 h-16 w-auto" />
          <Kicker className="mb-4">Studio · Control center</Kicker>

          <h1 className="text-[28px] font-semibold leading-[1.1] tracking-tight text-text">
            Your Eve agents,
            <br />
            in one place.
          </h1>
          <p className="mt-3.5 max-w-sm text-[14px] leading-relaxed text-muted">
            Chat, inspect structure, wire memory, add integrations from the
            registry, and deploy — all local, all yours. Eve is Vercel's
            open-source agent framework.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-2.5">
            <Button
              variant="primary"
              size="md"
              onClick={onAdd}
              className="px-4"
            >
              <IconFolder className="h-4 w-4" />
              Add existing agent
            </Button>
            <Button
              variant="secondary"
              size="md"
              onClick={onCreate}
              className="px-4"
            >
              <IconPlus className="h-4 w-4" />
              Create new
            </Button>
          </div>

          <p className="mt-8 max-w-sm text-2xs leading-relaxed text-faint">
            Point at any Eve project folder (the one with an{" "}
            <code className="rounded bg-black/[0.05] px-1 font-mono">
              agent/
            </code>{" "}
            directory), or create one — that installs eve@latest (0.49+) and
            needs Node 24. Studio spawns its dev server and talks to it
            locally. Docs: https://eve.dev/docs
          </p>
        </div>
      </div>

      <div className="pb-4 text-center font-spacemono text-[10px] uppercase tracking-[0.14em] text-faint">
        {info
          ? `v${info.appVersion} · electron ${info.electron} · node ${info.node}`
          : ""}
      </div>
    </div>
  );
}
