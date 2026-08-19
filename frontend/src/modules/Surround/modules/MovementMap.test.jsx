import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import * as sass from 'sass-embedded';
import MovementMap from './MovementMap.jsx';

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
    { n: 1, name: 'Allegro con brio', start: 0 },
    { n: 2, name: 'Marcia funebre. Adagio assai', start: 976 },
    { n: 3, name: 'Scherzo. Allegro vivace', start: 1925 },
    { n: 4, name: 'Finale. Allegro molto', start: 2278 },
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

  it('lets a movement name wrap to two lines instead of ellipsizing on one', () => {
    const css = withStyles();
    const { container } = renderMap();
    const heading = container.querySelector('.surround-movement-map__heading');
    const style = window.getComputedStyle(heading);
    expect(style.getPropertyValue('-webkit-line-clamp')).toBe('2');
    expect(style.getPropertyValue('-webkit-box-orient')).toBe('vertical');
    // The single-line cap is what made short movements unreadable.
    expect(style.getPropertyValue('white-space')).not.toBe('nowrap');
    // Design wave 5: WRAP **OR** ELLIPSIS, NEVER BOTH. `text-overflow` is the
    // single-line truncation idiom; declared alongside a line clamp it is the
    // second mechanism the review saw, and it belongs to neither behaviour the
    // heading is allowed to have. The clamp gives the end-of-line-2 ellipsis;
    // `max-height` is the box behind it (the clamp's own `display` computes to
    // `flow-root` in current Chromium, so the height has to be stated), and at
    // this line-height two lines and the cap are the same number.
    const rule = css.match(/\.surround-movement-map__heading\s*\{[^}]*\}/);
    expect(rule, 'no heading rule in the compiled sheet').not.toBeNull();
    expect(rule[0], 'the heading still declares text-overflow').not.toMatch(/text-overflow/);
    const cap = rule[0].match(/max-height:\s*([\d.]+)em/);
    expect(cap, 'the heading declares no max-height').not.toBeNull();
    const lineHeight = parseFloat(rule[0].match(/line-height:\s*([\d.]+)/)[1]);
    expect(parseFloat(cap[1])).toBeCloseTo(lineHeight * 2, 2);
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

    // Source order: bar, then heading, inside each segment.
    const segment = container.querySelector('.surround-movement-map__segment');
    const classes = [...segment.children].map((el) => el.className);
    const bar = classes.findIndex((c) => c.includes('__bar'));
    const heading = classes.findIndex((c) => c.includes('__heading'));
    expect(bar).toBeGreaterThanOrEqual(0);
    expect(heading).toBeGreaterThan(bar);

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
    // The heading's clearance is a MARGIN above it now, not below.
    expect(css).toMatch(/\.surround-movement-map__heading \{[^}]*margin-top: [\d.]+em/);
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
