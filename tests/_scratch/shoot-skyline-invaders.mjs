// Screenshots every Skyline Invaders harness scene at 1920x1080 (the garage
// TV) plus a quarter-size copy (how it reads from across the room).
//   BASE_URL=http://127.0.0.1:5196 OUT_DIR=/path [ONLY=battle,weapon] [VIEWPORT=1810x1040] [BROWSER=chromium] node tests/_scratch/shoot-skyline-invaders.mjs
// Starts nothing: run the harness server first. Exits 1 on a page error, a
// console error, a failed request or a scene that never renders.
import { chromium, firefox } from 'playwright';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5196';
const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.OUT_DIR || path.join(here, 'out/skyline-invaders');
fs.mkdirSync(OUT, { recursive: true });
// freeze = seconds into every CSS animation at which the picture is taken.
const SHOTS = {
  battle: 0.15, 'weapon-single': 0.15, 'weapon-double': 0.15, 'weapon-spread': 0.15, 'bomb-ready': 0.15, 'out-of-fuel': 0.15,
  'bomb-start': 0.06, 'bomb-late': 0.15, 'edge-lane-left': 0.15, 'edge-lane-right': 0.15, shield: 0.4, twin: 0.15, rapid: 0.15,
  'pose-lost': 0.4, 'camera-off': 0.4, 'last-seconds': 0.15, start: 0.15,
};
const only = (process.env.ONLY || '').split(',').filter(Boolean);
const [width, height] = (process.env.VIEWPORT || '1920x1080').split('x').map(Number);
const engine = process.env.BROWSER === 'chromium' ? chromium : firefox;   // the garage kiosk is Firefox
// Muted twice over: the harness stubs the game's audio engine, and the browser itself has no volume.
const browser = await engine.launch(engine === firefox ? { firefoxUserPrefs: { 'media.volume_scale': '0.0' } } : { args: ['--mute-audio'] });
let failed = false;
for (const [name, freeze] of Object.entries(SHOTS)) {
  if (only.length && !only.some((o) => name.startsWith(o))) continue;
  const page = await browser.newPage({ viewport: { width, height } });
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  page.on('requestfailed', (r) => problems.push(`requestfailed: ${r.url()}`));
  page.on('response', (r) => { if (r.status() >= 400) problems.push(`http ${r.status()}: ${r.url()}`); });
  await page.goto(`${BASE}/?scene=${name}`);
  try { await page.waitForSelector('[data-harness-ready]', { timeout: 20000 }); } catch { problems.push(`never rendered: ${await page.evaluate(() => document.body.dataset.harnessError || document.body.textContent.slice(0, 200))}`); }
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await page.evaluate((ms) => document.getAnimations().forEach((animation) => { animation.pause(); animation.currentTime = ms; }), freeze * 1000);
  await page.waitForTimeout(150);
  // Text a player must read mid-round, smallest first.
  const smallest = await page.evaluate(() => [...document.querySelectorAll('.skyline-invaders__hud *')]
    .filter((n) => n.children.length === 0 && n.textContent.trim() && n.getClientRects().length)
    .map((n) => ({ text: n.textContent.trim(), px: Math.round(parseFloat(getComputedStyle(n).fontSize)), right: Math.round(n.getBoundingClientRect().right), left: Math.round(n.getBoundingClientRect().left) }))
    .sort((a, b) => a.px - b.px));
  const off = smallest.filter((n) => n.left < 0 || n.right > width);
  if (smallest[0] && smallest[0].px < 22) problems.push(`text under 22px: ${JSON.stringify(smallest[0])}`);
  if (off.length) problems.push(`text off screen: ${JSON.stringify(off)}`);
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  execFileSync('sips', ['-Z', String(Math.round(Math.max(width, height) / 4)), file, '--out', path.join(OUT, `${name}--quarter.png`)], { stdio: 'ignore' });
  if (problems.length) { failed = true; console.log(JSON.stringify({ name, file, problems })); } else console.log(file);
  await page.close();
}
await browser.close();
process.exitCode = failed ? 1 : 0;
