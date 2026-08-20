import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import * as sass from 'sass-embedded';
import CueTicker, {
  CUE_FADE_MS, CUE_HOLD_MS, CUE_SWAP_MS, CUE_DWELL_S, FACT_INTERVAL_MS,
  LISTEN_INTERVAL_MS, phaseDelay,
} from './CueTicker.jsx';
import { ACCORDION_MS } from '../band.js';
// THE ANCHOR FLOOR IS THE ONE THAT APPLIES HERE, and that is a fact about this
// environment rather than a convenience. The prose floor is a function of the
// screen root's width (`../fit.js`), measured off the `.surround-frame` the band
// is painted in; happy-dom has no layout and these mounts have no frame
// ancestor, so the root is unmeasurable and the fit falls back to the anchor —
// 0.88rem, the number every root scales from. It is also the root the 0.72rem
// label floor below was derived on, so the two are comparable here and only here.
import { PROSE_FLOOR_ANCHOR_PX, LABEL_FLOOR_ANCHOR_PX } from '../fit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const makeLogger = () => ({
  debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), sampled: vi.fn(),
});

const DATA = {
  contentId: 'plex:663134',
  cues: [
    { at: 300, render: 'sideways', text: 'Unknown render is docked.' },
    { at: 976, render: 'docked', text: 'The funeral march begins.' },
    { at: 1925, text: 'The horns enter.' },
    { at: 2278, render: 'overlay', text: 'Reserved for phase two.' },
  ],
  facts: ['Beethoven tore the page.', 'The premiere ran over two hours.'],
};

/** One act() per step — batching several into one collapses the renders. */
const tick = (ms) => act(() => { vi.advanceTimersByTime(ms); });
/** Out, a beat of empty ground, then in — the swap commits after out+hold. */
const settle = () => { tick(CUE_FADE_MS + CUE_HOLD_MS); tick(CUE_FADE_MS); };

function renderTicker({ position = 0, data = DATA, logger = makeLogger() } = {}) {
  const props = (p) => ({
    position: p, duration: 3223, playing: true, seeking: false,
    data, region: { module: 'cue-ticker', height: 156 }, logger,
  });
  const view = render(<CueTicker {...props(position)} />);
  return {
    ...view,
    logger,
    text: () => view.container.querySelector('[data-testid="surround-ticker-text"]')?.textContent ?? '',
    hidden: () => Boolean(view.container
      .querySelector('[data-testid="surround-ticker-text"]')
      ?.className.includes('surround-cue-ticker__text--hidden')),
    at: (p) => act(() => { view.rerender(<CueTicker {...props(p)} />); }),
  };
}

describe('CueTicker', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('shows the first fact immediately, with no fade on first appearance', () => {
    const view = renderTicker();
    expect(view.text()).toBe('Beethoven tore the page.');
  });

  it('cycles the fact pool on the 20s timer', () => {
    const view = renderTicker();
    tick(FACT_INTERVAL_MS);
    settle();
    expect(view.text()).toBe('The premiere ran over two hours.');
    tick(FACT_INTERVAL_MS);
    settle();
    expect(view.text()).toBe('Beethoven tore the page.'); // wraps
  });

  it('does not swap the fact before its 20s is up', () => {
    const view = renderTicker();
    tick(FACT_INTERVAL_MS - 1);
    expect(view.text()).toBe('Beethoven tore the page.');
  });

  it('lets a timed cue preempt the fact', () => {
    const view = renderTicker();
    expect(view.text()).toBe('Beethoven tore the page.');
    view.at(976);
    settle();
    expect(view.text()).toBe('The funeral march begins.');
  });

  it('holds the cue for the 12s dwell, then returns to the fact pool', () => {
    const view = renderTicker();
    view.at(976);
    settle();
    expect(view.text()).toBe('The funeral march begins.');

    view.at(976 + CUE_DWELL_S - 1);   // still inside the dwell
    settle();
    expect(view.text()).toBe('The funeral march begins.');

    view.at(976 + CUE_DWELL_S);       // dwell expired
    settle();
    expect(view.text()).toBe('Beethoven tore the page.');
  });

  it('honors a per-cue dwell override', () => {
    const data = { ...DATA, cues: [{ at: 100, dwell: 4, text: 'Brief.' }] };
    const view = renderTicker({ data });
    view.at(100);
    settle();
    expect(view.text()).toBe('Brief.');
    view.at(104);
    settle();
    expect(view.text()).toBe('Beethoven tore the page.');
  });

  it('treats an unknown render value as docked', () => {
    const view = renderTicker();
    view.at(300);
    settle();
    expect(view.text()).toBe('Unknown render is docked.');
  });

  it('treats an absent render value as docked', () => {
    const view = renderTicker();
    view.at(1925);
    settle();
    expect(view.text()).toBe('The horns enter.');
  });

  it('ignores render: overlay cues — those are phase two', () => {
    const view = renderTicker();
    view.at(2278);
    settle();
    expect(view.text()).toBe('Beethoven tore the page.');
  });

  it('re-fires the right cue after a backwards seek', () => {
    const view = renderTicker();
    view.at(976);
    settle();
    expect(view.text()).toBe('The funeral march begins.');
    view.at(2000);
    settle();
    expect(view.text()).toBe('Beethoven tore the page.');
    view.at(976);                       // seek back into the funeral march
    settle();
    expect(view.text()).toBe('The funeral march begins.');
  });

  it('picks the latest cue when two dwell windows overlap', () => {
    const data = { ...DATA, cues: [{ at: 100, text: 'First.' }, { at: 105, text: 'Second.' }] };
    const view = renderTicker({ data });
    view.at(106);
    settle();
    expect(view.text()).toBe('Second.');
  });

  it('never hard-cuts: the old text fades out before the new one is swapped in', () => {
    const view = renderTicker();
    view.at(976);
    // Mid-fade the OLD text is still mounted, just transparent.
    expect(view.text()).toBe('Beethoven tore the page.');
    tick(CUE_FADE_MS + CUE_HOLD_MS - 1);
    expect(view.text()).toBe('Beethoven tore the page.');
    tick(1);
    expect(view.text()).toBe('The funeral march begins.');
  });

  // Design wave 2 (addendum): the swap DISSOLVES THROUGH THE DARK — out to the
  // band's ground, a held beat of nothing, then in. A 280ms cross-flip on a dark
  // band reads as a blink; the held beat is the whole point.
  it('holds an empty ground between the two lines', () => {
    const view = renderTicker();
    view.at(976);

    // Fully faded out, and still on the OLD line: the ground is empty here.
    tick(CUE_FADE_MS);
    expect(view.text()).toBe('Beethoven tore the page.');
    expect(view.hidden()).toBe(true);

    // ...and it stays empty for the beat, rather than swapping the instant the
    // fade-out ends.
    tick(CUE_HOLD_MS - 1);
    expect(view.hidden()).toBe(true);

    tick(1);
    expect(view.text()).toBe('The funeral march begins.');
    expect(view.hidden()).toBe(false);      // the new line fades in from here
  });

  it('spends the whole dissolve in the 700–900ms range the design asks for', () => {
    expect(CUE_SWAP_MS).toBe(CUE_FADE_MS + CUE_HOLD_MS + CUE_FADE_MS);
    expect(CUE_SWAP_MS).toBeGreaterThanOrEqual(700);
    expect(CUE_SWAP_MS).toBeLessThanOrEqual(900);
    expect(CUE_HOLD_MS).toBeGreaterThanOrEqual(120);
  });

  it('drives the CSS fade from the same constant as the JS timer', () => {
    const view = renderTicker();
    const el = view.container.querySelector('[data-testid="surround-ticker-text"]');
    // Inline, so the stylesheet cannot drift away from the choreography.
    expect(el.style.transition).toBe(`opacity ${CUE_FADE_MS}ms ease`);
  });

  it('swaps instantly under prefers-reduced-motion', () => {
    const original = window.matchMedia;
    window.matchMedia = vi.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    try {
      const view = renderTicker();
      view.at(976);
      expect(view.text()).toBe('The funeral march begins.');   // no 280ms wait
    } finally {
      window.matchMedia = original;
    }
  });

  it('renders an empty panel, without throwing, when there are no cues and no facts', () => {
    let view;
    expect(() => { view = renderTicker({ data: { contentId: 'x', cues: [], facts: [] } }); }).not.toThrow();
    expect(view.container.querySelector('[data-testid="surround-cue-ticker"]')).not.toBeNull();
    expect(view.text()).toBe('');
  });

  it('renders an empty panel when the payload is missing entirely', () => {
    const view = renderTicker({ data: null });
    expect(view.container.querySelector('[data-testid="surround-cue-ticker"]')).not.toBeNull();
    expect(view.text()).toBe('');
  });

  it('logs surround.cue.shown for both kinds, with the contentId', () => {
    const view = renderTicker();
    const shown = () => view.logger.debug.mock.calls.filter((c) => c[0] === 'surround.cue.shown');
    expect(shown()).toHaveLength(1);
    expect(shown()[0][1]).toEqual({ kind: 'fact', at: null, contentId: 'plex:663134' });

    view.at(976);
    settle();
    expect(shown()).toHaveLength(2);
    expect(shown()[1][1]).toEqual({ kind: 'cue', at: 976, contentId: 'plex:663134' });
  });

  it('does not re-log while the same cue stays on screen', () => {
    const view = renderTicker();
    view.at(976);
    settle();
    const before = view.logger.debug.mock.calls.filter((c) => c[0] === 'surround.cue.shown').length;
    view.at(977);
    view.at(978);
    settle();
    expect(view.logger.debug.mock.calls.filter((c) => c[0] === 'surround.cue.shown')).toHaveLength(before);
  });

  it('holds the fact pool still while a cue is on screen', () => {
    const view = renderTicker();
    view.at(976);
    settle();
    // One interval's worth. If the rotation ran behind the cue the pool would
    // come back on fact 2 — a fact the viewer never saw.
    tick(FACT_INTERVAL_MS);
    view.at(976 + CUE_DWELL_S);
    settle();
    expect(view.text()).toBe('Beethoven tore the page.');
  });

  it('clears its timers on unmount', () => {
    const view = renderTicker();
    view.unmount();
    expect(() => tick(FACT_INTERVAL_MS * 3)).not.toThrow();
  });
});

/**
 * The panel's box is a CONTRACT, not a consequence of what is showing. The
 * project's vitest config runs `css: false`, so the component's own SCSS import
 * injects nothing — these specs compile the real sheet and inject it, the
 * pattern ComposerCard.test.jsx established, so the assertions are about the
 * shipped file rather than about a hand-typed stand-in.
 */
