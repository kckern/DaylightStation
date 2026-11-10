// tests/_scratch/shoot-cycle-game.mjs
// Screenshots every cycle-game harness scene at 1920x1080 (the garage TV).
// Starts nothing: run the harness server first (see
// tests/_scratch/cycle-game-harness/README.md), then
//   BASE_URL=http://127.0.0.1:5199 node tests/_scratch/shoot-cycle-game.mjs
// Optional: SCENES=lobby-default,staging to run a subset.
// Exits non-zero, naming the scene, on a thrown error, a console error, a
// failed request or a scene that never signals [data-harness-ready].
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BASE_URL;
if (!BASE) { console.error('BASE_URL is required, e.g. BASE_URL=http://127.0.0.1:5199'); process.exit(2); }
const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, 'out/cycle-game');
fs.mkdirSync(OUT, { recursive: true });

const ALL = [
  'lobby-default', 'lobby-no-signal', 'lobby-busy', 'staging', 'countdown',
  'race-solo-rival', 'race-two-riders-one-parked', 'race-four-riders', 'race-menu-open', 'race-toast-parked',
  'results-normal', 'results-stopped-and-ended-early',
  'pace-delta-ahead', 'pace-delta-behind', 'pace-delta-null',
];
const scenes = process.env.SCENES ? process.env.SCENES.split(',').map((s) => s.trim()) : ALL;

// Per-scene interaction run after ready, before the screenshot.
const ACTIONS = {
  'lobby-no-signal': async (page) => {
    await page.click('[data-testid="cycle-game-start"]');
    await page.waitForSelector('[data-testid="sensor-warning"]', { timeout: 5000 });
    await page.waitForTimeout(400);
  },
  'race-menu-open': async (page) => {
    await page.click('[data-testid="race-menu-open"]');
    await page.waitForSelector('[data-testid="race-menu-sheet"]', { timeout: 5000 });
    await page.waitForTimeout(900); // past the 600 ms guard and the open animation
  },
};

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const failures = [];
const report = [];

for (const scene of scenes) {
  const problems = [];
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console error: ${m.text()}`); });
  page.on('requestfailed', (r) => problems.push(`request failed: ${r.url()}`));
  page.on('response', (r) => { if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url()}`); });
  try {
    await page.goto(`${BASE}/?scene=${encodeURIComponent(scene)}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-harness-ready]', { timeout: 30000 });
    if (ACTIONS[scene]) await ACTIONS[scene](page);
    const file = path.join(OUT, `${scene}.png`);
    await page.screenshot({ path: file });
    const canvas = await page.evaluate(() => document.body.dataset.harnessCanvas);
    report.push(`${scene}: ${file} (canvas present: ${canvas})`);
  } catch (e) {
    problems.push(`did not finish: ${e.message.split('\n')[0]}`);
  }
  if (problems.length) failures.push({ scene, problems: [...new Set(problems)] });
  await page.close();
}
await browser.close();

report.forEach((l) => console.log(l));
if (failures.length) {
  for (const f of failures) {
    console.error(`\nFAIL scene "${f.scene}":`);
    f.problems.forEach((p) => console.error(`  - ${p}`));
  }
  console.error(`\n${failures.length} of ${scenes.length} scene(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${scenes.length} scenes rendered to ${OUT}`);
