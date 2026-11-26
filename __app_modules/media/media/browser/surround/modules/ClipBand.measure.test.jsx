// __app_modules/media/media/browser/surround/modules/ClipBand.measure.test.jsx
//
// THE CLIP BAND, MEASURED in headless Chromium against the shipped stylesheet
// and the shipped fit (`clipBandFit.js`, injected into the page and run there).
//
// The defect this exists for (owner screenshot, 2026-11-25): a medley's name —
// "Pine Cones and Holly Berries / It's Beginning to Look a Lot Like Christmas"
// — set at a fixed 1.75rem wrapped to five lines. A bottom region's `height`
// is a floor, so the band grew with it and poured out of the footer: over the
// picture above, the clock off the bottom of the screen, and "Next, from" cut
// at the top. jsdom has no layout, so only a real engine can say it fits.
import React from 'react';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import SurroundFrame from "../../../../../../__capabilities/playback/browser/surround/SurroundFrame.jsx";
import "../builtins.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CAP = path.resolve(HERE, '../../../../../../__capabilities/playback/browser/surround');
const PUBLIC_FONTS = path.resolve(HERE, '../../../../../../frontend/public/fonts/surround');

const FLEET = Object.freeze([
  { name: '960x540', width: 960, height: 540 },
  { name: '1280x720', width: 1280, height: 720 },
  { name: '1920x1080', width: 1920, height: 1080 },
]);

const MEDLEY = 'Pine Cones and Holly Berries / It’s Beginning to Look a Lot Like Christmas';

/** The christmas-hall definition as authored, with the clip band's height as given. */
const definition = (bandHeight) => ({
  theme: 'christmas-still',
  regions: {
    top: { module: 'work-placard' },
    right: [{ module: 'poster-card', width: '33%', side: 'left' }],
    bottom: [{ module: 'segment-map', height: 64 }],
  },
  clip: { bottom: [{ module: 'clip-band', height: bandHeight }] },
  collapse: { footerFloor: 90, mediaReserve: 110 },
});

const payload = (bandHeight, title = MEDLEY) => ({
  id: 'christmas-hall',
  contentId: 'plex:2004#7',
  definition: definition(bandHeight),
  piece: { title: 'Christmas with Audra McDonald and Peter Graves', short_title: 'Christmas with Audra McDonald', year: 2004 },
  segments: Array.from({ length: 19 }, (_, i) => ({ n: i + 1, name: `Piece ${i + 1}`, kind: 'song', start: i * 200, end: i * 200 + 180 })),
  clip: {
    segment: { start: 30, end: 210 },
    title,
    work: 'plex:2004',
    index: 3,
    total: 40,
    next: {
      title: 'Then Shall Your Light Break Forth',
      subtitle: null,
      work: 'plex:2023',
      workTitle: 'Season of Light',
      workYear: 2023,
      step: 1,
    },
  },
});

async function compileSheet() {
  const sass = await import('sass-embedded');
  const sheets = [
    path.join(CAP, 'SurroundFrame.scss'),
    path.join(HERE, '../themes/christmas.scss'),
    path.join(HERE, 'ClipBand.scss'),
    path.join(HERE, 'WorkPlacard.scss'),
    path.join(HERE, 'PosterCard.scss'),
  ];
  const compiled = [];
  for (const file of sheets) {
    const out = await sass.compileAsync(file, { loadPaths: [CAP, path.dirname(file)] });
    compiled.push(out.css);
  }
  return compiled.join('\n').replace(/url\("\/fonts\/surround\/([^"]+)"\)/g, (_, file) => {
    const buf = fs.readFileSync(path.join(PUBLIC_FONTS, file));
    return `url("data:font/woff2;base64,${buf.toString('base64')}")`;
  });
}

/** `clipBandFit.js` has no imports, so stripping `export` makes it a classic script. */
function fitSource() {
  return `${fs.readFileSync(path.join(HERE, 'clipBandFit.js'), 'utf8').replace(/^export /gm, '')}
window.__clipFit = { fitClipBand };`;
}