describe('CueTicker — reserved height and centred setting', () => {
  let injected = null;
  const withStyles = () => {
    const compiled = sass.compile(path.join(__dirname, 'CueTicker.scss'));
    injected = document.createElement('style');
    injected.textContent = compiled.css;
    document.head.appendChild(injected);
    return compiled.css;
  };
  afterEach(() => { injected?.remove(); injected = null; });

  const mount = (text) => render(
    <CueTicker
      position={0} duration={3223} playing seeking={false}
      data={{ contentId: 'x', cues: [], facts: [text] }}
      region={{ module: 'cue-ticker' }}
      logger={makeLogger()}
    />,
  );

  /**
   * THE BOX IS THE ZONE'S LEFTOVER RUN (design wave 9).
   *
   * The reserve used to be a `min-height`/`max-height` pair in `em`, re-derived
   * per container-query tier. It is now `flex: 1 1 0%` in a column zone, which
   * is the same contract expressed structurally: the box takes every pixel the
   * headers did not, and its own content never enters that calculation, so one
   * line and five lines occupy the identical box and a rotation cannot shift the
   * layout. What the pair used to do by arithmetic the flex algorithm now does
   * by construction — and unlike the pair it cannot be one tier out of date.
   */
  it('gives the note the zone\u2019s whole leftover run, so rotation never shifts layout', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    const rule = css.match(/\.surround-cue-ticker__text \{[^}]*\}/)[0];
    expect(rule, 'the note box is content-sized again — a long note would now move the band')
      .toMatch(/flex: 1 1 0%/);
    expect(rule, 'a flex item with no min-height floor refuses to shrink below its content')
      .toMatch(/min-height: 0/);
    // ...and NOT by a fixed reserve, which is what would have to be re-derived.
    expect(rule).not.toMatch(/max-height:/);

    const short = mount('A fact.');
    const long = mount('A considerably longer programme note that will certainly wrap onto a second line at this measure.');
    const box = (view) => view.container.querySelector('[data-testid="surround-ticker-text"]');
    expect(window.getComputedStyle(box(short)).getPropertyValue('flex'))
      .toBe(window.getComputedStyle(box(long)).getPropertyValue('flex'));
  });

  /**
   * NO CLAMP, ANYWHERE, EVER (design wave 9). This is the wave's headline law:
   * a television has no "read more" and no scroll, so a note that stops
   * mid-sentence with three dots is a claim the viewer cannot complete. The
   * three container-query tiers that used to set a clamp count are gone with it.
   *
   * TO GO RED: put `-webkit-line-clamp` back on `__line`, or restore any of the
   * 88px/108px/161px reserve tiers.
   */
  it('carries no line clamp and no truncation tier at all', () => {
    // Comments stripped: the stylesheet SAYS the word "clamp" a great deal now,
    // explaining why there is not one, and a sweep that matched prose would be
    // green only until someone edited a paragraph.
    const css = withStyles().replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');
    expect(css, 'the ellipsis is back in the band').not.toContain('-webkit-line-clamp');
    expect(css, 'the note box is being truncated by a text-overflow rule')
      .not.toMatch(/\.surround-cue-ticker__(text|line) \{[^}]*text-overflow/);
    const tiers = [...css.matchAll(/@container ticker \(min-height: ([\d.]+)px\)/g)]
      .map((m) => Number(m[1]));
    // ONE query survives, and it is not a truncation tier: it decides whether
    // the NOW header prints the segment's translation, which is an editorial
    // decision no fit can make.
    expect(tiers, `the truncation lattice is back: ${JSON.stringify(tiers)}`).toHaveLength(1);
    const q = css.match(/@container ticker \(min-height: [\d.]+px\) \{(.*?)\} \}/);
    expect(q[1]).toMatch(/__now-translation \{[^}]*display: block/);
    expect(q[1], 'the surviving query still sets a reserve').not.toMatch(/min-height|max-height/);
  });

  /**
   * THE TYPE IS PUBLISHED, NOT COMPUTED IN CSS. `--note-size` and
   * `--note-leading` come from `../fit.js`, which measures. The stylesheet's job
   * is to read them and to degrade sanely when nothing has measured yet.
   */
  it('sizes the note from the measured fit, with readable fallbacks', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    const rule = css.match(/\.surround-cue-ticker__text \{[^}]*\}/)[0];
    expect(rule, 'the note is sized by a container-query coefficient again')
      .not.toContain('cqh');
    const size = rule.match(/font-size: var\(--note-size, ([^)]+)\)/);
    const leading = rule.match(/line-height: var\(--note-leading, ([\d.]+)\)/);
    expect(size, 'the note does not read the fitted size').not.toBeNull();
    expect(leading, 'the note does not read the fitted leading').not.toBeNull();
    // The fallback is what an unlaid-out tree gets. It must be inside the
    // ladder's own bounds — a fallback above the ceiling would paint one frame
    // of a note too big for the band.
    expect(parseFloat(size[1])).toBeLessThanOrEqual(1.5);
    expect(Number(leading[1])).toBeGreaterThanOrEqual(1.25);
  });

  /**
   * THE RULER IS RENDERED, AND IT IS INSIDE THE BOX IT MEASURES. `../fit.js`
   * sets its width, size and leading and reads back a height; being a child of
   * `__text` is what makes it inherit the face, the weight, the tracking and
   * `text-wrap: balance` from the element the note is actually painted in, so a
   * measurement cannot drift from the paint by a property nobody copied.
   */
  it('renders the fit probe inside the note box, out of flow and invisible', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    const rule = css.match(/\.surround-cue-ticker__probe \{[^}]*\}/);
    expect(rule, 'no probe rule — the fit has nothing to measure with').not.toBeNull();
    expect(rule[0]).toContain('position: absolute');
    // `visibility: hidden`, NOT `display: none`: a box with no display has no
    // layout, and layout is the entire question being asked.
    expect(rule[0]).toContain('visibility: hidden');
    expect(rule[0], 'a probe with no layout cannot measure anything')
      .not.toContain('display: none');

    const view = mount('A fact.');
    const box = view.container.querySelector('[data-testid="surround-ticker-text"]');
    expect(box.querySelector('.surround-cue-ticker__probe'), 'the probe is not inside the box it measures')
      .not.toBeNull();
  });

  it('sets the note centred and balanced', () => {
    withStyles();
    const view = mount('A fact.');
    const style = window.getComputedStyle(view.container.querySelector('[data-testid="surround-ticker-text"]'));
    expect(style.getPropertyValue('text-align')).toBe('center');
    // Progressive enhancement: a browser without it just wraps as before.
    expect(style.getPropertyValue('text-wrap')).toBe('balance');
  });

  /**
   * Design wave 5 — CENTRED IN THE RESERVE, not hung from its ceiling.
   *
   * The band grew when the rule row moved to its top, and a one-line note in a
   * two-line reserve sat at the top of the box with the spare line beneath it:
   * top-heavy, in a zone that is now the tallest thing in the band.
   * `grid` + `align-content: center` is what centres wrapped text vertically —
   * `-webkit-box-pack` does not (measured: in a 62px box, one line lands at
   * y=1 under the box idiom and y=22 under grid), which is why the clamp
   * declaration is gone from the rule rather than merely inert beside it.
   */
  it('centres the note in its reserve rather than hanging it from the top', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    const view = mount('A fact.');
    const style = window.getComputedStyle(view.container.querySelector('[data-testid="surround-ticker-text"]'));
    expect(style.getPropertyValue('display')).toBe('grid');
    expect(style.getPropertyValue('align-content')).toBe('center');
    const rule = css.match(/\.surround-cue-ticker__text \{[^}]*\}/)[0];
    expect(rule, 'the line-clamp idiom is still fighting the grid').not.toContain('-webkit-line-clamp');
  });

  /**
   * THE MODULE IS STILL A SIZE CONTAINER WITH A FLOOR — the one thing the fit
   * cannot supply for itself. `container-type: size` removes a box's own
   * contribution to its height, so a definition that did NOT give the ticker
   * `height: fill` would compute it to zero; the floor is what stops the module
   * vanishing instead of shrinking, and it is the room the fit is solved
   * against on the tightest screen in the fleet.
   */
  it('stays a size container with a floor under it', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    const panel = css.match(/\.surround-cue-ticker \{[^}]*\}/)[0];
    expect(panel, 'the ticker is not a container, so the surviving query cannot target it')
      .toContain('container-type: size');
    expect(panel).toContain('container-name: ticker');
    const floor = panel.match(/min-height: ([\d.]+)rem/);
    expect(floor, 'a size container with no floor collapses to nothing').not.toBeNull();
    // One line of note at the fit's own floor, plus the panel's padding, has to
    // fit inside that floor — otherwise the module overflows its own container
    // on the smallest band the fleet produces.
    const padRem = Number(panel.match(/--ticker-pad-y: ([\d.]+)rem/)[1]) * 2;
    expect((0.88 * 1.35) + padRem).toBeLessThanOrEqual(Number(floor[1]));
  });


  it('keeps an instant swap under prefers-reduced-motion', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(css).toMatch(/transition: none/);
  });

  /**
   * TWO ELEMENTS, ONE JOB EACH. `__text` is the grid that centres; `__line` is
   * the thing centred in it. One element cannot be both (wave 5's finding, for
   * the opposite reason — the clamp idiom's `display` fought the grid's), and
   * the split survives the clamp's removal because the centring still needs it.
   */
  it('sets the line as a plain block inside the box that centres it', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    const rule = css.match(/\.surround-cue-ticker__line \{[^}]*\}/);
    expect(rule, 'no .surround-cue-ticker__line rule').not.toBeNull();
    expect(rule[0], 'the clamp idiom is back, and with it the ellipsis')
      .not.toContain('-webkit-box');

    const view = mount('A fact.');
    const outerEl = view.container.querySelector('[data-testid="surround-ticker-text"]');
    const lineEl = outerEl.querySelector('.surround-cue-ticker__line');
    expect(lineEl, 'the outer box has no .surround-cue-ticker__line child').not.toBeNull();
    expect(lineEl.textContent).toBe('A fact.');
  });

  /**
   * A LONG FACT IS NOT TRUNCATED — it is SET WHOLE. jsdom has no layout, so what
   * is pinned here is that no truncation machinery touches it at any length; the
   * measurement that proves the paint is `band.measure.test.jsx`, in Chromium.
   */
  it('sets an over-long fact whole, with nothing clamping it', () => {
    withStyles();
    const longFact = 'A. '.repeat(100).trim(); // 300 characters
    const view = mount(longFact);
    const lineEl = view.container.querySelector('.surround-cue-ticker__line');
    expect(lineEl.textContent).toBe(longFact);
    const style = window.getComputedStyle(lineEl);
    expect(style.getPropertyValue('-webkit-line-clamp')).toBe('');
    expect(style.getPropertyValue('text-overflow')).toBe('');
  });
});

/**
 * DESIGN WAVE 6 — THE BAND SPLITS.
 *
 * Everything above this block uses a payload with NO segments, and that is not
 * laziness: a piece without segments has no "now" to give a register to, so it
 * keeps the single, full-width band this module shipped with — cues and all —
 * and those specs are the regression suite for exactly that path. What follows
 * is the split one.
 */
