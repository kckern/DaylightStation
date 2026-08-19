// frontend/src/modules/Surround/band.measure.test.jsx
//
// THE BAND, MEASURED. This is the spec the rest of the surround's typography
// leans on, and it exists because for six waves it did not.
//
// Every tier threshold, clamp coefficient, reserve and floor in the band was
// derived by rendering the real compiled stylesheet in headless Chromium,
// reading pixels off it, and solving. That harness was rebuilt and thrown away
// six times. The numbers it produced live in the stylesheets as prose — "0.58px
// of air", "a hair, not a cushion", "measured at zero overflow" — and prose does
// not go red. Change a line-height, a clamp floor, the root font size or the
// display face's metrics and a tier fires or fails to fire with every existing
// test still green.
//
// So the harness is checked in. It compiles the SHIPPED SCSS with
// `sass-embedded`, renders the REAL components (`renderToStaticMarkup`, so the
// markup cannot drift from the JSX the way a hand-written fixture would),
// serves the REAL font binaries this repo now vendors, and asserts the derived
// facts at the three sizes the fleet actually runs.
//
// WHY VITEST AND NOT PLAYWRIGHT. Both are available here. The Playwright specs
// under `tests/live/flow/` are RUNTIME gates: `playwright.config.mjs` boots
// `npm run dev` and drives the real app, which is right for asserting that a
// deployed frame behaves, and wrong for asserting arithmetic — it costs a dev
// server and a two-minute startup budget to measure a stylesheet that does not
// need one. This spec needs no server, no backend and no data volume: it needs a
// layout engine, and Playwright's `chromium` is importable from a vitest test
// like any other library. Living here also means it runs under the command this
// module's own suite already runs (`vitest run frontend/src/modules/Surround/`),
// so a typographic change is caught by the same command that catches a logic
// one, rather than by a gate someone has to remember.
//
// WHAT IS EMULATED, AND WHY THAT IS HONEST. `renderToStaticMarkup` runs render
// and no effects, so the two measurements the frame makes at runtime have to be
// made here instead. There are exactly two, both documented at their source:
//
//   1. `SurroundFrame`'s ResizeObserver — the footer takes the measured media
//      box's width, and the band collapses its `collapse: first` region when the
//      footer falls under `collapse.footerFloor` (`SurroundFrame.jsx`).
//   2. `MovementMap`'s accordion — measure the rule and the sounding segment's
//      overflow, solve the widths, apply them (`MovementMap.jsx`, `band.js`).
//
// Both are reproduced below by calling the SAME pure functions the components
// call, on numbers read off this page. Nothing about the geometry is restated:
// if `accordionShares` changes, this spec animates the change.
//
// HOW IT FAILS. Loudly, with the measurement in the message. A tier that does
// not fire reports the line count it got, the line count it wanted, the
// threshold it was supposed to cross and the content height it actually
// measured — so the next person reads "expected 4 lines, got 3 (tier threshold
// 108px, ticker content box measured 106.9px)" and knows both that it broke and
// by how much.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import SurroundFrame from './SurroundFrame.jsx';
import ComposerCard from './modules/ComposerCard.jsx';
import { accordionShares, desiredWidth, SEGMENT_FLOOR_PX } from './band.js';
import './builtins.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_FONTS = path.resolve(HERE, '../../../public/fonts/surround');

/** The fleet. Every screen the surround is mounted on is one of these three. */
const FLEET = Object.freeze([
  { name: '960x540', width: 960, height: 540 },
  { name: '1280x720', width: 1280, height: 720 },
  { name: '1920x1080', width: 1920, height: 1080 },
]);

/* -------------------------------------------------------------------------- */
/* The payload — the live Eroica sidecar, trimmed to what the band renders      */
/* -------------------------------------------------------------------------- */

/**
 * Verbatim from `GET /api/v1/play/plex:663134` (the shipped recording), reduced
 * to the fields the band and the rail read. The 224-character Napoleon fact is
 * the one that drove the three-line and four-line tiers into existence, so it is
 * the fact this spec measures with — a shorter one would clear every reserve and
 * prove nothing.
 */
