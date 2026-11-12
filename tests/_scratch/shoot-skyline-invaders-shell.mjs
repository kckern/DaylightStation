// Screenshots the real Skyline Invaders shell (lobby, calibration, round,
// pause, result, fallbacks) from the backend-free harness, at the garage TV's
// size and at the size its kiosk actually lays out (devicePixelRatio ~1.05).
//   BASE_URL=http://127.0.0.1:5196 OUT_DIR=/path [ONLY=lobby,calibration] [VIEWPORTS=1920x1080,1824x1026] [BROWSER=chromium] [DPR=1.39] node tests/_scratch/shoot-skyline-invaders-shell.mjs
// Starts nothing: run the harness server first (vite --config tests/_scratch/skyline-invaders-harness/vite.harness.config.mjs).
// The page clock is installed, so a 30 s round takes a moment and every shot is repeatable.
// Exits 1 on a page error, a console error, a failed request, or a control or
// instruction that is off screen or too small to read from across the room.
import { chromium, firefox } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5196';
const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.OUT_DIR || path.join(here, 'out/skyline-invaders-shell');
fs.mkdirSync(OUT, { recursive: true });
const only = (process.env.ONLY || '').split(',').filter(Boolean);
const viewports = (process.env.VIEWPORTS || '1920x1080,1824x1026').split(',').map((v) => v.split('x').map(Number));
const engine = process.env.BROWSER === 'chromium' ? chromium : firefox;   // the garage kiosk is Firefox
const MIN_TEXT_PX = 22;

const phase = (page, name) => page.waitForSelector(`[data-phase="${name}"]`, { timeout: 20000 });
const run = (page, ms) => page.clock.runFor(ms);
const click = (page, name) => page.getByRole('button', { name }).first().click();
// Feed one pose every 100 ms of page time, the way a 10 Hz camera would.
async function hold(page, wristDx, ms, wristY = 200) {
  for (let t = 0; t < ms; t += 100) {
    await page.evaluate(([dx, y]) => window.__si.feed(dx, y), [wristDx, wristY]);
    await run(page, 100);
  }
}
const calibrate = async (page) => {
  await click(page, /Calibrate/);
  await phase(page, 'calibrating');
  await hold(page, 0, 1300, 900);
  await hold(page, 130, 1100);
  await hold(page, -130, 1100);
  await phase(page, 'lobby');
};
const start = async (page, name = /^Start/) => {
  await click(page, name);
  await phase(page, 'countdown');
  await run(page, 3100);
  await phase(page, 'playing');
};
// Aim at the lowest threat and step on the mat, once a second.
async function shootFor(page, seconds) {
  for (let s = 0; s < seconds; s += 1) {
    const dx = await page.evaluate(() => {
      const threats = [...document.querySelectorAll('[data-threat]')].filter((node) => node.dataset.threat !== 'bomb');
      const lowest = threats.sort((a, b) => Number(b.dataset.y) - Number(a.dataset.y))[0];
      if (!lowest) return 0;
      const aim = Math.min(1, Math.max(0, (Number(lowest.dataset.x) - 60) / 880));
      return -(2 * aim - 1) * 130;
    });
    await hold(page, dx, 700);
    await page.evaluate(() => window.__si.step());
    await hold(page, dx, 300);
    if (!(await page.$('[data-phase="playing"]'))) return;
  }
}

