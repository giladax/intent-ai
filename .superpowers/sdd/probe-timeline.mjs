import { chromium } from "playwright-core";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto("http://localhost:3471", { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
await page.locator(".lc-lens--timeline").click();
await page.waitForTimeout(800);
await page.locator(".lc-lens--timeline .lc-flist-item", { hasText: "this week" }).first().click();
await page.waitForTimeout(1800);
const rows = await page.locator(".lc-sessionrow").count();
console.log("session rows (this week):", rows);
const firstRow = await page.locator(".lc-sessionrow").first().textContent().catch(() => null);
console.log("first row:", firstRow?.trim().slice(0, 110));
await page.screenshot({ path: ".superpowers/sdd/shots-feed-impl/final2-timeline.png" });
if (rows > 0) {
  await page.locator(".lc-sessionrow").first().click();
  await page.waitForTimeout(1500);
  const url = page.url();
  const body = await page.evaluate(() => document.body.innerText.slice(0, 100).replace(/\n/g, " | "));
  console.log("after click:", body);
}
await browser.close();
