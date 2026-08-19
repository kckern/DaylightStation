import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import * as sass from 'sass-embedded';
import CueTicker, {
  CUE_FADE_MS, CUE_HOLD_MS, CUE_SWAP_MS, CUE_DWELL_S, FACT_INTERVAL_MS,
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
  it('caps the panel at those two lines with an explicit ceiling, not just the clamp', () => {
    withStyles();
    const view = mount('A fact.');
    const style = window.getComputedStyle(view.container.querySelector('[data-testid="surround-ticker-text"]'));
    // happy-dom resolves `em` off the default 16px root rather than the
    // element's own cascaded font-size, so 2.7em reads back as 43.2px here —
    // the point of the assertion is that a NUMBER exists at all (a ceiling),
    // not the clamp declaration, which happy-dom would happily report even
    // with no box height behind it.
    expect(style.getPropertyValue('max-height')).toBe('43.2px');
    expect(style.getPropertyValue('overflow')).toBe('hidden');
  });

  it('sets the note centred and balanced', () => {
    withStyles();
    const view = mount('A fact.');
    const style = window.getComputedStyle(view.container.querySelector('[data-testid="surround-ticker-text"]'));
    expect(style.getPropertyValue('text-align')).toBe('center');
    // Progressive enhancement: a browser without it just wraps as before.
    expect(style.getPropertyValue('text-wrap')).toBe('balance');
  });

  it('keeps an instant swap under prefers-reduced-motion', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(css).toMatch(/transition: none/);
  });
});
