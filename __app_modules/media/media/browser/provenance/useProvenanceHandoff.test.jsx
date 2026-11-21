import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useProvenanceHandoff, HANDOFF_TIMING, pickLinkMs } from './useProvenanceHandoff.js';
import { isProvenanceHolding } from './provenanceHold.js';

vi.mock('../../../../../frontend/src/lib/logging/singleton.js', () => ({
  getChildLogger: () => ({ info: () => {}, debug: () => {}, warn: () => {} }),
}));

/** A video element that is still loading (paused, no frame). */
function fakeVideo({ currentTime = 0 } = {}) {
  const el = new EventTarget();
  el.currentTime = currentTime;
  el.paused = true;
  el.readyState = 0;
  el.pause = vi.fn(() => { el.paused = true; });
  el.play = vi.fn(() => { el.paused = false; return Promise.resolve(); });
  el.fire = (type) => el.dispatchEvent(new Event(type));
  /** The player starts playback: first frame. */
  el.start = () => { el.paused = false; el.readyState = 4; el.fire('playing'); };
  return el;
}

const HOLD = 7500; // random 0.5 -> midpoint of 5-10 s
const PROV = { provider: 'hoopla', tier: 'free', logoUrl: '/logo?variant=white' };
const T = HANDOFF_TIMING;

function setup(props = {}) {
  const el = props.el || fakeVideo();
  const hook = renderHook((p) => useProvenanceHandoff({
    getMediaEl: () => el, contentId: 'plex:1', eligible: true, random: () => 0.5, ...p,
  }), { initialProps: props });
  return { el, ...hook };
}

describe('pickLinkMs', () => {
  it('spans 5 to 10 seconds', () => {
    expect(pickLinkMs(T, () => 0)).toBe(5000);
    expect(pickLinkMs(T, () => 0.999999)).toBe(10000);
    expect(pickLinkMs(T, () => 0.5)).toBe(7500);
  });
});

describe('useProvenanceHandoff (scene as the loading screen)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('raises the scene as soon as the provider is known, before any frame, hiding the spinner', () => {
    const { result } = setup({ status: 'ready', provenance: PROV });
    expect(result.current.phase).toBe('linking');
    expect(result.current.linkMs).toBe(HOLD);
    expect(isProvenanceHolding()).toBe(true);
  });

  it('waits for the provider while the spinner shows', () => {
    const { result, rerender } = setup({ status: 'loading', provenance: null });
    expect(result.current.phase).toBe('pending');
    expect(isProvenanceHolding()).toBe(false);
    rerender({ status: 'ready', provenance: PROV });
    expect(result.current.phase).toBe('linking');
  });

  it('video ready early: held on the first frame until the hold ends, then links on playing', () => {
    const { el, result } = setup({ status: 'ready', provenance: PROV });
    act(() => { vi.advanceTimersByTime(1000); el.start(); });
    expect(el.pause).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe('linking');

    act(() => { vi.advanceTimersByTime(HOLD - 1000 - 1); });
    expect(el.play).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(el.play).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe('linking');

    act(() => { el.fire('playing'); });
    expect(result.current.phase).toBe('linked');
    expect(isProvenanceHolding()).toBe(false);
    act(() => { vi.advanceTimersByTime(T.linkedMs); });
    expect(result.current).toMatchObject({ phase: 'docked', afterHandoff: true });
    act(() => { vi.advanceTimersByTime(T.dockMs + T.leaveMs); });
    expect(result.current.phase).toBe('done');
  });

  it('video slow: the scene outlasts the hold and links the moment the film starts', () => {
    const { el, result } = setup({ status: 'ready', provenance: PROV });
    act(() => { vi.advanceTimersByTime(HOLD + 4000); });
    expect(result.current.phase).toBe('linking');
    expect(isProvenanceHolding()).toBe(true);
    act(() => { el.start(); });
    expect(el.pause).not.toHaveBeenCalled();
    expect(result.current.phase).toBe('linked');
  });

  it('links on a timeout when a held video never reports playing after resume', () => {
    const { el, result } = setup({ status: 'ready', provenance: PROV });
    act(() => { el.start(); });
    act(() => { vi.advanceTimersByTime(HOLD + T.playTimeoutMs); });
    expect(result.current.phase).toBe('linked');
  });

  it('steps aside when the video never comes up, so recovery UI can show', () => {
    const { result } = setup({ status: 'ready', provenance: PROV });
    act(() => { vi.advanceTimersByTime(HOLD + T.revealCapMs); });
    expect(result.current).toMatchObject({ phase: 'skipped', afterHandoff: true });
    expect(isProvenanceHolding()).toBe(false);
  });

  it('skips a requested resume without raising the scene', () => {
    const { result } = setup({ status: 'ready', provenance: PROV, startSec: 600 });
    expect(result.current.phase).toBe('skipped');
    expect(isProvenanceHolding()).toBe(false);
  });

  it('stands down if the first frame turns out to be a resume', () => {
    const { el, result } = setup({ status: 'ready', provenance: PROV });
    act(() => { el.currentTime = 900; el.start(); });
    expect(result.current.phase).toBe('skipped');
    expect(el.pause).not.toHaveBeenCalled();
  });

  it('plays plain when the answer arrives after the film is rolling', () => {
    const el = fakeVideo();
    const { result, rerender } = setup({ el, status: 'loading', provenance: null });
    act(() => { el.start(); el.currentTime = 3; });
    rerender({ el, status: 'ready', provenance: PROV });
    expect(result.current.phase).toBe('skipped');
  });

  it('skips at once when nothing is confirmed or the title is not eligible', () => {
    expect(setup({ status: 'none', provenance: null }).result.current.phase).toBe('skipped');
    expect(setup({ status: 'idle', provenance: null, eligible: false }).result.current.phase).toBe('skipped');
  });

  it('releases the hold and a held video when unmounted mid-scene', () => {
    const { el, unmount } = setup({ status: 'ready', provenance: PROV });
    act(() => { el.start(); });
    expect(isProvenanceHolding()).toBe(true);
    unmount();
    expect(isProvenanceHolding()).toBe(false);
    expect(el.play).toHaveBeenCalled();
  });
});
