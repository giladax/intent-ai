// Screenshot the feed flow. Uses playwright-core + installed Chrome.
//   node mockups/feed/shots.mjs
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const shots = [
  // arrival: editorial org overview + trending, settled
  { file: '01-the-feed.html',                 out: '01-the-feed.png',         settle: 4800 },
  // mid-interaction: capture AFTER the press — stream scrolled, overview materialized, brain asking
  { file: '02-press-and-unfold.html?pressed=1', out: '02-press-and-unfold.png', settle: 4200,
    scrollTo: '.unfold .ask-turn', block: 'end' },
  // feature lens: top-level editorial page
  { file: '03-feature-page.html',             out: '03-feature-page.png',     settle: 6200 },
  // feature page, scrolled to where the chat begins
  { file: '03-feature-page.html',             out: '03-feature-chat.png',     settle: 6200, scrollTo: '.chat' },
];

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
for (const s of shots) {
  await page.goto('file://' + path.join(dir, s.file));
  await page.waitForTimeout(s.settle);
  if (s.scrollTo) {
    await page.evaluate(([sel, block]) => document.querySelector(sel)?.scrollIntoView({ block }), [s.scrollTo, s.block ?? 'center']);
    await page.waitForTimeout(600);
  }
  await page.screenshot({ path: path.join(dir, 'shots', s.out) });
  console.log('shot', s.out);
}
await browser.close();