// name -> { query, go(page) }. `go` leaves the page in the state to photograph.
const SHOTS = {
  'lobby-vision-loading': { query: 'pose=loading', go: async (page) => { await phase(page, 'lobby'); } },
  'lobby-uncalibrated': { query: 'pose=detecting', go: async (page) => { await phase(page, 'lobby'); } },
  'lobby-pick-shooter': { query: 'pose=detecting&shooter=none', go: async (page) => { await phase(page, 'lobby'); } },
  'lobby-camera-denied-no-mat': { query: 'pose=camera-denied&mat=none', go: async (page) => { await phase(page, 'lobby'); } },
  'lobby-calibrated-partner': { query: 'pose=detecting&partner=1', go: async (page) => { await phase(page, 'lobby'); await calibrate(page); await hold(page, 0, 300); } },
  'lobby-arms-wide-hold': { query: 'pose=detecting', go: async (page) => {
    await phase(page, 'lobby'); await calibrate(page); await hold(page, 0, 300);
    // Both arms out to the sides, held for half the press.
    for (let t = 0; t < 600; t += 100) {
      await page.evaluate(() => { const p = window.__si.pose(0); p.keypoints[15].x = 380 + 170; p.keypoints[16].x = 260 - 170; window.__si.tracker.processPoses([p]); });
      await run(page, 100);
    }
  } },
  'lobby-school-locked': { query: 'pose=detecting&kiosk=1', go: async (page) => { await phase(page, 'lobby'); await page.getByRole('button', { name: /Ask a grown-up/ }).waitFor(); } },
  'lobby-unlock-prompt': { query: 'pose=detecting&kiosk=1', go: async (page) => { await phase(page, 'lobby'); await click(page, /Ask a grown-up/); await run(page, 300); await page.waitForSelector('.unlock-prompt'); } },
  'calibration-1-framing-looking': { query: 'pose=detecting', go: async (page) => { await phase(page, 'lobby'); await click(page, /Calibrate/); await phase(page, 'calibrating'); await run(page, 400); } },
  'calibration-1-framing-seen': { query: 'pose=detecting', go: async (page) => { await phase(page, 'lobby'); await click(page, /Calibrate/); await hold(page, 0, 600, 900); } },
  'calibration-2-left-holding': { query: 'pose=detecting', go: async (page) => { await phase(page, 'lobby'); await click(page, /Calibrate/); await hold(page, 0, 1300, 900); await hold(page, 130, 500); } },
  'calibration-3-right-holding': { query: 'pose=detecting', go: async (page) => { await phase(page, 'lobby'); await click(page, /Calibrate/); await hold(page, 0, 1300, 900); await hold(page, 130, 1100); await hold(page, -130, 500); } },
  'calibration-too-narrow': { query: 'pose=detecting', go: async (page) => { await phase(page, 'lobby'); await click(page, /Calibrate/); await hold(page, 0, 1300, 900); await hold(page, 55, 1100); await hold(page, -55, 1100); await hold(page, 0, 200, 900); } },
  'calibration-no-hands-pressed': { query: 'pose=detecting', go: async (page) => { await phase(page, 'lobby'); await click(page, /Calibrate/); await hold(page, 0, 1300, 900); await click(page, /Use this position/); await hold(page, 0, 200, 900); } },
  'calibration-camera-denied': { query: 'pose=detecting', go: async (page) => { await phase(page, 'lobby'); await click(page, /Calibrate/); await page.evaluate(() => window.__si.status('camera-denied')); await run(page, 200); } },
  countdown: { query: 'pose=detecting&partner=1', go: async (page) => { await phase(page, 'lobby'); await calibrate(page); await hold(page, 0, 300); await click(page, /^Start/); await phase(page, 'countdown'); await run(page, 1200); } },
  'in-game': { query: 'pose=detecting&partner=1&zone=hot', go: async (page) => { await phase(page, 'lobby'); await calibrate(page); await hold(page, 0, 300); await start(page); await shootFor(page, 9); } },
  'in-game-camera-denied': { query: 'pose=camera-denied', go: async (page) => { await phase(page, 'lobby'); await start(page); await run(page, 4000); await page.keyboard.press('Space'); await run(page, 250); } },
  'in-game-pose-lost': { query: 'pose=detecting', go: async (page) => { await phase(page, 'lobby'); await calibrate(page); await hold(page, 0, 300); await start(page); await hold(page, -60, 2500); await run(page, 1500); } },
  paused: { query: 'pose=detecting', go: async (page) => { await phase(page, 'lobby'); await calibrate(page); await hold(page, 0, 300); await start(page); await shootFor(page, 4); await click(page, 'Pause'); await phase(page, 'paused'); } },
  // The Sound sheet: from the lobby's "more" button, and mid-round (it pauses first).
  'lobby-sound': { query: 'pose=detecting', go: async (page) => { await phase(page, 'lobby'); await click(page, 'Sound and settings'); await page.waitForSelector('[data-testid="skyline-invaders-sound"]'); } },
  'round-sound-muted': { query: 'pose=detecting&partner=1&zone=hot', go: async (page) => {
    await phase(page, 'lobby'); await calibrate(page); await hold(page, 0, 300); await start(page); await shootFor(page, 3);
    await click(page, 'Sound and settings'); await phase(page, 'paused'); await page.evaluate(() => { window.__si.bike('1_single'); window.__si.bike('4_single'); }); await run(page, 200);
  } },
  'paused-by-bike': { query: 'pose=detecting&partner=1', go: async (page) => { await phase(page, 'lobby'); await calibrate(page); await hold(page, 0, 300); await start(page); await shootFor(page, 2); await page.evaluate(() => window.__si.bike('4_hold')); await phase(page, 'paused'); } },
  'result-fell-short': { query: 'pose=camera-denied', go: async (page) => { await phase(page, 'lobby'); await start(page); await run(page, 31000); await phase(page, 'result'); await page.waitForSelector('[data-save="saved"]'); } },
  'result-held': { query: 'pose=detecting&zone=hot', go: async (page) => { await phase(page, 'lobby'); await calibrate(page); await hold(page, 0, 300); await start(page); await shootFor(page, 31); await run(page, 1500); await phase(page, 'result'); await page.waitForSelector('[data-save="saved"]'); } },
  'result-not-saved': { query: 'pose=camera-denied&save=fail', go: async (page) => { await phase(page, 'lobby'); await start(page); await run(page, 31000); await phase(page, 'result'); await page.waitForSelector('[data-save="error"]'); } },
  'error-no-levels': { query: 'levels=none', go: async (page) => { await phase(page, 'error'); } },
  'error-levels-unavailable': { query: 'levels=fail', go: async (page) => { await phase(page, 'error'); } },
};

