// Interactive snapshot of the Correspondence: hover an entry, pin it,
// open the dock, screenshot. Usage: npx tsx scripts/snap-correspondence.mts
import { chromium } from "playwright-core";

const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
await page.goto("http://localhost:3456/", { waitUntil: "networkidle" });
await page.waitForTimeout(1200);

// the app now lands on the lens-chat feed; the Correspondence lives on the
// classic ledger surface — switch to it first
await page.locator(".lc-ledger-toggle").click();
await page.waitForTimeout(1200);

// hover the first journal entry so the "talk" affordance appears
const first = page.locator("[data-talk]").first();
await first.hover();
await page.waitForTimeout(300);
await page.screenshot({ path: "/tmp/corr-1-affordance.png" });

// pin it via the affordance
await page.locator(".talk-affordance").click();
await page.waitForTimeout(600);

// pin a second element with the keyboard: j j t
await page.keyboard.press("j");
await page.keyboard.press("j");
await page.keyboard.press("t");
await page.waitForTimeout(700);
await page.screenshot({ path: "/tmp/corr-2-dock.png" });

// ask something so the conversation shows
await page.locator(".chat-dock-input").fill("How do these two relate?");
await page.keyboard.press("Enter");
await page.waitForTimeout(9000);
await page.screenshot({ path: "/tmp/corr-3-answer.png" });

await browser.close();
console.log("done");
