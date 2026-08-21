import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import * as sass from 'sass-embedded';
import SegmentMap from './SegmentMap.jsx';
import { ACCORDION_MS } from '../band.js';
import { LABEL_FLOOR_ANCHOR_PX } from '../fit.js';

/**
 * The gloss's size in rem AT THE ANCHOR ROOT, read out of the compiled rule.
 *
 * It is no longer a literal. The frame's ten-foot label floor is measured per
 * screen root and published as `--label-floor` (design wave 9b), and this gloss
 * is defined as a fixed step above it — `calc(var(--label-floor, 11.52px) * 74 /
 * 72)` — so that the step survives the scaling instead of inverting on the
 * narrower root. What the arithmetic below needs is a number, so the FALLBACK is
 * resolved: that is the anchor root's floor, which is the root every one of
 * these derivations was solved on.
 */
function glossRemFrom(rule) {
  const m = rule.match(/font-size:\s*calc\(var\(--label-floor,\s*([\d.]+)px\)\s*\*\s*(\d+)\s*\/\s*(\d+)\)/);
  expect(m, `the gloss no longer reads the published label floor: ${rule.match(/font-size:[^;]*/)?.[0]}`)
    .not.toBeNull();
  expect(Number(m[1]), 'the sheet\'s fallback drifted from the anchor floor')
    .toBe(LABEL_FLOOR_ANCHOR_PX);
  return (Number(m[1]) * Number(m[2])) / Number(m[3]) / 16;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const makeLogger = () => ({
  debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), sampled: vi.fn(),
});

// The Eroica, measured: 4 segments, 3223 s of file, music ends at ~2955 s and
// the remaining 4½ minutes are applause.
const EROICA = {
  contentId: 'plex:663134',
  piece: { title: 'Symphony No. 3', musicEndsAt: 2955 },
  pieceSegments: [
    { n: 1, name: 'Allegro con brio', start: 0, translation: 'Fast, with spirit' },
    { n: 2, name: 'Marcia funebre. Adagio assai', start: 976, translation: 'Funeral march — very slow' },
    // Deliberately unauthored — the absent-field case, asserted below.
    { n: 3, name: 'Scherzo. Allegro vivace', start: 1925 },
    { n: 4, name: 'Finale. Allegro molto', start: 2278, translation: 'Finale — very fast' },
  ],
};
const DURATION = 3223;

const renderMap = (props = {}) => render(
  <SegmentMap
    position={props.position ?? 0}
    duration={props.duration ?? DURATION}
    playing={props.playing ?? true}
    seeking={props.seeking ?? false}
    data={props.data === undefined ? EROICA : props.data}
    region={props.region ?? { module: 'segment-map', height: 60 }}
    logger={props.logger ?? makeLogger()}
  />,
);

const widths = (container) =>
  [...container.querySelectorAll('[data-testid="surround-segment"]')]
    .map((el) => parseFloat(el.style.width));

const states = (container) =>
  [...container.querySelectorAll('[data-testid="surround-segment"]')]
    .map((el) => el.getAttribute('data-state'));

/**
 * How full each segment's rule reads, in percent.
 *
 * Design wave 5 moved the fill from `width: N%` to `transform: scaleX(--fill)`
 * — the stylesheet explains why (a painted box's size is pixel-snapped, a
 * transform's is not, and at a segment-per-few-hundred-pixels that is the
 * difference between a glide and a crawl). The FRACTION the component computes
 * is unchanged; only where it is published moved, so these specs read the
 * custom property the same way they used to read the width.
 */
const fills = (container) =>
  [...container.querySelectorAll('[data-testid="surround-segment-fill"]')]
    .map((el) => parseFloat(el.style.getPropertyValue('--fill')) * 100);

/** Where the cursor is, in percent — see `fills` above for the property move. */
const headPct = (el) => parseFloat(el.style.getPropertyValue('--head')) * 100;

describe('SegmentMap', () => {
  it('lays out segments proportional to each segment’s real duration', () => {
    // musicEndsAt 2955 → span 2955; lengths 976 / 949 / 353 / 677.
    const { container } = renderMap();
    const w = widths(container);
    expect(w).toHaveLength(4);
    expect(w[0]).toBeCloseTo((976 / 2955) * 100, 3);
    expect(w[1]).toBeCloseTo((949 / 2955) * 100, 3);
    expect(w[2]).toBeCloseTo((353 / 2955) * 100, 3);
    expect(w[3]).toBeCloseTo((677 / 2955) * 100, 3);
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 6);
  });

  it('ends the last bar at musicEndsAt, not at duration', () => {
    const withApplause = { ...EROICA, piece: { title: 'Symphony No. 3' } }; // no musicEndsAt
    const shortened = widths(renderMap().container)[3];
    const toEndOfFile = widths(renderMap({ data: withApplause }).container)[3];
    // Running to duration would show 945 s of "still playing" that is applause.
    expect(toEndOfFile).toBeCloseTo((945 / 3223) * 100, 3);
    expect(shortened).toBeCloseTo((677 / 2955) * 100, 3);
    expect(shortened).toBeLessThan(toEndOfFile);
  });

  /**
   * Fix round 1 (review finding I4). `musicEndsAt` used to be tested with the
   * raw `Number.isFinite` — always false on a string, since YAML round-trips
   * can hand this field back as text (`"613"`) rather than a number. The
   * uncoerced read fell through to `duration` silently, drawing the rule over
   * the applause; `CueTicker` already coerced the same field, so the two
   * halves of the band could disagree about where the music stopped. This is
   * the same reading, applied here too.
   */
  it('coerces a string musicEndsAt instead of falling back to duration', () => {
    const stringEnd = { ...EROICA, piece: { title: 'Symphony No. 3', musicEndsAt: '613' } };
    const w = widths(renderMap({ data: stringEnd, duration: 3223 }).container);
    // Span becomes 613 (not 3223): only segment 1 (start 0) fits inside it,
    // and its width reads against that shorter span.
    expect(w[0]).toBeCloseTo((613 / 613) * 100, 3);
  });

  it('falls back to duration when the piece declares no musicEndsAt', () => {
    const noEnd = { ...EROICA, piece: { title: 'Symphony No. 3' } };
    const w = widths(renderMap({ data: noEnd }).container);
    expect(w[0]).toBeCloseTo((976 / 3223) * 100, 3);
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 6);
  });

  it('marks segment 2 active at position 976', () => {
    const { container } = renderMap({ position: 976 });
    expect(states(container)).toEqual(['elapsed', 'active', 'future', 'future']);
  });

  it('keeps segment 1 active one second before the next segment starts', () => {
    const { container } = renderMap({ position: 975 });
    expect(states(container)).toEqual(['active', 'future', 'future', 'future']);
  });

  it('treats every segment as elapsed once the music has ended', () => {
    const { container } = renderMap({ position: 3100 }); // in the applause
    expect(states(container)).toEqual(['elapsed', 'elapsed', 'elapsed', 'elapsed']);
  });

  it('moves the playhead in the same render as a seek', () => {
    const { container, rerender } = renderMap({ position: 0 });
    const head = () => container.querySelector('[data-testid="surround-playhead"]');
    expect(headPct(head())).toBeCloseTo(0, 6);

    rerender(
      <SegmentMap
        position={1477}
        duration={DURATION} playing seeking={false}
        data={EROICA} region={{ module: 'segment-map' }} logger={makeLogger()}
      />,
    );
    expect(headPct(head())).toBeCloseTo((1477 / 2955) * 100, 3);
  });

  it('clamps the playhead to the end of the rule during the applause', () => {
    const { container } = renderMap({ position: 3200 });
    expect(headPct(container.querySelector('[data-testid="surround-playhead"]')))
      .toBeCloseTo(100, 6);
  });

  // Design wave 2: ONE quiet separator, not a double barline. Correct notation,
  // too much ink at this size — four segments of doubled rule read as clutter.
  it('separates segments with one quiet barline — one fewer than the segments', () => {
    const { container } = renderMap();
    expect(container.querySelectorAll('.surround-segment-map__barline--separator')).toHaveLength(3);
    expect(container.querySelectorAll('.surround-segment-map__barline--double')).toHaveLength(0);
  });

  it('renders a single segment with no separator at all', () => {
    const solo = { contentId: 'x', piece: {}, pieceSegments: [{ n: 1, name: 'Allegro', start: 0 }] };
    const { container } = renderMap({ data: solo, duration: 600 });
    expect(container.querySelectorAll('[data-testid="surround-segment"]')).toHaveLength(1);
    expect(container.querySelectorAll('.surround-segment-map__barline--separator')).toHaveLength(0);
  });

  it('sets the tempo term apart from the segment title, as an engraved score does', () => {
    const { container } = renderMap();
    const segs = [...container.querySelectorAll('[data-testid="surround-segment"]')];
    // "Marcia funebre. Adagio assai" → title roman, tempo italic.
    expect(segs[1].querySelector('.surround-segment-map__title')).toHaveTextContent('Marcia funebre.');
    expect(segs[1].querySelector('.surround-segment-map__tempo')).toHaveTextContent('Adagio assai');
    // A bare tempo marking is all italic — there is no title half.
    expect(segs[0].querySelector('.surround-segment-map__title')).toBeNull();
    expect(segs[0].querySelector('.surround-segment-map__tempo')).toHaveTextContent('Allegro con brio');
  });

  it('numbers segments with roman numerals from `n`', () => {
    const { container } = renderMap();
    const numerals = [...container.querySelectorAll('.surround-segment-map__numeral')]
      .map((el) => el.textContent);
    expect(numerals).toEqual(['I.', 'II.', 'III.', 'IV.']);
  });

  it('renders nothing and does not throw when there are no segments', () => {
    let result;
    expect(() => { result = renderMap({ data: { contentId: 'x', piece: {}, pieceSegments: [] } }); }).not.toThrow();
    expect(result.container.innerHTML).toBe('');
  });

  it('renders nothing when the payload is missing entirely', () => {
    const { container } = renderMap({ data: null, duration: 0 });
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when the duration is not known yet', () => {
    const noEnd = { ...EROICA, piece: {} };
    const { container } = renderMap({ data: noEnd, duration: 0 });
    expect(container.innerHTML).toBe('');
  });

  // -------------------------------------------------------------------------
  // Design wave 2: progress is read from the FILL, not from the cursor.
  // -------------------------------------------------------------------------

  it('sweeps the sounding segment’s rule from its own start, not the piece’s', () => {
    // 1450s is 474s into segment II (976→1925 = 949s long).
    const { container } = renderMap({ position: 1450 });
    const f = fills(container);
    expect(f).toHaveLength(4);
    expect(f[0]).toBeCloseTo(100, 6);                       // done
    expect(f[1]).toBeCloseTo((474 / 949) * 100, 3);         // sounding
    expect(f[2]).toBeCloseTo(0, 6);                         // still to come
    expect(f[3]).toBeCloseTo(0, 6);
  });

  it('starts the sounding segment’s fill at zero on its first second', () => {
    const { container } = renderMap({ position: 976 });
    expect(fills(container)[1]).toBeCloseTo(0, 6);
  });

  it('reads every segment as fully filled once the music has ended', () => {
    const { container } = renderMap({ position: 3100 });      // in the applause
    expect(fills(container)).toEqual([100, 100, 100, 100]);
  });

  // BEFORE THE FIRST NOTE IS NOT AFTER THE LAST ONE. A position ahead of the
  // first segment's start — clock skew at the top of a file, or a recording
  // whose transfer opens on tuning (`starts: [45, …]`, which the store
  // explicitly permits) — used to fall through to "segment I is active", so
  // the rail lit a segment over music that had not begun while the listening
  // band six inches below printed its "nothing is playing" header. Both halves
  // now read the same derivation, and it says nothing is sounding: every
  // segment future, no fill, no bond.
  it('leaves the whole rule unsounded before the first segment starts', () => {
    const { container } = renderMap({ position: -0.5 });
    const states = [...container.querySelectorAll('[data-testid="surround-segment"]')]
      .map((el) => el.getAttribute('data-state'));
    expect(states).toEqual(['future', 'future', 'future', 'future']);
    expect(fills(container)).toEqual([0, 0, 0, 0]);
    expect(container.querySelector('[data-testid="surround-bond"]').getAttribute('data-bonded'))
      .toBe('false');
  });

  // The lit tip was the "glowing worm" the design review killed. Its absence is
  // asserted, not merely uncommented: an element is easy to reintroduce.
  it('has no lit playhead tip — the cursor is one plain hairline', () => {
    const { container } = renderMap({ position: 1450 });
    expect(container.querySelector('.surround-segment-map__playhead-edge')).toBeNull();
    expect(container.querySelector('[data-testid="surround-playhead"]').childElementCount).toBe(0);
  });

  it('logs the segment change once, with the contentId', () => {
    const logger = makeLogger();
    const { rerender } = renderMap({ position: 0, logger });
    // INFO, NOT DEBUG. Debug events are dropped by the shipper and never reach
    // the log store, so a rail state logged at debug is invisible the moment
    // nobody is holding a devtools window open on the screen itself — which is
    // exactly when you need to know what it drew.
    const changes = () => logger.info.mock.calls.filter((c) => c[0] === 'surround.segment.change');
    expect(changes()).toHaveLength(1);
    expect(changes()[0][1]).toMatchObject({ contentId: 'plex:663134', n: 1 });

    const at = (position) => rerender(
      <SegmentMap
        position={position} duration={DURATION} playing seeking={false}
        data={EROICA} region={{ module: 'segment-map' }} logger={logger}
      />,
    );
    at(500);   // still segment 1 — no new event
    expect(changes()).toHaveLength(1);
    at(1000);  // now segment 2
    expect(changes()).toHaveLength(2);
    expect(changes()[1][1]).toMatchObject({ n: 2, label: 'Marcia funebre. Adagio assai' });
  });
});

/**
 * The design of this band is mostly CSS, and the vitest config runs `css: false`
 * — so `import './SegmentMap.scss'` injects nothing and a computed-style
 * assertion off a plain render would read UA defaults and pass regardless. These
 * specs compile the REAL stylesheet with the project's sass and inject it, the
 * pattern ComposerCard.test.jsx established, so a regression in the shipped file
 * fails here rather than on the wall.
 */
