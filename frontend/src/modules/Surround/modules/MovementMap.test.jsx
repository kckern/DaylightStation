import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import * as sass from 'sass-embedded';
import MovementMap from './MovementMap.jsx';
import { ACCORDION_MS } from '../band.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const makeLogger = () => ({
  debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), sampled: vi.fn(),
});

// The Eroica, measured: 4 movements, 3223 s of file, music ends at ~2955 s and
// the remaining 4½ minutes are applause.
const EROICA = {
  contentId: 'plex:663134',
  piece: { title: 'Symphony No. 3', musicEndsAt: 2955 },
  movements: [
    { n: 1, name: 'Allegro con brio', start: 0, translation: 'Fast, with spirit' },
    { n: 2, name: 'Marcia funebre. Adagio assai', start: 976, translation: 'Funeral march — very slow' },
    // Deliberately unauthored — the absent-field case, asserted below.
    { n: 3, name: 'Scherzo. Allegro vivace', start: 1925 },
    { n: 4, name: 'Finale. Allegro molto', start: 2278, translation: 'Finale — very fast' },
  ],
};
const DURATION = 3223;

const renderMap = (props = {}) => render(
  <MovementMap
    position={props.position ?? 0}
    duration={props.duration ?? DURATION}
    playing={props.playing ?? true}
    seeking={props.seeking ?? false}
    data={props.data === undefined ? EROICA : props.data}
    region={props.region ?? { module: 'movement-map', height: 60 }}
    logger={props.logger ?? makeLogger()}
  />,
);

const widths = (container) =>
  [...container.querySelectorAll('[data-testid="surround-movement"]')]
    .map((el) => parseFloat(el.style.width));

const states = (container) =>
  [...container.querySelectorAll('[data-testid="surround-movement"]')]
    .map((el) => el.getAttribute('data-state'));

/**
 * How full each movement's rule reads, in percent.
 *
 * Design wave 5 moved the fill from `width: N%` to `transform: scaleX(--fill)`
 * — the stylesheet explains why (a painted box's size is pixel-snapped, a
 * transform's is not, and at a movement-per-few-hundred-pixels that is the
 * difference between a glide and a crawl). The FRACTION the component computes
 * is unchanged; only where it is published moved, so these specs read the
 * custom property the same way they used to read the width.
 */
const fills = (container) =>
  [...container.querySelectorAll('[data-testid="surround-movement-fill"]')]
    .map((el) => parseFloat(el.style.getPropertyValue('--fill')) * 100);

/** Where the cursor is, in percent — see `fills` above for the property move. */
const headPct = (el) => parseFloat(el.style.getPropertyValue('--head')) * 100;

