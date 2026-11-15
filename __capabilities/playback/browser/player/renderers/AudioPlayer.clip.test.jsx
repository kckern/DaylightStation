import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioPlayer } from './AudioPlayer.jsx';
import { useCommonMediaController } from '../hooks/useCommonMediaController.js';
import { DaylightAPI } from '../../../../../frontend/src/lib/api.mjs';

vi.mock('../../../../../frontend/src/lib/api.mjs', () => ({ DaylightAPI: vi.fn().mockResolvedValue({}) }));

beforeEach(() => {
  vi.useFakeTimers();
  DaylightAPI.mockClear();
  useCommonMediaController.__appliedStartByKey = Object.create(null);
  useCommonMediaController.__lastPosByKey = Object.create(null);
  useCommonMediaController.__lastSeekByKey = Object.create(null);
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

function mountClip() {
  const advance = vi.fn();
  const progress = vi.fn();
  const view = render(<AudioPlayer media={{ id: 'files:audio-clip', assetId: 'files:audio-clip',
    title: 'Audio clip', mediaUrl: '/clip.mp3', mediaType: 'audio', format: 'audio',
    seconds: 10, duration: 100, segment: { start: 10, end: 20 } }}
    advance={advance} clear={() => {}} onProgress={progress} />);
  const node = view.container.querySelector('audio');
  Object.defineProperties(node, {
    currentTime: { configurable: true, writable: true, value: 10 },
    duration: { configurable: true, value: 100 },
    readyState: { configurable: true, value: 4 },
    paused: { configurable: true, value: false },
    ended: { configurable: true, writable: true, value: false },
  });
  act(() => { node.dispatchEvent(new Event('durationchange')); node.dispatchEvent(new Event('loadedmetadata')); });
  return { ...view, node, advance, progress };
}
const tick = (node, seconds) => act(() => {
  node.currentTime = seconds;
  node.dispatchEvent(new Event('timeupdate'));
});
const playLogs = () => DaylightAPI.mock.calls.filter(([path]) => path === 'api/v1/play/log').map(([, body]) => body);

describe('excluded audio clip through AudioPlayer and common controller', () => {
  it('publishes clip-relative 50 percent, logs native position 15, and completes once at clip end 20', () => {
    const { node, progress, advance } = mountClip();
    tick(node, 15);
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ currentTime: 5, duration: 10,
      contentSeconds: 15, nativeSeconds: 15, percent: '50.0' }));
    expect(playLogs().at(-1)).toMatchObject({ seconds: 15, percent: '15.0' });
    expect(advance).not.toHaveBeenCalled();
    tick(node, 20);
    expect(advance).toHaveBeenCalledTimes(1);
    tick(node, 20);
    act(() => { node.ended = true; node.dispatchEvent(new Event('ended')); });
    expect(advance).toHaveBeenCalledTimes(1);
  });
  it('saves an interrupted audio clip at its native position and full-file percentage', () => {
    const { node, unmount } = mountClip();
    tick(node, 15);
    DaylightAPI.mockClear();
    unmount();
    expect(playLogs()).toEqual([expect.objectContaining({ seconds: 15, percent: '15.0' })]);
  });
});
