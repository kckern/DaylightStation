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
import {
  accordionShares, desiredWidth, placedMovements, SEGMENT_FLOOR_PX,
} from './band.js';
import {
  bandPools, PROSE_FLOOR_PX, PROSE_CEILING_PX, LEADING_FLOOR, LEADING_MAX,
} from './fit.js';
import { smartQuotes } from './typography.js';
import { smartQuotesAll } from './typography.js';
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

/**
 * THE OTHER SHIPPED PIECE, verbatim from `data/content/library/classical/vivaldi/
 * four-seasons-spring.yml`. Three movements against the Eroica's four, a third of
 * the duration, and much shorter facts — which is exactly why it is here: a fit
 * ladder that only ever sees one corpus proves nothing about the ladder.
 */
const SPRING = Object.freeze({
  id: 'concert-hall',
  contentId: 'plex:spring',
  definition: DEFINITION,
  assetBase: 'library/classical',
  piece: {
    title: 'Violin Concerto in E major, "Spring"',
    short_title: "Vivaldi's Spring",
    opus: 'Op. 8 No. 1, RV 269',
    composed: 'by 1725',
    year: 1725,
    premiered: 'Published Amsterdam, 1725',
    musicEndsAt: 610,
  },
  composer: {
    name: 'Antonio Vivaldi', born: 1678, died: 1741, birthplace: 'Venice', period: 'Baroque',
    facts: ['Vivaldi was ordained a priest and was known as il Prete Rosso, the Red Priest.'],
  },
  movements: [
    {
      n: 1,
      name: 'Allegro',
      translation: 'Fast and lively',
      listen: [
        'Three solo violins trade birdcalls in the opening — each bird its own figure.',
        'A soft murmuring in the violins is the brook; the storm breaks in with tremolo and racing scales.',
        'The opening theme keeps returning between episodes — count its comebacks.',
      ],
      start: 0,
    },
    {
      n: 2,
      name: 'Largo e pianissimo sempre',
      translation: 'Slow, and always very soft',
      listen: [
        'The solo violin is the sleeping goatherd; the murmuring violins are leaves in the breeze.',
        "The violas bark twice a bar, all the way through — Vivaldi marked the part 'the dog that barks'.",
      ],
      start: 205,
    },
    {
      n: 3,
      name: 'Allegro pastorale',
      translation: 'Fast, in a pastoral style',
      listen: [
        'A drone in the low strings imitates bagpipes under the dance — a rustic musette.',
        'The solo violin leads the country dance — nymphs and shepherds celebrating the season.',
      ],
      start: 383,
    },
  ],
  cues: [],
  facts: [
    'Spring opened Il cimento dell\u2019armonia e dell\u2019inventione — The Contest of Harmony and Invention — the 1725 collection that made the Four Seasons famous.',
    'Each of the Four Seasons was published alongside a sonnet describing the scene. Vivaldi may have written the poems himself.',
    'The score is marked with the things it depicts: birdsong, a thunderstorm, a barking dog.',
  ],
});

/**
 * The Eroica's WHOLE fact pool, verbatim from the corpus — not just the Napoleon
 * note. The wave-8 fixture carried one fact because one tier was being proved;
 * the fit is solved against every string the band can show, so every string the
 * band can show is what the fixture has to hold.
 */
const EROICA_FULL = Object.freeze({
  ...EROICA,
  facts: [
    NAPOLEON,
    'It is twice as long as a symphony by Haydn or Mozart. The first movement alone runs about as long as a whole Classical symphony.',
    'The published title page reads: composed to celebrate the memory of a great man.',
    'A surviving copy of the score still shows the dedication to Bonaparte scratched out — twice, in two languages.',
    'The second movement was played at state funerals for more than a century after his death.',
  ],
  movements: EROICA.movements.map((m, i) => ({
    ...m,
    listen: [
      m.listen[0],
      ...(i === 0 ? [
        'The theme slides onto a strange note almost at once — that small wrongness powers the whole movement.',
        'Before the main theme returns, a lone horn sneaks it in early over hushed strings — early audiences thought the player had miscounted.',
        'Huge off-beat chords batter against the bar line — the music fighting its own meter.',
      ] : []),
    ],
  })),
  cues: [
    { at: 976, render: 'docked', text: 'The funeral march. Beethoven puts a death at the centre of a symphony — nobody had done that before.' },
    { at: 1925, render: 'docked', text: 'The scherzo. Its trio uses three horns — the first time that had ever happened in a symphony.' },
    { at: 2278, render: 'docked', text: 'The finale takes a tune Beethoven had already used three times before, and builds a set of variations on it.' },
  ],
});