describe('SegmentMap — the band’s shipped design', () => {
  let injected = null;
  const withStyles = () => {
    const compiled = sass.compile(path.join(__dirname, 'SegmentMap.scss'));
    injected = document.createElement('style');
    injected.textContent = compiled.css;
    document.head.appendChild(injected);
    return compiled.css;
  };
  afterEach(() => { injected?.remove(); injected = null; });

  it('glides the playhead over one clock tick instead of stepping at 10 Hz', () => {
    withStyles();
    const { container } = renderMap({ position: 1450 });
    const head = container.querySelector('[data-testid="surround-playhead"]');
    // Read COMPUTED, so this is the value that actually reaches the engine
    // once `--head-ms` resolves — one transport tick, as it has been since
    // wave 5. The property is now published rather than literal (review
    // finding I2) and the fallback is what a frame rendered without the JS
    // gets, so resolving to the same number is the thing worth pinning.
    expect(window.getComputedStyle(head).getPropertyValue('transition'))
      .toBe('transform 120ms linear');
    // ...and at rest the published value IS one tick. It goes to zero only
    // while the accordion is interpolating the widths this cursor's position is
    // derived from — see the accordion block (review finding I2).
    expect(container.querySelector('[data-testid="surround-segment-map"]')
      .style.getPropertyValue('--head-ms')).toBe('120ms');
  });

  /**
   * Design wave 5 — THE RAMP IS ON THE PROPERTY THAT ACTUALLY MOVES.
   *
   * Waves 2-4 shipped `transition: left/width 120ms linear` and the cursor still
   * crept: the value was continuous but the PAINT was not, because Chromium
   * pixel-snaps a painted box's position and size (measured: a 2px bar at
   * `left: 25.13%` of 400px paints opaque on columns 101-102 and nowhere else,
   * while the same bar at `translateX` paints 98/99/100 at 123/255/133). A
   * transition declared on a property the engine then snaps is a transition that
   * does nothing a viewer can see.
   *
   * So this asserts the PAIRING, not just the presence of a ramp: the animated
   * property is a transform, the transform is the one that moves the mark, and
   * the old snapped properties are not being animated any more. Without the
   * pairing a later wave could satisfy "there is a transition" while moving the
   * element with `left` again.
   */
  it('animates the two moving marks on the transform each of them actually uses', () => {
    const css = withStyles();
    const ruleFor = (sel) => {
      const m = css.match(new RegExp(`\\${sel}\\s*\\{[^}]*\\}`));
      expect(m, `no ${sel} rule in the compiled sheet`).not.toBeNull();
      return m[0];
    };
    const head = ruleFor('.surround-segment-map__playhead');
    expect(head).toMatch(/transform:\s*translateX\(/);
    // The duration is published rather than literal (review finding I2); the
    // PROPERTY, which is what this spec is about, is unchanged.
    expect(head).toMatch(/transition:\s*transform var\(--head-ms, 120ms\) linear/);
    expect(head, 'the playhead is back on a pixel-snapped `left`').not.toMatch(/transition:[^;]*\bleft\b/);

    const fill = ruleFor('.surround-segment-map__bar-fill');
    expect(fill).toMatch(/transform:\s*scaleX\(/);
    expect(fill).toMatch(/transform-origin:\s*left/);
    expect(fill).toMatch(/transition:\s*transform 120ms linear/);
    expect(fill, 'the fill is back on a pixel-snapped `width`').not.toMatch(/transition:[^;]*\bwidth\b/);
  });

  it('gives the playhead no glow — no shadow, no lit tip', () => {
    const css = withStyles();
    const { container } = renderMap({ position: 1450 });
    const head = container.querySelector('[data-testid="surround-playhead"]');
    const shadow = window.getComputedStyle(head).getPropertyValue('box-shadow');
    expect(shadow === '' || shadow === 'none').toBe(true);
    // ...and the rule that used to paint the lit tip is gone from the sheet.
    expect(css).not.toContain('__playhead-edge');
  });

  it('sweeps the fill on the same ramp as the playhead', () => {
    withStyles();
    const { container } = renderMap({ position: 1450 });
    const fill = container.querySelector('[data-testid="surround-segment-fill"]');
    expect(window.getComputedStyle(fill).getPropertyValue('transition')).toBe('transform 120ms linear');
  });

  it('sets the name on ONE line with an ellipsis — the segment widens instead', () => {
    // Design wave 7 SUPERSEDES wave 5's two-line clamp. Nothing on this rail
    // wraps any more: everything is one line with an ellipsis when it is not
    // sounding, and the SOUNDING segment accordions wider until nothing is cut
    // (see the accordion block below). Two mechanisms for "the name did not
    // fit" is no rule at all, so the clamp is gone rather than disabled.
    const css = withStyles();
    const { container } = renderMap();
    const heading = container.querySelector('.surround-segment-map__heading');
    const style = window.getComputedStyle(heading);
    expect(style.getPropertyValue('white-space')).toBe('nowrap');
    expect(style.getPropertyValue('text-overflow')).toBe('ellipsis');
    expect(style.getPropertyValue('overflow')).toBe('hidden');

    // WRAP OR ELLIPSIS, NEVER BOTH — wave 5's law, still binding, now landing
    // on the other branch: `text-overflow` is the correct idiom precisely
    // because this box is single-line again, and the clamp that would
    // contradict it must be gone from the compiled sheet.
    const rule = css.match(/\.surround-segment-map__heading\s*\{[^}]*\}/);
    expect(rule, 'no heading rule in the compiled sheet').not.toBeNull();
    expect(rule[0], 'the heading still declares a line clamp beside an ellipsis')
      .not.toMatch(/-webkit-line-clamp/);
    expect(rule[0], 'the heading still caps its own height for a wrap it can no longer do')
      .not.toMatch(/max-height/);
  });

  it('drops the container-query tier the gloss used to wrap under', () => {
    // The live-defects round gave the gloss a two-line tier gated on a 700px
    // container query. Design wave 7 supersedes it: the accordion shows the
    // sounding segment's gloss whole without costing the band 14px of height
    // at every screen and for every segment. Removed, not left dormant — a
    // dormant tier is a second mechanism waiting to fire.
    const css = withStyles().replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css, 'the superseded gloss container query is still in the sheet')
      .not.toMatch(/@container segment-map/);
    expect(css, 'the band is still a query container nothing queries')
      .not.toMatch(/container-type:/);
  });

  // Read off the compiled sheet rather than off computed style: happy-dom does
  // not resolve `rem` in getComputedStyle, and a NaN comparison is the kind of
  // assertion that passes for the wrong reason.
  it('claims a band tall enough for those two lines — and not a pixel of dead slack', () => {
    const css = withStyles();
    const rule = css.match(/\.surround-segment-map\s*\{[^}]*\}/);
    expect(rule, 'no .surround-segment-map rule in the compiled sheet').not.toBeNull();
    const declared = rule[0].match(/min-height:\s*([\d.]+)(rem|px)/);
    expect(declared, 'the band declares no min-height').not.toBeNull();
    const px = declared[2] === 'rem' ? parseFloat(declared[1]) * 16 : parseFloat(declared[1]);

    // The floor is TYPOGRAPHIC and both bounds are load-bearing.
    // Lower: the lane (4px) + the heading's clearance (0.55em of 1.05rem) + two
    // lines of heading (2 x 1.05rem x 1.15) + the module's own bottom padding
    // (0.55rem) — anything less clips the second line of "Marcia funebre.
    // Adagio assai" against `overflow: hidden`.
    const floor = 4 + (0.55 * 1.05 * 16) + (2 * 1.05 * 1.15 * 16) + (0.55 * 16);
    expect(px, 'the band cannot hold two lines of segment name').toBeGreaterThanOrEqual(floor);
    // Upper: this region is `flex: 0 0 auto` and the CUE TICKER's is the one
    // that claims the band's slack, so every pixel of floor the names do not
    // need becomes dead black between them and the note — the top-heavy gap
    // design wave 5 removes. Wave 4's 5.75rem (92px) fails this deliberately.
    expect(px, 'the band hoards slack the ticker should have').toBeLessThan(88);
  });

  /**
   * Design wave 4 — THE RULE ROW RIDES UP.
   *
   * The user's complaint was a "big gap between the progress bar and the bottom
   * of the video": the rule sat at the FOOT of the band with the names above
   * it, so the timeline was a bar floating in a strip of black. It now sits at
   * the TOP, inside the footer's own upward overlap, and the names hang below.
   *
   * jsdom cannot lay this out, so the contract is asserted where it is actually
   * decided: source order (the bar precedes the heading, so the DOM order IS the
   * visual order), the flex direction of the boxes that stack them, and the
   * absence of the top padding that would otherwise spend the overlap on black.
   * The measured version of this is the runtime gate's clearance assertion.
   */
  it('puts the rule row above the segment names, tight to the top of the band', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    const { container } = renderMap({ position: 300 });

    // Source order: bar, then the text row (numeral gutter + text column),
    // inside each segment.
    const segment = container.querySelector('.surround-segment-map__segment');
    const classes = [...segment.children].map((el) => el.className);
    const bar = classes.findIndex((c) => c.includes('__bar'));
    const row = classes.findIndex((c) => c.includes('__text-row'));
    expect(bar).toBeGreaterThanOrEqual(0);
    expect(row).toBeGreaterThan(bar);

    // Both stacking boxes start at the top, not the bottom.
    expect(css).toMatch(/\.surround-segment-map \{[^}]*align-items: flex-start/);
    expect(css).toMatch(/\.surround-segment-map__rule \{[^}]*align-items: flex-start/);
    expect(css).toMatch(/\.surround-segment-map__segment \{[^}]*justify-content: flex-start/);

    // No top padding: the band's first pixel is the rule lane, which is what
    // puts it inside `--band-overlap` rather than below it.
    const pad = css.match(/\.surround-segment-map \{[^}]*padding: ([^;]+);/)?.[1] ?? '';
    expect(pad.trim().split(/\s+/)[0]).toBe('0');

    // The playhead and the barlines hang from the top edge with it.
    expect(css).toMatch(/\.surround-segment-map__playhead \{[^}]*top: 0/);
    expect(css).toMatch(/\.surround-segment-map__barline \{[^}]*top: 0/);
    // The clearance under the rule lane is TOP padding on the text row (design
    // wave 7 — the row is the box that has to clear the lane now that the
    // numeral shares it with the heading). The runtime gate measures the
    // HEADING's box, which starts after that padding, so the wave-4 clearance
    // law reads exactly what it always did.
    const rowRule = css.match(/\.surround-segment-map__text-row \{[^}]*\}/);
    expect(rowRule, 'no text-row rule in the compiled sheet').not.toBeNull();
    expect(rowRule[0]).toMatch(/padding: [\d.]+em/);
    expect(css).not.toMatch(/\.surround-segment-map__heading \{[^}]*margin-bottom:/);
  });

  /**
   * "Yet-to-come progress is too dark — I can't see the context." The lane a
   * segment has not reached yet is the SHAPE OF THE PIECE, and at a 28%-alpha
   * `--programme-edge` hairline it was invisible on the near-black band.
   *
   * The ladder asserted here is the design: a lane bright enough to read, an
   * elapsed fill brighter than the lane it covers, and the sounding segment
   * louder than both. Weight and colour are checked from the compiled sheet
   * (happy-dom will not resolve the tokens), heights from computed style.
   */
  it('keeps the yet-to-come track visible, under a brighter elapsed fill', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    const { container } = renderMap({ position: 300 });

    // The lane: the rail's own soft ink, not the near-invisible edge token.
    const lane = css.match(/\.surround-segment-map__bar::before \{([^}]*)\}/)?.[1] ?? '';
    expect(lane).toBeTruthy();
    expect(lane).toMatch(/background: var\(--ink-soft,/);
    expect(lane).not.toMatch(/--programme-edge/);
    expect(parseFloat(lane.match(/height: ([\d.]+)px/)[1])).toBeGreaterThanOrEqual(2);
    expect(parseFloat(lane.match(/opacity: ([\d.]+)/)[1])).toBeGreaterThanOrEqual(0.5);

    // The elapsed fill is BRIGHTER than the lane it is drawn over — otherwise
    // "done" and "still to come" would be the same mark at the same weight.
    const fill = css.match(/\.surround-segment-map__bar-fill \{([^}]*)\}/)?.[1] ?? '';
    expect(fill).toMatch(/background: var\(--ink,/);

    // ...and the sounding segment is still the loudest thing on the band.
    const active = css.match(/--active \.surround-segment-map__bar-fill \{([^}]*)\}/)?.[1] ?? '';
    expect(active).toMatch(/background: var\(--brass,/);
    const px = (s) => parseFloat(s.match(/height: ([\d.]+)px/)[1]);
    expect(px(active)).toBeGreaterThan(px(fill));

    // A future segment's NAME is legible too, and — deliberately — brighter
    // than an elapsed one's: what is coming is the context, what is gone is not.
    const future = css.match(/--future \.surround-segment-map__heading \{([^}]*)\}/)?.[1] ?? '';
    const elapsed = css.match(/--elapsed \.surround-segment-map__heading \{([^}]*)\}/)?.[1] ?? '';
    expect(future).toMatch(/color: var\(--ink,/);
    expect(parseFloat(future.match(/opacity: ([\d.]+)/)[1]))
      .toBeGreaterThan(parseFloat(elapsed.match(/opacity: ([\d.]+)/)[1]));

    // The lane exists under every segment, whatever its state.
    expect(container.querySelectorAll('.surround-segment-map__bar')).toHaveLength(4);
  });

  it('drops both animations under prefers-reduced-motion', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    const block = css.match(/@media \(prefers-reduced-motion: reduce\) \{([^}]*\})*?[^{]*\}/);
    expect(block, 'no reduced-motion block in the compiled sheet').not.toBeNull();
    expect(block[0]).toContain('__bar-fill');
    expect(block[0]).toContain('__playhead');
    expect(block[0]).toContain('transition: none');
  });
});

/**
 * DESIGN WAVE 6 — THE TRANSLATION SUB-LINE.
 *
 * "Allegro con brio" is a tempo marking a viewer either knows or does not, and
 * the band is the one place in the frame that can afford to tell them. The gloss
 * is an ANNOTATION, not more programme, which is why it is the only text in the
 * whole surround set in a sans face.
 */
