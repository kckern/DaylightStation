// The progress strip in a real browser (Chromium, 1280x800, the piano tablet's
// screen): the real PianoHomeDesk, its SCSS and the piano tokens, with only the
// HTTP, the roster and logging replaced. Every card is checked for anything that
// spills past its edge (a long title, a 20-passage coin map, a missing still),
// a real pointer swipe switches a card, and each layout is saved as a screenshot.
// Set DESK_SHOTS to a folder to keep the screenshots somewhere else.
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../../../..');
const require = createRequire(path.join(ROOT, 'frontend/package.json'));
const SHOTS = process.env.DESK_SHOTS || path.join(os.tmpdir(), 'piano-desk-shots');

const stubs = [
  [/lib\/logging\/Logger\.js$/, `const L={}; for(const level of ['info','warn','error','debug','sampled']) L[level]=(event,data)=>{ (window.__logs??=[]).push({level,event,data}); }; L.child=()=>L; export default ()=>L; export const getLogger=()=>L;`],
  [/lib\/api\.mjs$/, `export const DaylightAPI=async(url)=>window.__api(url);export const DaylightAPIText=async(url)=>window.__xml(url);`],
  [/PianoKiosk\/PianoUserContext\.jsx$/, `export const usePianoUser=()=>({users:window.__users});`],
  [/PianoKiosk\/pianoListCache\.js$/, `export const idbGet=async()=>null;export const idbSet=async()=>{};export const idbClear=async()=>{};`],
];

const PIECE_TITLES = {
  jingle: 'Jingle Bells',
  prelude: 'Prelude in C Major from the Well-Tempered Clavier, Book One',
  minuet: 'Minuet in G',
  nocturne: 'Nocturne in E-flat Major, Opus 9 Number 2 (Simplified)',
};
const passages = (count, states) => Array.from({ length: count }, (_, index) => ({
  id: `p${index}`, start: index * 4, end: index * 4 + 3, state: states(index), steps: { done: index < 3 ? 1 : 0, total: 4 },
}));
const pieceOf = (key, count, states, extra = {}) => {
  const list = passages(count, states);
  return {
    scoreId: `files:docs/sheet-music/${key}.mxl`, practicedAt: '2026-11-19T10:00:00Z', total: count,
    silver: list.filter((p) => p.state === 'silver' || p.state === 'gold').length,
    gold: list.filter((p) => p.state === 'gold').length,
    next: { passageId: 'p1', skill: 'pulse', label: 'Settle into a beat', start: 4, end: 7 },
    passages: list, ...extra,
  };
};
const courseOf = (title, still, extra = {}) => ({
  courseId: 'plex:9', courseTitle: 'Piano University: Foundations', thumbnail: '/img/course.svg', completed: 46, total: 173,
  lastPlayedAt: '2026-11-18T10:00:00Z', next: { id: 'plex:91', title, thumbnail: still, position: 47 }, ...extra,
});

const KIDS = {
  ada: { name: 'Ada', piece: pieceOf('jingle', 2, (i) => (i === 0 ? 'silver' : 'learning'), { cover: '/img/jingle.svg' }), course: courseOf('Lesson 51 | Jingle Bells', '/img/still-a.svg') },
  ben: { name: 'Benjamin', piece: pieceOf('prelude', 20, (i) => (i < 4 ? 'gold' : i < 9 ? 'silver' : i === 9 ? 'learning' : 'todo'), { next: { passageId: 'p9', skill: 'notes', label: 'Find the right-hand notes', start: 36, end: 39 } }) },
  cleo: { name: 'Cleo', course: courseOf('Lesson 101 | Counting Rhythms with Our Rhythm Challenge - Eighth Rests', '/img/still-c.svg') },
  dot: { name: 'Dot', course: courseOf('Lesson 3 | Hot Cross Buns', null, { completed: 2, total: 40 }) },
  fay: { name: 'Fay', piece: pieceOf('nocturne', 3, () => 'gold', { cover: '/img/minuet.svg', polish: { gem: true, diamond: false }, next: { passageId: 'p1', skill: 'pulse', label: 'Settle into a beat with both hands', start: 4, end: 7 } }) },
  gus: { name: 'Gus', piece: pieceOf('nocturne', 4, (i) => (i < 2 ? 'gold' : 'silver'), { cover: '/img/jingle.svg' }) },
  hal: { name: 'Hal', piece: pieceOf('minuet', 10, () => 'silver', { cover: '/img/minuet.svg' }) },
  eve: { name: 'Eve', piece: pieceOf('minuet', 7, (i) => (i < 5 ? 'silver' : i === 5 ? 'learning' : 'todo'), { cover: '/img/minuet.svg' }) },
};

