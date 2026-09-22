import React from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerHostProvider } from './PlayerHostProvider.jsx';
import { LocalSessionContext } from './LocalSessionContext.js';
import { createLocalSessionController } from './LocalSessionController.js';
import { DaylightAPI } from '../../../lib/api.mjs';

vi.mock('../../../lib/api.mjs', async importOriginal => ({
  ...await importOriginal(),
  DaylightAPI: vi.fn(),
}));

const hlsEngine = vi.hoisted(() => ({ instances: [] }));
vi.mock('hls.js', () => ({ default: class Hls {
  static Events = { ERROR: 'error', LEVEL_LOADED: 'level-loaded', FRAG_LOADED: 'frag-loaded' };
  static isSupported() { return true; }
  constructor(options) {
    this.options = options;
    this.on = vi.fn();
    this.loadSource = vi.fn();
    this.attachMedia = vi.fn();
    this.destroy = vi.fn();
    this.recoverMediaError = vi.fn();
    hlsEngine.instances.push(this);
  }
} }));

const { PlayerBridge } = await import('./PlayerBridge.jsx');

function Harness({ controller }) {
  return (
    <LocalSessionContext.Provider value={{ controller }}>
      <PlayerHostProvider>
        <PlayerBridge />
      </PlayerHostProvider>
    </LocalSessionContext.Provider>
  );
}

function mediaItem(contentId, title) {
  return { contentId, title, format: 'hls_video', duration: 8834 };
}

function restoredSnapshot(item, position) {
  const source = createLocalSessionController({
    clientId: 'decoder-restore-source',
    randomUuid: () => 'decoder-restore-source-session',
  });
  source.queue.playNow(item);
  const snapshot = source.portability.capture().snapshot;
  snapshot.position = position;
  snapshot.state = 'paused';
  return snapshot;
}

describe('PlayerBridge decoder restoration', () => {
  beforeEach(async () => {
    hlsEngine.instances = [];
    await import('hls.js');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200 });
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('maybe');
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    DaylightAPI.mockImplementation(async path => {
      const request = String(path);
      if (request.includes('/queue/')) {
        const encoded = request.split('/queue/')[1].split('?')[0];
        const contentId = decodeURIComponent(encoded);
        return { items: [mediaItem(contentId, contentId)], audio: null };
      }
      if (request.includes('/play/log')) return {};
      if (request.includes('/play/')) {
        const encoded = request.split('/play/')[1].split('?')[0];
        const contentId = decodeURIComponent(encoded);
        return {
          ...mediaItem(contentId, contentId),
          id: contentId,
          assetId: contentId,
          mediaType: 'hls_video',
          mediaUrl: `/stream/${encodeURIComponent(contentId)}.m3u8`,
        };
      }
      return {};
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('seeks a fresh paused HLS decoder to the adopted full-timeline position', async () => {
    const arrival = mediaItem('plex:55854', 'Arrival');
    const disclosureDay = mediaItem('plex:697368', 'Disclosure Day');
    const controller = createLocalSessionController({
      clientId: 'decoder-restore-destination',
      randomUuid: () => 'decoder-restore-destination-session',
    });
    controller.queue.playNow(arrival);

    render(<Harness controller={controller} />);
    await waitFor(() => expect(document.querySelector('video')).not.toBeNull());
    const arrivalDecoder = document.querySelector('video');

    act(() => {
      expect(controller.lifecycle.adoptSnapshot(restoredSnapshot(disclosureDay, 1805), { autoplay: false }))
        .toEqual({ ok: true });
    });

    await waitFor(() => {
      const decoder = document.querySelector('video');
      expect(decoder).not.toBeNull();
      expect(decoder).not.toBe(arrivalDecoder);
    });
    const restoredDecoder = document.querySelector('video');
    Object.defineProperties(restoredDecoder, {
      duration: { configurable: true, value: 8834 },
      readyState: { configurable: true, value: 4 },
      paused: { configurable: true, value: true },
      seeking: { configurable: true, value: false },
      ended: { configurable: true, value: false },
      error: { configurable: true, value: null },
    });
    act(() => restoredDecoder.dispatchEvent(new Event('loadedmetadata')));

    await waitFor(() => expect(restoredDecoder.currentTime).toBe(1805));
    act(() => {
      restoredDecoder.dispatchEvent(new Event('seeking'));
      restoredDecoder.dispatchEvent(new Event('seeked'));
    });
    await waitFor(() => expect(controller.getSnapshot()).toMatchObject({
      state: 'paused', currentItem: { contentId: 'plex:697368' }, position: 1805,
    }));
  });
});
