// frontend/src/modules/Surround/dissolve.test.jsx
//
// ONE CONTROLLER, THREE SURFACES (wave 8, critique finding 3).
//
// `dissolve.js` centralised the NUMBERS in wave 3 and its header claimed the
// ticker, the composer card and the place carousel "cannot drift apart". The
// numbers could not; the CHOREOGRAPHY was written three times, and the three
// copies had already drifted — the carousel read `prefers-reduced-motion` from a
// render-time snapshot while the ticker read it live, and only the ticker had
// the fast paths that skip the fade for an urgent change. This spec pins the
// behaviour of the one controller all three now run.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import {
  useDissolve, DISSOLVE_COMMIT_MS, DISSOLVE_FADE_MS, DISSOLVE_HOLD_MS,
} from './dissolve.js';

/** A surface that renders whatever `useDissolve` says is showing. */
function Surface({ next, opts }) {
  const [shown, hidden] = useDissolve(next, opts);
  return (
    <p data-testid="line" data-hidden={hidden ? 'true' : 'false'}>
      {shown?.text ?? ''}
    </p>
  );
}

const mount = (next, opts) => {
  const view = render(<Surface next={next} opts={opts} />);
  const el = () => view.container.querySelector('[data-testid="line"]');
  return {
    ...view,
    text: () => el().textContent,
    hidden: () => el().getAttribute('data-hidden') === 'true',
    to: (value) => act(() => { view.rerender(<Surface next={value} opts={opts} />); }),
  };
};

const tick = (ms) => act(() => { vi.advanceTimersByTime(ms); });

const line = (key, text, extra = {}) => ({ key, text, ...extra });

describe('useDissolve', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('shows the first content immediately — there is nothing to fade out of', () => {
    const view = mount(line('a', 'One.'), { hasContent: (v) => Boolean(v?.text) });
    expect(view.text()).toBe('One.');
    expect(view.hidden()).toBe(false);
  });

  it('fades out, holds the empty ground, then commits and fades in', () => {
    const opts = { hasContent: (v) => Boolean(v?.text) };
    const view = mount(line('a', 'One.'), opts);
    view.to(line('b', 'Two.'));

    // Out: the old line is still in the DOM, going transparent.
    expect(view.hidden()).toBe(true);
    expect(view.text()).toBe('One.');

    // ...still holding the ground one tick before the commit.
    tick(DISSOLVE_COMMIT_MS - 1);
    expect(view.text()).toBe('One.');

    // The swap commits at the END of the held beat, never during the fade.
    tick(1);
    expect(view.text()).toBe('Two.');
    expect(view.hidden()).toBe(false);
  });

  it('commits the swap at fade + hold, not at fade alone', () => {
    expect(DISSOLVE_COMMIT_MS).toBe(DISSOLVE_FADE_MS + DISSOLVE_HOLD_MS);
  });

  it('re-targets rather than queueing when a second change arrives mid-dissolve', () => {
    const opts = { hasContent: (v) => Boolean(v?.text) };
    const view = mount(line('a', 'One.'), opts);
    view.to(line('b', 'Two.'));
    tick(100);
    view.to(line('c', 'Three.'));
    // The first commit's timer was cleared, so nothing lands early...
    tick(DISSOLVE_COMMIT_MS - 1);
    expect(view.text()).toBe('One.');
    // ...and the content that arrives is the LATEST one, once, not both in turn.
    tick(1);
    expect(view.text()).toBe('Three.');
  });

  it('treats identical keys as no change at all', () => {
    const opts = { hasContent: (v) => Boolean(v?.text) };
    const view = mount(line('a', 'One.'), opts);
    view.to(line('a', 'One.'));
    expect(view.hidden()).toBe(false);
  });

  /**
   * THE LIVE READ, deliberately, and the point at which the three copies had
   * drifted. The carousel snapshotted the preference at render; the ticker read
   * it at the moment of the change. Live is correct: the preference is an
   * accessibility instruction, it can be flipped mid-session, and a frame that
   * keeps dissolving until something happens to re-render it is ignoring an
   * instruction it has already been given.
   *
   * TO GO RED: snapshot `prefersReducedMotion()` outside the effect.
   */
  it('reads prefers-reduced-motion LIVE, not from a render-time snapshot', () => {
    let reduce = false;
    vi.stubGlobal('matchMedia', (q) => ({
      matches: q === '(prefers-reduced-motion: reduce)' && reduce,
      media: q,
      addEventListener() {},
      removeEventListener() {},
    }));
    const opts = { hasContent: (v) => Boolean(v?.text) };
    const view = mount(line('a', 'One.'), opts);

    // Motion allowed: the swap dissolves.
    view.to(line('b', 'Two.'));
    expect(view.hidden()).toBe(true);
    tick(DISSOLVE_COMMIT_MS);
    expect(view.text()).toBe('Two.');

    // The viewer asks for less motion. No remount, no new props but the content.
    reduce = true;
    view.to(line('c', 'Three.'));
    expect(view.text(), 'the swap dissolved after the preference was set').toBe('Three.');
    expect(view.hidden()).toBe(false);
  });

  /**
   * The ticker's fast paths, as an option rather than as a fourth copy. The
   * urgent case is a change that must not be softened — the band's header has
   * already moved, so a dissolved note would disagree with it for a full fade.
   */
  it('commits instantly for a change the caller calls urgent', () => {
    const opts = {
      hasContent: (v) => Boolean(v?.text),
      instant: (next, shown) => next.mv !== shown.mv,
    };
    const view = mount(line('a', 'One.', { mv: 0 }), opts);
    view.to(line('b', 'Two.', { mv: 0 }));
    expect(view.hidden(), 'an ordinary rotation should still dissolve').toBe(true);
    tick(DISSOLVE_COMMIT_MS);

    view.to(line('c', 'Three.', { mv: 1 }));
    expect(view.text()).toBe('Three.');
    expect(view.hidden()).toBe(false);
  });

  /**
   * The carousel's shape: a slide is either a picture or it does not exist, so
   * "is there anything on screen" is the default null test rather than a `text`
   * field — and the default identity is the slide's key, which catches the
   * slide SET changing under it as well as the index.
   */
  it('handles null content with its default predicates', () => {
    const view = mount(null);
    expect(view.text()).toBe('');
    view.to(line('photo', 'Venice'));
    expect(view.text(), 'nothing was on screen, so there was nothing to fade').toBe('Venice');
    view.to(line('map', 'Austria'));
    expect(view.hidden()).toBe(true);
    tick(DISSOLVE_COMMIT_MS);
    expect(view.text()).toBe('Austria');
  });

  it('clears a pending commit on unmount', () => {
    const opts = { hasContent: (v) => Boolean(v?.text) };
    const view = mount(line('a', 'One.'), opts);
    view.to(line('b', 'Two.'));
    view.unmount();
    // A commit firing into a dead component is a React warning at best.
    expect(() => tick(DISSOLVE_COMMIT_MS * 2)).not.toThrow();
  });
});
