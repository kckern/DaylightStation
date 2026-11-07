import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const mockLogger = vi.hoisted(() => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), sampled: vi.fn() }));
vi.mock('../../../../../../frontend/src/lib/logging/singleton.js', () => ({ getChildLogger: () => mockLogger }));

import { useMediaVideoPresentation } from '../videoPresentation.jsx';
import { previewStore } from './previewStore.js';
import { SurroundOverrideContext } from '../../../../../../__capabilities/playback/browser/surround-override.mjs';

const payload = (cues, extra = {}) => ({
  edl: { cues },
  profile: { categories: {}, theme: {} },
  override: {},
  certification: { level: 'machine', requires: 'machine', ready: true },
  ...extra,
});

function makeEl() {
  const el = document.createElement('video');
  el.play = vi.fn(() => Promise.resolve());
  el.pause = vi.fn();
  return el;
}

function render({ fetchImpl, surround, el = makeEl(), media = { assetId: 'plex:60', title: 'Film' } }) {
  window.history.replaceState({}, '', '/');
  const f = vi.fn(fetchImpl);
  vi.stubGlobal('fetch', f);
  const getMediaEl = () => el;
  const wrapper = surround
    ? ({ children }) => <SurroundOverrideContext.Provider value={surround}>{children}</SurroundOverrideContext.Provider>
    : undefined;
  const hook = renderHook(() => useMediaVideoPresentation({ media, isPlex: true, getMediaEl }), { wrapper });
  return { ...hook, el, fetch: f };
}

beforeEach(() => { previewStore.reset(); vi.clearAllMocks(); });
afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState({}, '', '/'); });

