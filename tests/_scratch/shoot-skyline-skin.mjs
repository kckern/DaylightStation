// Screenshots the real Skyline FlightScene for a list of act/zone/time shots.
//   BASE_URL=http://127.0.0.1:5198 SHOTS='mountain-pass:smw-placeholder:40' node tests/_scratch/shoot-skyline-skin.mjs
// Fails (exit 1) on a page error, a console error, a failed request, missing zone
// files, or a page that never renders.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5198';
const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.OUT_DIR || path.join(here, 'out/skyline-skin');
fs.mkdirSync(OUT, { recursive: true });
const shots = (process.env.SHOTS || 'mountain-pass:alpine:40,mountain-pass:smw-placeholder:40').split(',').map((s) => { const [act, zone, t, alt] = s.split(':'); return { act, zone, t, alt: alt || '0.5' }; });
const browser = await chromium.launch();
let failed = false;
for (const shot of shots) {
  const page = await browser.newPage({ viewport: { width: 1810, height: 1086 } });
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  page.on('requestfailed', (r) => problems.push(`requestfailed: ${r.url()}`));
  page.on('response', (r) => { if (r.status() >= 400) problems.push(`http ${r.status()}: ${r.url()}`); });
  await page.goto(`${BASE}/?act=${shot.act}&zone=${shot.zone}&t=${shot.t}&alt=${shot.alt}`);
  try { await page.waitForSelector('[data-harness-ready] svg.skyline-glider__scene', { timeout: 20000 }); } catch { problems.push(`never rendered: ${await page.evaluate(() => document.body.dataset.harnessError || document.body.textContent.slice(0, 200))}`); }
  await page.waitForTimeout(400);
  const info = await page.evaluate(() => window.__harness || null);
  if (info?.missing?.length) problems.push(`missing zone files: ${JSON.stringify(info.missing)}`);
  const file = path.join(OUT, `${shot.act}--${shot.zone}--t${shot.t}.png`);
  await page.screenshot({ path: file });
  console.log(JSON.stringify({ shot: `${shot.act}:${shot.zone}:${shot.t}`, file, info, problems }));
  if (problems.length) failed = true;
  await page.close();
}
await browser.close();
process.exitCode = failed ? 1 : 0;
