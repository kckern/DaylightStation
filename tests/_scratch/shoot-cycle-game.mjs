// tests/_scratch/shoot-cycle-game.mjs
// Screenshots every cycle-game harness scene at 1920x1080 (the garage TV) and
// prints/writes layout metrics for each. Starts nothing: run the harness server
// first (see tests/_scratch/cycle-game-harness/README.md), then
//   BASE_URL=http://127.0.0.1:5199 node tests/_scratch/shoot-cycle-game.mjs
// Optional: SCENES=a,b for a subset; VIEWPORT=1810x1040 to force one size for
// every shot (suffix @WxH, no extra kiosk pass).
// Some scenes are also shot at the real garage content size (<scene>@kiosk.png).
// Exits non-zero, naming the scene, on a thrown error, a console error, a
// failed request or a scene that never signals [data-harness-ready].
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BASE_URL;
if (!BASE) { console.error('BASE_URL is required, e.g. BASE_URL=http://127.0.0.1:5199'); process.exit(2); }
const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, 'out/cycle-game');
fs.mkdirSync(OUT, { recursive: true });

const ALL = [
  'lobby-default', 'lobby-history-full', 'lobby-no-signal', 'lobby-busy', 'lobby-rider-picker', 'lobby-ghost-picker', 'lobby-ghost-roster', 'lobby-volume', 'staging', 'countdown',
  'race-solo-time', 'race-solo-distance-behind', 'race-solo-par-no-strap', 'race-solo-parked',
  'race-two-riders-one-parked', 'race-four-riders', 'race-five-riders', 'race-six-riders', 'race-four-bunched', 'race-six-bunched', 'race-menu-open', 'race-toast-parked', 'race-toast-boost', 'race-toast-solo', 'race-toast-four',
  'results-solo-new-best', 'results-three-riders', 'results-six-riders', 'results-stopped-and-ended-early',
];
// Real garage content size: the app's navigation rail and margins take the rest of 1920x1080.
const KIOSK = { w: 1810, h: 1040 };
const KIOSK_SCENES = ['race-solo-time', 'race-solo-distance-behind', 'race-solo-par-no-strap', 'race-solo-parked', 'race-five-riders', 'race-six-riders', 'race-four-bunched', 'race-six-bunched', 'results-six-riders'];
const scenes = process.env.SCENES ? process.env.SCENES.split(',').map((s) => s.trim()) : ALL;
const forced = /^(\d+)x(\d+)$/.exec(process.env.VIEWPORT || '');
const jobs = [];
for (const scene of scenes) {
  if (forced) { jobs.push({ scene, w: +forced[1], h: +forced[2], suffix: `@${forced[1]}x${forced[2]}` }); continue; }
  jobs.push({ scene, w: 1920, h: 1080, suffix: '' });
  if (KIOSK_SCENES.includes(scene)) jobs.push({ scene, w: KIOSK.w, h: KIOSK.h, suffix: '@kiosk' });
}

// Per-scene interaction run after ready, before the screenshot.
const ACTIONS = {
  'lobby-rider-picker': async (page) => {
    await page.click('[data-testid="bike-bike-2"] .cgh-slot__main');
    await page.waitForSelector('.cgh-picker', { timeout: 5000 });
    await page.waitForTimeout(400);
  },
  'lobby-ghost-picker': async (page) => {
    await page.click('[data-testid="course-ghost"]');
    await page.waitForSelector('[data-testid="ghost-picker"]', { timeout: 5000 });
    await page.waitForTimeout(400);
  },
  'lobby-ghost-roster': async (page) => {
    await page.click('[data-testid="course-ghost"]');
    await page.waitForSelector('[data-testid="ghost-picker"]', { timeout: 5000 });
    await page.click('[data-testid="ghost-R3"]');
    await page.click('[data-testid="ghost-R3"]');
    await page.waitForSelector('[data-testid="ghost-roster"]', { timeout: 5000 });
    await page.waitForTimeout(400);
  },
  'lobby-volume': async (page) => {
    await page.click('[data-testid="cycle-game-volume-open"]');
    await page.waitForSelector('.cgh-picker--volume', { timeout: 5000 });
    await page.waitForTimeout(400);
  },
  'lobby-no-signal': async (page) => {
    await page.click('[data-testid="cycle-game-start"]');
    await page.waitForSelector('[data-testid="sensor-warning"]', { timeout: 5000 });
    await page.waitForTimeout(400);
  },
  'race-menu-open': async (page) => {
    await page.click('[data-testid="race-menu-open"]');
    await page.waitForSelector('[data-testid="race-menu-sheet"]', { timeout: 5000 });
    await page.waitForTimeout(900); // past the 600 ms guard and the open animation
  },
};

