import { describe, it, expect, vi } from 'vitest';
import { DeviceEventRouter } from './DeviceEventRouter.js';

describe('DeviceEventRouter — rider_select', () => {
  it('routes a rider_select payload to a registered rider_select handler', () => {
    const router = new DeviceEventRouter();
    const handler = vi.fn(() => null);
    router.register('rider_select', handler);

    const payload = { topic: 'rider_select', equipmentId: 'niceday', userId: 'user_2', action: '1_single' };
    const result = router.route(payload);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toMatchObject({ equipmentId: 'niceday', userId: 'user_2' });
    expect(result.handled).toBe(true);
  });

  it('does not handle a rider_select payload when no handler is registered', () => {
    const router = new DeviceEventRouter();
    const result = router.route({ topic: 'rider_select', equipmentId: 'niceday', userId: 'user_2' });
    expect(result.handled).toBe(false);
  });
});
