import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { flushSync } from 'react-dom';
import { VideoPlayer } from './VideoPlayer.jsx';
import { DaylightAPI } from '../../../lib/api.mjs';
import { _setSharedLedgerForTests } from '../lib/recoveryLedger.js';

vi.mock('../../../lib/api.mjs', async importOriginal => ({ ...await importOriginal(), DaylightAPI: vi.fn().mockResolvedValue({}) }));

const engine = vi.hoisted(() => ({ supported: true, instances: [] }));
vi.mock('hls.js', () => ({ default: class Hls {
  static Events = { ERROR: 'error', LEVEL_LOADED: 'level-loaded', FRAG_LOADED: 'frag-loaded' };
  static isSupported() { return engine.supported; }
  constructor(options) {
    this.options = options;
    this.on = vi.fn(); this.loadSource = vi.fn(); this.attachMedia = vi.fn(); this.destroy = vi.fn();
    this.recoverMediaError = vi.fn();
    engine.instances.push(this);
  }
  emit(event, data) {
    for (const [registered, handler] of this.on.mock.calls) if (registered === event) handler(event, data);
  }
} }));

beforeEach(() => {
  engine.supported = true; engine.instances = [];
  DaylightAPI.mockClear();
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200 });
  vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('maybe');
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
});
afterEach(() => { cleanup(); _setSharedLedgerForTests(null); vi.useRealTimers(); vi.restoreAllMocks(); });

async function mount(mediaType = 'hls_video', url = '/movie.m3u8', id = 'plex:55854', resilienceBridge) {
  // Warm the deliberately lazy dependency before React commits the effect.
  // A cold Vite dynamic import is not guaranteed to settle inside act, and
  // polling for it would deadlock the recovery cases that use fake timers.
  if (mediaType === 'hls_video' && engine.supported) await import('hls.js');
  let result;
  await act(async () => { result = render(<VideoPlayer media={{
    id, assetId: id, title: 'Arrival', mediaType, mediaUrl: url,
  }} resilienceBridge={resilienceBridge} advance={() => {}} clear={() => {}} />); });
  return { ...result, video: result.container.querySelector('video') };
}