describe('SegmentMap — the segment translations', () => {
  let injected = null;
  const withStyles = () => {
    const compiled = sass.compile(path.join(__dirname, 'SegmentMap.scss'));
    injected = document.createElement('style');
    injected.textContent = compiled.css;
    document.head.appendChild(injected);
    return compiled.css;
  };
  afterEach(() => { injected?.remove(); injected = null; });

  const translations = (container) =>
    [...container.querySelectorAll('[data-testid="surround-segment-translation"]')]
      .map((el) => el.textContent);

  it('writes the translation under the heading it glosses, in the same text column', () => {
    const { container } = renderMap();
    const first = container.querySelector('[data-testid="surround-segment"]');
    // Design wave 7: both live inside the TEXT COLUMN, beside the numeral's
    // gutter — that shared parent is what makes them share a left edge.
    const cell = first.querySelector('.surround-segment-map__text');
    expect(cell, 'the segment has no text column').not.toBeNull();
    const classes = [...cell.children].map((el) => el.className);
    const heading = classes.findIndex((c) => c.includes('__heading'));
    const gloss = classes.findIndex((c) => c.includes('__translation'));
    expect(gloss, 'the translation is not in the text column at all').toBeGreaterThanOrEqual(0);
    expect(gloss, 'the gloss is written above the name it glosses').toBeGreaterThan(heading);
    // ...and the numeral is NOT in that column: it is an index mark in its own
    // fixed track, which is the whole point of design wave 7's gutter.
    expect(cell.querySelector('.surround-segment-map__numeral'),
      'the numeral is back inside the text column — the gloss will start under it')
      .toBeNull();
    expect(translations(container)).toEqual([
      'Fast, with spirit', 'Funeral march — very slow', 'Finale — very fast',
    ]);
  });

  it('renders NO element for a segment with no authored translation', () => {
    // Three of the four segments are authored, and the unauthored one must
    // leave nothing behind — not an empty span holding a line of the band's
    // height, which is what every other module in this frame would pay for.
    const { container } = renderMap();
    expect(container.querySelectorAll('[data-testid="surround-segment-translation"]')).toHaveLength(3);
    const third = container.querySelectorAll('[data-testid="surround-segment"]')[2];
    expect(third.querySelector('[data-testid="surround-segment-translation"]')).toBeNull();
  });

  it('ignores a blank translation the same way it ignores an absent one', () => {
    const blank = {
      ...EROICA,
      pieceSegments: EROICA.pieceSegments.map((m) => ({ ...m, translation: '   ' })),
    };
    const { container } = renderMap({ data: blank });
    expect(container.querySelectorAll('[data-testid="surround-segment-translation"]')).toHaveLength(0);
  });

  /**
   * A DIFFERENT FACE, ON PURPOSE. Every other word in the frame is one of two
   * Garamonds; a gloss set in a third weight of the same family reads as quieter
   * programme rather than as annotation. The break is the message.
   */
  it('sets the gloss in the annotation face, recessive, above the ten-foot floor', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    const rule = css.match(/\.surround-segment-map__translation \{[^}]*\}/);
    expect(rule, 'no translation rule in the compiled sheet').not.toBeNull();
    expect(rule[0], 'the gloss is set in a serif — it reads as more programme')
      .toMatch(/font-family: var\(--surround-annotation,/);
    expect(rule[0]).not.toMatch(/font-family: var\(--surround-(display|body)/);
    // THE NUMERAL GUTTER'S GLOSS SITS A HAIR ABOVE THE TEN-FOOT FLOOR, and it is
    // expressed as that RELATIONSHIP now rather than as 0.74rem (design wave
    // 9b): the floor is measured per screen root and published as
    // `--label-floor`, so a literal here would sit above the floor on the office
    // screen and below it on the living room. 74/72 of whatever this root's
    // floor is, with the anchor root's 11.52px as the fallback.
    const size = glossRemFrom(rule[0]);
    expect(size, 'below the 0.72rem ten-foot floor').toBeGreaterThanOrEqual(0.72);
    // ...and quieter than the name it hangs under, which is 1.05rem/600.
    expect(size).toBeLessThan(1.05);
    const opacity = Number(rule[0].match(/opacity: ([\d.]+)/)[1]);
    expect(opacity).toBeGreaterThan(0.4);
    expect(opacity).toBeLessThan(0.7);
    // Not italic: the tempo TERM is the italic thing on this band (engraved
    // score convention). A gloss in italic would read as a second tempo term.
    expect(rule[0]).toMatch(/font-style: normal/);
  });

  /**
   * THE BASE TIER IS THE SAFE ONE (fix round 2, live defect 1). Wave 6 shipped
   * single-line + `nowrap` + `text-overflow: ellipsis` unconditionally; this is
   * still true at the BASE tier (below the container query's threshold), which
   * is what the tightest band in the fleet (960x540) needs — a compounding
   * two-line-name-plus-two-line-gloss on the same segment there overflows the
   * ticker's own floor (measured 13.6px past the frame's own edge), so the
   * fallback is deliberate, not a leftover.
   */
  it('takes the single-line branch at the base tier: nowrap plus an ellipsis, and no clamp', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    const rule = css.match(/\.surround-segment-map__translation \{[^}]*\}/)[0];
    expect(rule).toContain('white-space: nowrap');
    expect(rule).toContain('text-overflow: ellipsis');
    expect(rule).toContain('overflow: hidden');
    expect(rule, 'two truncation mechanisms on one element').not.toContain('-webkit-line-clamp');
  });

  /**
   * THE NUMERAL'S GUTTER (design wave 7). `III. Scherzo. Allegro vivace` used
   * to be one inline run, so the gloss under it started at the segment's left
   * edge — UNDER the numeral. The numeral is an index mark, and an index mark
   * belongs in a track of its own.
   */
  it('puts the numeral in a fixed track sized ONCE per rail, not per segment', () => {
    const css = withStyles().replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');
    const row = css.match(/\.surround-segment-map__text-row \{[^}]*\}/)[0];
    // Two tracks: the gutter, then the text column. `minmax(0, 1fr)` is what
    // lets the ellipses inside it actually fire.
    expect(row).toMatch(/grid-template-columns: var\(--numeral-gutter\) minmax\(0, 1fr\)/);
    // The track is `ch`-based off the row's own face, so a font swap moves the
    // gutter with the glyphs, and it is driven by `--numeral-chars` — published
    // by the component as the LONGEST numeral the piece has.
    expect(row).toMatch(/--numeral-gutter: calc\(var\(--numeral-chars[^)]*\)[^;]*ch/);

    const { container } = renderMap();
    const map = container.querySelector('.surround-segment-map');
    // The Eroica runs to IV., so the longest numeral is "III." — four
    // characters — and every segment gets that same track.
    expect(map.style.getPropertyValue('--numeral-chars')).toBe('4');
    const perSegment = [...container.querySelectorAll('.surround-segment-map__text-row')]
      .map((el) => el.style.getPropertyValue('--numeral-gutter'));
    expect(perSegment.every((v) => !v), 'a segment is sizing its own gutter').toBe(true);
  });

  it('sizes the gutter to the longest numeral the PIECE has, not to a constant', () => {
    const nine = {
      ...EROICA,
      piece: { title: 'Nine', musicEndsAt: 900 },
      pieceSegments: Array.from({ length: 8 }, (_, i) => ({
        n: i + 1, name: `Segment ${i + 1}`, start: i * 100,
      })),
    };
    const { container } = renderMap({ data: nine, duration: 900 });
    // VIII. — five characters.
    expect(container.querySelector('.surround-segment-map').style.getPropertyValue('--numeral-chars'))
      .toBe('5');
  });

  it('gives the index mark its own quiet register, and brightens it only when sounding', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    const rule = css.match(/\.surround-segment-map__numeral \{[^}]*\}/)[0];
    expect(rule, 'the numeral is not set as an index mark').toMatch(/font-variant-caps: all-small-caps/);
    expect(rule).toMatch(/font-variant-numeric: lining-nums/);
    const base = Number(rule.match(/opacity: ([\d.]+)/)[1]);
    expect(base, 'the numeral competes with the name it numbers').toBeLessThan(0.6);
    // Right-aligned in its track with its own air after it: a numbered list
    // rags on the left, not against the text it numbers.
    expect(rule).toMatch(/justify-self: end/);
    expect(rule).toMatch(/padding-right: [\d.]+em/);
    const active = css.match(/--active \.surround-segment-map__numeral \{([^}]*)\}/);
    expect(active, 'the sounding segment’s numeral never comes up').not.toBeNull();
    expect(Number(active[1].match(/opacity: ([\d.]+)/)[1])).toBeGreaterThan(base);
  });

  it('recedes with an elapsed segment, and only with an elapsed one', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    const base = Number(css.match(/\.surround-segment-map__translation \{[^}]*opacity: ([\d.]+)/)[1]);
    const elapsed = css.match(/--elapsed \.surround-segment-map__translation \{([^}]*)\}/);
    expect(elapsed, 'the gloss stays at full strength under a dimmed name').not.toBeNull();
    expect(Number(elapsed[1].match(/opacity: ([\d.]+)/)[1])).toBeLessThan(base);
    // The sounding segment does NOT brighten it: a sans line competing with
    // the brass rule is the one thing this register must not do.
    expect(css).not.toMatch(/--active \.surround-segment-map__translation/);
  });

  /**
   * THE BAND'S FLOOR DID NOT MOVE, and that is the measured claim.
   *
   * The floor's job is the SHORT case — a band whose headings all fit one line
   * — and the translation still fits inside it there. Raising the floor to
   * cover the wrapped case would buy dead black under every band that does not
   * wrap, which is exactly the slack wave 5 removed; the module has no ceiling,
   * so a band that genuinely needs the second line simply grows.
   */
  it('fits the whole band — one name line and one gloss line — inside its floor', () => {
    // Design wave 7: this is no longer the "short case". Nothing on the rail
    // wraps, so this arithmetic is the band's height at EVERY screen and for
    // every piece, and the floor is what the band simply IS.
    const css = withStyles();
    const band = css.match(/\.surround-segment-map\s*\{[^}]*\}/)[0];
    const declared = band.match(/min-height:\s*([\d.]+)rem/);
    expect(declared, 'the band declares no min-height').not.toBeNull();
    const floorPx = parseFloat(declared[1]) * 16;

    const row = css.match(/\.surround-segment-map__text-row\s*\{[^}]*\}/)[0];
    const rowSize = parseFloat(row.match(/font-size:\s*([\d.]+)rem/)[1]) * 16;
    const headClear = parseFloat(row.match(/padding:\s*([\d.]+)em/)[1]) * rowSize;
    const heading = css.match(/\.surround-segment-map__heading\s*\{[^}]*\}/)[0];
    const headSize = rowSize;                 // the heading is 1em of the row
    const headLh = parseFloat(heading.match(/line-height:\s*([\d.]+)/)[1]);

    const gloss = css.match(/\.surround-segment-map__translation\s*\{[^}]*\}/)[0];
    const glossSize = glossRemFrom(gloss) * 16;
    const glossLh = parseFloat(gloss.match(/line-height:\s*([\d.]+)/)[1]);
    const glossClear = parseFloat(gloss.match(/margin-top:\s*([\d.]+)em/)[1]) * glossSize;

    const lane = 4;
    const padBottom = parseFloat(band.match(/--band-pad-bottom:\s*([\d.]+)rem/)[1]) * 16;
    const needed = lane + headClear + (headSize * headLh)
      + glossClear + (glossSize * glossLh) + padBottom;

    expect(needed, 'the gloss no longer fits the band the design already had')
      .toBeLessThanOrEqual(floorPx);
    // ...and the floor is still not hoarding: wave 5's upper bound stands.
    expect(floorPx, 'the band hoards slack the ticker should have').toBeLessThan(88);
  });
});

/**
 * THE BOND (design wave 7).
 *
 * The user's complaint was that the listening band's NOW register reprinted the
 * segment heading the rail already sets directly above it — "that seems
 * wasteful". The replacement is visual: a lifted panel under the sounding
 * segment, the SAME panel under the register, and a connector along the seam.
 * These specs pin the rail's half of that shape; `CueTicker.test.jsx` pins the
 * band's, and the runtime gate pins that they are actually contiguous on screen.
 */
