import { useEffect, useState } from "react";
import { useActiveStructure } from "../lib/useStructure";
import { useStore } from "../store";
import { SubNav } from "../ui/kit";
import { Channels } from "./Channels";
import { Connections } from "./Connections";
import { Deploy } from "./Deploy";
import { Environment } from "./Environment";
import { Hooks } from "./Hooks";
import { Instructions } from "./Instructions";
import { Model } from "./Model";
import { Sandbox } from "./Sandbox";
import { Skills } from "./Skills";
import { Subagents } from "./Subagents";
import { Tools } from "./Tools";

/** Prompt + Model. */
export function InstructionsGroup(): JSX.Element {
  const [sub, setSub] = useState("prompt");
  return (
    <div className="flex h-full flex-col">
      <SubNav
        items={[
          { id: "prompt", label: "Prompt" },
          { id: "model", label: "Model" },
        ]}
        active={sub}
        onChange={setSub}
      />
      <div className="min-h-0 flex-1">
        {sub === "prompt" ? <Instructions /> : <Model />}
      </div>
    </div>
  );
}

/** Tools + Skills + Subagents + Hooks. */
export function CapabilitiesGroup(): JSX.Element {
  const { structure } = useActiveStructure();
  const [sub, setSub] = useState("tools");
  return (
    <div className="flex h-full flex-col">
      <SubNav
        items={[
          { id: "tools", label: "Tools", count: structure?.tools.length },
          { id: "skills", label: "Skills", count: structure?.skills.length },
          {
            id: "subagents",
            label: "Subagents",
            count: structure?.subagents.length,
          },
          { id: "hooks", label: "Hooks", count: structure?.hooks.length },
        ]}
        active={sub}
        onChange={setSub}
      />
      <div className="min-h-0 flex-1">
        {sub === "tools" ? (
          <Tools />
        ) : sub === "skills" ? (
          <Skills />
        ) : sub === "subagents" ? (
          <Subagents />
        ) : (
          <Hooks />
        )}
      </div>
    </div>
  );
}

/** Connections + Channels. */
export function IntegrationsGroup(): JSX.Element {
  const { structure } = useActiveStructure();
  const [sub, setSub] = useState("connections");
  return (
    <div className="flex h-full flex-col">
      <SubNav
        items={[
          {
            id: "connections",
            label: "Connections",
            count: structure?.connections.length,
          },
          {
            id: "channels",
            label: "Channels",
            count: structure?.channels.length,
          },
        ]}
        active={sub}
        onChange={setSub}
      />
      <div className="min-h-0 flex-1">
        {sub === "connections" ? <Connections /> : <Channels />}
      </div>
    </div>
  );
}

/** Deploy & Logs + Environment + Sandbox. */
export function DeployGroup(): JSX.Element {
  // The header's "Link & deploy" jumps straight to the Environment sub-tab.
  const deploySub = useStore((s) => s.deploySub);
  const [sub, setSub] = useState<string>(deploySub);
  useEffect(() => {
    setSub(deploySub);
  }, [deploySub]);
  return (
    <div className="flex h-full flex-col">
      <SubNav
        items={[
          { id: "deploy", label: "Deploy & Logs" },
          { id: "environment", label: "Environment" },
          { id: "sandbox", label: "Sandbox" },
        ]}
        active={sub}
        onChange={setSub}
      />
      <div className="min-h-0 flex-1">
        {sub === "deploy" ? (
          <Deploy />
        ) : sub === "environment" ? (
          <Environment />
        ) : (
          <Sandbox />
        )}
      </div>
    </div>
  );
}
