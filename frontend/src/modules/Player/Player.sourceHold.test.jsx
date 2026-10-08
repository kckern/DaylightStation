/**
 * Owner ruling 2026-10-07: a SCREEN rendered by the screen-framework (living-room,
 * office, Portal screen pages — they pass `holdOnRefusal`) HOLDS a refused video
 * until it is healed. It never advances its queue on a refusal, even after the
 * maximum wait; the way out is Skip (OK / media-next).
 * Fitness, piano, school-lesson Players and Media do NOT opt in and keep their
 * previous behaviour (the cap action: skip / close / ladder).
 */
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const frames = [];
const resilience = vi.hoisted(() => ({ args: [], overlay: { current: {} } }));

vi.mock('./components/SinglePlayer.jsx', () => ({
  SinglePlayer: (props) => { frames.push(props); return <div data-testid="single-player-stub" />; },
}));
vi.mock('../../lib/api.mjs', () => ({ DaylightAPI: vi.fn(() => Promise.reject(new Error('offline in test'))) }));
vi.mock('./hooks/useMediaResilience.js', async (importOriginal) => ({
  ...(await importOriginal()),
  useMediaResilience: (args) => {
    resilience.args.push(args);
    return { overlayProps: resilience.overlay.current, cancelDeadline: () => {}, requestRecovery: () => {} };
  },
}));
vi.mock('./lib/playbackLogger.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, playbackLog: vi.fn() };
});

import Player from './Player.jsx';
import { playbackLog } from './lib/playbackLogger.js';

const latest = () => frames.at(-1);
const lastArgs = () => resilience.args.at(-1);
const logged = (name) => playbackLog.mock.calls.filter(([event]) => event === name);
const QUEUE = [{ contentId: 'plex:1', title: 'One' }, { contentId: 'plex:2', title: 'Two' }, { contentId: 'plex:3', title: 'Three' }];

beforeEach(() => { frames.length = 0; resilience.args.length = 0; resilience.overlay.current = {}; playbackLog.mockClear(); });
afterEach(() => cleanup());

describe('screens hold a refused video', () => {
  it('turns the hold on only for an opted-in screen; off for Media and for plain owners', async () => {
    render(<Player holdOnRefusal play={QUEUE} clear={() => {}} />);
    await waitFor(() => expect(latest()?.contentId).toBe('plex:1'));
    expect(lastArgs().holdOnRefusal).toBe(true);
    cleanup(); resilience.args.length = 0; frames.length = 0;
    render(<Player holdOnRefusal play={QUEUE} clear={() => {}} onResilienceEvent={() => {}} />);
    await waitFor(() => expect(latest()?.contentId).toBe('plex:1'));
    expect(lastArgs().holdOnRefusal).toBe(false);
    cleanup(); resilience.args.length = 0; frames.length = 0;
    render(<Player play={QUEUE} clear={() => {}} />); // fitness / piano / school: no opt-in
    await waitFor(() => expect(latest()?.contentId).toBe('plex:1'));
    expect(lastArgs().holdOnRefusal).toBe(false);
  });

  it('a non-screen owner keeps its previous cap action: gave-up advances the queue', async () => {
    render(<Player play={QUEUE} clear={() => {}} />);
    await waitFor(() => expect(latest()?.contentId).toBe('plex:1'));
    act(() => { lastArgs().onExhausted({ reason: 'source-unavailable-gave-up', waitKey: 'plex:1:0' }); });
    await waitFor(() => expect(latest()?.contentId).toBe('plex:2'));
    expect(logged('resilience-exhausted-hold')).toHaveLength(0);
  });

  it('a non-screen owner on a LAST item clears (the previous close)', async () => {
    const clear = vi.fn();
    render(<Player play={[QUEUE[0]]} clear={clear} />);
    await waitFor(() => expect(latest()?.contentId).toBe('plex:1'));
    act(() => { lastArgs().onExhausted({ reason: 'source-unavailable-gave-up', waitKey: 'plex:1:0' }); });
    await waitFor(() => expect(clear).toHaveBeenCalled());
  });

  it('a non-screen owner never gets Skip keys, even with a wait showing', async () => {
    resilience.overlay.current = { sourceNotice: 'Fixing this video… · 0:12' };
    render(<Player play={QUEUE} clear={() => {}} />);
    await waitFor(() => expect(latest()?.contentId).toBe('plex:1'));
    const later = vi.fn();
    window.addEventListener('keydown', later, true);
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); });
    window.removeEventListener('keydown', later, true);
    expect(later).toHaveBeenCalledTimes(1);
    expect(logged('source-wait-skip')).toHaveLength(0);
  });

  it('a held screen publishes a waiting problem record for whoever steers it', async () => {
    render(<Player holdOnRefusal play={QUEUE} clear={() => {}} />);
    await waitFor(() => expect(latest()?.contentId).toBe('plex:1'));
    act(() => { lastArgs().onExhausted({ reason: 'source-unavailable-gave-up', waitKey: 'plex:1:0' }); });
    expect(logged('resilience-exhausted-hold')).toHaveLength(1);
  });

  it('after the maximum wait a screen does NOT advance its queue (it holds)', async () => {
    const clear = vi.fn();
    render(<Player holdOnRefusal play={QUEUE} clear={clear} />);
    await waitFor(() => expect(latest()?.contentId).toBe('plex:1'));
    act(() => { lastArgs().onExhausted({ reason: 'source-unavailable-gave-up', waitKey: 'plex:1:0' }); });
    await new Promise((r) => setTimeout(r, 30));
    expect(latest().contentId).toBe('plex:1');
    expect(clear).not.toHaveBeenCalled();
    expect(logged('resilience-exhausted-auto-skip')).toHaveLength(0);
    expect(logged('resilience-exhausted-hold')).toHaveLength(1);
  });

  it('Media (listens) keeps its policy: gave-up advances the queue / clears the last item', async () => {
    const onResilienceEvent = vi.fn();
    const clear = vi.fn();
    render(<Player holdOnRefusal play={QUEUE} clear={clear} onResilienceEvent={onResilienceEvent} />);
    await waitFor(() => expect(latest()?.contentId).toBe('plex:1'));
    act(() => { lastArgs().onExhausted({ reason: 'source-unavailable-gave-up', waitKey: 'plex:1:0' }); });
    await waitFor(() => expect(latest()?.contentId).toBe('plex:2'));
    expect(logged('resilience-exhausted-auto-skip')).toHaveLength(1);
  });

  it('a non-refusal exhaustion (stall ladder, backend said readable) still skips on a screen', async () => {
    render(<Player holdOnRefusal play={QUEUE} clear={() => {}} />);
    await waitFor(() => expect(latest()?.contentId).toBe('plex:1'));
    act(() => { lastArgs().onExhausted({ reason: 'stall-jolt-exhausted', attempts: 3, waitKey: 'plex:1:0' }); });
    await waitFor(() => expect(latest()?.contentId).toBe('plex:2'));
  });
});

