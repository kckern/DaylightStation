#!/usr/bin/env node
/**
 * Board-rim geometry sweep. Builds entry.jsx with esbuild (real components, real
 * SCSS compiled by sass), renders each game × scenario headlessly at 1280×800,
 * and reports the size of the staff cards on each axis.
 *
 *   node tests/_infrastructure/harnesses/piano-board-rim/run.mjs [outDir]
 *
 * "space" is the rendered distance between two staff lines in px — the number
 * legibility actually depends on. The staff engraver draws a 100×112 viewBox
 * with lines 14 units apart, scaled uniformly into the card.
 */
import { build } from 'esbuild';
import { compile } from 'sass';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pkg from '/opt/Code/DaylightStation/node_modules/playwright/index.js';

const { chromium } = pkg;
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../..');
const FRONTEND = resolve(REPO, 'frontend');
const OUT = resolve(process.argv[2] || resolve(REPO, '_deleteme/piano-board-rim'));
mkdirSync(OUT, { recursive: true });

const ALIASES = {
  '@/': resolve(FRONTEND, 'src') + '/',
  '@shared-gaming/': resolve(REPO, 'shared/gaming') + '/',
  '@shared-music/': resolve(REPO, 'shared/music') + '/',
  '@shared-contracts/': resolve(REPO, 'shared/contracts') + '/',
  '@shared-interaction/': resolve(REPO, 'shared/interaction') + '/',
};

await build({
  entryPoints: [resolve(HERE, 'entry.jsx')],
  bundle: true,
  outfile: resolve(OUT, 'bundle.js'),
  format: 'iife',
  jsx: 'automatic',
  nodePaths: [resolve(FRONTEND, 'node_modules'), resolve(REPO, 'node_modules')],
  loader: { '.svg': 'dataurl', '.png': 'dataurl', '.webp': 'dataurl', '.js': 'jsx' },
  // Vite-only: `import.meta.glob` has no esbuild equivalent. Nothing the rim
  // geometry depends on is discovered through a glob, so it resolves to nothing.
  banner: { js: 'var __harnessGlob = function () { return {}; };' },
  define: {
    'import.meta.env': '{"DEV":false,"PROD":true,"MODE":"production"}',
    'import.meta.glob': '__harnessGlob',
    'process.env.NODE_ENV': '"production"',
  },
  logLevel: 'error',
  plugins: [{
    name: 'aliases-and-scss',
    setup(b) {
      b.onResolve({ filter: /^@/ }, (args) => {
        const key = Object.keys(ALIASES).find((prefix) => args.path.startsWith(prefix));
        if (!key) return undefined;
        return b.resolve(ALIASES[key] + args.path.slice(key.length), { kind: args.kind, resolveDir: args.resolveDir });
      });
      b.onLoad({ filter: /\.scss$/ }, (args) => ({ contents: compile(args.path).css, loader: 'css' }));
    },
  }],
});

writeFileSync(resolve(OUT, 'index.html'), `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="bundle.css">
<style>html,body{margin:0;background:#000;font-family:'Roboto Condensed',system-ui,sans-serif;color:#f1f1f4}*{box-sizing:border-box}</style>
</head><body><div id="root"></div><script src="bundle.js"></script></body></html>`);

const SCENARIOS = [
  { id: 'A-today', label: 'Today', header: 59 },
  { id: 'B-no-header', label: 'Header hidden', header: 0 },
  { id: 'C-slim-keys', label: '+ keyboard 3rem', header: 0, kb: '3rem' },
  { id: 'D-narrow-rails', label: '+ rails 11rem', header: 0, kb: '3rem', rail: '11rem' },
  { id: 'E-no-ceiling', label: '+ board ceiling lifted', header: 0, kb: '3rem', rail: '11rem', boardMax: '100rem' },
  { id: 'F-max', label: 'Header+keys hidden, rails 11rem, no ceiling', header: 0, kb: '0', rail: '11rem', boardMax: '100rem' },
  { id: 'G-rails-fixed', label: 'No header, keys 3rem, rails fixed 11rem, no ceiling', header: 0, kb: '3rem', rail: '11rem', railTrack: '11rem', boardMax: '100rem' },
  { id: 'H-rails-gone', label: 'No header, keys 3rem, rails hidden, no ceiling', header: 0, kb: '3rem', railTrack: '0px', boardMax: '100rem' },
  { id: 'I-ck-rim-5rem', label: 'E + checkers rim 5rem', header: 0, kb: '3rem', rail: '11rem', boardMax: '100rem', ckRail: '5rem' },
  // The per-game token changes on their own, with today's header and keyboard.
  { id: 'J-today-ck-rim', label: 'Today + checkers rim 5rem', header: 59, ckRail: '5rem' },
  { id: 'K-today-no-ceiling', label: 'Today + board ceiling lifted', header: 59, boardMax: '100rem' },
  // The shipped capability, through the real provider and the real host classes.
  { id: 'FS-kiosk', label: 'Kiosk full screen', header: 59, fullscreen: '1' },
];
const GAMES = ['chess', 'checkers', 'connect-four'];

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));

