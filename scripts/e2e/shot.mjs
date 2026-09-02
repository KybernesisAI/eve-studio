// Drive the Eve Studio renderer over CDP: run a small action script, screenshot.
// usage: node shot.mjs <outName> [js-expression-to-eval-before-shot] [waitMs]
import puppeteer from "puppeteer-core";
import { writeFileSync } from "node:fs";

const [, , out = "shot", expr = "", waitMs = "800"] = process.argv;
const browser = await puppeteer.connect({
  browserURL: "http://localhost:9222",
  defaultViewport: null,
});
const pages = await browser.pages();
const page = pages.find((p) => /localhost:5173|index\.html/.test(p.url())) ?? pages[0];
if (!page) {
  console.error("no renderer page found");
  process.exit(1);
}
if (expr) {
  try {
    const r = await page.evaluate(expr);
    if (r !== undefined) console.log("eval:", JSON.stringify(r).slice(0, 2000));
  } catch (e) {
    console.error("eval error:", e.message);
  }
}
await new Promise((r) => setTimeout(r, Number(waitMs)));
const png = await page.screenshot({ type: "png" });
const file = new URL(`./shots/${out}.png`, import.meta.url).pathname;
writeFileSync(file, png);
console.log("wrote", file);
// dump visible text of the main content for quick review
const text = await page.evaluate(() => document.body.innerText.slice(0, 6000));
writeFileSync(file.replace(/\.png$/, ".txt"), text);
browser.disconnect();