const svg = (w, h, hue, label) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},55%,45%)"/><stop offset="1" stop-color="hsl(${hue + 40},55%,25%)"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><text x="50%" y="50%" fill="white" font-family="sans-serif" font-size="${Math.round(h / 8)}" text-anchor="middle">${label}</text></svg>`;
const IMAGES = {
  'jingle.svg': svg(120, 180, 0, 'Jingle'),
  'minuet.svg': svg(120, 180, 200, 'Minuet'),
  'course.svg': svg(120, 180, 140, 'PU'),
  'still-a.svg': svg(192, 108, 30, 'Lesson 51'),
  'still-c.svg': svg(192, 108, 260, 'Lesson 101'),
};

let browser; let js; let css;
beforeAll(async () => {
  const sheets = new Set();
  const esbuild = require('esbuild');
  const bundle = await esbuild.build({
    stdin: { contents: `import{createRoot}from'react-dom/client';import PianoHomeDesk from './PianoHomeDesk.jsx';window.__root=createRoot(document.getElementById('root'));window.__root.render(<PianoHomeDesk onOpenPassage={(...a)=>(window.__opened??=[]).push(a)} onOpenCourse={(...a)=>(window.__opened??=[]).push(a)} disabled={window.__disabled} />);`, resolveDir: HERE, loader: 'jsx' },
    bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.js': 'jsx', '.jsx': 'jsx' },
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{"MODE":"production","DEV":false,"PROD":true}' }, logLevel: 'silent',
    plugins: [{ name: 'io-only', setup(build) {
      build.onResolve({ filter: /\.(scss|css)$/ }, (args) => { const file = args.path.startsWith('.') ? path.resolve(args.resolveDir, args.path) : require.resolve(args.path); sheets.add(file); return { path: file, namespace: 'sheet' }; });
      build.onLoad({ filter: /.*/, namespace: 'sheet' }, () => ({ contents: '', loader: 'js' }));
      build.onLoad({ filter: /\.(jsx|js|mjs)$/ }, (args) => {
        for (const [pattern, contents] of stubs) if (pattern.test(args.path)) return { contents, loader: 'jsx' };
        if (args.path.endsWith('/ui/icons/Icon.jsx')) {
          const dir = path.join(path.dirname(args.path), 'svg');
          const files = [...fs.readdirSync(dir).filter((f) => f.endsWith('.svg')), ...fs.readdirSync(path.join(dir, 'generated')).filter((f) => f.endsWith('.svg')).map((f) => `generated/${f}`)];
          const assets = Object.fromEntries(files.map((f) => [`./svg/${f}`, fs.readFileSync(path.join(dir, f), 'utf8')]));
          return { contents: fs.readFileSync(args.path, 'utf8').replace(/import\.meta\.glob\([^\n]+\)/, JSON.stringify(assets)), loader: 'jsx' };
        }
        return null;
      });
    } }],
  });
  js = bundle.outputFiles[0].text;
  const sass = await import('sass-embedded');
  const out = [];
  for (const file of new Set([path.join(ROOT, '__capabilities/music-notation/browser/styles/tokens.scss'), path.join(ROOT, '__app_modules/learning/piano/browser/pianoTokens.scss'), path.join(ROOT, '__app_modules/learning/piano/browser/PianoApp.scss'), ...sheets])) {
    out.push(file.endsWith('.css') ? fs.readFileSync(file, 'utf8') : (await sass.compileAsync(file, { loadPaths: [path.join(ROOT, 'frontend'), path.dirname(file)] })).css);
  }
  css = out.join('\n').replace(/@font-face\s*\{[^}]*\}/g, '');
  const { chromium } = await import('playwright');
  browser = await chromium.launch();
  fs.mkdirSync(SHOTS, { recursive: true });
}, 180000);
afterAll(async () => { await browser?.close(); });