describe('content-filter preview wiring (useMediaVideoPresentation)', () => {
  it('clicking the badge opens the surround with the rail and the timeline; logs surround.opened', async () => {
    const surround = { open: vi.fn(), close: vi.fn(), isOpen: false };
    const { result } = render({ surround, fetchImpl: async () => ({ ok: true, status: 200, json: async () => payload([]) }) });
    await waitFor(() => expect(result.current.overlay?.props.badge?.onOpen).toBeTypeOf('function'));
    act(() => result.current.overlay.props.badge.onOpen());
    expect(surround.open).toHaveBeenCalledTimes(1);
    const data = surround.open.mock.calls[0][0];
    expect(data.id).toBe('content-filter');
    expect(data.definition.regions.right.module).toBe('content-filter-rail');
    expect(data.definition.regions.bottom.module).toBe('content-filter-timeline');
    expect(previewStore.getSnapshot().open).toBe(true);
    expect(mockLogger.info).toHaveBeenCalledWith('content-filter.surround.opened', expect.objectContaining({ ratingKey: '60' }));
    act(() => previewStore.close());
    expect(surround.close).toHaveBeenCalledTimes(1);
    expect(previewStore.getSnapshot().open).toBe(false);
    expect(mockLogger.info).toHaveBeenCalledWith('content-filter.surround.closed', expect.objectContaining({ ratingKey: '60' }));
  });

  it('follows the host when it closes the surround itself', async () => {
    const surround = { open: vi.fn(), close: vi.fn(), isOpen: false };
    window.history.replaceState({}, '', '/');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => payload([]) })));
    const el = makeEl();
    const getMediaEl = () => el;
    let value = surround;
    const wrapper = ({ children }) => <SurroundOverrideContext.Provider value={value}>{children}</SurroundOverrideContext.Provider>;
    const { result, rerender } = renderHook(() => useMediaVideoPresentation({ media: { assetId: 'plex:60' }, isPlex: true, getMediaEl }), { wrapper });
    await waitFor(() => expect(result.current.overlay?.props.badge?.onOpen).toBeTypeOf('function'));
    act(() => result.current.overlay.props.badge.onOpen());
    value = { ...surround, isOpen: true };
    rerender();
    expect(previewStore.getSnapshot().open).toBe(true);
    value = { ...surround, isOpen: false };
    rerender();
    expect(previewStore.getSnapshot().open).toBe(false);
    expect(surround.close).not.toHaveBeenCalled();
  });

  it('publishes the title’s filter state to the store', async () => {
    const cues = [{ id: 'm', effect: 'mute', in: 30, out: 31, category: 'language/x', precision: 'ms' }];
    render({ fetchImpl: async () => ({ ok: true, status: 200, json: async () => payload(cues) }) });
    await waitFor(() => expect(previewStore.getSnapshot().cues.length).toBe(1));
    const s = previewStore.getSnapshot();
    expect(s).toMatchObject({ ratingKey: '60', title: 'Film', certification: { level: 'machine' }, open: false });
    expect(s.summary).toBe('1 word muted');
    expect(s.profile).toBeTruthy();
  });

  it('jumpToCue seeks the element 4 s early and plays; lastFired is published', async () => {
    const cues = [{ id: 'm', effect: 'mute', in: 30, out: 31, category: 'language/x', precision: 'ms' }];
    const { el } = render({ fetchImpl: async () => ({ ok: true, status: 200, json: async () => payload(cues) }) });
    await waitFor(() => expect(previewStore.getSnapshot().cues.length).toBe(1));
    act(() => previewStore.jumpToCue({ in: 100 }));
    expect(el.currentTime).toBe(96);
    expect(el.play).toHaveBeenCalled();
    act(() => { el.currentTime = 30.5; el.dispatchEvent(new Event('timeupdate')); });
    await waitFor(() => expect(previewStore.getSnapshot().lastFired?.id).toBe('m'));
  });

  it('peek plays one cue unfiltered from 4 s before it, then filters it again', async () => {
    const cues = [{ id: 'va1', effect: 'mute', in: 30, out: 31, category: 'language/x', precision: 'ms' }];
    const { el } = render({ fetchImpl: async () => ({ ok: true, status: 200, json: async () => payload(cues) }) });
    await waitFor(() => expect(previewStore.getSnapshot().cues.length).toBe(1));
    const resolvedIn = previewStore.getSnapshot().cues[0].in; // widened by the resolver
    act(() => previewStore.peek('va1'));
    expect(el.currentTime).toBeCloseTo(resolvedIn - 4, 5);
    act(() => { el.currentTime = 30.5; el.dispatchEvent(new Event('timeupdate')); });
    expect(el.muted).toBe(false);
    act(() => { el.currentTime = 32; el.dispatchEvent(new Event('timeupdate')); });
    act(() => { el.currentTime = 30.5; el.dispatchEvent(new Event('seeked')); });
    expect(el.muted).toBe(true);
  });

  it('a peek on one title does not bypass the same cue id on the next title', async () => {
    const cues = [{ id: 'va1', effect: 'mute', in: 30, out: 31, category: 'language/x', precision: 'ms' }];
    window.history.replaceState({}, '', '/');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => payload(cues) })));
    const el = makeEl();
    const getMediaEl = () => el;
    const { rerender } = renderHook(({ media }) => useMediaVideoPresentation({ media, isPlex: true, getMediaEl }), {
      initialProps: { media: { assetId: 'plex:60', title: 'A' } },
    });
    await waitFor(() => expect(previewStore.getSnapshot().cues.length).toBe(1));
    act(() => previewStore.peek('va1'));
    rerender({ media: { assetId: 'plex:61', title: 'B' } });
    await waitFor(() => expect(previewStore.getSnapshot().ratingKey).toBe('61'));
    await waitFor(() => expect(previewStore.getSnapshot().cues.length).toBe(1));
    act(() => { el.currentTime = 30.5; el.dispatchEvent(new Event('timeupdate')); });
    expect(el.muted).toBe(true);
  });

  it('a host that is absent or a failed badge leaves the badge unclickable; a disabled host does not open', async () => {
    const none = render({ fetchImpl: async () => ({ ok: true, status: 200, json: async () => payload([]) }) });
    await waitFor(() => expect(none.result.current.overlay?.props.badge).toBeTruthy());
    expect(none.result.current.overlay.props.badge.onOpen).toBeUndefined();
    none.unmount();

    const failed = render({ surround: { open: vi.fn(), close: vi.fn(), isOpen: false, available: true }, fetchImpl: async () => ({ ok: false, status: 503 }) });
    await waitFor(() => expect(failed.result.current.overlay?.props.badge?.state).toBe('failed'), { timeout: 5000 });
    expect(failed.result.current.overlay.props.badge.onOpen).toBeUndefined();
    failed.unmount();

    const refusing = { open: vi.fn(() => false), close: vi.fn(), isOpen: false, available: true };
    const off = render({ surround: refusing, fetchImpl: async () => ({ ok: true, status: 200, json: async () => payload([]) }) });
    await waitFor(() => expect(off.result.current.overlay?.props.badge?.onOpen).toBeTypeOf('function'));
    mockLogger.info.mockClear();
    act(() => off.result.current.overlay.props.badge.onOpen());
    expect(refusing.open).toHaveBeenCalledTimes(1);
    expect(previewStore.getSnapshot().open).toBe(false);
    expect(mockLogger.info).not.toHaveBeenCalledWith('content-filter.surround.opened', expect.anything());
  });

  it('refresh refetches and re-resolves without dropping the filter', async () => {
    let n = 0;
    const first = [{ id: 'a', effect: 'mute', in: 30, out: 31, category: 'language/x', precision: 'ms' }];
    const second = [...first, { id: 'b', effect: 'mute', in: 50, out: 51, category: 'language/x', precision: 'ms' }];
    const { result, fetch } = render({ fetchImpl: async () => { n += 1; return { ok: true, status: 200, json: async () => payload(n === 1 ? first : second) }; } });
    await waitFor(() => expect(previewStore.getSnapshot().cues.length).toBe(1));
    let p;
    act(() => { p = previewStore.refresh(); });
    expect(result.current.overlay).toBeTruthy(); // filter keeps running during the refresh
    await act(async () => { await p; });
    expect(fetch).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(previewStore.getSnapshot().cues.length).toBe(2));
  });

  it('resets the store on unmount', async () => {
    const { unmount } = render({ fetchImpl: async () => ({ ok: true, status: 200, json: async () => payload([]) }) });
    await waitFor(() => expect(previewStore.getSnapshot().ratingKey).toBe('60'));
    unmount();
    expect(previewStore.getSnapshot().ratingKey).toBeNull();
  });
});
