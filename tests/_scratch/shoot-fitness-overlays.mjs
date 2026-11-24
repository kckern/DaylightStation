// tests/_scratch/shoot-fitness-overlays.mjs
// Screenshots every fitness-overlay harness scene at the garage kiosk content
// size (1810x1080 by default) and checks each for overflow and clipping.
// Starts nothing: run the harness server first, then
//   node_modules/.bin/vite --config tests/_scratch/fitness-overlay-harness/vite.harness.config.mjs
//   node tests/_scratch/shoot-fitness-overlays.mjs
// Env: BASE_URL (default http://127.0.0.1:5198), BROWSER=firefox|chromium
// (default firefox, which the kiosk runs), VIEWPORT=WxH (default 1810x1080),
// SCENES=a,b, WAIT_MS extra wait per scene after ready (default 300;
// budget-checking always waits at least 1600).
//
// Exits non-zero, naming the scene and the check, when:
//   1 bounds   an overlay root/panel or a [data-harness-check] element leaves the viewport
//   2 scroll   a scroll container ([data-harness-scroll], or until components add
//              that, .voice-memo-overlay__transcript--large) has its first text line
//              above its top while scrollTop is 0 (clipped, unreachable), or overflows
//              its bottom while it cannot scroll
//   3 font     any visible text renders under 16 px
//   4 lock     a governance lock rider row's BPM bar is under half the row's width,
//              or two of its goal labels overlap (metrics.lockRows has the ratios)
// and also on a thrown scene, a console error, a failed request or an HTTP >= 400.
import { chromium, firefox } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5198';
const BROWSER = (process.env.BROWSER || 'firefox').toLowerCase();
const engine = { firefox, chromium }[BROWSER];
if (!engine) { console.error(`BROWSER must be firefox or chromium, got "${BROWSER}"`); process.exit(2); }
const vp = /^(\d+)x(\d+)$/.exec(process.env.VIEWPORT || '1810x1080');
if (!vp) { console.error(`VIEWPORT must look like 1810x1080, got "${process.env.VIEWPORT}"`); process.exit(2); }
const VIEWPORT = { width: +vp[1], height: +vp[2] };
const WAIT_MS = Number(process.env.WAIT_MS ?? 300);
const MIN_WAIT = { 'budget-checking': 1600 };

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, 'out/fitness-overlays');
fs.mkdirSync(OUT, { recursive: true });

// Per scene: the overlay root and panel elements that must sit inside the viewport.
const MEMO = ['.voice-memo-overlay', '.voice-memo-overlay__panel', '.voice-memo-overlay__actions'];
const BUDGET = ['[data-testid="playback-budget-overlay"]', '.gate-card', '.presence-gate-notice__actions', '.presence-gate-notice__btn'];
const PRESENCE = ['[data-testid="presence-gate-notice"]', '.gate-card', '.presence-gate-notice__actions', '.presence-gate-notice__btn'];
const LOCK = ['.governance-overlay', '.governance-overlay__panel', '.governance-lock__rider'];
const SCENE_ROOTS = {
  'memo-long': MEMO,
  'memo-short': MEMO,
  'budget-checking': BUDGET,
  'budget-unavailable': BUDGET,
  'budget-exhausted': BUDGET,
  'presence-gate': PRESENCE,
  'lock-one-rule': LOCK,
  'lock-two-rules': LOCK,
  'lock-close-goals': LOCK,
  'lock-zone-and-mat': [...LOCK, '.governance-lock__activity'],
};
const ALL = Object.keys(SCENE_ROOTS);
const scenes = process.env.SCENES ? process.env.SCENES.split(',').map((s) => s.trim()).filter(Boolean) : ALL;

