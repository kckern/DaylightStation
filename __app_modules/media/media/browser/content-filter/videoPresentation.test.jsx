import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { act, render, renderHook, waitFor } from '@testing-library/react';
import { subscribeSkipCard, isSkipCardPaused } from './skipCardState.js';

// Exercise the real Media data/effect hooks; only external HTTP and media IO are synthetic.
afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState({}, '', '/'); });

describe('installed Media playback presentation', () => {
  it('retains Player identities and applies the family filter with the same loading-store callbacks', async () => {
    window.history.replaceState({}, '', '/?filter=1');
    const fixture = {
      edl: { cues: [{ id: 'skip', effect: 'skip-card', in: 1, out: 5, text: 'Fixture card' }] },
      profile: { categories: {}, treatments: { 'skip-card': { holdSec: 100 } }, theme: { barColor: '#123456' } },
      override: {},
    };
    const fetchFixture = vi.fn(async () => ({ ok: true, json: async () => fixture }));
    vi.stubGlobal('fetch', fetchFixture);
    const raw = await import('../../../../../__capabilities/playback/browser/public.mjs');
    const installed = await import('../playback.mjs');
    expect(installed.default).toBe(raw.default);
    expect(installed.Player).toBe(raw.Player);
    expect(installed.PlayerOverlayLoading).toBe(raw.PlayerOverlayLoading);
    const contract = await import('../../../../../__capabilities/playback/browser/presentation.mjs');
    const store = contract.getLoadingPresentation();
    expect(store.subscribeLoadingSuppression).toBe(subscribeSkipCard);
    expect(store.getLoadingSuppression).toBe(isSkipCardPaused);
    const overlay = render(<installed.PlayerOverlayLoading shouldRender isVisible stalled seconds={100} status="recovering" />);
    expect(overlay.container.querySelector('.loading-overlay')).toBeInTheDocument();
    const el = document.createElement('video');
    el.pause = vi.fn();
    el.play = vi.fn(() => Promise.resolve());
    const getMediaEl = () => el;
    const { result, unmount } = renderHook(() => contract.useVideoPresentation({
      media: { assetId: 'plex:42' }, isPlex: true, getMediaEl,
    }));
    await waitFor(() => expect(fetchFixture).toHaveBeenCalledWith(`${location.origin}/api/v1/content-filter/42?profile=family`, expect.objectContaining({ method: 'GET' })));
    await waitFor(() => expect(result.current.overlay).toBeTruthy());
    act(() => { el.currentTime = 2; el.dispatchEvent(new Event('timeupdate')); });
    await waitFor(() => expect(store.getLoadingSuppression()).toBe(true));
    expect(overlay.container.querySelector('.loading-overlay')).toBeNull();
    expect(el.pause).toHaveBeenCalledTimes(1);
    expect(el.currentTime).toBeGreaterThan(5);
    expect(result.current.overlay.props.activeCard).toEqual({ text: 'Fixture card' });
    expect(result.current.overlay.props.art.poster).toBe('/api/v1/proxy/plex/library/metadata/42/thumb');
    expect(() => contract.configurePlaybackPresentation({ ...store, useVideoPresentation: () => ({}) }))
      .toThrow('already configured');
    unmount();
    expect(store.getLoadingSuppression()).toBe(false);
    expect(overlay.container.querySelector('.loading-overlay')).toBeInTheDocument();
  });

  it('passes a badge (provisional when a mute is approximate) and a bumper summary to the overlay', async () => {
    window.history.replaceState({}, '', '/?filter=1');
    const fixture = {
      edl: { cues: [{ id: 'm', effect: 'mute', in: 30, out: 31, precision: 'second-approx', category: 'language/x' }] },
      profile: { categories: {}, theme: {} },
      override: {},
    };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => fixture })));
    const contract = await import('../../../../../__capabilities/playback/browser/presentation.mjs');
    const el = document.createElement('video');
    const { result } = renderHook(() => contract.useVideoPresentation({ media: { assetId: 'plex:42' }, isPlex: true, getMediaEl: () => el }));
    await waitFor(() => expect(result.current.overlay?.props.badge).toBeTruthy());
    expect(result.current.overlay.props.badge).toEqual({ state: 'provisional', active: false });
    expect(result.current.overlay.props.bumper).toBeNull();
    act(() => { el.currentTime = 0; el.dispatchEvent(new Event('playing')); });
    await waitFor(() => expect(result.current.overlay.props.bumper).toEqual({ summary: '1 word muted' }));
  });

  it('shows a failed badge, and no bumper, when filter data cannot be loaded', async () => {
    window.history.replaceState({}, '', '/?filter=1');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 })));
    const contract = await import('../../../../../__capabilities/playback/browser/presentation.mjs');
    const el = document.createElement('video');
    const { result } = renderHook(() => contract.useVideoPresentation({ media: { assetId: 'plex:43' }, isPlex: true, getMediaEl: () => el }));
    await waitFor(() => expect(result.current.overlay?.props.badge).toEqual({ state: 'failed', active: false }), { timeout: 5000 });
    act(() => { el.currentTime = 0; el.dispatchEvent(new Event('playing')); });
    expect(result.current.overlay.props.bumper).toBeNull();
  });

  async function renderFor(search, fetchImpl, id = 'plex:50') {
    window.history.replaceState({}, '', `/${search}`);
    vi.stubGlobal('fetch', vi.fn(fetchImpl));
    const contract = await import('../../../../../__capabilities/playback/browser/presentation.mjs');
    const el = document.createElement('video');
    return renderHook(() => contract.useVideoPresentation({ media: { assetId: id }, isPlex: true, getMediaEl: () => el }));
  }
  // Let the fetch promise chain and resulting state updates flush.
  const settle = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); });
  const payload = (ready) => ({
    edl: { cues: [{ id: 'm', effect: 'mute', in: 30, out: 31, category: 'language/x' }] },
    profile: { categories: {}, theme: {} },
    override: {},
    certification: { level: ready ? 'machine' : 'provisional', requires: 'machine', ready },
  });

  it('filters a certified title with no URL flag, showing a badge', async () => {
    const { result } = await renderFor('', async () => ({ ok: true, status: 200, json: async () => payload(true) }));
    await waitFor(() => expect(result.current.overlay?.props.badge).toBeTruthy());
    expect(result.current.debug).toBeUndefined();
  });

  it('renders no overlay for an uncertified title without a flag', async () => {
    const f = vi.fn(async () => ({ ok: true, status: 200, json: async () => payload(false) }));
    const { result } = await renderFor('', f, 'plex:51');
    await waitFor(() => expect(f).toHaveBeenCalled());
    await settle();
    expect(f).toHaveBeenCalledTimes(1);
    expect(result.current.overlay).toBeFalsy();
  });

  it('renders nothing on a 404', async () => {
    const f = vi.fn(async () => ({ ok: false, status: 404 }));
    const { result } = await renderFor('', f, 'plex:52');
    await waitFor(() => expect(f).toHaveBeenCalled());
    await settle();
    expect(f).toHaveBeenCalledTimes(1);
    expect(result.current.overlay).toBeFalsy();
  });

  it('shows the failed badge on a load failure with no URL flag', async () => {
    const f = vi.fn(async () => ({ ok: false, status: 503 }));
    const { result } = await renderFor('', f, 'plex:54');
    await waitFor(() => expect(result.current.overlay?.props.badge).toEqual({ state: 'failed', active: false }), { timeout: 5000 });
    expect(f).toHaveBeenCalledTimes(2);
    const { render } = await import('@testing-library/react');
    const { container } = render(result.current.overlay);
    expect(container.querySelector('[data-filter-badge="failed"]')).toBeTruthy();
  });

  it('?filter=0 does not even fetch', async () => {
    const f = vi.fn(async () => ({ ok: true, status: 200, json: async () => payload(true) }));
    const { result } = await renderFor('?filter=0', f, 'plex:53');
    await settle();
    expect(f).not.toHaveBeenCalled();
    expect(result.current.overlay).toBeFalsy();
  });
});

