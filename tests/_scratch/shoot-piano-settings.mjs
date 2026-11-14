// Screenshots the piano Sound / Maintenance sheets from the harness at the
// tablet's 1280×800 canvas and fails on overflow: a sheet body that scrolls,
// a button whose label is cut, or a control outside the panel.
//   node_modules/.bin/vite --config tests/_scratch/piano-settings-harness/vite.harness.config.mjs
//   BASE_URL=http://127.0.0.1:5198 node tests/_scratch/shoot-piano-settings.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.OUT_DIR || path.join(here, 'out/piano-settings');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5198';
fs.mkdirSync(OUT, { recursive: true });

const SHOTS = [
  { name: 'sound-pianos', scene: 'sound-pianos' },
  { name: 'sound-mine', scene: 'sound-mine' },
  { name: 'sound-winds', scene: 'sound-winds' },
  { name: 'sound-voices', scene: 'sound-voices' },
  { name: 'sound-typed-offline', scene: 'sound-typed-offline' },
  { name: 'sound-empty-mine', scene: 'sound-empty-mine', click: ['Mine'] },
  { name: 'maint-ready', scene: 'maint-ready' },
  { name: 'maint-down', scene: 'maint-down' },
  { name: 'maint-armed', scene: 'maint-ready', click: ['Stop stuck notes', 'Turn off display', 'Reboot tablet'] },
  { name: 'maint-diagnostics', scene: 'maint-ready', click: ['Diagnostics'] },
  { name: 'maint-click-timing', scene: 'maint-ready', click: ['Click timing'] },
  { name: 'maint-bluetooth', scene: 'maint-down', click: ['Bluetooth pairing'] },
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
let failed = 0;
for (const shot of SHOTS) {
  await page.goto(`${BASE}/?scene=${shot.scene}`);
  await page.waitForSelector('.piano-tsheet__panel');
  await page.evaluate(() => document.fonts.ready);
  for (const name of shot.click || []) await page.getByRole('button', { name, exact: true }).first().click();
  await page.waitForTimeout(400);
  await page.waitForFunction(() => [...document.images].every((img) => img.complete), null, { timeout: 15000 });
  const problems = await page.evaluate(() => {
    const out = [];
    const panel = document.querySelector('.piano-tsheet__panel');
    const pr = panel.getBoundingClientRect();
    if (panel.scrollHeight > panel.clientHeight + 1) out.push(`panel scrolls: ${panel.scrollHeight} > ${panel.clientHeight}`);
    for (const el of panel.querySelectorAll('button, .piano-tbtn__label, .piano-stepgrid__label, strong, p')) {
      const r = el.getBoundingClientRect();
      if (!r.width) continue;
      const label = (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40);
      if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== 'visible') out.push(`clipped x: ${label}`);
      if (r.bottom > pr.bottom + 1 || r.right > pr.right + 1) out.push(`outside panel: ${label}`);
    }
    for (const el of panel.querySelectorAll('.piano-tbtn')) {
      if (!el.querySelector('.piano-icon svg, img') && el.querySelector('.piano-icon')) out.push(`blank icon: ${el.textContent.trim()}`);
    }
    return out;
  });
  await page.screenshot({ path: path.join(OUT, `${shot.name}.png`) });
  if (problems.length) { failed += 1; console.log(`✗ ${shot.name}\n  ${problems.join('\n  ')}`); } else console.log(`✓ ${shot.name}`);
}
await browser.close();
process.exit(failed ? 1 : 0);
