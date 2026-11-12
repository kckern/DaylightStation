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
const pad = (page, n) => page.locator(`.skyline-controls button[data-position="${n}"]`).click();
async function padHold(page, n) {
  const box = await page.locator(`.skyline-controls button[data-position="${n}"]`).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await run(page, 800); await page.mouse.up(); await run(page, 50);
}
const screen = (page, name) => page.waitForSelector(`[data-screen="${name}"]`, { timeout: 20000 });
// Waves -> Start -> Ready: stand, reach left, reach right -> the countdown starts by itself.
const readyAndCount = async (page) => {
  await screen(page, 'waves'); await pad(page, 4); await screen(page, 'ready');
  await hold(page, 0, 1300, 900); await hold(page, 130, 1100); await hold(page, -130, 1100);
  await phase(page, 'countdown');
};
const start = async (page) => { await readyAndCount(page); await run(page, 3100); await phase(page, 'playing'); };
const startDenied = async (page) => { await screen(page, 'waves'); await pad(page, 4); await phase(page, 'countdown'); await run(page, 3100); await phase(page, 'playing'); };
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

const SHOTS = {
  'who': { query: 'pose=detecting&shooter=none&roster=kid,test-rider', go: async (page) => { await screen(page, 'who'); } },
  'who-nobody': { query: 'pose=detecting&shooter=none', go: async (page) => { await screen(page, 'who'); } },
  'roster': { query: 'pose=detecting&shooter=none&roster=kid', go: async (page) => { await screen(page, 'who'); await padHold(page, 2); await screen(page, 'roster'); await pad(page, 2); } },
  'waves': { query: 'pose=detecting', go: async (page) => { await screen(page, 'waves'); } },
  'waves-done-row': { query: 'pose=detecting', go: async (page) => { await screen(page, 'waves'); await pad(page, 1); } },
  'waves-locked-row': { query: 'pose=detecting', go: async (page) => { await screen(page, 'waves'); await pad(page, 2); } },
  'waves-sound': { query: 'pose=detecting', go: async (page) => { await screen(page, 'waves'); await page.getByRole('button', { name: 'Sound and settings' }).click(); await screen(page, 'sound'); } },
  'locked': { query: 'pose=detecting&kiosk=1', go: async (page) => { await screen(page, 'locked'); } },
  'locked-unlock-prompt': { query: 'pose=detecting&kiosk=1', go: async (page) => { await screen(page, 'locked'); await pad(page, 1); await run(page, 300); await page.waitForSelector('.unlock-prompt'); } },
  'locked-adult-picked': { query: 'pose=detecting&kiosk=1&roster=kid&learners=kid', go: async (page) => {
    await screen(page, 'locked'); await pad(page, 4); await screen(page, 'who'); await padHold(page, 1); await screen(page, 'roster');
    await pad(page, 2); await pad(page, 4); await run(page, 300); await screen(page, 'locked');
  } },
  'ready-stand': { query: 'pose=detecting', go: async (page) => { await screen(page, 'waves'); await pad(page, 4); await screen(page, 'ready'); await run(page, 400); } },
  'ready-left': { query: 'pose=detecting', go: async (page) => { await screen(page, 'waves'); await pad(page, 4); await hold(page, 0, 1300, 900); await hold(page, 130, 500); } },
  'ready-right': { query: 'pose=detecting', go: async (page) => { await screen(page, 'waves'); await pad(page, 4); await hold(page, 0, 1300, 900); await hold(page, 130, 1100); await hold(page, -130, 500); } },
  'ready-too-narrow': { query: 'pose=detecting', go: async (page) => { await screen(page, 'waves'); await pad(page, 4); await hold(page, 0, 1300, 900); await hold(page, 55, 1100); await hold(page, -55, 1100); await hold(page, 0, 200, 900); } },
  countdown: { query: 'pose=detecting&partner=1', go: async (page) => { await readyAndCount(page); await run(page, 1200); } },
  'in-game': { query: 'pose=detecting&partner=1&zone=hot', go: async (page) => { await start(page); await shootFor(page, 9); } },
  'in-game-gamepad-aim': { query: 'pose=camera-denied', go: async (page) => { await startDenied(page); await run(page, 4000); await page.keyboard.press('Space'); await run(page, 250); } },
  'in-game-pose-lost': { query: 'pose=detecting', go: async (page) => { await start(page); await hold(page, -60, 2500); await run(page, 1500); } },
  'paused-by-bike': { query: 'pose=detecting&partner=1', go: async (page) => { await start(page); await shootFor(page, 2); await page.evaluate(() => window.__si.bike('4_hold')); await phase(page, 'paused'); } },
  'paused-sound': { query: 'pose=detecting&partner=1', go: async (page) => { await start(page); await shootFor(page, 2); await page.evaluate(() => window.__si.bike('4_hold')); await phase(page, 'paused'); await pad(page, 2); await screen(page, 'sound'); await pad(page, 4); } },
  'result-fell-short': { query: 'pose=camera-denied', go: async (page) => { await startDenied(page); await run(page, 31000); await phase(page, 'result'); await page.waitForSelector('[data-save="saved"]'); } },
  'result-held': { query: 'pose=detecting&zone=hot', go: async (page) => { await start(page); await shootFor(page, 31); await run(page, 1500); await phase(page, 'result'); await page.waitForSelector('[data-save="saved"]'); } },
  'result-not-saved': { query: 'pose=camera-denied&save=fail', go: async (page) => { await startDenied(page); await run(page, 31000); await phase(page, 'result'); await page.waitForSelector('[data-save="error"]'); } },
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
  const menus = [...root.querySelectorAll('.skyline-invaders__menu')];
  const texts = menus.flatMap((menu) => [...menu.querySelectorAll('*')])
    .filter((node) => node.children.length === 0 && node.textContent.trim() && visible(node) && !node.closest('[aria-hidden="true"]'))
    .map((node) => ({ text: node.textContent.trim().slice(0, 60), px: Math.round(parseFloat(getComputedStyle(node).fontSize)), ...box(node) }));
  const buttons = [...root.querySelectorAll('button')].filter(visible).map((node) => ({ text: (node.getAttribute('aria-label') || node.textContent).trim().slice(0, 60), ...box(node) }));
  // The "more" button must sit clear of every window and panel frame.
  const more = root.querySelector('.skyline-invaders__more');
  const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  const overlaps = more ? [...root.querySelectorAll('.skyline-menus, .skyline-controls, .skyline-invaders__hud-left, .skyline-invaders__hud-centre, .skyline-invaders__hud-right, .skyline-invaders__hud-notes > *')].filter((frame) => hit(box(more), box(frame))).map((frame) => frame.className) : [];
  const moreBox = more ? box(more) : null;
  return { overlaps, moreBox, texts, buttons, width: window.innerWidth, height: window.innerHeight, scroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight] };
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
      if (seen.overlaps.length) problems.push(`more button overlaps: ${seen.overlaps.join(', ')} at ${JSON.stringify(seen.moreBox)}`);
      if (seen.moreBox && (seen.moreBox.right - seen.moreBox.left < 48 || seen.moreBox.bottom - seen.moreBox.top < 48)) problems.push(`more button under 48px: ${JSON.stringify(seen.moreBox)}`);
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