const SPLIT = {
  contentId: 'plex:663134',
  piece: { musicEndsAt: 2955 },
  pieceSegments: [
    {
      n: 1,
      name: 'Allegro con brio',
      start: 0,
      translation: 'Fast, with spirit',
      listen: ['Two hammered chords, then the cellos.', 'A horn comes in four bars early.'],
    },
    {
      n: 2,
      name: 'Marcia funebre. Adagio assai',
      start: 976,
      translation: 'Funeral march — very slow',
      listen: ['The march tune is in the violins.'],
    },
    // Deliberately unauthored: this is the "never empty paper" case.
    { n: 3, name: 'Scherzo. Allegro vivace', start: 1925 },
  ],
  cues: [{ at: 500, text: 'The development begins.' }],
  facts: ['Beethoven tore the page.', 'The premiere ran over two hours.'],
};

/**
 * The same band with `band.nowHeading: 'always'`.
 *
 * Design wave 7 turned the NOW register's segment heading OFF by default —
 * the rail names the segment and the bond points at it, so printing it twice
 * was the repetition the user called wasteful. The heading is still a supported
 * mode (a bars-only rail has no name for the bond to point at), so the wave-6
 * specs that describe its behaviour keep describing it, against a fixture that
 * asks for it explicitly rather than against a default that no longer implies
 * it.
 */
const SPLIT_HEADED = {
  ...SPLIT,
  definition: { regions: {}, collapse: {}, band: { nowHeading: 'always' } },
};

describe('CueTicker — the split band (design wave 6)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const renderSplit = ({ position = 0, data = SPLIT_HEADED, logger = makeLogger() } = {}) => {
    const props = (p) => ({
      position: p, duration: 3223, playing: true, seeking: false,
      data, region: { module: 'cue-ticker', height: 'fill' }, logger,
    });
    const view = render(<CueTicker {...props(position)} />);
    const text = (id) => view.container.querySelector(`[data-testid="${id}"]`)?.textContent ?? '';
    return {
      ...view,
      logger,
      piece: () => text('surround-ticker-text'),
      listen: () => text('surround-ticker-listen'),
      header: () => text('surround-ticker-now'),
      root: () => view.container.querySelector('[data-testid="surround-cue-ticker"]'),
      at: (p) => act(() => { view.rerender(<CueTicker {...props(p)} />); }),
    };
  };

  it('renders two registers, and says so on the root', () => {
    const view = renderSplit();
    expect(view.container.querySelector('[data-testid="surround-ticker-zone-piece"]')).not.toBeNull();
    expect(view.container.querySelector('[data-testid="surround-ticker-zone-now"]')).not.toBeNull();
    expect(view.root().getAttribute('data-split')).toBe('true');
  });

  it('keeps ONE register for a piece with no segments — there is no "now" to split off', () => {
    const view = renderSplit({ data: DATA });
    expect(view.container.querySelector('[data-testid="surround-ticker-zone-piece"]')).not.toBeNull();
    expect(view.container.querySelector('[data-testid="surround-ticker-zone-now"]')).toBeNull();
    expect(view.root().getAttribute('data-split')).toBe('false');
  });

  it('names the sounding segment in the right zone’s header, with its translation', () => {
    const view = renderSplit();
    expect(view.header()).toContain('Allegro con brio');
    expect(view.header()).toContain('Fast, with spirit');
    view.at(1000);
    expect(view.header()).toContain('Marcia funebre. Adagio assai');
    expect(view.header()).toContain('Funeral march');
  });

  it('scopes the right zone to THIS segment’s listen notes', () => {
    const view = renderSplit();
    expect(view.listen()).toBe('Two hammered chords, then the cellos.');
    view.at(1000);
    settle();
    expect(view.listen()).toBe('The march tune is in the violins.');
  });

  it('resets the rotation when the segment changes, so a new pool starts at its first note', () => {
    const view = renderSplit();
    // Advance segment I's pool to its second note.
    tick(phaseDelay(0));
    settle();
    expect(view.listen()).toBe('A horn comes in four bars early.');
    // Into segment II and back: the pool is re-entered at note one, not at
    // wherever the previous segment's index happened to be.
    view.at(1000);
    settle();
    view.at(10);
    settle();
    expect(view.listen()).toBe('Two hammered chords, then the cellos.');
  });

  it('borrows the piece pool under the header when a segment has no listen notes', () => {
    const view = renderSplit({ position: 2000 });   // segment III, unauthored
    expect(view.header()).toContain('Scherzo');
    expect(view.listen()).toBe('Beethoven tore the page.');   // never empty paper
    expect(view.container.querySelector('[data-testid="surround-ticker-zone-now"]')
      .getAttribute('data-borrowed')).toBe('true');
  });

  it('lets a timed cue interrupt the NOW register only — the piece register plays on', () => {
    const view = renderSplit();
    const pieceBefore = view.piece();
    view.at(500);
    settle();
    expect(view.listen()).toBe('The development begins.');
    expect(view.piece()).toBe(pieceBefore);
    expect(view.root().getAttribute('data-kind')).toBe('cue');
  });

  it('gives the NOW register back to the segment when the cue’s dwell closes', () => {
    const view = renderSplit();
    view.at(500);
    settle();
    expect(view.listen()).toBe('The development begins.');
    view.at(500 + CUE_DWELL_S);
    settle();
    expect(view.listen()).toBe('Two hammered chords, then the cellos.');
    expect(view.root().getAttribute('data-kind')).toBe('fact');
  });

  /**
   * THE TWO ZONES NEVER SWAP TOGETHER. Both play the same dissolve, and two of
   * them firing in one instant reads as the whole band blinking. The phase is
   * half a period, which at equal periods is the maximum separation available.
   */
  it('offsets the two rotations by half a period', () => {
    expect(LISTEN_INTERVAL_MS).toBe(FACT_INTERVAL_MS);
    // Half a period, COMPUTED. There is no `LISTEN_PHASE_MS` constant: a fixed
    // delay from the moment the NOW register re-armed was the defect (see "the
    // two registers never blink together" at the foot of this file), so the wait
    // is derived from the piece register's own clock. At mount that clock has
    // just been armed, so this is the same number the constant used to be.
    expect(phaseDelay(0)).toBe(FACT_INTERVAL_MS / 2);

    const view = renderSplit();
    const piece0 = view.piece();
    const listen0 = view.listen();

    // At half a period the NOW register has moved and the piece register has not.
    tick(phaseDelay(0));
    settle();
    expect(view.listen()).not.toBe(listen0);
    expect(view.piece()).toBe(piece0);

    // ...and at the full period the piece register moves while the NOW one holds.
    const listen1 = view.listen();
    tick(FACT_INTERVAL_MS - phaseDelay(0) - (CUE_FADE_MS * 2 + CUE_HOLD_MS));
    settle();
    expect(view.piece()).not.toBe(piece0);
    expect(view.listen()).toBe(listen1);
  });

  it('holds the NOW rotation still behind a cue, so no listening note is skipped', () => {
    const view = renderSplit();
    view.at(500);
    settle();
    // A whole period's worth of cue.
    tick(LISTEN_INTERVAL_MS);
    view.at(500 + CUE_DWELL_S);
    settle();
    expect(view.listen()).toBe('Two hammered chords, then the cellos.');
  });

  /**
   * NOTHING SOUNDING IS BLANK (design wave 9), and it is a designed state rather
   * than a fallback. It used to print "Listen for" over a borrowed piece fact,
   * which is a header for a note that is not there and a second copy of the left
   * register beneath it. The applause after the last chord and the walk-on
   * before the first are the same state and get the same answer: no header text,
   * no note, and no lit panel — but the boxes are all still exactly as tall.
   */
  it('goes blank when no segment is sounding, rather than borrowing the piece pool', () => {
    const view = renderSplit({ position: 3000 });   // past musicEndsAt: applause
    expect(view.header()).not.toContain('Finale');
    expect(view.header()).not.toContain('Scherzo');
    expect(view.header(), 'the header invented a subject it does not have')
      .not.toContain('Listen for');
    expect(view.listen(), 'the NOW register borrowed a piece fact with nothing sounding')
      .toBe('');
  });

  it('unlights the NOW panel when nothing is sounding, and lights it when something is', () => {
    const ground = (v) => v.container.querySelector('[data-testid="surround-ticker-ground"]')
      .getAttribute('data-bonded');
    expect(ground(renderSplit({ position: 3000 })), 'a lit panel under a blank register').toBe('false');
    expect(ground(renderSplit({ position: 500 }))).toBe('true');
  });

  /**
   * THE BLANK HEADER STILL RESERVES ITS LINES. An element that disappeared would
   * hand its height to the note's box below, change the room the fit was solved
   * against, and resize the whole band's type on a segment boundary — the
   * reserved-height law broken by the state that was supposed to be quiet.
   */
  it('reserves the header\u2019s lines while it is blank', () => {
    const sounding = renderSplit({ position: 500 });
    const silent = renderSplit({ position: 3000 });
    const head = (v) => v.container.querySelector('[data-testid="surround-ticker-now"]');
    expect(head(silent), 'the header element vanished with the segment').not.toBeNull();
    expect(head(silent).getAttribute('data-sounding')).toBe('false');
    expect(head(sounding).getAttribute('data-sounding')).toBe('true');
    const lines = (v) => [...head(v).children].length;
    expect(lines(silent), 'the blank header reserves a different number of lines')
      .toBe(lines(sounding));
  });

  it('logs the listening note it shows, with the segment it belongs to', () => {
    const view = renderSplit();
    const shown = () => view.logger.debug.mock.calls.filter((c) => c[0] === 'surround.listen.shown');
    expect(shown()).toHaveLength(1);
    expect(shown()[0][1]).toMatchObject({ kind: 'listen', segment: 0, borrowed: false });
  });

  it('clears both zones’ timers on unmount', () => {
    const view = renderSplit();
    view.unmount();
    expect(() => tick(FACT_INTERVAL_MS * 3)).not.toThrow();
  });

  /**
   * Fix round 1 (review finding I1). The piece register's effect used to list
   * `activeCue` in its dependency array even though the SPLIT branch never
   * reads it — cues belong to the NOW zone only — so a cue landing or lifting
   * in the other zone tore the piece timer down and rebuilt it, restarting its
   * 20s countdown from that instant. Proven by crossing the ORIGINAL period's
   * boundary with two cue edges in between: a still-buggy effect would have
   * reset at each edge and not be due again for another full period, so the
   * piece register would still be showing its first line.
   */
  it('does not reset the piece register’s rotation when a cue interrupts the NOW zone', () => {
    const view = renderSplit();
    const piece0 = view.piece();

    tick(FACT_INTERVAL_MS - 1);
    expect(view.piece()).toBe(piece0);

    // A cue arrives in the NOW zone and departs again, entirely inside the
    // last millisecond of the piece register's own period.
    view.at(500);
    view.at(500 + CUE_DWELL_S);

    // The final millisecond of the ORIGINAL period: an untouched timer fires
    // now.
    tick(1);
    settle();
    expect(view.piece()).not.toBe(piece0);
  });

  /**
   * Fix round 1 (review finding I2), first half: a cue landing while the NOW
   * zone is mid-dissolve of an ordinary rotation used to re-queue a fresh full
   * `DISSOLVE_COMMIT_MS` wait on top of whatever was left of the interrupted
   * one — up to twice the normal commit latency. The fix commits an activating
   * cue instantly, so it must be showing with NO wait at all, not just a
   * shorter one.
   */
  it('commits a cue instantly even when it lands mid-dissolve of an ordinary rotation', () => {
    const view = renderSplit();
    expect(view.listen()).toBe('Two hammered chords, then the cellos.');

    // Cross the NOW register's own rotation boundary, but only one tick in —
    // it is now hidden and mid-fade, its commit still ~479ms away.
    tick(phaseDelay(0));
    tick(1);

    // A cue lands while that ordinary dissolve is still in flight. No
    // settle() follows: if this still queued a fresh dissolve, the cue's text
    // would not be showing yet.
    view.at(500);
    expect(view.listen()).toBe('The development begins.');
  });

  /**
   * Fix round 1 (review finding I2), second half. The header above the NOW
   * text is never dissolved — it just re-renders on the segment boundary —
   * so a softened note there used to keep naming the OLD segment for up to a
   * full commit while the header already named the new one. No settle()
   * follows the boundary crossing: the fix's whole point is that no wait is
   * needed for the two to agree.
   */
  it('never lets the header and the note name different segments after a boundary tick', () => {
    const view = renderSplit();
    expect(view.header()).toContain('Allegro con brio');
    expect(view.listen()).toBe('Two hammered chords, then the cellos.');

    view.at(1000);   // into segment II
    expect(view.header()).toContain('Marcia funebre. Adagio assai');
    expect(view.listen()).toBe('The march tune is in the violins.');
  });
});