/** The strip for these children, as the kiosk draws it: under a 70px header, over the menu. */
async function open(ids, { disabled = false, touch = false } = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, hasTouch: touch });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const desk = { players: ids.map((id) => ({ userId: id, name: KIDS[id].name, piece: KIDS[id].piece ?? null })) };
  const recent = { players: ids.filter((id) => KIDS[id].course).map((id) => ({ userId: id, name: KIDS[id].name, courses: [KIDS[id].course] })) };
  await page.route('http://desk.test/**', (route) => {
    const url = new URL(route.request().url());
    const name = url.pathname.split('/').pop();
    if (url.pathname.startsWith('/img/') && IMAGES[name]) return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: IMAGES[name] });
    if (url.pathname.startsWith('/img/')) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html>' });
  });
  await page.goto('http://desk.test/');
  await page.exposeFunction('__api', (url) => (url.includes('desk') ? desk : recent));
  await page.exposeFunction('__xml', (url) => {
    const key = Object.keys(PIECE_TITLES).find((k) => url.includes(k));
    return `<score-partwise><work><work-title>${PIECE_TITLES[key] ?? 'Untitled'}</work-title></work></score-partwise>`;
  });
  await page.setContent(`<style>${css}html,body{margin:0;background:var(--piano-bg);color:var(--piano-fg);font-family:system-ui,sans-serif}.frame{height:800px;display:flex;flex-direction:column;padding:16px 32px;box-sizing:border-box}.menu{flex:1;margin-top:16px;border:2px dashed var(--piano-border);border-radius:16px}</style><div class="piano-app"><header style="height:54px"></header><div class="frame"><div id="root"></div><div class="menu"></div></div></div>`);
  await page.evaluate(([users, off]) => { window.__users = users; window.__disabled = off; }, [ids.map((id) => ({ id, schoolLearner: true })), disabled]);
  await page.addScriptTag({ content: js });
  await page.locator('.piano-desk__card').first().waitFor();
  await page.waitForFunction((n) => document.querySelectorAll('.piano-desk__card').length === n, ids.length);
  // Printed titles, posters and stills arrive after the first paint.
  await page.waitForFunction(() => [...document.querySelectorAll('.piano-desk__card img')].every((img) => img.complete));
  await page.waitForTimeout(250);
  return { page, errors };
}

/** Everything inside each card stays inside it, and the right column's rows stay inside the column. */
async function spills(page) {
  return page.evaluate(() => {
    const out = [];
    const inside = (outer, inner) => inner.left >= outer.left - 0.5 && inner.right <= outer.right + 0.5 && inner.top >= outer.top - 0.5 && inner.bottom <= outer.bottom + 0.5;
    for (const card of document.querySelectorAll('.piano-desk__card')) {
      const box = card.getBoundingClientRect();
      const label = card.getAttribute('aria-label');
      for (const el of card.querySelectorAll('*')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        // The ring around the current coin is a box-shadow, not a box.
        if (!inside(box, r)) out.push(`${label}: ${el.className?.baseVal ?? el.className ?? el.tagName} spills the card`);
      }
      const column = card.querySelector('.piano-desk__text').getBoundingClientRect();
      for (const row of card.querySelector('.piano-desk__text').children) {
        if (!inside(column, row.getBoundingClientRect())) out.push(`${label}: ${row.className} spills the column`);
      }
      const title = card.querySelector('.piano-desk__title');
      if (title.getBoundingClientRect().height > 37) out.push(`${label}: title runs past two lines`);
    }
    const strip = document.querySelector('.piano-desk').getBoundingClientRect();
    if (Math.round(strip.height) !== 208) out.push(`strip is ${strip.height}px tall`);
    return out;
  });
}

const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), clip: { x: 0, y: 0, width: 1280, height: 330 } });