// Everything a player must read or press, with where it sits.
const audit = (page) => page.evaluate(() => {
  const root = document.querySelector('.skyline-invaders');
  const visible = (node) => {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && Number(style.opacity) > 0;
  };
  const box = (node) => { const r = node.getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom) }; };
  const menus = [...root.querySelectorAll('.skyline-invaders__lobby, .skyline-invaders__calibration, .skyline-invaders__pause, .skyline-invaders__result, .skyline-invaders__notice, .skyline-invaders__sound')];
  const texts = menus.flatMap((menu) => [...menu.querySelectorAll('*')])
    .filter((node) => node.children.length === 0 && node.textContent.trim() && visible(node) && !node.closest('[aria-hidden="true"]'))
    .map((node) => ({ text: node.textContent.trim().slice(0, 60), px: Math.round(parseFloat(getComputedStyle(node).fontSize)), ...box(node) }));
  const buttons = [...root.querySelectorAll('button')].filter(visible).map((node) => ({ text: (node.getAttribute('aria-label') || node.textContent).trim().slice(0, 60), ...box(node) }));
  return { texts, buttons, width: window.innerWidth, height: window.innerHeight, scroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight] };
});

const browser = await engine.launch();
let failed = false;
for (const [width, height] of viewports) {
  for (const [name, shot] of Object.entries(SHOTS)) {
    if (only.length && !only.some((o) => name.startsWith(o))) continue;
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: Number(process.env.DPR || 1) });
    const problems = [];
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/503|Failed to load resource/.test(m.text())) problems.push(`console: ${m.text()}`); });
    page.on('response', (r) => { if (r.status() >= 400 && !/levels=fail|save=fail/.test(shot.query)) problems.push(`http ${r.status()}: ${r.url()}`); });
    await page.clock.install();
    await page.goto(`${BASE}/shell.html?${shot.query}`);
    try {
      await page.waitForSelector('.skyline-invaders:not([data-phase="loading"])', { timeout: 30000 });
      // From here the page's clock moves only when the flow says so.
      await page.clock.pauseAt(new Date(Date.now() + 2000));
      await shot.go(page);
    } catch (error) {
      problems.push(`flow: ${error.message.split('\n')[0]} (phase ${await page.evaluate(() => document.querySelector('.skyline-invaders')?.dataset.phase || document.body.textContent.slice(0, 200))})`);
    }
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(250);
    const seen = await audit(page).catch((error) => { problems.push(`audit: ${error.message}`); return null; });
    if (seen) {
      const off = [...seen.texts, ...seen.buttons].filter((n) => n.left < 0 || n.top < 0 || n.right > seen.width || n.bottom > seen.height);
      const small = seen.texts.filter((n) => n.px < MIN_TEXT_PX);
      if (off.length) problems.push(`off screen: ${JSON.stringify(off)}`);
      if (small.length) problems.push(`text under ${MIN_TEXT_PX}px: ${JSON.stringify(small)}`);
      if (seen.scroll[0] > seen.width || seen.scroll[1] > seen.height) problems.push(`page scrolls: ${seen.scroll.join('x')} in ${seen.width}x${seen.height}`);
    }
    const file = path.join(OUT, `${name}--${width}x${height}.png`);
    await page.screenshot({ path: file });
    if (problems.length) { failed = true; console.log(JSON.stringify({ name, file, problems }, null, 1)); } else console.log(file);
    await page.close();
  }
}
await browser.close();
process.exitCode = failed ? 1 : 0;
