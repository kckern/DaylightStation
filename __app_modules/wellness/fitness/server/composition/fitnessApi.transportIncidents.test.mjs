import { describe, expect, it, vi } from 'vitest';
import { createFitnessTransportIncidentReporter } from './fitnessApi.mjs';
import { NotificationService } from '#apps/notification/NotificationService.mjs';
import { PushNotificationAdapter } from '#adapters/notification/PushNotificationAdapter.mjs';
import { createPushSender } from '#composition/modules/notifications.mjs';
const lost = { type: 'fitness_transport', data: { type: 'lost', incidentId: 'incident-1', state: 'lost', reason: 'delivery-gap', bootId: 'bridge-a', silenceMs: 60000, timestamp: '2026-11-16T12:00:00Z' } };
function fixture({ target = 'parent_phone' } = {}) {
  let time = 0;
  let queue = { incidents: {} };
  const callService = vi.fn(async () => ({ ok: false, error: 'unavailable' }));
  const store = { readTransportIncidents: async () => structuredClone(queue), writeTransportIncidents: async (_household, data) => { queue = structuredClone(data); } };
  const configService = { getHeadOfHousehold: vi.fn(() => 'parent') };
  // The production chain: NotificationService -> HA push adapter (no phone connected).
  const notificationService = new NotificationService({ adapters: [new PushNotificationAdapter({ haGateway: { callService }, resolveNotifyService: () => target })] });
  const reporter = createFitnessTransportIncidentReporter({
    store, householdId: 'home', configService,
    makePushSender: (options) => createPushSender({ notificationService, ...options }),
    now: () => time, wallNow: () => time,
  });
  return { reporter, callService, configService, read: () => queue, advance: ms => { time += ms; } };
}
describe('production fitness transport notification binding', () => {
  it('keeps a resolved HA failure retryable and accepts only after a successful retry', async () => {
    const { reporter, callService, configService, read, advance } = fixture();
    await reporter.recordCommitted({ events: [lost] }, 'home');
    expect(read().incidents['incident-1']).toMatchObject({ status: 'failed', delivered: 'unknown' });
    expect(configService.getHeadOfHousehold).toHaveBeenCalledWith('home');
    callService.mockResolvedValue({ ok: true });
    advance(60000); await reporter.tick();
    expect(callService).toHaveBeenCalledTimes(2);
    expect(read().incidents['incident-1']).toMatchObject({ status: 'accepted', delivered: 'unknown' });
  });
  it('never invokes the gateway for missing targets or unsupported scope', async () => {
    const { reporter, callService, read } = fixture({ target: null });
    await reporter.recordCommitted({ events: [lost] }, 'other');
    expect(read().incidents).toEqual({});
    await reporter.recordCommitted({ events: [lost] }, 'home');
    expect(read().incidents['incident-1'].status).toBe('failed');
    expect(callService).not.toHaveBeenCalled();
  });
});
