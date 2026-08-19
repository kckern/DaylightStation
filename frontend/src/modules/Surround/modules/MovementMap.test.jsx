import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
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

  // BEFORE THE FIRST NOTE IS NOT AFTER THE LAST ONE. A position ahead of the
  // first movement's start — clock skew at the top of a file, or a recording
  // whose transfer opens on tuning (`starts: [45, …]`, which the store
  // explicitly permits) — used to fall through to "movement I is active", so
  // the rail lit a segment over music that had not begun while the listening
  // band six inches below printed its "nothing is playing" header. Both halves
  // now read the same derivation, and it says nothing is sounding: every
  // segment future, no fill, no bond.
  it('leaves the whole rule unsounded before the first movement starts', () => {
    const { container } = renderMap({ position: -0.5 });
    const states = [...container.querySelectorAll('[data-testid="surround-movement"]')]
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
    expect(container.querySelector('[data-testid="surround-movement-map"]')
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
    const head = ruleFor('.surround-movement-map__playhead');
    expect(head).toMatch(/transform:\s*translateX\(/);
    // The duration is published rather than literal (review finding I2); the
    // PROPERTY, which is what this spec is about, is unchanged.
    expect(head).toMatch(/transition:\s*transform var\(--head-ms, 120ms\) linear/);
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
    <MovementMap
      position={position} duration={DURATION} playing seeking={false}
      data={data} region={{ module: 'movement-map' }} logger={makeLogger()}
    />
  );

  it('sits over the sounding segment, and travels to the next one at the boundary', () => {
    const clock = withFrames();
    try {
      const { container, rerender } = renderMap({ position: 300 });
      // Movement I: 0..976 of 2955.
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
   * vector, or put `transition: left …` back on `.surround-movement-map__bond`.
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

  it('goes out over the applause — there is nothing sounding to bond to', () => {
    const { container } = renderMap({ position: 2960 });
    expect(bond(container).getAttribute('data-bonded')).toBe('false');
    expect(pct(bond(container), '--bond-width')).toBe(0);
  });

  /**
   * THE WAIST SPANS THE PANEL, ALWAYS (design wave 9). Wave 7 ran it from the
   * segment's near edge only as far as the panel's near edge, so the lit segment
   * and the lit register met at ONE POINT — the user's "kitty corner". A region
   * joined at a point is two regions. The waist is now the hull of the two, so
   * the panel's whole top edge is welded whatever the segment is doing.
   */
  it('covers the whole NOW panel even when the segment already sits over it', () => {
    // Movement IV runs 2278..2955 — 77%..100% of the rail — inside the right
    // panel. The waist collapses onto the panel rather than to zero.
    const { container } = renderMap({ position: 2500 });
    expect(connector(container).getAttribute('data-bonded')).toBe('true');
    expect(pct(connector(container), '--connector-left')).toBeCloseTo(50, 6);
    expect(pct(connector(container), '--connector-width')).toBeCloseTo(50, 6);
  });

  it('reaches back to a sounding segment on the far side, still covering the panel', () => {
    // Movement I ends at 33% of the rail; the right-hand panel is 50%..100%.
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
    expect(container.querySelector('[data-testid="surround-movement-map"]')
      .getAttribute('data-now-side')).toBe('left');
    expect(pct(connector(container), '--connector-left')).toBeCloseTo(0, 6);
    // Movement IV ends at the rail's right edge, so the waist runs the whole band.
    expect(pct(connector(container), '--connector-width')).toBeCloseTo(100, 6);
  });

  /**
   * THE CORNER RULE, AS PUBLISHED. Only the waist corners that are on the
   * OUTSIDE of the silhouette take `--bond-radius`; the rest are welds and are
   * square, so the joins are invisible. The geometry is decided in `../band.js`
   * and asserted there; this pins that the component actually publishes it.
   */
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

  it('paints the bond in the frame’s shared ground, on the band’s one radius rule', () => {
    const css = withStyles().replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');
    const panel = css.match(/\.surround-movement-map__bond \{[^}]*\}/)[0];
    // ONE token, published by the frame, so the rail's panel and the band's
    // cannot drift a few percent apart and stop reading as one shape.
    expect(panel).toMatch(/background: var\(--bond-ground,/);
    // THE CORNER RULE: every corner on the OUTSIDE of the silhouette takes
    // `--bond-radius`; every corner where two parts weld is square. The foot is
    // not an edge — it is where this panel becomes the waist.
    expect(panel).toMatch(/border-radius: var\(--bond-radius\) var\(--bond-radius\) 0 0/);
    // ...and it reaches THROUGH the band's bottom padding to the seam.
    expect(panel).toMatch(/bottom: calc\(var\(--band-pad-bottom\) \* -1\)/);
    // NOTHING IN THE BAND IS EDGED.
    expect(panel, 'the bond grew a border').not.toMatch(/box-shadow|border(-(top|left|right|bottom))?:/);

    const shoulder = css.match(/\.surround-movement-map__bond-connector \{[^}]*\}/)[0];
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
    expect(block[1]).toMatch(/transition: none/);
    // The SEGMENT is deliberately absent from this block, and that is the
    // review-I2 fix showing through: it has no CSS transition to cancel. Its
    // widths are interpolated in JS, and `useEasedVector` reads the preference
    // itself and commits the target in one go.
    const seg = css.match(/\.surround-movement-map__segment \{[^}]*\}/)[0];
    expect(seg, 'the segment is back on a second, CSS clock').not.toMatch(/transition/);
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
    // the movement's duration earns, and the two are no longer the same number.
    // Read by this spec (the runtime gate measures the segment's own box
    // instead), so it is the one place the solver's input is checkable against
    // the durations it came from without recomputing them here.
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

  /**
   * REVIEW FINDING I2 — the head and the painted boundary must be on ONE clock.
   *
   * The defect was structural: `transition: width` on the segment animated the
   * boundary over 420ms while the playhead's own 120ms ramp carried the cursor
   * to the WIDENED solution almost at once. Measured on the Eroica at 1280x720,
   * that left the head ~70px inside the elapsed fill's still-painted right edge
   * for ~300ms at every movement boundary.
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
    const compiled = sass.compile(path.join(__dirname, 'MovementMap.scss')).css;
    const seg = compiled.match(/\.surround-movement-map__segment\s*\{[^}]*\}/)[0];
    expect(
      seg,
      'the segment animates its own width in CSS — a second clock the playhead '
      + 'does not share, which is what puts the cursor inside the elapsed fill',
    ).not.toMatch(/transition/);

    // The head's ramp is published, and the component drops it to zero for
    // exactly the window in which the widths are being interpolated — so
    // during a move there is one clock, and at rest the cursor still glides
    // between the transport's 10 Hz steps.
    const head = compiled.match(/\.surround-movement-map__playhead\s*\{[^}]*\}/)[0];
    expect(head).toMatch(/transition:\s*transform var\(--head-ms/);
  });

  it('keeps the head ON the boundary at every frame of a widening move', () => {
    // The invariant, checked against the widths the component ITSELF published
    // in the same render rather than against the solver's target. With one
    // clock these agree by construction; with two they cannot, because the
    // head's array and the segments' array are read at different times.
    //
    // NOTE on what is NOT asserted: the head legitimately moves BACKWARDS
    // across a boundary. The accordion compresses the movements to the left of
    // the newly-sounding one, so the boundary itself travels left and the
    // cursor travels with it — the non-uniform time scale the brief says the
    // user accepted explicitly. What must never happen is the head leaving that
    // boundary, which is what this measures.
    const props = (position) => (
      <MovementMap
        position={position} duration={DURATION} playing seeking={false}
        data={EROICA} region={{ module: 'movement-map' }} logger={makeLogger()}
      />
    );
    const { container, rerender } = render(props(1900));
    const sample = () => {
      const widths = [...container.querySelectorAll('[data-testid="surround-movement"]')]
        .map((el) => parseFloat(el.style.width) / 100);
      const head = parseFloat(
        container.querySelector('[data-testid="surround-playhead"]').getAttribute('data-head'),
      );
      return { widths, head };
    };
    for (const position of [1900, 1925, 1930, 2100, 2277, 2278, 2500, 2954]) {
      rerender(props(position));
      const { widths, head } = sample();
      const active = [...container.querySelectorAll('[data-testid="surround-movement"]')]
        .findIndex((el) => el.getAttribute('data-state') === 'active');
      expect(active, `nothing is sounding at ${position}s`).toBeGreaterThanOrEqual(0);
      const before = widths.slice(0, active).reduce((a, b) => a + b, 0);
      expect(
        head,
        `at ${position}s the cursor is at ${head} but movement ${active + 1} `
        + `starts at ${before} in the widths the module published`,
      ).toBeGreaterThanOrEqual(before - 1e-4);
      expect(
        head,
        `at ${position}s the cursor has run past movement ${active + 1}'s own segment`,
      ).toBeLessThanOrEqual(before + widths[active] + 1e-4);
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

/**
 * THE COMPACT RAIL (`band.railDensity: 'bars'`) — review finding I4.
 *
 * The key shipped documented as "what the movement rail itself prints" while the
 * rail read nothing: authoring `bars` produced a rail that still printed every
 * name AND a NOW heading that had come back on, i.e. exactly the duplication
 * this wave exists to remove, produced by the key meant to prevent it. The rail
 * honours it now, which is also what makes `nowHeading: 'auto'` a real decision
 * rather than a constant.
 */
describe('MovementMap — the compact rail', () => {
  let injected = null;
  const withStyles = () => {
    const compiled = sass.compile(path.join(__dirname, 'MovementMap.scss'));
    injected = document.createElement('style');
    injected.textContent = compiled.css;
    document.head.appendChild(injected);
    return compiled.css;
  };
  afterEach(() => { injected?.remove(); injected = null; });

  const bars = { ...EROICA, definition: { band: { railDensity: 'bars' } } };

  it('prints no names, no glosses and no numerals', () => {
    const { container } = renderMap({ data: bars });
    expect(container.querySelectorAll('.surround-movement-map__text-row')).toHaveLength(0);
    expect(container.querySelectorAll('.surround-movement-map__heading')).toHaveLength(0);
    expect(container.querySelectorAll('[data-testid="surround-movement-translation"]')).toHaveLength(0);
    expect(container.querySelectorAll('.surround-movement-map__numeral')).toHaveLength(0);
  });

  it('still draws the rule, its barlines, the fills and the playhead', () => {
    // A compact rail is a rail, not an absence: everything that carries
    // PROGRESS survives; only the type goes.
    const { container } = renderMap({ data: bars, position: 2000 });
    expect(container.querySelectorAll('[data-testid="surround-movement"]')).toHaveLength(4);
    expect(container.querySelectorAll('[data-testid="surround-movement-fill"]')).toHaveLength(4);
    expect(container.querySelector('[data-testid="surround-playhead"]')).not.toBeNull();
    expect(container.querySelectorAll('.surround-movement-map__barline').length).toBeGreaterThan(0);
    // ...and the bond still marks the sounding movement.
    expect(container.querySelector('[data-testid="surround-bond"]').getAttribute('data-bonded'))
      .toBe('true');
  });

  it('says which density it is in, and keeps the names by default', () => {
    const { container } = renderMap({ data: bars });
    expect(container.querySelector('[data-testid="surround-movement-map"]')
      .getAttribute('data-density')).toBe('bars');
    const { container: named } = renderMap();
    expect(named.querySelector('[data-testid="surround-movement-map"]')
      .getAttribute('data-density')).toBe('names');
    expect(named.querySelectorAll('.surround-movement-map__text-row')).toHaveLength(4);
  });

  it('drops the band’s floor to what a bars-only rail actually needs', () => {
    // Omitting the row rather than hiding it is the point: the band's height is
    // its content, so a hidden-but-rendered row would leave a compact rail as
    // tall as a named one and buy nothing.
    const css = withStyles().replace(/\s+/g, ' ');
    const compact = css.match(/\.surround-movement-map--bars \{[^}]*\}/);
    expect(compact, 'a bars-only rail keeps the full named-rail floor').not.toBeNull();
    expect(compact[0]).toMatch(/min-height: calc\(4px \+ var\(--band-pad-bottom\)\)/);
    const full = css.match(/\.surround-movement-map \{[^}]*\}/)[0];
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
describe('MovementMap — logging the new decisions', () => {
  it('reports the accordion’s measured width for the sounding segment', () => {
    // The measurement path is the one part of this module jsdom cannot reach on
    // its own (every box is 0x0), and it is the number that decides every width
    // on the rail — so the geometry is stubbed and the path is actually run,
    // rather than left as the "designed degradation" every other accordion spec
    // correctly exercises.
    const rect = Element.prototype.getBoundingClientRect;
    const scroll = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollWidth');
    Element.prototype.getBoundingClientRect = function stub() {
      if (this.classList?.contains('surround-movement-map__text')) {
        return { width: 52, height: 40, x: 0, y: 0, top: 0, left: 0, right: 52, bottom: 40 };
      }
      if (this.classList?.contains('surround-movement-map__segment')) {
        return { width: 100, height: 60, x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 60 };
      }
      return { width: 0, height: 0, x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0 };
    };
    Object.defineProperty(Element.prototype, 'scrollWidth', {
      configurable: true,
      get() {
        return this.classList?.contains('surround-movement-map__heading') ? 149 : 0;
      },
    });
    try {
      const logger = makeLogger();
      renderMap({ position: 2000, logger });   // movement III, the Scherzo
      const measured = logger.debug.mock.calls.filter(([n]) => n === 'surround.accordion.measured');
      expect(measured.length, 'the accordion measured nothing anyone can see').toBe(1);
      // chrome (100 − 52 = 48) + the widest single-line string (149), rounded up
      // with one pixel of margin — the number the solver is handed.
      expect(measured[0][1]).toMatchObject({ index: 2, need: 149, chrome: 48, desired: 198 });
    } finally {
      Element.prototype.getBoundingClientRect = rect;
      if (scroll) Object.defineProperty(Element.prototype, 'scrollWidth', scroll);
      else delete Element.prototype.scrollWidth;
    }
  });

  it('does NOT open the accordion for a name that already fits', () => {
    // Review finding, minor 3: on a `nowrap` box that is not overflowing,
    // `scrollWidth === clientWidth`, so the old `Math.ceil(...) + 1` asked for a
    // pixel more than the segment already had and quietly took one off every
    // neighbour for a movement whose name was never cut.
    const rect = Element.prototype.getBoundingClientRect;
    const scroll = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollWidth');
    Element.prototype.getBoundingClientRect = function stub() {
      if (this.classList?.contains('surround-movement-map__text')) {
        return { width: 52, height: 40, x: 0, y: 0, top: 0, left: 0, right: 52, bottom: 40 };
      }
      if (this.classList?.contains('surround-movement-map__segment')) {
        return { width: 100, height: 60, x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 60 };
      }
      return { width: 0, height: 0, x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0 };
    };
    Object.defineProperty(Element.prototype, 'scrollWidth', {
      // The text fits its cell exactly — nothing is being cut.
      configurable: true,
      get() {
        return this.classList?.contains('surround-movement-map__heading') ? 52 : 0;
      },
    });
    try {
      const logger = makeLogger();
      renderMap({ position: 2000, logger });
      expect(
        logger.debug.mock.calls.filter(([n]) => n === 'surround.accordion.measured'),
        'the accordion opened for a name that already fitted',
      ).toHaveLength(0);
    } finally {
      Element.prototype.getBoundingClientRect = rect;
      if (scroll) Object.defineProperty(Element.prototype, 'scrollWidth', scroll);
      else delete Element.prototype.scrollWidth;
    }
  });

  it('reports the side crossover, from both halves of the bond', () => {
    const logger = makeLogger();
    const dyn = { ...EROICA, definition: { band: { nowSide: 'dynamic' } } };
    const props = (position) => (
      <MovementMap
        position={position} duration={DURATION} playing seeking={false}
        data={dyn} region={{ module: 'movement-map' }} logger={logger}
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
      <MovementMap
        position={position} duration={DURATION} playing seeking={false}
        data={EROICA} region={{ module: 'movement-map' }} logger={logger}
      />
    );
    const { rerender } = render(props(300));
    rerender(props(2500));
    expect(logger.debug.mock.calls.filter(([n]) => n === 'surround.band.side')).toHaveLength(0);
  });
});
