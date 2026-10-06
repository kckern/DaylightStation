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
  return new WakeAndLoadService({
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
