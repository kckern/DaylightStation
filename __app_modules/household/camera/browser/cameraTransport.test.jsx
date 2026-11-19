import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import useSnapshotFetch from './useSnapshotFetch.js';
import useHlsStream from './useHlsStream.js';

const hls = vi.hoisted(() => ({ supported: false, loadSource: vi.fn(), destroy: vi.fn() }));
vi.mock('hls.js', () => ({ default: class {
  static isSupported = () => hls.supported;
  static Events = { MANIFEST_PARSED: 'manifest', ERROR: 'error' };
  loadSource = hls.loadSource;
  destroy = hls.destroy;
  attachMedia() {}
  on() {}
} }));
afterEach(() => vi.unstubAllGlobals());

it('aborts a superseded snapshot and releases only its own blob URL', async () => {
  let finishFirst;
  const fetch = vi.fn()
    .mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; }))
    .mockResolvedValueOnce(Response.json({}));
  vi.stubGlobal('fetch', fetch);
  const makeUrl = vi.fn(() => 'blob:second');
  const revoke = vi.fn();
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = makeUrl;
    static revokeObjectURL = revoke;
  });
  const { result, rerender, unmount } = renderHook(({ id }) => useSnapshotFetch(id), { initialProps: { id: 'first' } });
  rerender({ id: 'second/door' });
  await waitFor(() => expect(result.current.src).toBe('blob:second'));
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
  expect(fetch.mock.calls[1][0]).toContain('/second%2Fdoor/snap?');
  await act(async () => finishFirst(Response.json({})));
  expect(makeUrl).toHaveBeenCalledTimes(1);
  unmount();
  expect(revoke.mock.calls).toEqual([['blob:second']]);
});

it('keeps a shared camera live until both the native card and viewport release it', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response());
  vi.stubGlobal('fetch', fetch);
  function mount() {
    const video = document.createElement('video');
    video.canPlayType = () => 'probably';
    video.load = vi.fn();
    video.play = vi.fn().mockResolvedValue();
    const ref = { current: video };
    return renderHook(() => useHlsStream('front/door', ref));
  }
  const card = mount();
  const viewport = mount();
  viewport.unmount();
  await Promise.resolve();
  expect(fetch).not.toHaveBeenCalled();
  card.unmount();
  await Promise.resolve();
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledWith(location.origin + '/api/v1/camera/front%2Fdoor/live', expect.objectContaining({ method: 'DELETE', headers: expect.objectContaining({ 'X-Daylight-Device': expect.any(String) }) }));
});

it('delegates the playlist to hls.js and releases the encoder when the player is destroyed', async () => {
  hls.supported = true;
  try {
    const fetch = vi.fn().mockResolvedValue(new Response());
    vi.stubGlobal('fetch', fetch);
    const ref = { current: document.createElement('video') };
    const { unmount } = renderHook(() => useHlsStream('garage', ref));
    expect(hls.loadSource).toHaveBeenCalledWith('/api/v1/camera/garage/live/stream.m3u8');
    expect(fetch).not.toHaveBeenCalled();
    unmount();
    await Promise.resolve();
    expect(hls.destroy).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][1].method).toBe('DELETE');
  } finally {
    hls.supported = false;
  }
});