/** The two pieces this frame actually ships, by the name the failure prints. */
const SHIPPED = Object.freeze([
  { piece: "Beethoven's Eroica", data: EROICA_FULL, sounding: 1200 },
  { piece: "Vivaldi's Spring", data: SPRING, sounding: 300 },
]);

/**
 * Every string the band can show, exactly as `CueTicker` derives them — from the
 * PLACED movements (review finding M-7). A movement this recording cannot put on
 * the clock never becomes the sounding movement, so its notes never show and the
 * component never fits against them; passing the authored list instead would
 * make this spec measure strings the band will not paint. Equivalent on both
 * shipped pieces, and wrong the moment a recording has a bad `starts` entry.
 */
const poolsFor = (data) => {
  const raw = bandPools({
    facts: data.facts,
    movements: placedMovements(data.movements).map((p) => p.movement),
    cues: data.cues,
  });
  return { piece: smartQuotesAll(raw.piece), now: smartQuotesAll(raw.now) };
};

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

/**
 * `fit.js`, LOADED INTO THE PAGE AND RUN THERE.
 *
 * The band's type is chosen by a SEARCH whose every step is a measurement, so
 * unlike the accordion it cannot be split into "DOM reads here, arithmetic
 * there" — the loop is the load-bearing part and it has to be inside the layout
 * engine. Transcribing it into this spec would be the exact defect this whole
 * file exists to abolish, so the shipped source is injected instead: `fit.js`
 * has no imports precisely so that stripping its `export` keywords yields a
 * runnable classic script. The functions this spec calls are the functions
 * `CueTicker` calls, byte for byte.
 */
async function injectFit(page) {
  const src = fs.readFileSync(path.join(HERE, 'fit.js'), 'utf8')
    .replace(/^export default .*$/m, '')
    .replace(/^export /gm, '');
  await page.addScriptTag({
    content: `${src}\nwindow.__fit = { fitBand, fitStyle, bandPools, withhold, withheldSets, PROSE_FLOOR_PX, PROSE_CEILING_PX, LEADING_FLOOR, LEADING_MAX };`,
  });
  const ok = await page.evaluate(() => typeof window.__fit?.fitBand === 'function');
  expect(ok, 'fit.js did not load into the page — the injection stripped something it needed').toBe(true);
}

/* -------------------------------------------------------------------------- */
/* The page                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Render the frame at one fleet size and hand back a page positioned exactly as
 * the browser has it after the frame's own effects have run once.
 */