describe('MovementMap', () => {
  it('lays out segments proportional to each movement’s real duration', () => {
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
    // Span becomes 613 (not 3223): only movement 1 (start 0) fits inside it,
    // and its width reads against that shorter span.
    expect(w[0]).toBeCloseTo((613 / 613) * 100, 3);
  });

  it('falls back to duration when the piece declares no musicEndsAt', () => {
    const noEnd = { ...EROICA, piece: { title: 'Symphony No. 3' } };
    const w = widths(renderMap({ data: noEnd }).container);
    expect(w[0]).toBeCloseTo((976 / 3223) * 100, 3);
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 6);
  });

  it('marks movement 2 active at position 976', () => {
    const { container } = renderMap({ position: 976 });
    expect(states(container)).toEqual(['elapsed', 'active', 'future', 'future']);
  });

  it('keeps movement 1 active one second before the next movement starts', () => {
    const { container } = renderMap({ position: 975 });
    expect(states(container)).toEqual(['active', 'future', 'future', 'future']);
  });

  it('treats every movement as elapsed once the music has ended', () => {
    const { container } = renderMap({ position: 3100 }); // in the applause
    expect(states(container)).toEqual(['elapsed', 'elapsed', 'elapsed', 'elapsed']);
  });

  it('moves the playhead in the same render as a seek', () => {
    const { container, rerender } = renderMap({ position: 0 });
    const head = () => container.querySelector('[data-testid="surround-playhead"]');
    expect(headPct(head())).toBeCloseTo(0, 6);

    rerender(
      <MovementMap
        position={1477}
        duration={DURATION} playing seeking={false}
        data={EROICA} region={{ module: 'movement-map' }} logger={makeLogger()}
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
  it('separates movements with one quiet barline — one fewer than the segments', () => {
    const { container } = renderMap();
    expect(container.querySelectorAll('.surround-movement-map__barline--separator')).toHaveLength(3);
    expect(container.querySelectorAll('.surround-movement-map__barline--double')).toHaveLength(0);
  });

  it('renders a single movement with no separator at all', () => {
    const solo = { contentId: 'x', piece: {}, movements: [{ n: 1, name: 'Allegro', start: 0 }] };
    const { container } = renderMap({ data: solo, duration: 600 });
    expect(container.querySelectorAll('[data-testid="surround-movement"]')).toHaveLength(1);
    expect(container.querySelectorAll('.surround-movement-map__barline--separator')).toHaveLength(0);
  });

  it('sets the tempo term apart from the movement title, as an engraved score does', () => {
    const { container } = renderMap();
    const segs = [...container.querySelectorAll('[data-testid="surround-movement"]')];
    // "Marcia funebre. Adagio assai" → title roman, tempo italic.
    expect(segs[1].querySelector('.surround-movement-map__title')).toHaveTextContent('Marcia funebre.');
    expect(segs[1].querySelector('.surround-movement-map__tempo')).toHaveTextContent('Adagio assai');
    // A bare tempo marking is all italic — there is no title half.
    expect(segs[0].querySelector('.surround-movement-map__title')).toBeNull();
    expect(segs[0].querySelector('.surround-movement-map__tempo')).toHaveTextContent('Allegro con brio');
  });

  it('numbers movements with roman numerals from `n`', () => {
    const { container } = renderMap();
    const numerals = [...container.querySelectorAll('.surround-movement-map__numeral')]
      .map((el) => el.textContent);
    expect(numerals).toEqual(['I.', 'II.', 'III.', 'IV.']);
  });

  it('renders nothing and does not throw when there are no movements', () => {
    let result;
    expect(() => { result = renderMap({ data: { contentId: 'x', piece: {}, movements: [] } }); }).not.toThrow();
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

  it('sweeps the sounding movement’s rule from its own start, not the piece’s', () => {
    // 1450s is 474s into movement II (976→1925 = 949s long).
    const { container } = renderMap({ position: 1450 });
    const f = fills(container);
    expect(f).toHaveLength(4);
    expect(f[0]).toBeCloseTo(100, 6);                       // done
    expect(f[1]).toBeCloseTo((474 / 949) * 100, 3);         // sounding
    expect(f[2]).toBeCloseTo(0, 6);                         // still to come
    expect(f[3]).toBeCloseTo(0, 6);
  });

  it('starts the sounding movement’s fill at zero on its first second', () => {
    const { container } = renderMap({ position: 976 });
    expect(fills(container)[1]).toBeCloseTo(0, 6);
  });

  it('reads every movement as fully filled once the music has ended', () => {
    const { container } = renderMap({ position: 3100 });      // in the applause
    expect(fills(container)).toEqual([100, 100, 100, 100]);
  });

  // A position one tick before the next movement starts can never make the
  // raw (position - start) / length fraction leave [0, 1] here: `activeIndex`
  // and each segment's `stop` both derive from the same `end`, so an in-range
  // position is structurally incapable of pushing a sounding movement's
  // fraction above 1 — that version of this test passed whether or not
  // `clamp01` was even called.
  //
  // The one place the raw fraction CAN go out of bounds is below zero: a
  // position a hair before the piece's own start (plausible clock skew right
  // as playback begins) divides by movement 1's length and goes negative
  // before the clamp catches it. That is what this drives.
  it('never lets a fill run past its own segment', () => {
    const { container } = renderMap({ position: -0.5 });
    const f = fills(container);
    expect(f).toHaveLength(4);
    // Without clamp01 this would render -0.05..., not 0.
    expect(f[0]).toBe(0);
    f.forEach((value) => {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    });
  });

  // The lit tip was the "glowing worm" the design review killed. Its absence is
  // asserted, not merely uncommented: an element is easy to reintroduce.
  it('has no lit playhead tip — the cursor is one plain hairline', () => {
    const { container } = renderMap({ position: 1450 });
    expect(container.querySelector('.surround-movement-map__playhead-edge')).toBeNull();
    expect(container.querySelector('[data-testid="surround-playhead"]').childElementCount).toBe(0);
  });

  it('logs the movement change once, with the contentId', () => {
    const logger = makeLogger();
    const { rerender } = renderMap({ position: 0, logger });
    const changes = () => logger.debug.mock.calls.filter((c) => c[0] === 'surround.movement.change');
    expect(changes()).toHaveLength(1);
    expect(changes()[0][1]).toMatchObject({ contentId: 'plex:663134', n: 1 });

    const at = (position) => rerender(
      <MovementMap
        position={position} duration={DURATION} playing seeking={false}
        data={EROICA} region={{ module: 'movement-map' }} logger={logger}
      />,
    );
    at(500);   // still movement 1 — no new event
    expect(changes()).toHaveLength(1);
    at(1000);  // now movement 2
    expect(changes()).toHaveLength(2);
    expect(changes()[1][1]).toMatchObject({ n: 2, name: 'Marcia funebre. Adagio assai' });
  });
});

/**
 * The design of this band is mostly CSS, and the vitest config runs `css: false`
 * — so `import './MovementMap.scss'` injects nothing and a computed-style
 * assertion off a plain render would read UA defaults and pass regardless. These
 * specs compile the REAL stylesheet with the project's sass and inject it, the
 * pattern ComposerCard.test.jsx established, so a regression in the shipped file
 * fails here rather than on the wall.
 */
describe('MovementMap — the band’s shipped design', () => {
  let injected = null;
  const withStyles = () => {
    const compiled = sass.compile(path.join(__dirname, 'MovementMap.scss'));
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
    expect(window.getComputedStyle(head).getPropertyValue('transition')).toBe('transform 120ms linear');
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
    const head = ruleFor('.surround-movement-map__playhead');
    expect(head).toMatch(/transform:\s*translateX\(/);
    expect(head).toMatch(/transition:\s*transform 120ms linear/);
    expect(head, 'the playhead is back on a pixel-snapped `left`').not.toMatch(/transition:[^;]*\bleft\b/);

    const fill = ruleFor('.surround-movement-map__bar-fill');
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
    const fill = container.querySelector('[data-testid="surround-movement-fill"]');
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
    const heading = container.querySelector('.surround-movement-map__heading');
    const style = window.getComputedStyle(heading);
    expect(style.getPropertyValue('white-space')).toBe('nowrap');
    expect(style.getPropertyValue('text-overflow')).toBe('ellipsis');
    expect(style.getPropertyValue('overflow')).toBe('hidden');

    // WRAP OR ELLIPSIS, NEVER BOTH — wave 5's law, still binding, now landing
    // on the other branch: `text-overflow` is the correct idiom precisely
    // because this box is single-line again, and the clamp that would
    // contradict it must be gone from the compiled sheet.
    const rule = css.match(/\.surround-movement-map__heading\s*\{[^}]*\}/);
    expect(rule, 'no heading rule in the compiled sheet').not.toBeNull();
    expect(rule[0], 'the heading still declares a line clamp beside an ellipsis')
      .not.toMatch(/-webkit-line-clamp/);
    expect(rule[0], 'the heading still caps its own height for a wrap it can no longer do')
      .not.toMatch(/max-height/);
  });

  it('drops the container-query tier the gloss used to wrap under', () => {
    // The live-defects round gave the gloss a two-line tier gated on a 700px
    // container query. Design wave 7 supersedes it: the accordion shows the
    // sounding movement's gloss whole without costing the band 14px of height
    // at every screen and for every segment. Removed, not left dormant — a
    // dormant tier is a second mechanism waiting to fire.
    const css = withStyles().replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css, 'the superseded gloss container query is still in the sheet')
      .not.toMatch(/@container movement-map/);
    expect(css, 'the band is still a query container nothing queries')
      .not.toMatch(/container-type:/);
  });

  // Read off the compiled sheet rather than off computed style: happy-dom does
  // not resolve `rem` in getComputedStyle, and a NaN comparison is the kind of
  // assertion that passes for the wrong reason.
  it('claims a band tall enough for those two lines — and not a pixel of dead slack', () => {
    const css = withStyles();
    const rule = css.match(/\.surround-movement-map\s*\{[^}]*\}/);
    expect(rule, 'no .surround-movement-map rule in the compiled sheet').not.toBeNull();
    const declared = rule[0].match(/min-height:\s*([\d.]+)(rem|px)/);
    expect(declared, 'the band declares no min-height').not.toBeNull();
    const px = declared[2] === 'rem' ? parseFloat(declared[1]) * 16 : parseFloat(declared[1]);

    // The floor is TYPOGRAPHIC and both bounds are load-bearing.
    // Lower: the lane (4px) + the heading's clearance (0.55em of 1.05rem) + two
    // lines of heading (2 x 1.05rem x 1.15) + the module's own bottom padding
    // (0.55rem) — anything less clips the second line of "Marcia funebre.
    // Adagio assai" against `overflow: hidden`.
    const floor = 4 + (0.55 * 1.05 * 16) + (2 * 1.05 * 1.15 * 16) + (0.55 * 16);
    expect(px, 'the band cannot hold two lines of movement name').toBeGreaterThanOrEqual(floor);
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
  it('puts the rule row above the movement names, tight to the top of the band', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    const { container } = renderMap({ position: 300 });

    // Source order: bar, then the text row (numeral gutter + text column),
    // inside each segment.
    const segment = container.querySelector('.surround-movement-map__segment');
    const classes = [...segment.children].map((el) => el.className);
    const bar = classes.findIndex((c) => c.includes('__bar'));
    const row = classes.findIndex((c) => c.includes('__text-row'));
    expect(bar).toBeGreaterThanOrEqual(0);
    expect(row).toBeGreaterThan(bar);

    // Both stacking boxes start at the top, not the bottom.
    expect(css).toMatch(/\.surround-movement-map \{[^}]*align-items: flex-start/);
    expect(css).toMatch(/\.surround-movement-map__rule \{[^}]*align-items: flex-start/);
    expect(css).toMatch(/\.surround-movement-map__segment \{[^}]*justify-content: flex-start/);

    // No top padding: the band's first pixel is the rule lane, which is what
    // puts it inside `--band-overlap` rather than below it.
    const pad = css.match(/\.surround-movement-map \{[^}]*padding: ([^;]+);/)?.[1] ?? '';
    expect(pad.trim().split(/\s+/)[0]).toBe('0');

    // The playhead and the barlines hang from the top edge with it.
    expect(css).toMatch(/\.surround-movement-map__playhead \{[^}]*top: 0/);
    expect(css).toMatch(/\.surround-movement-map__barline \{[^}]*top: 0/);
    // The clearance under the rule lane is TOP padding on the text row (design
    // wave 7 — the row is the box that has to clear the lane now that the
    // numeral shares it with the heading). The runtime gate measures the
    // HEADING's box, which starts after that padding, so the wave-4 clearance
    // law reads exactly what it always did.
    const rowRule = css.match(/\.surround-movement-map__text-row \{[^}]*\}/);
    expect(rowRule, 'no text-row rule in the compiled sheet').not.toBeNull();
    expect(rowRule[0]).toMatch(/padding: [\d.]+em/);
    expect(css).not.toMatch(/\.surround-movement-map__heading \{[^}]*margin-bottom:/);
  });

  /**
   * "Yet-to-come progress is too dark — I can't see the context." The lane a
   * movement has not reached yet is the SHAPE OF THE PIECE, and at a 28%-alpha
   * `--programme-edge` hairline it was invisible on the near-black band.
   *
   * The ladder asserted here is the design: a lane bright enough to read, an
   * elapsed fill brighter than the lane it covers, and the sounding movement
   * louder than both. Weight and colour are checked from the compiled sheet
   * (happy-dom will not resolve the tokens), heights from computed style.
   */
  it('keeps the yet-to-come track visible, under a brighter elapsed fill', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    const { container } = renderMap({ position: 300 });

    // The lane: the rail's own soft ink, not the near-invisible edge token.
    const lane = css.match(/\.surround-movement-map__bar::before \{([^}]*)\}/)?.[1] ?? '';
    expect(lane).toBeTruthy();
    expect(lane).toMatch(/background: var\(--ink-soft,/);
    expect(lane).not.toMatch(/--programme-edge/);
    expect(parseFloat(lane.match(/height: ([\d.]+)px/)[1])).toBeGreaterThanOrEqual(2);
    expect(parseFloat(lane.match(/opacity: ([\d.]+)/)[1])).toBeGreaterThanOrEqual(0.5);

    // The elapsed fill is BRIGHTER than the lane it is drawn over — otherwise
    // "done" and "still to come" would be the same mark at the same weight.
    const fill = css.match(/\.surround-movement-map__bar-fill \{([^}]*)\}/)?.[1] ?? '';
    expect(fill).toMatch(/background: var\(--ink,/);

    // ...and the sounding movement is still the loudest thing on the band.
    const active = css.match(/--active \.surround-movement-map__bar-fill \{([^}]*)\}/)?.[1] ?? '';
    expect(active).toMatch(/background: var\(--brass,/);
    const px = (s) => parseFloat(s.match(/height: ([\d.]+)px/)[1]);
    expect(px(active)).toBeGreaterThan(px(fill));

    // A future movement's NAME is legible too, and — deliberately — brighter
    // than an elapsed one's: what is coming is the context, what is gone is not.
    const future = css.match(/--future \.surround-movement-map__heading \{([^}]*)\}/)?.[1] ?? '';
    const elapsed = css.match(/--elapsed \.surround-movement-map__heading \{([^}]*)\}/)?.[1] ?? '';
    expect(future).toMatch(/color: var\(--ink,/);
    expect(parseFloat(future.match(/opacity: ([\d.]+)/)[1]))
      .toBeGreaterThan(parseFloat(elapsed.match(/opacity: ([\d.]+)/)[1]));

    // The lane exists under every segment, whatever its state.
    expect(container.querySelectorAll('.surround-movement-map__bar')).toHaveLength(4);
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
describe('MovementMap — the movement translations', () => {
  let injected = null;
  const withStyles = () => {
    const compiled = sass.compile(path.join(__dirname, 'MovementMap.scss'));
    injected = document.createElement('style');
    injected.textContent = compiled.css;
    document.head.appendChild(injected);
    return compiled.css;
  };
  afterEach(() => { injected?.remove(); injected = null; });

  const translations = (container) =>
    [...container.querySelectorAll('[data-testid="surround-movement-translation"]')]
      .map((el) => el.textContent);

  it('writes the translation under the heading it glosses, in the same text column', () => {
    const { container } = renderMap();
    const first = container.querySelector('[data-testid="surround-movement"]');
    // Design wave 7: both live inside the TEXT COLUMN, beside the numeral's
    // gutter — that shared parent is what makes them share a left edge.
    const cell = first.querySelector('.surround-movement-map__text');
    expect(cell, 'the segment has no text column').not.toBeNull();
    const classes = [...cell.children].map((el) => el.className);
    const heading = classes.findIndex((c) => c.includes('__heading'));
    const gloss = classes.findIndex((c) => c.includes('__translation'));
    expect(gloss, 'the translation is not in the text column at all').toBeGreaterThanOrEqual(0);
    expect(gloss, 'the gloss is written above the name it glosses').toBeGreaterThan(heading);
    // ...and the numeral is NOT in that column: it is an index mark in its own
    // fixed track, which is the whole point of design wave 7's gutter.
    expect(cell.querySelector('.surround-movement-map__numeral'),
      'the numeral is back inside the text column — the gloss will start under it')
      .toBeNull();
    expect(translations(container)).toEqual([
      'Fast, with spirit', 'Funeral march — very slow', 'Finale — very fast',
    ]);
  });

  it('renders NO element for a movement with no authored translation', () => {
    // Three of the four movements are authored, and the unauthored one must
    // leave nothing behind — not an empty span holding a line of the band's
    // height, which is what every other module in this frame would pay for.
    const { container } = renderMap();
    expect(container.querySelectorAll('[data-testid="surround-movement-translation"]')).toHaveLength(3);
    const third = container.querySelectorAll('[data-testid="surround-movement"]')[2];
    expect(third.querySelector('[data-testid="surround-movement-translation"]')).toBeNull();
  });

  it('ignores a blank translation the same way it ignores an absent one', () => {
    const blank = {
      ...EROICA,
      movements: EROICA.movements.map((m) => ({ ...m, translation: '   ' })),
    };
    const { container } = renderMap({ data: blank });
    expect(container.querySelectorAll('[data-testid="surround-movement-translation"]')).toHaveLength(0);
  });

  /**
   * A DIFFERENT FACE, ON PURPOSE. Every other word in the frame is one of two
   * Garamonds; a gloss set in a third weight of the same family reads as quieter
   * programme rather than as annotation. The break is the message.
   */
  it('sets the gloss in the annotation face, recessive, above the ten-foot floor', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    const rule = css.match(/\.surround-movement-map__translation \{[^}]*\}/);
    expect(rule, 'no translation rule in the compiled sheet').not.toBeNull();
    expect(rule[0], 'the gloss is set in a serif — it reads as more programme')
      .toMatch(/font-family: var\(--surround-annotation,/);
    expect(rule[0]).not.toMatch(/font-family: var\(--surround-(display|body)/);
    const size = Number(rule[0].match(/font-size: ([\d.]+)rem/)[1]);
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
    const rule = css.match(/\.surround-movement-map__translation \{[^}]*\}/)[0];
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
    const row = css.match(/\.surround-movement-map__text-row \{[^}]*\}/)[0];
    // Two tracks: the gutter, then the text column. `minmax(0, 1fr)` is what
    // lets the ellipses inside it actually fire.
    expect(row).toMatch(/grid-template-columns: var\(--numeral-gutter\) minmax\(0, 1fr\)/);
    // The track is `ch`-based off the row's own face, so a font swap moves the
    // gutter with the glyphs, and it is driven by `--numeral-chars` — published
    // by the component as the LONGEST numeral the piece has.
    expect(row).toMatch(/--numeral-gutter: calc\(var\(--numeral-chars[^)]*\)[^;]*ch/);

    const { container } = renderMap();
    const map = container.querySelector('.surround-movement-map');
    // The Eroica runs to IV., so the longest numeral is "III." — four
    // characters — and every segment gets that same track.
    expect(map.style.getPropertyValue('--numeral-chars')).toBe('4');
    const perSegment = [...container.querySelectorAll('.surround-movement-map__text-row')]
      .map((el) => el.style.getPropertyValue('--numeral-gutter'));
    expect(perSegment.every((v) => !v), 'a segment is sizing its own gutter').toBe(true);
  });

  it('sizes the gutter to the longest numeral the PIECE has, not to a constant', () => {
    const nine = {
      ...EROICA,
      piece: { title: 'Nine', musicEndsAt: 900 },
      movements: Array.from({ length: 8 }, (_, i) => ({
        n: i + 1, name: `Movement ${i + 1}`, start: i * 100,
      })),
    };
    const { container } = renderMap({ data: nine, duration: 900 });
    // VIII. — five characters.
    expect(container.querySelector('.surround-movement-map').style.getPropertyValue('--numeral-chars'))
      .toBe('5');
  });

  it('gives the index mark its own quiet register, and brightens it only when sounding', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    const rule = css.match(/\.surround-movement-map__numeral \{[^}]*\}/)[0];
    expect(rule, 'the numeral is not set as an index mark').toMatch(/font-variant-caps: all-small-caps/);
    expect(rule).toMatch(/font-variant-numeric: lining-nums/);
    const base = Number(rule.match(/opacity: ([\d.]+)/)[1]);
    expect(base, 'the numeral competes with the name it numbers').toBeLessThan(0.6);
    // Right-aligned in its track with its own air after it: a numbered list
    // rags on the left, not against the text it numbers.
    expect(rule).toMatch(/justify-self: end/);
    expect(rule).toMatch(/padding-right: [\d.]+em/);
    const active = css.match(/--active \.surround-movement-map__numeral \{([^}]*)\}/);
    expect(active, 'the sounding movement’s numeral never comes up').not.toBeNull();
    expect(Number(active[1].match(/opacity: ([\d.]+)/)[1])).toBeGreaterThan(base);
  });

  it('recedes with an elapsed movement, and only with an elapsed one', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    const base = Number(css.match(/\.surround-movement-map__translation \{[^}]*opacity: ([\d.]+)/)[1]);
    const elapsed = css.match(/--elapsed \.surround-movement-map__translation \{([^}]*)\}/);
    expect(elapsed, 'the gloss stays at full strength under a dimmed name').not.toBeNull();
    expect(Number(elapsed[1].match(/opacity: ([\d.]+)/)[1])).toBeLessThan(base);
    // The sounding movement does NOT brighten it: a sans line competing with
    // the brass rule is the one thing this register must not do.
    expect(css).not.toMatch(/--active \.surround-movement-map__translation/);
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
    const band = css.match(/\.surround-movement-map\s*\{[^}]*\}/)[0];
    const declared = band.match(/min-height:\s*([\d.]+)rem/);
    expect(declared, 'the band declares no min-height').not.toBeNull();
    const floorPx = parseFloat(declared[1]) * 16;

    const row = css.match(/\.surround-movement-map__text-row\s*\{[^}]*\}/)[0];
    const rowSize = parseFloat(row.match(/font-size:\s*([\d.]+)rem/)[1]) * 16;
    const headClear = parseFloat(row.match(/padding:\s*([\d.]+)em/)[1]) * rowSize;
    const heading = css.match(/\.surround-movement-map__heading\s*\{[^}]*\}/)[0];
    const headSize = rowSize;                 // the heading is 1em of the row
    const headLh = parseFloat(heading.match(/line-height:\s*([\d.]+)/)[1]);

    const gloss = css.match(/\.surround-movement-map__translation\s*\{[^}]*\}/)[0];
    const glossSize = parseFloat(gloss.match(/font-size:\s*([\d.]+)rem/)[1]) * 16;
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
 * movement heading the rail already sets directly above it — "that seems
 * wasteful". The replacement is visual: a lifted panel under the sounding
 * segment, the SAME panel under the register, and a connector along the seam.
 * These specs pin the rail's half of that shape; `CueTicker.test.jsx` pins the
 * band's, and the runtime gate pins that they are actually contiguous on screen.
 */