describe('SegmentMap — the bond', () => {
  let injected = null;
  const withStyles = () => {
    const compiled = sass.compile(path.join(__dirname, 'SegmentMap.scss'));
    injected = document.createElement('style');
    injected.textContent = compiled.css;
    document.head.appendChild(injected);
    return compiled.css;
  };
  afterEach(() => { injected?.remove(); injected = null; });

  const bond = (c) => c.querySelector('[data-testid="surround-bond"]');
  const connector = (c) => c.querySelector('[data-testid="surround-bond-connector"]');
  const pct = (el, prop) => parseFloat(el.style.getPropertyValue(prop));

  /**
   * ONE CLOCK, DRIVEN BY HAND (design wave 9).
   *
   * The bond's start and width ride in the same interpolated vector as the
   * segment shares, so a boundary moves the whole shape ONCE. Proving that needs
   * control of the animation, so this installs a `requestAnimationFrame` whose
   * frames are pumped by the test and a `performance.now` it advances.
   */
  const withFrames = () => {
    const frames = [];
    const realRaf = globalThis.requestAnimationFrame;
    const realCancel = globalThis.cancelAnimationFrame;
    const realNow = globalThis.performance.now;
    let clock = 0;
    globalThis.requestAnimationFrame = (fn) => frames.push(fn) && frames.length;
    globalThis.cancelAnimationFrame = () => {};
    globalThis.performance.now = () => clock;
    return {
      step(ms) {
        clock += ms;
        const due = frames.splice(0, frames.length);
        act(() => { due.forEach((fn) => fn(clock)); });
      },
      pending: () => frames.length,
      restore() {
        globalThis.requestAnimationFrame = realRaf;
        globalThis.cancelAnimationFrame = realCancel;
        globalThis.performance.now = realNow;
      },
    };
  };

  const atPosition = (position, data = EROICA) => (
    <SegmentMap
      position={position} duration={DURATION} playing seeking={false}
      data={data} region={{ module: 'segment-map' }} logger={makeLogger()}
    />
  );

  it('sits over the sounding segment, and travels to the next one at the boundary', () => {
    const clock = withFrames();
    try {
      const { container, rerender } = renderMap({ position: 300 });
      // Segment I: 0..976 of 2955.
      expect(pct(bond(container), '--bond-left')).toBeCloseTo(0, 6);
      expect(pct(bond(container), '--bond-width')).toBeCloseTo((976 / 2955) * 100, 4);

      act(() => { rerender(atPosition(1000)); });
      clock.step(ACCORDION_MS + 1);
      expect(pct(bond(container), '--bond-left')).toBeCloseTo((976 / 2955) * 100, 4);
      expect(pct(bond(container), '--bond-width')).toBeCloseTo((949 / 2955) * 100, 4);
    } finally {
      clock.restore();
    }
  });

  /**
   * THE ARTIFACT THIS WAVE REMOVED, ASSERTED AS A NUMBER.
   *
   * Wave 7 kept a CSS `transition` on the bond's own `left`/`width`, reasoning
   * that it travels between segments rather than tracking one, so only its
   * endpoints mattered. What the user saw was the rail right-sizing and THEN the
   * highlight sliding into it — two moves, because React committed the bond's
   * FINAL position in the same frame the widths began easing, and the browser
   * animated from there on its own clock.
   *
   * So: mid-flight, the published position must be strictly BETWEEN the old
   * segment's and the new one's. Under the old design it was already at the new
   * one on the first frame after the boundary.
   *
   * TO GO RED: publish the bond from `targetShares` instead of the interpolated
   * vector, or put `transition: left …` back on `.surround-segment-map__bond`.
   */
  it('moves the bond mid-flight with the widths, not after them', () => {
    const clock = withFrames();
    try {
      const { container, rerender } = renderMap({ position: 300 });
      const from = pct(bond(container), '--bond-left');
      act(() => { rerender(atPosition(1000)); });
      const to = (976 / 2955) * 100;
      clock.step(ACCORDION_MS / 2);
      const mid = pct(bond(container), '--bond-left');
      expect(
        mid,
        `half way through the ${ACCORDION_MS}ms move the bond is at ${mid}% — it should be `
        + `between ${from}% and ${to}%, not parked at either end on a second clock`,
      ).toBeGreaterThan(from + 1e-6);
      expect(mid).toBeLessThan(to - 1e-6);
      clock.step(ACCORDION_MS);
      expect(pct(bond(container), '--bond-left')).toBeCloseTo(to, 4);
    } finally {
      clock.restore();
    }
  });

  /**
   * THE WHOLE SHAPE LEAVES TOGETHER (review finding I-2).
   *
   * It used to publish `--bond-width: 0%` — untransitioned — in the same commit
   * that flipped `data-bonded` to false, so at the final chord the rail's panel
   * and the waist collapsed to nothing in ONE FRAME while the band's panel below
   * them faded out over 420ms. Half of "one shape" on one clock and half on
   * another: §7's defect in the state §8 added. The old spec pinned the snap
   * (`--bond-width` is 0) and was green on it.
   *
   * The geometry is HELD instead — the fade is the only thing that changes — so
   * both halves of the bond fade out from where the music left them.
   *
   * TO GO RED: publish `{'--bond-width': '0%'}` when nothing is sounding.
   */
  it('holds the bond’s geometry over the applause and fades, rather than collapsing it', () => {
    const clock = withFrames();
    try {
      const { container, rerender } = renderMap({ position: 2500 });   // segment IV
      const heldLeft = pct(bond(container), '--bond-left');
      const heldWidth = pct(bond(container), '--bond-width');
      expect(heldWidth, 'nothing to hold — the fixture is not sounding to begin with')
        .toBeGreaterThan(0);

      act(() => { rerender(atPosition(2960)); });     // past musicEndsAt: applause
      clock.step(ACCORDION_MS + 1);
      expect(bond(container).getAttribute('data-bonded')).toBe('false');
      expect(connector(container).getAttribute('data-bonded')).toBe('false');
      expect(
        pct(bond(container), '--bond-width'),
        'the rail’s panel collapsed to zero width in one frame while the band’s panel below it '
        + 'faded over 420ms — the bond leaves on two clocks',
      ).toBeCloseTo(heldWidth, 4);
      expect(pct(bond(container), '--bond-left')).toBeCloseTo(heldLeft, 4);
      // ...and the waist is still the hull it was, so it fades as one shape too.
      expect(pct(connector(container), '--connector-width')).toBeGreaterThan(0);
    } finally {
      clock.restore();
    }
  });

  /**
   * THE WAIST SPANS THE PANEL, ALWAYS (design wave 9). Wave 7 ran it from the
   * segment's near edge only as far as the panel's near edge, so the lit segment
   * and the lit register met at ONE POINT — the user's "kitty corner". A region
   * joined at a point is two regions. The waist is now the hull of the two, so
   * the panel's whole top edge is welded whatever the segment is doing.
   */
  it('covers the whole NOW panel even when the segment already sits over it', () => {
    // Segment IV runs 2278..2955 — 77%..100% of the rail — inside the right
    // panel. The waist collapses onto the panel rather than to zero.
    const { container } = renderMap({ position: 2500 });
    expect(connector(container).getAttribute('data-bonded')).toBe('true');
    expect(pct(connector(container), '--connector-left')).toBeCloseTo(50, 6);
    expect(pct(connector(container), '--connector-width')).toBeCloseTo(50, 6);
  });

  it('reaches back to a sounding segment on the far side, still covering the panel', () => {
    // Segment I ends at 33% of the rail; the right-hand panel is 50%..100%.
    const { container } = renderMap({ position: 300 });
    const left = pct(connector(container), '--connector-left');
    const width = pct(connector(container), '--connector-width');
    expect(left, 'the waist does not reach the segment it hangs from').toBeCloseTo(0, 6);
    expect(left + width, 'the waist stops short of the panel’s far edge').toBeCloseTo(100, 6);
    // ...which is the property that matters: the panel is covered end to end.
    expect(Math.min(left + width, 100) - Math.max(left, 50), 'the panel is not fully welded')
      .toBeCloseTo(50, 6);
  });

  it('reaches LEFTWARDS when the register is configured onto the left', () => {
    const left = { ...EROICA, definition: { band: { nowSide: 'left' } } };
    const { container } = renderMap({ position: 2500, data: left });
    expect(container.querySelector('[data-testid="surround-segment-map"]')
      .getAttribute('data-now-side')).toBe('left');
    expect(pct(connector(container), '--connector-left')).toBeCloseTo(0, 6);
    // Segment IV ends at the rail's right edge, so the waist runs the whole band.
    expect(pct(connector(container), '--connector-width')).toBeCloseTo(100, 6);
  });

  /**
   * THE CORNER RULE, AS PUBLISHED. Only the waist corners that are on the
   * OUTSIDE of the silhouette take `--bond-radius`; the rest are welds and are
   * square, so the joins are invisible. The geometry is decided in `../band.js`
   * and asserted there; this pins that the component actually publishes it.
   */
  /**
   * THE WAIST TRAVELS WITH THE PANEL ON A `nowSide` SWAP (review finding I-6).
   *
   * `bondConnector` used to take the side DISCRETELY, so the waist jumped to the
   * new hull in the frame `side` flipped while the NOW panel below it travelled
   * there over 420ms on the CSS clock. For those 420ms the two halves of one
   * shape were in different places — the degenerate case §1 named ("`nowSide:
   * dynamic` at the moment of the swap") left unheld, and none of the 14 bond
   * cases lands inside a swap because they all set the side statically.
   *
   * The panel's own left edge now rides in this module's interpolated vector and
   * `CueTicker` interpolates the identical number with the identical hook, so
   * mid-swap the waist is somewhere strictly between the two hulls.
   *
   * TO GO RED: pass `side` instead of `panelStart` to `bondConnector`.
   */
  it('travels the waist with the panel across a dynamic side swap', () => {
    const clock = withFrames();
    const dyn = { ...EROICA, definition: { band: { nowSide: 'dynamic' } } };
    try {
      // Under half way: the register is on the LEFT, so the waist reaches from
      // the sounding segment back to a panel at 0..50%.
      const { container, rerender } = render(atPosition(300, dyn));
      const before = pct(connector(container), '--connector-width');
      expect(container.querySelector('[data-testid="surround-segment-map"]')
        .getAttribute('data-now-side')).toBe('left');

      act(() => { rerender(atPosition(2000, dyn)); });   // 68% — past the mark
      expect(container.querySelector('[data-testid="surround-segment-map"]')
        .getAttribute('data-now-side')).toBe('right');
      clock.step(ACCORDION_MS / 2);
      const mid = pct(connector(container), '--connector-left');
      // Segment III is 65%..77% of the rule. With the panel on the LEFT the
      // hull starts at 0; with it on the RIGHT it starts at 50. Mid-swap the
      // waist must be strictly inside that interval — a discrete `side` puts it
      // at 50 on the first frame, which is what this catches.
      expect(
        mid,
        `half way through the swap the waist starts at ${mid}% — it should be strictly between 0% `
        + 'and 50%, not already parked on the new hull while the panel is still crossing the band',
      ).toBeGreaterThan(0.5);
      expect(mid).toBeLessThan(49.5);
      clock.step(ACCORDION_MS);
      // Settled: the waist reaches the RIGHT-hand panel's far edge.
      const after = pct(connector(container), '--connector-left')
        + pct(connector(container), '--connector-width');
      expect(after).toBeCloseTo(100, 3);
      expect(before).toBeGreaterThan(0);
    } finally {
      clock.restore();
    }
  });

  it('publishes a radius only for the waist corners that are exterior', () => {
    const { container } = renderMap({ position: 300 });
    const c = connector(container);
    // Segment far left, panel right: the waist's left end is the segment's own
    // edge (top-left welded, bottom-left exposed) and its right end is the
    // panel's (bottom-right welded, top-right exposed).
    expect(c.getAttribute('data-corners')).toBe('tr bl');
    expect(c.style.getPropertyValue('--connector-tl')).toBe('0');
    expect(c.style.getPropertyValue('--connector-tr')).toBe('var(--bond-radius)');
    expect(c.style.getPropertyValue('--connector-bl')).toBe('var(--bond-radius)');
    expect(c.style.getPropertyValue('--connector-br')).toBe('0');
  });

  it('follows the playhead across the band when the side is dynamic', () => {
    const dyn = { ...EROICA, definition: { band: { nowSide: 'dynamic' } } };
    const props = (position) => (
      <SegmentMap
        position={position} duration={DURATION} playing seeking={false}
        data={dyn} region={{ module: 'segment-map' }} logger={makeLogger()}
      />
    );
    const { container, rerender } = render(props(300));
    const side = () => container.querySelector('[data-testid="surround-segment-map"]')
      .getAttribute('data-now-side');
    expect(side(), 'under half-way the register belongs on the near side').toBe('left');
    rerender(props(2000));                        // 68% — past the mark
    expect(side()).toBe('right');
    rerender(props(1450));                        // 49% — inside the hysteresis band
    expect(side(), 'a wobble across the mark flapped the whole band').toBe('right');
    rerender(props(1200));                        // 40.6% — clear of it
    expect(side()).toBe('left');
  });

  it('paints the bond in the frame’s shared ground, on the band’s one radius rule', () => {
    const css = withStyles().replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');
    const panel = css.match(/\.surround-segment-map__bond \{[^}]*\}/)[0];
    // ONE token, published by the frame, so the rail's panel and the band's
    // cannot drift a few percent apart and stop reading as one shape.
    expect(panel).toMatch(/background: var\(--bond-ground,/);
    // THE CORNER RULE: every corner on the OUTSIDE of the silhouette takes
    // `--bond-radius`; every corner where two parts weld is square. The foot is
    // not an edge — it is where this panel becomes the waist.
    expect(panel).toMatch(/border-radius: var\(--bond-radius, [^)]*\) var\(--bond-radius, [^)]*\) 0 0/);
    // ...and it reaches THROUGH the band's bottom padding to the seam.
    expect(panel).toMatch(/bottom: calc\(var\(--band-pad-bottom\) \* -1\)/);
    // NOTHING IN THE BAND IS EDGED.
    expect(panel, 'the bond grew a border').not.toMatch(/box-shadow|border(-(top|left|right|bottom))?:/);

    const shoulder = css.match(/\.surround-segment-map__bond-connector \{[^}]*\}/)[0];
    expect(shoulder).toMatch(/background: var\(--bond-ground,/);
    // The waist's four corners are decided per-render, not fixed: the component
    // publishes a radius only where a corner is exterior.
    expect(shoulder).toMatch(/border-radius: var\(--connector-tl, 0\) var\(--connector-tr, 0\) var\(--connector-br, 0\) var\(--connector-bl, 0\)/);
    expect(shoulder).toMatch(/bottom: calc\(var\(--band-pad-bottom\) \* -1\)/);

    // ONE CLOCK. Neither the panel nor the waist may animate its own geometry —
    // both are repositioned every frame from the interpolated vector.
    for (const [name, rule] of [['the bond', panel], ['the waist', shoulder]]) {
      const t = rule.match(/transition: ([^;]*);/);
      expect(t, `${name} lost its fade`).not.toBeNull();
      expect(t[1], `${name} is back on a second, CSS clock`).not.toMatch(/\bleft\b|\bwidth\b/);
    }
  });

  it('gives the connector a height that reads at ten feet, and clears the type above it', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    const band = css.match(/\.surround-segment-map \{[^}]*\}/)[0];
    const pad = parseFloat(band.match(/--band-pad-bottom: ([\d.]+)rem/)[1]) * 16;
    const shoulderPx = parseFloat(band.match(/--bond-shoulder: ([\d.]+)px/)[1]);
    // The minimum that reaches the seam is the bottom padding itself (5.6px),
    // and rendered, that did not read — a strip that thin in a ground seven
    // points lighter than the band is noise, not a bridge.
    expect(shoulderPx, 'the connector is back to the bare minimum that reaches')
      .toBeGreaterThan(pad);
    // The band's own measured slack below the gloss's baseline is 14.89px
    // (gloss bottom 49.11px in a 64px band); the shoulder must stay inside it.
    expect(shoulderPx, 'the connector runs up into the segment names').toBeLessThan(14.89);
  });

  it('is state, not motion: reduced motion stops it gliding, not existing', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    const block = css.match(/@media \(prefers-reduced-motion: reduce\) \{(.*)\}/);
    expect(block, 'no reduced-motion block in the compiled sheet').not.toBeNull();
    expect(block[1]).toContain('surround-segment-map__bond');
    expect(block[1]).toMatch(/transition: none/);
    // The SEGMENT is deliberately absent from this block, and that is the
    // review-I2 fix showing through: it has no CSS transition to cancel. Its
    // widths are interpolated in JS, and `useEasedVector` reads the preference
    // itself and commits the target in one go.
    const seg = css.match(/\.surround-segment-map__segment \{[^}]*\}/)[0];
    expect(seg, 'the segment is back on a second, CSS clock').not.toMatch(/transition/);
    // ...and nothing hides the bond there: the highlight still says which
    // segment is sounding, it just arrives in one frame.
    expect(block[1]).not.toMatch(/surround-segment-map__bond[^{]*\{[^}]*(display|opacity)/);
  });
});

/**
 * THE ACCORDION (design wave 7), as the component drives it. The solver itself
 * is pure and is tested in `../band.test.js`; these specs pin the two things
 * only the component can get wrong — that it publishes what the solver returns,
 * and that the playhead is derived from those RENDERED widths.
 */
describe('SegmentMap — the accordion', () => {
  const widthPct = (container) =>
    [...container.querySelectorAll('[data-testid="surround-segment"]')]
      .map((el) => parseFloat(el.style.width));

  it('renders the duration-derived widths until the rail has been measured', () => {
    // jsdom gives every box a zero rect and no ResizeObserver fires, so the
    // accordion is inert and the rail is exactly its own timeline. That is the
    // designed degradation, not an accident of the test environment: a rail
    // whose width is unknown must not guess one.
    const { container } = renderMap({ position: 2000 });
    const w = widthPct(container);
    expect(w[0]).toBeCloseTo((976 / 2955) * 100, 4);
    expect(w[2]).toBeCloseTo((353 / 2955) * 100, 4);
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 6);
  });

  it('publishes each segment’s NATURAL share alongside its rendered one', () => {
    // The rendered width is what the accordion chose; the natural share is what
    // the segment's duration earns, and the two are no longer the same number.
    // Read by this spec (the runtime gate measures the segment's own box
    // instead), so it is the one place the solver's input is checkable against
    // the durations it came from without recomputing them here.
    const { container } = renderMap({ position: 2000 });
    const naturals = [...container.querySelectorAll('[data-testid="surround-segment"]')]
      .map((el) => Number(el.getAttribute('data-natural')));
    expect(naturals[2]).toBeCloseTo(353 / 2955, 6);
    expect(naturals.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
  });

  it('keeps the playhead truthful at every boundary', () => {
    // The law the accordion must not break: whatever the widths, the cursor
    // reaches a segment's right edge exactly when the music crosses it.
    const props = (position) => (
      <SegmentMap
        position={position} duration={DURATION} playing seeking={false}
        data={EROICA} region={{ module: 'segment-map' }} logger={makeLogger()}
      />
    );
    const { container, rerender } = render(props(0));
    const head = () => parseFloat(
      container.querySelector('[data-testid="surround-playhead"]').getAttribute('data-head'),
    );
    let cumulative = 0;
    for (const [i, boundary] of [976, 1925, 2278].entries()) {
      cumulative += widthPct(container)[i] / 100;
      rerender(props(boundary));
      // `data-head` is published to four places, which is the precision the
      // comparison can honestly ask for.
      expect(head(), `the cursor is not on segment ${i + 1}'s right edge at ${boundary}s`)
        .toBeCloseTo(cumulative, 4);
    }
  });

  /**
   * REVIEW FINDING I2 — the head and the painted boundary must be on ONE clock.
   *
   * The defect was structural: `transition: width` on the segment animated the
   * boundary over 420ms while the playhead's own 120ms ramp carried the cursor
   * to the WIDENED solution almost at once. Measured on the Eroica at 1280x720,
   * that left the head ~70px inside the elapsed fill's still-painted right edge
   * for ~300ms at every segment boundary.
   *
   * jsdom cannot see paint, so this models it: it reads the module's own
   * declared transitions out of the compiled sheet and asserts that the
   * boundary's painted position and the head's are governed by the SAME clock.
   * Against the pre-fix sheet the segment declares a `width` transition the
   * playhead's rule does not share, and the first assertion fails — which is
   * the point: the desynchronisation is a property of the stylesheet, and the
   * fix is that one of the two clocks no longer exists.
   */
  it('drives the widths and the head from ONE clock — no CSS transition on either width', () => {
    const compiled = sass.compile(path.join(__dirname, 'SegmentMap.scss')).css;
    const seg = compiled.match(/\.surround-segment-map__segment\s*\{[^}]*\}/)[0];
    expect(
      seg,
      'the segment animates its own width in CSS — a second clock the playhead '
      + 'does not share, which is what puts the cursor inside the elapsed fill',
    ).not.toMatch(/transition/);

    // The head's ramp is published, and the component drops it to zero for
    // exactly the window in which the widths are being interpolated — so
    // during a move there is one clock, and at rest the cursor still glides
    // between the transport's 10 Hz steps.
    const head = compiled.match(/\.surround-segment-map__playhead\s*\{[^}]*\}/)[0];
    expect(head).toMatch(/transition:\s*transform var\(--head-ms/);
  });

  it('keeps the head ON the boundary at every frame of a widening move', () => {
    // The invariant, checked against the widths the component ITSELF published
    // in the same render rather than against the solver's target. With one
    // clock these agree by construction; with two they cannot, because the
    // head's array and the segments' array are read at different times.
    //
    // NOTE on what is NOT asserted: the head legitimately moves BACKWARDS
    // across a boundary. The accordion compresses the segments to the left of
    // the newly-sounding one, so the boundary itself travels left and the
    // cursor travels with it — the non-uniform time scale the brief says the
    // user accepted explicitly. What must never happen is the head leaving that
    // boundary, which is what this measures.
    const props = (position) => (
      <SegmentMap
        position={position} duration={DURATION} playing seeking={false}
        data={EROICA} region={{ module: 'segment-map' }} logger={makeLogger()}
      />
    );
    const { container, rerender } = render(props(1900));
    const sample = () => {
      const widths = [...container.querySelectorAll('[data-testid="surround-segment"]')]
        .map((el) => parseFloat(el.style.width) / 100);
      const head = parseFloat(
        container.querySelector('[data-testid="surround-playhead"]').getAttribute('data-head'),
      );
      return { widths, head };
    };
    for (const position of [1900, 1925, 1930, 2100, 2277, 2278, 2500, 2954]) {
      rerender(props(position));
      const { widths, head } = sample();
      const active = [...container.querySelectorAll('[data-testid="surround-segment"]')]
        .findIndex((el) => el.getAttribute('data-state') === 'active');
      expect(active, `nothing is sounding at ${position}s`).toBeGreaterThanOrEqual(0);
      const before = widths.slice(0, active).reduce((a, b) => a + b, 0);
      expect(
        head,
        `at ${position}s the cursor is at ${head} but segment ${active + 1} `
        + `starts at ${before} in the widths the module published`,
      ).toBeGreaterThanOrEqual(before - 1e-4);
      expect(
        head,
        `at ${position}s the cursor has run past segment ${active + 1}'s own segment`,
      ).toBeLessThanOrEqual(before + widths[active] + 1e-4);
    }
  });

  it('publishes ONE accordion duration, from the shared timing module', () => {
    const { container } = renderMap();
    const map = container.querySelector('[data-testid="surround-segment-map"]');
    expect(map.style.getPropertyValue('--accordion-ms')).toBe(`${ACCORDION_MS}ms`);
  });

  it('curls the quotes in a segment name and its gloss', () => {
    const curly = {
      ...EROICA,
      pieceSegments: [{
        n: 1, start: 0,
        name: "Largo e pianissimo sempre. 'the dog that barks'",
        translation: "Slow — Vivaldi's marking",
      }],
    };
    const { container } = renderMap({ data: curly });
    const seg = container.querySelector('[data-testid="surround-segment"]');
    expect(seg.textContent).toContain('‘the dog that barks’');
    expect(seg.textContent).toContain('Vivaldi’s');
    expect(seg.textContent, 'a straight mark survived the render seam').not.toContain("'");
  });
});

