import { describe, it, expect, vi } from 'vitest';
import { dispatchResponse, UnknownResponseKindError } from '#apps/trigger/responseHandlers.mjs';
import { Response } from '#domains/trigger/Response.mjs';

const deps = () => ({
  wakeAndLoadService: { execute: vi.fn().mockResolvedValue({ ok: true }) },
  deviceService: { get: vi.fn(() => ({ loadContent: vi.fn().mockResolvedValue('loaded'), clearContent: vi.fn().mockResolvedValue('cleared') })) },
  haGateway: { callService: vi.fn().mockResolvedValue('ha-ok') },
});

describe('dispatchResponse', () => {
  it('content authoritative → wakeAndLoad with query keyed by action', async () => {
    const d = deps();
    const r = Response.content({ target: 'livingroom-tv', expression: { action: 'queue', contentId: 'plex:1', options: { shuffle: 1 } }, end: 'tv-off', endLocation: 'living_room' });
    await dispatchResponse({ ...r, dispatchId: 'd1' }, d);
    expect(d.wakeAndLoadService.execute).toHaveBeenCalledWith(
      'livingroom-tv',
      { shuffle: 1, queue: 'plex:1' },
      { dispatchId: 'd1', endBehavior: 'tv-off', endLocation: 'living_room' },
    );
  });

  it('content play-next adds op:play-next', async () => {
    const d = deps();
    const r = Response.content({ target: 't', expression: { action: 'play-next', contentId: 'plex:2', options: {} } });
    await dispatchResponse({ ...r, dispatchId: 'd2' }, d);
    expect(d.wakeAndLoadService.execute).toHaveBeenCalledWith('t', { 'play-next': 'plex:2', op: 'play-next' }, { dispatchId: 'd2' });
  });

  it('optimistic posture falls back to authoritative when no optimistic dispatcher', async () => {
    const d = deps();
    const r = Response.content({ target: 't', expression: { action: 'play', contentId: 'plex:3', options: {} }, posture: 'optimistic' });
    await dispatchResponse({ ...r, dispatchId: 'd3' }, d);
    expect(d.wakeAndLoadService.execute).toHaveBeenCalledWith('t', { play: 'plex:3' }, { dispatchId: 'd3' });
  });

  it('device open → deviceService.get(target).loadContent(path, params)', async () => {
    const d = deps();
    const dev = { loadContent: vi.fn().mockResolvedValue('ok'), clearContent: vi.fn() };
    d.deviceService.get = vi.fn(() => dev);
    await dispatchResponse(Response.device({ target: 'office-tv', op: 'open', path: '/videocall', params: { room: 'x' } }), d);
    expect(dev.loadContent).toHaveBeenCalledWith('/videocall', { room: 'x' });
  });

  it('ha scene → haGateway.callService(scene, turn_on, {entity_id})', async () => {
    const d = deps();
    await dispatchResponse(Response.ha({ op: 'scene', scene: 'scene.movie' }), d);
    expect(d.haGateway.callService).toHaveBeenCalledWith('scene', 'turn_on', { entity_id: 'scene.movie' });
  });

  it('throws UnknownResponseKindError for an unregistered kind', async () => {
    await expect(dispatchResponse({ kind: 'nope' }, deps())).rejects.toBeInstanceOf(UnknownResponseKindError);
  });
});
