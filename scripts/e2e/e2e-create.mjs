// E2E step 1: create a new agent through the app's own create IPC (the folder
// picker is a native dialog, so we pass the parent dir directly), wait for
// `eve init` to finish, register it, and select it in the sidebar.
import puppeteer from "puppeteer-core";
import { existsSync, writeFileSync } from "node:fs";

const parentDir = process.env.E2E_PARENT_DIR ?? process.env.HOME;
const name = process.argv[2] ?? "studio-e2e";
const model = "openai/gpt-5.6-luna-fast";
const dir = `${parentDir}/${name}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.connect({ browserURL: "http://localhost:9222", defaultViewport: null });
const page = (await browser.pages()).find((p) => /localhost:5173|index\.html/.test(p.url()));
const outDir = new URL("./shots/", import.meta.url).pathname;

if (existsSync(dir)) {
  console.log("dir exists, skipping create:", dir);
} else {
  // Mirror CreateAgent.tsx: subscribe to the console stream, then create.
  const runId = await page.evaluate(
    async (input) => {
      window.__e2eLog = [];
      window.__e2eExit = null;
      window.studio.cli.onChunk?.((m) => window.__e2eLog.push(m.data ?? m));
      window.studio.cli.onExit?.((m) => (window.__e2eExit = m));
      return window.studio.agents.create(input);
    },
    { parentDir, name, model },
  );
  console.log("create runId:", runId);
  const t0 = Date.now();
  while (Date.now() - t0 < 6 * 60_000) {
    await sleep(3000);
    const exit = await page.evaluate(() => window.__e2eExit);
    if (exit) {
      console.log("init exit:", JSON.stringify(exit));
      break;
    }
  }
  const log = await page.evaluate(() => (window.__e2eLog || []).join(""));
  writeFileSync(`${outDir}e2e-init.log`, log);
  console.log("init log tail:", log.slice(-600));
}
const ok = existsSync(`${dir}/node_modules/eve/package.json`) && existsSync(`${dir}/agent/instructions.md`);
console.log("scaffold present:", ok);
const reg = await page.evaluate((d) => window.studio.agents.register(d), dir);
console.log("register:", JSON.stringify(reg).slice(0, 300));
await page.evaluate(() => window.dispatchEvent(new Event("focus")));
await sleep(1500);
const sel = await page.evaluate((n) => {
  const els = [...document.querySelectorAll("aside button, aside a, aside [role=button]")];
  const el = els.find((e) => e.textContent.replace(/\s+/g, " ").trim() === n);
  if (el) el.click();
  return Boolean(el);
}, name);
console.log("selected in sidebar:", sel);
await sleep(1500);
writeFileSync(`${outDir}e2e-01-created.png`, await page.screenshot({ type: "png" }));
writeFileSync(`${outDir}e2e-01-created.txt`, await page.evaluate(() => document.body.innerText.slice(0, 3000)));
browser.disconnect();
