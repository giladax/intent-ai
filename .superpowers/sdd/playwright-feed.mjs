// Playwright verification for THE FEED — screenshots each beat from
// mockups/feed/. Server must be running on PORT (default 3466).
import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";

const PORT = process.env.PORT ?? 3466;
const BASE = `http://localhost:${PORT}`;
const OUT = process.env.OUT ?? ".superpowers/sdd/shots-feed-impl";

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

// Seed an old last-seen so the while-you-were-away card has a real gap.
await ctx.addInitScript(() => {
  if (!localStorage.getItem("quire-last-seen")) {
    localStorage.setItem("quire-last-seen", new Date(Date.now() - 30 * 3_600_000).toISOString());
  }
});

// 01 — Feed arrival
console.log("01 — Feed arrival");
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(4500); // entrances play out
await page.screenshot({ path: `${OUT}/01-feed-arrival.png` });
console.log("  saved 01-feed-arrival.png");

// Verify: wordmark says "Quire", not "brain"
const wordmark = await page.textContent(".lc-wordmark");
console.log("  wordmark:", wordmark?.trim());
if (wordmark?.toLowerCase().includes("brain")) {
  console.error("  FAIL: wordmark still says 'brain'");
  process.exitCode = 1;
}

// 01-notif — press the bell → notification card at stream top
const bell = page.locator(".notif-btn");
if (await bell.count() > 0) {
  await bell.click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}/01-notif-open.png` });
  console.log("  saved 01-notif-open.png");
  const notifTitle = await page.locator(".notif-card .ntitle").textContent().catch(() => null);
  console.log("  notif title:", notifTitle?.slice(0, 90));
  // Dismiss so it doesn't sit in later shots
  const dismiss = page.locator(".notif-card .dismiss").last();
  if (await dismiss.count() > 0) await dismiss.click();
  await page.waitForTimeout(400);
} else {
  console.error("  FAIL: no .notif-btn found");
  process.exitCode = 1;
}

// 02 — Press the first (hottest) story card → press-and-unfold
console.log("02 — Press-and-unfold");
const firstStory = page.locator(".feed-story").first();
if (await firstStory.count() > 0) {
  await firstStory.click();
  await page.waitForTimeout(3200); // stem draws + stagger completes
  // Verify unfold content is actually VISIBLE (the flagged risk)
  const unfold = page.locator(".fs-unfold").first();
  const h3 = unfold.locator("h3");
  const opacity = await h3.evaluate((el) => getComputedStyle(el).opacity).catch(() => "0");
  console.log("  unfold h3 opacity:", opacity, "text:", (await h3.textContent().catch(() => ""))?.slice(0, 70));
  if (Number(opacity) < 0.9) {
    console.error("  FAIL: unfold content not visible (opacity " + opacity + ")");
    process.exitCode = 1;
  }
  await page.screenshot({ path: `${OUT}/02-press-and-unfold.png` });
  console.log("  saved 02-press-and-unfold.png");
} else {
  console.error("  FAIL: no .feed-story cards found");
  process.exitCode = 1;
}

// 03 — Feature lens via rail → feature page with seeded opening
console.log("03 — Feature page");
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await page.click(".lc-lens--feature");
await page.waitForTimeout(800);
const firstFeature = page.locator(".lc-flist-item").first();
if (await firstFeature.count() > 0) {
  await firstFeature.click();
  await page.waitForTimeout(2500); // seeded opening fetch
  await page.screenshot({ path: `${OUT}/03-feature-page.png` });
  console.log("  saved 03-feature-page.png");
  const opening = await page.locator("section[aria-label='Feature opening'] .lc-brainline").first().textContent().catch(() => null);
  console.log("  opening turn:", opening?.slice(0, 100));
  if (!opening || opening.trim().length < 10) {
    console.error("  FAIL: seeded opening turn missing/empty");
    process.exitCode = 1;
  }
} else {
  console.error("  FAIL: no feature list items");
  process.exitCode = 1;
}

// Verify: speaker label says "Quire", not "brain"
const speaker = await page.locator(".lc-speaker").first().textContent().catch(() => null);
console.log("  speaker label:", speaker?.trim());
if (speaker?.toLowerCase().includes("brain")) {
  console.error("  FAIL: speaker still says 'brain' — rename not applied");
  process.exitCode = 1;
}

await browser.close();
console.log(`\nAll shots saved to ${OUT}/` + (process.exitCode ? " — WITH FAILURES" : ""));
