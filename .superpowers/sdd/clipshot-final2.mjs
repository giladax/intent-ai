// Final verification shots after the 19-fix layout wave.
// Server must be running on PORT (default 3471).
import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";

const PORT = process.env.PORT ?? 3471;
const BASE = `http://localhost:${PORT}`;
const OUT = process.env.OUT ?? ".superpowers/sdd/shots-feed-impl";

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true });

for (const [w, h, name] of [[1440, 900, "final2-1440.png"], [1728, 1080, "final2-1728.png"]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(4500); // entrances play out
  await page.screenshot({ path: `${OUT}/${name}` });
  console.log(`saved ${name} (${w}x${h})`);

  // Quick geometry probe: feed-stream width + left alignment vs chat column
  const metrics = await page.evaluate(() => {
    const stream = document.querySelector(".feed-stream");
    const chat = document.querySelector(".lc-chat");
    const h1 = document.querySelector(".feed-lead h1");
    return {
      streamW: stream?.getBoundingClientRect().width,
      streamX: stream?.getBoundingClientRect().x,
      chatW: chat?.getBoundingClientRect().width,
      h1Lines: h1 ? Math.round(h1.getBoundingClientRect().height / parseFloat(getComputedStyle(h1).lineHeight)) : null,
      h1Text: h1?.getAttribute("aria-label"),
    };
  });
  console.log("  metrics:", JSON.stringify(metrics));
  await ctx.close();
}

await browser.close();