describe('CueTicker — the split band’s shipped design', () => {
  let injected = null;
  const withStyles = () => {
    const compiled = sass.compile(path.join(__dirname, 'CueTicker.scss'));
    injected = document.createElement('style');
    injected.textContent = compiled.css;
    document.head.appendChild(injected);
    return compiled.css;
  };
  afterEach(() => { injected?.remove(); injected = null; });

  const mountSplit = (position = 0, data = SPLIT) => render(
    <CueTicker
      position={position} duration={3223} playing seeking={false}
      data={data} region={{ module: 'cue-ticker' }} logger={makeLogger()}
    />,
  );

  it('gives each register half the band, and neither one the other’s width', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    const zone = css.match(/\.surround-cue-ticker__zone \{[^}]*\}/)[0];
    expect(zone).toContain('flex: 1 1 50%');
    // Without this a long unbroken word in one register takes width from the
    // other, and the two halves stop being halves.
    expect(zone).toContain('min-width: 0');
  });

  /**
   * THE BAND'S BORDER RULE, IN ONE SENTENCE: nothing in it is edged.
   *
   * Wave 6 divided the registers with a free-standing hairline; wave 7 moved
   * that hairline onto the NOW panel's inner edge. The user read the result as
   * "a left border with the bottom-left curvature — inconsistent with everything
   * else", and it was: no other surface in the band carries one. The division is
   * now the panel's own silhouette — a lit ground against an unlit one, which is
   * a far stronger edge at ten feet than a 26%-alpha rule was.
   *
   * TO GO RED: put any `border` or edge `box-shadow` back on the ground, the
   * zones or the note boxes.
   */
  it('divides the two registers with the panel\u2019s silhouette and no border at all', () => {
    const css = withStyles().replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');
    expect(css, 'the superseded free-standing hairline is still in the sheet')
      .not.toMatch(/--split \.surround-cue-ticker__zone--now::before/);

    const ground = css.match(/\.surround-cue-ticker__ground \{[^}]*\}/);
    expect(ground, 'the NOW register has no panel to divide with').not.toBeNull();
    expect(ground[0], 'the panel is edged again — the band has no borders')
      .not.toMatch(/box-shadow|border(-(left|right|top|bottom))?:/);
    // The panel is exactly half the band, on the side the config names.
    expect(ground[0]).toMatch(/width: 50%/);
    expect(ground[0]).toMatch(/left: var\(--now-left, 50%\)/);

    // ...and no surface in the band is edged, not just this one.
    for (const sel of ['__zone', '__text', '__line', '__zones', '__piece-head', '__now']) {
      const rule = css.match(new RegExp(`\\.surround-cue-ticker${sel} \\{[^}]*\\}`));
      if (!rule) continue;
      expect(rule[0], `${sel} carries a border — the band's rule is that nothing does`)
        .not.toMatch(/\bborder(-(left|right|top|bottom|color|style))?: (?!none)/);
    }
  });

  it('sets the now-header in the display face and its translation in the annotation face', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    const head = css.match(/\.surround-cue-ticker__now-head \{[^}]*\}/)[0];
    expect(head).toMatch(/font-family: var\(--surround-display,/);
    // A header that wraps stops being a header — one line, ellipsized.
    expect(head).toContain('white-space: nowrap');
    expect(head).toContain('text-overflow: ellipsis');

    const gloss = css.match(/\.surround-cue-ticker__now-translation \{[^}]*\}/)[0];
    expect(gloss, 'the translation is set in a serif — it reads as more programme')
      .toMatch(/font-family: var\(--surround-annotation,/);
    // The published, per-root ten-foot floor (design wave 9b) with the anchor
    // root's 0.72rem as the fallback — see `_tokens.scss`.
    expect(Number(gloss.match(/font-size: var\(--label-floor, ([\d.]+)px\)/)[1]) / 16,
      'below the 0.72rem ten-foot floor').toBeGreaterThanOrEqual(0.72);
  });

  /**
   * THE CUE ACCENT IS GONE (design wave 9). It was a 2.4rem brass hairline at
   * the top of whichever register a timed cue was in — and it is what the user
   * saw as "a little yellow horizontal line towards the top border" of the NOW
   * panel, out of place and connected to nothing they could name. It was: the
   * distinction it drew (a cue, as against a rotating note) is one no viewer can
   * act on, because both are one sentence about the music in the same voice in
   * the same box. On this corpus the cues are synthesised from each segment's
   * `note` field at that segment's own start, so the mark appeared for twelve
   * seconds at every boundary and meant nothing. The band's rule is that nothing
   * in it is edged or ruled; this was the last exception.
   *
   * The STATE is still marked, because it is real and the gate reads it — it
   * simply has no paint of its own.
   */
  it('marks which register a cue is in as state, and draws no accent for it', () => {
    const css = withStyles().replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');
    expect(css, 'the stray brass rule is back in the band')
      .not.toMatch(/__zone--cue::after|--cue \.surround-cue-ticker__zone--piece::after/);
    expect(css, 'something in the ticker paints in brass again')
      .not.toMatch(/background: var\(--brass/);

    const view = mountSplit(500);
    const now = view.container.querySelector('[data-testid="surround-ticker-zone-now"]');
    expect(now.className).toContain('surround-cue-ticker__zone--cue');
    const piece = view.container.querySelector('[data-testid="surround-ticker-zone-piece"]');
    expect(piece.className).not.toContain('surround-cue-ticker__zone--cue');
  });

  it('keeps the now-header out of the dissolve', () => {
    withStyles();
    const view = mountSplit(0, SPLIT_HEADED);
    const header = view.container.querySelector('[data-testid="surround-ticker-now"]');
    // The two text boxes carry the inline opacity transition; the header does
    // not, because it changes on a segment boundary the rule above has already
    // shown the viewer.
    expect(header.style.transition).toBe('');
    expect(view.container.querySelector('[data-testid="surround-ticker-listen"]').style.transition)
      .toBe(`opacity ${CUE_FADE_MS}ms ease`);
  });
});

/**
 * DESIGN WAVE 7 — the bond replaces the repetition.
 *
 * The NOW register used to print the sounding segment's heading beneath a rail
 * that had just printed it. It now carries the same lifted panel ground as that
 * segment, joined along the seam, and the heading is off by default.
 */
