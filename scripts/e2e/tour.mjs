// Tour every view for the selected agent: click tab labels, screenshot + text dump.
// usage: node tour.mjs [agentName] [prefix]
import puppeteer from "puppeteer-core";
import { writeFileSync } from "node:fs";

const [, , agentName = "eve-gtm", prefix = "t"] = process.argv;
const browser = await puppeteer.connect({ browserURL: "http://localhost:9222", defaultViewport: null });
const pages = await browser.pages();
const page = pages.find((p) => /localhost:5173|index\.html/.test(p.url())) ?? pages[0];
const dir = new URL("./shots/", import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Click the smallest clickable element (button/a/role=tab/role=button) whose own text
// starts with `label` (tab labels often carry a count badge, e.g. "Tools 11").
async function clickText(label, within = "body") {
  return page.evaluate(
    (label, within) => {
      const root = document.querySelector(within) ?? document.body;
      const norm = (s) => (s ?? "").replace(/\s+/g, " ").trim();
      const els = [...root.querySelectorAll("button, a, [role=tab], [role=button]")];
      let cands = els.filter((e) => norm(e.textContent) === label);
      if (!cands.length) cands = els.filter((e) => /^\S/.test(norm(e.textContent)) && new RegExp("^" + label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(\\s+\\d+)?$").test(norm(e.textContent)));
      if (!cands.length) cands = els.filter((e) => norm(e.textContent).startsWith(label));
      if (!cands.length) return false;
      cands.sort((a, b) => a.textContent.length - b.textContent.length);
      cands[0].click();
      return norm(cands[0].textContent);
    },
    label,
    within,
  );
}

async function shot(name) {
  await sleep(1000);
  const png = await page.screenshot({ type: "png" });
  writeFileSync(`${dir}${prefix}-${name}.png`, png);
  const text = await page.evaluate(() => document.body.innerText.slice(0, 8000));
  writeFileSync(`${dir}${prefix}-${name}.txt`, text);
  console.log("shot", name);
}

// select agent from the left rail (aside/nav)
let sel = await clickText(agentName, "aside");
if (!sel) sel = await clickText(agentName, "nav");
if (!sel) sel = await clickText(agentName);
console.log("select agent:", sel);
await sleep(800);

const tabs = [
  ["Chat", "chat"],
  ["Instructions", "instructions"],
  ["Capabilities", "capabilities"],
  ["Integrations", "integrations"],
  ["Memory", "memory"],
  ["Schedules", "schedules"],
  ["Deploy", "deploy"],
  ["Evals", "evals"],
];
for (const [label, name] of tabs) {
  const ok = await clickText(label);
  console.log("tab", label, ok);
  await shot(`10-${name}`);
  if (name === "instructions") {
    console.log("sub", await clickText("Model"));
    await shot(`11-instr-model`);
  }
  if (name === "capabilities") {
    for (const sub of ["Tools", "Skills", "Subagents", "Hooks"]) {
      console.log("sub", await clickText(sub));
      await shot(`11-cap-${sub.toLowerCase()}`);
    }
  }
  if (name === "integrations") {
    console.log("sub", await clickText("Channels"));
    await shot(`12-int-channels`);
  }
  if (name === "deploy") {
    for (const sub of ["Environment", "Sandbox", "Logs", "Deploy"]) {
      const ok2 = await clickText(sub);
      console.log("sub", sub, ok2);
      if (ok2) await shot(`13-deploy-${sub.toLowerCase()}`);
    }
  }
}
console.log("settings", await clickText("Settings"));
await shot("20-settings");
browser.disconnect();
