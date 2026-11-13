// Screenshots the real Skyline Invaders shell (lobby, calibration, round,
// pause, result, fallbacks) from the backend-free harness, at the garage TV's
// size and at the size its kiosk actually lays out (devicePixelRatio ~1.05).
//   BASE_URL=http://127.0.0.1:5196 OUT_DIR=/path [ONLY=waves,controls] [VIEWPORTS=1381x777,1920x1080] [BROWSER=chromium] [DPR=1.39] node tests/_scratch/shoot-skyline-invaders-shell.mjs
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
const viewports = (process.env.VIEWPORTS || '1381x777,1920x1080').split(',').map((v) => v.split('x').map(Number));
const engine = process.env.BROWSER === 'chromium' ? chromium : firefox;   // the garage kiosk is Firefox
const MIN_TEXT_PX = 22;

const phase = (page, name) => page.waitForSelector(`[data-phase="${name}"]`, { timeout: 20000 });
const run = (page, ms) => page.clock.runFor(ms);
const click = (page, name) => page.getByRole('button', { name }).first().click();
// Feed one pose every 100 ms of page time, the way a 10 Hz camera would.
// `aim` is where the wiper gesture points, 0 (screen left) .. 1 (screen right).
async function hold(page, aim, ms) {
  for (let t = 0; t < ms; t += 100) {
    await page.evaluate((value) => window.__si.feedAim(value), aim);
    await run(page, 100);
  }
}
// Touch keys by position; on Who's defending? the people tiles, in order.
const pad = async (page, n) => {
  const key = page.locator(`.skyline-invaders__key[data-position="${n}"]`);
  if (await key.count()) return key.click();
  return page.locator('.skyline-invaders__person').nth(n - 1).click();
};
// Someone else: the last people tile opens the roster.
const padHold = (page) => page.locator('.skyline-invaders__person--more').click();
const screen = (page, name) => page.waitForSelector(`[data-screen="${name}"]`, { timeout: 20000 });
// Waves -> Start -> Ready: stand in view for a second -> the countdown starts by itself.
const readyAndCount = async (page) => {
  await screen(page, 'waves'); await hold(page, 0.5, 200); await pad(page, 4); await screen(page, 'ready');
  await hold(page, 0.5, 1300);
  await phase(page, 'countdown');
};
const start = async (page) => { await readyAndCount(page); await run(page, 3100); await phase(page, 'playing'); };
const startDenied = async (page) => { await screen(page, 'waves'); await pad(page, 4); await phase(page, 'countdown'); await run(page, 3100); await phase(page, 'playing'); };
// The controls intro, on card `n` (0 = the first), from the wave list.
const controls = async (page, n = 0, first = true) => {
  await screen(page, 'waves'); await hold(page, 0.5, 300); await pad(page, first ? 4 : 5); await screen(page, 'controls');
  for (let i = 0; i < n; i += 1) await pad(page, 2);
};
// Aim at the lowest threat and step on the mat, once a second.
async function shootFor(page, seconds) {
  for (let s = 0; s < seconds; s += 1) {
    const aim = await page.evaluate(() => {
      const threats = [...document.querySelectorAll('[data-threat]')].filter((node) => node.dataset.threat !== 'bomb');
      const lowest = threats.sort((a, b) => Number(b.dataset.y) - Number(a.dataset.y))[0];
      return lowest ? Math.min(1, Math.max(0, (Number(lowest.dataset.x) - 60) / 880)) : 0.5;
    });
    await hold(page, aim, 700);
    await page.evaluate(() => window.__si.step());
    await hold(page, aim, 300);
    if (!(await page.$('[data-phase="playing"]'))) return;
  }
}
const pauseKey = async (page) => { await page.locator('.skyline-invaders__pause').click(); await phase(page, 'paused'); };

