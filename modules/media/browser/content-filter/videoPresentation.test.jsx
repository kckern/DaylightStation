import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { subscribeSkipCard, isSkipCardPaused } from './skipCardState.js';

// Exercise the real Media data/effect hooks; only external HTTP and media IO are synthetic.
afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState({}, '', '/'); });

describe('installed Media playback presentation', () => {
  it('retains Player identities and applies the family filter with the same loading-store callbacks', async () => {
    window.history.replaceState({}, '', '/?filter=1&filter-debug=1');
    const fixture = {
      edl: { cues: [{ id: 'skip', effect: 'skip-card', in: 1, out: 5, text: 'Fixture card' }] },
      profile: { categories: {}, treatments: { 'skip-card': { holdSec: 100 } }, theme: { barColor: '#123456' } },
      override: {},
    };
    const fetchFixture = vi.fn(async () => ({ ok: true, json: async () => fixture }));
    vi.stubGlobal('fetch', fetchFixture);
    const raw = await import('../../../../capabilities/playback/browser/public.mjs');
    const installed = await import('../playback.mjs');
    expect(installed.default).toBe(raw.default);
    expect(installed.Player).toBe(raw.Player);
    expect(installed.PlayerOverlayLoading).toBe(raw.PlayerOverlayLoading);
    const contract = await import('../../../../capabilities/playback/browser/presentation.mjs');
    const store = contract.getLoadingPresentation();
    expect(store.subscribeLoadingSuppression).toBe(subscribeSkipCard);
    expect(store.getLoadingSuppression).toBe(isSkipCardPaused);
    const el = document.createElement('video');
    el.pause = vi.fn();
    el.play = vi.fn(() => Promise.resolve());
    const getMediaEl = () => el;
    const { result, unmount } = renderHook(() => contract.useVideoPresentation({
      media: { assetId: 'plex:42' }, isPlex: true, getMediaEl,
    }));
    await waitFor(() => expect(fetchFixture).toHaveBeenCalledWith('/api/v1/content-filter/42?profile=family'));
    await waitFor(() => expect(result.current.overlay).toBeTruthy());
    act(() => { el.currentTime = 2; el.dispatchEvent(new Event('timeupdate')); });
    await waitFor(() => expect(store.getLoadingSuppression()).toBe(true));
    expect(el.pause).toHaveBeenCalledTimes(1);
    expect(el.currentTime).toBeGreaterThan(5);
    expect(result.current.overlay.props.activeCard).toEqual({ text: 'Fixture card' });
    expect(result.current.overlay.props.art.poster).toBe('/api/v1/proxy/plex/library/metadata/42/thumb');
    expect(result.current.debug.props.effectiveCues).toHaveLength(1);
    expect(result.current.debug.props.theme).toBe(fixture.profile.theme);
    expect(() => contract.configurePlaybackPresentation({ ...store, useVideoPresentation: () => ({}) }))
      .toThrow('already configured');
    unmount();
    expect(store.getLoadingSuppression()).toBe(false);
  });
});
