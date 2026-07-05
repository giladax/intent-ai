// Screenshot the lens-chat flow. Uses playwright-core + installed Chrome.
//   node mockups/lens-chat/shots.mjs
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const shots = [
  { file: '01-arrival.html',                out: '01-arrival.png',      settle: 3600 },
  { file: '02-lens-focus.html?focused=1',   out: '02-lens-focus.png',   settle: 3200 },
  { file: '03-conversation.html',           out: '03-conversation.png', settle: 7200 },
  { file: '04-approval.html',               out: '04-approval.png',     settle: 2200 },
  { file: '04-approval.html?sealed=1',      out: '04-sealed.png',       settle: 5200 },
];

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1560, height: 980 }, deviceScaleFactor: 2 });
for (const s of shots) {
  await page.goto('file://' + path.join(dir, s.file));
  await page.waitForTimeout(s.settle);
  await page.screenshot({ path: path.join(dir, 'shots', s.out) });
  console.log('shot', s.out);
}
await browser.close();
