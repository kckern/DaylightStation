import { describe, it, expect, vi } from 'vitest';
import { HarvesterService } from '#apps/harvester/HarvesterService.mjs';

const harvesterWith = (impl) => ({ serviceId: 'strava', category: 'fitness', harvest: impl, getStatus: () => ({}) });
const quiet = { info() {}, warn() {}, error() {} };

describe('HarvesterService.onResult', () => {
  it('reports successful results and thrown errors to listeners', async () => {
    const service = new HarvesterService({ resolveDefaultUserId: () => 'kc', logger: quiet });
    const listener = vi.fn();
    service.onResult(listener);

    service.register(harvesterWith(async () => ({ status: 'success', count: 1, activities: [{ id: 1 }] })));
    await service.harvest('strava');
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({
      serviceId: 'strava', username: 'kc', error: null, result: expect.objectContaining({ status: 'success' }),
    }));

    service.register(harvesterWith(async () => { throw new Error('401'); }));
    await expect(service.harvest('strava')).rejects.toThrow('401');
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ result: null, error: expect.any(Error) }));
  });

  it('a throwing listener never breaks the harvest', async () => {
    const service = new HarvesterService({ resolveDefaultUserId: () => 'kc', logger: quiet });
    service.onResult(() => { throw new Error('boom'); });
    service.register(harvesterWith(async () => ({ status: 'success', count: 0 })));
    await expect(service.harvest('strava')).resolves.toMatchObject({ status: 'success' });
  });
});