describe('Skip while the screen is fixing a video', () => {
  const press = (key) => act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); });

  it('OK (Enter) skips to the next item, exactly once', async () => {
    resilience.overlay.current = { sourceNotice: 'Fixing this video… · 0:12' };
    render(<Player holdOnRefusal play={QUEUE} clear={() => {}} />);
    await waitFor(() => expect(latest()?.contentId).toBe('plex:1'));
    press('Enter');
    await waitFor(() => expect(latest()?.contentId).toBe('plex:2'));
    expect(logged('source-wait-skip')).toHaveLength(1);
  });

  it('media-next skips too; D-pad and Tab do not', async () => {
    resilience.overlay.current = { sourceNotice: 'Fixing this video… · 0:12' };
    render(<Player holdOnRefusal play={QUEUE} clear={() => {}} />);
    await waitFor(() => expect(latest()?.contentId).toBe('plex:1'));
    press('Tab'); press('ArrowRight'); press('ArrowDown');
    await new Promise((r) => setTimeout(r, 30));
    expect(latest().contentId).toBe('plex:1');
    press('MediaTrackNext');
    await waitFor(() => expect(latest()?.contentId).toBe('plex:2'));
  });

  it('nothing is intercepted when no wait is showing (OK still means play/pause)', async () => {
    resilience.overlay.current = {};
    render(<Player holdOnRefusal play={QUEUE} clear={() => {}} />);
    await waitFor(() => expect(latest()?.contentId).toBe('plex:1'));
    press('Enter');
    await new Promise((r) => setTimeout(r, 30));
    expect(latest().contentId).toBe('plex:1');
    expect(logged('source-wait-skip')).toHaveLength(0);
  });

  it('overlay suppressed (not visible) -> keys are not swallowed and nothing skips', async () => {
    resilience.overlay.current = { sourceNotice: 'Fixing this video… · 0:12', isVisible: false };
    render(<Player holdOnRefusal play={QUEUE} clear={() => {}} />);
    await waitFor(() => expect(latest()?.contentId).toBe('plex:1'));
    press('Enter');
    await new Promise((r) => setTimeout(r, 30));
    expect(latest().contentId).toBe('plex:1');
    expect(logged('source-wait-skip')).toHaveLength(0);
  });

  it('Media never gets the screen Skip keys (it has its own Skip now)', async () => {
    resilience.overlay.current = { sourceNotice: 'Fixing this video… · 0:12' };
    render(<Player holdOnRefusal play={QUEUE} clear={() => {}} onResilienceEvent={() => {}} />);
    await waitFor(() => expect(latest()?.contentId).toBe('plex:1'));
    press('Enter');
    await new Promise((r) => setTimeout(r, 30));
    expect(logged('source-wait-skip')).toHaveLength(0);
  });

  it('after the cap, while HELD on Tap to Retry, OK still skips', async () => {
    resilience.overlay.current = { isExhausted: true };
    render(<Player holdOnRefusal play={QUEUE} clear={() => {}} />);
    await waitFor(() => expect(latest()?.contentId).toBe('plex:1'));
    press('Enter'); // exhausted, but not yet HELD by a refusal: OK keeps its normal meaning
    await new Promise((r) => setTimeout(r, 30));
    expect(latest().contentId).toBe('plex:1');
    act(() => { lastArgs().onExhausted({ reason: 'source-unavailable-gave-up', waitKey: 'plex:1:0' }); });
    press('Enter');
    await waitFor(() => expect(latest()?.contentId).toBe('plex:2'));
  });
});