// Runs in the page. Returns { metrics, failures: [{ check, detail }] }.
function inspect({ roots }) {
  const r1 = (n) => Math.round(n * 10) / 10;
  const box = (b) => ({ x: r1(b.left), y: r1(b.top), w: r1(b.width), h: r1(b.height) });
  const vw = window.innerWidth; const vh = window.innerHeight;
  const failures = [];
  const metrics = { viewport: { w: vw, h: vh }, roots: {}, scroll: [], smallText: [] };
  const label = (el) => {
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/)[0] : '';
    return el.dataset?.testid ? `[data-testid=${el.dataset.testid}]` : (cls ? `.${cls}` : el.tagName.toLowerCase());
  };
  const shown = (el) => {
    const cs = getComputedStyle(el);
    const b = el.getBoundingClientRect();
    return cs.display !== 'none' && cs.visibility !== 'hidden' && b.width > 0 && b.height > 0;
  };

  // 1. bounds
  const seen = new Set();
  const targets = [];
  for (const sel of roots) {
    const els = [...document.querySelectorAll(sel)];
    if (!els.length) failures.push({ check: 'bounds', detail: `expected element ${sel} is not on the page` });
    els.forEach((el, i) => { if (!seen.has(el)) { seen.add(el); targets.push({ el, name: els.length > 1 ? `${sel}[${i}]` : sel }); } });
  }
  document.querySelectorAll('[data-harness-check]').forEach((el) => {
    if (!seen.has(el)) { seen.add(el); targets.push({ el, name: `[data-harness-check=${el.dataset.harnessCheck || label(el)}]` }); }
  });
  for (const { el, name } of targets) {
    if (!shown(el)) continue;
    const b = el.getBoundingClientRect();
    metrics.roots[name] = box(b);
    const over = { left: -b.left, top: -b.top, right: b.right - vw, bottom: b.bottom - vh };
    const bad = Object.entries(over).filter(([, v]) => v > 1).map(([k, v]) => `${k} by ${r1(v)}px`);
    if (bad.length) failures.push({ check: 'bounds', detail: `${name} ${JSON.stringify(box(b))} leaves the ${vw}x${vh} viewport: ${bad.join(', ')}` });
  }

  // 2. scroll containers
  const scrollers = new Set([...document.querySelectorAll('[data-harness-scroll], .voice-memo-overlay__transcript--large')]);
  for (const el of scrollers) {
    if (!shown(el)) continue;
    const cs = getComputedStyle(el);
    const b = el.getBoundingClientRect();
    const innerTop = b.top + el.clientTop;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP) });
    const first = walker.nextNode();
    let firstLineTop = null;
    if (first) {
      const range = document.createRange();
      range.selectNodeContents(first);
      const rects = [...range.getClientRects()].filter((r) => r.width > 0 || r.height > 0);
      if (rects.length) firstLineTop = Math.min(...rects.map((r) => r.top));
    }
    const m = {
      el: label(el), box: box(b), scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight,
      overflowY: cs.overflowY, firstLineTop: firstLineTop == null ? null : r1(firstLineTop), innerTop: r1(innerTop),
    };
    metrics.scroll.push(m);
    if (el.scrollTop === 0 && firstLineTop != null && firstLineTop < innerTop - 1) {
      failures.push({ check: 'scroll', detail: `${label(el)}: first text line starts ${r1(innerTop - firstLineTop)}px above the container top at scrollTop 0 (clipped, cannot be scrolled to); scrollHeight ${el.scrollHeight} > clientHeight ${el.clientHeight}` });
    }
    const overflowsBottom = el.scrollHeight > el.clientHeight + 1;
    if (overflowsBottom && ['hidden', 'visible', 'clip'].includes(cs.overflowY)) {
      failures.push({ check: 'scroll', detail: `${label(el)}: content overflows the bottom by ${el.scrollHeight - el.clientHeight}px but overflow-y is ${cs.overflowY} (not scrollable)` });
    }
  }

  // 3. text under 16 px (the stand-in video behind the overlay is excluded)
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.textContent.trim() && !n.parentElement?.closest('[data-harness-backdrop], script, style, title') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
    if (!rects.length) continue;
    let px = parseFloat(cs.fontSize);
    if (el.closest('svg') && el.getScreenCTM) { const m = el.getScreenCTM(); if (m) px *= Math.hypot(m.a, m.b); }
    if (px < 15.95) {
      const entry = { text: n.textContent.trim().slice(0, 40), px: r1(px), el: label(el) };
      metrics.smallText.push(entry);
      failures.push({ check: 'font', detail: `"${entry.text}" in ${entry.el} renders at ${entry.px}px (< 16px)` });
    }
  }
  // 4. lock modal rows: the bar is the row's main column, and goal labels never collide
  metrics.lockRows = [];
  document.querySelectorAll('.governance-lock__rider').forEach((row, i) => {
    const rowBox = row.getBoundingClientRect();
    const track = row.querySelector('.governance-lock__track');
    const ratio = track ? track.getBoundingClientRect().width / rowBox.width : null;
    const labels = [...row.querySelectorAll('.governance-lock__marker')].map((m) => ({ text: m.textContent, b: m.getBoundingClientRect() }));
    metrics.lockRows.push({ row: i, ratio: ratio == null ? null : Math.round(ratio * 1000) / 1000, labels: labels.map((l) => ({ text: l.text, ...box(l.b) })) });
    if (ratio != null && ratio < 0.5) failures.push({ check: 'lock', detail: `rider row ${i}: bar is ${Math.round(ratio * 100)}% of the row (< 50%)` });
    for (let a = 0; a < labels.length; a++) {
      for (let b = a + 1; b < labels.length; b++) {
        const A = labels[a].b; const B = labels[b].b;
        if (A.left < B.right && B.left < A.right && A.top < B.bottom && B.top < A.bottom) {
          failures.push({ check: 'lock', detail: `rider row ${i}: labels "${labels[a].text}" and "${labels[b].text}" overlap` });
        }
      }
    }
  });
  return { metrics, failures };
}