const NAPOLEON = 'Beethoven meant to dedicate this symphony to Napoleon. When his secretary brought word that Napoleon had declared himself Emperor, Beethoven tore the title page in half and threw it on the floor. The page had to be recopied.';

const DEFINITION = Object.freeze({
  regions: {
    top: { module: 'work-placard' },
    right: [
      { module: 'composer-card', width: '33%', side: 'left' },
      { module: 'place-carousel' },
    ],
    bottom: [
      { module: 'movement-map', height: 64 },
      { module: 'cue-ticker', height: 'fill', collapse: 'first' },
    ],
  },
  collapse: { footerFloor: 90 },
});

const EROICA = Object.freeze({
  id: 'concert-hall',
  contentId: 'plex:663134',
  definition: DEFINITION,
  assetBase: 'library/classical',
  piece: {
    title: 'Symphony No. 3 in E-flat major, "Eroica"',
    short_title: "Beethoven's Third Symphony",
    opus: 'Op. 55',
    composed: '1803-1804',
    year: 1804,
    period: 'Classical to Romantic',
    premiered: 'Theater an der Wien, 7 April 1805',
    musicEndsAt: 2955,
  },
  composer: {
    name: 'Ludwig van Beethoven',
    born: 1770,
    died: 1827,
    birthplace: 'Bonn',
    period: 'Classical',
    facts: ['Beethoven said his hearing loss began in 1798, during a heated argument with a singer.'],
  },
  movements: [
    {
      n: 1,
      name: 'Allegro con brio',
      translation: 'Fast, with spirit',
      listen: ['Two hammered E-flat chords, then the cellos sing the heroic theme — built from a plain broken chord.'],
      start: 0,
    },
    {
      n: 2,
      name: 'Marcia funebre. Adagio assai',
      translation: 'Funeral march — very slow',
      listen: ["Basses mutter like muffled drums beneath the violins' grief — a state funeral in sound."],
      start: 976,
    },
    {
      n: 3,
      name: 'Scherzo. Allegro vivace',
      translation: 'Playful — fast and lively',
      listen: ['A whispering moto perpetuo in the strings detonates into full orchestra — twice.'],
      start: 1925,
    },
    {
      n: 4,
      name: 'Finale. Allegro molto',
      translation: 'Finale — very fast',
      listen: ['Variations that start with only the bass line — the tune itself arrives later.'],
      start: 2278,
    },
  ],
  cues: [],
  facts: [NAPOLEON],
});

/** Movement II is sounding: the longest heading and the longest gloss on the rail. */
const POSITION = 1200;

/* -------------------------------------------------------------------------- */
/* The stylesheet, and the fonts inside it                                     */
/* -------------------------------------------------------------------------- */

/**
 * Compile the shipped SCSS and inline the vendored font binaries.
 *
 * The `@font-face` src urls are absolute paths served by the app (`/fonts/…`),
 * which a page built with `setContent` has no origin to resolve against — and a
 * `file://` src on an `about:blank` document is refused as cross-origin. Base64
 * is what makes the page hermetic: no server, no network, no font that is
 * "usually there".
 */
async function compileSheet() {
  const sass = await import('sass-embedded');
  const sheets = ['SurroundFrame.scss', 'modules/MovementMap.scss', 'modules/CueTicker.scss',
    'modules/WorkPlacard.scss', 'modules/ComposerCard.scss', 'modules/PlaceCarousel.scss',
    'map/CountryMap.scss', 'map/EraTimeline.scss'];
  const compiled = [];
  for (const rel of sheets) {
    const out = await sass.compileAsync(path.join(HERE, rel), { loadPaths: [HERE] });
    compiled.push(out.css);
  }
  const css = compiled.join('\n');
  return css.replace(/url\("\/fonts\/surround\/([^"]+)"\)/g, (_, file) => {
    const buf = fs.readFileSync(path.join(PUBLIC_FONTS, file));
    return `url("data:font/woff2;base64,${buf.toString('base64')}")`;
  });
}