/**
 * THE COMPACT RAIL (`band.railDensity: 'bars'`) — review finding I4.
 *
 * The key shipped documented as "what the segment rail itself prints" while the
 * rail read nothing: authoring `bars` produced a rail that still printed every
 * name AND a NOW heading that had come back on, i.e. exactly the duplication
 * this wave exists to remove, produced by the key meant to prevent it. The rail
 * honours it now, which is also what makes `nowHeading: 'auto'` a real decision
 * rather than a constant.
 */
describe('SegmentMap — the compact rail', () => {
  let injected = null;
  const withStyles = () => {
    const compiled = sass.compile(path.join(__dirname, 'SegmentMap.scss'));
    injected = document.createElement('style');
    injected.textContent = compiled.css;
    document.head.appendChild(injected);
    return compiled.css;
  };
  afterEach(() => { injected?.remove(); injected = null; });

  const bars = { ...EROICA, definition: { band: { railDensity: 'bars' } } };

  it('prints no names, no glosses and no numerals', () => {
    const { container } = renderMap({ data: bars });
    expect(container.querySelectorAll('.surround-segment-map__text-row')).toHaveLength(0);
    expect(container.querySelectorAll('.surround-segment-map__heading')).toHaveLength(0);
    expect(container.querySelectorAll('[data-testid="surround-segment-translation"]')).toHaveLength(0);
    expect(container.querySelectorAll('.surround-segment-map__numeral')).toHaveLength(0);
  });

  it('still draws the rule, its barlines, the fills and the playhead', () => {
    // A compact rail is a rail, not an absence: everything that carries
    // PROGRESS survives; only the type goes.
    const { container } = renderMap({ data: bars, position: 2000 });
    expect(container.querySelectorAll('[data-testid="surround-segment"]')).toHaveLength(4);
    expect(container.querySelectorAll('[data-testid="surround-segment-fill"]')).toHaveLength(4);
    expect(container.querySelector('[data-testid="surround-playhead"]')).not.toBeNull();
    expect(container.querySelectorAll('.surround-segment-map__barline').length).toBeGreaterThan(0);
    // ...and the bond still marks the sounding segment.
    expect(container.querySelector('[data-testid="surround-bond"]').getAttribute('data-bonded'))
      .toBe('true');
  });

  it('says which density it is in, and keeps the names by default', () => {
    const { container } = renderMap({ data: bars });
    expect(container.querySelector('[data-testid="surround-segment-map"]')
      .getAttribute('data-density')).toBe('bars');
    const { container: named } = renderMap();
    expect(named.querySelector('[data-testid="surround-segment-map"]')
      .getAttribute('data-density')).toBe('names');
    // Scoped to the SEGMENTS. The rail also carries one text row inside its
    // ruler (`__probe`), which is a measuring instrument and not a segment's
    // name; a bare query would count it and the claim being made here is about
    // what the four segments render.
    expect(named.querySelectorAll('[data-testid="surround-segment"] .surround-segment-map__text-row')).toHaveLength(4);
  });

  it('drops the band’s floor to what a bars-only rail actually needs', () => {
    // Omitting the row rather than hiding it is the point: the band's height is
    // its content, so a hidden-but-rendered row would leave a compact rail as
    // tall as a named one and buy nothing.
    const css = withStyles().replace(/\s+/g, ' ');
    const compact = css.match(/\.surround-segment-map--bars \{[^}]*\}/);
    expect(compact, 'a bars-only rail keeps the full named-rail floor').not.toBeNull();
    expect(compact[0]).toMatch(/min-height: calc\(4px \+ var\(--band-pad-bottom\)\)/);
    const full = css.match(/\.surround-segment-map \{[^}]*\}/)[0];
    const fullPx = parseFloat(full.match(/min-height: ([\d.]+)rem/)[1]) * 16;
    expect(fullPx, 'the named floor is not larger than the compact one').toBeGreaterThan(4 + 5.6);
  });

  it('measures no width to right-size for — there is no type on the rail', () => {
    // The accordion is inert in this density rather than opening on a stale
    // measurement: with no text row there is nothing that could be cut.
    const logger = makeLogger();
    renderMap({ data: bars, position: 2000, logger });
    const events = logger.debug.mock.calls.map(([name]) => name);
    expect(events).not.toContain('surround.accordion.measured');
  });
});

/**
 * REVIEW FINDING I5 — the wave's new decisions have to be visible in prod.
 * The dynamic crossover happens once in a fifty-minute symphony and moves the
 * whole band; the accordion's measurement decides every width on the rail and
 * is read off the DOM in a face that arrives asynchronously. Neither leaves a
 * surface anyone can point at afterwards.
 */
describe('SegmentMap — logging the new decisions', () => {
  /**
   * THE MEASUREMENT PATH, RUN — the one part of this module jsdom cannot reach
   * on its own (every box is 0x0 and its ResizeObserver never fires), and the
   * one that decides every width on the rail. So the geometry is stubbed and the
   * path is actually exercised.
   *
   * IT MEASURES THE RULER, NOT THE SEGMENTS (task 6c). The rail reads its
   * furniture and its names off `__probe`, a single out-of-flow element, rather
   * than off a live segment — because two of the numbers are needed for segments
   * that render no name at all (chip mode), and because a number read off a live
   * segment is read off a box the previous solve already resized.
   */
  const withRailGeometry = (rects, run) => {
    const rect = Element.prototype.getBoundingClientRect;
    const RO = globalThis.ResizeObserver;
    Element.prototype.getBoundingClientRect = function stub() {
      const hit = Object.keys(rects).find((cls) => this.classList?.contains(cls));
      const width = hit ? rects[hit] : 0;
      return { width, height: width ? 40 : 0, x: 0, y: 0, top: 0, left: 0, right: width, bottom: 40 };
    };
    // happy-dom ships a ResizeObserver that never fires, so the rule is never
    // measured and `railPx` stays at its "no measurement yet" zero. This one
    // delivers the rule's width once, synchronously, which is what the browser
    // does on the first frame.
    globalThis.ResizeObserver = class {
      constructor(cb) { this.cb = cb; }
      observe(el) { this.cb([{ target: el, contentRect: { width: rects.RAIL ?? 0 } }]); }
      disconnect() {}
      unobserve() {}
    };
    try { return run(); } finally {
      Element.prototype.getBoundingClientRect = rect;
      globalThis.ResizeObserver = RO;
    }
  };

  it('reports the accordion’s measured width for the sounding segment', () => {
    withRailGeometry({
      RAIL: 1000,
      // The ruler: a max-content row of 197px whose text column is 149px, so the
      // rail's segment furniture is 48px — the numeral's gutter and the insets.
      'surround-segment-map__text-row': 197,
      'surround-segment-map__heading': 149,
      'surround-segment-map__text': 149,
    }, () => {
      const logger = makeLogger();
      renderMap({ position: 2000, logger });   // segment III, the Scherzo
      const measured = logger.debug.mock.calls.filter(([n]) => n === 'surround.accordion.measured');
      expect(measured.length, 'the accordion measured nothing anyone can see').toBe(1);
      // chrome (197 − 149 = 48) + the widest single-line string (149), rounded
      // up with one pixel of margin — the number the solver is handed.
      expect(measured[0][1]).toMatchObject({ index: 2, need: 149, chrome: 48, desired: 198 });
    });
  });

  it('does NOT open the accordion for a name that already fits', () => {
    // Review finding, minor 3: a `nowrap` box that is not overflowing reports
    // `scrollWidth === clientWidth`, so `Math.ceil(...) + 1` asked for a pixel
    // more than the segment already had and quietly took one off every
    // neighbour for a segment whose name was never cut. Task 6c moved the
    // question onto the segment's NATURAL width — the width the rail would give
    // it anyway — which is what the accordion is actually deciding about.
    withRailGeometry({
      // The Scherzo's natural share of the Eroica is ~0.12 of the rule, so a
      // 10000px rule gives it ~1195px against a name that wants 197px.
      RAIL: 10000,
      'surround-segment-map__text-row': 197,
      'surround-segment-map__heading': 149,
      'surround-segment-map__text': 149,
    }, () => {
      const logger = makeLogger();
      renderMap({ position: 2000, logger });
      expect(
        logger.debug.mock.calls.filter(([n]) => n === 'surround.accordion.measured'),
        'the accordion opened for a name that already fitted',
      ).toHaveLength(0);
    });
  });

  /**
   * THE RAIL SAYS WHICH DENSITY IT CHOSE, and why — the number the threshold was
   * decided on, not just its verdict. A rail that is chipping on a real screen
   * when it should not be is otherwise unfalsifiable from a log.
   */
  it('reports the density it chose, with the room each inactive segment had', () => {
    withRailGeometry({
      RAIL: 400,
      'surround-segment-map__text-row': 197,
      'surround-segment-map__heading': 149,
      'surround-segment-map__text': 149,
    }, () => {
      const logger = makeLogger();
      renderMap({ position: 2000, logger });
      const density = logger.info.mock.calls.filter(([n]) => n === 'surround.rail.density');
      expect(density.length, 'the rail chose a density and said nothing about it')
        .toBeGreaterThanOrEqual(1);
      const last = density[density.length - 1][1];
      // 400px of rule, four segments, the widest name wanting 198px: 202px over
      // three inactive segments is 67px each, under this rail's 85px name floor
      // (48px of furniture + the 37px name run), so the rail chips.
      expect(last).toMatchObject({
        density: 'chips', segments: 4, railPx: 400, widestPx: 198, chromePx: 48, nameFloorPx: 85,
      });
      expect(last.roomPx).toBe(67);
    });
  });

  /**
   * ==========================================================================
   * THE COMPONENT'S WIRING — it renders what the decision says (task 6c).
   * ==========================================================================
   *
   * The GEOMETRY of chip mode is measured in Chromium against the compiled sheet
   * (`../band.measure.test.jsx`): the threshold, the widths, the guarantee that
   * the sounding name is whole. What that spec cannot see is the component —
   * `renderToStaticMarkup` runs no effects, so it never takes the decision. This
   * is where the decision reaches the DOM, which is exactly the split
   * `CueTicker.test.jsx` carries for the fit's `withhold`.
   *
   * TO GO RED: render the chip for every segment including the sounding one; or
   * keep the text row and hide it; or take the decision from `segments.length`.
   */
  it('wears chips when the rule cannot afford names, and only then', () => {
    withRailGeometry({
      RAIL: 400,
      'surround-segment-map__text-row': 197,
      'surround-segment-map__heading': 149,
      'surround-segment-map__text': 149,
    }, () => {
      const { container } = renderMap({ position: 2000 });   // segment III sounding
      expect(container.querySelector('[data-testid="surround-segment-map"]')
        .getAttribute('data-density')).toBe('chips');
      const segs = [...container.querySelectorAll('[data-testid="surround-segment"]')];
      const shape = segs.map((seg) => ({
        state: seg.getAttribute('data-state'),
        chip: seg.querySelector('[data-testid="surround-segment-chip"]')?.textContent ?? null,
        named: !!seg.querySelector('.surround-segment-map__text-row'),
      }));
      expect(shape).toEqual([
        { state: 'elapsed', chip: 'I', named: false },
        { state: 'elapsed', chip: 'II', named: false },
        { state: 'active', chip: null, named: true },
        { state: 'future', chip: 'IV', named: false },
      ]);
      // The chip carries the gutter's mark WITHOUT its point — the same mark,
      // from the same table, so the two can never disagree.
      expect(container.querySelector('[data-state="active"] .surround-segment-map__numeral').textContent)
        .toBe('III.');
    });
  });

  it('keeps every name when the rule can afford them', () => {
    withRailGeometry({
      RAIL: 2000,
      'surround-segment-map__text-row': 197,
      'surround-segment-map__heading': 149,
      'surround-segment-map__text': 149,
    }, () => {
      const { container } = renderMap({ position: 2000 });
      expect(container.querySelector('[data-testid="surround-segment-map"]')
        .getAttribute('data-density')).toBe('names');
      expect(container.querySelectorAll('[data-testid="surround-segment-chip"]')).toHaveLength(0);
      expect(container.querySelectorAll('[data-testid="surround-segment"] .surround-segment-map__text-row'))
        .toHaveLength(4);
    });
  });

  /**
   * ONE NOTATION PER RAIL, AS RENDERED. `ROMAN` runs to XII, so a rail of
   * twenty-one used to set `… XI. XII. 13. 14. …` in one gutter.
   *
   * TO GO RED: take the style per segment instead of per rail.
   */
  it('sets one notation across a rail too long for the Roman table', () => {
    const many = {
      contentId: 'plex:696230',
      piece: { title: 'Nocturnes', musicEndsAt: 2100 },
      pieceSegments: Array.from({ length: 21 }, (_, i) => ({
        n: i + 1, name: `No. ${i + 1} in C major`, start: i * 100,
      })),
    };
    const { container } = renderMap({ data: many, position: 50, duration: 2200 });
    const marks = [...container.querySelectorAll('[data-testid="surround-segment"] .surround-segment-map__numeral')]
      .map((el) => el.textContent);
    expect(marks[0], 'the first mark on a twenty-one rail').toBe('1.');
    expect(marks[11], 'the twelfth — the last the Roman table can reach').toBe('12.');
    expect(marks[20]).toBe('21.');
    expect(marks.filter((m) => /[IVX]/.test(m)), 'two notations in one gutter').toEqual([]);
  });

  /**
   * A NAME THAT CANNOT BE SET WHOLE IS REPORTED, and at WARN — the guarantee is
   * "the sounding segment shows its name", so failing it is news. Debug never
   * reaches the log store, which is where this has to be visible: a trimmed name
   * looks like a trimmed name on screen whatever the reason, so the log is the
   * only thing that distinguishes "the rail is crowded" from "somebody authored
   * a name no screen can hold".
   *
   * TO GO RED: drop the warn to a debug, or let the accordion silently take what
   * it can get.
   */
  it('warns when even a chipped rail cannot give the sounding name its width', () => {
    withRailGeometry({
      RAIL: 120,
      'surround-segment-map__text-row': 400,
      'surround-segment-map__heading': 352,
      'surround-segment-map__text': 352,
    }, () => {
      const logger = makeLogger();
      renderMap({ position: 2000, logger });
      const warned = logger.warn.mock.calls.filter(([n]) => n === 'surround.accordion.degraded');
      expect(warned.length, 'the rail trimmed the sounding name and said nothing').toBe(1);
      expect(warned[0][1]).toMatchObject({ index: 2, density: 'chips', railPx: 120 });
      expect(warned[0][1].granted).toBeLessThan(warned[0][1].desired);
      expect(warned[0][1].label, 'the warn does not say WHICH label could not be set')
        .toBe('Scherzo. Allegro vivace');
    });
  });

  it('reports the side crossover, from both halves of the bond', () => {
    const logger = makeLogger();
    const dyn = { ...EROICA, definition: { band: { nowSide: 'dynamic' } } };
    const props = (position) => (
      <SegmentMap
        position={position} duration={DURATION} playing seeking={false}
        data={dyn} region={{ module: 'segment-map' }} logger={logger}
      />
    );
    const { rerender } = render(props(300));
    logger.debug.mockClear();
    rerender(props(2000));
    const sides = logger.debug.mock.calls.filter(([name]) => name === 'surround.band.side');
    expect(sides.length, 'the crossover left no trace anyone could confirm it by').toBe(1);
    expect(sides[0][1]).toMatchObject({ side: 'right', from: 'left' });
    expect(sides[0][1].fraction).toBeGreaterThan(0.5);
  });

  it('says nothing about a side that cannot change', () => {
    const logger = makeLogger();
    const props = (position) => (
      <SegmentMap
        position={position} duration={DURATION} playing seeking={false}
        data={EROICA} region={{ module: 'segment-map' }} logger={logger}
      />
    );
    const { rerender } = render(props(300));
    rerender(props(2500));
    expect(logger.debug.mock.calls.filter(([n]) => n === 'surround.band.side')).toHaveLength(0);
  });
});