describe('the progress strip at 1280x800', () => {
  it('fits four children with a 20-passage piece (two coin rows, tall cards)', async () => {
    const { page, errors } = await open(['ada', 'ben', 'cleo', 'dot']);
    expect(await page.evaluate(() => document.querySelector('.piano-desk').hasAttribute('data-tall'))).toBe(true);
    expect(await page.evaluate(() => [...document.querySelectorAll('.piano-desk__card')].map((c) => Math.round(c.getBoundingClientRect().height)))).toEqual([170, 170, 170, 170]);
    expect(await spills(page)).toEqual([]);
    // The still that is missing stands in; the posters are 2:3.
    expect(await page.locator('.piano-desk__child').nth(3).locator('.piano-desk__still[data-stand-in]').count()).toBe(1);
    const ratios = await page.evaluate(() => [...document.querySelectorAll('.piano-desk__poster')].map((p) => { const r = p.getBoundingClientRect(); return Math.round((r.width / r.height) * 100) / 100; }));
    for (const ratio of ratios) expect(ratio).toBeCloseTo(0.67, 1);
    await shot(page, 'four-children-tall');
    expect(errors).toEqual([]);
    await page.close();
  });

  it('fits four children at the standard height, short and long titles', async () => {
    const { page, errors } = await open(['ada', 'eve', 'cleo', 'dot']);
    expect(await page.evaluate(() => [...document.querySelectorAll('.piano-desk__card')].map((c) => Math.round(c.getBoundingClientRect().height)))).toEqual([150, 150, 150, 150]);
    expect(await spills(page)).toEqual([]);
    await shot(page, 'four-children');
    expect(errors).toEqual([]);
    await page.close();
  });

  it('fits long two-line piece titles with a skill line and big coins at 150px', async () => {
    const { page, errors } = await open(['gus', 'fay', 'ada', 'cleo']);
    expect(await page.evaluate(() => [...document.querySelectorAll('.piano-desk__card')].map((c) => Math.round(c.getBoundingClientRect().height)))).toEqual([150, 150, 150, 150]);
    // The long title really takes two lines here, and the coins stay big.
    expect(await page.evaluate(() => Math.round(document.querySelector('.piano-desk__title').getBoundingClientRect().height))).toBe(36);
    expect(await page.evaluate(() => Math.round(document.querySelector('.piano-desk__map i').getBoundingClientRect().width))).toBeGreaterThanOrEqual(28);
    expect(await spills(page)).toEqual([]);
    await shot(page, 'four-children-long-piece-titles');
    expect(errors).toEqual([]);
    await page.close();
  });

  it('fits long two-line titles, skill lines and a 10/10 count on tall cards', async () => {
    const { page, errors } = await open(['hal', 'ben', 'fay', 'gus']);
    // Hal's ten passages take two rows, so every card is tall.
    expect(await page.evaluate(() => [...document.querySelectorAll('.piano-desk__card')].map((c) => Math.round(c.getBoundingClientRect().height)))).toEqual([170, 170, 170, 170]);
    expect(await page.locator('.piano-desk__child').first().locator('.piano-desk__count').textContent()).toContain('10/10');
    expect(await spills(page)).toEqual([]);
    await shot(page, 'four-children-tall-long-titles');
    expect(errors).toEqual([]);
    await page.close();
  });

  it('fits two children', async () => {
    const { page, errors } = await open(['ada', 'cleo']);
    expect(await spills(page)).toEqual([]);
    await shot(page, 'two-children');
    expect(errors).toEqual([]);
    await page.close();
  });

  it('switches a card on a real pointer swipe, and does not open it', async () => {
    const { page, errors } = await open(['ada', 'eve', 'cleo', 'dot']);
    const card = page.locator('.piano-desk__child').first().locator('.piano-desk__card');
    expect(await card.getAttribute('data-kind')).toBe('piece');
    const box = await card.boundingBox();
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width - 30, y);
    await page.mouse.down();
    for (let step = 1; step <= 8; step += 1) await page.mouse.move(box.x + box.width - 30 - step * 15, y);
    await page.mouse.up();
    await page.waitForTimeout(400);
    expect(await page.locator('.piano-desk__child').first().locator('.piano-desk__card').getAttribute('data-kind')).toBe('course');
    expect(await page.evaluate(() => window.__opened ?? [])).toEqual([]);
    expect(await page.evaluate(() => window.__logs.filter((l) => l.event === 'piano.desk.swipe').map((l) => l.data))).toEqual([{ userId: 'ada', from: 'piece', to: 'course' }]);
    expect(await spills(page)).toEqual([]);
    await shot(page, 'four-children-ada-swiped-to-course');
    // A vertical drag does nothing; a plain tap still opens.
    await page.mouse.move(box.x + 60, box.y + 20);
    await page.mouse.down();
    // It ends below the card, as a finger scrolling the page would.
    await page.mouse.move(box.x + 64, box.y + box.height + 30, { steps: 6 });
    await page.mouse.up();
    expect(await page.locator('.piano-desk__child').first().locator('.piano-desk__card').getAttribute('data-kind')).toBe('course');
    await page.waitForTimeout(700);
    await page.locator('.piano-desk__child').first().locator('.piano-desk__card').click();
    expect(await page.evaluate(() => window.__opened)).toEqual([['ada', 'plex:9', 'plex:91']]);
    expect(errors).toEqual([]);
    await page.close();
  });

  it('switches on a real touch swipe, then opens on a tap straight after it, and ignores a vertical pan', async () => {
    const { page, errors } = await open(['ada', 'eve', 'cleo', 'dot'], { touch: true });
    const cdp = await page.context().newCDPSession(page);
    const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y]) => ({ x, y })) });
    const deckCard = () => page.locator('.piano-desk__child').first().locator('.piano-desk__card');
    const box = await deckCard().boundingBox();
    const y = box.y + box.height / 2;
    // Swipe left with a finger: the card switches, nothing opens.
    await touch('touchStart', [[box.x + box.width - 30, y]]);
    for (let step = 1; step <= 8; step += 1) await touch('touchMove', [[box.x + box.width - 30 - step * 15, y]]);
    await touch('touchEnd', []);
    await page.waitForTimeout(50);
    expect(await deckCard().getAttribute('data-kind')).toBe('course');
    expect(await page.evaluate(() => window.__opened ?? [])).toEqual([]);
    // A tap at once (no click came after the drag): it opens.
    const tapAt = [box.x + 60, box.y + 40];
    await touch('touchStart', [tapAt]);
    await touch('touchEnd', []);
    await page.waitForFunction(() => (window.__opened ?? []).length > 0, null, { timeout: 3000 });
    expect(await page.evaluate(() => window.__opened)).toEqual([['ada', 'plex:9', 'plex:91']]);
    // A vertical pan on the card: no switch, nothing opens.
    await page.evaluate(() => { window.__opened = []; });
    await touch('touchStart', [[box.x + 60, box.y + 20]]);
    for (let step = 1; step <= 8; step += 1) await touch('touchMove', [[box.x + 62, box.y + 20 + step * 15]]);
    await touch('touchEnd', []);
    await page.waitForTimeout(400);
    expect(await deckCard().getAttribute('data-kind')).toBe('course');
    expect(await page.evaluate(() => window.__opened)).toEqual([]);
    expect(errors).toEqual([]);
    await page.close();
  });

  it('greys every card while closed, and does not swipe', async () => {
    const { page, errors } = await open(['ada', 'ben', 'cleo', 'dot'], { disabled: true });
    expect(await spills(page)).toEqual([]);
    const card = page.locator('.piano-desk__child').first().locator('.piano-desk__card');
    const box = await card.boundingBox();
    await page.mouse.move(box.x + box.width - 30, box.y + 60);
    await page.mouse.down();
    await page.mouse.move(box.x + 40, box.y + 60, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    expect(await card.getAttribute('data-kind')).toBe('piece');
    expect(await page.evaluate(() => (window.__logs ?? []).filter((l) => l.event === 'piano.desk.swipe'))).toEqual([]);
    await shot(page, 'four-children-closed');
    expect(errors).toEqual([]);
    await page.close();
  });
});