/* -------------------------------------------------------------------------- */
/* The page                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Render the frame at one fleet size and hand back a page positioned exactly as
 * the browser has it after the frame's own effects have run once.
 */
async function layout(page, css, { width, height, data = EROICA, position = POSITION }) {
  const markup = renderToStaticMarkup(
    <SurroundFrame
      data={data}
      contentId={data.contentId}
      position={position}
      duration={3223}
      playing
      seeking={false}
    >
      <video />
    </SurroundFrame>,
  );

  await page.setViewportSize({ width, height });
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"><style>
       html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: #14100c; }
       /* The screen root the frame is mounted into: it fills the viewport, which
          is what every seam (ScreenPlayer, MenuStack) gives it. */
       #root { width: 100%; height: 100%; display: flex; }
       #root > * { flex: 1 1 auto; min-width: 0; }
       video { width: 100%; height: 100%; background: #000; }
       ${css}
     </style></head><body><div id="root">${markup}</div></body></html>`,
    { waitUntil: 'load' },
  );

  // THE FONTS ARE THE MEASUREMENT. If they have not loaded, every number below
  // is the fallback serif's and the spec would pass or fail for the wrong
  // reason — so this is an assertion, not a wait.
  await page.evaluate(() => document.fonts.ready);
  const facesReady = await page.evaluate(() => ({
    display: document.fonts.check('600 28px "Cormorant Garamond"'),
    body: document.fonts.check('500 16px "EB Garamond"'),
  }));
  expect(facesReady, 'the vendored display/body faces did not load — every measurement below would be the fallback serif\'s').toEqual({ display: true, body: true });

  // EFFECT 1 — `SurroundFrame`'s ResizeObserver and entrance, reproduced.
  // The entrance classes hold the chrome in its pre-arrival state (opacity and
  // transforms); the real frame drops them on the second animation frame. The
  // footer then takes the measured media box's width, and the collapse rule
  // fires off the height that produces.
  await page.evaluate((footerFloor) => {
    const root = document.querySelector('.surround-frame');
    root.classList.remove('surround-frame--entering', 'surround-frame--arriving');
    const media = document.querySelector('[data-testid="surround-media"]');
    const footer = document.querySelector('[data-testid="surround-footer"]');
    const w = media.getBoundingClientRect().width;
    root.style.setProperty('--surround-media-w', `${w}px`);
    if (footer) {
      footer.style.width = `${w}px`;
      const h = footer.getBoundingClientRect().height;
      // `collapse: first` drops the FIRST region of the band when the whole band
      // cannot afford the floor. Emulated by removing the region, which is what
      // `visibleFooterRegions` does.
      if (h > 0 && h < footerFloor) {
        const first = footer.querySelector('.surround-frame__region--bottom');
        if (first) first.remove();
      }
    }
  }, DEFINITION.collapse.footerFloor);

  return page;
}

/**
 * EFFECT 2 — the accordion, reproduced with the real solver.
 *
 * `MovementMap.measureDesired` reads four numbers off the DOM and `band.js`
 * turns them into widths. Both halves happen here: the numbers are read in the
 * page, the solve is the imported `accordionShares`, and the result is written
 * back as the inline widths the component would have set.
 *
 * @returns the numbers the solve saw, so a failure can report them.
 */
async function runAccordion(page) {
  // The DOM READS, and only the DOM reads. Every number the accordion is
  // computed from is measured here; not one of them is combined here. The
  // arithmetic on top of them is `desiredWidth`, imported from the module the
  // component imports it from — this file's whole purpose is to abolish copies
  // of load-bearing arithmetic, and a transcription of `measureDesired` in the
  // spec that measures `measureDesired` is the worst possible place for one.
  const measured = await page.evaluate(() => {
    const rule = document.querySelector('.surround-movement-map__rule');
    if (!rule) return null;
    const segs = [...rule.querySelectorAll('.surround-movement-map__segment')];
    const activeIndex = segs.findIndex((s) => s.getAttribute('data-state') === 'active');
    const natural = segs.map((s) => Number(s.getAttribute('data-natural')));
    const railPx = rule.getBoundingClientRect().width;
    if (activeIndex < 0) return { natural, activeIndex, railPx };
    const seg = segs[activeIndex];
    const cell = seg.querySelector('.surround-movement-map__text');
    if (!cell) return { natural, activeIndex, railPx };
    const heading = seg.querySelector('.surround-movement-map__heading');
    const gloss = seg.querySelector('.surround-movement-map__translation');
    return {
      natural,
      activeIndex,
      railPx,
      segW: seg.getBoundingClientRect().width,
      cellW: cell.getBoundingClientRect().width,
      // `scrollWidth` on a `nowrap` + `overflow: hidden` box is the string's
      // full single-line width whatever the box is currently showing.
      need: Math.max(heading?.scrollWidth ?? 0, gloss?.scrollWidth ?? 0),
    };
  });
  if (!measured) return null;
  measured.desiredPx = desiredWidth({
    segW: measured.segW, cellW: measured.cellW, need: measured.need,
  });

  const shares = accordionShares({
    natural: measured.natural,
    activeIndex: measured.activeIndex,
    railPx: measured.railPx,
    desiredPx: measured.desiredPx,
    floorPx: SEGMENT_FLOOR_PX,
  });
  await page.evaluate((widths) => {
    const segs = [...document.querySelectorAll('.surround-movement-map__segment')];
    segs.forEach((s, i) => { s.style.width = `${widths[i] * 100}%`; });
  }, shares);
  return { ...measured, shares };
}

/**
 * THE NOTE, AS SET — measured off the element that actually holds line boxes.
 *
 * The first version of this divided `.surround-cue-ticker__text`'s height by its
 * line-height. That box has `min-height == max-height` in every tier, so the
 * division was `max-height ÷ line-height`: a ratio of two compiled CSS values,
 * evaluated in a browser. It proved which container-query tier matched — worth
 * having, and it needs real box heights — but it observed no text at all, which
 * is the exact defect class this whole file exists to eliminate.
 *
 * `.surround-cue-ticker__line` is the element that truncates
 * (`display: -webkit-box; -webkit-line-clamp: N; overflow: hidden`) and it
 * carries NO height constraint of its own, so its rendered height is the number
 * of line boxes the clamp actually allowed, times one line. That is painted
 * text. Lifting the clamp and the reserve and re-measuring gives the height the
 * note WANTED — the same technique the name-measure test below uses — and the
 * difference between the two is what the ellipsis ate.
 *
 * @returns painted/natural/reserve, in both px and lines, plus the clamp count.
 */
async function noteMeasure(page) {
  return page.locator('[data-testid="surround-ticker-text"]').first().evaluate((box) => {
    const line = box.querySelector('.surround-cue-ticker__line');
    const lh = parseFloat(getComputedStyle(box).lineHeight);
    const clamp = Number(getComputedStyle(line).webkitLineClamp
      ?? getComputedStyle(line).getPropertyValue('-webkit-line-clamp'));
    const reservePx = box.getBoundingClientRect().height;
    const paintedPx = line.getBoundingClientRect().height;

    const prev = {
      clamp: line.style.webkitLineClamp,
      min: box.style.minHeight,
      max: box.style.maxHeight,
    };
    line.style.webkitLineClamp = 'unset';
    box.style.minHeight = '0';
    box.style.maxHeight = 'none';
    const naturalPx = line.getBoundingClientRect().height;
    line.style.webkitLineClamp = prev.clamp;
    box.style.minHeight = prev.min;
    box.style.maxHeight = prev.max;

    const px = (n) => Number(n.toFixed(2));
    return {
      lineHeight: px(lh),
      fontSize: getComputedStyle(box).fontSize,
      clampLines: Number.isFinite(clamp) ? clamp : null,
      reservePx: px(reservePx),
      reserveLines: Math.round(reservePx / lh),
      paintedPx: px(paintedPx),
      paintedLines: Math.round(paintedPx / lh),
      naturalPx: px(naturalPx),
      naturalLines: Math.round(naturalPx / lh),
    };
  });
}

/** The ticker's own content box — what a `@container ticker (min-height: N)` sees. */
async function tickerContentBox(page) {
  return page.locator('.surround-cue-ticker').first().evaluate((el) => {
    const cs = getComputedStyle(el);
    const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    return Number((el.getBoundingClientRect().height - pad).toFixed(2));
  });
}

/* -------------------------------------------------------------------------- */

describe('the band, measured against the shipped stylesheet', () => {
  let browser;
  let page;
  let css;

  beforeAll(async () => {
    css = await compileSheet();
    const { chromium } = await import('playwright');
    browser = await chromium.launch();
    page = await browser.newPage({ deviceScaleFactor: 1 });
  }, 120000);

  afterAll(async () => { await browser?.close(); });

  /**
   * THE LAW THE `overflow: hidden` HIDES. Every reserve in the ticker is a
   * `min-height`/`max-height` pair on a box that clips, so an over-budget tier
   * does not look broken — it silently eats the last line of the note.
   *
   * `.surround-cue-ticker__line` is NOT in this sweep, and that is deliberate
   * rather than an oversight: it is the clamped element, so on any note longer
   * than its tier it overflows BY DESIGN — measured, `scrollHeight` 122 against
   * `clientHeight` 98 at 1280x720, which is the ellipsis doing its job on a
   * genuine overflow. Including it here would make this case red on shipped,
   * correct output. What must be true of that element is asserted in the next
   * case instead, where it belongs: every line the clamp PAINTS has to fit
   * inside the reserve.
   */
  it.each(FLEET)('$name — the ticker never overflows its own reserve', async ({ width, height }) => {
    await layout(page, css, { width, height });
    const boxes = await page.evaluate(() => [...document.querySelectorAll(
      '.surround-cue-ticker, .surround-cue-ticker__text, .surround-cue-ticker__zone',
    )].map((el) => ({
      cls: el.className,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    })));
    expect(boxes.length, 'the ticker did not render at all').toBeGreaterThan(0);
    const overflowing = boxes.filter((b) => b.scrollHeight > b.clientHeight);
    expect(
      overflowing,
      `boxes overflowing their reserve: ${JSON.stringify(overflowing)}`,
    ).toEqual([]);
  }, 60000);

  /**
   * THE TIER LATTICE, asserted as PAINTED LINE BOXES — text that a viewer can
   * count on the screen — rather than as the presence of a CSS rule or as a
   * ratio of two compiled CSS values.
   *
   * Three things are asserted together, because each one alone is escapable:
   *
   *   1. THE TIER. `paintedLines` is `.surround-cue-ticker__line`'s own height
   *      over one line's; that element has no height constraint, so its height
   *      IS the number of line boxes the clamp allowed.
   *   2. THE RESERVE AND THE CLAMP AGREE. Every tier's reserve is derived from
   *      the line-height (`4.05em` is 3 x 1.35em, `5.4em` is 4 x 1.35em) and
   *      nothing but a comment says so. Raise the line-height without moving the
   *      reserve and the clamp still allows four lines into a box that now holds
   *      three; the parent's `overflow: hidden` swallows the fourth in silence.
   *      Asserting the two counts against the MEASURED line-height is what sees
   *      that. (The painted height cannot exceed the reserve — the grid area
   *      bounds it — so asserting that would be an assertion that cannot fail.)
   *   3. THE MEASUREMENT IS NOT VACUOUS. The fact used has to genuinely NEED at
   *      least the tier's line count, or "four lines were painted" would be
   *      satisfied by any short string and prove nothing about the tier. That is
   *      why the 224-character Napoleon fact is the fixture.
   *
   * The expected counts are the design's own, stated in `CueTicker.scss`:
   * 960x540 stays on the single-line tier; 1280x720 and 1920x1080 both reach
   * four. (1280x720 gets there through the 108px `--no-now-heading` tier, not
   * the 161px one — the rail names the movement, so the NOW register spends no
   * height on a heading. See that tier's own derivation.)
   */
  const tierCase = async ({ width, height, lines, threshold, data }) => {
    await layout(page, css, { width, height, ...(data ? { data } : null) });
    const container = await tickerContentBox(page);
    const m = await noteMeasure(page);
    const where = `tier ${threshold}; ticker content box ${container}px, reserve ${m.reservePx}px, line-height ${m.lineHeight}px at ${m.fontSize}; the note sets ${m.naturalLines} lines (${m.naturalPx}px) and ${m.paintedLines} are painted (${m.paintedPx}px)`;

    expect(m.paintedLines, `expected ${lines} painted line(s), got ${m.paintedLines} — ${where}`)
      .toBe(lines);
    expect(
      m.reserveLines,
      `the clamp allows ${m.clampLines} lines and the reserve is ${m.reservePx}px, which is ${m.reserveLines} lines at the measured ${m.lineHeight}px — so the clamp's last ${m.clampLines - m.reserveLines} line(s) are clipped by the parent, with nothing on screen to say so. Every tier's reserve is derived from this line-height (4.05em is 3 x 1.35em, 5.4em is 4 x 1.35em); this is the assertion that notices when one moves and the other does not. ${where}`,
    ).toBe(m.clampLines);
    expect(
      m.naturalLines,
      `the fixture note only needs ${m.naturalLines} lines, so painting ${lines} proves nothing about this tier — ${where}`,
    ).toBeGreaterThanOrEqual(lines);
    return m;
  };

  it.each([
    { ...FLEET[0], lines: 1, threshold: 'below 88px — the single-line tier' },
    { ...FLEET[1], lines: 4, threshold: '108px — the no-now-heading four-line tier' },
    { ...FLEET[2], lines: 4, threshold: '161px — the four-line tier' },
  ])('$name — the note is set in $lines painted line(s)', tierCase, 60000);

  /**
   * THE FOURTH LINE PAYS FOR ITSELF AT THE TOP OF THE FLEET, and this is the
   * thinnest margin in the whole design: the shipped 224-character fact sets
   * WHOLE at 1920x1080 — the reason the four-line tier was added at all — with
   * about a thirtieth of a pixel to spare. Any widening of the display face, any
   * rise in the clamp's ceiling, any change to the line-height, and the note
   * starts ellipsizing on the largest screen in the house.
   *
   * It is asserted only here, and deliberately not at the smaller sizes: at
   * 1280x720 the same fact's fifth line IS ellipsized, and the stylesheet says
   * so in as many words ("the fourth line — for this one fact, on this one
   * measure — still ellipsizes, which is the wrap-or-ellipsis law doing exactly
   * its job on a genuine overflow"). A blanket "the note is always whole" would
   * be asserting a law the design does not hold.
   */
  it('1920x1080 — the shipped fact sets whole, with nothing ellipsized', async () => {
    await layout(page, css, FLEET[2]);
    const m = await noteMeasure(page);
    expect(
      m.naturalPx,
      `the note wants ${m.naturalPx}px (${m.naturalLines} lines at ${m.lineHeight}px) and the four-line reserve is ${m.reservePx}px, so ${m.naturalLines - m.paintedLines} line(s) are being ellipsized on the largest screen in the fleet — the tier exists precisely so this fact is whole here`,
    ).toBeLessThanOrEqual(m.reservePx + 0.5);
    expect(m.naturalLines, 'the fixture stopped exercising the four-line tier').toBe(4);
  }, 60000);

  /**
   * THE THREE-LINE TIER still has to work — it is what a band configured
   * `nowHeading: always` gets at the office screen's size, and it is the tier
   * whose 88px crossover carries the thinnest margin in the design ("0.58px of
   * air"). Asserted where it actually binds rather than left underived.
   */
  it('1280x720 with the NOW heading printed — the note is set in 3 painted lines', async () => {
    const data = { ...EROICA, definition: { ...DEFINITION, band: { nowHeading: 'always' } } };
    await tierCase({
      ...FLEET[1], data, lines: 3, threshold: '88px crossover, below the 161px ceiling',
    });
    const heading = await page.locator('[data-testid="surround-ticker-now"]').count();
    expect(heading, 'nowHeading: always did not print the heading this tier is derived around').toBe(1);
  }, 60000);

  /**
   * THE ACCORDION'S WHOLE PURPOSE. The sounding movement widens until neither
   * its heading nor its gloss is cut; its neighbours compress but never past the
   * measured floor. Both halves are asserted here, against the real solver.
   */
  it.each(FLEET)('$name — the sounding segment shows its heading and gloss whole, and no neighbour goes under the floor', async ({ width, height }) => {
    await layout(page, css, { width, height });
    const solved = await runAccordion(page);
    // SKIPPING IS NOT PASSING. `runAccordion` returns null only when there is no
    // rule on the page, which on the shipped numbers means one thing: the band
    // fell under `collapse.footerFloor` and dropped its `collapse: first`
    // region. That is a real, testable state — so it is asserted rather than
    // returned out of, and if the rail is missing for any OTHER reason this case
    // fails instead of quietly passing with no assertions.
    if (solved === null) {
      const footerH = await page.locator('[data-testid="surround-footer"]')
        .evaluate((el) => Number(el.getBoundingClientRect().height.toFixed(2)));
      expect(
        footerH,
        `there is no movement rail on this screen, but the footer is ${footerH}px — above the ${DEFINITION.collapse.footerFloor}px floor, so the collapse rule is not why it is missing`,
      ).toBeLessThan(DEFINITION.collapse.footerFloor);
      return;
    }
    const after = await page.evaluate(() => {
      const segs = [...document.querySelectorAll('.surround-movement-map__segment')];
      return segs.map((s, i) => {
        const heading = s.querySelector('.surround-movement-map__heading');
        const gloss = s.querySelector('.surround-movement-map__translation');
        return {
          i,
          state: s.getAttribute('data-state'),
          widthPx: Number(s.getBoundingClientRect().width.toFixed(2)),
          headingCut: heading ? heading.scrollWidth - heading.clientWidth : 0,
          glossCut: gloss ? gloss.scrollWidth - gloss.clientWidth : 0,
        };
      });
    });

    const active = after.find((s) => s.state === 'active');
    expect(active, 'no segment is sounding at position 1200 — the rail and the clock disagree').toBeTruthy();

    // The DEGRADE branch is a designed outcome, not a failure: when the ideal
    // width would starve the neighbours the active segment takes what is free
    // and keeps its ellipsis. It is only legitimate when the neighbours really
    // are at the floor, which the second assertion below pins.
    const granted = (solved.shares[solved.activeIndex] ?? 0) * solved.railPx;
    const starved = solved.desiredPx > 0 && granted < solved.desiredPx - 1;
    if (!starved) {
      expect(
        { headingCut: active.headingCut, glossCut: active.glossCut },
        `the sounding segment is ${active.widthPx}px wide and was solved for ${solved.desiredPx}px, yet its text is still cut (rail ${solved.railPx.toFixed(1)}px, need ${solved.need?.toFixed?.(1)}px)`,
      ).toEqual({ headingCut: 0, glossCut: 0 });
    }

    const under = after.filter((s) => s.state !== 'active' && s.widthPx < SEGMENT_FLOOR_PX - 0.5);
    expect(
      under,
      `neighbours compressed under the ${SEGMENT_FLOOR_PX}px floor — at that width a segment is an unlabelled stripe: ${JSON.stringify(under)}`,
    ).toEqual([]);
  }, 60000);

  /**
   * THE ACCORDION ONLY EVER OPENS WHEN IT NEEDS TO.
   *
   * The other half of the accordion's contract, and the one an outcome
   * assertion cannot see: a movement whose heading and gloss ALREADY fit must
   * not widen at all, because every pixel it takes comes off a neighbour that
   * was telling the truth about its duration. `scrollWidth` is an integer and a
   * segment's measured width is not, so a bare `need > cellW` is true by a
   * rounding hair on a box that is not overflowing — which is how this used to
   * quietly compress the whole rail for a name that fitted.
   *
   * Movement I at 1920x1080: "Allegro con brio" and "Fast, with spirit" in a
   * segment a third of a 1251px rule wide. Nothing to open for.
   *
   * TO GO RED: drop the half-pixel threshold from `desiredWidth`.
   */
  it('1920x1080 — a sounding movement whose text already fits takes nothing from its neighbours', async () => {
    await layout(page, css, { ...FLEET[2], position: 100 });
    const solved = await runAccordion(page);
    expect(solved, 'no rail to measure').not.toBeNull();
    expect(solved.activeIndex, 'movement I should be sounding at 100s').toBe(0);
    expect(
      solved.desiredPx,
      `the accordion wants ${solved.desiredPx}px for a segment already ${solved.segW.toFixed(2)}px wide whose text column is ${solved.cellW.toFixed(2)}px and whose widest line is ${solved.need}px — it fits, so nothing should open`,
    ).toBe(0);
    const drift = solved.shares.map((s, i) => Number((s - solved.natural[i]).toFixed(6)));
    expect(
      drift,
      `the rail's rendered widths drifted from their duration-derived shares for a movement that needed no room: ${JSON.stringify(drift)}`,
    ).toEqual(solved.natural.map(() => 0));
  }, 60000);

  /**
   * THE NAME MEASURE, IN BOTH FACES. `12ch` replaced a `5.6em` cap precisely so
   * the measure would re-derive itself in the fallback face rather than staying
   * frozen at Cormorant's widths — the property `em` lacked. Self-hosting the
   * faces narrows the window in which the fallback paints, but it does not close
   * it (a cold cache still paints one frame of it), so both are asserted.
   *
   * The law is the plate's own: at most three lines, and NOTHING cut — the
   * ceiling is a `max-height` on a clipping box, so a fourth line is not an
   * ellipsis, it is a name with its bottom sliced off.
   */
  it.each([
    { face: 'the display face', family: null },
    { face: 'the fallback face', family: 'Georgia, "DejaVu Serif", serif' },
  ])('the composer\'s name stacks inside the plate in $face', async ({ family }) => {
    const markup = renderToStaticMarkup(
      <ComposerCard data={{ ...EROICA, composer: { ...EROICA.composer, name: 'Pyotr Ilyich Tchaikovsky' } }} />,
    );
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.setContent(
      `<!doctype html><html><head><meta charset="utf-8"><style>${css}
        ${family ? `.surround-frame { --surround-display: ${family}; --surround-body: ${family}; }` : ''}
       </style></head><body>
       <div class="surround-frame" style="width:1280px"><div class="surround-frame__rail" style="width:33%">
       <div class="surround-frame__region surround-frame__region--right">${markup}</div>
       </div></div></body></html>`,
      { waitUntil: 'load' },
    );
    await page.evaluate(() => document.fonts.ready);

    const name = await page.locator('.surround-composer-card__name').evaluate((el) => {
      const cs = getComputedStyle(el);
      const shown = el.getBoundingClientRect().height;
      // How tall the name WANTS to be, in floats. `scrollHeight`/`clientHeight`
      // are integers and a two-line name at 32.2px lands on 64.4 — which rounds
      // apart into a phantom 1px of overflow. Lifting the ceiling and
      // re-measuring is the only reading that is not a rounding artefact.
      const prev = el.style.maxHeight;
      el.style.maxHeight = 'none';
      const needed = el.getBoundingClientRect().height;
      el.style.maxHeight = prev;
      return {
        lines: Math.round(needed / parseFloat(cs.lineHeight)),
        measurePx: Number(el.getBoundingClientRect().width.toFixed(2)),
        maxWidth: cs.maxWidth,
        cut: Number((needed - shown).toFixed(2)),
        font: cs.fontFamily,
      };
    });
    expect(
      name.cut,
      `the name is cut by ${name.cut}px: it stacked to ${name.lines} lines inside a 3-line ceiling, measure ${name.measurePx}px (max-width ${name.maxWidth}) in ${name.font}`,
    ).toBeLessThanOrEqual(0.5);
    expect(
      name.lines,
      `the name stacked to ${name.lines} lines; the plate's ceiling is 3 (measure ${name.measurePx}px in ${name.font})`,
    ).toBeLessThanOrEqual(3);
  }, 60000);
});
