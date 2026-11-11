// Screenshots every Skyline Glider UI screen from the skin harness: the HUD and
// marks over the real scene, the flight overlays, each menu phase and the
// bike-button panel. Writes <name>.png at kiosk size and <name>--half.png at
// half size (how it reads from across the garage).
//   BASE_URL=http://127.0.0.1:5197 OUT_DIR=/tmp/shots [ONLY=menu-flights,flight-gate] node tests/_scratch/shoot-skyline-ui.mjs
// Fails (exit 1) on a page error, a console error, a failed request or a page
// that never renders.
import { chromium, firefox } from 'playwright';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5197';
const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.OUT_DIR || path.join(here, 'out/skyline-ui');
fs.mkdirSync(OUT, { recursive: true });
const flight = (zone, t, alt, fx = '', freeze = '0.12') => `scene=flight&act=cloud-ridge&zone=${zone}&t=${t}&alt=${alt}&fx=${fx}&freeze=${freeze}`;
const SHOTS = {
  'flight-target': flight('smw-placeholder', 22, 0.4, 'impacts,shots,pop'),
  'flight-bomb': flight('smw-placeholder', 62, 0.4, 'charging,flash-deny,empty'),
  'flight-missile': flight('smw-placeholder', 118, 0.45, 'boosting,flash-ok,power'),
  'flight-gate': flight('smw-placeholder', 199.5, 0.5, 'banner,hurt'),
  'flight-alpine-target': flight('alpine', 22, 0.4, 'impacts,shots,pop'),
  'flight-alpine-bomb': flight('alpine', 62, 0.4, 'checkpoint,charging'),
  'flight-alpine-gate': flight('alpine', 199.5, 0.5, 'hurt'),
  'flight-unarmed': flight('smw-placeholder', 30, 0.5, 'unarmed'),
  'overlay-waiting': flight('smw-placeholder', 2, 0.6, 'waiting'),
  'overlay-crashed': flight('smw-placeholder', 62, 0.7, 'crashed'),
  'overlay-reconnect': flight('alpine', 40, 0.5, 'reconnect'),
  'overlay-stall': flight('smw-placeholder', 40, 0.5, 'stall'),
  ...Object.fromEntries(['identity', 'roster', 'flights', 'ready', 'countdown', 'menu', 'crash', 'result', 'result-error', 'denied', 'save-details', 'loading']
    .map((phase) => [`menu-${phase}`, `scene=menu&phase=${phase}&freeze=0.5`])),
};
const only = (process.env.ONLY || '').split(',').filter(Boolean);
const engine = process.env.BROWSER === 'chromium' ? chromium : firefox; // the garage kiosk is Firefox
const browser = await engine.launch();
let failed = false;
for (const [name, query] of Object.entries(SHOTS)) {
  if (only.length && !only.some((o) => name.startsWith(o))) continue;
  {
    const page = await browser.newPage({ viewport: { width: 1810, height: 1086 } });
    const problems = [];
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
    page.on('requestfailed', (r) => problems.push(`requestfailed: ${r.url()}`));
    page.on('response', (r) => { if (r.status() >= 400) problems.push(`http ${r.status()}: ${r.url()}`); });
    await page.goto(`${BASE}/?${query}`);
    try { await page.waitForSelector('[data-harness-ready]', { timeout: 20000 }); } catch { problems.push(`never rendered: ${await page.evaluate(() => document.body.dataset.harnessError || document.body.textContent.slice(0, 200))}`); }
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(500);
    const file = path.join(OUT, `${name}.png`);
    await page.screenshot({ path: file });
    execFileSync('sips', ['-Z', '905', file, '--out', path.join(OUT, `${name}--half.png`)], { stdio: 'ignore' });
    if (problems.length) { failed = true; console.log(JSON.stringify({ name, file, problems })); } else console.log(file);
    await page.close();
  }
}
await browser.close();
process.exitCode = failed ? 1 : 0;
