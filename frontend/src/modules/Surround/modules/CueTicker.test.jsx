import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import CueTicker, { CUE_FADE_MS, CUE_DWELL_S, FACT_INTERVAL_MS } from './CueTicker.jsx';

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
/** Fade out (280ms) then fade in — the swap commits at the halfway point. */
const settle = () => { tick(CUE_FADE_MS); tick(CUE_FADE_MS); };

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
    tick(CUE_FADE_MS - 1);
    expect(view.text()).toBe('Beethoven tore the page.');
    tick(1);
    expect(view.text()).toBe('The funeral march begins.');
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
