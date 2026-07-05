// Playwright verification of the lens-chat implementation.
// Uses playwright-core + chromium.launch({ channel: "chrome" }) (bundled
// browsers not available; uses system Chrome).

import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";

const PORT = 3465;
const BASE = `http://localhost:${PORT}`;
const OUT = ".superpowers/sdd/shots-lens-chat-impl";

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

console.log("01 — Arrival state");
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(3000); // let animations settle
await page.screenshot({ path: `${OUT}/01-arrival.png`, fullPage: false });
console.log("   saved 01-arrival.png");

console.log("02 — Feature lens focus");
// Click the 01 FEATURE lens box
await page.click(".lc-lens--feature");
await page.waitForTimeout(1000); // rail fade + stagger
await page.screenshot({ path: `${OUT}/02-lens-focus.png`, fullPage: false });
console.log("   saved 02-lens-focus.png");

// Click the first feature in the list
const firstFeatureItem = page.locator(".lc-flist-item").first();
if (await firstFeatureItem.count() > 0) {
  await firstFeatureItem.click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/02b-feature-selected.png`, fullPage: false });
  console.log("   saved 02b-feature-selected.png");
}

console.log("03 — Scoped ask");
const input = page.locator(".lc-ask input");
await input.click();
await input.fill("What is the current state of this feature?");
await page.screenshot({ path: `${OUT}/03-scoped-ask.png`, fullPage: false });

await input.press("Enter");
await page.waitForTimeout(8000); // wait for streaming response
await page.screenshot({ path: `${OUT}/03b-conversation.png`, fullPage: false });
console.log("   saved 03-scoped-ask.png, 03b-conversation.png");

console.log("04 — Clear scope with × tag");
const scopeTag = page.locator(".lc-scopetag");
if (await scopeTag.count() > 0) {
  await scopeTag.click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/04-scope-cleared.png`, fullPage: false });
  console.log("   saved 04-scope-cleared.png");
}

console.log("05 — Approval card (if pending observations exist)");
const approveBtn = page.locator(".lc-btn--approve").first();
if (await approveBtn.count() > 0) {
  await page.screenshot({ path: `${OUT}/05-approval-pending.png`, fullPage: false });
  await approveBtn.click();
  await page.waitForTimeout(1200); // stamp animation
  await page.screenshot({ path: `${OUT}/05b-approval-sealed.png`, fullPage: false });
  console.log("   saved 05-approval-pending.png, 05b-approval-sealed.png");
} else {
  console.log("   no pending observations — skipping approval shots");
}

console.log("06 — Ledger toggle (classic shell)");
const ledgerBtn = page.locator(".lc-ledger-toggle");
if (await ledgerBtn.count() > 0) {
  await ledgerBtn.click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/06-classic-shell.png`, fullPage: false });
  console.log("   saved 06-classic-shell.png");
}

await browser.close();
console.log(`\nAll shots saved to ${OUT}/`);