describe('CueTicker — the bond, the header and the standing label (design wave 7)', () => {
  let injected = null;
  const withStyles = () => {
    const compiled = sass.compile(path.join(__dirname, 'CueTicker.scss'));
    injected = document.createElement('style');
    injected.textContent = compiled.css;
    document.head.appendChild(injected);
    return compiled.css;
  };
  afterEach(() => { injected?.remove(); injected = null; });

  const mount = (data, position = 0, duration = 3223) => {
    const view = render(
      <CueTicker
        position={position} duration={duration} playing seeking={false}
        data={data} region={{ module: 'cue-ticker', height: 'fill' }} logger={makeLogger()}
      />,
    );
    return {
      ...view,
      root: () => view.container.querySelector('[data-testid="surround-cue-ticker"]'),
      header: () => view.container.querySelector('[data-testid="surround-ticker-now"]'),
      pieceHead: () => view.container.querySelector('[data-testid="surround-ticker-piece-head"]'),
      ground: () => view.container.querySelector('[data-testid="surround-ticker-ground"]'),
    };
  };
  const banded = (band, extra = {}) => ({
    ...SPLIT, ...extra, definition: { regions: {}, collapse: {}, band },
  });

  it('prints NO segment heading by default — the rail already named it', () => {
    const view = mount(SPLIT);
    expect(view.header(), 'the NOW register is repeating the rail’s own heading').toBeNull();
    // ...and the listening note it exists for is still there.
    expect(view.container.querySelector('[data-testid="surround-ticker-listen"]')).not.toBeNull();
  });

  it('prints it on a bars-only rail, where nothing else names the segment', () => {
    const view = mount(banded({ railDensity: 'bars' }));
    expect(view.header().textContent).toContain('Allegro con brio');
  });

  it('honours always and never over the rail’s density, both ways', () => {
    expect(mount(banded({ nowHeading: 'always' })).header()).not.toBeNull();
    expect(mount(banded({ nowHeading: 'never', railDensity: 'bars' })).header()).toBeNull();
  });

  it('says on the root which mode it is in, because the four-line tier depends on it', () => {
    expect(mount(SPLIT).root().className).toContain('surround-cue-ticker--no-now-heading');
    expect(mount(banded({ nowHeading: 'always' })).root().className)
      .not.toContain('surround-cue-ticker--no-now-heading');
  });

  it('carries the rail’s own bond ground on the NOW register, and nowhere else', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    const ground = css.match(/\.surround-cue-ticker__ground \{[^}]*\}/)[0];
    expect(ground).toMatch(/background: var\(--bond-ground,/);
    // THE BAND'S ONE CORNER RULE (design wave 9): square at the top, because
    // that edge is where this panel continues the waist's and a radius there
    // would draw a seam across the middle of one shape; `--bond-radius` at the
    // foot, which is a real exterior edge. The token is the same one the rail's
    // panel takes at its head — see `_tokens.scss`.
    expect(ground).toMatch(/border-radius: 0 0 var\(--bond-radius, [^)]*\) var\(--bond-radius, [^)]*\)/);
    // It bleeds over the panel's own vertical padding so it meets the rail's
    // connector at the region seam with no band ground between them.
    expect(ground).toMatch(/top: calc\(var\(--ticker-pad-y\) \* -1\)/);
    expect(ground).toMatch(/bottom: calc\(var\(--ticker-pad-y\) \* -1\)/);
    // The PIECE register never takes it: the bond is state (what is sounding),
    // and the piece is identity.
    expect(css).not.toMatch(/zone--piece[^{]*\{[^}]*--bond-ground/);
  });

  it('renders no bond panel at all for a band that does not split', () => {
    expect(mount(DATA).ground()).toBeNull();
  });

  it('prints the work’s short title as a standing label, curled', () => {
    const view = mount(banded({}, { piece: { musicEndsAt: 2955, short_title: "Beethoven's Third Symphony" } }));
    expect(view.pieceHead().textContent).toBe('Beethoven’s Third Symphony');
    // It belongs to the PIECE register, not the sounding one.
    expect(view.container.querySelector('[data-testid="surround-ticker-zone-piece"]')
      .contains(view.pieceHead())).toBe(true);
  });

  it('renders NO header when the corpus has not authored one — never a truncated title', () => {
    // The Eroica's real `title` is 43 characters. A header is a short title or
    // it is nothing; a long one cut down to fit is a different, wronger claim
    // about the work than saying nothing at all.
    const view = mount(banded({}, {
      piece: { musicEndsAt: 2955, title: 'Symphony No. 3 in E-flat major, "Eroica"' },
    }));
    expect(view.pieceHead()).toBeNull();
    expect(view.container.textContent).not.toContain('Symphony No. 3');
  });

  it('treats a blank short title as an absent one', () => {
    const view = mount(banded({}, { piece: { musicEndsAt: 2955, short_title: '   ' } }));
    expect(view.pieceHead()).toBeNull();
  });

  it('sets the label quieter and smaller than the note it stands over', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    const label = css.match(/\.surround-cue-ticker__piece-head \{[^}]*\}/)[0];
    // The standing label takes the frame's PUBLISHED label floor, so it scales
    // with the root exactly as the note's own floor does (design wave 9b). The
    // fallback in the sheet is the anchor root's, and it is the number this
    // comparison is meaningful against: both floors below are anchor-root
    // values, which is what makes them comparable at all.
    const labelPx = Number(label.match(/font-size: var\(--label-floor, ([\d.]+)px\)/)[1]);
    expect(labelPx, 'the sheet no longer reads the published floor').toBe(LABEL_FLOOR_ANCHOR_PX);
    const labelRem = labelPx / 16;
    expect(labelRem, 'below the 0.72rem ten-foot floor').toBeGreaterThanOrEqual(0.72);
    // Quieter than the smallest the note can be set at ON THIS ROOT — the fit
    // ladder's own anchor floor, imported rather than re-stated. Both numbers
    // are rem constants derived on the 1280 root, which is what makes them
    // comparable; on a narrower root the note's floor scales down and this one
    // does not, so the comparison is only meaningful at the anchor.
    expect(labelRem * 16, 'the label competes with the note it labels')
      .toBeLessThan(PROSE_FLOOR_ANCHOR_PX);
    // A standing label, not a headline: tracked small caps in the soft ink.
    expect(label).toMatch(/font-variant-caps: all-small-caps/);
    expect(label).toMatch(/color: var\(--ink-soft,/);
    // One line, ellipsised — a header that wraps stops being one.
    expect(label).toContain('white-space: nowrap');
    expect(label).toContain('text-overflow: ellipsis');
  });
});

describe('CueTicker — which side the NOW register sits on (design wave 7)', () => {
  // The swap plays the house dissolve, so its commit is on a timer.
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  let injected = null;
  const withStyles = () => {
    const compiled = sass.compile(path.join(__dirname, 'CueTicker.scss'));
    injected = document.createElement('style');
    injected.textContent = compiled.css;
    document.head.appendChild(injected);
    return compiled.css;
  };
  afterEach(() => { injected?.remove(); injected = null; });

  const banded = (band) => ({ ...SPLIT, definition: { regions: {}, collapse: {}, band } });
  const mount = (data, position = 0) => {
    const props = (p) => ({
      position: p, duration: 3223, playing: true, seeking: false,
      data, region: { module: 'cue-ticker', height: 'fill' }, logger: makeLogger(),
    });
    const view = render(<CueTicker {...props(position)} />);
    return {
      ...view,
      side: () => view.container.querySelector('[data-testid="surround-cue-ticker"]')
        .getAttribute('data-now-side'),
      ground: () => view.container.querySelector('[data-testid="surround-ticker-ground"]'),
      zones: () => view.container.querySelector('.surround-cue-ticker__zones'),
      at: (p) => act(() => { view.rerender(<CueTicker {...props(p)} />); }),
    };
  };

  it('defaults to the right — today’s behaviour, unchanged', () => {
    const view = mount(SPLIT);
    expect(view.side()).toBe('right');
    // A FRESH MOUNT DOES NOT ANIMATE: `useEasedVector` seeds itself with its
    // first target, so the panel is at its side from the first frame and only
    // a LATER change travels.
    expect(view.ground().style.getPropertyValue('--now-left')).toBe('50%');
  });

  it('takes a fixed left, and puts the panel there', () => {
    const view = mount(banded({ nowSide: 'left' }));
    expect(view.side()).toBe('left');
    expect(view.ground().style.getPropertyValue('--now-left')).toBe('0%');
    expect(view.container.querySelector('[data-testid="surround-cue-ticker"]').className)
      .toContain('surround-cue-ticker--now-left');
  });

  it('keeps the DOM order fixed whichever side it lays out on', () => {
    // A screen reader walks the piece register first in both, so the visual
    // flip is a `row-reverse` and nothing more.
    for (const data of [SPLIT, banded({ nowSide: 'left' })]) {
      const view = mount(data);
      const ids = [...view.container.querySelectorAll('[data-testid^="surround-ticker-zone"]')]
        .map((el) => el.getAttribute('data-testid'));
      expect(ids).toEqual(['surround-ticker-zone-piece', 'surround-ticker-zone-now']);
    }
    const css = withStyles().replace(/\s+/g, ' ');
    expect(css).toMatch(/--now-left \.surround-cue-ticker__zones \{[^}]*flex-direction: row-reverse/);
  });

  it('crosses over at half-way when it is dynamic, and holds through a wobble', () => {
    const view = mount(banded({ nowSide: 'dynamic' }), 300);
    expect(view.side()).toBe('left');
    view.at(2000);                       // 68%
    expect(view.side()).toBe('right');
    view.at(1450);                       // 49% — inside the hysteresis band
    expect(view.side(), 'a scrub on the mark flapped the band’s whole layout').toBe('right');
    view.at(1200);                       // 40.6% — clear of it
    expect(view.side()).toBe('left');
  });

  it('makes the swap a considered move, not a jump', () => {
    const view = mount(banded({ nowSide: 'dynamic' }), 300);
    expect(view.zones().className).not.toContain('--swapping');
    view.at(2000);
    // THE PANEL MOVES FIRST. Its side is the raw decision, so it starts
    // travelling in the same frame the rail's connector does.
    expect(view.side()).toBe('right');
    // ...and the panel TRAVELS there rather than jumping (review finding I-6).
    // `--now-left` is published per frame by `useEasedVector`, so in the commit
    // the side flips it is still at the edge it is leaving and eases from
    // there — which is what keeps it welded to the rail's waist, now
    // interpolating the same number. Under jsdom no frame is pumped, so what
    // is read here is the start of the journey; a jump would already read 50%.
    expect(
      view.ground().style.getPropertyValue('--now-left'),
      'the panel teleported to its new side instead of travelling there',
    ).toBe('0%');
    // THE WORDS FOLLOW, on the house dissolve: out to the ground, a held beat,
    // then in with the registers on their new sides — the same choreography
    // every other content change in the frame plays, so the band cannot
    // develop a second transition language.
    expect(view.zones().className, 'the registers changed sides with a hard cut')
      .toContain('surround-cue-ticker__zones--swapping');
    act(() => { vi.advanceTimersByTime(CUE_SWAP_MS); });
    expect(view.zones().className).not.toContain('--swapping');
  });

  /**
   * ONE CLOCK FOR THE WHOLE SHAPE, INCLUDING THE SWAP (review finding I-6).
   *
   * The panel used to travel on a CSS `transition: left var(--accordion-ms)`
   * while the rail's waist — which must stay welded to this panel's WHOLE top
   * edge — jumped to the new hull in the frame the side flipped, because
   * `bondConnector` took the side discretely. For 420ms the two halves of "one
   * shape" were in different places. `--now-left` is now interpolated in JS by
   * the same hook the rail's geometry rides in, and the CSS clock is gone.
   *
   * TO GO RED: put `transition: left …` back on `__ground`, or publish
   * `--now-left` straight from `side` instead of from the eased vector.
   */
  it('travels the panel on the rail’s clock, with no CSS transition of its own', () => {
    const css = withStyles().replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');
    const ground = css.match(/\.surround-cue-ticker__ground \{[^}]*\}/)[0];
    const t = ground.match(/transition: ([^;]*);/);
    expect(t, 'the panel lost its fade').not.toBeNull();
    expect(t[1], 'the panel is back on a second, CSS clock for its position')
      .not.toMatch(/\bleft\b/);
    const view = mount(SPLIT);
    const root = view.container.querySelector('[data-testid="surround-cue-ticker"]');
    expect(root.style.getPropertyValue('--accordion-ms')).toBe(`${ACCORDION_MS}ms`);
    expect(root.style.getPropertyValue('--cue-fade-ms')).toBe(`${CUE_FADE_MS}ms`);
  });
});

describe('CueTicker — smart quotes at the render seam (design wave 7)', () => {
  const mount = (data) => render(
    <CueTicker
      position={0} duration={3223} playing seeking={false}
      data={data} region={{ module: 'cue-ticker', height: 'fill' }} logger={makeLogger()}
    />,
  );

  it('curls the piece facts', () => {
    const view = mount({ ...DATA, facts: ["Il cimento dell'armonia e dell'inventione"] });
    expect(view.container.textContent).toContain('dell’armonia');
    expect(view.container.textContent).not.toContain("'");
  });

  it('curls a listening note’s nested quotation — the real Vivaldi string', () => {
    const viv = {
      contentId: 'plex:663146',
      piece: { musicEndsAt: 600 },
      pieceSegments: [{
        n: 2, name: 'Largo e pianissimo sempre', start: 0,
        listen: ["The violas bark twice a bar, all the way through — Vivaldi marked the part 'the dog that barks'."],
      }],
      facts: ['x'],
    };
    const view = mount(viv);
    expect(view.container.querySelector('[data-testid="surround-ticker-listen"]').textContent)
      .toContain('‘the dog that barks’');
  });

  it('curls a timed cue', () => {
    const view = mount({ ...DATA, cues: [{ at: 0, text: "Vivaldi's storm breaks." }] });
    expect(view.container.textContent).toContain('Vivaldi’s');
  });
});