describe('HLS renderer timestamp-reconciliation selection', () => {
  it('stops only each outgoing owner\'s observed Plex session, once, ignoring late old callbacks', async () => {
    const sessionA = '84cc0c4c-8160-4e89-a240-26a165440d1e';
    const sessionB = '35f14d6c-82e8-483b-87e1-7d66fc8c843d';
    const foreignSession = 'ad1e313a-5eed-411e-a5d8-300d43c0f39e';
    const observedUrl = id => `${window.location.origin}/api/v1/proxy/plex/video/:/transcode/universal/session/${id}/base/index.m3u8`;
    const { rerender, unmount } = await mount();
    const outgoing = engine.instances[0];
    act(() => {
      outgoing.emit('level-loaded', { networkDetails: { responseURL: observedUrl(sessionA) } });
      outgoing.emit('frag-loaded', { networkDetails: { responseURL: observedUrl(sessionA).replace('index.m3u8', '00000.ts') } });
    });
    expect(fetch).not.toHaveBeenCalled();
    await act(async () => {
      rerender(<VideoPlayer media={{ id: 'plex:697368', mediaType: 'hls_video', mediaUrl: '/next.m3u8' }} advance={() => {}} clear={() => {}} />);
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenLastCalledWith(`/api/v1/proxy/plex/video/:/transcode/universal/stop?session=${sessionA}`, {
      method: 'GET', credentials: 'same-origin', keepalive: true,
    });
    const current = engine.instances.at(-1);
    act(() => {
      outgoing.emit('level-loaded', { networkDetails: { responseURL: observedUrl(foreignSession) } });
      current.emit('frag-loaded', { networkDetails: { url: observedUrl(sessionB).replace('index.m3u8', '00000.ts') } });
    });
    await act(async () => { unmount(); });
    current.emit('frag-loaded', { networkDetails: { url: observedUrl(foreignSession) } });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenLastCalledWith(`/api/v1/proxy/plex/video/:/transcode/universal/stop?session=${sessionB}`, {
      method: 'GET', credentials: 'same-origin', keepalive: true,
    });
    expect(outgoing.destroy).toHaveBeenCalledTimes(1);
    expect(current.destroy).toHaveBeenCalledTimes(1);
  });

  it('never stops a Plex session for a non-Plex HLS owner or a foreign resolved response', async () => {
    const path = '/api/v1/proxy/plex/video/:/transcode/universal/session/84cc0c4c-8160-4e89-a240-26a165440d1e/base/index.m3u8';
    const nonPlex = await mount('hls_video', '/live.m3u8', 'live:channel');
    engine.instances[0].emit('level-loaded', { networkDetails: { responseURL: `${window.location.origin}${path}` } });
    await act(async () => { nonPlex.unmount(); });
    const plex = await mount();
    engine.instances.at(-1).emit('level-loaded', {
      networkDetails: { responseURL: `https://foreign.test${path}` },
      details: { url: `${window.location.origin}${path}` },
    });
    await act(async () => { plex.unmount(); });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not authorize session teardown from requested-only playlist or fragment URLs', async () => {
    const requested = `${window.location.origin}/api/v1/proxy/plex/video/:/transcode/universal/session/84cc0c4c-8160-4e89-a240-26a165440d1e/base/index.m3u8`;
    const { unmount } = await mount();
    engine.instances[0].emit('level-loaded', { details: { url: requested } });
    engine.instances[0].emit('level-loaded', { networkDetails: { responseURL: '' }, details: { url: requested } });
    engine.instances[0].emit('frag-loaded', { frag: { url: requested.replace('index.m3u8', '00000.ts') } });
    await act(async () => { unmount(); });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps a delayed manifest owner intact when startup recovery requests a URL refresh', async () => {
    let access;
    const { video } = await mount('hls_video', '/movie.m3u8', 'plex:55854', {
      onRegisterMediaAccess: value => { access = value; },
    });
    video.src = 'blob:http://localhost/hls-owned-source';
    const loadsBefore = video.load.mock.calls.length;
    await act(async () => { access.hardReset({ seekToSeconds: 5251, refreshUrl: true }); });
    expect(video.getAttribute('src')).toBe('blob:http://localhost/hls-owned-source');
    expect(video.load.mock.calls.length).toBe(loadsBefore);
    expect(video.currentTime).toBe(0);
    expect(engine.instances[0].loadSource).toHaveBeenCalledExactlyOnceWith('/movie.m3u8');
    expect(engine.instances[0].destroy).not.toHaveBeenCalled();
    expect(engine.instances[0].recoverMediaError).not.toHaveBeenCalled();
  });

  it.each(['mediaError', 'networkError'])('recovers a fatal %s through its current HLS owner', async errorType => {
    let access;
    const { video, unmount } = await mount('hls_video', '/movie.m3u8', 'plex:55854', {
      onRegisterMediaAccess: value => { access = value; },
    });
    video.src = 'blob:http://localhost/hls-owned-source';
    const active = engine.instances[0];
    const errorHandler = active.on.mock.calls.find(([event]) => event === 'error')[1];
    act(() => { errorHandler('error', { fatal: true, type: errorType }); });
    const loadsBefore = video.load.mock.calls.length;
    await act(async () => { access.hardReset({ seekToSeconds: 5251, refreshUrl: true }); });
    expect(video.getAttribute('src')).toBe('blob:http://localhost/hls-owned-source');
    expect(video.load.mock.calls.length).toBe(loadsBefore);
    if (errorType === 'mediaError') {
      expect(active.recoverMediaError).toHaveBeenCalledTimes(1);
      expect(active.loadSource).toHaveBeenCalledTimes(1);
    } else {
      expect(active.loadSource).toHaveBeenCalledTimes(2);
      expect(active.loadSource).toHaveBeenLastCalledWith('/movie.m3u8');
    }
    Object.defineProperty(video, 'duration', { configurable: true, value: 8833 });
    act(() => { video.dispatchEvent(new Event('loadedmetadata')); });
    expect(video.currentTime).toBe(5251);
    unmount();
    errorHandler('error', { fatal: true, type: errorType });
    expect(active.destroy).toHaveBeenCalledTimes(1);
  });

  it('discards outgoing fatal state and pending position restoration on a native generation change', async () => {
    let access;
    const resilienceBridge = { onRegisterMediaAccess: value => { access = value; } };
    const { video, rerender, container } = await mount('hls_video', '/movie.m3u8', 'plex:55854', resilienceBridge);
    const oldEngine = engine.instances[0];
    const oldError = oldEngine.on.mock.calls.find(([event]) => event === 'error')[1];
    await act(async () => {
      oldError('error', { fatal: true, type: 'networkError' });
      access.hardReset({ seekToSeconds: 5251, refreshUrl: true });
      rerender(<VideoPlayer media={{ id: 'plex:55854', mediaType: 'hls_video', mediaUrl: '/movie.m3u8', maxVideoBitrate: 4000 }}
        resilienceBridge={resilienceBridge} advance={() => {}} clear={() => {}} />);
    });
    const current = container.querySelector('video');
    const currentEngine = engine.instances.at(-1);
    expect(current).not.toBe(video);
    await act(async () => {
      oldError('error', { fatal: true, type: 'networkError' });
      video.dispatchEvent(new Event('loadedmetadata'));
      access.hardReset({ seekToSeconds: 5251, refreshUrl: true });
    });
    expect(video.currentTime).toBe(0);
    expect(current.currentTime).toBe(0);
    expect(currentEngine.loadSource).toHaveBeenCalledTimes(1);
    expect(oldEngine.destroy).toHaveBeenCalledTimes(1);
  });

  it('reloads native HLS fallback without putting server offsets on the manifest URL', async () => {
    engine.supported = false;
    let access;
    const { video } = await mount('hls_video', '/movie.m3u8', 'plex:55854', {
      onRegisterMediaAccess: value => { access = value; },
    });
    const loadsBefore = video.load.mock.calls.length;
    await act(async () => { access.hardReset({ seekToSeconds: 5251, refreshUrl: true }); });
    expect(video.getAttribute('src')).toBe('/movie.m3u8');
    expect(video.load.mock.calls.length).toBe(loadsBefore + 1);
    expect(engine.instances).toHaveLength(0);
  });

  it('replaces the HLS owner after a same-URL duration-lost soft reinitialization', async () => {
    vi.useFakeTimers();
    const { video, container, unmount } = await mount();
    const previousEngine = engine.instances[0];
    Object.defineProperties(video, {
      paused: { configurable: true, value: false },
      duration: { configurable: true, value: 500 },
      readyState: { configurable: true, value: 4 },
    });
    act(() => {
      video.currentTime = 100;
      video.dispatchEvent(new Event('timeupdate'));
      video.dispatchEvent(new Event('playing'));
      vi.advanceTimersByTime(1900);
    });
    Object.defineProperty(video, 'duration', { configurable: true, value: NaN });
    await act(async () => { vi.advanceTimersByTime(8000); });

    const replacement = container.querySelector('video');
    expect(replacement).not.toBe(video);
    expect(video.isConnected).toBe(false);
    expect(previousEngine.destroy).toHaveBeenCalledTimes(1);
    expect(engine.instances).toHaveLength(2);
    expect(engine.instances[1].loadSource).toHaveBeenCalledWith('/movie.m3u8');
    expect(engine.instances[1].attachMedia).toHaveBeenCalledWith(replacement);
    expect(previousEngine.attachMedia).toHaveBeenCalledTimes(1);
    unmount();
    expect(previousEngine.destroy).toHaveBeenCalledTimes(1);
    expect(engine.instances[1].destroy).toHaveBeenCalledTimes(1);
  });

  it('does not attach a pending import to a stale same-URL keyed element', async () => {
    const media = { id: 'plex:55854', mediaType: 'hls_video', mediaUrl: '/movie.m3u8' };
    let result;
    let previous;
    await act(async () => {
      result = render(<VideoPlayer media={media} advance={() => {}} clear={() => {}} />);
    });
    previous = result.container.querySelector('video');
    const countBefore = engine.instances.length;
    await act(async () => {
      // Commit the keyed replacement/effect, then unmount before its import
      // callback runs. Do not merely batch away an uncommitted render.
      flushSync(() => {
        result.rerender(<VideoPlayer media={{ ...media, maxVideoBitrate: 3000 }} advance={() => {}} clear={() => {}} />);
      });
      expect(result.container.querySelector('video')).not.toBe(previous);
      expect(engine.instances).toHaveLength(countBefore);
      result.unmount();
    });
    expect(engine.instances).toHaveLength(countBefore);
    expect(previous.isConnected).toBe(false);
  });

  it('reattaches after the bitrate component of a same-URL element key changes', async () => {
    const media = { id: 'plex:55854', mediaType: 'hls_video', mediaUrl: '/movie.m3u8' };
    let result;
    await act(async () => { result = render(<VideoPlayer media={media} advance={() => {}} clear={() => {}} />); });
    const previous = result.container.querySelector('video');
    await act(async () => {
      result.rerender(<VideoPlayer media={{ ...media, maxVideoBitrate: 4000 }} advance={() => {}} clear={() => {}} />);
    });
    const replacement = result.container.querySelector('video');
    expect(replacement).not.toBe(previous);
    expect(engine.instances).toHaveLength(2);
    expect(engine.instances[0].destroy).toHaveBeenCalledTimes(1);
    expect(engine.instances[1].attachMedia).toHaveBeenCalledExactlyOnceWith(replacement);
    expect(previous.isConnected).toBe(false);
  });

  it('uses hls.js when supported even if native HLS is advertised', async () => {
    const { video, unmount } = await mount();
    expect(engine.instances).toHaveLength(1);
    expect(engine.instances[0].options).toMatchObject({ startPosition: 0 });
    expect(engine.instances[0].loadSource).toHaveBeenCalledWith('/movie.m3u8');
    expect(engine.instances[0].attachMedia).toHaveBeenCalledWith(video);
    unmount();
    expect(engine.instances[0].destroy).toHaveBeenCalledTimes(1);
  });

  it('retains native HLS fallback when the library cannot use MSE', async () => {
    engine.supported = false;
    const { video } = await mount();
    expect(engine.instances).toHaveLength(0);
    expect(video.getAttribute('src')).toBe('/movie.m3u8');
  });

  it('preserves the engine default start position for non-Plex HLS streams', async () => {
    await mount('hls_video', '/live.m3u8', 'live:channel');
    expect(engine.instances).toHaveLength(1);
    expect(engine.instances[0].options).not.toHaveProperty('startPosition');
  });

  it('does not try unsupported native HLS when neither engine is available', async () => {
    engine.supported = false;
    HTMLMediaElement.prototype.canPlayType.mockReturnValue('');
    const { video } = await mount();
    expect(engine.instances).toHaveLength(0);
    expect(video.getAttribute('src')).toBeNull();
  });

  it('keeps an original MP4 on the native video branch without constructing HLS', async () => {
    const { video } = await mount('video', '/api/v1/proxy/plex/library/parts/1/file.mp4');
    expect(video.getAttribute('src')).toBe('/api/v1/proxy/plex/library/parts/1/file.mp4');
    expect(engine.instances).toHaveLength(0);
  });

  it.each(['hls_video', 'video'])('retains Plex progress identity for %s transport', async mediaType => {
    const { video, unmount } = await mount(mediaType);
    Object.defineProperty(video, 'duration', { configurable: true, value: 500 });
    await act(async () => {
      video.currentTime = 91;
      video.dispatchEvent(new Event('durationchange'));
      video.dispatchEvent(new Event('timeupdate'));
    });
    unmount();
    expect(DaylightAPI).toHaveBeenCalledWith('api/v1/play/log', expect.objectContaining({
      type: 'plex', assetId: 'plex:55854', seconds: 91,
    }));
  });
});
