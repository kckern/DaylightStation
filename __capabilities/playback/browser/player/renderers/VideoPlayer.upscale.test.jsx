import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCrtRenderer } from '../lib/crtRenderer.js';
import { VideoPlayer } from './VideoPlayer.jsx';

vi.mock('../lib/crtShaderSource.js', () => ({ loadCrtGeomSource: vi.fn().mockResolvedValue('shader') }));
vi.mock('../lib/crtRenderer.js', () => ({
  createCrtRenderer: vi.fn(),
  CRT_GEOM_PRESET: {},
  DEFAULT_PRE_FILTER: {},
}));

const observers = [];
const noop = () => {};
const videoFor = (mediaUrl, mediaType = 'video') => (
  <VideoPlayer media={{ title: 'Test video', mediaUrl, mediaType, queueLength: 1 }} advance={noop} clear={noop} />
);

function publishMetadata(video, width = 320, height = 240) {
  Object.defineProperties(video, {
    videoWidth: { configurable: true, value: width },
    videoHeight: { configurable: true, value: height },
  });
  act(() => video.dispatchEvent(new Event('loadedmetadata')));
}

async function stabilize() {
  await act(async () => { vi.advanceTimersByTime(1500); });
}

beforeEach(() => {
  vi.useFakeTimers();
  observers.length = 0;
  vi.stubGlobal('ResizeObserver', class {
    observe = vi.fn();
    disconnect = vi.fn();

    constructor(callback) {
      this.callback = callback;
      observers.push(this);
    }
  });
  vi.spyOn(HTMLVideoElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 1920, height: 1080 });
  createCrtRenderer.mockReset().mockImplementation(() => ({
    supported: true,
    start: vi.fn(),
    destroy: vi.fn(),
  }));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('VideoPlayer upscale effects', () => {
  it('retires the old measurement and shader when the decoder is rekeyed', async () => {
    const { container, rerender, unmount } = render(videoFor('/first.mp4'));
    const first = container.querySelector('video');
    const firstObserver = observers.find(observer => observer.observe.mock.calls.some(([node]) => node === first));
    expect(firstObserver).toBeDefined();
    publishMetadata(first);
    await stabilize();
    expect(createCrtRenderer).toHaveBeenCalledWith(expect.objectContaining({ video: first }));
    const firstShader = createCrtRenderer.mock.results[0].value;

    rerender(videoFor('/second.mp4'));
    const second = container.querySelector('video');
    expect(second).not.toBe(first);
    expect(firstObserver.disconnect).toHaveBeenCalledOnce();
    expect(firstShader.destroy).toHaveBeenCalledOnce();
    expect(container.querySelector('.upscale-crt-canvas')).toBeNull();
    const secondObserver = observers.find(observer => observer.observe.mock.calls.some(([node]) => node === second));
    expect(secondObserver).toBeDefined();

    publishMetadata(first);
    act(() => firstObserver.callback());
    await stabilize();
    expect(createCrtRenderer).toHaveBeenCalledTimes(1);
    publishMetadata(second);
    await stabilize();
    expect(createCrtRenderer).toHaveBeenLastCalledWith(expect.objectContaining({ video: second }));
    unmount();
    expect(secondObserver.disconnect).toHaveBeenCalledOnce();
    expect(createCrtRenderer.mock.results[1].value.destroy).toHaveBeenCalledOnce();
  });

  it('starts stabilization over on a native-to-DASH switch with the same source key', async () => {
    const { container, rerender } = render(videoFor('/same-source'));
    const first = container.querySelector('video');
    publishMetadata(first);
    act(() => { vi.advanceTimersByTime(1000); });

    rerender(videoFor('/same-source', 'dash_video'));
    const dash = container.querySelector('dash-video').shadowRoot.querySelector('video');
    expect(dash).not.toBe(first);
    publishMetadata(dash);
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(createCrtRenderer).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(createCrtRenderer).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ video: dash }));
  });
});
