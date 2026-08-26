// Real-geometry check for the teacher dashboard's lesson-card grid.
// jsdom cannot see layout; this can. Run from the worktree root:
//   node tests/_infrastructure/harnesses/teacher-roster-grid/check.mjs [--shots-dir DIR]
// Starts the harness vite server, drives headless Chromium at the dashboard's
// two real sizes (desktop 1440x900, small-desktop/tablet 1024x768), asserts
// the geometry the operator asked for — side-by-side, roughly square cards,
// score marks, >=40px artifact tap targets, in-place artifact peek — and
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
    const graded = document.querySelector('[data-testid="score-marks"]');
    return {
      cards,
      buttons,
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
  await page.click('.teacher-roster__card');
  await page.waitForSelector('[data-testid="lesson-grid"]', { timeout: 15000 });
  // Six cards: 4 recorded + 1 planned + 1 deferred (agenda join settled).
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid="lesson-card"]').length === 6,
    { timeout: 15000 },
  );

  const geo = await measure(page);
  const label = (text) => `${name}: ${text}`;

  check(label('six lesson cards render (4 recorded + planned + deferred)'), geo.cards.length === 6, `cards=${geo.cards.length}`);
  check(label(`cards sit side by side (>=${minColumns} in the first row)`), geo.firstRowCount >= minColumns, `firstRow=${geo.firstRowCount}`);
  const widths = geo.cards.map((c) => c.width);
  check(label('cards share one width'), Math.max(...widths) - Math.min(...widths) < 1.5, `min=${Math.min(...widths).toFixed(1)} max=${Math.max(...widths).toFixed(1)}`);
  const ratios = geo.cards.map((c) => c.height / c.width);
  check(label('cards are roughly square (~16:19, h/w within 1.0–1.6)'),
    ratios.every((r) => r >= 1.0 && r <= 1.6), `ratios=${ratios.map((r) => r.toFixed(2)).join(',')}`);
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

  const agendaButton = await page.$('.teacher-printed-agenda button');
  check(label('the printed-agenda affordance is on the drill-in'), Boolean(agendaButton));
  const dayLink = await page.$('.teacher-roster__day-link');
  check(label('the full-day-record link is on the drill-in'), Boolean(dayLink));

  await page.screenshot({ path: path.join(shotsDir, `roster-grid-${name}.png`) });

  if (peek) {
    await page.click('.teacher-artifact-btn[aria-label="Peek at the worksheet"]');
    await page.waitForSelector('.teacher-artifact-peek', { timeout: 10000 });
    const peekGeo = await page.evaluate(() => {
      const overlay = document.querySelector('.teacher-artifact-peek').getBoundingClientRect();
      const close = document.querySelector('.teacher-artifact-peek__close').getBoundingClientRect();
      const thumb = document.querySelector('.teacher-artifact-peek img');
      const link = [...document.querySelectorAll('.teacher-artifact-peek a')]
        .find((a) => a.textContent.includes('Open worksheet'));
      return {
        coversViewport: overlay.width >= window.innerWidth - 1 && overlay.height >= window.innerHeight - 1,
        close: { width: close.width, height: close.height },
        thumbLoaded: Boolean(thumb && thumb.naturalWidth > 0),
        linkHref: link?.getAttribute('href') ?? null,
      };
    });
    check(label('artifact peek overlays the whole dashboard'), peekGeo.coversViewport);
    check(label('peek close button is a >=44px target'), peekGeo.close.width >= 44 && peekGeo.close.height >= 44,
      `${peekGeo.close.width}x${peekGeo.close.height}`);
    check(label('worksheet thumbnail actually loads in the peek'), peekGeo.thumbLoaded);
    check(label('peek offers the original PDF'), peekGeo.linkHref === '/worksheet.pdf', `href=${peekGeo.linkHref}`);
    await page.screenshot({ path: path.join(shotsDir, `roster-grid-${name}-peek.png`) });
    await page.click('.teacher-artifact-peek__close');
    const gone = await page.waitForSelector('.teacher-artifact-peek', { state: 'detached', timeout: 5000 })
      .then(() => true).catch(() => false);
    check(label('peek closes back to the dashboard'), gone);
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
