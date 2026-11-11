// Lobby -> "Ride it" -> starting grid -> race, at the garage kiosk size.
//   BASE_URL=http://127.0.0.1:5199 node tests/_scratch/shoot-weekly-ghost.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5199';
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out/weekly-ghost');
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
async function shoot(scene, steps) {
  const page = await browser.newPage({ viewport: { width: 1301, height: 745 }, deviceScaleFactor: 1.39, serviceWorkers: 'block' });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${scene}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`${scene}: ${e.message}`));
  await page.goto(`${BASE}/?scene=${scene}`);
  await page.waitForSelector('[data-testid="featured-course-card"]', { timeout: 20000 });
  await page.waitForTimeout(1200);
  for (const [name, fn] of steps) {
    await fn(page);
    const file = path.join(OUT, `${scene}--${name}.png`);
    await page.screenshot({ path: file });
    console.log(file);
  }
  await page.close();
}
const ride = async (p) => { await p.click('[data-testid="featured-ride"]'); };
await shoot('flow-weekly-ghost', [
  ['1-lobby', async () => {}],
  ['2-grid', async (p) => { await ride(p); await p.waitForSelector('[data-testid^="ready-rider-ghost:"]', { timeout: 10000 }); await p.waitForTimeout(600);
    console.log('grid riders:', await p.$$eval('[data-testid^="ready-rider-"]', (els) => els.map((e) => e.dataset.testid + ' | ' + e.textContent.trim()))); }],
  ['3-race', async (p) => { await p.waitForSelector('[class^="cycle-race-screen"]', { timeout: 20000 }); await p.waitForTimeout(6000); }],
]);
await shoot('flow-weekly-ghost-empty', [
  ['1-lobby', async () => {}],
  ['2-grid', async (p) => { await ride(p); await p.waitForTimeout(1500);
    console.log('grid riders (empty):', await p.$$eval('[data-testid^="ready-rider-"]', (els) => els.map((e) => e.dataset.testid))); }],
]);
await browser.close();
if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); process.exit(1); }
