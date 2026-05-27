import { describe, it, expect, beforeEach } from 'vitest';
import { GetHubStatus } from '../../../backend/src/3_applications/playback-hub/usecases/GetHubStatus.mjs';
import { FakeHubGateway } from '../../../backend/src/3_applications/playback-hub/test/FakeHubGateway.mjs';
import { SlotStatus } from '../../../backend/src/2_domains/playback-hub/value-objects/SlotStatus.mjs';

describe('GetHubStatus', () => {
  let gateway;
  beforeEach(() => {
    gateway = new FakeHubGateway();
  });

  it('returns slot statuses from the gateway', async () => {
    const status = SlotStatus.fromHubJson({
      position: 1, color: 'red', bt_connected: true, paused: false,
      now_playing: { queue: { source: 'plex', id: '670208' } },
      volume: 45, playlist_pos: 12, playlist_count: 30, armed_source: null
    });
    gateway.setStatusFixture([status]);
    const useCase = new GetHubStatus({ headsetHubGateway: gateway });
    const result = await useCase.execute();
    expect(result.slots).toEqual([status]);
  });

  it('attaches a Date in fetchedAt', async () => {
    gateway.setStatusFixture([]);
    const useCase = new GetHubStatus({ headsetHubGateway: gateway });
    const result = await useCase.execute();
    expect(result.fetchedAt).toBeInstanceOf(Date);
  });

  it('propagates gateway errors', async () => {
    gateway.setError(new Error('boom'));
    const useCase = new GetHubStatus({ headsetHubGateway: gateway });
    await expect(useCase.execute()).rejects.toThrow('boom');
  });

  it('throws when constructed without a gateway', () => {
    expect(() => new GetHubStatus({})).toThrow(/headsetHubGateway/);
  });
});
