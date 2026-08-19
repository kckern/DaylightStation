import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import * as sass from 'sass-embedded';
import CueTicker, {
  CUE_FADE_MS, CUE_HOLD_MS, CUE_SWAP_MS, CUE_DWELL_S, FACT_INTERVAL_MS,
  LISTEN_INTERVAL_MS, LISTEN_PHASE_MS,
} from './CueTicker.jsx';

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

  it('reserves two lines of height whatever is showing, so rotation never shifts layout', () => {
    withStyles();
    const short = mount('A fact.');
    const long = mount('A considerably longer programme note that will certainly wrap onto a second line at this measure.');

    const reserve = (view) => window.getComputedStyle(
      view.container.querySelector('[data-testid="surround-ticker-text"]'),
    ).getPropertyValue('min-height');

    expect(parseFloat(reserve(short))).toBeGreaterThan(0);
    expect(reserve(short)).toBe(reserve(long));   // one line and two: same box
  });

  // `-webkit-line-clamp` alone is not a ceiling: in current Chromium
  // `display: -webkit-box` computes to `flow-root`, so a shrinkable flex item
  // relying on the clamp for its box height can still collapse (this is what
  // happened to the rail fact — see ComposerCard.scss). The real ceiling is
  // the explicit `max-height`, so that is what this asserts, not the clamp
  // declaration (kept only for the ellipsis, and covered separately below).
  it('caps the panel with an explicit ceiling, not just the clamp', () => {
    withStyles();
    const view = mount('A fact.');
    const style = window.getComputedStyle(view.container.querySelector('[data-testid="surround-ticker-text"]'));
    // happy-dom resolves `em` off the default 16px root rather than the
    // element's own cascaded font-size, so 1.35em reads back as 21.6px here —
    // the point of the assertion is that a NUMBER exists at all (a ceiling),
    // not the clamp declaration, which happy-dom would happily report even
    // with no box height behind it.
    // Design wave 6: the BASE reserve is ONE line, because the base rule is
    // the layout for the tightest band in the fleet (measured: 37.4px of
    // content on the 960x540 screen-root, once the movement names have wrapped
    // and the translation line has been paid for). Two lines is what the
    // container query below promotes it to wherever the band can afford it.
    expect(style.getPropertyValue('max-height')).toBe('21.6px');
    expect(style.getPropertyValue('min-height')).toBe('21.6px');
    expect(style.getPropertyValue('overflow')).toBe('hidden');
  });

  /**
   * Fix round 1 (review finding C1) — THE RESERVE IS THREE LINES WHERE THE
   * BAND CAN PAY FOR IT, not two. Wave 6 shipped two, and a real authored fact
   * (the Eroica's 232-character Napoleon note) still ellipsized at every
   * screen in the fleet — a two-line box only ever showed 44-90 of it.
   *
   * happy-dom does not evaluate `@container`, so this reads the compiled sheet:
   * the query exists, it is on the ticker's own container name, its threshold
   * is at least the right zone's own three-line arithmetic, and inside it the
   * reserve and the clamp both go to three while the now-header's translation
   * appears.
   */
  it('promotes the reserve, the clamp and the translation in a band with room', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    const panel = css.match(/\.surround-cue-ticker \{[^}]*\}/)[0];
    expect(panel, 'the container has no name for the query to target')
      .toContain('container-name: ticker');

    const q = css.match(/@container ticker \(min-height: ([\d.]+)px\) \{(.*?)\} \}/);
    expect(q, 'no container query — the band cannot adapt to the room it has').not.toBeNull();
    const threshold = Number(q[1]);
    // The right zone in the three-line layout owes: the now-header's two
    // lines (0.78rem x 1.2 + 0.1rem + 0.72rem x 1.2 = 30.4px) plus three
    // lines of note at the clamp's FLOOR (3 x 0.88rem x 1.35 = 57.0px). A
    // threshold below that promotes a layout the zone cannot hold, which is
    // an overflow the region then clips — and this IS the same arithmetic
    // that overflowed at wave 6's 19cqh coefficient, which is why the
    // coefficient itself changed alongside the line count (see the SCSS).
    expect(threshold, 'the query promotes a layout the right zone cannot hold')
      .toBeGreaterThanOrEqual(30.4 + (3 * 0.88 * 16 * 1.35));

    const inside = q[2];
    expect(inside).toMatch(/\.surround-cue-ticker__text \{[^}]*min-height: 4\.05em/);
    expect(inside).toMatch(/\.surround-cue-ticker__text \{[^}]*max-height: 4\.05em/);
    expect(inside).toMatch(/\.surround-cue-ticker__line \{[^}]*-webkit-line-clamp: 3/);
    expect(inside).toMatch(/__now-translation \{[^}]*display: block/);
  });

  /**
   * Fix round 1 (review finding C1) — the three-line reserve must not overflow
   * the ticker's OWN box at the container height the fleet actually produces.
   * This is the arithmetic that broke at wave 6's 19cqh coefficient (measured:
   * 104.9px of header+note needed against a 96.8px budget at 1280x720) and is
   * why the coefficient dropped to 16 alongside the line count. Proved here
   * algebraically rather than re-measured in a browser: at the container
   * query's own threshold (floor font, the worst case — see the SCSS comment)
   * the now-zone's header-plus-three-lines must fit inside the threshold
   * itself, and past the threshold the reserve grows more slowly than the
   * container does, so the margin only widens.
   */
  it('does not budget more for the three-line now-zone than the threshold itself holds', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    const q = css.match(/@container ticker \(min-height: ([\d.]+)px\) \{(.*?)\} \}/);
    const threshold = Number(q[1]);
    const text = css.match(/\.surround-cue-ticker__text \{[^}]*\}/)[0];
    const [, , coefStr] = text.match(/font-size: clamp\(([\d.]+)rem, ([\d.]+)cqh, ([\d.]+)rem\)/);
    const coef = Number(coefStr) / 100;
    const header = css.match(/\.surround-cue-ticker__now-head \{[^}]*\}/)[0];
    const headerLineHeight = Number(header.match(/font-size: ([\d.]+)rem/)[1])
      * Number(header.match(/line-height: ([\d.]+)/)[1]) * 16;
    const translation = css.match(/\.surround-cue-ticker__now-translation \{[^}]*\}/)[0];
    const translationLineHeight = Number(translation.match(/font-size: ([\d.]+)rem/)[1])
      * Number(translation.match(/line-height: ([\d.]+)/)[1]) * 16;
    const nowBox = css.match(/\.surround-cue-ticker__now \{[^}]*\}/)[0];
    const margin = Number(nowBox.match(/margin: [\d.]+ 0 ([\d.]+)rem/)[1]) * 16;
    const headerBudget = headerLineHeight + margin + translationLineHeight;

    const noteAt = (h) => Math.min(Math.max(coef * h, 0.88 * 16), 1.5 * 16);
    const budgetAt = (h) => headerBudget + (3 * 1.35 * noteAt(h));
    // At the threshold itself (the worst case: font still at or near the
    // floor) the now-zone's own arithmetic must not exceed the room the
    // query just granted it.
    expect(budgetAt(threshold), 'the promoted layout overflows the container that promoted it')
      .toBeLessThanOrEqual(threshold);
    // ...and past it, real fleet sizes stay comfortably inside their own room.
    expect(budgetAt(96.8), '1280x720 overflows the ticker').toBeLessThanOrEqual(96.8);
    expect(budgetAt(215.6), '1920x1080 overflows the ticker').toBeLessThanOrEqual(215.6);
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
   * Design wave 5 — TYPE THAT FILLS ITS ROOM. `cqh` is 1% of the TICKER's own
   * height, so the note is large in the tall band a 1080p frame gives it and
   * steps down rather than overflowing in the ~59px the gate's 960x540
   * screen-root leaves. The floor on the module itself is what makes the
   * container safe: `container-type: size` removes a box's own contribution to
   * its height, so a definition that did NOT give the ticker `height: fill`
   * would otherwise compute it to zero.
   */
  it('sizes the note against the zone it was given, with a floor under the container', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    const panel = css.match(/\.surround-cue-ticker \{[^}]*\}/)[0];
    expect(panel, 'the ticker is not a container, so cqh would resolve against the viewport')
      .toContain('container-type: size');
    const floor = panel.match(/min-height: ([\d.]+)rem/);
    expect(floor, 'a size container with no floor collapses to nothing').not.toBeNull();

    const text = css.match(/\.surround-cue-ticker__text \{[^}]*\}/)[0];
    const clamp = text.match(/font-size: clamp\(([\d.]+)rem, ([\d.]+)cqh, ([\d.]+)rem\)/);
    expect(clamp, 'the note is set at a fixed size again').not.toBeNull();
    const [, min, per, max] = clamp.map(Number);
    expect(min, 'below the ten-foot floor').toBeGreaterThanOrEqual(0.85);
    expect(max, 'a programme note as loud as the work title on the plate').toBeLessThanOrEqual(1.6);
    expect(max).toBeGreaterThan(min);
    // The BASE layout — one line of note under one line of now-header — plus
    // the panel's own padding has to fit inside that floor, otherwise the
    // module overflows its own container on the smallest screen in the fleet.
    // (Wave 5 did this arithmetic for two lines; wave 6's base reserve is one,
    // and the header is what took the other line.)
    const padRem = Number(panel.match(/padding: ([\d.]+)rem/)[1]) * 2;
    const header = css.match(/\.surround-cue-ticker__now-head \{[^}]*\}/)[0];
    const headerRem = Number(header.match(/font-size: ([\d.]+)rem/)[1])
      * Number(header.match(/line-height: ([\d.]+)/)[1]);
    expect(min * 1.35 + headerRem + padRem).toBeLessThanOrEqual(Number(floor[1]));
    // ...and the coefficient bites between the zones the fleet actually
    // produces (~59px on the gate's screen-root, ~118px on the 1280x720 kiosk).
    const at = (zonePx) => Math.min(Math.max(per * zonePx / 100, min * 16), max * 16);
    expect(at(118)).toBeGreaterThan(at(59));
    expect(at(118), 'the note is no bigger than the one this wave replaced').toBeGreaterThan(1.15 * 16);
  });

  it('keeps an instant swap under prefers-reduced-motion', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(css).toMatch(/transition: none/);
  });

  /**
   * Fix round 1 (review finding, CRITICAL). Grid centring and the line clamp
   * cannot share one element — `-webkit-line-clamp` needs `display:
   * -webkit-box`, `align-content: center` needs `display: grid`, and CSS keeps
   * only the last `display` written. Wave 5 resolved the conflict by deleting
   * the clamp, which centred the reserve but left an overflowing note cut by
   * `overflow: hidden` mid-glyph rather than ellipsized — live sidecar facts do
   * overflow this reserve (the Eroica piece fact alone is 226 characters against
   * this ~180-character two-line box). The fix restores the clamp on a SEPARATE
   * inner element (`__line`), so `__text` keeps doing the centring and `__line`
   * does the truncating.
   */
  it('clamps the line to two, with an ellipsis, on the inner element the outer box centres', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    const rule = css.match(/\.surround-cue-ticker__line \{[^}]*\}/);
    expect(rule, 'no .surround-cue-ticker__line rule — the clamp was not restored').not.toBeNull();
    expect(rule[0]).toContain('display: -webkit-box');
    // ONE line in the base rule (wave 6's tight-band layout); the container
    // query promotes it to two — asserted in its own spec above.
    expect(rule[0]).toContain('-webkit-line-clamp: 1');
    expect(rule[0]).toContain('-webkit-box-orient: vertical');
    expect(rule[0]).toContain('overflow: hidden');

    // The clamp lives on `__line`, not back on `__text` — reviving it there
    // would reintroduce the exact `display` conflict this fix removes.
    const outer = css.match(/\.surround-cue-ticker__text \{[^}]*\}/)[0];
    expect(outer).not.toContain('-webkit-line-clamp');

    // ...and the markup actually nests them: `__line` is what `__text`'s grid
    // centres, not a sibling or a stand-in class that never renders.
    const view = mount('A fact.');
    const outerEl = view.container.querySelector('[data-testid="surround-ticker-text"]');
    const lineEl = outerEl.querySelector('.surround-cue-ticker__line');
    expect(lineEl, 'the outer box has no .surround-cue-ticker__line child').not.toBeNull();
    expect(lineEl.textContent).toBe('A fact.');
  });

  // A fact well past what two lines of this reserve can hold — jsdom cannot
  // measure where Chromium would actually paint the ellipsis, but the honest
  // pin is that the clamp declaration is on the element carrying the overflow
  // text, alongside the reserve that bounds it. That pairing is what makes the
  // cut-off a trailing ellipsis instead of a mid-word chop.
  it('carries the clamp on an overflowing fact, not just a short one', () => {
    withStyles();
    const longFact = 'A. '.repeat(100).trim(); // 300 characters, well past the two-line reserve
    const view = mount(longFact);
    const lineEl = view.container.querySelector('.surround-cue-ticker__line');
    const style = window.getComputedStyle(lineEl);
    expect(style.getPropertyValue('-webkit-line-clamp')).toBe('1');
    expect(style.getPropertyValue('overflow')).toBe('hidden');
    // The reserve above it is unchanged by the overflow — same box, longer text.
    const reserve = window.getComputedStyle(
      view.container.querySelector('[data-testid="surround-ticker-text"]'),
    ).getPropertyValue('max-height');
    expect(reserve).toBe('21.6px');
  });
});

