// Real-geometry check for the teacher dashboard's lesson-card grid.
// jsdom cannot see layout; this can. Run from the worktree root:
//   node tests/_infrastructure/harnesses/teacher-roster-grid/check.mjs [--shots-dir DIR]
// Starts the harness vite server, drives headless Chromium at the dashboard's
// two real sizes (desktop 1440x900, small-desktop/tablet 1024x768), asserts
// the geometry the operator asked for — side-by-side cards, 2:3 poster frames
// that hold their box before and after the art loads (no rug pull), score
// marks, >=40px artifact tap targets that open the artifact itself — and
// saves screenshots.
import { spawn } from 'child_process';
import path from 'path';
import zlib from 'zlib';
import { writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const worktreeRoot = path.resolve(__dirname, '../../../..');
const shotsDirArg = process.argv.indexOf('--shots-dir');
const shotsDir = shotsDirArg > -1 ? process.argv[shotsDirArg + 1] : __dirname;

// Playwright lives in the main repo's node_modules (worktree root symlinks it).
const require = createRequire(path.join(worktreeRoot, 'node_modules', 'noop.js'));
const { chromium } = require('playwright');

const PORT = 5201;

// ---- Generate solid-colour PNG fixtures (gitignored; bytes have no business
// in the repo). Hand-rolled encoder: IHDR + IDAT(deflate) + IEND with CRC32.
function crc32(buf) {
  let c; const table = [];
  for (let n = 0; n < 256; n += 1) {
    c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const byte of buf) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
}
function solidPng(width, height, [r, g, b]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit, truecolour
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3)]);
  for (let x = 0; x < width; x += 1) { row[1 + x * 3] = r; row[2 + x * 3] = g; row[3 + x * 3] = b; }
  const idat = zlib.deflateSync(Buffer.concat(Array.from({ length: height }, () => row)));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)),
  ]);
}
{
  const pub = path.join(__dirname, 'public');
  mkdirSync(pub, { recursive: true });
  writeFileSync(path.join(pub, 'poster.png'), solidPng(200, 300, [0x8f, 0xa8, 0x7a]));
  writeFileSync(path.join(pub, 'worksheet-thumb.png'), solidPng(300, 400, [0xe8, 0xe2, 0xd4]));
  writeFileSync(path.join(pub, 'receipt.png'), solidPng(384, 620, [0xf4, 0xf0, 0xe6]));
  writeFileSync(path.join(pub, 'worksheet.pdf'), Buffer.from('%PDF-1.4\n%fixture\n'));
}

