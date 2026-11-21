import React from 'react';
import { act, render } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DaylightAPI } from '../../../../frontend/src/lib/api.mjs';
import * as playbackLogs from '../player/lib/playbackLogger.js';
import { useMediaKeyboardHandler } from "./useMediaKeyboardHandler.js";
import {
  isPlayerKeyboardActive,
  __resetPlayerKeyboardOwnership,
} from "./playerKeyboardOwnership.js";

function Harness({ config }) {
  useMediaKeyboardHandler(config);
  return null;
}

vi.mock('../../../../frontend/src/lib/api.mjs', () => ({ DaylightAPI: vi.fn() }));

describe('useMediaKeyboardHandler — player keyboard ownership', () => {
  beforeEach(() => {
    __resetPlayerKeyboardOwnership();
    DaylightAPI.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it('a fullscreen video claims ownership while mounted and releases on unmount', () => {
    expect(isPlayerKeyboardActive()).toBe(false);
    const { unmount } = render(<Harness config={{ isVideo: true, type: 'video' }} />);
    expect(isPlayerKeyboardActive()).toBe(true);
    unmount();
    expect(isPlayerKeyboardActive()).toBe(false);
  });

  it('an audio-only player does NOT claim ownership (menu stays live beneath it)', () => {
    render(<Harness config={{ isVideo: false, type: 'audio' }} />);
    expect(isPlayerKeyboardActive()).toBe(false);
  });

  it('a video with ignoreKeys does NOT claim ownership', () => {
    render(<Harness config={{ isVideo: true, ignoreKeys: true, type: 'video' }} />);
    expect(isPlayerKeyboardActive()).toBe(false);
  });

  it('advances immediately and handles refused progress and watchlist requests independently', async () => {
    const progress = Promise.withResolvers();
    const harvest = Promise.withResolvers();
    DaylightAPI.mockImplementation(path => path === 'api/v1/play/log' ? progress.promise : harvest.promise);
    const log = vi.spyOn(playbackLogs, 'playbackLog');
    const onEnd = vi.fn();
    render(<Harness config={{
      meta: { title: 'Fixture track', source: 'plex', listId: 'library' },
      type: 'audio',
      assetId: 'plex:42',
      controller: { getCurrentTime: () => 12, getDuration: () => 30 },
      onEnd,
    }} />);

    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })));
    expect(DaylightAPI.mock.calls).toEqual([
      ['api/v1/play/log', { title: 'Fixture track', type: 'plex', assetId: 'plex:42', seconds: 12, percent: 40, listId: 'library' }],
      ['api/v1/harvest/watchlist'],
    ]);
    expect(onEnd).toHaveBeenCalledExactlyOnceWith(1);
    expect(onEnd.mock.invocationCallOrder[0]).toBeGreaterThan(DaylightAPI.mock.invocationCallOrder[1]);

    await act(async () => {
      progress.reject(new Error('Progress unavailable'));
      harvest.reject(new Error('Watchlist unavailable'));
    });
    expect(log).toHaveBeenCalledWith('play.log.failed', expect.objectContaining({ message: 'Progress unavailable' }), { level: 'warn' });
    expect(log).toHaveBeenCalledWith('watchlist.harvest.failed', { message: 'Watchlist unavailable' }, { level: 'warn' });
    expect(DaylightAPI).toHaveBeenCalledTimes(2);
  });
});
