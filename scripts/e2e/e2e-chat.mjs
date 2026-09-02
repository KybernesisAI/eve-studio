// E2E: start the selected agent (header Start), open a new chat, send a message,
// wait for the reply, screenshot. usage: node e2e-chat.mjs <agentName> <target:Local|Deployed> <message> <outName>
import puppeteer from "puppeteer-core";
import { writeFileSync } from "node:fs";

const [, , agentName = "studio-e2e", target = "Local", message = "Reply with the single word pong.", out = "e2e-chat"] = process.argv;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.connect({ browserURL: "http://localhost:9222", defaultViewport: null });
const page = (await browser.pages()).find((p) => /localhost:5173|index\.html/.test(p.url()));
const dir = new URL("./shots/", import.meta.url).pathname;
const text = () => page.evaluate(() => document.body.innerText);
const click = (label, scope = "body") =>
  page.evaluate(
    (label, scope) => {
      const root = document.querySelector(scope) ?? document.body;
      const els = [...root.querySelectorAll("button, a, [role=tab], [role=button]")];
      const n = (s) => (s ?? "").replace(/\s+/g, " ").trim();
      const el = els.filter((e) => n(e.textContent) === label).sort((a, b) => a.textContent.length - b.textContent.length)[0];
      if (el) el.click();
      return Boolean(el);
    },
    label,
    scope,
  );

console.log("select", await click(agentName, "aside"));
await sleep(800);
if (target === "Local") {
  const t = await text();
  if (!/local · :\d+/.test(t)) {
    console.log("start", await click("Start"));
    const t0 = Date.now();
    while (Date.now() - t0 < 120_000) {
      await sleep(2000);
      const tt = await text();
      if (/local · :\d+/.test(tt) && /RUNNING/.test(tt)) break;
      if (/ERROR|failed to start/i.test(tt.slice(0, 600))) break;
    }
    console.log("status line:", (await text()).match(/local · [^\n|]+/)?.[0]);
  }
}
console.log("chat tab", await click("Chat"));
await sleep(500);
console.log("target", await click(target));
await sleep(400);
console.log("new chat", await click("New chat"));
await sleep(800);
// type into the composer
const typed = await page.evaluate((msg) => {
  const ta = document.querySelector("textarea");
  if (!ta) return false;
  ta.focus();
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
  setter.call(ta, msg);
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  return ta.placeholder;
}, message);
console.log("composer placeholder:", typed);
await sleep(300);
await page.keyboard.press("Enter");
await sleep(500);
// wait for the assistant reply or a failure
const t0 = Date.now();
let last = "";
while (Date.now() - t0 < 120_000) {
  await sleep(2000);
  last = await text();
  const afterYou = last.split(message).pop() ?? "";
  if (/pong/i.test(afterYou) || /failed/i.test(afterYou)) break;
}
const tail = last.split(message).pop()?.slice(0, 800);
console.log("after message:", JSON.stringify(tail));
writeFileSync(`${dir}${out}.png`, await page.screenshot({ type: "png" }));
writeFileSync(`${dir}${out}.txt`, last.slice(0, 6000));
browser.disconnect();
