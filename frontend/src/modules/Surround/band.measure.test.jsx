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
//   2. `SegmentMap`'s accordion — measure the rule and the sounding segment's
//      overflow, solve the widths, apply them (`SegmentMap.jsx`, `band.js`).
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
  accordionShares, soundingWidth, idealWidth, placedSegments, nameFloorPx, railWearsChips,
  inactiveRoomPx, numeralStyle, numeralText,
  SEGMENT_FLOOR_PX, SEGMENT_NAME_RUN_PX, SEGMENT_CHIP_FLOOR_PX,
} from './band.js';
import {
  bandPools, proseFloorPx, labelFloorPx, proseCeilingPx,
  PROSE_FLOOR_ANCHOR_PX, FLOOR_ANCHOR_ROOT_PX,
  PROSE_CEILING_PX, LEADING_FLOOR, LEADING_MAX,
} from './fit.js';
import { factPools, isComposedContainer, segmentAt } from './segments.js';
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
      { module: 'segment-map', height: 64 },
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
  pieceSegments: [
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
 * four-seasons-spring.yml`. Three segments against the Eroica's four, a third of
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
  pieceSegments: [
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
 * The Eroica's whole fact pool — and A DELIBERATELY HOSTILE ONE, which is what
 * this comment now says because the previous version claimed it was the corpus
 * verbatim and it no longer is.
 *
 * It WAS a copy of the shipped sidecar, when the shipped sidecar held these five
 * long facts. The corpus has since been re-authored to fourteen short ones, none
 * over 92 characters, all of which fit on every screen in the fleet. Fixtures
 * made of those would exercise nothing: no note would ever be refused, the
 * rejection pass would never run, and the no-ellipsis law — the reason this
 * whole file exists — would be asserted against a corpus incapable of breaking
 * it. So these stay, and they stay on purpose: the 224-character Napoleon note
 * is the one that drove the three- and four-line tiers into existence and is
 * still the longest string the band has ever been asked to set.
 *
 * WHAT THAT MEANS FOR A FAILURE HERE. A red case in this file is a claim about
 * the FIT, not about the shipped programme notes — nothing below is on a screen
 * today. The shipped corpus is measured against the fit separately (the wave-9b
 * report carries those numbers); this is the adversary the fit has to survive.
 */
const EROICA_FULL = Object.freeze({
  ...EROICA,
  facts: [
    NAPOLEON,
    'It is twice as long as a symphony by Haydn or Mozart. The first segment alone runs about as long as a whole Classical symphony.',
    'The published title page reads: composed to celebrate the memory of a great man.',
    'A surviving copy of the score still shows the dedication to Bonaparte scratched out — twice, in two languages.',
    'The second segment was played at state funerals for more than a century after his death.',
  ],
  pieceSegments: EROICA.pieceSegments.map((m, i) => ({
    ...m,
    listen: [
      m.listen[0],
      ...(i === 0 ? [
        'The theme slides onto a strange note almost at once — that small wrongness powers the whole segment.',
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

/**
 * THE PIECE THE OWNER WAS WATCHING WHEN TASK 6C WAS WRITTEN — Chopin's
 * Nocturnes, verbatim from `data/content/library/classical/0_flagship/chopin/
 * nocturnes.yml` and `data/content/surround/classical/chopin/
 * nocturnes.weimar-lifits.yml`: twenty-one names, twenty-one starts, and the
 * `musicEndsAt` the sidecar authors.
 *
 * IT IS HERE BECAUSE IT IS THE CASE THE OTHER TWO CANNOT MAKE. Four movements
 * and three movements both leave the rail room for its names at every screen in
 * the fleet; twenty-one works do not, and everything task 6c added — the chip,
 * the threshold, the compressed floor, one notation per rail — is unreachable
 * from a corpus of four. The listening notes are the FIRST of each nocturne's
 * two, which is what keeps the fit's pool honest without carrying the whole
 * sidecar into this file.
 */
const NOCTURNE_NAMES = Object.freeze([
  'No. 1 in B-flat minor, Op. 9 No. 1',
  'No. 2 in E-flat major, Op. 9 No. 2',
  'No. 3 in B major, Op. 9 No. 3',
  'No. 4 in F major, Op. 15 No. 1',
  'No. 5 in F-sharp major, Op. 15 No. 2',
  'No. 6 in G minor, Op. 15 No. 3',
  'No. 7 in C-sharp minor, Op. 27 No. 1',
  'No. 8 in D-flat major, Op. 27 No. 2',
  'No. 9 in B major, Op. 32 No. 1',
  'No. 10 in A-flat major, Op. 32 No. 2',
  'No. 11 in G minor, Op. 37 No. 1',
  'No. 12 in G major, Op. 37 No. 2',
  'No. 13 in C minor, Op. 48 No. 1',
  'No. 14 in F-sharp minor, Op. 48 No. 2',
  'No. 15 in F minor, Op. 55 No. 1',
  'No. 16 in E-flat major, Op. 55 No. 2',
  'No. 17 in B major, Op. 62 No. 1',
  'No. 18 in E major, Op. 62 No. 2',
  'No. 19 in E minor, Op. 72 No. 1',
  'No. 20 in C-sharp minor, Op. posth.',
  'No. 21 in C minor, Op. posth.',
]);

const NOCTURNE_STARTS = Object.freeze([
  30, 347, 578, 1007, 1266, 1469, 1813, 2152, 2582, 2878, 3191,
  3523, 3886, 4291, 4814, 5129, 5474, 6030, 6430, 6679, 6932,
]);

const NOCTURNE_LISTEN = Object.freeze([
  'A long right-hand melody unfolds above rolling left-hand arpeggios, expanding rather than hurrying its phrases.',
  'The tune returns repeatedly, each time carrying a more elaborate veil of ornament.',
  'Short, graceful phrases keep the B-major nocturne light on its feet instead of broadly declamatory.',
  'The tender opening is broken by a sudden impetuous middle section that changes the scale of the music.',
  'Fine ornaments flit around the F-sharp-major melody with a weightless, suspended touch.',
  'The G-minor outer sections keep a grave, searching character around the melodic line.',
  'The left hand casts wide-spaced arpeggios beneath the melody; keep that netting soft enough to remain background.',
  'Thirds and sixths soften the D-flat-major melody into a richly blended, almost vocal texture.',
  'The B-major melody begins with unusual simplicity and very little ornament.',
  'The A-flat-major melody moves in long, unbroken arcs above a constantly changing accompaniment.',
  'A plaintive melody leans over a wailing accompaniment in the G-minor outer sections.',
  'The G-major melody is soft and rounded, with harmony that seems to delay every arrival.',
  'A quiet lament begins in C minor, then gathers weight until the texture becomes a chorale.',
  'The opening chords command in short, hard phrases while the answering line seems to plead beneath them.',
  'The outer sections carry a flebile dolcezza: a weeping sweetness held inside the F-minor melody.',
  'The melody flows without a sharply contrasting middle section, creating one continuous E-flat-major span.',
  'Tender flutings, trills, and roulades decorate the B-major melody with a late, intricate refinement.',
  'The E-major nocturne balances a broad singing line against restless inner motion.',
  'The E-minor melody sings over a simple accompaniment that leaves wide space around each phrase.',
  'The C-sharp-minor opening states a grave melody in plain chords before the texture begins to move.',
  'The C-minor line alternates between a simple cantabile phrase and more agitated answering figures.',
]);

const NOCTURNES = Object.freeze({
  id: 'concert-hall',
  contentId: 'plex:696230',
  definition: DEFINITION,
  assetBase: 'library/classical',
  piece: {
    title: 'Nocturnes',
    short_title: 'Chopin\u2019s Nocturnes',
    opus: 'Opp. 9, 15, 27, 32, 37, 48, 55, 62 and posthumous',
    composed: '1827-1846',
    year: 1832,
    period: 'Romantic',
    musicEndsAt: 7139,
  },
  composer: {
    name: 'Frederic Chopin', born: 1810, died: 1849, birthplace: 'Zelazowa Wola', period: 'Romantic',
    facts: ['Chopin gave about thirty public concerts in his life; he preferred playing in rooms.'],
  },
  pieceSegments: NOCTURNE_NAMES.map((name, i) => ({
    n: i + 1,
    name,
    start: NOCTURNE_STARTS[i],
    listen: [NOCTURNE_LISTEN[i]],
    // The one nocturne the corpus glosses, kept because a rail whose glosses are
    // all absent never exercises the gloss half of the accordion's `need`.
    ...(i === 19 ? { translation: 'Slow, with great expression' } : {}),
  })),
  cues: [],
  facts: [
    'These are twenty-one separate pieces, not movements of one work.',
    'John Field invented the nocturne; Chopin took the form and deepened it beyond recognition.',
  ],
});

/** Nocturne 9 is sounding: mid-rail, so both halves of the rail are compressed. */
const NOCTURNE_POSITION = 2700;

/**
 * THE POLONAISE SEASON (`plex:696237`), verbatim in shape from this branch's
 * store run against the production data volume: seven media items, one work
 * each, every segment stamped with the work that performs it and every work
 * carrying facts of its own under a container that carries eight.
 *
 * It is here because it is the payload the PLATE changed for. The two shipped
 * pieces above are single works, so their plates are the plate that always
 * shipped; this is the one where the headline is a segment name, the set line
 * exists at all, and the plate's type is fitted rather than fixed.
 */
const POLONAISE_NAMES = Object.freeze([
  ['Polonaise in C-sharp minor, Op. 26 No. 1', 'plex:696238', 447, 'chopin/polonaise-op-26-no-1'],
  ['Polonaise in E-flat minor, Op. 26 No. 2', 'plex:696239', 481, 'chopin/polonaise-op-26-no-2'],
  ['Polonaise in A major, Op. 40 No. 1', 'plex:696240', 334, 'chopin/polonaise-op-40-no-1'],
  ['Polonaise in C minor, Op. 40 No. 2', 'plex:696241', 497, 'chopin/polonaise-op-40-no-2'],
  ['Polonaise in F-sharp minor, Op. 44', 'plex:696242', 618, 'chopin/polonaise-op-44'],
  ['Polonaise in A-flat major, Op. 53', 'plex:696243', 449, 'chopin/polonaise-op-53'],
  ['Polonaise-fantaisie in A-flat major, Op. 61', 'plex:696244', 730, 'chopin/polonaise-op-61'],
]);

const POLONAISES = Object.freeze({
  id: 'concert-hall',
  // The item ON SCREEN is the sixth part — a container is played one media item
  // at a time, and the frame stamps the playing item's id onto the payload.
  contentId: 'plex:696243',
  definition: DEFINITION,
  assetBase: 'library/classical',
  piece: {
    title: 'Polonaises',
    short_title: "Chopin's Polonaises",
    composed: '1835-1846',
    year: 1846,
    period: 'Romantic',
  },
  composer: {
    name: 'Frédéric Chopin', born: 1810, died: 1849, birthplace: 'Żelazowa Wola', period: 'Romantic',
    facts: ['Chopin left Poland at twenty and never went back.'],
  },
  // The container work's own list: seven entries with no timings, which is what
  // the live payload carries and why the band does not split on this piece.
  pieceSegments: [],
  cues: [],
  segments: POLONAISE_NAMES.map(([name, contentId, duration, work], i) => ({
    n: i + 1,
    name,
    contentId,
    part: i,
    offset: POLONAISE_NAMES.slice(0, i).reduce((n, [, , d]) => n + d, 0),
    duration,
    start: 0,
    end: duration,
    group: { index: i, work, title: name },
  })),
  timeline: {
    totalSounding: POLONAISE_NAMES.reduce((n, [, , d]) => n + d, 0),
    parts: POLONAISE_NAMES.map(([, contentId, sounding], index) => ({ contentId, index, sounding })),
  },
  groupFacts: Object.fromEntries(POLONAISE_NAMES.map(([, , , work]) => [work, [
    `A fact the corpus authored about ${work.split('/').pop()}, long enough to be a real programme note rather than a label.`,
  ]])),
  facts: ['The polonaise is a Polish processional dance in triple time — walked, not danced.'],
});

/** 200 seconds into the SIXTH polonaise's own file — the Heroic is sounding. */
const POLONAISE_POSITION = 200;

/** The two pieces this frame actually ships, by the name the failure prints. */
const SHIPPED = Object.freeze([
  { piece: "Beethoven's Eroica", data: EROICA_FULL, sounding: 1200 },
  { piece: "Vivaldi's Spring", data: SPRING, sounding: 300 },
]);

/**
 * Every string the band can show, exactly as `CueTicker` derives them — from the
 * PLACED segments (review finding M-7). A segment this recording cannot put on
 * the clock never becomes the sounding segment, so its notes never show and the
 * component never fits against them; passing the authored list instead would
 * make this spec measure strings the band will not paint. Equivalent on both
 * shipped pieces, and wrong the moment a recording has a bad `starts` entry.
 */
const poolsFor = (data) => {
  const raw = bandPools({
    // THE UNION ON A CONTAINER, exactly as `CueTicker` derives it: the piece
    // register's pool follows the sounding work, so what the fit is solved
    // against is every pool it can reach. On a single work the two are the same
    // list, which is why both shipped pieces above are unaffected.
    facts: isComposedContainer(data) ? factPools(data) : data.facts,
    segments: placedSegments(data.pieceSegments).map((p) => p.segment),
    cues: data.cues,
  });
  return { piece: smartQuotesAll(raw.piece), now: smartQuotesAll(raw.now) };
};

/** Segment II is sounding: the longest heading and the longest gloss on the rail. */
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
  const sheets = ['SurroundFrame.scss', 'modules/SegmentMap.scss', 'modules/CueTicker.scss',
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
    content: `${src}\nwindow.__fit = { fitBand, fitStyle, fitPlate, plateStyle, withheldPlate, bandPools, withhold, withheldSets, proseFloorPx, proseCeilingPx, rootWidthOf, PROSE_FLOOR_ANCHOR_PX, PROSE_CEILING_PX, LEADING_FLOOR, LEADING_MAX };`,
  });
  const ok = await page.evaluate(() => typeof window.__fit?.fitBand === 'function'
    && typeof window.__fit?.fitPlate === 'function');
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
  //
  // ...AND THE LABEL FLOOR, which the same observer publishes (design wave 9b).
  // Every ten-foot floor in the frame is an ANGULAR claim, so the frame measures
  // the screen root it fills and publishes `--label-floor`; every module's
  // stylesheet reads it. Emulated here with the SHIPPED function, on the width
  // measured in this page — without it every label on this page would paint at
  // the anchor root's 0.72rem on all three screens, and the floors this spec
  // asserts would be measured against labels no screen actually shows.
  const labelFloor = labelFloorPx(width);
  await page.evaluate(({ footerFloor, labelFloorCss }) => {
    const root = document.querySelector('.surround-frame');
    root.style.setProperty('--label-floor', `${labelFloorCss}px`);
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
  }, { footerFloor: DEFINITION.collapse.footerFloor, labelFloorCss: labelFloor });

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
 * EFFECT 2 — the accordion AND the rail's density, reproduced with the real
 * solvers.
 *
 * `SegmentMap` reads a handful of numbers off the DOM and `band.js` turns them
 * into a density, a floor and a set of widths. Both halves happen here: the
 * numbers are read in the page, every decision on top of them is an imported
 * function, and the result is written back as the markup the component would
 * have rendered.
 *
 * WHAT IS READ WHERE, AND WHY. The rail's FURNITURE comes off the component's
 * own ruler (`__probe`) because that is where the component reads it, and the
 * ruler's reading is checked against a live segment's in the same pass — a ruler
 * that has drifted from the paint is the one failure this arrangement could
 * hide. Each name's single-line WIDTH comes off the rendered headings'
 * `scrollWidth`, which is the same quantity the ruler reports and is available
 * without driving the ruler from the spec (driving it would mean copying the
 * component's title/tempo splitting into this file, which is the class of copy
 * this file exists to abolish).
 *
 * @returns the numbers every decision was made from, so a failure can report them.
 */
async function runAccordion(page) {
  // The DOM READS, and only the DOM reads. Not one of these numbers is combined
  // here; the arithmetic on top of them is imported from the module the
  // component imports it from.
  const measured = await page.evaluate(() => {
    const rule = document.querySelector('.surround-segment-map__rule');
    if (!rule) return null;
    const segs = [...rule.querySelectorAll('.surround-segment-map__segment')];
    const activeIndex = segs.findIndex((s) => s.getAttribute('data-state') === 'active');
    const natural = segs.map((s) => Number(s.getAttribute('data-natural')));
    const railPx = rule.getBoundingClientRect().width;
    const w = (el) => (el ? el.getBoundingClientRect().width : NaN);
    const probeRow = rule.querySelector('.surround-segment-map__probe .surround-segment-map__text-row');
    const probeCell = rule.querySelector('.surround-segment-map__probe .surround-segment-map__text');
    const live = segs[activeIndex >= 0 ? activeIndex : 0];
    const liveCell = live?.querySelector('.surround-segment-map__text');
    return {
      natural,
      activeIndex,
      railPx,
      // The ruler's reading of the rail's furniture, and the paint's.
      chromePx: w(probeRow) - w(probeCell),
      liveChromePx: w(live) - w(liveCell),
      // `scrollWidth` on a `nowrap` + `overflow: hidden` box is the string's
      // full single-line width whatever the box is currently showing.
      needs: segs.map((seg) => {
        const heading = seg.querySelector('.surround-segment-map__heading');
        const gloss = seg.querySelector('.surround-segment-map__translation');
        return Math.max(heading?.scrollWidth ?? 0, gloss?.scrollWidth ?? 0);
      }),
    };
  });
  if (!measured) return null;
  const {
    natural, activeIndex, railPx, chromePx, needs,
  } = measured;

  // THE RAIL'S OWN FLOOR, AND THE DENSITY IT DRIVES — both from `band.js`.
  const floorPx = nameFloorPx(chromePx);
  const widestPx = needs.length
    ? idealWidth({ chromePx, needPx: Math.max(...needs) }) : 0;
  const count = natural.length;
  const roomPx = inactiveRoomPx({ railPx, count, widestPx });
  const chips = railWearsChips({
    railPx, count, widestPx, floorPx,
  });

  // The sounding segment's ideal width, asked about its NATURAL geometry — the
  // width the rail would give it anyway — exactly as the component asks it.
  const desiredPx = activeIndex < 0 ? 0 : soundingWidth({
    naturalPx: (natural[activeIndex] ?? 0) * railPx,
    chromePx,
    needPx: needs[activeIndex] ?? 0,
  });

  const shares = accordionShares({
    natural,
    activeIndex,
    railPx,
    desiredPx,
    floorPx: chips ? SEGMENT_CHIP_FLOOR_PX : floorPx,
  });

  // ...and the render. `renderToStaticMarkup` ran no effects, so the markup on
  // this page is the pre-measurement one: every segment carrying a name. The
  // widths and — on a chipped rail — the chips are applied here.
  // The chip's mark, from the SHIPPED derivation — one notation per rail, and
  // the same table the gutter sets. Every fixture in this file numbers its
  // segments from one, which is what lets the mark be derived from the position.
  const style = numeralStyle(natural.map((_, i) => ({ n: i + 1 })));
  const marks = natural.map((_, i) => numeralText(i + 1, i, style));
  await page.evaluate(({ widths, wearChips, numerals }) => {
    const segs = [...document.querySelectorAll('.surround-segment-map__segment')];
    segs.forEach((seg, i) => {
      seg.style.width = `${widths[i] * 100}%`;
      if (!wearChips || seg.getAttribute('data-state') === 'active') return;
      seg.querySelector('.surround-segment-map__text-row')?.remove();
      const chip = document.createElement('span');
      chip.className = 'surround-segment-map__chip';
      chip.setAttribute('data-testid', 'surround-segment-chip');
      chip.textContent = numerals[i];
      seg.appendChild(chip);
    });
  }, { widths: shares, wearChips: chips, numerals: marks });

  return {
    ...measured, floorPx, widestPx, roomPx, chips, desiredPx, shares, count,
  };
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
      rule: rect('.surround-segment-map__rule'),
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
      // brief asked to be argued rather than assumed. Its pool is per-segment
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
    const floorPx = proseFloorPx(width);
    expect(
      m.fontSize,
      `the note is set at ${m.fontSize}px at ${name}, below the ${floorPx}px prose floor this root `
      + `earns — an x-height of ${(m.fontSize * 0.42).toFixed(2)}px against the `
      + `${(floorPx * 0.42).toFixed(2)}px the floor buys`,
    ).toBeGreaterThanOrEqual(floorPx - 0.01);
    // THE LADDER'S TOP ON THIS ROOT, not the bare constant. Task 6c cut the
    // ceiling 20% and left the floor alone, which puts the two on the wrong side
    // of each other at the 1920 measurement root (floor 21.12px, ceiling
    // 19.2px). `proseCeilingPx` resolves that by rule — the floor wins — and the
    // expected values are written out here rather than recomputed from it.
    const CEILINGS = { '960x540': 19.2, '1280x720': 19.2, '1920x1080': 21.12 };
    expect(
      m.fontSize,
      `the note is set at ${m.fontSize}px at ${name}, louder than the ${CEILINGS[name]}px this `
      + 'root allows — a programme note competing with the work’s own title on the plate',
    ).toBeLessThanOrEqual(CEILINGS[name] + 0.01);
    expect(proseCeilingPx(width), `the ladder's top at ${name}`).toBe(CEILINGS[name]);
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
   * ============================================================================
   * THE FLOOR IS THIS ROOT'S FLOOR — one angular size on three screens.
   * ============================================================================
   *
   * Design wave 9b. The floor used to be one constant, 0.88rem, applied to every
   * root — and a rem is not an angular size. Every surface this frame renders on
   * is a large television read from across a room, and its CSS root width tracks
   * its physical size: the living room gives a 960 root to the same sort of
   * 60-inch panel the office gives a 1280 root to, so a CSS pixel is physically
   * BIGGER there and an identical rem renders bigger. Equal apparent size is
   * `size / root` held constant, which is what this asserts.
   *
   * THE EXPECTED FLOORS ARE WRITTEN OUT, not recomputed from `proseFloorPx`. An
   * assertion that calls the function it is checking is an assertion that cannot
   * fail, and this spec's history includes two of those.
   *
   * TO GO RED: return `PROSE_FLOOR_ANCHOR_PX` unconditionally from
   * `proseFloorPx` — the pre-wave-9b behaviour — and both the living room and
   * the 1920 root report the office's floor.
   */
  const ROOT_FLOORS = Object.freeze({
    '960x540': 10.56,     // the living-room Shield: 0.66rem
    '1280x720': 14.08,    // the office kiosk, and the root every number is anchored to
    '1920x1080': 21.12,   // 1.32rem, and the fleet's high clamp
  });

  it.each(FLEET)('$name — the prose floor is the one this root earns, and the type clears it', async ({ width, height, name }) => {
    const { fit } = await layout(page, css, { width, height, data: EROICA_FULL });
    expect(fit, 'the band was never laid out, so no floor was chosen').not.toBeNull();

    // 1. IT MEASURED THE FRAME, NOT THE WINDOW. On the office PC the two differ
    //    — `ScreenRenderer` letterboxes a fixed 1280 root inside a 1920 panel —
    //    and scaling by the window there would set prose a third too large.
    const frameWidth = await page.evaluate(
      () => document.querySelector('.surround-frame').getBoundingClientRect().width,
    );
    expect(
      fit.rootWidthPx,
      `the fit scaled its floor by ${fit.rootWidthPx}px while the frame it paints in is `
      + `${frameWidth.toFixed(2)}px wide`,
    ).toBeCloseTo(frameWidth, 1);

    // 2. THE FLOOR THIS ROOT EARNS.
    expect(
      fit.floorPx,
      `at ${name} the band was floored at ${fit.floorPx}px where this root earns `
      + `${ROOT_FLOORS[name]}px — ${fit.floorPx > ROOT_FLOORS[name]
        ? 'too high, so notes this screen has room for are refused'
        : 'too low, so prose can be set under the ten-foot floor'}`,
    ).toBe(ROOT_FLOORS[name]);

    // 3. ...AND IT IS THE SAME ANGULAR SIZE AS THE ANCHOR'S. This is the claim
    //    itself rather than a third restatement of the numbers: whatever the
    //    root, the floor subtends what 0.88rem subtends on the office screen.
    expect(
      fit.floorPx / fit.rootWidthPx,
      `the floor is ${(fit.floorPx / fit.rootWidthPx * 1280).toFixed(2)}px of office-root type at `
      + `${name} — the anchor is ${PROSE_FLOOR_ANCHOR_PX}px, so this screen reads a different size`,
    ).toBeCloseTo(PROSE_FLOOR_ANCHOR_PX / FLOOR_ANCHOR_ROOT_PX, 4);

    // 4. AND THE PAINT CLEARS IT — measured on the line the viewer reads, not on
    //    what the fit reported. Stated angularly so that it is ONE readability
    //    claim across three screens: whatever this root is, the prose is at
    //    least as large as 0.88rem is on the office kiosk.
    const m = await noteCut(page);
    const ANGULAR_FLOOR = PROSE_FLOOR_ANCHOR_PX / FLOOR_ANCHOR_ROOT_PX;
    expect(
      m.fontSize,
      `the painted note is ${m.fontSize}px against this root's ${fit.floorPx}px floor`,
    ).toBeGreaterThanOrEqual(fit.floorPx - 0.01);
    expect(
      m.fontSize / frameWidth,
      `the note is painted at ${m.fontSize}px on a ${frameWidth.toFixed(0)}px root — `
      + `${(m.fontSize / frameWidth * FLOOR_ANCHOR_ROOT_PX).toFixed(2)}px of office-root type, under `
      + `the ${PROSE_FLOOR_ANCHOR_PX}px ten-foot floor for prose`,
    ).toBeGreaterThanOrEqual(ANGULAR_FLOOR - 1e-9);
  }, 60000);


  /**
   * ============================================================================
   * ...AND THE LABEL FLOOR RIDES WITH IT — the invariant, as PAINTED.
   * ============================================================================
   *
   * The arithmetic version of this is in `fit.test.js` and sweeps fourteen
   * roots. This is the one that reads pixels: the standing label the band
   * actually paints, on the three screens the fleet actually runs, against the
   * note it stands over.
   *
   * WHY IT EXISTS. `PROSE_FLOOR_ANCHOR_PX` is defined as the LABEL floor plus
   * 22% of x-height, and for one wave the prose floor scaled with the root while
   * the label floor stayed a flat 0.72rem — which inverted the relationship on
   * the living-room root: prose floored at 10.56px under a label set at 11.52px.
   * A stylesheet is where that inversion would actually show, so a stylesheet is
   * where it is measured.
   *
   * TO GO RED: return `LABEL_FLOOR_ANCHOR_PX` unconditionally from
   * `labelFloorPx`, or put a bare `0.72rem` back in any rule that reads
   * `var(--label-floor, …)`.
   */
  const LABEL_FLOORS = Object.freeze({
    '960x540': 8.64,      // 0.54rem
    '1280x720': 11.52,    // 0.72rem — the anchor, and the frame's stated floor
    '1920x1080': 17.28,   // 1.08rem
  });

  it.each(FLEET)('$name — the standing label takes this root’s floor, and prose still clears it', async ({ width, height, name }) => {
    const { fit } = await layout(page, css, { width, height, data: EROICA_FULL });

    const painted = await page.evaluate(() => {
      const head = document.querySelector('.surround-cue-ticker__piece-head');
      const line = document.querySelector('[data-testid="surround-ticker-text"] .surround-cue-ticker__line');
      const px = (el) => (el ? Number(parseFloat(getComputedStyle(el).fontSize).toFixed(2)) : null);
      return {
        label: px(head),
        note: px(line),
        published: getComputedStyle(document.querySelector('.surround-frame'))
          .getPropertyValue('--label-floor').trim(),
      };
    });

    expect(painted.label, 'no standing label in the band to measure').not.toBeNull();
    expect(
      painted.published,
      `the frame published "${painted.published}" as the label floor at ${name}`,
    ).toBe(`${LABEL_FLOORS[name]}px`);
    expect(
      painted.label,
      `the standing label is painted at ${painted.label}px at ${name} where this root earns `
      + `${LABEL_FLOORS[name]}px — ${painted.label > LABEL_FLOORS[name]
        ? 'louder in angle than the same label on the office screen'
        : 'under its own ten-foot floor'}`,
    ).toBe(LABEL_FLOORS[name]);

    // THE INVARIANT ITSELF, on the paint. The note the band sets must never be
    // smaller than the standing label that introduces it — a programme note
    // quieter than the word "PROGRAMME" over it is the derivation upside down.
    expect(
      painted.note,
      `at ${name} the band paints its note at ${painted.note}px under a standing label at `
      + `${painted.label}px — the note is SMALLER than the label over it, which inverts the `
      + 'relationship the prose floor is defined by (+22% of x-height over the label floor)',
    ).toBeGreaterThan(painted.label);

    // ...and the floor it could have fallen to would still have cleared it, which
    // is the stronger claim: not "this corpus happens to fit" but "nothing this
    // band can ever set goes under the label".
    expect(
      fit.floorPx,
      `at ${name} a note pinned at its ${fit.floorPx}px floor would be set under the `
      + `${painted.label}px label over it`,
    ).toBeGreaterThan(painted.label);
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
    // length actually overflows. WAVE 9B MOVED THIS NUMBER, and the case had to
    // be re-sized with it: that root's floor scaled from 0.88rem to 0.66rem, so
    // its NOW register went from holding ~128 characters at the floor to ~248,
    // and the 199-character cue this case used to carry now SETS WHOLE there —
    // measured, not assumed. That is the change working, and a case that no
    // longer refuses anything proves nothing, so the cue is now well past the
    // measured capacity of the register it lands in. (The office root's NOW
    // register holds ~329 at its floor, so this one is refused there too; the
    // case stays on the living room because that is the screen the law bites on
    // for a cue of ordinary length.)
    const OVERLONG = 'The funeral march, and the reason it is the centre of the symphony rather than an '
      + 'interlude: Beethoven puts a death where a minuet had always gone, and the whole shape of '
      + 'the piece changes around it — the hero of the first segment is buried here, and every bar '
      + 'after it is written by somebody who has been to the funeral and come back.';
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
   * Asserted as geometry, over every segment of both shipped pieces and both
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
  const bondCase = async ({ width, height, data, segmentIndex, side, name }) => {
    const withSide = { ...data, definition: { ...DEFINITION, band: { nowSide: side } } };
    const at = data.pieceSegments[segmentIndex].start
      + Math.max(1, ((data.pieceSegments[segmentIndex + 1]?.start ?? data.piece.musicEndsAt)
        - data.pieceSegments[segmentIndex].start) / 2);
    await layout(page, css, { width, height, data: withSide, position: at });
    const b = await bondBoxes(page);
    const where = `${name}, segment ${segmentIndex + 1} at ${Math.round(at)}s, nowSide ${side}`;
    expect(b.segment, `no bond on the rail — ${where}`).not.toBeNull();
    expect(b.panel, `no panel in the register — ${where}`).not.toBeNull();
    expect(Number(b.segment.opacity), `the bond is faded out while a segment is sounding — ${where}`).toBe(1);

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
    data.pieceSegments.forEach((_segment, segmentIndex) => {
      for (const side of ['right', 'left']) {
        cases.push({ ...FLEET[1], piece, data, segmentIndex, side });
      }
    });
    it.each(cases)('segment $segmentIndex, nowSide $side', bondCase, 60000);
  });

  /** ...and at the other two sizes, for the segment most likely to pinch. */
  it.each(FLEET)('$name — the bond still welds along the panel’s whole edge', async ({ width, height, name }) => {
    // Segment I of the Eroica: a third of the rule, far from a right-hand
    // panel — the longest waist the shipped corpus produces, and the case the
    // user was looking at when they found the corner.
    await bondCase({
      width, height, name, data: EROICA_FULL, segmentIndex: 0, side: 'right',
    });
  }, 60000);

  /**
   * NOTHING SOUNDING IS A DESIGNED STATE (design wave 9). Before the first
   * segment — the walk-on, the applause, the settling — and after the last
   * chord, no segment is active, the bond is out on both halves at once, and the
   * NOW register is blank. The band does NOT change height for it.
   *
   * TO GO RED: light the panel with no segment sounding, or let the NOW
   * register borrow a piece fact there (which is what it used to do).
   */
  it.each([
    { when: 'before the first segment starts', position: 20, first: 45 },
    { when: 'after the last segment ends', position: 3000, first: 0 },
  ])('1280x720 — nothing sounding, $when: blank, unlit, and the same height', async ({ position, first }) => {
    const sounding = await layout(page, css, { ...FLEET[1], data: EROICA_FULL, position: 1200 });
    const soundingH = await tickerContentBox(page);
    expect(sounding.fit).not.toBeNull();

    const late = {
      ...EROICA_FULL,
      pieceSegments: EROICA_FULL.pieceSegments.map((m, i) => (i === 0 ? { ...m, start: first } : m)),
    };
    await layout(page, css, { ...FLEET[1], data: late, position });
    const b = await bondBoxes(page);
    const state = await page.evaluate(() => ({
      states: [...document.querySelectorAll('[data-testid="surround-segment"]')]
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
   * THE ACCORDION'S WHOLE PURPOSE. The sounding segment widens until neither
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
        `there is no segment rail on this screen, but the footer is ${footerH}px — above the ${DEFINITION.collapse.footerFloor}px floor, so the collapse rule is not why it is missing`,
      ).toBeLessThan(DEFINITION.collapse.footerFloor);
      return;
    }
    const after = await page.evaluate(() => {
      const segs = [...document.querySelectorAll('.surround-segment-map__segment')];
      return segs.map((s, i) => {
        const heading = s.querySelector('.surround-segment-map__heading');
        const gloss = s.querySelector('.surround-segment-map__translation');
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
   * assertion cannot see: a segment whose heading and gloss ALREADY fit must
   * not widen at all, because every pixel it takes comes off a neighbour that
   * was telling the truth about its duration. `scrollWidth` is an integer and a
   * segment's measured width is not, so a bare `need > cellW` is true by a
   * rounding hair on a box that is not overflowing — which is how this used to
   * quietly compress the whole rail for a name that fitted.
   *
   * Segment I at 1920x1080: "Allegro con brio" and "Fast, with spirit" in a
   * segment a third of a 1251px rule wide. Nothing to open for.
   *
   * TO GO RED: drop the half-pixel threshold from `desiredWidth`.
   */
  it('1920x1080 — a sounding segment whose text already fits takes nothing from its neighbours', async () => {
    await layout(page, css, { ...FLEET[2], position: 100 });
    const solved = await runAccordion(page);
    expect(solved, 'no rail to measure').not.toBeNull();
    expect(solved.activeIndex, 'segment I should be sounding at 100s').toBe(0);
    const naturalPx = solved.natural[0] * solved.railPx;
    expect(
      solved.desiredPx,
      `the accordion wants ${solved.desiredPx}px for a segment whose duration already earns it `
      + `${naturalPx.toFixed(2)}px, with ${solved.chromePx.toFixed(2)}px of furniture around a `
      + `widest line of ${solved.needs[0]}px — it fits, so nothing should open`,
    ).toBe(0);
    expect(solved.chips, 'a four-movement rail on the largest root is not crowded').toBe(false);
    const drift = solved.shares.map((s, i) => Number((s - solved.natural[i]).toFixed(6)));
    expect(
      drift,
      `the rail's rendered widths drifted from their duration-derived shares for a segment that needed no room: ${JSON.stringify(drift)}`,
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

  /* ==========================================================================
     TASK 6C — THE RAIL AT TWENTY-ONE SEGMENTS, AND TWO PANELS THAT SHOUTED
     ========================================================================== */

  /**
   * THE NAME FLOOR, DERIVED — the number `SEGMENT_NAME_RUN_PX` carries, measured
   * rather than restated.
   *
   * The rail's floor for a NAMED segment is its furniture plus a run of type:
   * enough of the name to read as a name rather than as a stripe. Design wave 7
   * swept that against one string ("III. Scherzo. Allegro vivace") and landed on
   * three glyphs and the ellipsis, at 72px total. The criterion is unchanged;
   * what this re-derives is the RUN — the type half of it, on its own — across
   * every name the frame ships, so that a name whose first three glyphs are wide
   * ("Mar…") is not floored on the measurement of one whose first three are
   * narrow ("No.…").
   *
   * IT IS NOT A TAUTOLOGY. Nothing here divides one CSS value by another: the
   * page sets `first three glyphs + ellipsis` in the shipped heading rule, in the
   * vendored face, at the row's own size, and reads the width back. Change the
   * face, the size, the tracking or the ellipsis and the number moves.
   *
   * TO GO RED: set `SEGMENT_NAME_RUN_PX` below the measured maximum, and a rail
   * would floor a segment at a width that shows two glyphs of its name.
   */
  it('1280x720 — the rail’s name floor, derived from the corpus and the real face', async () => {
    await layout(page, css, { ...FLEET[1], data: NOCTURNES, position: NOCTURNE_POSITION });
    const names = [
      ...NOCTURNE_NAMES,
      ...EROICA.pieceSegments.map((m) => m.name),
      ...SPRING.pieceSegments.map((m) => m.name),
    ];
    const swept = await page.evaluate((all) => {
      const heading = document.querySelector('.surround-segment-map__probe .surround-segment-map__heading');
      if (!heading) return null;
      const runs = all.map((name) => {
        // What a floored segment must be able to paint: the ellipsis, and the
        // three glyphs before it that make the mark a name.
        heading.textContent = `${name.slice(0, 3)}…`;
        return { name, px: Number(heading.getBoundingClientRect().width.toFixed(2)) };
      });
      heading.textContent = '';
      return runs;
    }, names);
    expect(swept, 'no ruler on the rail to sweep with').not.toBeNull();

    const widest = swept.reduce((a, b) => (b.px > a.px ? b : a));
    expect(
      SEGMENT_NAME_RUN_PX,
      `the widest three-glyphs-and-an-ellipsis in the shipped corpus is ${widest.px}px `
      + `("${widest.name.slice(0, 3)}…", from "${widest.name}"), and the name run is set to `
      + `${SEGMENT_NAME_RUN_PX}px — a floored segment would show fewer than three glyphs`,
    ).toBeGreaterThanOrEqual(widest.px);
    // ...and not so far above it that the floor is padded rather than derived.
    expect(
      SEGMENT_NAME_RUN_PX - widest.px,
      `the name run is ${(SEGMENT_NAME_RUN_PX - widest.px).toFixed(2)}px above the widest run it `
      + 'has to hold — that is a cushion, not a measurement',
    ).toBeLessThan(2);

    // AND IT DOES NOT UNDERCUT DESIGN WAVE 7'S SWEEP. That sweep read ONE string
    // ("III. Scherzo. Allegro vivace") and landed on 72px, which leaves ~30px of
    // run once the Eroica's furniture is taken out — enough for `Sch…` and not
    // for `Mar…`, its own neighbour. Re-derived across the corpus the floor moves
    // UP, which is the only safe direction: a floor that came out below 72 would
    // mean this derivation shows less of a name than the one it replaces.
    await layout(page, css, { ...FLEET[1], data: EROICA_FULL });
    const eroica = await runAccordion(page);
    expect(
      eroica.floorPx,
      `the Eroica's rail floors its segments at ${eroica.floorPx}px — furniture `
      + `${eroica.chromePx.toFixed(2)}px plus a ${SEGMENT_NAME_RUN_PX}px name run — below the `
      + `${SEGMENT_FLOOR_PX}px design wave 7 swept`,
    ).toBeGreaterThanOrEqual(SEGMENT_FLOOR_PX);
    expect(eroica.floorPx).toBe(Math.ceil(eroica.chromePx + SEGMENT_NAME_RUN_PX));
  }, 90000);

  /**
   * THE RULER AGREES WITH THE PAINT. `SegmentMap` measures the rail's furniture
   * on an out-of-flow probe rather than on a segment, because in chip mode there
   * is no segment carrying a name to measure and because a live segment's box
   * has already been resized by the previous solve. A ruler that has drifted
   * from the thing it measures is the one failure that arrangement could hide.
   *
   * TO GO RED: give `.surround-segment-map__probe` a padding, a font-size or a
   * numeral gutter of its own.
   */
  it.each(FLEET)('$name — the rail’s ruler reports the same furniture the segments carry', async ({ width, height, name }) => {
    await layout(page, css, { width, height, data: EROICA_FULL });
    const solved = await runAccordion(page);
    expect(solved, 'no rail to measure').not.toBeNull();
    expect(
      solved.chromePx,
      `the ruler says a segment's furniture is ${solved.chromePx.toFixed(2)}px and the painted `
      + `segment says ${solved.liveChromePx.toFixed(2)}px at ${name} — every width on this rail is `
      + 'solved from the first number and rendered against the second',
    ).toBeCloseTo(solved.liveChromePx, 1);
  }, 60000);

  /**
   * ==========================================================================
   * THE THRESHOLD — measured available width per inactive segment, never a count
   * ==========================================================================
   *
   * Twenty-one nocturnes on the office rule is ~59px each against names that
   * want ~200px: short by more than a factor of three BEFORE the accordion opens
   * the sounding one. And 21 x this rail's name floor is more rule than any
   * screen in the fleet has, so the floor is not being degraded — it has run
   * out, and the rail has to say so rather than quietly drawing 59px segments
   * that claim to be floored.
   *
   * THE DECISION IS CONTENT-DRIVEN, WHICH IS THE POINT. `widestPx` is the width
   * the widest NAME on this rail asks for, so long titles starve at a count
   * where short ones do not — the same twenty-one segments carrying one-word
   * names would leave far more behind and keep them.
   *
   * TO GO RED: decide the density from `segments.length` against a constant, and
   * the Eroica at 960x540 (four segments, ~890px of rule) lands on the same side
   * of any count threshold as the Eroica at 1920x1080.
   */
  /**
   * WHAT EACH ROOT CAN ACTUALLY HOLD — written out, because the honest answer is
   * not the same on all three and a spec that asserted the guarantee everywhere
   * would be asserting something the arithmetic denies.
   *
   * The rule is the FOOTER's width, not the screen's: the footer takes the
   * measured media box, and the media box is the screen less the programme rail
   * (33%) less the band's own insets. Twenty chips at the 24px chip floor, and
   * what is left for the sounding nocturne's ~250px name:
   *
   *   960x540    ~608px of rule  -  480 = 128px left.  NOT ENOUGH.
   *   1280x720   ~822px of rule  -  480 = 342px left.  Enough.
   *   1920x1080  ~1251px of rule -  480 = 771px left.  Enough.
   *
   * The living room is over capacity for this piece, and the rail says so
   * (`surround.accordion.degraded`, a warn) rather than trimming in silence.
   * The fix for it is the corpus, not the render — twenty-one names that each
   * restate a number the gutter already carries are ~7 characters longer than
   * they need to be. See the task report.
   *
   * TO GO RED: change any of the three numbers by changing the chip floor, the
   * band's insets or the programme rail's share, and the root that flips reports
   * which one it is.
   *
   * `overrunCount` — task 6d, RE-MEASURED after the chip's ring came off and
   * its numeral grew to the label floor: how many of the twenty INACTIVE
   * nocturnes are narrower than the chip that marks them, at each root.
   * ZERO AT EVERY ROOT, including 960 — where the OLD, REM-fixed 20px circle
   * DID overrun (task 6c's own report: narrowest nocturne ~17px against a
   * 20px chip). A bare numeral at the label floor is narrower than that circle
   * ever was, at every root in the fleet, because 960 is also the root the
   * label floor is SMALLEST on (8.64px) — the raise this task makes only bites
   * at 1280 and 1920, where the rail also has more room to give it. See the
   * task report for the measured widths.
   */
  const RAIL_CAPACITY = Object.freeze({
    '960x540': { nameWhole: false, overrunCount: 0 },
    '1280x720': { nameWhole: true, overrunCount: 0 },
    '1920x1080': { nameWhole: true, overrunCount: 0 },
  });

  it.each(FLEET)('$name — twenty-one nocturnes wear chips; four movements keep their names', async ({ width, height, name }) => {
    await layout(page, css, { width, height, data: NOCTURNES, position: NOCTURNE_POSITION });
    const noct = await runAccordion(page);
    expect(noct, 'no rail on the nocturnes at all').not.toBeNull();
    expect(noct.count, 'the rail did not draw all twenty-one nocturnes').toBe(21);
    expect(
      noct.chips,
      `at ${name} the nocturnes' rule is ${noct.railPx.toFixed(1)}px and its widest name wants `
      + `${noct.widestPx}px, which leaves ${noct.roomPx.toFixed(1)}px for each of the twenty other `
      + `segments against a ${noct.floorPx}px name floor — the rail is drawing names it cannot set`,
    ).toBe(true);
    // The threshold's own arithmetic, reported so the number is in the record.
    expect(noct.roomPx).toBeLessThan(noct.floorPx);

    await layout(page, css, { width, height, data: EROICA_FULL });
    const eroica = await runAccordion(page);
    expect(
      eroica.chips,
      `at ${name} the Eroica's four segments each have ${eroica.roomPx.toFixed(1)}px against a `
      + `${eroica.floorPx}px floor, which is room for their names — chipping them throws away a `
      + 'contents page the rail can afford',
    ).toBe(false);
    expect(eroica.roomPx).toBeGreaterThanOrEqual(eroica.floorPx);
  }, 90000);

  /**
   * THE SAME COUNT, TWO DIFFERENT ANSWERS — the case that makes "measured width
   * per inactive segment, never a count" a claim rather than a sentence.
   *
   * Eight segments on the office rule either way. With long titles the sounding
   * one opens wide enough that what is left will not hold a name; with short
   * ones it does not, and the rail keeps its contents page. Nothing about the
   * PIECE changes between the two runs except the strings.
   *
   * TO GO RED: decide the density from `segments.length` against any constant.
   * Both halves of this case have eight segments, so a count threshold either
   * chips both or chips neither.
   */
  it('1280x720 — eight long titles starve where eight short ones do not', async () => {
    const LONG = [
      'Vorspiel und Liebestod aus Tristan und Isolde',
      'Siegfrieds Rheinfahrt aus Götterdämmerung',
      'Waldweben aus Siegfried, zweiter Aufzug',
      'Karfreitagszauber aus Parsifal, dritter Aufzug',
      'Einzug der Gäste auf die Wartburg, Tannhäuser',
      'Wotans Abschied und Feuerzauber, Die Walküre',
      'Isoldes Verklärung, Konzertfassung für Orchester',
      'Trauermarsch aus Götterdämmerung, dritter Aufzug',
    ];
    const SHORT = ['Vorspiel', 'Rheinfahrt', 'Waldweben', 'Parsifal',
      'Einzug', 'Abschied', 'Verklärung', 'Trauermarsch'];
    const eight = (names) => ({
      ...EROICA,
      pieceSegments: names.map((name, i) => ({ n: i + 1, name, start: i * 360 })),
      piece: { ...EROICA.piece, musicEndsAt: 2880 },
      facts: ['A short fact.'],
      cues: [],
    });

    await layout(page, css, { ...FLEET[1], data: eight(LONG), position: 1100 });
    const long = await runAccordion(page);
    await layout(page, css, { ...FLEET[1], data: eight(SHORT), position: 1100 });
    const short = await runAccordion(page);

    expect(
      long.count === 8 && short.count === 8,
      `the two halves of this case do not have the same segment count (${long.count} vs ${short.count})`,
    ).toBe(true);
    expect(
      { long: long.chips, short: short.chips },
      `eight segments on the same ${long.railPx.toFixed(1)}px rule: the long titles leave `
      + `${long.roomPx.toFixed(1)}px each against a ${long.floorPx}px name floor, the short ones `
      + `${short.roomPx.toFixed(1)}px — and the rail treated them the same, so the threshold is `
      + 'not reading the names',
    ).toEqual({ long: true, short: false });
  }, 90000);

  /**
   * ...AND IT IS ALL OR NOTHING, ACROSS THE RAIL. A mix of chips and names reads
   * as a bug, so every segment but the sounding one wears a chip and none of
   * them renders a name at any opacity. A chip is a DIFFERENT THING from a
   * trimmed name: text at zero opacity, or a name clipped to two glyphs, is a
   * rail still pretending to be a contents page.
   *
   * TO GO RED: keep the text row and hide it (`opacity: 0`, `visibility:
   * hidden`, a `text-indent` off the edge) instead of not rendering it.
   */
  it.each(FLEET)('$name — every inactive nocturne wears a chip, and none of them renders a name', async ({ width, height, name }) => {
    await layout(page, css, { width, height, data: NOCTURNES, position: NOCTURNE_POSITION });
    const solved = await runAccordion(page);
    expect(solved.chips, 'the rail is not in chip mode, so this proves nothing').toBe(true);

    const painted = await page.evaluate(() => [...document.querySelectorAll('.surround-segment-map__segment')]
      .map((seg, i) => {
        const chip = seg.querySelector('.surround-segment-map__chip');
        const row = seg.querySelector('.surround-segment-map__text-row');
        const box = chip?.getBoundingClientRect();
        const segBox = seg.getBoundingClientRect();
        return {
          i,
          state: seg.getAttribute('data-state'),
          chip: chip ? chip.textContent : null,
          named: !!row,
          widthPx: Number(segBox.width.toFixed(2)),
          // task 6d: no ring any more — the mark is centred in its bar the same
          // way, but it is bare text, sized off the label floor (see below).
          fontSizePx: chip ? Number(parseFloat(getComputedStyle(chip).fontSize).toFixed(2)) : null,
          centreOffPx: chip
            ? Number((((box.x + box.right) / 2) - ((segBox.x + segBox.right) / 2)).toFixed(2))
            : null,
          chipW: chip ? Number(box.width.toFixed(2)) : null,
        };
      }));

    const active = painted.filter((p) => p.state === 'active');
    expect(active, 'no nocturne is sounding at 2700s — the rail and the clock disagree').toHaveLength(1);
    expect(active[0].named, 'the SOUNDING segment lost its name to a chip').toBe(true);
    expect(active[0].chip, 'the sounding segment wears a chip as well as its name').toBeNull();

    const inactive = painted.filter((p) => p.state !== 'active');
    expect(
      inactive.filter((p) => p.named),
      `${inactive.filter((p) => p.named).length} of the twenty inactive nocturnes are still `
      + `rendering a name at ${name}, so the rail is showing chips AND names`,
    ).toEqual([]);
    expect(
      inactive.filter((p) => p.chip === null),
      'an inactive segment wears neither a name nor a chip — it is an unlabelled stripe',
    ).toEqual([]);
    // The mark agrees with the gutter's: one notation per rail, and a rail of
    // twenty-one cannot be Roman.
    expect(inactive.map((p) => p.chip)).not.toContain('XIII');
    expect(painted[12].chip ?? '13').toBe('13');
    inactive.forEach((p) => {
      expect(
        Math.abs(p.centreOffPx),
        `chip ${p.i} sits ${p.centreOffPx}px off the centre of its own bar`,
      ).toBeLessThanOrEqual(0.6);
    });

    /**
     * =========================================================================
     * THE CHIP'S NUMERAL MEETS THE TEN-FOOT LABEL FLOOR — task 6d.
     * =========================================================================
     * The owner's report, watching the office screen: the numbers in the chips
     * were hard to read. The chip's mark is a LABEL exactly as the standing
     * band labels and the rail's own gutter numeral are — short, tracked,
     * small-caps, read as a shape — so it takes the same published floor they
     * do (`--label-floor`, `labelFloorPx` in `fit.js`) rather than a size
     * invented for it. This is the assertion the owner's complaint becomes.
     *
     * TO GO RED: put a rem literal back on `.surround-segment-map__chip`
     * (`font-size: 0.62rem` was the pre-fix value — 9.92px, under the floor at
     * both the office's 11.52px and the living room's 17.28px), or read a
     * DIFFERENT custom property than the one every other label in the frame
     * reads.
     */
    inactive.forEach((p) => {
      expect(
        p.fontSizePx,
        `chip ${p.i}'s numeral paints at ${p.fontSizePx}px at ${name}, where this root's `
        + `ten-foot label floor is ${LABEL_FLOORS[name]}px — the number in the circle is smaller `
        + 'than the frame\'s own floor for a label',
      ).toBe(LABEL_FLOORS[name]);
    });

    // ...AND THE CHIPS DO NOT OVERRUN THE SEGMENTS THEY MARK. A chip wider than
    // its own segment is two chips touching, which is the thing the chip floor
    // exists to stop — and it is the same capacity question the name guarantee
    // asks, one storey down, so it has the same per-root answer (see
    // `RAIL_CAPACITY`). Task 6d raised the mark's own size to the label floor
    // and, in the same change, dropped the ring around it — a bare numeral at
    // the label floor is narrower than the old REM-fixed circle at every root
    // in the fleet, including the one (1920) where the floor asks the most of
    // it, so the honest capacity answer did not get WORSE for the raise.
    const overrun = inactive.filter((p) => p.widthPx < p.chipW - 0.5);
    expect(
      overrun.length,
      `${overrun.length} of the twenty chips are wider than the segment they mark at ${name} `
      + `(narrowest segment ${Math.min(...inactive.map((p) => p.widthPx)).toFixed(2)}px against a `
      + `${inactive[0].chipW}px chip)`,
    ).toBe(RAIL_CAPACITY[name].overrunCount);
  }, 90000);

  /**
   * ==========================================================================
   * THE GUARANTEE: THE SOUNDING SEGMENT'S NAME IS WHOLE. ALWAYS.
   * ==========================================================================
   *
   * Not a best effort. The accordion opens the sounding segment to the width its
   * own text needs, and chip mode is what buys that width on a rail where the
   * name floor cannot be met — 21 x 77px of name floor is more rule than the
   * office screen has, so with names the accordion has nothing to donate and the
   * name can never be whole.
   *
   * TO GO RED: pass `floorPx: floorPx` (the name floor) to `accordionShares`
   * regardless of density — the neighbours are then already under their floor,
   * `available` is zero, and the sounding nocturne stays at its ~59px natural
   * width with 80% of its name cut off.
   */
  it.each(FLEET)('$name — the sounding nocturne shows its whole name, and no chip goes under the chip floor', async ({ width, height, name }) => {
    await layout(page, css, { width, height, data: NOCTURNES, position: NOCTURNE_POSITION });
    const solved = await runAccordion(page);
    expect(solved.chips, 'this case is about a chipped rail').toBe(true);

    const after = await page.evaluate(() => [...document.querySelectorAll('.surround-segment-map__segment')]
      .map((seg, i) => {
        const heading = seg.querySelector('.surround-segment-map__heading');
        const gloss = seg.querySelector('.surround-segment-map__translation');
        return {
          i,
          state: seg.getAttribute('data-state'),
          widthPx: Number(seg.getBoundingClientRect().width.toFixed(2)),
          text: heading ? heading.textContent : null,
          headingCut: heading ? heading.scrollWidth - heading.clientWidth : 0,
          glossCut: gloss ? gloss.scrollWidth - gloss.clientWidth : 0,
          wraps: heading
            ? Math.round(heading.getBoundingClientRect().height / parseFloat(getComputedStyle(heading).lineHeight))
            : 1,
        };
      }));

    const active = after.find((s) => s.state === 'active');
    expect(
      active.wraps,
      `the sounding nocturne's name wrapped to ${active.wraps} lines — the rail is one line`,
    ).toBe(1);

    const whole = active.headingCut === 0 && active.glossCut === 0;
    expect(
      whole,
      `the sounding nocturne "${active.text}" is ${active.widthPx}px wide at ${name}, solved for `
      + `${solved.desiredPx}px on a ${solved.railPx.toFixed(1)}px rule with a `
      + `${SEGMENT_CHIP_FLOOR_PX}px chip floor under its twenty neighbours, and its heading is `
      + `${whole ? 'whole' : `cut by ${active.headingCut}px`}`,
    ).toBe(RAIL_CAPACITY[name].nameWhole);

    if (RAIL_CAPACITY[name].nameWhole) {
      // ...and it got there by DONATION, not by luck: the neighbours that had
      // slack gave it up and stopped at the floor.
      const donors = after.filter((s) => s.state !== 'active');
      expect(
        donors.filter((s) => s.widthPx < SEGMENT_CHIP_FLOOR_PX - 0.5
          && s.widthPx < solved.natural[s.i] * solved.railPx - 0.5),
        'a neighbour was compressed under the chip floor to pay for the name',
      ).toEqual([]);
    } else {
      // THE REPORTABLE CONDITION, not a silent truncation. The component warns
      // (`surround.accordion.degraded`); what this asserts is that the state the
      // warn describes is the state the rail is actually in — the name was
      // refused because there was nothing left to take, not because the solve
      // declined to ask.
      const granted = (solved.shares[solved.activeIndex] ?? 0) * solved.railPx;
      expect(
        solved.desiredPx,
        'the rail did not even ask for the width it needed',
      ).toBeGreaterThan(granted);
      const spare = solved.shares.reduce((sum, sh, i) => (i === solved.activeIndex ? sum
        : sum + Math.max(0, sh * solved.railPx - SEGMENT_CHIP_FLOOR_PX)), 0);
      expect(
        Number(spare.toFixed(1)),
        `the sounding nocturne was starved while ${spare.toFixed(1)}px of donatable width was `
        + `still sitting in its neighbours at ${name}`,
      ).toBeLessThan(1);
    }
  }, 90000);

  /**
   * ==========================================================================
   * THE PANELS, AFTER TASK 6C — quieter, tighter, and off the bottom edge.
   * ==========================================================================
   *
   * Four changes, all measured on the paint rather than read back out of the
   * stylesheet that made them:
   *
   *   1. the note's SIZE comes down 20% at the ceiling (the floor is untouched);
   *   2. its LEADING stops at the face's own `line-height: normal` (1.30) rather
   *      than above it;
   *   3. both registers get a foot, so the last line is not on the band's edge;
   *   4. the ink sits back into the ground at 60-70% instead of reading as white.
   *
   * TO GO RED: restore `PROSE_CEILING_PX = 24`; restore `LEADING_MAX = 1.35`;
   * drop `--zone-pad-bottom`; put `opacity: 1` back on the note.
   */
  it.each(FLEET)('$name — the band’s panels are quieter, tighter, and clear of the floor', async ({ width, height, name }) => {
    const { fit } = await layout(page, css, { width, height, data: EROICA_FULL });
    const m = await noteCut(page);

    // 1. THE SIZE. The ladder's top on this root, and the paint under it.
    const CEILINGS = { '960x540': 19.2, '1280x720': 19.2, '1920x1080': 21.12 };
    expect(fit.ceilingPx, `the ladder's top at ${name}`).toBe(CEILINGS[name]);
    expect(
      m.fontSize,
      `the note is painted at ${m.fontSize}px at ${name}, over this root's ${CEILINGS[name]}px top`,
    ).toBeLessThanOrEqual(CEILINGS[name] + 0.01);
    expect(m.fontSize, 'and still at or above the readability floor')
      .toBeGreaterThanOrEqual(fit.floorPx - 0.01);

    // 2. THE LEADING. EB Garamond's own `line-height: normal` is 1.31, so the
    //    loose end of the ladder now stops at the face's metrics.
    expect(
      m.leading,
      `the note is leaded at ${m.leading} at ${name} — looser than the 1.30 the compacting set`,
    ).toBeLessThanOrEqual(1.30 + 0.001);
    expect(m.leading, 'and never under the measured floor').toBeGreaterThanOrEqual(LEADING_FLOOR - 0.001);

    // 3. THE FOOT. Measured as the run of band between the last line of each
    //    register and the panel's own bottom edge — the thing the owner saw.
    const feet = await page.evaluate(() => ['piece', 'now'].map((key) => {
      const zone = document.querySelector(`[data-testid="surround-ticker-zone-${key}"]`);
      if (!zone) return null;
      const box = zone.querySelector('.surround-cue-ticker__text');
      const pad = parseFloat(getComputedStyle(zone).paddingBottom);
      return {
        zone: key,
        padPx: Number(pad.toFixed(2)),
        clearPx: Number((zone.getBoundingClientRect().bottom
          - box.getBoundingClientRect().bottom).toFixed(2)),
      };
    }).filter(Boolean));
    expect(feet.length, 'the band did not split into two registers').toBe(2);
    feet.forEach((f) => {
      expect(
        f.padPx,
        `the ${f.zone} register has ${f.padPx}px of foot at ${name} — it is on the band's edge`,
      ).toBeGreaterThanOrEqual(6);
      expect(f.clearPx).toBeCloseTo(f.padPx, 1);
    });

    // 4. THE INK. Composited at its own opacity over the ground each register is
    //    painted on, and reported as a contrast ratio — because "65% of the
    //    current ink" is not a legibility claim and a ratio is.
    const contrast = await page.evaluate(() => {
      const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
      const rgb = (s) => s.match(/[\d.]+/g).slice(0, 3).map(Number);
      const lum = ([r, g, b]) => 0.2126 * lin(r / 255) + 0.7152 * lin(g / 255) + 0.0722 * lin(b / 255);
      const ratio = (a, b) => {
        const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
        return (hi + 0.05) / (lo + 0.05);
      };
      const over = (fg, bg, alpha) => fg.map((c, i) => bg[i] + (c - bg[i]) * alpha);

      const line = document.querySelector('[data-testid="surround-ticker-text"] .surround-cue-ticker__line');
      const box = line.closest('.surround-cue-ticker__text');
      const ink = rgb(getComputedStyle(line).color);
      const alpha = Number(getComputedStyle(box).opacity);
      // The two grounds this register is ever painted on: the band's own, and
      // the bond's lit panel when the NOW register is bonded.
      const band = rgb(getComputedStyle(document.querySelector('.surround-frame__region--bottom')).backgroundColor);
      const panel = rgb(getComputedStyle(document.querySelector('[data-testid="surround-ticker-ground"]')).backgroundColor);
      return {
        alpha,
        full: Number(ratio(ink, panel).toFixed(2)),
        onPanel: Number(ratio(over(ink, panel, alpha), panel).toFixed(2)),
        onBand: Number(ratio(over(ink, band, alpha), band).toFixed(2)),
      };
    });

    expect(
      contrast.alpha,
      `the note's ink is at ${contrast.alpha} — the owner asked for 60-70% so it sits back into `
      + 'the ground instead of shouting off it',
    ).toBeGreaterThanOrEqual(0.6);
    expect(contrast.alpha).toBeLessThanOrEqual(0.7);
    // ...AND IT IS STILL READABLE AT TEN FEET, which is the thing the percentage
    // does not say on its own. 4.5:1 is the body-text bar; report the number
    // either way so the trade is on the record rather than assumed.
    expect(
      contrast.onPanel,
      `at ${name} the note reads ${contrast.onPanel}:1 against the lit bond panel (it was `
      + `${contrast.full}:1 at full strength) — under the 4.5:1 a body size needs`,
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast.onBand,
      `at ${name} the note reads ${contrast.onBand}:1 against the band's own ground`,
    ).toBeGreaterThanOrEqual(4.5);
  }, 90000);
  /**
   * ============================================================================
   * THE PLATE, ON A CONTAINER — measured
   * ============================================================================
   *
   * The one surface this wave changed that no arithmetic can check: the plate's
   * headline is now a SEGMENT name, its type is sized by a search whose every
   * step is a measurement, and the cap it is measured against is
   * `86% of the MEASURED video` — a value that only becomes a length once the
   * frame has measured the media box. All three of those are layout, so all
   * three are asserted here, in Chromium, against the compiled stylesheet and
   * the vendored Cormorant.
   *
   * EFFECT 5 — `WorkPlacard`'s fit, reproduced by calling it, exactly as the
   * ticker's is above: the component solves `fitPlate(root, names)` in a layout
   * effect and publishes what it returns as one custom property, and both
   * halves happen here with the SAME functions.
   */
  describe('the polonaise season — the plate names what is playing', () => {
    const plateAt = async ({ width, height, position }) => {
      await layout(page, css, { width, height, data: POLONAISES, position });
      return page.evaluate(({ names }) => {
        const root = document.querySelector('[data-testid="surround-work-placard"]');
        if (!root) return { error: 'no plate' };
        const solved = window.__fit.fitPlate(root, names);
        if (solved) {
          const style = window.__fit.plateStyle(solved);
          Object.entries(style).forEach(([k, v]) => root.style.setProperty(k, v));
        }
        const title = root.querySelector('[data-testid="surround-placard-title"]');
        const set = root.querySelector('[data-testid="surround-placard-set"]');
        const px = (el) => Number(el.getBoundingClientRect().height.toFixed(2));
        return {
          fit: solved && {
            fontPx: solved.fontPx, availPx: solved.availPx, rejected: solved.rejected.length,
          },
          title: title.textContent,
          set: set?.textContent ?? null,
          // `scrollWidth` on a `nowrap` + `overflow: hidden` box is the string's
          // full single-line width whatever the box is currently showing, so
          // this is the ellipsis, measured.
          cutPx: Number((title.scrollWidth - title.clientWidth).toFixed(2)),
          plateHeight: px(root),
          titleHeight: px(title),
          setHeight: set ? px(set) : null,
          plateWidth: Number(root.getBoundingClientRect().width.toFixed(2)),
        };
      }, { names: POLONAISES.segments.map((m) => smartQuotes(m.name)) });
    };

    /**
     * TO GO RED: headline `piece.title` — the plate reads "Polonaises" for
     * fifty-nine minutes and names none of the seven works it plays.
     */
    it.each(FLEET)('$name — headlines the sounding polonaise, over the set', async ({ width, height }) => {
      const plate = await plateAt({ width, height, position: POLONAISE_POSITION });
      expect(plate.title).toBe('Polonaise in A-flat major, Op. 53');
      expect(plate.set).toBe('Chopin’s Polonaises·6 of 7');
    }, 60000);

    /**
     * THE CAP IS A LENGTH BY THE TIME THE FIT ASKS. Until the frame publishes
     * `--surround-media-w` the plate's `max-width` computes to a PERCENTAGE,
     * and reading "86%" as 86 pixels would refuse every name on the rail. The
     * fit declines to answer in that state and the component retries; this
     * asserts that the answer, once it comes, is measured against the real cap.
     *
     * TO GO RED: drop the `px` guard in `plateZone` — `availPx` comes back at
     * 22 (86 minus the plate's padding) and every name is rejected.
     */
    it.each(FLEET)('$name — measures against the video’s cap, and sets every name whole', async ({ width, height }) => {
      const plate = await plateAt({ width, height, position: POLONAISE_POSITION });
      expect(plate.fit, 'the plate was never fitted at all').not.toBeNull();
      expect(
        plate.fit.availPx,
        `the plate was fitted against ${plate.fit.availPx}px of cap on a ${width}px root — `
        + 'the cap was read before the video was measured',
      ).toBeGreaterThan(width * 0.4);
      expect(
        plate.fit.rejected,
        `the fit refused ${plate.fit.rejected} of the seven polonaise names at `
        + `${plate.fit.fontPx}px against ${plate.fit.availPx}px`,
      ).toBe(0);
      // ...and nothing is cut on the screen, which is the claim the fit exists
      // to make good. `cutPx` is the string's own width minus the box it was
      // given: zero is the law.
      expect(
        plate.cutPx,
        `the headline overflows its box by ${plate.cutPx}px at ${plate.fit.fontPx}px — `
        + 'the ellipsis is doing the fit\'s job',
      ).toBeLessThanOrEqual(0);
    }, 60000);

    /**
     * THE RESERVED-HEIGHT LAW, on the plate. The type is solved against every
     * name on the rail, so it is a constant of the SET; the set line is
     * rendered blank rather than removed where nothing is sounding. Both
     * together mean the plate is exactly as tall in the sixth polonaise, in the
     * first, and in the applause between two of them.
     *
     * TO GO RED: make the set line conditional on there being a segment, or fit
     * the plate to the sounding name alone — the plate's height then changes
     * between the three states below.
     */
    it('1280x720 — the plate does not change height as the set moves', async () => {
      const heights = [];
      // The sixth polonaise, the first polonaise, and the dead time after the
      // sixth has finished (its own file runs 449s; 600 is past the end).
      for (const position of [POLONAISE_POSITION, 100, 600]) {
        // eslint-disable-next-line no-await-in-loop
        heights.push(await plateAt({ width: 1280, height: 720, position }));
      }
      const [sounding, first, dead] = heights;
      expect(first.plateHeight, `${first.plateHeight} against ${sounding.plateHeight}`)
        .toBe(sounding.plateHeight);
      expect(
        dead.plateHeight,
        `the plate is ${dead.plateHeight}px tall with nothing sounding and `
        + `${sounding.plateHeight}px with the Heroic playing — the set line was removed rather `
        + 'than blanked',
      ).toBe(sounding.plateHeight);
      // The blank line is BLANK, not absent: same box, no words.
      expect(dead.setHeight).toBe(sounding.setHeight);
      expect(dead.set.trim()).toBe('');
      expect(dead.title).toBe('Polonaises');
    }, 90000);

    /**
     * AND THE EROICA'S PLATE IS UNTOUCHED — the regression this wave promised,
     * in pixels rather than in markup. A single work has no set line and no
     * fitted type, so its plate is the plate that shipped.
     */
    it.each(FLEET)('$name — a single work’s plate carries no set line', async ({ width, height }) => {
      await layout(page, css, { width, height, data: EROICA_FULL, position: 1200 });
      const plate = await page.evaluate(() => {
        const root = document.querySelector('[data-testid="surround-work-placard"]');
        const title = root.querySelector('[data-testid="surround-placard-title"]');
        return {
          set: root.querySelector('[data-testid="surround-placard-set"]'),
          probe: root.querySelector('.surround-work-placard__probe'),
          title: title.textContent,
          fontPx: Number(parseFloat(getComputedStyle(title).fontSize).toFixed(2)),
          lineHeightPx: Number(parseFloat(getComputedStyle(title).lineHeight).toFixed(2)),
        };
      });
      expect(plate.set, 'a single work grew a set line').toBeNull();
      expect(plate.probe, 'a single work grew a ruler nothing measures').toBeNull();
      expect(plate.title).toBe('Symphony No. 3 in E-flat major, “Eroica”');
      // 2.05rem at the frame's 16px root, and a line box of 1.12 of it — the
      // two numbers the stylesheet has set since design wave 4, unchanged by
      // the ceiling and the reserve this wave expressed them through.
      expect(plate.fontPx).toBe(32.8);
      expect(plate.lineHeightPx).toBeCloseTo(32.8 * 1.12, 1);
    }, 60000);
  });
});
