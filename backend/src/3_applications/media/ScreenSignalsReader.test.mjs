import { describe, it, expect, vi } from 'vitest';
import { ScreenSignalsReader } from './ScreenSignalsReader.mjs';

const NOW = Date.parse('2026-10-03T12:00:00.000Z');

describe('ScreenSignalsReader', () => {
  it('joins fleet liveness (online + last heard) with each screen\'s newest ledger start', async () => {
    const liveness = {
      knownDeviceIds: () => ['livingroom-tv'],
      getLastSnapshot: () => ({ lastSeenAt: '2026-10-03T11:59:00.000Z', online: true }),
    };
    const playLedger = { plays: vi.fn(async () => [
      { deviceId: 'browser:a', startedAt: '2026-10-02T10:00:00.000Z' },
      { deviceId: 'browser:a', startedAt: '2026-09-30T10:00:00.000Z' },
      { deviceId: 'fleet:livingroom-tv', startedAt: '2026-10-01T10:00:00.000Z' },
    ]) };
    const reader = new ScreenSignalsReader({ livenessService: liveness, playLedger, clock: { now: () => NOW } });
    expect(await reader.read()).toEqual({
      'fleet:livingroom-tv': { lastSeen: '2026-10-03T11:59:00.000Z', online: true },
      'browser:a': { lastSeen: '2026-10-02T10:00:00.000Z' },
    });
    expect(playLedger.plays.mock.calls[0][0]).toMatchObject({ from: '2026-09-02T12:00:00.000Z' });
  });
  it('a failing source contributes nothing', async () => {
    const reader = new ScreenSignalsReader({
      livenessService: { knownDeviceIds: () => { throw new Error('x'); }, getLastSnapshot: () => null },
      playLedger: { plays: async () => { throw new Error('y'); } },
      logger: { warn: vi.fn() },
    });
    expect(await reader.read()).toEqual({});
  });
});
