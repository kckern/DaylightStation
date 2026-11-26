import {contentRequiresCamera} from '../../../../__backend/src/5_composition/policies/contentRequiresCamera.mjs';
import { describe, it, expect, vi } from 'vitest';
import { WakeAndLoadService } from '#apps/devices/services/WakeAndLoadService.mjs';
import { testApplicationRuntime } from '../../../_lib/applicationRuntime.mjs';

const logger = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });

function makeSvc(sendCommand) {
  const device = {
    id: 'portal', screenPath: '/screen/portal', defaultVolume: null, notifyService: null,
    hasCapability: vi.fn((cap) => cap === 'contentControl'),
    powerOn: vi.fn(), setVolume: vi.fn().mockResolvedValue({ ok: true }),
    prepareForContent: vi.fn().mockResolvedValue({ ok: true, coldRestart: false, cameraAvailable: true }),
    loadContent: vi.fn().mockResolvedValue({ ok: true }),
  };
  return new WakeAndLoadService({ contentRequiresCamera,
    ...testApplicationRuntime(),
    deviceService: { get: vi.fn().mockReturnValue(device) },
    readinessPolicy: { isReady: vi.fn() },
    broadcast: () => {},
    screenGateway: { publishProgress: vi.fn(), screenSubscriberCount: () => 0 },
    sessionControlService: { sendCommand },
    logger: logger(),
  });
}

describe('WakeAndLoadService adopt mode keeps a paused move paused', () => {
  it.each([
    ['paused', false],
    ['playing', true],
    ['buffering', true],
  ])('a %s snapshot is adopted with autoplay %s', async (state, autoplay) => {
    const sendCommand = vi.fn().mockResolvedValue({ ok: true });
    const svc = makeSvc(sendCommand);
    await svc.execute('portal', {}, { dispatchId: 'd1', adoptSnapshot: { state, currentItem: { contentId: 'plex:1' } } });
    expect(sendCommand).toHaveBeenCalledTimes(1);
    expect(sendCommand.mock.calls[0][0].params).toMatchObject({ autoplay });
  });
});

describe('WakeAndLoadService adopt mode confirms playback from the screen', () => {
  function makeWatched(sendCommand) {
    const handlers = new Map();
    const eventBus = {
      subscribe: vi.fn((topic, cb) => { handlers.set(topic, cb); return () => handlers.delete(topic); }),
      getTopicSubscriberCount: vi.fn().mockReturnValue(1),
      emit: (topic, payload) => handlers.get(topic)?.(payload),
    };
    const broadcast = vi.fn();
    const device = {
      id: 'portal', screenPath: '/screen/portal', defaultVolume: null, notifyService: null,
      hasCapability: vi.fn((cap) => cap === 'contentControl'),
      powerOn: vi.fn(), setVolume: vi.fn().mockResolvedValue({ ok: true }),
      prepareForContent: vi.fn().mockResolvedValue({ ok: true, coldRestart: false, cameraAvailable: true }),
      loadContent: vi.fn().mockResolvedValue({ ok: true }),
    };
    const svc = new WakeAndLoadService({ contentRequiresCamera,
      ...testApplicationRuntime(),
      deviceService: { get: vi.fn().mockReturnValue(device) },
      readinessPolicy: { isReady: vi.fn() },
      broadcast, eventBus,
      screenGateway: { publishProgress: vi.fn(), screenSubscriberCount: () => 0 },
      sessionControlService: { sendCommand },
      logger: logger(),
    });
    return { svc, eventBus, broadcast };
  }
  const playing = (contentId) => ({
    sessionId: 's-adopted', state: 'playing',
    currentItem: { contentId, queueItemId: 'v1' },
    queue: { items: [{ contentId, queueItemId: 'v1' }], currentIndex: 0 },
    meta: { ownerId: 'portal', playbackOwner: { ownerInstanceId: 'player', playbackRevision: 1, queueRevision: 1 } },
  });
  const confirmed = (broadcast) => broadcast.mock.calls.some(([e]) => e.step === 'playback' && e.status === 'confirmed');

  it('a hand-off (adopt) reads started once the screen plays the adopted item', async () => {
    const { svc, eventBus, broadcast } = makeWatched(vi.fn().mockResolvedValue({ ok: true }));
    await svc.execute('portal', {}, { dispatchId: 'move-1', adoptSnapshot: { state: 'playing', currentItem: { contentId: 'plex:266151' } } });
    eventBus.emit('device-state:portal', { deviceId: 'portal', snapshot: playing('plex:999') });
    expect(confirmed(broadcast)).toBe(false);
    eventBus.emit('device-state:portal', { deviceId: 'portal', snapshot: playing('plex:266151') });
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ dispatchId: 'move-1', step: 'playback', status: 'confirmed', contentId: 'plex:266151' }));
  });

  it('a paused hand-off is not waited on for playback', async () => {
    const { svc, eventBus } = makeWatched(vi.fn().mockResolvedValue({ ok: true }));
    await svc.execute('portal', {}, { dispatchId: 'move-2', adoptSnapshot: { state: 'paused', currentItem: { contentId: 'plex:266151' } } });
    expect(eventBus.subscribe).not.toHaveBeenCalledWith('device-state:portal', expect.any(Function));
  });
});