/* ---------------------------------------------------------------------------
   THE COMPOSED RAIL — one frame across many media items.

   `payload.segments` is not `payload.pieceSegments` with a longer name. It is
   every PART's segments concatenated onto one sounding-time axis: each entry
   knows the media item it lives in (`contentId`), its span inside that item
   (`start`/`end`), and where it sits on the container (`offset`/`duration`).
   `pieceSegments` is only what the work itself authored, which for a seven-part
   recital is seven unplayable `work:` references and for a single polonaise is
   one entry or none. Drawing the wrong one is why a seven-polonaise container
   rendered as a single segment.

   Every fixture below is the shape `YamlSurroundStore` actually publishes —
   the Eroica's numbers are read off the production data volume — so a spec that
   passes here is a spec about the payload the frame is handed, not about a
   shape invented for a test.
   --------------------------------------------------------------------------- */
describe('SegmentMap — the composed rail', () => {
  /** Two études in one episode, one in another: three segments, two groups. */
  const TWO_OPUS = {
    contentId: 'plex:ep1',
    segments: [
      { n: 1, name: 'One', contentId: 'plex:ep1', start: 0, end: 10, offset: 0, duration: 10, part: 0, group: { work: 'a', title: 'Op. 10', index: 0 } },
      { n: 2, name: 'Two', contentId: 'plex:ep1', start: 10, end: 20, offset: 10, duration: 10, part: 0, group: { work: 'a', title: 'Op. 10', index: 0 } },
      { n: 1, name: 'Three', contentId: 'plex:ep2', start: 0, end: 20, offset: 20, duration: 20, part: 1, group: { work: 'b', title: 'Op. 25', index: 1 } },
    ],
    timeline: {
      totalSounding: 40,
      parts: [{ contentId: 'plex:ep1', index: 0, sounding: 20 }, { contentId: 'plex:ep2', index: 1, sounding: 20 }],
    },
  };

  /**
   * The recital the wave exists for: seven whole media items, seven works, and
   * therefore seven headings. Durations are the polonaises' real running times.
   */
  const POLONAISE_NAMES = [
    ['Polonaise No. 1 in C-sharp minor, Op. 26 No. 1', 543],
    ['Polonaise No. 2 in E-flat minor, Op. 26 No. 2', 456],
    ['Polonaise No. 3 in A major, Op. 40 No. 1', 292],
    ['Polonaise No. 4 in C minor, Op. 40 No. 2', 431],
    ['Polonaise No. 5 in F-sharp minor, Op. 44', 640],
    ['Polonaise No. 6 in A-flat major, Op. 53', 388],
    ['Polonaise-Fantaisie in A-flat major, Op. 61', 761],
  ];
  const POLONAISES = (() => {
    let offset = 0;
    const segments = POLONAISE_NAMES.map(([name, duration], i) => {
      const segment = {
        n: 1,
        name,
        contentId: `plex:69623${8 + i}`,
        part: i,
        start: 0,
        end: duration,
        offset,
        duration,
        group: { work: `chopin/polonaise-${i}`, title: name, index: i },
      };
      offset += duration;
      return segment;
    });
    return {
      contentId: 'plex:696238',
      piece: { title: 'Polonaises' },
      segments,
      timeline: {
        totalSounding: offset,
        parts: segments.map((c, i) => ({ contentId: c.contentId, index: i, sounding: c.duration })),
      },
    };
  })();

  /**
   * The Eroica as the store publishes it TODAY — one part, four segments, no
   * groups. Read off the production data volume: the first movement starts at
   * 21.35 s and the music stops at 2955, so the rail's sounding total is 2933.65
   * rather than the file's 3223.
   */
  const EROICA_COMPOSED = {
    contentId: 'plex:663134',
    piece: { title: 'Symphony No. 3', musicEndsAt: 2955 },
    segments: [
      { n: 1, name: 'Allegro con brio', contentId: 'plex:663134', part: 0, start: 21.35, end: 976, offset: 0, duration: 954.65 },
      { n: 2, name: 'Marcia funebre. Adagio assai', contentId: 'plex:663134', part: 0, start: 976, end: 1925, offset: 954.65, duration: 949 },
      { n: 3, name: 'Scherzo. Allegro vivace', contentId: 'plex:663134', part: 0, start: 1925, end: 2278, offset: 1903.65, duration: 353 },
      { n: 4, name: 'Finale. Allegro molto', contentId: 'plex:663134', part: 0, start: 2278, end: 2955, offset: 2256.65, duration: 677 },
    ],
    timeline: { totalSounding: 2933.65, parts: [{ contentId: 'plex:663134', index: 0, sounding: 2933.65 }] },
  };

  const labels = (container) =>
    [...container.querySelectorAll('[data-testid="surround-group-label"]')].map((e) => e.textContent);
  const bases = (container) =>
    [...container.querySelectorAll('[data-testid="surround-group-label"]')].map((e) => parseFloat(e.style.flexBasis));

  it('renders one segment per rail segment and one label per group', () => {
    const { container } = renderMap({ data: TWO_OPUS, position: 5, duration: 40 });
    expect(container.querySelectorAll('[data-testid="surround-segment"]')).toHaveLength(3);
    expect(labels(container)).toEqual(['Op. 10', 'Op. 25']);
  });

  it('renders an authored segment heading as its measured secondary line', () => {
    const headed = {
      ...TWO_OPUS,
      segments: TWO_OPUS.segments.map((segment) => ({
        ...segment,
        heading: 'Recitative (Accompanied — Tenor) · Isaiah 53:8',
      })),
    };
    const { container } = renderMap({ data: headed, position: 5, duration: 40 });
    expect([...container.querySelectorAll('[data-testid="surround-segment-translation"]')]
      .map((element) => element.textContent))
      .toEqual(Array(3).fill('Recitative (Accompanied — Tenor) · Isaiah 53:8'));
  });

  it('renders Parts above Scenes when a single work authors both hierarchy levels', () => {
    const hierarchy = {
      ...TWO_OPUS,
      segments: TWO_OPUS.segments.map((segment, index) => ({
        ...segment,
        group: { index: index < 2 ? 0 : 1, title: index < 2 ? 'Scene 1' : 'Scene 2' },
        hierarchy: { part: { index: index < 2 ? 0 : 1, title: index < 2 ? 'Part One' : 'Part Two' } },
      })),
    };
    const { container } = renderMap({ data: hierarchy, position: 5, duration: 40 });
    expect([...container.querySelectorAll('[data-testid="surround-part-group-label"]')].map((e) => e.textContent))
      .toEqual(['Part One', 'Part Two']);
    expect(labels(container)).toEqual(['Scene 1', 'Scene 2']);
  });

  /**
   * THE ACCEPTANCE CASE. Seven media items, seven works, one rail. Before this
   * wave the module drew `pieceSegments`, which for this container is seven
   * `work:` references with no timing — so the rail rendered as one segment or
   * as nothing at all.
   */
  it('draws seven polonaises as seven segments', () => {
    const { container } = renderMap({ data: POLONAISES, position: 0, duration: 543 });
    expect(container.querySelectorAll('[data-testid="surround-segment"]')).toHaveLength(7);
  });

  /**
   * A FLAT RAIL IS ONE TIER. Seven works, one segment each: the heading over a
   * segment names the same work the segment does, so the row printed
   * `Polonaise No. 1 in C-sharp minor, Op. 26 No. 1` above the rule and
   * `Polonaise in C-sharp minor, Op. 26 No. 1` below it — the same name, twice,
   * both cut short. The row is dropped, not hidden: the band's height is its
   * content.
   */
  it('prints NO heading row on a rail whose every heading names one segment', () => {
    const { container } = renderMap({ data: POLONAISES, position: 0, duration: 543 });
    expect(container.querySelectorAll('[data-testid="surround-segment"]')).toHaveLength(7);
    expect(container.querySelector('[data-testid="surround-segment-groups"]')).toBeNull();
    expect(container.querySelector('[data-testid="surround-segment-map"]').dataset.grouped).toBe('false');
  });

  /** Op. 10 spans two segments, so that heading is a heading and the row stays. */
  it('keeps the heading row where a heading spans more than one segment', () => {
    const { container } = renderMap({ data: TWO_OPUS, position: 5, duration: 40 });
    expect(labels(container)).toEqual(['Op. 10', 'Op. 25']);
  });

  /**
   * THE SEQUENCE THE VIEWER WANTS. Every part authored `n: 1` for its own single
   * movement — it is movement one OF ITS OWN WORK — so the gutter read `I.`
   * seven times and numbered nothing. On a flat rail the numeral counts along
   * the rail.
   */
  it('numbers a flat rail by position on the rail, not by the part’s own `n`', () => {
    const { container } = renderMap({ data: POLONAISES, position: 0, duration: 543 });
    const marks = [...container.querySelectorAll('.surround-segment-map__numeral')]
      .map((el) => el.textContent);
    expect(marks).toEqual(['I.', 'II.', 'III.', 'IV.', 'V.', 'VI.', 'VII.']);
  });

  /**
   * And a GROUPED rail keeps the corpus's own numbers, because there they match
   * the names printed beside them: étude 1 and étude 2 of Op. 10, then étude 1
   * of Op. 25 under its own heading. Renumbering that rail 1, 2, 3 would make
   * the gutter contradict the heading above it.
   */
  it('leaves a grouped rail’s authored numerals alone', () => {
    const { container } = renderMap({ data: TWO_OPUS, position: 5, duration: 40 });
    const marks = [...container.querySelectorAll('.surround-segment-map__numeral')]
      .map((el) => el.textContent);
    expect(marks).toEqual(['I.', 'II.', 'I.']);
  });

  /* ---------------------------------------------------------------------------
     THE SHORT LABEL (`short:` on an authored segment).

     Truncation assumes the distinguishing part of a name comes first. On a rail
     of works from one set it never does — seven polonaises truncate to seven
     `Pol…`, which is a rail that has spent its whole width saying nothing. The
     corpus answers with a second, deliberately short name for the crowded state;
     the sounding segment is unaffected, because it is the one segment the
     accordion guarantees room for.
     --------------------------------------------------------------------------- */
  const SHORT_LABELS = ['C-sharp', 'E-flat', 'Military', 'C minor', 'F-sharp', 'Heroic', 'Fantaisie'];
  const POLONAISES_SHORT = {
    ...POLONAISES,
    segments: POLONAISES.segments.map((c, i) => ({ ...c, short: SHORT_LABELS[i] })),
  };
  const headings = (container) =>
    [...container.querySelectorAll('[data-testid="surround-segment"]')]
      .map((el) => el.querySelector('.surround-segment-map__heading')?.textContent ?? null);
  const shorts = (container) =>
    [...container.querySelectorAll('[data-testid="surround-segment"]')]
      .map((el) => el.querySelector('[data-testid="surround-segment-short"]')?.textContent ?? null);

  it('sets a segment’s `short` label while it is not sounding', () => {
    const { container } = renderMap({ data: POLONAISES_SHORT, position: 0, duration: 543 });
    expect(shorts(container).slice(1)).toEqual(SHORT_LABELS.slice(1));
  });

  it('sets the SOUNDING segment’s whole name, never its short label', () => {
    const { container } = renderMap({ data: POLONAISES_SHORT, position: 0, duration: 543 });
    expect(shorts(container)[0]).toBeNull();
    expect(headings(container)[0]).toBe(POLONAISE_NAMES[0][0]);
  });

  /** One line, not two: the gloss belongs to the name, and the name is not here. */
  it('prints no gloss under a short label', () => {
    const glossed = {
      ...POLONAISES_SHORT,
      segments: POLONAISES_SHORT.segments.map((c) => ({ ...c, translation: 'A stately Polish dance' })),
    };
    const { container } = renderMap({ data: glossed, position: 0, duration: 543 });
    const segs = [...container.querySelectorAll('[data-testid="surround-segment"]')];
    expect(segs[1].querySelector('[data-testid="surround-segment-translation"]')).toBeNull();
    // The sounding one keeps both, exactly as it always has.
    expect(segs[0].querySelector('[data-testid="surround-segment-translation"]')).not.toBeNull();
  });

  /** An unauthored `short` changes nothing: the rail truncates as it always did. */
  it('falls back to the full name for a segment with no short label', () => {
    const partial = {
      ...POLONAISES,
      segments: POLONAISES.segments.map((c, i) => (i === 1 ? { ...c, short: 'E-flat' } : c)),
    };
    const { container } = renderMap({ data: partial, position: 0, duration: 543 });
    expect(shorts(container)[2]).toBeNull();
    expect(headings(container)[2]).toBe(POLONAISE_NAMES[2][0]);
  });

  it('takes segment widths from `duration`, not from the gaps between starts', () => {
    // Every part restarts its own clock at 0, so start deltas are meaningless
    // across a boundary: segment 3 starts at 0 in its own file having begun at
    // 20 s on the rail. Widths that read start deltas would make it zero-width.
    const w = widths(renderMap({ data: TWO_OPUS, position: 5, duration: 40 }).container);
    expect(w).toEqual([25, 25, 50]);
  });

  it('sizes each heading by the sounding seconds of the run it spans', () => {
    const b = bases(renderMap({ data: TWO_OPUS, position: 5, duration: 40 }).container);
    expect(b[0]).toBeCloseTo(50, 6);   // two ten-second études
    expect(b[1]).toBeCloseTo(50, 6);   // one twenty-second étude
  });

  /* ---------------------------------------------------------------------------
     NOTHING SOUNDING HAS TWO OPPOSITE MEANINGS, AND A COMPOSED RAIL COULD ONLY
     EVER SAY ONE OF THEM.

     `unsounded` asked whether the rail position was BEFORE the first segment's
     start. On a composed rail every position is measured in sounding seconds and
     the first segment starts at 0, so `railPosition < 0` is never true and the
     lead-in — the applause and the settling before the first note, which the
     store explicitly supports — painted the entire rule as already played.

     The same wrong answer covers the worse case. When the payload names a media
     item the rail has no segment for, `segmentAt` reports nothing sounding at
     second zero, and twenty-seven études rendered as a finished recital with no
     playhead. That state is not "the piece is over", it is "the rail cannot
     place the transport", and it is worth a warn: it is invisible on screen
     (a full rule looks like a full rule) and it is always a wiring fault.
     --------------------------------------------------------------------------- */
  it('reads the lead-in before the first note as NOT YET SOUNDED, not as finished', () => {
    const leadIn = {
      ...TWO_OPUS,
      segments: TWO_OPUS.segments.map((c) => ({ ...c, start: c.start + 30, end: c.end + 30 })),
    };
    // 12 s into episode 1, whose first étude does not begin until 30 s.
    expect(states(renderMap({ data: leadIn, position: 12, duration: 400 }).container))
      .toEqual(['future', 'future', 'future']);
  });

  it('paints nothing as played when the payload names a media item the rail has not got', () => {
    const logger = makeLogger();
    const stranger = { ...TWO_OPUS, contentId: 'plex:the-season-itself' };
    const { container } = renderMap({ data: stranger, position: 300, duration: 400, logger });
    expect(states(container)).toEqual(['future', 'future', 'future']);
    const warned = logger.warn.mock.calls.filter(([n]) => n === 'surround.rail.unmapped');
    expect(warned).toHaveLength(1);
    expect(warned[0][1]).toMatchObject({ contentId: 'plex:the-season-itself', segments: 3 });
  });

  it('does not cry unmapped when the rail simply has nothing sounding', () => {
    const logger = makeLogger();
    renderMap({ data: TWO_OPUS, position: 5, duration: 40, logger });
    expect(logger.warn.mock.calls.filter(([n]) => n === 'surround.rail.unmapped')).toHaveLength(0);
  });

  it('lights nothing while dead time plays', () => {
    const dead = {
      contentId: 'plex:ep1',
      segments: [{ n: 1, name: 'One', contentId: 'plex:ep1', start: 0, end: 10, offset: 0, duration: 10 }],
      timeline: { totalSounding: 10, parts: [{ contentId: 'plex:ep1', index: 0, sounding: 10 }] },
    };
    const { container } = renderMap({ data: dead, position: 12, duration: 30 });
    // The rail is DRAWN — asserting "nothing is active" against a rail that
    // rendered nothing at all is the vacuous pass this codebase has been bitten
    // by, and it is what an empty `segments` would give us here.
    expect(container.querySelectorAll('[data-testid="surround-segment"]')).toHaveLength(1);
    expect(container.querySelectorAll('.surround-segment-map__segment--active')).toHaveLength(0);
    expect(states(container)).toEqual(['elapsed']);
  });

  /**
   * The whole reason `segmentAt` takes a contentId. Position 5 is inside the
   * first étude of episode 1 and inside the third étude of episode 2, and the
   * only thing that tells the two apart is which file is playing.
   */
  it('resolves the sounding segment by the media item, not by the number alone', () => {
    expect(states(renderMap({ data: TWO_OPUS, position: 5, duration: 40 }).container))
      .toEqual(['active', 'future', 'future']);
    const inPartTwo = { ...TWO_OPUS, contentId: 'plex:ep2' };
    expect(states(renderMap({ data: inPartTwo, position: 5, duration: 40 }).container))
      .toEqual(['elapsed', 'elapsed', 'active']);
  });

  it('puts the playhead on the CONTAINER’s axis, not on the playing file’s', () => {
    // 5 s into episode 2 is 25 s along a 40 s rail — 62.5%. Reading the file's
    // own position instead would put it at 12.5%, inside the first étude.
    const { container } = renderMap({ data: { ...TWO_OPUS, contentId: 'plex:ep2' }, position: 5, duration: 40 });
    expect(headPct(container.querySelector('[data-testid="surround-playhead"]'))).toBeCloseTo(62.5, 3);
  });

  it('sweeps the sounding segment’s fill from the container’s own clock', () => {
    const { container } = renderMap({ data: { ...TWO_OPUS, contentId: 'plex:ep2' }, position: 5, duration: 40 });
    expect(fills(container)).toEqual([100, 100, 25]);
  });

  /**
   * A container may name the same work twice — a set played twice is two
   * appearances, and the store numbers them 0 and 1 for exactly this. Grouping
   * by the work SLUG would print one heading over both runs; grouping by object
   * identity cannot be done here at all, because the payload crosses the wire as
   * JSON and `JSON.parse` gives every segment its own group object. The index is
   * the identity that survives the crossing.
   */
  it('gives a work named twice two headings, not one', () => {
    // Two segments per run, because a run of one prints no heading at all now —
    // and this is a test about which heading a run gets, not about whether the
    // row is drawn.
    const pair = (work, title, index, part) => [0, 1].map((k) => ({
      n: k + 1,
      name: `${title} ${k + 1}`,
      contentId: `plex:ep${part}`,
      start: k * 10,
      end: (k + 1) * 10,
      offset: part * 20 + k * 10,
      duration: 10,
      group: { work, title, index },
    }));
    const twice = {
      contentId: 'plex:ep0',
      segments: [
        ...pair('a', 'Op. 10', 0, 0),
        ...pair('b', 'Nocturne', 1, 1),
        ...pair('a', 'Op. 10', 2, 2),
      ],
      timeline: { totalSounding: 60, parts: [] },
    };
    expect(labels(renderMap({ data: twice, position: 0, duration: 60 }).container))
      .toEqual(['Op. 10', 'Nocturne', 'Op. 10']);
  });

  it('renders NO heading row at all when nothing on the rail is grouped', () => {
    const { container } = renderMap({ data: EROICA_COMPOSED, position: 100, duration: DURATION });
    // Four segments first: "no heading row" is only a claim about a rail that
    // rendered, and an empty rail would satisfy the two assertions below for
    // entirely the wrong reason.
    expect(widths(container)).toHaveLength(4);
    expect(container.querySelector('[data-testid="surround-segment-groups"]')).toBeNull();
    expect(container.querySelector('[data-testid="surround-segment-map"]').className)
      .not.toContain('surround-segment-map--grouped');
  });

  /**
   * THE MIGRATION SAFETY NET. The Eroica's payload has carried a composed rail
   * since the store learned to publish one, so this module renders it through
   * the new path on every screen in the fleet. Four segments, in the same order,
   * proportional to the same music.
   */
  it('renders the Eroica as four segments, unchanged, through the composed path', () => {
    const { container } = renderMap({ data: EROICA_COMPOSED, position: 100, duration: DURATION });
    const w = widths(container);
    expect(w).toHaveLength(4);
    expect(w[0]).toBeCloseTo((954.65 / 2933.65) * 100, 3);
    expect(w[1]).toBeCloseTo((949 / 2933.65) * 100, 3);
    expect(w[2]).toBeCloseTo((353 / 2933.65) * 100, 3);
    expect(w[3]).toBeCloseTo((677 / 2933.65) * 100, 3);
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 6);
    expect(states(container)).toEqual(['active', 'future', 'future', 'future']);
  });

  /**
   * `musicEndsAt` is a fact about ONE file's applause. On a composed rail the
   * axis ends at the container's sounding total, and reading the piece's field
   * instead would end a 59-minute recital at the first polonaise's final chord.
   */
  it('ends the composed rail at the container’s sounding total, not at musicEndsAt', () => {
    const shortEnd = { ...POLONAISES, piece: { title: 'Polonaises', musicEndsAt: 543 } };
    const w = widths(renderMap({ data: shortEnd, position: 0, duration: 543 }).container);
    expect(w).toHaveLength(7);
    expect(w[0]).toBeCloseTo((543 / 3511) * 100, 3);
  });

  /**
   * A zero-duration segment is the store's documented "this segment's timing was
   * never authored". It has no width to draw and can never be current, so it is
   * dropped from the rail — and the active index has to survive the renumbering
   * that dropping it causes.
   */
  it('drops an untimed segment and still lights the right one after it', () => {
    const untimed = {
      contentId: 'plex:ep2',
      segments: [
        { n: 1, name: 'Timed', contentId: 'plex:ep1', start: 0, end: 10, offset: 0, duration: 10 },
        { n: 2, name: 'Untimed', contentId: 'plex:ep1', offset: 10, duration: 0 },
        { n: 1, name: 'After', contentId: 'plex:ep2', start: 0, end: 10, offset: 10, duration: 10 },
      ],
      timeline: { totalSounding: 20, parts: [] },
    };
    const { container } = renderMap({ data: untimed, position: 5, duration: 20 });
    expect(container.querySelectorAll('[data-testid="surround-segment"]')).toHaveLength(2);
    expect(states(container)).toEqual(['elapsed', 'active']);
  });

  /**
   * Both lists are present on every container payload, and they disagree: the
   * rail has seven entries and `pieceSegments` has seven references with no
   * timing at all. Reading the wrong one renders nothing.
   */
  it('prefers the composed rail over the piece’s own segment list', () => {
    const both = {
      ...POLONAISES,
      pieceSegments: POLONAISE_NAMES.map(([name], i) => ({ work: `chopin/polonaise-${i}`, name, start: undefined })),
    };
    expect(widths(renderMap({ data: both, position: 0, duration: 543 }).container)).toHaveLength(7);
  });

  it('falls back to the piece’s segments when the payload carries no rail', () => {
    // A payload built before the store published `segments` at all. Four
    // segments, off `pieceSegments`, exactly as the rest of this file asserts.
    expect(widths(renderMap({ position: 976 }).container)).toHaveLength(4);
  });

  it('reserves the heading row’s height so a long set title cannot grow the band', async () => {
    const rule = (await sass.compileAsync(path.join(__dirname, 'SegmentMap.scss'), {
      loadPaths: [path.join(__dirname, '..')],
    })).css;
    const block = rule.match(/\.surround-segment-map--grouped\s*\{[^}]*\}/)?.[0] ?? '';
    expect(block, 'the grouped rail no longer declares a reserved row height').toMatch(/--group-row:\s*[\d.]+rem/);
    expect(block, 'the grouped rail’s floor no longer accounts for the row').toMatch(/min-height:\s*calc\([^)]*--group-row/);
    const label = rule.match(/\.surround-segment-map__group\s*\{[^}]*\}/)?.[0] ?? '';
    expect(label, 'a heading that wraps is a band that changes height').toMatch(/white-space:\s*nowrap/);
    expect(label, 'a heading with no ellipsis is a heading cut mid-word').toMatch(/text-overflow:\s*ellipsis/);
  });
});

