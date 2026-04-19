import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RemoteSessionAdapter } from './RemoteSessionAdapter.js';

function makeDeps() {
  const http = vi.fn(async () => ({ ok: true }));
  let snapshot = {
    sessionId: 'remote-s1',
    state: 'playing',
    currentItem: { contentId: 'plex:5', format: 'video' },
    position: 42,
    queue: { items: [], currentIndex: -1, upNextCount: 0 },
    config: { shuffle: false, repeat: 'off', shader: null, volume: 60, playbackRate: 1 },
    meta: { ownerId: 'lr', updatedAt: 't' },
  };
  return {
    deviceId: 'lr',
    httpClient: http,
    getSnapshot: () => snapshot,
    setSnapshot: (s) => { snapshot = s; },
  };
}

describe('RemoteSessionAdapter — snapshot + surface', () => {
  it('getSnapshot delegates to the provided getSnapshot fn', () => {
    const deps = makeDeps();
    const a = new RemoteSessionAdapter(deps);
    expect(a.getSnapshot().sessionId).toBe('remote-s1');
  });

  it('exposes controller surface: transport, queue, config, lifecycle, portability', () => {
    const a = new RemoteSessionAdapter(makeDeps());
    expect(typeof a.transport.play).toBe('function');
    expect(typeof a.transport.pause).toBe('function');
    expect(typeof a.transport.stop).toBe('function');
    expect(typeof a.transport.seekAbs).toBe('function');
    expect(typeof a.transport.seekRel).toBe('function');
    expect(typeof a.transport.skipNext).toBe('function');
    expect(typeof a.transport.skipPrev).toBe('function');
    expect(typeof a.queue.playNow).toBe('function');
    expect(typeof a.queue.add).toBe('function');
    expect(typeof a.queue.clear).toBe('function');
    expect(typeof a.config.setShuffle).toBe('function');
    expect(typeof a.config.setVolume).toBe('function');
  });
});

describe('RemoteSessionAdapter — transport methods POST with commandId', () => {
  let deps;
  beforeEach(() => { deps = makeDeps(); });

  it('pause POSTs to /session/transport with action=pause', async () => {
    const a = new RemoteSessionAdapter(deps);
    a.transport.pause();
    await Promise.resolve();
    expect(deps.httpClient).toHaveBeenCalledWith(
      'api/v1/device/lr/session/transport',
      expect.objectContaining({ action: 'pause', commandId: expect.any(String) }),
      'POST'
    );
  });

  it('seekAbs POSTs action=seekAbs with value=<seconds>', async () => {
    const a = new RemoteSessionAdapter(deps);
    a.transport.seekAbs(12.5);
    await Promise.resolve();
    expect(deps.httpClient).toHaveBeenCalledWith(
      'api/v1/device/lr/session/transport',
      expect.objectContaining({ action: 'seekAbs', value: 12.5, commandId: expect.any(String) }),
      'POST'
    );
  });

  it('config.setVolume PUTs to /session/volume with level', async () => {
    const a = new RemoteSessionAdapter(deps);
    a.config.setVolume(75);
    await Promise.resolve();
    expect(deps.httpClient).toHaveBeenCalledWith(
      'api/v1/device/lr/session/volume',
      expect.objectContaining({ level: 75, commandId: expect.any(String) }),
      'PUT'
    );
  });

  it('queue.playNow POSTs to /session/queue/play-now with contentId', async () => {
    const a = new RemoteSessionAdapter(deps);
    a.queue.playNow({ contentId: 'plex:99' }, { clearRest: true });
    await Promise.resolve();
    expect(deps.httpClient).toHaveBeenCalledWith(
      'api/v1/device/lr/session/queue/play-now',
      expect.objectContaining({ contentId: 'plex:99', clearRest: true, commandId: expect.any(String) }),
      'POST'
    );
  });
});