const browser = await engine.launch();
const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
const results = {};
let failed = 0;
for (const scene of scenes) {
  const roots = SCENE_ROOTS[scene];
  const failures = [];
  if (!roots) { failures.push({ check: 'scene', detail: `unknown scene; known: ${ALL.join(', ')}` }); }
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') failures.push({ check: 'console', detail: m.text().slice(0, 300) }); });
  page.on('pageerror', (e) => failures.push({ check: 'pageerror', detail: String(e?.message || e).slice(0, 300) }));
  page.on('requestfailed', (r) => failures.push({ check: 'request', detail: `request failed: ${r.url()}` }));
  page.on('response', (r) => { if (r.status() >= 400) failures.push({ check: 'request', detail: `HTTP ${r.status()}: ${r.url()}` }); });
  let metrics = null;
  if (roots) {
    try {
      await page.goto(`${BASE}/?scene=${encodeURIComponent(scene)}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('[data-harness-ready], [data-harness-error]', { timeout: 30000 });
      const err = await page.evaluate(() => document.body.dataset.harnessError || null);
      if (err) failures.push({ check: 'scene', detail: `scene threw: ${err}` });
      await page.waitForTimeout(Math.max(WAIT_MS, MIN_WAIT[scene] || 0));
      const file = path.join(OUT, `${scene}-${BROWSER}.png`);
      await page.screenshot({ path: file });
      const res = await page.evaluate(inspect, { roots });
      metrics = res.metrics;
      failures.push(...res.failures);
    } catch (e) {
      failures.push({ check: 'scene', detail: `harness error: ${String(e?.message || e).split('\n')[0]}` });
    }
  }
  await page.close();
  results[scene] = { browser: BROWSER, viewport: VIEWPORT, ok: failures.length === 0, failures, metrics };
  if (failures.length) failed += 1;
  console.log(`${failures.length ? 'FAIL' : 'ok  '} ${scene} (${BROWSER} ${VIEWPORT.width}x${VIEWPORT.height})`);
  (metrics?.lockRows || []).forEach((r) => console.log(`       bar/row ${r.ratio}  labels ${r.labels.map((l) => l.text).join(' | ')}`));
  failures.forEach((f) => console.log(`       [${f.check}] ${f.detail}`));
}
await browser.close();

const metricsFile = path.join(OUT, 'metrics.json');
let all = {};
try { all = JSON.parse(fs.readFileSync(metricsFile, 'utf8')); } catch { /* first run */ }
all[BROWSER] = { ...(all[BROWSER] || {}), ...results };
fs.writeFileSync(metricsFile, `${JSON.stringify(all, null, 2)}\n`);

if (failed) {
  console.error(`\n${failed} of ${scenes.length} scene(s) failed in ${BROWSER}. PNGs and metrics.json in ${OUT}`);
  process.exit(1);
}
console.log(`\nAll ${scenes.length} scene(s) passed in ${BROWSER}. PNGs and metrics.json in ${OUT}`);