const vite = spawn(
  path.join(worktreeRoot, 'frontend/node_modules/.bin/vite'),
  ['--config', path.join(__dirname, 'vite.config.mjs'), '--port', String(PORT), '--strictPort'],
  { cwd: worktreeRoot, stdio: ['ignore', 'pipe', 'pipe'] },
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

async function measure(page) {
  return page.evaluate(() => {
    const cards = [...document.querySelectorAll('[data-testid="lesson-card"]')].map((el) => {
      const r = el.getBoundingClientRect();
      const chip = el.querySelector('.teacher-day-chip')?.textContent ?? '';
      return { top: Math.round(r.top), left: Math.round(r.left), width: r.width, height: r.height, chip };
    });
    const buttons = [...document.querySelectorAll('.teacher-artifact-btn')].map((el) => {
      const r = el.getBoundingClientRect();
      return { width: r.width, height: r.height };
    });
    const posters = [...document.querySelectorAll('.teacher-lesson-card__poster')].map((el) => {
      const r = el.getBoundingClientRect();
      return { width: r.width, height: r.height, hasImage: Boolean(el.querySelector('img')) };
    });
    const graded = document.querySelector('[data-testid="score-marks"]');
    return {
      cards,
      buttons,
      posters,
      firstRowCount: cards.filter((c) => c.top === cards[0]?.top).length,
      checkMarks: graded ? graded.querySelectorAll('.teacher-mark--check').length : 0,
      crossMarks: graded ? graded.querySelectorAll('.teacher-mark--cross').length : 0,
      percentTexts: [...document.querySelectorAll('.teacher-lesson-card__percent')].map((el) => el.textContent),
      overflowX: document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth,
      chips: cards.map((c) => c.chip),
    };
  });
}

async function runViewport(browser, { width, height, name, minColumns, peek }) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('.teacher-roster__card', { timeout: 15000 });

  // The agenda is reachable BEFORE anything is expanded — it lives on the
  // roster card, not behind the disclosure.
  const agendaLink = await page.$('.teacher-roster__agenda-link');
  check(`${name}: the agenda link is on the roster card, unexpanded`, Boolean(agendaLink));
  const agendaGeo = agendaLink ? await agendaLink.boundingBox() : null;
  check(`${name}: the agenda link is a >=40px target`,
    Boolean(agendaGeo) && agendaGeo.width >= 40 && agendaGeo.height >= 40,
    agendaGeo ? `${agendaGeo.width}x${agendaGeo.height}` : 'missing');
  check(`${name}: the agenda link opens the preview in a new tab`,
    (await agendaLink?.getAttribute('target')) === '_blank'
      && (await agendaLink?.getAttribute('href'))?.includes('/agenda/preview'),
    await agendaLink?.getAttribute('href'));

  await page.click('.teacher-roster__card');
  await page.waitForSelector('[data-testid="lesson-grid"]', { timeout: 15000 });
  // Six cards: 4 recorded + 1 planned + 1 deferred (agenda join settled).
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid="lesson-card"]').length === 6,
    { timeout: 15000 },
  );

  // NO RUG PULL. Geometry the instant the grid exists, versus geometry once
  // every poster has finished loading (or failed). A card that grows or slides
  // between those two moments is a card that moved under a hand already
  // reaching for it — the whole reason the poster frame is a reserved box.
  const before = await measure(page);
  await page.waitForFunction(
    () => [...document.images].every((img) => img.complete),
    { timeout: 15000 },
  );
  const geo = await measure(page);
  const moved = geo.cards
    .map((card, i) => ({
      i,
      dTop: Math.abs(card.top - (before.cards[i]?.top ?? card.top)),
      dLeft: Math.abs(card.left - (before.cards[i]?.left ?? card.left)),
      dHeight: Math.abs(card.height - (before.cards[i]?.height ?? card.height)),
    }))
    .filter((d) => d.dTop > 0.5 || d.dLeft > 0.5 || d.dHeight > 0.5);
  check(`${name}: no card moves or resizes when the posters load (no rug pull)`,
    moved.length === 0,
    moved.map((d) => `#${d.i} dy=${d.dTop.toFixed(1)} dx=${d.dLeft.toFixed(1)} dh=${d.dHeight.toFixed(1)}`).join(', '));
  const label = (text) => `${name}: ${text}`;

  check(label('six lesson cards render (4 recorded + planned + deferred)'), geo.cards.length === 6, `cards=${geo.cards.length}`);
  check(label(`cards sit side by side (>=${minColumns} in the first row)`), geo.firstRowCount >= minColumns, `firstRow=${geo.firstRowCount}`);
  const widths = geo.cards.map((c) => c.width);
  check(label('cards share one width'), Math.max(...widths) - Math.min(...widths) < 1.5, `min=${Math.min(...widths).toFixed(1)} max=${Math.max(...widths).toFixed(1)}`);
  const heights = geo.cards.map((c) => c.height);
  check(label('cards in the grid share one height'),
    Math.max(...heights) - Math.min(...heights) < 1.5,
    `min=${Math.min(...heights).toFixed(1)} max=${Math.max(...heights).toFixed(1)}`);
  check(label('every card carries a poster frame, poster or not'),
    geo.posters.length === geo.cards.length, `frames=${geo.posters.length} cards=${geo.cards.length}`);
  const posterRatios = geo.posters.map((p) => p.height / p.width);
  check(label('poster frames are 2:3 tall (h/w = 1.5)'),
    geo.posters.length > 0 && posterRatios.every((r) => Math.abs(r - 1.5) < 0.06),
    `ratios=${posterRatios.map((r) => r.toFixed(2)).join(',')}`);
  check(label('no horizontal overflow'), geo.overflowX <= 0, `overflowX=${geo.overflowX}`);
  check(label('score marks: 5 green checks + 2 red crosses on the 5/7 lesson'),
    geo.checkMarks === 5 && geo.crossMarks === 2, `checks=${geo.checkMarks} crosses=${geo.crossMarks}`);
  check(label('percentages render (71% and 100%)'),
    geo.percentTexts.includes('71%') && geo.percentTexts.includes('100%'), `got=${geo.percentTexts.join(',')}`);
  check(label('planned + deferred lessons appear as their own cards'),
    geo.chips.includes('Not started') && geo.chips.includes('Deferred'), `chips=${geo.chips.join('|')}`);
  check(label('unplanned work appears as an Extra card'), geo.chips.includes('Extra'), `chips=${geo.chips.join('|')}`);
  check(label('artifact tap targets are >=40px squares'),
    geo.buttons.length >= 4 && geo.buttons.every((b) => b.width >= 40 && b.height >= 40),
    `count=${geo.buttons.length} smallest=${Math.min(...geo.buttons.flatMap((b) => [b.width, b.height]))}`);

  check(label('the printed-agenda toggle is gone from the drill-in'),
    !(await page.$('.teacher-printed-agenda')));
  const dayLink = await page.$('.teacher-roster__day-link');
  check(label('the full-day-record link is on the drill-in'), Boolean(dayLink));

  await page.screenshot({ path: path.join(shotsDir, `roster-grid-${name}.png`) });

  if (peek) {
    // The icon IS the artifact: one tap, no interstitial.
    const worksheet = await page.$('.teacher-artifact-btn[aria-label="Open the worksheet"]');
    check(label('the worksheet icon is a real link to the PDF'),
      (await worksheet?.getAttribute('href')) === '/worksheet.pdf'
        && (await worksheet?.getAttribute('target')) === '_blank',
      `href=${await worksheet?.getAttribute('href')}`);
    const opened = await page.evaluate(() => {
      const calls = [];
      window.open = (...args) => { calls.push(args); return null; };
      document.querySelector('.teacher-artifact-btn[aria-label="Open the result receipt"]').click();
      return calls;
    });
    check(label('the receipt icon opens the PNG directly'),
      opened.length === 1 && opened[0][0] === '/receipt.png' && opened[0][1] === '_blank',
      JSON.stringify(opened));
    check(label('no modal is left behind either one'), !(await page.$('[role="dialog"]')));
  }

  await page.close();
}

try {
  await waitForServer();
  const browser = await chromium.launch();
  await runViewport(browser, { width: 1440, height: 900, name: 'desktop-1440x900', minColumns: 4, peek: true });
  await runViewport(browser, { width: 1024, height: 768, name: 'small-1024x768', minColumns: 3, peek: false });
  await browser.close();
} finally {
  vite.kill('SIGTERM');
}

if (failures.length) {
  console.error(`\n${failures.length} geometry check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll geometry checks passed.');
