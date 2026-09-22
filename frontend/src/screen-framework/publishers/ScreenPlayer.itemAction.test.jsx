import React from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScreenPlayer } from './ScreenPlayer.jsx';
import {
  __resetPlayerSessionRegistryForTests,
  getPlayerSessionRegistry,
} from './playerSessionRegistry.js';
import { createRegistrySessionSource } from './registrySessionSource.js';
import { createScreenItemActions } from '../actions/screenItemActions.js';
import { DaylightAPI } from '../../lib/api.mjs';

vi.mock('../../lib/api.mjs', async importOriginal => ({
  ...await importOriginal(),
  DaylightAPI: vi.fn(),
}));

describe('ScreenPlayer item-action playback', () => {
  beforeEach(() => {
    __resetPlayerSessionRegistryForTests();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200 });
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('maybe');
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    DaylightAPI.mockImplementation(async path => {
      const request = String(path);
      if (request.includes('/play/log')) return {};
      if (request.includes('/play/')) {
        return {
          id: 'plex:55854',
          assetId: 'plex:55854',
          contentId: 'plex:55854',
          title: 'Arrival',
          format: 'video',
          mediaType: 'video',
          mediaUrl: '/stream/arrival.mp4',
          duration: 6983,
        };
      }
      return {};
    });
  });

  afterEach(() => {
    cleanup();
    __resetPlayerSessionRegistryForTests();
    vi.restoreAllMocks();
  });

  it('starts a cold decoder when metadata becomes ready after the item action was admitted', async () => {
    render(<ScreenPlayer clear={() => {}} />);
    const source = createRegistrySessionSource({
      registry: getPlayerSessionRegistry(),
      ownerId: 'acceptance-media',
      sessionId: 'cold-screen-session',
    });
    await waitFor(() => expect(source.getActionOwner()).not.toBeNull());

    const actions = createScreenItemActions({ source, targetId: 'acceptance-media' });
    let pending;
    act(() => {
      pending = actions.execute({
        kind: 'playNow',
        item: { contentId: 'plex:55854', title: 'Arrival', format: 'video' },
        clearRest: false,
        operationId: 'cold-play',
        tappedAt: Date.now(),
      });
    });
    await waitFor(() => expect(document.querySelector('video')).not.toBeNull());
    await waitFor(() => expect(source.getNativeObservation()).toMatchObject({ operationId: 'cold-play' }));
    const decoder = document.querySelector('video');
    Object.defineProperties(decoder, {
      duration: { configurable: true, value: 6983 },
      readyState: { configurable: true, value: 4 },
      paused: { configurable: true, value: true },
    });
    act(() => decoder.dispatchEvent(new Event('loadedmetadata')));

    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled());
    await expect(pending).resolves.toMatchObject({ ok: true });
  });
});
