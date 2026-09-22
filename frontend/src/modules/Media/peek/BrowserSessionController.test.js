import { describe, expect, it, vi } from 'vitest';
import { createBrowserSessionController } from './BrowserSessionController.js';

function fleetStore(snapshot = { state: 'playing', currentItem: { contentId: 'plex:1', duration: 60 }, queue: { items: [] } }) {
  return {
    getEntry: vi.fn(() => ({ snapshot, isStale: false, offline: false })),
    subscribeDevice: vi.fn(() => vi.fn()),
  };
}

describe('BrowserSessionController', () => {
  it('round-trips browser transport through the stable client route with human origin', async () => {
    const correlator = { send: vi.fn(async ({ command }) => ({ ok: true, commandId: command.commandId })) };
    const controller = createBrowserSessionController({
      deviceId: 'browser:target-stable', callerDeviceId: 'browser:caller-stable',
      fleetStore: fleetStore(), correlator, randomUuid: () => 'command-1',
    });

    await expect(controller.transport.pause()).resolves.toMatchObject({ ok: true, commandId: 'command-1' });
    expect(correlator.send).toHaveBeenCalledWith({
      targetControlClientId: 'target-stable',
      command: expect.objectContaining({
        commandId: 'command-1', command: 'transport', params: { action: 'pause' },
        origin: { kind: 'device', id: 'browser:caller-stable' },
      }),
    });
  });

  it('round-trips queue and config commands without writing a hardware API', async () => {
    const correlator = { send: vi.fn(async () => ({ ok: true })) };
    const controller = createBrowserSessionController({
      deviceId: 'browser:target', callerDeviceId: 'browser:caller',
      fleetStore: fleetStore(), correlator, randomUuid: () => 'command-2',
    });

    await controller.queue.add({ contentId: 'plex:2' });
    await controller.config.setVolume(55);
    expect(correlator.send.mock.calls.map(([input]) => input.command)).toEqual([
      expect.objectContaining({ command: 'queue', params: { op: 'add', contentId: 'plex:2' } }),
      expect.objectContaining({ command: 'config', params: { setting: 'volume', value: 55 } }),
    ]);
  });
});