/**
 * DESIGN WAVE 6 — THE BAND SPLITS.
 *
 * Everything above this block uses a payload with NO movements, and that is not
 * laziness: a piece without movements has no "now" to give a register to, so it
 * keeps the single, full-width band this module shipped with — cues and all —
 * and those specs are the regression suite for exactly that path. What follows
 * is the split one.
 */
const SPLIT = {
  contentId: 'plex:663134',
  piece: { musicEndsAt: 2955 },
  movements: [
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

describe('CueTicker — the split band (design wave 6)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const renderSplit = ({ position = 0, data = SPLIT, logger = makeLogger() } = {}) => {
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

  it('keeps ONE register for a piece with no movements — there is no "now" to split off', () => {
    const view = renderSplit({ data: DATA });
    expect(view.container.querySelector('[data-testid="surround-ticker-zone-piece"]')).not.toBeNull();
    expect(view.container.querySelector('[data-testid="surround-ticker-zone-now"]')).toBeNull();
    expect(view.root().getAttribute('data-split')).toBe('false');
  });

  it('names the sounding movement in the right zone’s header, with its translation', () => {
    const view = renderSplit();
    expect(view.header()).toContain('Allegro con brio');
    expect(view.header()).toContain('Fast, with spirit');
    view.at(1000);
    expect(view.header()).toContain('Marcia funebre. Adagio assai');
    expect(view.header()).toContain('Funeral march');
  });

  it('scopes the right zone to THIS movement’s listen notes', () => {
    const view = renderSplit();
    expect(view.listen()).toBe('Two hammered chords, then the cellos.');
    view.at(1000);
    settle();
    expect(view.listen()).toBe('The march tune is in the violins.');
  });

  it('resets the rotation when the movement changes, so a new pool starts at its first note', () => {
    const view = renderSplit();
    // Advance movement I's pool to its second note.
    tick(LISTEN_PHASE_MS);
    settle();
    expect(view.listen()).toBe('A horn comes in four bars early.');
    // Into movement II and back: the pool is re-entered at note one, not at
    // wherever the previous movement's index happened to be.
    view.at(1000);
    settle();
    view.at(10);
    settle();
    expect(view.listen()).toBe('Two hammered chords, then the cellos.');
  });

  it('borrows the piece pool under the header when a movement has no listen notes', () => {
    const view = renderSplit({ position: 2000 });   // movement III, unauthored
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

  it('gives the NOW register back to the movement when the cue’s dwell closes', () => {
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
    expect(LISTEN_PHASE_MS).toBe(FACT_INTERVAL_MS / 2);

    const view = renderSplit();
    const piece0 = view.piece();
    const listen0 = view.listen();

    // At half a period the NOW register has moved and the piece register has not.
    tick(LISTEN_PHASE_MS);
    settle();
    expect(view.listen()).not.toBe(listen0);
    expect(view.piece()).toBe(piece0);

    // ...and at the full period the piece register moves while the NOW one holds.
    const listen1 = view.listen();
    tick(FACT_INTERVAL_MS - LISTEN_PHASE_MS - (CUE_FADE_MS * 2 + CUE_HOLD_MS));
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

  it('says so when there is no movement sounding at all, rather than holding the last one', () => {
    const view = renderSplit({ position: 3000 });   // past musicEndsAt: applause
    expect(view.header()).not.toContain('Finale');
    expect(view.header()).not.toContain('Scherzo');
    expect(view.listen()).toBe('Beethoven tore the page.');
  });

  it('logs the listening note it shows, with the movement it belongs to', () => {
    const view = renderSplit();
    const shown = () => view.logger.debug.mock.calls.filter((c) => c[0] === 'surround.listen.shown');
    expect(shown()).toHaveLength(1);
    expect(shown()[0][1]).toMatchObject({ kind: 'listen', movement: 0, borrowed: false });
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
    tick(LISTEN_PHASE_MS);
    tick(1);

    // A cue lands while that ordinary dissolve is still in flight. No
    // settle() follows: if this still queued a fresh dissolve, the cue's text
    // would not be showing yet.
    view.at(500);
    expect(view.listen()).toBe('The development begins.');
  });

  /**
   * Fix round 1 (review finding I2), second half. The header above the NOW
   * text is never dissolved — it just re-renders on the movement boundary —
   * so a softened note there used to keep naming the OLD movement for up to a
   * full commit while the header already named the new one. No settle()
   * follows the boundary crossing: the fix's whole point is that no wait is
   * needed for the two to agree.
   */
  it('never lets the header and the note name different movements after a boundary tick', () => {
    const view = renderSplit();
    expect(view.header()).toContain('Allegro con brio');
    expect(view.listen()).toBe('Two hammered chords, then the cellos.');

    view.at(1000);   // into movement II
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

  const mountSplit = (position = 0) => render(
    <CueTicker
      position={position} duration={3223} playing seeking={false}
      data={SPLIT} region={{ module: 'cue-ticker' }} logger={makeLogger()}
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

  it('divides them with a hairline of the frame’s own edge token, not a border', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    const rule = css.match(/--split \.surround-cue-ticker__zone--now::before \{[^}]*\}/);
    expect(rule, 'no dividing hairline between the two registers').not.toBeNull();
    expect(rule[0]).toMatch(/background: var\(--programme-edge,/);
    expect(rule[0]).toMatch(/width: 1px/);
    // It divides two columns of text; it does not box them, so it must not run
    // the zone's full height.
    expect(rule[0]).toMatch(/top: \d+%/);
    expect(rule[0]).toMatch(/bottom: \d+%/);
    // ...and it is NOT a border on the zone itself, which would.
    const zone = css.match(/\.surround-cue-ticker__zone \{[^}]*\}/)[0];
    expect(zone).not.toMatch(/\bborder(-(left|right|top|bottom))?:/);
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
    expect(Number(gloss.match(/font-size: ([\d.]+)rem/)[1]),
      'below the 0.72rem ten-foot floor').toBeGreaterThanOrEqual(0.72);
  });

  it('marks a cue over the register the cue is actually in', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    const rule = css.match(/\.surround-cue-ticker__zone--cue::after \{[^}]*\}/);
    expect(rule, 'the cue accent no longer marks a zone').not.toBeNull();
    expect(rule[0]).toMatch(/background: var\(--brass,/);

    // ...and the mark is on the NOW zone while a cue is up.
    const view = mountSplit(500);
    const now = view.container.querySelector('[data-testid="surround-ticker-zone-now"]');
    expect(now.className).toContain('surround-cue-ticker__zone--cue');
    const piece = view.container.querySelector('[data-testid="surround-ticker-zone-piece"]');
    expect(piece.className).not.toContain('surround-cue-ticker__zone--cue');
  });

  it('keeps the now-header out of the dissolve', () => {
    withStyles();
    const view = mountSplit();
    const header = view.container.querySelector('[data-testid="surround-ticker-now"]');
    // The two text boxes carry the inline opacity transition; the header does
    // not, because it changes on a movement boundary the rule above has already
    // shown the viewer.
    expect(header.style.transition).toBe('');
    expect(view.container.querySelector('[data-testid="surround-ticker-listen"]').style.transition)
      .toBe(`opacity ${CUE_FADE_MS}ms ease`);
  });
});
