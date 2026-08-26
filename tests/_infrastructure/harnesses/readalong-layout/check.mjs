// Real-geometry check for the readalong viewer at the Portal's exact 1280x800.
// jsdom cannot see layout; this can. Run from the worktree root:
//   node tests/_infrastructure/harnesses/readalong-layout/check.mjs [--shots-dir DIR]
// Starts the harness vite server itself, drives headless Chromium, asserts the
// geometry that the live bug broke, and saves screenshots.
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const worktreeRoot = path.resolve(__dirname, '../../../..');
const shotsDirArg = process.argv.indexOf('--shots-dir');
const shotsDir = shotsDirArg > -1 ? process.argv[shotsDirArg + 1] : __dirname;

// Playwright lives in the main repo's node_modules (worktree root symlinks it).
const require = createRequire(path.join(worktreeRoot, 'node_modules', 'noop.js'));
const { chromium } = require('playwright');

const PORT = 5199;

// Generate the 149s silent WAV fixture (gitignored — 1.2MB of silence has no
// business in the repo). 149s matches the live incident's 2:29 audio.
{
  const { writeFileSync, mkdirSync } = await import('fs');
  const sr = 8000; const secs = 149; const n = sr * secs;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + n, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22); header.writeUInt32LE(sr, 24); header.writeUInt32LE(sr, 28);
  header.writeUInt16LE(1, 32); header.writeUInt16LE(8, 34);
  header.write('data', 36); header.writeUInt32LE(n, 40);
  mkdirSync(path.join(__dirname, 'public'), { recursive: true });
  writeFileSync(path.join(__dirname, 'public/fixture.wav'), Buffer.concat([header, Buffer.alloc(n, 128)]));
}

const vite = spawn(
  path.join(worktreeRoot, 'frontend/node_modules/.bin/vite'),
  ['--config', path.join(__dirname, 'vite.config.mjs'), '--port', String(PORT), '--strictPort'],
  { cwd: worktreeRoot, stdio: ['ignore', 'pipe', 'pipe'] }
);
const viteOut = [];
vite.stdout.on('data', (d) => viteOut.push(String(d)));
vite.stderr.on('data', (d) => viteOut.push(String(d)));

const waitForServer = async () => {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://localhost:${PORT}/`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`vite never came up:\n${viteOut.join('')}`);
};

const failures = [];
const check = (label, ok, detail) => {
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`${mark}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

try {
  await waitForServer();
  const browser = await chromium.launch({
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('.content-scroller .verse-text', { timeout: 15000 });
  await page.waitForFunction(() => {
    const el = document.querySelector('audio');
    return el && Number.isFinite(el.duration) && el.duration > 0;
  }, { timeout: 15000 });

  // ---- The bug under test: the verse panel must own the screen. ----
  const geo = await page.evaluate(() => {
    const rect = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, height: r.height, width: r.width };
    };
    const firstVisibleVerse = (() => {
      const panel = document.querySelector('.textpanel');
      if (!panel) return null;
      const pr = panel.getBoundingClientRect();
      for (const v of document.querySelectorAll('.verse-text')) {
        const r = v.getBoundingClientRect();
        if (r.height > 0 && r.top >= pr.top - 1 && r.bottom <= pr.bottom + 1) {
          return { top: r.top, bottom: r.bottom, text: v.textContent };
        }
      }
      return null;
    })();
    return {
      playlist: rect('.readalong-playlist'),
      stage: rect('.readalong-playlist__stage'),
      player: rect('.readalong-playlist__stage .player'),
      scroller: rect('.content-scroller'),
      textpanel: rect('.textpanel'),
      controls: rect('.readalong-playlist__controls'),
      guide: rect('.reading-guide'),
      firstVisibleVerse,
      verseCount: document.querySelectorAll('.verse-text').length,
    };
  });

  check('playlist fills the 800px screen', Math.round(geo.playlist?.height) === 800, `height=${geo.playlist?.height}`);
  check('stage has real height', (geo.stage?.height ?? 0) > 400, `height=${geo.stage?.height}`);
  check('.player fills the stage (the collapsed link in the live bug)',
    Math.abs((geo.player?.height ?? 0) - (geo.stage?.height ?? -1)) < 2,
    `player=${geo.player?.height} stage=${geo.stage?.height}`);
  check('scroller fills the player', Math.abs((geo.scroller?.height ?? 0) - (geo.player?.height ?? -1)) < 2,
    `scroller=${geo.scroller?.height}`);
  check('verse panel owns most of the stage', (geo.textpanel?.height ?? 0) > 350, `height=${geo.textpanel?.height}`);
  check('verse text is present and visible in the panel', Boolean(geo.firstVisibleVerse),
    geo.firstVisibleVerse ? `"${geo.firstVisibleVerse.text.slice(0, 40)}"` : `verseCount=${geo.verseCount}`);
  check('transport row sits at the bottom edge', Math.round(geo.controls?.bottom) === 800, `bottom=${geo.controls?.bottom}`);
  check('reading guide is visible on this surface', (geo.guide?.height ?? 0) > 0, `h=${geo.guide?.height}`);

  // The textpanel fades in over 6s by design — wait it out so the screenshot
  // shows the settled page, not the fade.
  await page.waitForTimeout(6500);
  await page.screenshot({ path: path.join(shotsDir, 'readalong-after-start.png') });

  // ---- Mid-playback state (0:53 of 2:29, matching the live incident). ----
  await page.evaluate(() => { document.querySelector('audio').currentTime = 53; });
  await page.waitForTimeout(1200); // let the scroll transition settle
  const mid = await page.evaluate(() => {
    const panel = document.querySelector('.textpanel').getBoundingClientRect();
    const guide = document.querySelector('.reading-guide')?.getBoundingClientRect() ?? null;
    const visibleVerses = [...document.querySelectorAll('.verse-text')].filter((v) => {
      const r = v.getBoundingClientRect();
      return r.height > 0 && r.bottom > panel.top && r.top < panel.bottom;
    }).length;
    const audio = document.querySelector('audio');
    const fill = document.querySelector('.readalong-playlist__chapter.is-current .readalong-playlist__chapter-fill i');
    return {
      visibleVerses,
      currentTime: audio.currentTime,
      chipFillWidth: fill ? fill.style.width : null,
      guideInPanel: guide ? guide.top >= panel.top - 1 && guide.bottom <= panel.bottom + 1 : false,
    };
  });
  check('verses still visible mid-chapter after seek', mid.visibleVerses > 3, `visible=${mid.visibleVerses}`);
  check('chapter chip fill tracks playback (the dead onProgress path, fixed)',
    parseFloat(mid.chipFillWidth) > 20, `fill=${mid.chipFillWidth} t=${mid.currentTime}`);
  check('reading guide stays inside the panel mid-chapter', mid.guideInPanel);

  await page.screenshot({ path: path.join(shotsDir, 'readalong-after-mid.png') });
  await browser.close();
} finally {
  vite.kill('SIGTERM');
}

if (failures.length) {
  console.error(`\n${failures.length} geometry check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll geometry checks passed.');