async function layout(page, css, { width, height, data = EROICA, position = POSITION }) {
  const pools = poolsFor(data);
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

  // EFFECT 3 — `CueTicker`'s fit, reproduced by calling it. The component runs
  // `fitBand(root, pools)` in a layout effect and publishes what it returns as
  // two custom properties; both halves happen here, with the SAME functions.
  await injectFit(page);
  const fit = await page.evaluate((p) => {
    const root = document.querySelector('.surround-cue-ticker');
    if (!root) return null;
    const solved = window.__fit.fitBand(root, p);
    if (!solved) return null;
    const style = window.__fit.fitStyle(solved);
    Object.entries(style).forEach(([k, v]) => root.style.setProperty(k, v));

    // EFFECT 4 — THE REGISTER SHOWS ONLY WHAT FITS. `CueTicker` puts every
    // rotating note AND every timed cue through `withhold` before it can reach a
    // register (a string that cannot be set whole at the floors is an authoring
    // failure: warned about, not shown). `renderToStaticMarkup` ran no effects,
    // so the markup on this page still carries whatever the server render chose
    // whether or not it fits.
    //
    // IT CALLS `withhold`, IT DOES NOT MODEL IT. The first draft hand-wrote the
    // filter here, and a hand-written model is how review finding C-1 hid: the
    // spec modelled a filter that covered cues and the component's did not, so
    // the one string the fit had refused was painted on a real screen with the
    // spec green. The predicate is the shipped one now; the falsifiable test of
    // the component's WIRING lives in `modules/CueTicker.test.jsx`, where the
    // component actually runs.
    const withheld = window.__fit.withheldSets(solved);
    [['piece', 'surround-ticker-text'], ['now', 'surround-ticker-listen']].forEach(([key, id]) => {
      const line = document.querySelector(`[data-testid="${id}"] .surround-cue-ticker__line`);
      if (!line) return;
      const painted = line.textContent;
      // ONLY where the painted string is one the component would have withheld.
      // A blank register (nothing sounding) stays blank, and a note that fits
      // stays exactly where the server render put it.
      if (window.__fit.withhold([painted], withheld?.[key]).length) return;
      line.textContent = window.__fit.withhold(p[key] ?? [], withheld?.[key])[0] ?? '';
    });
    return solved;
  }, pools);

  return { page, fit, pools };
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
 * IS THIS NOTE CUT? — measured on the element that actually holds line boxes.
 *
 * The first version of this divided `.surround-cue-ticker__text`'s height by its
 * line-height. That box had `min-height == max-height` in every tier, so the
 * division was `max-height / line-height`: a ratio of two compiled CSS values,
 * evaluated in a browser. It observed no text at all, which is the exact defect
 * class this whole file exists to eliminate.
 *
 * What is measured now is the thing the law is about. `__line` carries the text
 * and no height constraint, so its rendered height is the height the note SETS
 * in this measure at this size. `__text` is the room it has. Cut is the
 * difference, and it must be zero — for every note, at every screen, forever.
 *
 * `setText` puts a specific string in the line first, because the rotation shows
 * one at a time and the law is about all of them.
 */
async function noteCut(page, { zone = 'text', text = null } = {}) {
  const testid = zone === 'now' ? 'surround-ticker-listen' : 'surround-ticker-text';
  return page.locator(`[data-testid="${testid}"]`).first().evaluate((box, next) => {
    const line = box.querySelector('.surround-cue-ticker__line');
    if (next !== null) line.textContent = next;
    const cs = getComputedStyle(box);
    const lh = parseFloat(cs.lineHeight);
    const roomPx = box.clientHeight;
    const setPx = line.getBoundingClientRect().height;
    const px = (n) => Number(n.toFixed(2));
    return {
      text: line.textContent,
      chars: line.textContent.length,
      fontSize: px(parseFloat(cs.fontSize)),
      lineHeight: px(lh),
      leading: Number((lh / parseFloat(cs.fontSize)).toFixed(3)),
      roomPx: px(roomPx),
      setPx: px(setPx),
      lines: Math.round(setPx / lh),
      cutPx: px(Math.max(0, setPx - roomPx)),
      // The truncation machinery, read back off the paint. Both must be inert:
      // this band has no ellipsis at any size.
      // `none` and `''` are the inert readings; a NUMBER means a clamp is armed.
      clamp: Number.parseInt(getComputedStyle(line).getPropertyValue('-webkit-line-clamp'), 10) || null,
      overflowRule: cs.textOverflow,
      scrollOver: box.scrollHeight - box.clientHeight,
    };
  }, text);
}

/**
 * THE BOND, AS PAINTED — the three boxes that have to be ONE region.
 *
 * Returns each part's horizontal extent in page pixels, so a join can be checked
 * as an INTERVAL rather than by eye. A point-contact — the defect this wave
 * removes — is an overlap of zero, and reads as such here.
 */
async function bondBoxes(page) {
  return page.evaluate(() => {
    const rect = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        x: r.x, right: r.right, y: r.y, bottom: r.bottom, w: r.width, h: r.height,
        opacity: Number(cs.opacity),
        bg: cs.backgroundColor,
        radius: cs.borderRadius,
      };
    };
    return {
      segment: rect('[data-testid="surround-bond"]'),
      waist: rect('[data-testid="surround-bond-connector"]'),
      panel: rect('[data-testid="surround-ticker-ground"]'),
      rule: rect('.surround-movement-map__rule'),
      zones: rect('.surround-cue-ticker__zones'),
    };
  });
}