const SHOTS = {
  'who': { query: 'pose=detecting&shooter=none&roster=kid,test-rider', go: async (page) => { await screen(page, 'who'); } },
  'who-nobody': { query: 'pose=detecting&shooter=none', go: async (page) => { await screen(page, 'who'); } },
  'roster': { query: 'pose=detecting&shooter=none&roster=kid', go: async (page) => { await screen(page, 'who'); await padHold(page); await screen(page, 'roster'); } },
  'waves': { query: 'pose=detecting', go: async (page) => { await screen(page, 'waves'); } },
  'waves-first-time': { query: 'pose=detecting&controls=none', go: async (page) => { await screen(page, 'waves'); } },
  'waves-done-row': { query: 'pose=detecting', go: async (page) => { await screen(page, 'waves'); await pad(page, 1); } },
  'waves-locked-row': { query: 'pose=detecting', go: async (page) => { await screen(page, 'waves'); await pad(page, 2); } },
  'waves-sound': { query: 'pose=detecting', go: async (page) => { await screen(page, 'waves'); await page.getByRole('button', { name: 'Sound and settings' }).click(); await screen(page, 'sound'); } },
  // The controls intro: every card, a little into its demo; the first with the cannon on the left target.
  'controls-1-wiper-left-target': { query: 'pose=detecting&controls=none', go: async (page) => { await controls(page, 0); await hold(page, 0.06, 1400); } },
  'controls-2-twist': { query: 'pose=detecting&controls=none', go: async (page) => { await controls(page, 1); await run(page, 700); } },
  'controls-3-wings': { query: 'pose=detecting&controls=none', go: async (page) => { await controls(page, 2); await run(page, 500); } },
  'controls-4-wheel': { query: 'pose=detecting&controls=none', go: async (page) => { await controls(page, 3); await run(page, 500); } },
  'controls-5-sprinkler': { query: 'pose=detecting&controls=none', go: async (page) => { await controls(page, 4); await run(page, 500); } },
  'controls-6-drag': { query: 'pose=detecting&controls=none', go: async (page) => { await controls(page, 5); await run(page, 1500); } },
  'controls-7-push': { query: 'pose=detecting&controls=none', go: async (page) => { await controls(page, 6); await run(page, 800); } },
  'controls-8-hop': { query: 'pose=detecting&controls=none', go: async (page) => { await controls(page, 7); await run(page, 300); } },
  'controls-change-all-lit': { query: 'pose=detecting&controls=wiper', go: async (page) => { await controls(page, 0, false); await hold(page, 0.06, 1200); await hold(page, 0.94, 1200); await hold(page, 0.5, 1200); } },
  'locked': { query: 'pose=detecting&kiosk=1', go: async (page) => { await screen(page, 'locked'); } },
  'locked-unlock-prompt': { query: 'pose=detecting&kiosk=1', go: async (page) => { await screen(page, 'locked'); await pad(page, 1); await run(page, 300); await page.waitForSelector('.unlock-prompt'); } },
  'locked-adult-picked': { query: 'pose=detecting&kiosk=1&roster=kid&learners=kid', go: async (page) => {
    await screen(page, 'locked'); await pad(page, 4); await screen(page, 'who'); await padHold(page); await screen(page, 'roster');
    await page.locator('.skyline-invaders__person', { hasText: 'Test Rider' }).click(); await run(page, 300); await screen(page, 'locked');
  } },
  'ready-stand': { query: 'pose=detecting&controls=twist', go: async (page) => { await screen(page, 'waves'); await pad(page, 4); await screen(page, 'ready'); await hold(page, 0.5, 600); } },
  countdown: { query: 'pose=detecting&partner=1', go: async (page) => { await readyAndCount(page); await run(page, 1200); } },
  'in-game': { query: 'pose=detecting&partner=1', go: async (page) => { await start(page); await shootFor(page, 9); } },
  'in-game-out-of-fuel': { query: 'pose=detecting', go: async (page) => { await start(page); await hold(page, 0.3, 4000); } },
  'in-game-bomb-ready': { query: 'pose=detecting', go: async (page) => { await start(page); await shootFor(page, 26); } },
  'in-game-gamepad-aim': { query: 'pose=camera-denied', go: async (page) => { await startDenied(page); await run(page, 4000); await page.keyboard.press('Space'); await run(page, 250); } },
  'in-game-pose-lost': { query: 'pose=detecting', go: async (page) => { await start(page); await hold(page, 0.8, 2500); await run(page, 1500); } },
  'paused-by-touch': { query: 'pose=detecting&partner=1', go: async (page) => { await start(page); await shootFor(page, 2); await pauseKey(page); } },
  'paused-sound': { query: 'pose=detecting&partner=1', go: async (page) => { await start(page); await shootFor(page, 2); await pauseKey(page); await pad(page, 2); await screen(page, 'sound'); } },
  'result-fell-short': { query: 'pose=camera-denied', go: async (page) => { await startDenied(page); await run(page, 31000); await phase(page, 'result'); await page.waitForSelector('[data-save="saved"]'); } },
  'result-held': { query: 'pose=detecting', go: async (page) => { await start(page); await shootFor(page, 31); await run(page, 1500); await phase(page, 'result'); await page.waitForSelector('[data-save="saved"]'); } },
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
  const menus = [...root.querySelectorAll('.skyline-invaders__menu, .skyline-invaders__hud')];
  const texts = menus.flatMap((menu) => [...menu.querySelectorAll('*')])
    .filter((node) => node.children.length === 0 && node.textContent.trim() && visible(node) && !node.closest('[aria-hidden="true"]'))
    .map((node) => ({ text: node.textContent.trim().slice(0, 60), px: Math.round(parseFloat(getComputedStyle(node).fontSize)), ...box(node) }));
  const buttons = [...root.querySelectorAll('button')].filter(visible).map((node) => ({ text: (node.getAttribute('aria-label') || node.textContent).trim().slice(0, 60), ...box(node) }));
  // The "more" button must sit clear of every window and panel frame.
  const more = root.querySelector('.skyline-invaders__more');
  const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  const overlaps = more ? [...root.querySelectorAll('.skyline-menus, .skyline-invaders__pause, .skyline-invaders__hud-left, .skyline-invaders__hud-centre, .skyline-invaders__hud-right, .skyline-invaders__hud-notes > *')].filter((frame) => hit(box(more), box(frame))).map((frame) => frame.className) : [];
  const moreBox = more ? box(more) : null;
  return { overlaps, moreBox, texts, buttons, width: window.innerWidth, height: window.innerHeight, scroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight] };
});

// Muted twice over: the Invaders harness stubs the game's audio engine, and the browser itself has no volume.
const browser = await engine.launch(engine === firefox ? { firefoxUserPrefs: { 'media.volume_scale': '0.0' } } : { args: ['--mute-audio'] });
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
