import { describe, it, expect, jest } from '@jest/globals';
import { actionHandlers, UnknownActionError, dispatchAction } from '../../../../backend/src/3_applications/trigger/actionHandlers.mjs';

describe('actionHandlers', () => {
  it('queue calls wakeAndLoadService with queue=<content>', async () => {
    const wakeAndLoadService = { execute: jest.fn().mockResolvedValue({ ok: true, dispatchId: 'd1' }) };
    const intent = { action: 'queue', target: 'livingroom-tv', content: 'plex:620707', params: { volume: 60 } };
    await actionHandlers.queue(intent, { wakeAndLoadService });
    expect(wakeAndLoadService.execute).toHaveBeenCalledWith(
      'livingroom-tv',
      { queue: 'plex:620707', volume: 60 },
      expect.objectContaining({ dispatchId: expect.any(String) })
    );
  });

  it('play calls wakeAndLoadService with play=<content>', async () => {
    const wakeAndLoadService = { execute: jest.fn().mockResolvedValue({ ok: true }) };
    const intent = { action: 'play', target: 'office-tv', content: 'hymn:166', params: {} };
    await actionHandlers.play(intent, { wakeAndLoadService });
    expect(wakeAndLoadService.execute).toHaveBeenCalledWith(
      'office-tv',
      { play: 'hymn:166' },
      expect.any(Object)
    );
  });

  it('canonical queue/play key wins over user-supplied params (no clobber)', async () => {
    const wakeAndLoadService = { execute: jest.fn().mockResolvedValue({ ok: true }) };
    const intent = { action: 'queue', target: 't', content: 'plex:1', params: { queue: 'hijack' } };
    await actionHandlers.queue(intent, { wakeAndLoadService });
    expect(wakeAndLoadService.execute).toHaveBeenCalledWith(
      't',
      expect.objectContaining({ queue: 'plex:1' }),
      expect.any(Object)
    );
  });

  it('scene calls haGateway.callService with scene.turn_on', async () => {
    const haGateway = { callService: jest.fn().mockResolvedValue({ ok: true }) };
    const intent = { action: 'scene', scene: 'scene.movie_night', params: {} };
    await actionHandlers.scene(intent, { haGateway });
    expect(haGateway.callService).toHaveBeenCalledWith(
      'scene', 'turn_on', { entity_id: 'scene.movie_night' }
    );
  });

  it('ha-service calls haGateway.callService with parsed domain.service', async () => {
    const haGateway = { callService: jest.fn().mockResolvedValue({ ok: true }) };
    const intent = {
      action: 'ha-service',
      service: 'light.turn_off',
      entity: 'light.livingroom',
      data: { transition: 2 },
      params: {},
    };
    await actionHandlers['ha-service'](intent, { haGateway });
    expect(haGateway.callService).toHaveBeenCalledWith(
      'light', 'turn_off', { entity_id: 'light.livingroom', transition: 2 }
    );
  });

  it('ha-service throws on malformed service string', async () => {
    await expect(actionHandlers['ha-service'](
      { action: 'ha-service', service: 'no-dot', params: {} },
      { haGateway: { callService: jest.fn() } }
    )).rejects.toThrow(/Invalid ha-service/);
  });

  it('open calls device.loadContent with the path', async () => {
    const device = { loadContent: jest.fn().mockResolvedValue({ ok: true }) };
    const deviceService = { get: jest.fn().mockReturnValue(device) };
    const intent = { action: 'open', target: 'livingroom-tv', params: { path: '/menu' } };
    await actionHandlers.open(intent, { deviceService });
    expect(deviceService.get).toHaveBeenCalledWith('livingroom-tv');
    expect(device.loadContent).toHaveBeenCalledWith('/menu', {});
  });

  it('open throws when device is unknown', async () => {
    const deviceService = { get: jest.fn().mockReturnValue(undefined) };
    await expect(actionHandlers.open(
      { action: 'open', target: 'no-such', params: { path: '/x' } },
      { deviceService }
    )).rejects.toThrow(/Unknown target device: no-such/);
  });

  it('open throws when path is missing', async () => {
    const deviceService = { get: jest.fn().mockReturnValue({ loadContent: jest.fn() }) };
    await expect(actionHandlers.open(
      { action: 'open', target: 't', params: {} },
      { deviceService }
    )).rejects.toThrow(/requires params\.path/);
  });

  describe('dispatchAction', () => {
    it('routes to the matching handler', async () => {
      const wakeAndLoadService = { execute: jest.fn().mockResolvedValue({ ok: true }) };
      const intent = { action: 'queue', target: 't', content: 'plex:1', params: {} };
      await dispatchAction(intent, { wakeAndLoadService });
      expect(wakeAndLoadService.execute).toHaveBeenCalled();
    });

    it('throws UnknownActionError for unknown actions', async () => {
      const promise = dispatchAction({ action: 'launch-rocket', params: {} }, {});
      await expect(promise).rejects.toBeInstanceOf(UnknownActionError);
      await expect(promise).rejects.toMatchObject({ action: 'launch-rocket' });
    });
  });
});