/** The ticker's own content box — what the surviving `@container` query sees. */
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
   * THE LAW THE `overflow: hidden` HIDES. Every box in the ticker clips, so an
   * over-budget layout does not look broken — it silently eats the last line of
   * the note.
   *
   * `.surround-cue-ticker__line` IS in this sweep now, and its arrival is the
   * whole of design wave 9. Under the tier lattice it was the CLAMPED element,
   * so on any note longer than its tier it overflowed BY DESIGN — measured,
   * `scrollHeight` 122 against `clientHeight` 98 at 1280x720, the ellipsis doing
   * its job on a genuine overflow — and including it would have made this case
   * red on shipped, correct output. There is no clamp any more and no note is
   * ever cut, so the element that used to be the exception is now the point.
   */
  it.each(FLEET)('$name — nothing in the ticker overflows the box that clips it', async ({ width, height }) => {
    await layout(page, css, { width, height, data: EROICA_FULL });
    const boxes = await page.evaluate(() => [...document.querySelectorAll(
      '.surround-cue-ticker, .surround-cue-ticker__text, .surround-cue-ticker__zone, .surround-cue-ticker__line',
    )].map((el) => ({
      cls: el.className,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    })));
    expect(boxes.length, 'the ticker did not render at all').toBeGreaterThan(0);
    const overflowing = boxes.filter((b) => b.scrollHeight > b.clientHeight);
    expect(
      overflowing,
      `boxes overflowing the box that clips them: ${JSON.stringify(overflowing)}`,
    ).toEqual([]);
  }, 60000);

  /**
   * ============================================================================
   * NO ELLIPSIS. ANYWHERE. EVER.
   * ============================================================================
   *
   * The headline law of design wave 9, and the reason the tier lattice was
   * deleted. A television has no "read more", no scroll and no pointer: a note
   * that stops mid-sentence with three dots is a claim the viewer cannot
   * complete, and it is worse than no note at all.
   *
   * Every string the band can show is put in the register in turn and measured
   * against the room it has. `cutPx` is the height the note SET minus the height
   * it was GIVEN, so zero is the law and anything else is the defect, reported
   * with the size, the leading, the line count and the overflow.
   *
   * TO GO RED: restore `-webkit-line-clamp` on `.surround-cue-ticker__line`
   * (with the reserve tiers, the shipped notes overflow it at 960x540 and
   * 1280x720 — see the wave-8 spec this replaces, which asserted the ellipsis as
   * correct behaviour); or raise `PROSE_CEILING_PX`; or delete the rejection
   * pass in `fitBand`, which is what keeps an unfittable note off the screen
   * instead of clipped inside it.
   */
  describe.each(SHIPPED)('$piece — the note is never cut', ({ data, sounding }) => {
    it.each(FLEET)('$name', async ({ width, height, name }) => {
      const { fit, pools } = await layout(page, css, {
        width, height, data, position: sounding,
      });
      expect(fit, 'the band was never laid out, so nothing was fitted').not.toBeNull();

      const shown = pools.piece.filter((t) => !fit.rejected.some((r) => r.zone === 'piece' && r.text === t));
      const cuts = [];
      for (const text of shown) {
        // eslint-disable-next-line no-await-in-loop -- one layout at a time, on purpose
        const m = await noteCut(page, { text });
        if (m.cutPx > 0 || m.clamp || m.overflowRule === 'ellipsis') cuts.push({ ...m, at: name });
      }
      expect(
        cuts,
        `${cuts.length} of the ${shown.length} facts the piece register shows at ${name} are cut or `
        + `clamped: ${JSON.stringify(cuts.map((c) => ({
          chars: c.chars, set: c.setPx, room: c.roomPx, cut: c.cutPx, clamp: c.clamp,
        })))}`,
      ).toEqual([]);

      // ...and the same for the NOW register, whose rotation is the case the
      // brief asked to be argued rather than assumed. Its pool is per-movement
      // and its room is the same box, so the fit covers it by the same solve.
      const shownNow = pools.now.filter((t) => !fit.rejected.some((r) => r.zone === 'now' && r.text === t));
      const nowCuts = [];
      for (const text of shownNow) {
        // eslint-disable-next-line no-await-in-loop
        const m = await noteCut(page, { zone: 'now', text });
        if (m.cutPx > 0 || m.clamp) nowCuts.push(m);
      }
      expect(
        nowCuts,
        `the NOW register cuts ${nowCuts.length} of its ${shownNow.length} notes at ${name}`,
      ).toEqual([]);
    }, 90000);
  });

  /**
   * THE FLOORS ARE FLOORS. The ladder may tighten the leading and step the size
   * down, and it may not go past either bound — below them the note is
   * unreadable at ten feet, which is the same defect in smaller type. Both are
   * derived in `fit.js` against the vendored face's own metrics; this asserts
   * that what is PAINTED honours them.
   *
   * TO GO RED: return anything outside [floor, ceiling] from `largestPassing`,
   * or let the rejection pass fall through to a smaller size instead of
   * dropping the note.
   */
  it.each(FLEET)('$name — the fitted type stays inside the ladder’s floors', async ({ width, height, name }) => {
    const { fit } = await layout(page, css, { width, height, data: EROICA_FULL });
    const m = await noteCut(page);
    expect(
      m.fontSize,
      `the note is set at ${m.fontSize}px at ${name}, below the ${PROSE_FLOOR_PX}px prose floor — `
      + 'an x-height of ' + (m.fontSize * 0.42).toFixed(2) + 'px against the 5.91px the floor buys',
    ).toBeGreaterThanOrEqual(PROSE_FLOOR_PX - 0.01);
    expect(m.fontSize, 'the note is louder than the work’s own title on the plate')
      .toBeLessThanOrEqual(PROSE_CEILING_PX + 0.01);
    expect(
      m.leading,
      `the note is leaded at ${m.leading} at ${name}; EB Garamond's ink extent is 1.00em, so that `
      + `leaves ${(m.leading - 1).toFixed(2)}em between one line's descenders and the next line's `
      + `ascenders — the floor is ${LEADING_FLOOR}`,
    ).toBeGreaterThanOrEqual(LEADING_FLOOR - 0.001);
    expect(m.leading, 'the note is leaded looser than the design sets it')
      .toBeLessThanOrEqual(LEADING_MAX + 0.001);
    expect(fit.fontPx).toBeCloseTo(m.fontSize, 1);
  }, 60000);

  /**
   * A CUE IS A NOTE, AND THE LAW IS THE SAME ONE (review finding C-1).
   *
   * A timed cue preempts a register at full size for its dwell, so it is exactly
   * as capable of being cut as a rotating note is — and it is the one string the
   * fit solves the size WITHOUT, because it has already refused it. This puts an
   * over-long cue on the office screen at its own `at` and measures what the
   * register paints.
   *
   * TO GO RED here: delete the cue's text from `bandPools`, so it is never
   * measured and never refused. TO GO RED in the component (which is where the
   * defect lived, and where `renderToStaticMarkup` cannot reach): choose
   * `activeCue` from `cues` rather than from `fittableCues` — proven in
   * `modules/CueTicker.test.jsx`.
   */
  it('960x540 — an over-long cue is refused and never painted', async () => {
    // Sized against the LIVING-ROOM root, which is where a cue of ordinary
    // length actually overflows: that register holds ~126 characters at the
    // fitted size and ~126 at the floor. (The office root's NOW register holds
    // ~243 at its fitted size and ~329 at the floor, so a cue has to be absurd
    // to fail there — which is why this case is set on the screen where the law
    // actually bites.)
    const OVERLONG = 'The funeral march, and the reason it is the centre of the symphony rather than an '
      + 'interlude: Beethoven puts a death where a minuet had always gone, and the whole shape of '
      + 'the piece changes around it.';
    const data = {
      ...EROICA_FULL,
      cues: [{ at: 976, render: 'docked', text: OVERLONG }],
    };
    const { fit, pools } = await layout(page, css, { ...FLEET[0], data, position: 980 });
    const curled = smartQuotes(OVERLONG);
    expect(pools.now, 'the cue is not in the measured pool, so it was never judged')
      .toContain(curled);
    const refused = fit.rejected.find((r) => r.text === curled);
    expect(
      refused,
      `the ${OVERLONG.length}-character cue was accepted at ${fit.fontPx}px in a `
      + `${fit.zones.find((z) => z.zone === 'now')?.availPx}px box — measure it again`,
    ).toBeTruthy();
    expect(refused.zone).toBe('now');
    expect(refused.budget).toBeLessThan(OVERLONG.length);

    const m = await noteCut(page, { zone: 'now' });
    expect(
      m.text,
      'the NOW register is painting a cue the fit refused — at a size solved without it',
    ).not.toContain('Beethoven puts a death');
    expect(m.cutPx, `the register's line is cut by ${m.cutPx}px`).toBe(0);
  }, 90000);

  /**
   * THE SCREEN THAT HAS TO BE RIGHT. 1280x720 is the office kiosk's real
   * screen-root; 960x540 and 1920x1080 are the fleet's other two. At the office
   * screen EVERY authored fact and EVERY listening note of BOTH shipped pieces
   * must fit — nothing rejected, nothing dropped from a rotation.
   *
   * TO GO RED: lengthen any shipped fact past its budget, or narrow the band.
   * The failure prints the budget, so the corpus can be fixed from the message.
   */
  it.each(SHIPPED)('1280x720 — every one of $piece’s notes fits, with none dropped', async ({ data, sounding }) => {
    const { fit } = await layout(page, css, {
      ...FLEET[1], data, position: sounding,
    });
    expect(
      fit.rejected,
      `${fit.rejected.length} note(s) cannot be set whole at the office screen even at the `
      + `floors, so the band will not show them at all. Re-author to the budget:\n`
      + fit.rejected.map((r) => `  [${r.zone}] ${r.chars} chars, budget ${r.budget} `
        + `(cut ${r.chars - r.budget}), overflow ${r.overflowPx}px: ${r.text.slice(0, 60)}...`).join('\n'),
    ).toEqual([]);
  }, 90000);

  /**
   * ============================================================================
   * THE BOND IS ONE CONNECTED REGION — no point-contacts, anywhere.
   * ============================================================================
   *
   * The defect the user found: the lit segment, the waist and the lit NOW panel
   * met at a CORNER — "kitty corner", diagonal neighbours touching at a point.
   * Two regions joined at a point are two regions, in every sense a viewer has.
   *
   * Asserted as geometry, over every movement of both shipped pieces and both
   * `nowSide` settings, because "it looked joined at 1200s on the Eroica" is
   * exactly the kind of evidence that let this ship in the first place:
   *
   *   1. the waist and the segment overlap along a REAL interval (the segment's
   *      own full width), and touch vertically with no gap;
   *   2. the waist covers the panel's ENTIRE width — the brief's own wording,
   *      and the thing a corner-join fails;
   *   3. all three are painted in the same ground, or they are not one shape
   *      however they are joined.
   *
   * TO GO RED: return `{ start: b, width: panelStart - b }` from `bondConnector`
   * — wave 7's version, which stops at the panel's near edge.
   */
  const bondCase = async ({ width, height, data, movementIndex, side, name }) => {
    const withSide = { ...data, definition: { ...DEFINITION, band: { nowSide: side } } };
    const at = data.movements[movementIndex].start
      + Math.max(1, ((data.movements[movementIndex + 1]?.start ?? data.piece.musicEndsAt)
        - data.movements[movementIndex].start) / 2);
    await layout(page, css, { width, height, data: withSide, position: at });
    const b = await bondBoxes(page);
    const where = `${name}, movement ${movementIndex + 1} at ${Math.round(at)}s, nowSide ${side}`;
    expect(b.segment, `no bond on the rail — ${where}`).not.toBeNull();
    expect(b.panel, `no panel in the register — ${where}`).not.toBeNull();
    expect(Number(b.segment.opacity), `the bond is faded out while a movement is sounding — ${where}`).toBe(1);

    const overlap = (a, c) => Math.min(a.right, c.right) - Math.max(a.x, c.x);

    // 1. THE LOWER JOIN — the defect itself, asserted first because it is the
    //    one the user saw. THE WAIST MUST COVER THE PANEL'S WHOLE TOP EDGE.
    const welded = overlap(b.waist, b.panel);
    expect(
      Number(welded.toFixed(2)),
      `the waist welds ${welded.toFixed(2)}px of the NOW panel's ${b.panel.w.toFixed(2)}px top `
      + `edge — ${welded <= 1 ? 'a POINT CONTACT: the two lit areas are kitty corner, joined at nothing'
        : 'a partial weld, so the panel is pinched at one end'}`
      + ` — ${where}`,
    ).toBeCloseTo(Number(b.panel.w.toFixed(2)), 1);
    expect(
      b.panel.y - b.waist.bottom,
      `${(b.panel.y - b.waist.bottom).toFixed(2)}px of band ground between the waist and the panel — ${where}`,
    ).toBeCloseTo(0, 1);

    // 2. THE UPPER JOIN. Same law, one storey up: the waist must contain the
    //    segment's whole width, and their boxes must touch vertically.
    expect(
      Number(overlap(b.segment, b.waist).toFixed(2)),
      `the waist overlaps the sounding segment by ${overlap(b.segment, b.waist).toFixed(2)}px of `
      + `its ${b.segment.w.toFixed(2)}px width — ${where}`,
    ).toBeCloseTo(Number(b.segment.w.toFixed(2)), 1);
    expect(
      b.waist.bottom - b.segment.bottom,
      `the waist's foot is ${(b.waist.bottom - b.segment.bottom).toFixed(2)}px off the segment's — ${where}`,
    ).toBeCloseTo(0, 1);

    // 3. ONE GROUND.
    expect([b.segment.bg, b.waist.bg], `the three parts are painted ${b.segment.bg} / ${b.waist.bg} / ${b.panel.bg} — ${where}`)
      .toEqual([b.panel.bg, b.panel.bg]);
  };

  describe.each(SHIPPED)('$piece — the bond is one shape', ({ piece, data }) => {
    const cases = [];
    data.movements.forEach((_movement, movementIndex) => {
      for (const side of ['right', 'left']) {
        cases.push({ ...FLEET[1], piece, data, movementIndex, side });
      }
    });
    it.each(cases)('movement $movementIndex, nowSide $side', bondCase, 60000);
  });

  /** ...and at the other two sizes, for the movement most likely to pinch. */
  it.each(FLEET)('$name — the bond still welds along the panel’s whole edge', async ({ width, height, name }) => {
    // Movement I of the Eroica: a third of the rule, far from a right-hand
    // panel — the longest waist the shipped corpus produces, and the case the
    // user was looking at when they found the corner.
    await bondCase({
      width, height, name, data: EROICA_FULL, movementIndex: 0, side: 'right',
    });
  }, 60000);

  /**
   * NOTHING SOUNDING IS A DESIGNED STATE (design wave 9). Before the first
   * movement — the walk-on, the applause, the settling — and after the last
   * chord, no segment is active, the bond is out on both halves at once, and the
   * NOW register is blank. The band does NOT change height for it.
   *
   * TO GO RED: light the panel with no movement sounding, or let the NOW
   * register borrow a piece fact there (which is what it used to do).
   */
  it.each([
    { when: 'before the first movement starts', position: 20, first: 45 },
    { when: 'after the last movement ends', position: 3000, first: 0 },
  ])('1280x720 — nothing sounding, $when: blank, unlit, and the same height', async ({ position, first }) => {
    const sounding = await layout(page, css, { ...FLEET[1], data: EROICA_FULL, position: 1200 });
    const soundingH = await tickerContentBox(page);
    expect(sounding.fit).not.toBeNull();

    const late = {
      ...EROICA_FULL,
      movements: EROICA_FULL.movements.map((m, i) => (i === 0 ? { ...m, start: first } : m)),
    };
    await layout(page, css, { ...FLEET[1], data: late, position });
    const b = await bondBoxes(page);
    const state = await page.evaluate(() => ({
      states: [...document.querySelectorAll('[data-testid="surround-movement"]')]
        .map((el) => el.getAttribute('data-state')),
      note: document.querySelector('[data-testid="surround-ticker-listen"]').textContent.trim(),
      bonded: document.querySelector('[data-testid="surround-ticker-ground"]').getAttribute('data-bonded'),
    }));

    expect(state.states, `a segment is still lit with nothing sounding: ${JSON.stringify(state.states)}`)
      .not.toContain('active');
    expect(state.note, 'the NOW register is showing a note with nothing sounding').toBe('');
    expect(state.bonded, 'the NOW panel is lit with nothing to bond to').toBe('false');
    expect(Number(b.segment.opacity), 'the rail’s panel is still lit').toBe(0);
    expect(Number(b.waist.opacity), 'the waist is still lit').toBe(0);
    expect(Number(b.panel.opacity), 'the register’s panel is still lit').toBe(0);
    expect(
      await tickerContentBox(page),
      'the band changed height when the music stopped — the reserve is not reserved',
    ).toBeCloseTo(soundingH, 1);
  }, 90000);

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
