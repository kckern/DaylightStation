import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useProvenanceHandoff, HANDOFF_TIMING, pickLinkMs } from './useProvenanceHandoff.js';
import { isProvenanceHolding } from './provenanceHold.js';

vi.mock('../../../../../frontend/src/lib/logging/singleton.js', () => ({
  getChildLogger: () => ({ info: () => {}, debug: () => {}, warn: () => {} }),
}));

function fakeVideo({ currentTime = 0, paused = true } = {}) {
  const el = new EventTarget();
  el.currentTime = currentTime;
  el.paused = paused;
  el.readyState = paused ? 1 : 4;
  el.pause = vi.fn(() => { el.paused = true; });
  el.play = vi.fn(() => { el.paused = false; return Promise.resolve(); });
  el.fire = (type) => el.dispatchEvent(new Event(type));
  return el;
}

const HOLD = 7500; // random 0.5 -> midpoint of 5-10 s
const PROV = { provider: 'hoopla', tier: 'free', logoUrl: '/logo?variant=white' };

function setup(props) {
  const el = props.el || fakeVideo();
  const hook = renderHook((p) => useProvenanceHandoff({ getMediaEl: () => el, contentId: 'plex:1', eligible: true, random: () => 0.5, ...p }), {
    initialProps: props,
  });
  return { el, ...hook };
}

describe('pickLinkMs', () => {
  it('spans 5 to 10 seconds', () => {
    expect(pickLinkMs(HANDOFF_TIMING, () => 0)).toBe(5000);
    expect(pickLinkMs(HANDOFF_TIMING, () => 0.999999)).toBe(10000);
    expect(pickLinkMs(HANDOFF_TIMING, () => 0.5)).toBe(7500);
  });
});

describe('useProvenanceHandoff', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('holds the first play, links when playback resumes, docks, then finishes', () => {
    const { el, result } = setup({ status: 'ready', provenance: PROV });
    expect(result.current.phase).toBe('pending');
    expect(result.current.afterHandoff).toBe(false);

    act(() => { el.paused = false; el.fire('playing'); });
    expect(el.pause).toHaveBeenCalled();
    expect(result.current.phase).toBe('linking');
    expect(result.current.linkMs).toBe(HOLD);
    expect(isProvenanceHolding()).toBe(true);

    act(() => { vi.advanceTimersByTime(HOLD - 1); });
    expect(el.play).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(1); });
    expect(el.play).toHaveBeenCalled();
    expect(result.current.phase).toBe('linking');

    act(() => { el.fire('playing'); });
    expect(result.current.phase).toBe('linked');
    expect(isProvenanceHolding()).toBe(false);

    act(() => { vi.advanceTimersByTime(HANDOFF_TIMING.linkedMs); });
    expect(result.current).toMatchObject({ phase: 'docked', afterHandoff: true });
    act(() => { vi.advanceTimersByTime(HANDOFF_TIMING.dockMs); });
    expect(result.current.phase).toBe('leaving');
    act(() => { vi.advanceTimersByTime(HANDOFF_TIMING.leaveMs); });
    expect(result.current.phase).toBe('done');
  });

  it('links on a timeout when resume never reports playing', () => {
    const { el, result } = setup({ status: 'ready', provenance: PROV });
    act(() => { el.paused = false; el.fire('playing'); });
    act(() => { vi.advanceTimersByTime(HOLD + HANDOFF_TIMING.playTimeoutMs); });
    expect(result.current.phase).toBe('linked');
  });

  it('skips a resume', () => {
    const { el, result } = setup({ status: 'ready', provenance: PROV, el: fakeVideo({ currentTime: 600 }) });
    act(() => { el.paused = false; el.fire('playing'); });
    expect(result.current).toMatchObject({ phase: 'skipped', afterHandoff: true });
    expect(el.pause).not.toHaveBeenCalled();
  });

  it('skips when the answer is not in by the first play', () => {
    const { el, result } = setup({ status: 'loading', provenance: null });
    act(() => { el.paused = false; el.fire('playing'); });
    expect(result.current.phase).toBe('skipped');
    expect(el.pause).not.toHaveBeenCalled();
  });

  it('skips at once when nothing is confirmed or the title is not eligible', () => {
    expect(setup({ status: 'none', provenance: null }).result.current.phase).toBe('skipped');
    expect(setup({ status: 'idle', provenance: null, eligible: false }).result.current.phase).toBe('skipped');
  });

  it('releases the hold when unmounted mid-scene', () => {
    const { el, unmount } = setup({ status: 'ready', provenance: PROV });
    act(() => { el.paused = false; el.fire('playing'); });
    expect(isProvenanceHolding()).toBe(true);
    unmount();
    expect(isProvenanceHolding()).toBe(false);
  });
});