/* ---------------------------------------------------------------------------
   THE FOLD (design wave 10)

   Messiah's rail is the case this exists for: 53 numbered movements across
   three parts, chipped, on a rule that gives each of them ~32px. Two of those
   parts are not sounding, and before this wave they took 28% of the rail to say
   so — in bare integers nobody can read at ten feet and nobody can use up close.
   --------------------------------------------------------------------------- */
describe('SegmentMap — the fold', () => {
  /** Three parts, 4 + 3 + 4 movements, one second of sounding time each. */
  const MESSIAH = (() => {
    const parts = [['Part One', 4], ['Part Two', 3], ['Part Three', 4]];
    const segments = [];
    let offset = 0;
    let n = 0;
    parts.forEach(([title, count], index) => {
      for (let i = 0; i < count; i += 1) {
        n += 1;
        segments.push({
          n,
          name: `Movement ${n}`,
          contentId: 'plex:messiah',
          start: offset,
          end: offset + 10,
          offset,
          duration: 10,
          part: 0,
          group: { work: String(index), title, index },
          hierarchy: { part: { index, title } },
        });
        offset += 10;
      }
    });
    return {
      contentId: 'plex:messiah',
      segments,
      timeline: {
        totalSounding: offset,
        parts: [{ contentId: 'plex:messiah', index: 0, sounding: offset }],
      },
    };
  })();

  /**
   * The rail measured, exactly as `SegmentMap — logging the new decisions`
   * measures it — jsdom gives every box a zero rect, and a fold with no measured
   * label is a fold that is NOT TAKEN (which is itself one of the cases below).
   */
  const withRailGeometry = (rects, run) => {
    const rect = Element.prototype.getBoundingClientRect;
    const RO = globalThis.ResizeObserver;
    Element.prototype.getBoundingClientRect = function stub() {
      const hit = Object.keys(rects).find((cls) => this.classList?.contains(cls));
      const width = hit ? rects[hit] : 0;
      return { width, height: width ? 40 : 0, x: 0, y: 0, top: 0, left: 0, right: width, bottom: 40 };
    };
    globalThis.ResizeObserver = class {
      constructor(cb) { this.cb = cb; }
      observe(el) { this.cb([{ target: el, contentRect: { width: rects.RAIL ?? 0 } }]); }
      disconnect() {}
      unobserve() {}
    };
    try { return run(); } finally {
      Element.prototype.getBoundingClientRect = rect;
      globalThis.ResizeObserver = RO;
    }
  };

  /**
   * A measured rail whose part labels are 45px and whose count badge is 10px —
   * EVERY BOX HALVED from the 1000px rail this block used to describe, and the
   * halving is the point.
   *
   * A fold is a concession to a crowded rule now (`foldsForRoom` in
   * SegmentMap.jsx): a rail that can give every authored segment twice a chip's
   * width draws them all. Eleven movements on a 1000px rail is 91px each and
   * correctly folds NOTHING, so the old geometry could no longer describe a
   * folding rail at all. At 500px it is 45px each — under the threshold — and
   * because every other box came down by the same factor, every ratio the width
   * and density assertions below read is exactly the one they read before.
   */
  const MEASURED = {
    RAIL: 240,
    'surround-segment-map__text-row': 60,
    'surround-segment-map__text': 45,
    'surround-segment-map__heading': 45,
    'surround-segment-map__group': 45,
    'surround-segment-map__fold-count': 10,
  };

  const folds = (container) => [...container.querySelectorAll('[data-testid="surround-segment-fold"]')];
  const drawn = (container) => [...container.querySelectorAll('[data-testid="surround-segment"]')];

  it('folds every part except the one that is sounding', () => {
    withRailGeometry(MEASURED, () => {
      // 45s is inside Part Two (movements 5-7, 40s-70s).
      const { container } = renderMap({ data: MESSIAH, position: 45, duration: 110 });
      expect(folds(container).map((f) => f.dataset.title)).toEqual(['Part One', 'Part Three']);
      // Part Two's three movements are the only ones drawn as segments.
      expect(drawn(container).length).toBe(3);
    });
  });

  it('carries the count as a BADGE, not as another numeral', () => {
    withRailGeometry(MEASURED, () => {
      const { container } = renderMap({ data: MESSIAH, position: 45, duration: 110 });
      const badges = [...container.querySelectorAll('[data-testid="surround-fold-count"]')];
      expect(badges.map((b) => b.textContent)).toEqual(['4', '4']);
      // The badge is NOT the chip: a rail where the two carried one class is a
      // rail where "21" and "22" are the same kind of mark.
      badges.forEach((badge) => {
        expect(badge.classList.contains('surround-segment-map__chip')).toBe(false);
        expect(badge.classList.contains('surround-segment-map__numeral')).toBe(false);
      });
    });
  });

  it('does not hand a fold a share of the rail — it is sized by its label', () => {
    // WITHOUT `requestAnimationFrame` the widths SNAP to the solve rather than
    // easing to it over 420ms (`useEasedVector` — it is the reduced-motion
    // path). What is under test here is the solve, not the journey to it, and
    // reading a width mid-ease would be reading the interpolation.
    const raf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = undefined;
    try {
      withRailGeometry(MEASURED, () => {
        const { container } = renderMap({ data: MESSIAH, position: 45, duration: 110 });
        const [one, three] = folds(container);
        // Four of eleven movements is 36% of the rail by duration. The fold
        // takes the 45px label on a 240px rule instead — 18.75%, about half
        // what its duration would have claimed — and Part Two gets the rest.
        const foldPct = 45 / 240 * 100;
        expect(Number(one.style.width.replace('%', ''))).toBeCloseTo(foldPct, 3);
        expect(Number(three.style.width.replace('%', ''))).toBeCloseTo(foldPct, 3);
        const open = drawn(container).map((s) => Number(s.style.width.replace('%', '')));
        // The sounding segment takes the lion's share of what the folds freed.
        expect(Math.max(...open), 'the sounding segment is the one that grew')
          .toBeCloseTo(open[0], 6);
        expect(open.reduce((a, b) => a + b, foldPct * 2)).toBeCloseTo(100, 3);
      });
    } finally {
      globalThis.requestAnimationFrame = raf;
    }
  });

  it('keeps elapsed and future legible INSIDE the fold', () => {
    withRailGeometry(MEASURED, () => {
      const { container } = renderMap({ data: MESSIAH, position: 45, duration: 110 });
      const [one, three] = folds(container);
      expect(one.dataset.state).toBe('elapsed');
      expect(three.dataset.state).toBe('future');
    });
  });

  it('follows the playhead — the sounding part is the one that opens', () => {
    withRailGeometry(MEASURED, () => {
      const { container } = renderMap({ data: MESSIAH, position: 5, duration: 110 });
      expect(folds(container).map((f) => f.dataset.title)).toEqual(['Part Two', 'Part Three']);
      expect(drawn(container).length).toBe(4);
    });
  });

  /**
   * THE ROOM TEST. A fold is a concession to a crowded rule, not a house style.
   *
   * Chopin's Etudes is the case that found this: two opus runs on the office
   * screen's rule is ~52px a segment — more than twice a chip — and the band
   * still hatched Op. 10 away and printed "12" where twelve etudes had room to
   * be twelve marks. `MEASURED` above is deliberately crowded so every other
   * test in this block still describes a folding rail; this one gives the SAME
   * rail room and asserts it draws everything.
   *
   * TO GO RED: fold unconditionally again, as every version before this did.
   */
  it('folds NOTHING on a rule with room to draw every segment', () => {
    // 1100px over eleven movements is 100px each, four times a chip's width.
    withRailGeometry({ ...MEASURED, RAIL: 1100 }, () => {
      const { container } = renderMap({ data: MESSIAH, position: 45, duration: 110 });
      expect(folds(container)).toEqual([]);
      expect(drawn(container).length).toBe(11);
    });
  });

  it('folds NOTHING when nothing is sounding', () => {
    withRailGeometry(MEASURED, () => {
      // Past the last chord: every movement has sounded, and there is no
      // sounding part to fold the others around.
      const { container } = renderMap({ data: MESSIAH, position: 200, duration: 220 });
      expect(folds(container)).toEqual([]);
      expect(drawn(container).length).toBe(11);
    });
  });

  it('folds NOTHING on a rail it has not measured', () => {
    // No stub at all: every box is 0x0, so no label has a width, so no fold has
    // an honest one. The rail draws exactly what it drew before this wave.
    const { container } = renderMap({ data: MESSIAH, position: 45, duration: 110 });
    expect(folds(container)).toEqual([]);
    expect(drawn(container).length).toBe(11);
  });

  it('leaves a part open when its label is wider than the music it elides', () => {
    // A 600px label on a 1000px rail against four movements worth 36% of it:
    // the elision would be drawn bigger than the thing elided.
    withRailGeometry({ ...MEASURED, 'surround-segment-map__group': 600 }, () => {
      const { container } = renderMap({ data: MESSIAH, position: 45, duration: 110 });
      expect(folds(container)).toEqual([]);
    });
  });

  it('reports what it folded and what it sized the folds by', () => {
    withRailGeometry(MEASURED, () => {
      const logger = makeLogger();
      renderMap({ data: MESSIAH, position: 45, duration: 110, logger });
      const [entry] = logger.debug.mock.calls
        .filter(([name]) => name === 'surround.rail.fold').slice(-1);
      expect(entry[1]).toMatchObject({ runs: 2, folded: 2, hiddenSegments: 6, of: 11 });
    });
  });

  /* -------------------------------------------------------------------------
     THE ANCESTORS-AUTHORED RAIL — the shape `nested` actually gates on.

     Every fold test above runs `MESSIAH`, which authors `hierarchy.part` — the
     LEGACY two-level transport shape. `nested` (SegmentMap.jsx) only goes true
     for `ancestors.length > 1`, so `MESSIAH` never takes the
     `collapseInactiveGroups` branch, and `drawnRail` there is `placedRail`
     unchanged: no test above ever exercised a rail where a fold's `drawnRail`
     position and its true segment count actually diverge. That divergence is
     exactly what a coordinate-space fix has to get right — a folded Part is
     ONE `drawnRail` entry standing for several, and everything that reads its
     `count` has to agree on which of the two numbers it means. --------------
  */
  const MESSIAH_ANCESTORS = (() => {
    // Part One and Part Three each carry two Scenes, so `foldSceneCounts` has
    // something to count; Part Two (the one left sounding) is single-scene,
    // which keeps its own segments unaffected by any of this.
    const parts = [
      ['Part One', [['Scene 1', 2], ['Scene 2', 2]]],
      ['Part Two', [['Scene 3', 3]]],
      ['Part Three', [['Scene 4', 1], ['Scene 5', 3]]],
    ];
    const segments = [];
    let offset = 0;
    let n = 0;
    let sceneIndex = 0;
    parts.forEach(([partTitle, scenes], partIndex) => {
      scenes.forEach(([sceneTitle, count]) => {
        const thisScene = sceneIndex;
        sceneIndex += 1;
        for (let i = 0; i < count; i += 1) {
          n += 1;
          segments.push({
            n,
            name: `Movement ${n}`,
            contentId: 'plex:messiah-ancestors',
            start: offset,
            end: offset + 10,
            offset,
            duration: 10,
            part: 0,
            ancestors: [
              { index: partIndex, title: partTitle },
              { index: thisScene, title: sceneTitle },
            ],
          });
          offset += 10;
        }
      });
    });
    return {
      contentId: 'plex:messiah-ancestors',
      segments,
      timeline: {
        totalSounding: offset,
        parts: [{ contentId: 'plex:messiah-ancestors', index: 0, sounding: offset }],
      },
    };
  })();

  /**
   * ON A NESTED (ancestors) RAIL THE WAVE-10 BOX NEVER TAKES. `foldedShares`
   * (band.js) gives every `collapsed` marker a fixed, tiny placeholder share
   * (`FOLD_SHARE` = 3.5% of the rule) as its NATURAL width — that is always
   * narrower than a Part label, so `folded`'s own "does eliding save space"
   * comparison always says no, and the marker draws through the ordinary
   * per-segment branch instead. That is a pre-existing fact of `foldedShares`,
   * unrelated to this file's coordinate-space bug, and unlike `MESSIAH`
   * (legacy `hierarchy.part`, never `collapsed`, so it DOES take the box) an
   * ancestors-based rail can never exercise `folds(container)`
   * (`data-testid="surround-segment-fold"` on the box). What DOES have to be
   * right here is what the merged marker itself carries.
   */
  it('collapses a Part>Scene>Number (ancestors) rail to one drawn segment per inactive Part', () => {
    withRailGeometry(MEASURED, () => {
      // 45s is inside Part Two (movements 5-7, 40s-70s) — same layout as MESSIAH.
      const { container } = renderMap({ data: MESSIAH_ANCESTORS, position: 45, duration: 110 });
      // Part Two's three movements are the only ones drawn as individual segments —
      // `collapseInactiveGroups` merged Part One and Part Three to one entry each,
      // so `drawnRail` has 5 positions (2 folds + 3 open), not the authored 11.
      expect(drawn(container).length).toBe(5);
      const collapsed = drawn(container).filter((s) => s.dataset.fold !== undefined);
      expect(collapsed.map((s) => s.dataset.fold)).toEqual(['4', '4']);
    });
  });

  it('badges a collapsed ancestors Part with its true segment count and scene count', () => {
    // A narrow rail with wide names — the geometry `railWearsChips` needs to
    // pick chip density, which is the ONLY place a nested fold's scene-count
    // suffix (`foldSceneCounts`) is drawn today: the named-mode text row has
    // no badge at all for a collapsed segment, and the wave-10 box (above)
    // structurally never takes here.
    withRailGeometry({
      RAIL: 400,
      'surround-segment-map__text-row': 197,
      'surround-segment-map__heading': 149,
      'surround-segment-map__text': 149,
    }, () => {
      const { container } = renderMap({ data: MESSIAH_ANCESTORS, position: 45, duration: 110 });
      const chips = [...container.querySelectorAll('.surround-segment-map__chip--fold')];
      // Both folded Parts stand for 4 original movements each (2 Scenes of 2,
      // and 1 Scene of 1 + 1 Scene of 3) — the number `collapseInactiveGroups`
      // carried on the merged marker — over 2 Scenes each. Getting "4/2" here
      // instead of "1/…" or a blank scene count is what this file's
      // coordinate-space fix has to deliver for a real ancestors rail, not
      // just for the legacy `hierarchy.part` shape `MESSIAH` exercises.
      // TWO ELEMENTS AND A DRAWN RULE, not one string with a slash in it. The
      // slash was a character in the type stream, and inside the old
      // `display: grid` chip it was the thing that ended up alone on a second
      // line — the band painted "4" over "/2". Asserting the numbers
      // separately is also what keeps this test honest about the divider being
      // CSS: a concatenated `textContent` would read '42' and say nothing.
      expect(chips.map((c) => c.querySelector('.surround-segment-map__fold-segments').textContent))
        .toEqual(['4', '4']);
      expect(chips.map((c) => c.querySelector('.surround-segment-map__fold-scenes').textContent))
        .toEqual(['2', '2']);
    });
  });

  it('does not spill a fold’s true segment count into the segments drawn after it', () => {
    // The regression this guards: if a fold's TRUE count (4) were used as an
    // array-position span instead of its actual one `drawnRail` slot anywhere
    // that walks `drawnRail`/`segments`/`shares` by position (`groupBasis`,
    // the accordion's own width pass), it would walk past the fold into Part
    // Two's own open segments. All three of Part Two's segments must still be
    // individually drawn, in order, none suppressed.
    withRailGeometry(MEASURED, () => {
      const { container } = renderMap({ data: MESSIAH_ANCESTORS, position: 45, duration: 110 });
      const open = drawn(container).filter((s) => s.dataset.fold === undefined);
      expect(open.length).toBe(3);
      expect(open.map((s) => s.dataset.index)).toEqual(['1', '2', '3']);
      open.forEach((s) => expect(Number(s.style.width.replace('%', ''))).toBeGreaterThan(0));
      // The Part heading row's widths must sum to whole (100%), not overrun
      // it — `groupBasis` walking a fold's inflated true count past its own
      // one drawn-rail slot would double-count Part Two's shares into Part
      // One's or Part Three's heading width.
      const bases = [...container.querySelectorAll('[data-testid="surround-part-group-label"]')]
        .map((e) => parseFloat(e.style.flexBasis));
      expect(bases.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 3);
    });
  });
});