/**
 * REVIEW ROUND — the three findings that land in this module.
 */
describe('CueTicker — review round (I1, I3, I5)', () => {
  let injected = null;
  const withStyles = () => {
    const compiled = sass.compile(path.join(__dirname, 'CueTicker.scss'));
    injected = document.createElement('style');
    injected.textContent = compiled.css;
    document.head.appendChild(injected);
    return compiled.css;
  };
  afterEach(() => { injected?.remove(); injected = null; });

  const mount = (data, position = 0, duration = 3223, logger = makeLogger()) => {
    const props = (p) => ({
      position: p, duration, playing: true, seeking: false,
      data, region: { module: 'cue-ticker', height: 'fill' }, logger,
    });
    const view = render(<CueTicker {...props(position)} />);
    return {
      ...view,
      logger,
      side: () => view.container.querySelector('[data-testid="surround-cue-ticker"]')
        .getAttribute('data-now-side'),
      zones: () => view.container.querySelector('.surround-cue-ticker__zones'),
      at: (p) => act(() => { view.rerender(<CueTicker {...props(p)} />); }),
    };
  };

  /**
   * I1. The band's half of the bond had no reduced-motion path: at a dynamic
   * crossover the rail's bond jumped to the new side in one frame (correctly
   * guarded in `SegmentMap.scss`) while this panel slid across the band for
   * 420ms — the "one shape" visibly tearing in half for the length of the
   * slide, which is the exact opposite of what the guard is for.
   */
  it('stops the panel sliding and the registers cross-fading under reduced motion', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    const block = css.match(/@media \(prefers-reduced-motion: reduce\) \{(.*?)\} \}/);
    expect(block, 'no reduced-motion block in the compiled sheet').not.toBeNull();
    for (const sel of [
      'surround-cue-ticker__text',
      'surround-cue-ticker__zones',
      'surround-cue-ticker__ground',
    ]) {
      expect(block[1], `${sel} still animates under reduced motion`).toContain(sel);
    }
    expect(block[1]).toMatch(/transition: none/);
    // Every animated thing in the file is covered — a transition declared
    // anywhere outside the guard is the next tear.
    const animated = [...css.matchAll(/(\.surround-cue-ticker[\w-]*)[^{]*\{[^}]*transition:/g)]
      .map((m) => m[1].slice(1))
      .filter((cls) => !cls.includes('--'));
    for (const cls of new Set(animated)) {
      expect(block[1], `${cls} animates but is not in the reduced-motion block`).toContain(cls);
    }
    // ...and the bond is STATE: it still goes to the configured side, it just
    // gets there in one frame. Nothing in the block hides it.
    expect(block[1]).not.toMatch(/display: none/);
    expect(block[1]).not.toMatch(/opacity/);
  });

  /**
   * I3. The two halves used to measure different fractions — this module read
   * `position / end` while the rail read `(position - first) / (end - first)`.
   */
  it('measures the piece from its FIRST SEGMENT, not from the top of the file', () => {
    // A sidecar whose first segment starts at 60s: at position 1530 the naive
    // reading is 0.51 (past the mark) and the true one is exactly 0.50.
    const late = {
      contentId: 'x',
      piece: { musicEndsAt: 3000 },
      definition: { regions: {}, collapse: {}, band: { nowSide: 'dynamic' } },
      pieceSegments: [
        { n: 1, name: 'One', start: 60, listen: ['a'] },
        { n: 2, name: 'Two', start: 1600, listen: ['b'] },
      ],
      facts: ['f'],
    };
    // 1400s → 0.4553 of the piece: under the mark, and under it on the naive
    // reading too, so both agree here.
    const view = mount(late, 1400, 3200);
    expect(view.side()).toBe('left');
    // 1520s → naive 0.5067 (would cross), true 0.4966 (must not).
    view.at(1520);
    expect(
      view.side(),
      'the band crossed on `position / end` while the rail was still short of the mark',
    ).toBe('left');
    // 1530s → true 0.5000. Now it crosses, with the rail.
    view.at(1530);
    expect(view.side()).toBe('right');
  });

  /** I5. */
  it('reports the side crossover', () => {
    const dyn = {
      ...SPLIT, definition: { regions: {}, collapse: {}, band: { nowSide: 'dynamic' } },
    };
    const view = mount(dyn, 300);
    view.logger.debug.mockClear();
    view.at(2000);
    const sides = view.logger.debug.mock.calls.filter(([n]) => n === 'surround.band.side');
    expect(sides.length).toBe(1);
    expect(sides[0][1]).toMatchObject({ side: 'right', from: 'left' });
  });

  /**
   * Review round, minor 7. `pieceEnd` is `duration` for a work with no
   * `musicEndsAt`, and `duration` is 0 until the transport reports — so the
   * side used to seed from a fraction of zero and then swap on the first real
   * tick, playing a full band-blanking dissolve during the entrance whenever
   * such a work resumed past half-way.
   */
  it('does not play a swap on the transport’s first report', () => {
    const noEnd = {
      contentId: 'x',
      piece: {},
      definition: { regions: {}, collapse: {}, band: { nowSide: 'dynamic' } },
      pieceSegments: [{ n: 1, name: 'One', start: 0, listen: ['a'] }],
      facts: ['f'],
    };
    const view = mount(noEnd, 1800, 0);          // duration not yet known
    expect(view.zones().className).not.toContain('--swapping');
    view.at(1800);                                // still nothing
    // ...and now the transport reports, past half-way.
    act(() => {
      view.rerender(
        <CueTicker
          position={1800} duration={3000} playing seeking={false}
          data={noEnd} region={{ module: 'cue-ticker', height: 'fill' }} logger={view.logger}
        />,
      );
    });
    expect(view.side(), 'the first real reading did not land').toBe('right');
    expect(
      view.zones().className,
      'the band blanked itself during the entrance for a side it had never actually shown',
    ).not.toContain('--swapping');
  });
});

/**
 * THE HALF-PERIOD GAP, TESTED AS A RELATION (wave 8, critique finding 2).
 *
 * The existing spec above asserts the DELAY VALUES — that the wait is half
 * `FACT_INTERVAL_MS`, and that at half a period one zone has moved and the
 * other has not. Both were true, and the invariant they were standing in for was
 * false: the NOW register re-arms at every segment boundary and at the end of
 * every cue, and it used to wait a flat half-period from THAT moment while the
 * piece register's beat ran on untouched from mount. One boundary later the
 * offset was whatever the boundary's timing made it — including zero, the two
 * zones dissolving in the same instant, which is the whole reason the constant
 * exists. Nothing could catch it because nothing measured the two clocks
 * against each other AFTER a boundary.
 *
 * TO GO RED: replace `phaseDelay(Date.now() - pieceSwappedAt.current, …)` in the
 * NOW register's effect with a flat `FACT_INTERVAL_MS / 2`. The boundary at 7s then
 * puts the NOW swap 3s from a piece swap instead of 10s, and the assertion
 * below reports the measured gap.
 */