describe('MovementMap — the bond', () => {
  let injected = null;
  const withStyles = () => {
    const compiled = sass.compile(path.join(__dirname, 'MovementMap.scss'));
    injected = document.createElement('style');
    injected.textContent = compiled.css;
    document.head.appendChild(injected);
    return compiled.css;
  };
  afterEach(() => { injected?.remove(); injected = null; });

  const bond = (c) => c.querySelector('[data-testid="surround-bond"]');
  const connector = (c) => c.querySelector('[data-testid="surround-bond-connector"]');
  const pct = (el, prop) => parseFloat(el.style.getPropertyValue(prop));

  it('sits over the sounding segment, and moves to the next one at the boundary', () => {
    const { container, rerender } = renderMap({ position: 300 });
    // Movement I: 0..976 of 2955.
    expect(pct(bond(container), '--bond-left')).toBeCloseTo(0, 6);
    expect(pct(bond(container), '--bond-width')).toBeCloseTo((976 / 2955) * 100, 4);

    rerender(
      <MovementMap
        position={1000} duration={DURATION} playing seeking={false}
        data={EROICA} region={{ module: 'movement-map' }} logger={makeLogger()}
      />,
    );
    expect(pct(bond(container), '--bond-left')).toBeCloseTo((976 / 2955) * 100, 4);
    expect(pct(bond(container), '--bond-width')).toBeCloseTo((949 / 2955) * 100, 4);
  });

  it('goes out over the applause — there is nothing sounding to bond to', () => {
    const { container } = renderMap({ position: 2960 });
    expect(bond(container).getAttribute('data-bonded')).toBe('false');
    expect(pct(bond(container), '--bond-width')).toBe(0);
  });

  it('needs NO connector when the sounding segment already sits over the panel', () => {
    // Movement IV runs 2278..2955 — 77%..100% of the rail — and the NOW panel
    // is the right half. They overlap, so the two boxes simply touch.
    const { container } = renderMap({ position: 2500 });
    expect(connector(container).getAttribute('data-bridging')).toBe('false');
    expect(pct(connector(container), '--connector-width')).toBe(0);
  });

  it('bridges the gap when the sounding segment is on the far side of the band', () => {
    // Movement I ends at 33% of the rail; the right-hand panel starts at 50%.
    const { container } = renderMap({ position: 300 });
    expect(connector(container).getAttribute('data-bridging')).toBe('true');
    const left = pct(connector(container), '--connector-left');
    const width = pct(connector(container), '--connector-width');
    expect(left).toBeCloseTo((976 / 2955) * 100, 4);
    expect(left + width, 'the connector does not reach the panel it is bridging to')
      .toBeCloseTo(50, 6);
  });

  it('bridges LEFTWARDS when the register is configured onto the left', () => {
    const left = { ...EROICA, definition: { band: { nowSide: 'left' } } };
    const { container } = renderMap({ position: 2500, data: left });
    expect(container.querySelector('[data-testid="surround-movement-map"]')
      .getAttribute('data-now-side')).toBe('left');
    expect(connector(container).getAttribute('data-bridging')).toBe('true');
    expect(pct(connector(container), '--connector-left')).toBeCloseTo(50, 6);
  });

  it('follows the playhead across the band when the side is dynamic', () => {
    const dyn = { ...EROICA, definition: { band: { nowSide: 'dynamic' } } };
    const props = (position) => (
      <MovementMap
        position={position} duration={DURATION} playing seeking={false}
        data={dyn} region={{ module: 'movement-map' }} logger={makeLogger()}
      />
    );
    const { container, rerender } = render(props(300));
    const side = () => container.querySelector('[data-testid="surround-movement-map"]')
      .getAttribute('data-now-side');
    expect(side(), 'under half-way the register belongs on the near side').toBe('left');
    rerender(props(2000));                        // 68% — past the mark
    expect(side()).toBe('right');
    rerender(props(1450));                        // 49% — inside the hysteresis band
    expect(side(), 'a wobble across the mark flapped the whole band').toBe('right');
    rerender(props(1200));                        // 40.6% — clear of it
    expect(side()).toBe('left');
  });

  it('paints the bond in the frame’s shared ground, and squares off where it continues', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    const panel = css.match(/\.surround-movement-map__bond \{[^}]*\}/)[0];
    // ONE token, published by the frame, so the rail's panel and the band's
    // cannot drift a few percent apart and stop reading as one shape.
    expect(panel).toMatch(/background: var\(--bond-ground,/);
    // Rounded at the head, square at the foot — the foot is not an edge, it is
    // where this panel becomes the connector and then the register's.
    expect(panel).toMatch(/border-radius: 5px 5px 0 0/);
    // ...and it reaches THROUGH the band's bottom padding to the seam.
    expect(panel).toMatch(/bottom: calc\(var\(--band-pad-bottom\) \* -1\)/);

    const shoulder = css.match(/\.surround-movement-map__bond-connector \{[^}]*\}/)[0];
    expect(shoulder).toMatch(/background: var\(--bond-ground,/);
    expect(shoulder, 'the connector rounds a corner in the middle of one shape')
      .not.toMatch(/border-radius/);
    expect(shoulder).toMatch(/bottom: calc\(var\(--band-pad-bottom\) \* -1\)/);
  });

  it('gives the connector a height that reads at ten feet, and clears the type above it', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    const band = css.match(/\.surround-movement-map \{[^}]*\}/)[0];
    const pad = parseFloat(band.match(/--band-pad-bottom: ([\d.]+)rem/)[1]) * 16;
    const shoulderPx = parseFloat(band.match(/--bond-shoulder: ([\d.]+)px/)[1]);
    // The minimum that reaches the seam is the bottom padding itself (5.6px),
    // and rendered, that did not read — a strip that thin in a ground seven
    // points lighter than the band is noise, not a bridge.
    expect(shoulderPx, 'the connector is back to the bare minimum that reaches')
      .toBeGreaterThan(pad);
    // The band's own measured slack below the gloss's baseline is 14.89px
    // (gloss bottom 49.11px in a 64px band); the shoulder must stay inside it.
    expect(shoulderPx, 'the connector runs up into the movement names').toBeLessThan(14.89);
  });

  it('is state, not motion: reduced motion stops it gliding, not existing', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    const block = css.match(/@media \(prefers-reduced-motion: reduce\) \{(.*)\}/);
    expect(block, 'no reduced-motion block in the compiled sheet').not.toBeNull();
    expect(block[1]).toContain('surround-movement-map__bond');
    expect(block[1]).toContain('surround-movement-map__segment');
    expect(block[1]).toMatch(/transition: none/);
    // ...and nothing hides the bond there: the highlight still says which
    // movement is sounding, it just arrives in one frame.
    expect(block[1]).not.toMatch(/surround-movement-map__bond[^{]*\{[^}]*(display|opacity)/);
  });
});