const rows = [];
for (const game of GAMES) {
  for (const scenario of SCENARIOS) {
    const params = new URLSearchParams({ game, header: String(scenario.header) });
    for (const key of ['kb', 'rail', 'boardMax', 'railTrack', 'ckRail', 'fullscreen']) if (scenario[key]) params.set(key, scenario[key]);
    await page.goto(`${pathToFileURL(resolve(OUT, 'index.html'))}?${params}`);
    await page.waitForSelector('.chess-staff-label svg', { timeout: 10000 });
    await page.waitForTimeout(150);
    const m = await page.evaluate(() => {
      const box = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom }; };
      const axisOf = (el) => (el.closest('.chess-board__rank-axis, .checkers-stage__rank-rail') ? 'rank' : 'file');
      // Line spacing is read off the drawn staff lines, so it holds for both the
      // shared staff (lines in their own stretched SVG) and the rim geometry.
      const spacingOf = (el) => {
        const lines = el.querySelector('.action-staff__rim-svg')
          ? el.querySelectorAll('.action-staff__line')
          : el.querySelectorAll('.action-staff__lines-svg line');
        const ys = [...lines].map((line) => line.getBoundingClientRect().y);
        return ys.length === 5 ? (Math.max(...ys) - Math.min(...ys)) / 4 : 0;
      };
      const cards = [...document.querySelectorAll('.chess-staff-label')].map((el) => ({ axis: axisOf(el), space: spacingOf(el), ...box(el) }));
      const summarise = (axis) => {
        const list = cards.filter((c) => c.axis === axis);
        if (!list.length) return null;
        const c = list[0];
        return { n: list.length, w: +c.w.toFixed(1), h: +c.h.toFixed(1), space: +c.space.toFixed(1) };
      };
      const boardEl = document.querySelector('.chess-board, .checkers-board, .connect-four-board');
      const kbEl = document.querySelector('.piano-game-host__instrument');
      const stageEl = document.querySelector('.instrument-board-stage');
      const rails = [...document.querySelectorAll('.instrument-board-stage__rail')].map(box);
      const board = box(boardEl);
      const clipped = cards.some((c) => c.bottom > 801 || c.right > 1281 || c.x < -1 || c.y < -1);
      // How far the worst file card sits off the centre of the column it names.
      const fileCards = cards.filter((c) => c.axis === 'file');
      const firstRow = [...boardEl.children].slice(0, fileCards.length).map(box);
      const drift = fileCards.length && firstRow.length === fileCards.length
        ? +Math.max(...fileCards.map((c, i) => Math.abs((c.x + c.w / 2) - (firstRow[i].x + firstRow[i].w / 2)))).toFixed(1)
        : null;
      // And the worst rank card off the centre of the row it names (first column).
      const rankCards = cards.filter((c) => c.axis === 'rank');
      const firstColumn = [...boardEl.children].filter((_, i) => i % 8 === 0).slice(0, rankCards.length).map(box);
      const rankDrift = rankCards.length && firstColumn.length === rankCards.length && boardEl.children.length === 64
        ? +Math.max(...rankCards.map((c, i) => Math.abs((c.y + c.h / 2) - (firstColumn[i].y + firstColumn[i].h / 2)))).toFixed(1)
        : null;
      return {
        file: summarise('file'),
        rank: summarise('rank'),
        board: { w: +board.w.toFixed(1), h: +board.h.toFixed(1) },
        railW: rails[0] ? +rails[0].w.toFixed(1) : null,
        stage: box(stageEl),
        kbH: kbEl && getComputedStyle(kbEl).display !== 'none' ? +box(kbEl).h.toFixed(1) : 0,
        overlapsKeyboard: kbEl ? board.bottom > box(kbEl).y + 1 && getComputedStyle(kbEl).display !== 'none' : false,
        clipped,
        drift,
        rankDrift,
      };
    });
    await page.screenshot({ path: resolve(OUT, `${game}-${scenario.id}.png`) });
    rows.push({ game, scenario: scenario.id, label: scenario.label, ...m });
  }
}
// The notation mock: today's card boxes, redrawn over each axis's range only.
await page.setViewportSize({ width: 1280, height: 900 });
await page.goto(`${pathToFileURL(resolve(OUT, 'index.html'))}?game=mock`);
await page.waitForSelector('.mock-ready', { state: 'attached', timeout: 10000 });
await page.waitForTimeout(150);
await page.locator('.mock').screenshot({ path: resolve(OUT, 'mock-cards.png') });
await browser.close();

writeFileSync(resolve(OUT, 'results.json'), JSON.stringify(rows, null, 2));
const fmt = (a) => (a ? `${a.w}×${a.h} (${a.space}px)` : '—');
console.log('game          scenario          board        rail   kb    file card (space)     rank card (space)     flags');
for (const r of rows) {
  const flags = [
    r.overlapsKeyboard && 'OVERLAPS-KB',
    r.clipped && 'CLIPPED',
    r.drift != null && `drift ${r.drift}px`,
    r.rankDrift != null && `rank drift ${r.rankDrift}px`,
  ].filter(Boolean).join(' ');
  console.log(`${r.game.padEnd(13)} ${r.scenario.padEnd(17)} ${`${r.board.w}×${r.board.h}`.padEnd(12)} ${String(r.railW).padEnd(6)} ${String(r.kbH).padEnd(5)} ${fmt(r.file).padEnd(21)} ${fmt(r.rank).padEnd(21)} ${flags}`);
}
if (errors.length) console.log('\npage errors:', [...new Set(errors)].join('\n'));
console.log(`\n${OUT}`);