describe('CueTicker — the two registers never blink together (wave 8)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const PHASED = {
    contentId: 'plex:663134',
    piece: { musicEndsAt: 2955 },
    pieceSegments: [
      { n: 1, name: 'Allegro con brio', start: 0, listen: ['One A.', 'One B.'] },
      { n: 2, name: 'Marcia funebre. Adagio assai', start: 976, listen: ['Two A.', 'Two B.'] },
    ],
    cues: [],
    facts: ['Fact one.', 'Fact two.'],
  };

  it('re-establishes the half-period offset across a segment boundary', () => {
    const props = (p) => ({
      position: p, duration: 3223, playing: true, seeking: false,
      data: PHASED, region: { module: 'cue-ticker', height: 'fill' }, logger: makeLogger(),
    });
    const view = render(<CueTicker {...props(0)} />);
    const read = (id) => view.container.querySelector(`[data-testid="${id}"]`)?.textContent ?? '';

    const STEP = 250;
    const HORIZON = 60000;
    let now = 0;
    let piece = read('surround-ticker-text');
    let listen = read('surround-ticker-listen');
    const pieceSwaps = [];
    const listenSwaps = [];
    // The boundary lands at 7s — deliberately NOT on the rotation's beat, so a
    // "wait half a period from here" phase would be 3s away from a piece swap
    // rather than 10s.
    const BOUNDARY_AT = 7000;
    let crossed = false;

    while (now < HORIZON) {
      if (!crossed && now >= BOUNDARY_AT) {
        act(() => { view.rerender(<CueTicker {...props(1000)} />); });
        crossed = true;
        listen = read('surround-ticker-listen');   // the boundary's own instant commit
      }
      act(() => { vi.advanceTimersByTime(STEP); });
      now += STEP;
      const p = read('surround-ticker-text');
      const l = read('surround-ticker-listen');
      // A dissolve blanks the line for a beat before committing the new one; the
      // swap is the moment WORDS arrive, and both registers pay the same delay,
      // so it cancels out of the gap between them.
      if (p && p !== piece) { pieceSwaps.push(now); piece = p; }
      if (l && l !== listen) { listenSwaps.push(now); listen = l; }
    }

    expect(pieceSwaps.length, 'the piece register never rotated').toBeGreaterThan(1);
    expect(listenSwaps.length, 'the NOW register never rotated after the boundary').toBeGreaterThan(1);

    // THE RELATION. Every NOW swap sits as far as it can from every piece swap:
    // half a period, allowing for the sampling step at either end.
    const half = FACT_INTERVAL_MS / 2;
    const gaps = listenSwaps.map((l) => {
      const nearest = pieceSwaps.reduce(
        (best, p) => Math.min(best, Math.abs(l - p)), Infinity,
      );
      return { listenAt: l, nearestPieceGap: nearest };
    });
    gaps.forEach(({ listenAt, nearestPieceGap }) => {
      expect(
        nearestPieceGap,
        `a NOW swap at ${listenAt}ms landed ${nearestPieceGap}ms from a piece swap; the two registers are meant to be ${half}ms apart. piece swaps at [${pieceSwaps}], NOW swaps at [${listenSwaps}]`,
      ).toBeGreaterThan(half - (STEP * 4));
    });
  });

  /**
   * ...AND WHICHEVER REGISTER RE-ARMS. The fix above re-phases the NOW register
   * whenever IT re-arms — every segment boundary, every cue end. The PIECE
   * register re-arms too: its effect depends on `facts.length`, so a corpus edit
   * picked up by the mtime watcher can grow a work's fact pool without touching
   * its segments, restarting the piece clock while the NOW register runs on an
   * offset measured against where that clock used to be. Same defect, roles
   * swapped.
   *
   * TO GO RED: drop `pieceArm` from the NOW effect's dependency list.
   */
  it('re-establishes the offset when the PIECE register is the one that re-arms', () => {
    const props = (facts) => ({
      position: 0, duration: 3223, playing: true, seeking: false,
      data: { ...PHASED, facts }, region: { module: 'cue-ticker', height: 'fill' }, logger: makeLogger(),
    });
    const view = render(<CueTicker {...props(['Fact one.', 'Fact two.'])} />);
    const read = (id) => view.container.querySelector(`[data-testid="${id}"]`)?.textContent ?? '';

    const STEP = 250;
    const HORIZON = 60000;
    let now = 0;
    let piece = read('surround-ticker-text');
    let listen = read('surround-ticker-listen');
    const pieceSwaps = [];
    const listenSwaps = [];
    // The corpus grows a third fact at 7s — off the beat, and touching nothing
    // the NOW register's own effect depends on.
    const EDIT_AT = 7000;
    let edited = false;

    while (now < HORIZON) {
      if (!edited && now >= EDIT_AT) {
        act(() => {
          view.rerender(<CueTicker {...props(['Fact one.', 'Fact two.', 'Fact three.'])} />);
        });
        edited = true;
        piece = read('surround-ticker-text');
        listen = read('surround-ticker-listen');
      }
      act(() => { vi.advanceTimersByTime(STEP); });
      now += STEP;
      const p = read('surround-ticker-text');
      const l = read('surround-ticker-listen');
      if (p && p !== piece) { pieceSwaps.push(now); piece = p; }
      if (l && l !== listen) { listenSwaps.push(now); listen = l; }
    }

    expect(pieceSwaps.length, 'the piece register never rotated after the edit').toBeGreaterThan(1);
    expect(listenSwaps.length, 'the NOW register never rotated after the edit').toBeGreaterThan(1);

    const half = FACT_INTERVAL_MS / 2;
    listenSwaps.forEach((l) => {
      const nearest = pieceSwaps.reduce((best, p) => Math.min(best, Math.abs(l - p)), Infinity);
      expect(
        nearest,
        `a NOW swap at ${l}ms landed ${nearest}ms from a piece swap after the PIECE register re-armed; they are meant to be ${half}ms apart. piece swaps at [${pieceSwaps}], NOW swaps at [${listenSwaps}]`,
      ).toBeGreaterThan(half - (STEP * 4));
    });
  });

  /**
   * A RECORDING WITH NO PLACEABLE SEGMENT HAS NO "NOW" TO SPLIT OFF.
   *
   * The split used to be decided by the AUTHORED segment list while every
   * downstream decision used the placeable one, so a work authored ahead of its
   * timings — or a sidecar whose `starts` were all refused — got two registers
   * above an empty rail, the right one printing `Listen for` over facts borrowed
   * from the left one for the length of the piece. Two registers saying the same
   * thing from the same pool is the case the split exists to avoid.
   *
   * TO GO RED: `const split = segments.length > 0`.
   */
  it('does not split the band for a recording whose segments cannot be placed', () => {
    const untimed = {
      ...PHASED,
      pieceSegments: PHASED.pieceSegments.map((m) => ({ ...m, start: undefined })),
    };
    const view = render(
      <CueTicker
        position={100} duration={3223} playing seeking={false}
        data={untimed} region={{ module: 'cue-ticker', height: 'fill' }} logger={makeLogger()}
      />,
    );
    expect(view.container.querySelector('[data-testid="surround-cue-ticker"]').getAttribute('data-split'))
      .toBe('false');
    expect(view.container.querySelector('[data-testid="surround-ticker-zone-now"]')).toBeNull();
    // ...and the one register it does keep still carries the programme note.
    expect(view.container.querySelector('[data-testid="surround-ticker-text"]').textContent)
      .toBe('Fact one.');
  });

  it('phaseDelay always lands half a period after a piece swap', () => {
    const period = 20000;
    // Whatever the elapsed time, waiting `phaseDelay` puts us exactly on a
    // half-period offset from the piece register's beat.
    for (let elapsed = 0; elapsed < 40000; elapsed += 137) {
      const landsAt = elapsed + phaseDelay(elapsed, period);
      expect(
        ((landsAt % period) + period) % period,
        `elapsed ${elapsed}ms -> swap at ${landsAt}ms, which is ${landsAt % period}ms into the period`,
      ).toBeCloseTo(period / 2, 6);
    }
  });
});

/**
 * ============================================================================
 * A NOTE THE FIT HAS REFUSED MUST NOT REACH THE SCREEN — including a CUE.
 * ============================================================================
 *
 * Review finding C-1, and it was a real hole in the law. `bandPools` measures
 * every cue, so an over-long one IS rejected and the surviving type size is
 * solved EXCLUDING it — and then `activeCue` was chosen from the unfiltered
 * `cues` and painted at that size, in a box with `overflow: hidden` and no
 * ellipsis. The one string the fit had certified as unsettable was the one
 * string that could preempt the panel.
 *
 * WHY THERE IS A STAND-IN RULER HERE, AND WHAT IT IS NOT. happy-dom has no
 * layout: every box is 0x0, so `fitBand` declines to fit and nothing is ever
 * rejected — which is exactly why this defect could not be seen from jsdom. The
 * REAL ruler is measured in Chromium against the compiled stylesheet and the
 * vendored faces (`band.measure.test.jsx`); what is under test HERE is the
 * WIRING — does a string the fit refused reach the register? — and for that
 * question any monotone ruler will do, provided it is honest about being one.
 * So this one is a plain model (characters per line from the box's width and
 * the trial size, lines times the trial leading) installed on the prototype for
 * the length of the case and removed after.
 */
/**
 * THE RULER, hoisted (this wave). Two blocks need it now — the fit's refusals
 * below, and the container's fact pools above them — and one stand-in for
 * layout that both install is one place for it to be honest about being a
 * model. Installed for the length of a case and removed after.
 */
const ORIGINAL_RECT = Element.prototype.getBoundingClientRect;
let restore = null;

/** A monotone stand-in for layout. See the block comment above. */
const withRuler = ({ roomPx, widthPx, emPerChar = 0.46 }) => {
  const isBox = (el) => el?.classList?.contains('surround-cue-ticker__text');
  const isProbe = (el) => el?.classList?.contains('surround-cue-ticker__probe');
  // The DOM implementation decides which prototype in the chain owns
  // `clientHeight`; patching the wrong one is silently shadowed by the right
  // one, so the owner is found rather than assumed.
  const ownerOf = (prop) => {
    let proto = HTMLElement.prototype;
    while (proto && !Object.getOwnPropertyDescriptor(proto, prop)) {
      proto = Object.getPrototypeOf(proto);
    }
    return proto || HTMLElement.prototype;
  };
  const defs = ['clientHeight', 'clientWidth'].map((prop) => {
    const owner = ownerOf(prop);
    const prev = Object.getOwnPropertyDescriptor(owner, prop);
    Object.defineProperty(owner, prop, {
      configurable: true,
      get() {
        if (isBox(this)) return prop === 'clientHeight' ? roomPx : widthPx;
        return prev?.get ? prev.get.call(this) : 0;
      },
    });
    return [prop, prev, owner];
  });
  Element.prototype.getBoundingClientRect = function rect() {
    if (!isProbe(this)) return ORIGINAL_RECT.call(this);
    const size = parseFloat(this.style.fontSize) || 16;
    const leading = parseFloat(this.style.lineHeight) || 1.35;
    const box = parseFloat(this.style.width) || widthPx;
    const perLine = Math.max(1, Math.floor(box / (emPerChar * size)));
    const lines = Math.max(1, Math.ceil((this.textContent?.length ?? 0) / perLine));
    const height = lines * size * leading;
    return {
      width: box, height, top: 0, left: 0, right: box, bottom: height, x: 0, y: 0,
    };
  };
  restore = () => {
    defs.forEach(([prop, prev, owner]) => {
      if (prev) Object.defineProperty(owner, prop, prev);
      else delete owner[prop];
    });
    Element.prototype.getBoundingClientRect = ORIGINAL_RECT;
  };
};


describe('CueTicker — nothing the fit refuses reaches the screen (wave 9, C-1)', () => {
  afterEach(() => { restore?.(); restore = null; });

  /** A tight band: two lines of room at the fit's own size floor. */
  const TIGHT = { roomPx: 2 * PROSE_FLOOR_ANCHOR_PX * 1.25, widthPx: 275 };

  const LONG_CUE = 'The funeral march, and the reason it is the centre of the symphony rather than an interlude: Beethoven puts a death where a minuet had always gone, and the whole shape of the piece changes around it.';
  const SHORT_FACT = 'The published title page reads: composed to celebrate the memory of a great man.';

  const DATA = {
    contentId: 'plex:663134',
    piece: { musicEndsAt: 2955 },
    pieceSegments: [
      { n: 1, name: 'Allegro con brio', start: 0, listen: ['Two hammered chords.'] },
      { n: 2, name: 'Marcia funebre', start: 976, listen: ['The basses mutter.'] },
    ],
    cues: [{ at: 500, text: LONG_CUE }],
    facts: [SHORT_FACT],
  };

  const mount = (position) => render(
    <CueTicker
      position={position} duration={3223} playing seeking={false}
      data={DATA} region={{ module: 'cue-ticker' }} logger={makeLogger()}
    />,
  );

  /**
   * TO GO RED: choose `activeCue` from `cues` rather than from `fittableCues`
   * (`CueTicker.jsx`) — i.e. revert C-1. The register then paints the whole
   * 199-character cue in a box two lines tall, and the bottom of it is clipped
   * away in silence.
   */
  it('does not fire a cue the fit refused, and keeps rotating instead', () => {
    withRuler(TIGHT);
    const view = mount(500);   // inside the cue's 12s dwell
    const listen = view.container.querySelector('[data-testid="surround-ticker-listen"]');
    expect(
      listen.textContent,
      'the register is painting a cue the fit certified as unsettable — at a size solved '
      + 'without it, in a box with overflow: hidden and no ellipsis',
    ).not.toContain('Beethoven puts a death');
    // ...and the register is not left blank by the refusal: the segment's own
    // rotation carries on underneath.
    expect(listen.textContent).toBe('Two hammered chords.');
  });

  it('warns with the cue’s own budget, so the corpus can be fixed', () => {
    withRuler(TIGHT);
    const logger = makeLogger();
    render(
      <CueTicker
        position={500} duration={3223} playing seeking={false}
        data={DATA} region={{ module: 'cue-ticker' }} logger={logger}
      />,
    );
    const warn = logger.warn.mock.calls.find(([event]) => event === 'surround.note.unfittable');
    expect(warn, 'nothing was warned about a cue the band refused to show').toBeTruthy();
    const cut = logger.warn.mock.calls
      .filter(([event]) => event === 'surround.note.unfittable')
      .map(([, payload]) => payload)
      .find((payload) => payload.chars === LONG_CUE.length);
    expect(cut, `no warn names the ${LONG_CUE.length}-character cue`).toBeTruthy();
    expect(cut.zone).toBe('now');
    expect(cut.budget).toBeGreaterThan(0);
    expect(cut.budget).toBeLessThan(LONG_CUE.length);
    expect(cut.cut).toBe(LONG_CUE.length - cut.budget);
  });

  /**
   * THE SAME RULE IN THE UNSPLIT BAND, where a cue belongs to the PIECE
   * register — which is the zone `bandPools` measures it against, so it is the
   * zone the filter has to read.
   */
  it('withholds an unfittable cue from the single register of an unsplit band', () => {
    withRuler(TIGHT);
    const view = render(
      <CueTicker
        position={500} duration={3223} playing seeking={false}
        data={{ ...DATA, pieceSegments: [] }}
        region={{ module: 'cue-ticker' }} logger={makeLogger()}
      />,
    );
    const text = view.container.querySelector('[data-testid="surround-ticker-text"]');
    expect(text.textContent).not.toContain('Beethoven puts a death');
    expect(text.textContent).toBe(SHORT_FACT);
  });

  /** A cue that FITS still preempts the register — the filter is a filter, not a ban. */
  it('still fires a cue that fits', () => {
    withRuler({ roomPx: 6 * PROSE_FLOOR_ANCHOR_PX * 1.35, widthPx: 420 });
    const view = mount(500);
    expect(view.container.querySelector('[data-testid="surround-ticker-listen"]').textContent)
      .toContain('Beethoven puts a death');
  });
});