/**
 * THE ACCORDION (design wave 7), as the component drives it. The solver itself
 * is pure and is tested in `../band.test.js`; these specs pin the two things
 * only the component can get wrong — that it publishes what the solver returns,
 * and that the playhead is derived from those RENDERED widths.
 */
describe('MovementMap — the accordion', () => {
  const widthPct = (container) =>
    [...container.querySelectorAll('[data-testid="surround-movement"]')]
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
    // the movement's duration earns. Both have to be legible from the DOM or
    // nothing downstream — the gate included — can tell a widened segment from
    // a long movement.
    const { container } = renderMap({ position: 2000 });
    const naturals = [...container.querySelectorAll('[data-testid="surround-movement"]')]
      .map((el) => Number(el.getAttribute('data-natural')));
    expect(naturals[2]).toBeCloseTo(353 / 2955, 6);
    expect(naturals.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
  });

  it('keeps the playhead truthful at every boundary', () => {
    // The law the accordion must not break: whatever the widths, the cursor
    // reaches a segment's right edge exactly when the music crosses it.
    const props = (position) => (
      <MovementMap
        position={position} duration={DURATION} playing seeking={false}
        data={EROICA} region={{ module: 'movement-map' }} logger={makeLogger()}
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
      expect(head(), `the cursor is not on movement ${i + 1}'s right edge at ${boundary}s`)
        .toBeCloseTo(cumulative, 4);
    }
  });

  it('publishes ONE accordion duration, from the shared timing module', () => {
    const { container } = renderMap();
    const map = container.querySelector('[data-testid="surround-movement-map"]');
    expect(map.style.getPropertyValue('--accordion-ms')).toBe(`${ACCORDION_MS}ms`);
  });

  it('curls the quotes in a movement name and its gloss', () => {
    const curly = {
      ...EROICA,
      movements: [{
        n: 1, start: 0,
        name: "Largo e pianissimo sempre. 'the dog that barks'",
        translation: "Slow — Vivaldi's marking",
      }],
    };
    const { container } = renderMap({ data: curly });
    const seg = container.querySelector('[data-testid="surround-movement"]');
    expect(seg.textContent).toContain('‘the dog that barks’');
    expect(seg.textContent).toContain('Vivaldi’s');
    expect(seg.textContent, 'a straight mark survived the render seam').not.toContain("'");
  });
});