async function layout(page, css, { width, height, data }) {
  const markup = renderToStaticMarkup(
    <SurroundFrame data={data} contentId={data.contentId} position={60} duration={3600} playing seeking={false}>
      <video />
    </SurroundFrame>,
  );
  await page.setViewportSize({ width, height });
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"><style>
       html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: #000; }
       #root { width: 100%; height: 100%; display: flex; }
       #root > * { flex: 1 1 auto; min-width: 0; }
       video { width: 100%; height: 100%; background: #000; }
       ${css}
     </style></head><body><div id="root">${markup}</div></body></html>`,
    { waitUntil: 'load' },
  );
  await page.evaluate(() => document.fonts.ready);

  // The frame's effects, as `band.measure.test.jsx` reproduces them: entrance
  // classes off, the media cap that keeps the band's reserve, the measured
  // media width the footer takes.
  await page.evaluate(({ mediaReserve }) => {
    const root = document.querySelector('.surround-frame');
    root.classList.remove('surround-frame--entering', 'surround-frame--arriving');
    const main = document.querySelector('.surround-frame__main');
    const stage = document.querySelector('.surround-frame__stage');
    if (main && stage) {
      const padTop = parseFloat(getComputedStyle(stage).paddingTop) || 0;
      const capH = main.getBoundingClientRect().height - padTop - mediaReserve;
      if (capH > 0) root.style.setProperty('--surround-media-cap-w', `${Math.round(capH * 16 / 9)}px`);
    }
    const media = document.querySelector('[data-testid="surround-media"]');
    const w = media.getBoundingClientRect().width;
    root.style.setProperty('--surround-media-w', `${w}px`);
    const footer = document.querySelector('[data-testid="surround-footer"]');
    if (footer) footer.style.width = `${w}px`;
  }, { mediaReserve: data.definition.collapse.mediaReserve ?? data.definition.collapse.footerFloor });

  await page.addScriptTag({ content: fitSource() });
  // The plate's fit (`fit.js`, which has no imports either), run as WorkPlacard runs it.
  await page.addScriptTag({
    // Its own scope: both files declare names like `EPS` at the top level.
    content: `(() => {
${fs.readFileSync(path.join(CAP, 'fit.js'), 'utf8').replace(/^export default .*$/m, '').replace(/^export /gm, '')}
window.__plateFit = { fitPlate, plateStyle };
})();`,
  });
  return page.evaluate(({ plateLine, shortLine }) => {
    const plate = document.querySelector('[data-testid="surround-work-placard"]');
    // MIRRORED FROM WorkPlacard.jsx, which runs in React and cannot be loaded
    // here: the short_title fallback (its fitPlate layout effect) and the
    // painted-line check (THE PAINTED LINE HAS THE LAST WORD: FONT_STEP_PX
    // steps, never below the floor, skipped for a refused line). A change to
    // either rule there has to be copied here, or this test checks the old one.
    // WorkPlacard's rule: the whole line, or the short title when the whole
    // line cannot be set even at the floor.
    let plateFit = window.__plateFit.fitPlate(plate, [plateLine]);
    let usedShort = false;
    if (plateFit?.rejected?.length) {
      const alt = window.__plateFit.fitPlate(plate, [shortLine]);
      if (alt && !alt.rejected.length) {
        plateFit = alt;
        usedShort = true;
        plate.querySelector('.surround-work-placard__name').textContent = shortLine.split(' · ')[0];
      }
    }
    Object.entries(window.__plateFit.plateStyle(plateFit) ?? {}).forEach(([k, v]) => plate.style.setProperty(k, v));
    const name = plate.querySelector('.surround-work-placard__name');
    // WorkPlacard's painted-line check: step down until the painted name is whole.
    const STEP = 0.25;
    while (name && plateFit && !plateFit.rejected.length && name.scrollWidth > name.clientWidth + 0.5 && plateFit.fontPx - STEP >= plateFit.floorPx) {
      plateFit = { ...plateFit, fontPx: Number((plateFit.fontPx - STEP).toFixed(2)) };
      plate.style.setProperty('--plate-size', `${plateFit.fontPx}px`);
    }

    const band = document.querySelector('.clip-band');
    const report = window.__clipFit.fitClipBand({
      band,
      title: band.querySelector('.clip-band__title'),
      heading: band.querySelector('.clip-band__heading'),
      nextText: band.querySelector('.clip-band__next-text'),
    });
    const footer = document.querySelector('[data-testid="surround-footer"]').getBoundingClientRect();
    const box = (sel) => {
      const r = band.querySelector(sel)?.getBoundingClientRect();
      return r ? { top: r.top, bottom: r.bottom } : null;
    };
    return {
      report,
      footer: { top: footer.top, bottom: footer.bottom },
      title: box('.clip-band__title'),
      progress: box('.clip-band__progress'),
      nextLabel: box('.clip-band__next-label'),
      nextTitle: box('.clip-band__next-title'),
      viewportH: window.innerHeight,
      plate: {
        fit: plateFit,
        cut: name ? name.scrollWidth > name.clientWidth + 0.5 : null,
        usedShort,
      },
    };
  }, {
    plateLine: `${data.piece.title} · ${data.piece.year}`,
    shortLine: `${data.piece.short_title} · ${data.piece.year}`,
  });
}

describe('the clip band, measured: a medley sets inside the room under the picture', () => {
  let browser;
  let page;
  let css;

  beforeAll(async () => {
    css = await compileSheet();
    browser = await chromium.launch();
    page = await browser.newPage();
  }, 60000);

  // Closing Chromium can take past the default 20s hook limit when the whole
  // suite runs in parallel; the close is cleanup, not a test.
  afterAll(async () => {
    await browser?.close();
  }, 60000);

  const cases = FLEET.flatMap((screen) => [64, 'fill'].map((bandHeight) => ({ ...screen, bandHeight })));

  it.each(cases)('$name, band height $bandHeight — nothing leaves the footer', async ({ width, height, bandHeight }) => {
    const m = await layout(page, css, { width, height, data: payload(bandHeight) });
    expect(m.report, 'the band was not laid out').not.toBeNull();
    expect(m.report.titleFits, JSON.stringify(m.report)).toBe(true);
    expect(m.report.nextFits, JSON.stringify(m.report)).toBe(true);
    expect(m.report.titleLines, 'the medley took more than two lines').toBeLessThanOrEqual(2);
        const inside = (b, what) => {
      expect(b.top, `${what} rises above the footer`).toBeGreaterThanOrEqual(m.footer.top - 1);
      expect(b.bottom, `${what} falls below the footer`).toBeLessThanOrEqual(m.footer.bottom + 1);
      expect(b.bottom, `${what} falls off the screen`).toBeLessThanOrEqual(m.viewportH);
    };
    inside(m.title, 'the title');
    inside(m.progress, 'the clock');
    inside(m.nextLabel, '"Next, from"');
    inside(m.nextTitle, 'the next title');
  }, 60000);

  it.each(FLEET)('$name — a short name keeps the stylesheet size (nothing shrinks that fits)', async ({ width, height }) => {
    const m = await layout(page, css, { width, height, data: payload('fill', 'Silent Night') });
    expect(m.report.titlePx).toBe(1.75 * 16);
    expect(m.report.titleLines).toBe(1);
  }, 60000);

  // FIT ORDER. The title's column is what Up next's column leaves
  // (`fit-content` on the grid), so a title fitted against Up next's size from
  // the LAST clip wraps past its lines once Up next is refitted and widens.
  // Two clips in one page, as the band lives: a long Up next that shrinks, then
  // a short one that takes the ceiling back, under a long title. At 1920 the
  // long Up next already sets at the ceiling, so there is nothing to undo.
  it.each(FLEET.filter((s) => s.width < 1920))('$name — the title fits against this clip\'s Up next, not the last one\'s', async ({ width, height }) => {
    const data = payload(64, 'Silent Night');
    data.clip.next.title = 'Pine Cones and Holly Berries / It’s Beginning to Look a Lot Like Christmas / Here Comes Santa Claus';
    const first = await layout(page, css, { width, height, data });
    expect(first.report.nextPx, JSON.stringify(first.report)).toBeLessThan(16);
    const m = await page.evaluate((title) => {
      const band = document.querySelector('.clip-band');
      band.querySelector('.clip-band__title').textContent = title;
      const nextTitle = band.querySelector('.clip-band__next-title');
      nextTitle.firstChild.textContent = 'Joy';
      const titleEl = band.querySelector('.clip-band__title');
      const report = window.__clipFit.fitClipBand({
        band,
        title: titleEl,
        heading: band.querySelector('.clip-band__heading'),
        nextText: band.querySelector('.clip-band__next-text'),
      });
      const r = titleEl.getBoundingClientRect();
      const f = parseFloat(getComputedStyle(titleEl).fontSize);
      const footer = document.querySelector('[data-testid="surround-footer"]').getBoundingClientRect();
      return {
        report,
        lines: Math.round(r.height / (f * 1.12)),
        title: { top: r.top, bottom: r.bottom },
        footer: { top: footer.top, bottom: footer.bottom },
      };
    }, MEDLEY);
    expect(m.lines, JSON.stringify(m.report)).toBeLessThanOrEqual(2);
    expect(m.title.top).toBeGreaterThanOrEqual(m.footer.top - 1);
    expect(m.title.bottom).toBeLessThanOrEqual(m.footer.bottom + 1);
  }, 60000);

  // The owner's screenshot: "Christmas with Audra McDonald an… · 2004" cut at
  // the ceiling size on a screen where a smaller size sets it whole. At 960 the
  // whole line cannot be set even at the floor, so the short title stands in.
  it.each(FLEET.map((s) => ({ ...s, short: s.width < 1280 })))('$name — the plate sets a long dated concert whole (short title: $short)', async ({ width, height, short }) => {
    const m = await layout(page, css, { width, height, data: payload('fill') });
    expect(m.plate.fit, 'the plate was not laid out').not.toBeNull();
    expect(m.plate.fit.rejected).toEqual([]);
    expect(m.plate.usedShort).toBe(short);
    expect(m.plate.cut, `cut at ${m.plate.fit.fontPx}px in ${m.plate.fit.availPx}px`).toBe(false);
  }, 60000);

  // Every long title in the Tabernacle corpus must set whole or have a
  // short_title that does. Title, short title and year as the plate receives
  // them: the library work's `title`, `short_title` and `year` (the concert's
  // year, which is not the file-name prefix).
  const CORPUS = Object.freeze([
    { title: 'Christmas with the Mormon Tabernacle Choir', short: 'Christmas with the Tabernacle Choir', year: 1994 },
    { title: 'Christmas with Audra McDonald and Peter Graves', short: 'Christmas with Audra McDonald', year: 2004 },
    { title: 'Christmas with Renée Fleming and Claire Bloom', short: 'Christmas with Renée Fleming', year: 2005 },
    { title: 'The Most Wonderful Time of the Year', short: null, year: 2009 },
  ]);

  it.each(FLEET.flatMap((s) => CORPUS.map((c) => ({ ...s, ...c }))))('$name — "$title" sets on the plate', async ({ width, height, title, short, year }) => {
    const data = payload('fill');
    data.piece = { title, short_title: short ?? title, year };
    const m = await layout(page, css, { width, height, data });
    expect(m.plate.fit, 'the plate was not laid out').not.toBeNull();
    expect(m.plate.fit.rejected, `"${title} · ${year}" needs a short_title`).toEqual([]);
    expect(m.plate.cut).toBe(false);
  }, 60000);
});