/* ---------------------------------------------------------------------------
   THE SEGMENT'S FIELD VOCABULARY

   `name:` and `heading:` were both plausible words for "what this movement is
   called", so an author had to read the renderer to find out which was which.
   The four fields are now named by where they go and what they say.
   --------------------------------------------------------------------------- */
describe('SegmentMap — label / heading / subheading', () => {
  const ONE = (segment) => ({
    contentId: 'plex:one',
    segments: [{
      n: 1, contentId: 'plex:one', start: 0, end: 10, offset: 0, duration: 10, part: 0, ...segment,
    }],
    timeline: { totalSounding: 10, parts: [{ contentId: 'plex:one', index: 0, sounding: 10 }] },
  });
  // NOT the first `__heading` in the document — that one belongs to the ruler,
  // which is always empty between passes (see `__probe`).
  const headingOf = (c) => c.querySelector(
    '[data-testid="surround-segment"] .surround-segment-map__heading',
  )?.textContent;
  const glossOf = (c) => c.querySelector('[data-testid="surround-segment-translation"]')?.textContent;

  it('prints `label` on the rail', () => {
    const { container } = renderMap({ data: ONE({ label: 'He trusted in God' }), position: 5, duration: 10 });
    expect(headingOf(container)).toBe('He trusted in God');
  });

  it('still prints `name` for a work the corpus has not migrated yet', () => {
    // 194 files author `name:`; they migrate as a batch, not atomically with a
    // build, and a blank rail in the meantime is the worse outcome.
    const { container } = renderMap({ data: ONE({ name: 'Allegro con brio' }), position: 5, duration: 10 });
    expect(headingOf(container)).toBe('Allegro con brio');
  });

  it('prefers `label` when a segment carries both', () => {
    const { container } = renderMap({
      data: ONE({ label: 'The new one', name: 'The old one' }), position: 5, duration: 10,
    });
    expect(headingOf(container)).toBe('The new one');
  });

  it('sets the billing — performance, then source — as the annotation line', () => {
    const { container } = renderMap({
      data: ONE({ label: 'He trusted in God', subheading: 'Chorus', heading: 'Psalm 22:8' }),
      position: 5,
      duration: 10,
    });
    expect(glossOf(container)).toBe('Chorus · Psalm 22:8');
  });

  it('renders NO annotation element when a segment authors none of it', () => {
    // Never an empty line holding space — the band's height is its content.
    const { container } = renderMap({ data: ONE({ label: 'Sinfonia' }), position: 5, duration: 10 });
    expect(glossOf(container)).toBeUndefined();
  });

  it('never puts the lyric `text` on the rail', () => {
    const { container } = renderMap({
      data: ONE({ label: 'He trusted in God', text: 'He trusted in God that He would deliver Him:\nlet Him deliver Him.' }),
      position: 5,
      duration: 10,
    });
    expect(container.textContent).not.toContain('let Him deliver Him');
  });
});
