// E2E: deploy the selected agent from the Deploy tab and wait for the URL.
import puppeteer from "puppeteer-core";
import { writeFileSync } from "node:fs";

const [, , agentName = "studio-e2e", out = "e2e-deploy"] = process.argv;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.connect({ browserURL: "http://localhost:9222", defaultViewport: null });
const page = (await browser.pages()).find((p) => /localhost:5173|index\.html/.test(p.url()));
const dir = new URL("./shots/", import.meta.url).pathname;
const text = () => page.evaluate(() => document.body.innerText);
const clickNth = (label, nth, scope = "body") =>
  page.evaluate(
    (label, nth, scope) => {
      const root = document.querySelector(scope) ?? document.body;
      const n = (s) => (s ?? "").replace(/\s+/g, " ").trim();
      const els = [...root.querySelectorAll("button, a, [role=tab]")].filter((e) => n(e.textContent) === label);
      const el = els[nth];
      if (el) el.click();
      return els.length;
    },
    label,
    nth,
    scope,
  );

await clickNth(agentName, 0, "aside");
await sleep(600);
// Tab "Deploy" (the tab bar button), then sub-tab "Deploy & Logs"
const tabs = await clickNth("Deploy", 1); // 0 = header button, 1 = tab
console.log("deploy buttons found:", tabs);
await sleep(600);
await clickNth("Deploy & Logs", 0);
await sleep(600);
// The panel's Deploy button is the last "Deploy"-labelled button
const count = await page.evaluate(() => {
  const n = (s) => (s ?? "").replace(/\s+/g, " ").trim();
  const els = [...document.querySelectorAll("button")].filter((e) => n(e.textContent) === "Deploy");
  els[els.length - 1]?.click();
  return els.length;
});
console.log("clicked panel Deploy; Deploy buttons:", count);
const t0 = Date.now();
let last = "";
let url = null;
while (Date.now() - t0 < 10 * 60_000) {
  await sleep(5000);
  last = await text();
  const m = last.match(/https:\/\/[a-z0-9-]+\.vercel\.app/g);
  const done = /exit(ed)? (code )?\d|Deployed|Production:|deployment (failed|error)|Error!/i.test(last);
  if (m && done) {
    url = m[m.length - 1];
    break;
  }
  if (/Error!|failed/i.test(last.slice(-1500)) && Date.now() - t0 > 60_000) break;
}
console.log("deploy url:", url);
const out1 = last.split("COMMAND OUTPUT")[1]?.slice(0, 1500);
console.log("console:", JSON.stringify(out1));
writeFileSync(`${dir}${out}.png`, await page.screenshot({ type: "png" }));
writeFileSync(`${dir}${out}.txt`, last.slice(0, 8000));
browser.disconnect();