describe('partFromSrc', () => {
  it('reads the part id from a direct-play URL and returns null otherwise', async () => {
    const { partFromSrc } = await import('./videoPresentation.jsx');
    expect(partFromSrc('/api/v1/proxy/plex/library/parts/123/456/file.mp4?x=1')).toBe('123');
    expect(partFromSrc('/api/v1/proxy/plex/video/:/transcode/universal/start.mpd?x')).toBeNull();
    expect(partFromSrc(undefined)).toBeNull();
  });
});

it('keeps the preview cues and artwork scoped to the playing title during a switch', async () => {
  const { useMediaVideoPresentation } = await import('./videoPresentation.jsx');
  const { previewStore } = await import('./preview/previewStore.js');
  window.history.replaceState({}, '', '/?filter=1');
  vi.stubGlobal('fetch', vi.fn(async url => {
    const id = new URL(url).pathname.split('/')[4];
    if (url.endsWith('/art')) {
      return Response.json({ source: 'plex', poster: '/fixture/' + id, logo: null });
    }
    return Response.json({ edl: { cues: [{ id, effect: 'mute', in: 30, out: 31, category: 'language/x' }] },
      profile: { categories: {} }, override: {} });
  }));
  const log = [];
  const unsubscribe = previewStore.subscribe(() => log.push(previewStore.getSnapshot()));
  try {
    const el = document.createElement('video');
    const getMediaEl = () => el;
    const frames = [];
    const { result, rerender } = renderHook(({ id }) => {
      const presentation = useMediaVideoPresentation({ media: { assetId: 'plex:' + id }, isPlex: true, getMediaEl });
      frames.push([id, presentation.overlay?.props?.art?.poster]);
      return presentation;
    }, { initialProps: { id: '60' } });
    await waitFor(() => expect(result.current.overlay?.props?.art).toMatchObject({ poster: '/fixture/60', logo: null }));
    rerender({ id: '61' });
    await waitFor(() => expect(result.current.overlay?.props?.art?.poster).toBe('/fixture/61'));
    expect(frames.filter(([id]) => id === '61').some(([, poster]) => poster?.includes('60'))).toBe(false);
    const next = log.filter(s => s.ratingKey === '61');
    expect(next.some(s => s.cues.some(c => c.id === '61'))).toBe(true);
    expect(next.every(s => s.cues.every(c => c.id !== '60'))).toBe(true);
  } finally {
    unsubscribe();
  }
});