// Runs in the page: geometry and type metrics for what a viewer would read.
function measure() {
  const r2 = (n) => Math.round(n * 10) / 10;
  const box = (el) => { const b = el.getBoundingClientRect(); return { x: r2(b.x), y: r2(b.y), w: r2(b.width), h: r2(b.height), r: r2(b.right), b: r2(b.bottom) }; };
  const vw = window.innerWidth; const vh = window.innerHeight;
  const out = { viewport: { w: vw, h: vh } };
  const visible = (el) => {
    const cs = getComputedStyle(el); const b = el.getBoundingClientRect();
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05 && b.width > 0 && b.height > 0;
  };
  const textEls = [...document.querySelectorAll('.harness-stage *')].filter((el) => {
    if (!visible(el)) return false;
    if (el.closest('svg') && el.tagName !== 'text' && el.tagName !== 'tspan') return false;
    return [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  });
  // SVG text sizes are in user units: scale by the CTM so the figure is real screen px.
  const screenPx = (el) => {
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (el.closest('svg') && el.getScreenCTM) { const m = el.getScreenCTM(); if (m) return fs * Math.hypot(m.a, m.b); }
    // A depth-scaled/transformed HTML box renders smaller than its computed size.
    if (el.offsetHeight > 20) { const k = el.getBoundingClientRect().height / el.offsetHeight; if (k > 0 && k < 0.95) return fs * k; }
    return fs;
  };
  const fonts = textEls.map((el) => ({ t: el.textContent.trim().slice(0, 28), px: r2(screenPx(el)), cls: String(el.getAttribute('class') || el.tagName).slice(0, 48) }));
  fonts.sort((a, b) => a.px - b.px);
  out.smallestText = fonts.slice(0, 4);
  // Only text that is partly visible counts: an element wholly outside the viewport/zone
  // (a POV marker far off the road, clipped by its zone) is not on screen at all.
  out.outsideViewport = textEls.filter((el) => { const b = el.getBoundingClientRect(); if (b.right <= 0 || b.left >= vw || b.bottom <= 0 || b.top >= vh) return false; return b.right > vw + 1 || b.bottom > vh + 1 || b.left < -1 || b.top < -1; })
    .map((el) => ({ t: el.textContent.trim().slice(0, 28), ...box(el) })).slice(0, 8);
  const zones = [...document.querySelectorAll('.race-layout__zone')];
  out.clippedByZone = [];
  for (const el of textEls) {
    const z = el.closest('.race-layout__zone'); if (!z) continue;
    const zb = z.getBoundingClientRect(); const b = el.getBoundingClientRect();
    if (b.right <= zb.left || b.left >= zb.right || b.bottom <= zb.top || b.top >= zb.bottom) continue;
    if (b.right > zb.right + 1 || b.bottom > zb.bottom + 1 || b.left < zb.left - 1 || b.top < zb.top - 1) {
      out.clippedByZone.push({ t: el.textContent.trim().slice(0, 24), zone: z.dataset.testid, over: { r: r2(b.right - zb.right), b: r2(b.bottom - zb.bottom), l: r2(zb.left - b.left), t: r2(zb.top - b.top) } });
    }
  }
  out.clippedByZone = out.clippedByZone.slice(0, 12);
  out.truncated = textEls.filter((el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== 'visible' && !el.closest('svg'))
    .map((el) => ({ t: el.textContent.trim().slice(0, 28), sw: el.scrollWidth, cw: el.clientWidth })).slice(0, 8);
  out.zones = Object.fromEntries(zones.map((z) => [z.dataset.testid, box(z)]));
  out.gauges = [...document.querySelectorAll('.cycle-speedometer')].map((g) => {
    const zone = g.closest('.race-layout__zone'); const zb = zone && zone.getBoundingClientRect();
    const gauge = g.querySelector('.cycle-speedometer__gauge'); const svg = g.querySelector('svg.cycle-speedometer__svg');
    const sb = svg.getBoundingClientRect();
    const labels = [...g.querySelectorAll('.cycle-speedometer__tick-label')].map((l) => {
      const b = l.getBoundingClientRect();
      return {
        t: l.textContent,
        outSvg: r2(Math.max(b.right - sb.right, b.bottom - sb.bottom, sb.left - b.left, sb.top - b.top)),
        outZone: zb ? r2(Math.max(b.right - zb.right, b.bottom - zb.bottom, zb.left - b.left, zb.top - b.top)) : null,
        fs: r2(screenPx(l))
      };
    });
    const bo = g.querySelector('.cycle-speedometer__boost');
    const boostInfo = bo ? (() => {
      const bb = bo.getBoundingClientRect();
      const lab = bo.querySelector('.cycle-speedometer__boost-label');
      const chip = bo.querySelector('.cycle-speedometer__boost-chip');
      const next = bo.querySelector('.cycle-speedometer__boost-next');
      return {
        box: box(bo), belowGaugeBy: r2(bb.top - gauge.getBoundingClientRect().bottom), outZoneBottom: zb ? r2(bb.bottom - zb.bottom) : null,
        labelTruncated: lab ? lab.scrollWidth > lab.clientWidth + 1 : false, nextTruncated: next ? next.scrollWidth > next.clientWidth + 1 : false,
        fontPx: chip ? r2(parseFloat(getComputedStyle(chip).fontSize)) : null, text: bo.textContent.trim()
      };
    })() : null;
    const wholeB = g.getBoundingClientRect();
    return {
      gaugePx: r2(gauge.getBoundingClientRect().width), zone: zone ? { w: r2(zb.width), h: r2(zb.height) } : null,
      wholeBottomOverZone: zb ? r2(wholeB.bottom - zb.bottom) : null, labels, boost: boostInfo
    };
  });
  const pace = document.querySelector('[data-testid="pace-delta"]');
  if (pace) {
    const h = pace.querySelector('.cg-pace__headline'); const z = pace.closest('.race-layout__zone');
    out.pace = {
      headlinePx: r2(parseFloat(getComputedStyle(h).fontSize)), headlineBox: box(h), zone: box(z), box: box(pace),
      headlineOverflowsZone: r2(Math.max(h.getBoundingClientRect().right - z.getBoundingClientRect().right, h.getBoundingClientRect().bottom - z.getBoundingClientRect().bottom)),
      text: pace.textContent.trim()
    };
  }
  const chart = document.querySelector('[data-testid="distance-chart"]');
  if (chart) {
    const xl = [...chart.querySelectorAll('text')].filter((t) => /^\d+:\d\d$/.test(t.textContent.trim()))
      .map((t) => ({ t: t.textContent.trim(), x: r2(t.getBoundingClientRect().x + t.getBoundingClientRect().width / 2) }));
    out.chartXLabels = xl; out.chartXGaps = xl.slice(1).map((l, i) => r2(l.x - xl[i].x));
    out.chartLines = [...chart.querySelectorAll('polyline,path')].filter((p) => p.getAttribute('stroke-dasharray') || p.dataset.testid === 'race-line')
      .map((p) => ({ tid: p.dataset.testid || null, dash: p.getAttribute('stroke-dasharray'), w: p.getAttribute('stroke-width'), op: p.getAttribute('opacity') })).slice(0, 8);
  }
  out.clippedLabels = out.gauges.reduce((n, g) => n + g.labels.filter((l) => l.outSvg > 0.5 || (l.outZone != null && l.outZone > 0.5)).length, 0);
  out.minFontPx = fonts.length ? fonts[0].px : null;
  // Smallest text a rider must read from the bike: everything on screen except elements
  // tagged data-secondary (or inside one) and the allow-listed secondary classes.
  const SECONDARY = ['.cg-chart__legend', '.cg-race-menu__sub', '.cg-tower__legend', '.race-results__legend'];
  const raceFonts = textEls.filter((el) => !el.closest('[data-secondary]') && !SECONDARY.some((sel) => el.closest(sel)))
    .map((el) => ({ t: el.textContent.trim().slice(0, 28), px: r2(screenPx(el)), cls: String(el.getAttribute('class') || el.tagName).slice(0, 48) }))
    .sort((a, b) => a.px - b.px);
  out.raceTextMinPx = raceFonts.length ? raceFonts[0].px : null;
  out.raceTextSmallest = raceFonts.slice(0, 6);
  out.raceTextBelow20 = raceFonts.filter((f) => f.px < 19.95).slice(0, 40);
  // Lobby: content text a person reads standing at the touchscreen must be >= 20 px across
  // the WHOLE lobby (main column, rail, modals); eyebrow labels and column headers are
  // allow-listed at 16 px via data-secondary.
  const lobbyRoot = document.querySelector('[data-testid="cycle-game-home"]');
  const lobbyEl = document.querySelector('[data-testid="cycle-game-records"]');
  if (lobbyRoot && lobbyEl) {
    const lf = textEls.filter((el) => lobbyRoot.contains(el) && !el.closest('[data-secondary]'))
      .map((el) => ({ t: el.textContent.trim().slice(0, 28), px: r2(screenPx(el)), cls: String(el.getAttribute('class') || el.tagName).slice(0, 48) }))
      .sort((a, b) => a.px - b.px);
    out.lobbyTextMinPx = lf.length ? lf[0].px : null;
    out.lobbyTextSmallest = lf.slice(0, 6);
    const hb = document.querySelector('[data-testid="history-box"]');
    out.historyRowsShown = [...document.querySelectorAll('.cgh-record')].filter((e) => e.style.display !== 'none').length;
    out.historyRowsHidden = hb ? Number(hb.dataset.hiddenRows || 0) : null;
    // Content must sit inside the rail and clear of its bottom edge (no half-clipped row).
    const rb = lobbyEl.getBoundingClientRect();
    out.lobbyRailClipped = [...lobbyEl.querySelectorAll('*')].filter((e) => e.offsetParent && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0 && (e.getBoundingClientRect().bottom > rb.bottom + 1 || e.getBoundingClientRect().right > rb.right + 1)).length;
    out.lobbyRailScrolls = lobbyEl.scrollHeight > lobbyEl.clientHeight + 1;
  }
  out.gaugeNumeralMinPx = out.gauges.length ? Math.min(...out.gauges.flatMap((g) => g.labels.map((l) => l.fs))) : null;
  const th = document.querySelector('[data-testid="tower-lap-header"]');
  if (th) {
    const tb = th.getBoundingClientRect();
    out.towerHeaderPx = r2(parseFloat(getComputedStyle(th).fontSize));
    out.towerHeaderClipped = th.scrollWidth > th.clientWidth + 1 || th.getBoundingClientRect().height > out.towerHeaderPx * 1.6;
    out.towerHeaderText = th.textContent.trim();
  }
  out.towerMetricWraps = [...document.querySelectorAll('[data-testid="tower-metric"]')].filter((el) => {
    const t = el.querySelector('.cg-tower__metric-text') || el;
    const cs = getComputedStyle(t); const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
    return t.getBoundingClientRect().height > lh * 1.5 || el.scrollWidth > el.clientWidth + 1;
  }).map((el) => el.textContent.trim());
  out.outOfBounds = out.outsideViewport.length + out.clippedByZone.length;
  out.towerRanks = [...document.querySelectorAll('[data-testid="tower-rank"]')].map((el) => ({
    t: el.textContent, sw: el.scrollWidth, cw: el.clientWidth,
    overLane: (() => { const lane = el.parentElement.querySelector('.cg-tower__lane'); return lane ? r2(el.getBoundingClientRect().right - lane.getBoundingClientRect().left) : null; })()
  }));
  out.towerRankOverflow = out.towerRanks.filter((r) => r.sw > r.cw + 1 || (r.overLane != null && r.overLane > 0.5)).length;
  const ex = document.querySelector('[data-testid="cycle-game-start"]');
  const res = document.querySelector('[data-testid="race-results"]');
  if (res) {
    const rb = (sel) => { const e = document.querySelector(sel); return e ? box(e) : null; };
    const rm = document.querySelector('[data-testid="race-results-rematch"]');
    out.results = {
      board: box(res), scrollH: res.scrollHeight, clientH: res.clientHeight, rematch: rb('[data-testid="race-results-rematch"]'), exit: rb('[data-testid="race-results-exit"]'),
      countdown: rb('[data-testid="race-results-countdown"]'), backToHome: ex ? box(ex) : null, container: box(document.querySelector('.cycle-game-container')),
      rows: [...document.querySelectorAll('[data-testid="result-row"]')].map((r) => box(r)).slice(0, 8),
      rematchFontPx: rm ? r2(parseFloat(getComputedStyle(rm).fontSize)) : null
    };
  }
  const leaf = textEls.filter((el) => !textEls.some((o) => o !== el && el.contains(o)));
  const hits = [];
  for (let i = 0; i < leaf.length && hits.length < 12; i += 1) {
    for (let j = i + 1; j < leaf.length && hits.length < 12; j += 1) {
      const a = leaf[i].getBoundingClientRect(); const b = leaf[j].getBoundingClientRect();
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left); const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (w > 2 && h > 2) hits.push({ a: leaf[i].textContent.trim().slice(0, 20), b: leaf[j].textContent.trim().slice(0, 20), w: r2(w), h: r2(h) });
    }
  }
  out.overlaps = hits;
  const toast = document.querySelector('[data-testid="cycle-event-toast"]');
  if (toast) {
    const tb = toast.getBoundingClientRect(); const hd = document.querySelector('[data-testid="chart-header"]');
    const hb = hd && hd.getBoundingClientRect();
    out.toast = {
      box: box(toast), chartHeader: hd ? box(hd) : null,
      coversHeader: hd ? (Math.min(tb.right, hb.right) - Math.max(tb.left, hb.left) > 0 && Math.min(tb.bottom, hb.bottom) - Math.max(tb.top, hb.top) > 0) : null,
      fontPx: r2(parseFloat(getComputedStyle(toast.querySelector('.cycle-event-toast__title')).fontSize))
    };
    const hit = (sel) => { const e = document.querySelector(sel); if (!e) return false; const b = e.getBoundingClientRect();
      return Math.min(tb.right, b.right) - Math.max(tb.left, b.left) > 0 && Math.min(tb.bottom, b.bottom) - Math.max(tb.top, b.top) > 0; };
    out.toast.coversClock = hit('[data-testid="race-clock"]') || hit('[data-testid="chart-header"]');
    out.toast.coversMenu = hit('[data-testid="race-menu-open"]');
    out.toast.coversPace = hit('[data-testid="pace-delta"]');
    out.toastCoversClock = out.toast.coversClock || out.toast.coversMenu || out.toast.coversPace;
  }
  return out;
}

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const failures = [];
const RACE_TEXT_SCENE = /^(race-|staging|countdown|results-)/;
const report = [];
const metrics = {};

for (const { scene, w, h, suffix } of jobs) {
  const problems = [];
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console error: ${m.text()}`); });
  page.on('requestfailed', (r) => problems.push(`request failed: ${r.url()}`));
  page.on('response', (r) => { if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url()}`); });
  const label = `${scene}${suffix}`;
  try {
    await page.goto(`${BASE}/?scene=${encodeURIComponent(scene)}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-harness-ready]', { timeout: 30000 });
    if (ACTIONS[scene]) await ACTIONS[scene](page);
    const file = path.join(OUT, `${label}.png`);
    await page.screenshot({ path: file });
    metrics[label] = await page.evaluate(measure);
    const canvas = await page.evaluate(() => document.body.dataset.harnessCanvas);
    report.push(`${label}: ${file} (canvas present: ${canvas})`);
  } catch (e) {
    problems.push(`did not finish: ${e.message.split('\n')[0]}`);
  }
  if (problems.length) failures.push({ scene: label, problems: [...new Set(problems)] });
  await page.close();
}
fs.writeFileSync(path.join(OUT, 'metrics.json'), JSON.stringify(metrics, null, 1));
await browser.close();

// Regression gate: clipped dial labels, text under 16 px, anything outside the viewport/zone.
for (const [label, m] of Object.entries(metrics)) {
  const bad = [];
  if (m.clippedLabels > 0) bad.push(`${m.clippedLabels} clipped dial label(s)`);
  if (RACE_TEXT_SCENE.test(label) && m.raceTextMinPx != null && m.raceTextMinPx < 19.95) bad.push(`race text ${m.raceTextMinPx}px < 20 (${m.raceTextSmallest[0].t} / ${m.raceTextSmallest[0].cls})`);
  if (m.minFontPx != null && m.minFontPx < 15.95) bad.push(`smallest text ${m.minFontPx}px < 16`);
  if (m.outsideViewport.length) bad.push(`${m.outsideViewport.length} element(s) outside the viewport`);
  if (m.clippedByZone.length) bad.push(`${m.clippedByZone.length} element(s) outside their zone`);
  if (m.gaugeNumeralMinPx != null && m.gaugeNumeralMinPx < 23.95) bad.push(`gauge numerals ${m.gaugeNumeralMinPx}px < 24`);
  if (m.towerHeaderPx != null && m.towerHeaderPx < 25.5) bad.push(`tower header ${m.towerHeaderPx}px < 25.6`);
  if (m.towerHeaderClipped) bad.push(`tower header wraps/clips: ${m.towerHeaderText}`);
  if (m.towerMetricWraps && m.towerMetricWraps.length) bad.push(`tower metric wraps: ${m.towerMetricWraps.join(' | ')}`);
  if (/^lobby-/.test(label) && m.lobbyTextMinPx != null && m.lobbyTextMinPx < 19.95) bad.push(`lobby text ${m.lobbyTextMinPx}px < 20 (${m.lobbyTextSmallest[0].t} / ${m.lobbyTextSmallest[0].cls})`);
  if (m.lobbyRailClipped > 0) bad.push(`${m.lobbyRailClipped} lobby rail element(s) clipped`);
  if (m.lobbyRailScrolls) bad.push('lobby rail scrolls');
  if (m.towerRankOverflow > 0) bad.push('tower rank overflow');
  if (m.toastCoversClock) bad.push('toast covers clock/menu/pace');
  const line = `${label}: clipped=${m.clippedLabels} minFont=${m.minFontPx} raceTextMin=${m.raceTextMinPx} numerals=${m.gaugeNumeralMinPx ?? '-'} towerHdr=${m.towerHeaderPx ?? '-'} lobbyMin=${m.lobbyTextMinPx ?? '-'} histRows=${m.historyRowsShown ?? '-'}/hid${m.historyRowsHidden ?? '-'} gauge=${m.gauges && m.gauges.length ? Math.min(...m.gauges.map((g) => g.gaugePx)) : '-'} oob=${m.outOfBounds}${m.toast ? ` toastCovers=${!!m.toastCoversClock}` : ''}`;
  console.log(line);
  if (bad.length) failures.push({ scene: label, problems: bad });
}
report.forEach((l) => console.log(l));
if (failures.length) {
  for (const f of failures) {
    console.error(`\nFAIL scene "${f.scene}":`);
    f.problems.forEach((p) => console.error(`  - ${p}`));
  }
  console.error(`\n${failures.length} of ${jobs.length} shot(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${jobs.length} shots rendered to ${OUT} (metrics.json written)`);