/* ========================================================================== */
/* THE PIECE REGISTER FOLLOWS THE WORK THAT IS SOUNDING (container rails)      */
/* ========================================================================== */

/**
 * The polonaise season, reduced to two parts. The container's own
 * `pieceSegments` are the work's seven `movements:` entries with no timings —
 * exactly what the live payload carries — so the band does NOT split here, and
 * the register under test is the only one there is.
 */
const SET_DATA = {
  contentId: 'plex:696238',
  piece: { title: 'Polonaises', short_title: "Chopin's Polonaises" },
  timeline: { totalSounding: 896, parts: [{ index: 0 }, { index: 1 }] },
  pieceSegments: [],
  cues: [],
  segments: [
    {
      n: 1, name: 'Polonaise in C-sharp minor, Op. 26 No. 1', contentId: 'plex:696238',
      part: 0, offset: 0, duration: 447, start: 0, end: 447,
      group: { index: 0, work: 'chopin/polonaise-op-26-no-1', title: 'Polonaise No. 1…' },
    },
    {
      n: 6, name: 'Polonaise in A-flat major, Op. 53', contentId: 'plex:696243',
      part: 1, offset: 447, duration: 449, start: 0, end: 449,
      group: { index: 1, work: 'chopin/polonaise-op-53', title: 'Polonaise No. 6…' },
    },
  ],
  groupFacts: {
    'chopin/polonaise-op-26-no-1': ['A bare octave leap opens it.', 'Op. 26 was the first pair he published.'],
    'chopin/polonaise-op-53': ['The Heroic nickname is not Chopin’s.', 'Published in December 1843.'],
  },
  facts: ['The polonaise is a Polish processional dance in triple time.'],
};

const mountSet = (data, contentId, position) => render(
  <CueTicker
    position={position} duration={449} playing seeking={false}
    data={{ ...data, contentId }} region={{ module: 'cue-ticker' }} logger={makeLogger()}
  />,
);

describe('CueTicker — the facts follow the segment', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const line = (view) => view.container
    .querySelector('[data-testid="surround-ticker-text"]').textContent;

  /**
   * TO GO RED: read `data.facts` directly, as the register did before this
   * wave — the band talks about the set for fifty-nine minutes and this reads
   *   expected 'The polonaise is a Polish processional dance in triple time.'
   *   to be 'The Heroic nickname is not Chopin’s.'
   */
  it('rotates the facts of the work that is sounding, not the set’s', () => {
    expect(line(mountSet(SET_DATA, 'plex:696243', 200)))
      .toBe('The Heroic nickname is not Chopin’s.');
    expect(line(mountSet(SET_DATA, 'plex:696238', 100)))
      .toBe('A bare octave leap opens it.');
  });

  /** The segment's own note outranks its work's facts. */
  it('prefers a segment’s own note where the corpus authored one', () => {
    const noted = {
      ...SET_DATA,
      segments: [
        SET_DATA.segments[0],
        { ...SET_DATA.segments[1], note: 'The trio is in E major, a remote shift.' },
      ],
    };
    expect(line(mountSet(noted, 'plex:696243', 200)))
      .toBe('The trio is in E major, a remote shift.');
  });

  /** Nothing sounding — between two works, the set is the only subject left. */
  it('falls back to the set’s facts when no segment is sounding', () => {
    expect(line(mountSet(SET_DATA, 'plex:696243', 900)))
      .toBe('The polonaise is a Polish processional dance in triple time.');
  });

  /**
   * THE POOL SWAP IS THE HOUSE DISSOLVE, not a second choreography: out, a beat
   * of empty ground, then in. The register is HIDDEN for the fade-out and the
   * old work's fact is still the one on screen until the commit.
   *
   * TO GO RED: give the payload a key that ignores its text (the `fact:{index}`
   * key of wave 8) — the dissolve sees the same key, plays nothing, and the
   * first assertion fails with `expected false to be true`.
   */
  it('swaps the pool through the house dissolve, and opens it at its first fact', () => {
    const props = (contentId, position) => ({
      position,
      duration: 449,
      playing: true,
      seeking: false,
      data: { ...SET_DATA, contentId },
      region: { module: 'cue-ticker' },
      logger: makeLogger(),
    });
    const view = render(<CueTicker {...props('plex:696238', 100)} />);
    const text = () => view.container.querySelector('[data-testid="surround-ticker-text"]');
    expect(text().textContent).toBe('A bare octave leap opens it.');

    // Let the first work's rotation move OFF its first fact, so "opens at the
    // first fact" is a claim about the new pool rather than about index 0
    // never having moved.
    act(() => { vi.advanceTimersByTime(FACT_INTERVAL_MS); });
    act(() => { vi.advanceTimersByTime(CUE_SWAP_MS); });
    expect(text().textContent).toBe('Op. 26 was the first pair he published.');

    // The transport moves into the second polonaise.
    act(() => { view.rerender(<CueTicker {...props('plex:696243', 200)} />); });
    expect(text().className.includes('surround-cue-ticker__text--hidden')).toBe(true);
    expect(text().textContent, 'the new pool arrived without a dissolve')
      .toBe('Op. 26 was the first pair he published.');

    act(() => { vi.advanceTimersByTime(CUE_FADE_MS + CUE_HOLD_MS); });
    act(() => { vi.advanceTimersByTime(CUE_FADE_MS); });
    expect(text().textContent).toBe('The Heroic nickname is not Chopin’s.');
    expect(text().className.includes('surround-cue-ticker__text--hidden')).toBe(false);
  });
});

/**
 * THE GATE, on the payload it exists for.
 *
 * The Eroica is FOUR segments in ONE media item, and two of them carry an
 * authored `note` — which the store already docks as a timed cue at its own
 * second. A register that followed the segment on any payload with segments
 * would replace that symphony's programme facts with one line about the funeral
 * march, and print it twice over when the cue fired.
 */
describe('CueTicker — one media item is not a container', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const EROICA = {
    contentId: 'plex:663134',
    piece: { title: 'Symphony No. 3', musicEndsAt: 2955 },
    timeline: { totalSounding: 2933.65, parts: [{ contentId: 'plex:663134', index: 0 }] },
    pieceSegments: [],
    cues: [],
    segments: [
      {
        n: 1, name: 'Allegro con brio', contentId: 'plex:663134', part: 0,
        offset: 0, duration: 954.65, start: 21.35, end: 976,
      },
      {
        n: 2, name: 'Marcia funebre', note: 'The funeral march.', contentId: 'plex:663134',
        part: 0, offset: 954.65, duration: 949, start: 976, end: 1925,
      },
    ],
    facts: ['Beethoven tore the page.', 'The premiere ran over two hours.'],
  };

  /**
   * TO GO RED: drop `isComposedContainer` from the pool's index — the register
   * shows 'The funeral march.' at 1200s and this fails with
   *   expected 'The funeral march.' to be 'Beethoven tore the page.'
   */
  it('keeps the work’s own facts through a movement that has a note', () => {
    const view = render(
      <CueTicker
        position={1200} duration={3223} playing seeking={false}
        data={EROICA} region={{ module: 'cue-ticker' }} logger={makeLogger()}
      />,
    );
    expect(view.container.querySelector('[data-testid="surround-ticker-text"]').textContent)
      .toBe('Beethoven tore the page.');
  });
});

/**
 * THE FIT IS STILL A CONSTANT OF THE PIECE — the reserved-height law, on the
 * one thing this wave made variable. The type is solved against every pool the
 * register can reach, so moving from one work to the next cannot resize the
 * band.
 */
describe('CueTicker — a pool swap does not resize the band', () => {
  afterEach(() => { restore?.(); restore = null; });

  const LONG = 'The central left-hand octaves drive downward at speed for page after page, turning the piano into a full marching force and asking of the hand a passage that pianists have measured themselves against ever since.';

  const DATA = {
    ...SET_DATA,
    groupFacts: {
      'chopin/polonaise-op-26-no-1': ['A bare octave leap opens it.'],
      'chopin/polonaise-op-53': [LONG],
    },
  };

  const sizeAt = (contentId, position) => {
    const view = render(
      <CueTicker
        position={position} duration={449} playing seeking={false}
        data={{ ...DATA, contentId }} region={{ module: 'cue-ticker' }} logger={makeLogger()}
      />,
    );
    const root = view.container.querySelector('[data-testid="surround-cue-ticker"]');
    const size = root.style.getPropertyValue('--note-size');
    view.unmount();
    return size;
  };

  /**
   * TO GO RED: measure only the sounding pool (`bandPools({ facts })` with the
   * rotating pool instead of the union) — the first polonaise's band is solved
   * for one short fact and the sixth's for a 208-character one, so the two come
   * back at different sizes and the band resizes mid-programme.
   */
  it('solves one size for every pool the register can reach', () => {
    withRuler({ roomPx: 6 * PROSE_FLOOR_ANCHOR_PX * 1.3, widthPx: 420 });
    const first = sizeAt('plex:696238', 100);
    const sixth = sizeAt('plex:696243', 200);
    expect(first, 'the band was not fitted at all — the ruler is not installed').not.toBe('');
    expect(
      sixth,
      `the band is set at ${first} while the first polonaise plays and ${sixth} while the `
      + 'sixth does — the type resizes at a part boundary',
    ).toBe(first);
  });
});
