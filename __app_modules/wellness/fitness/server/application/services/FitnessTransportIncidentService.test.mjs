import { describe, it, expect, vi } from 'vitest';
import { FitnessTransportIncidentService } from './FitnessTransportIncidentService.mjs';
import { FitnessSessionOperations } from './FitnessSessionOperations.mjs';
const event = (type = 'lost', id = 'incident-1') => ({ type: 'fitness_transport', data: { type, incidentId: id, state: type === 'lost' ? 'lost' : 'healthy', reason: 'delivery-gap', bootId: 'bridge-a', silenceMs: 60000, timestamp: '2026-11-16T12:00:00Z' } });
function fixture() {
  const data = new Map();
  let time = 0;
  const store = {
    readTransportIncidents: vi.fn(async h => structuredClone(data.get(h) ?? { incidents: {} })),
    writeTransportIncidents: vi.fn(async (h, value) => { data.set(h, structuredClone(value)); }),
  };
  const sendPush = vi.fn(async () => ({ accepted: true }));
  const logger = { info: vi.fn(), warn: vi.fn() };
  const make = () => new FitnessTransportIncidentService({ store, sendPush, logger, allowedHouseholdId: 'home', now: () => time, wallNow: () => time });
  return { store, sendPush, make, data, advance: (ms) => { time += ms; } };
}
describe('fitness transport alerts from committed session metadata', () => {
  it('deduplicates accepted incident pushes across resaves and service restart', async () => {
    const { make, sendPush, data } = fixture();
    const session = { timeline: { events: [event()] } };
    await make().recordCommitted(session, 'home');
    await make().recordCommitted(session, 'home');
    expect(sendPush).toHaveBeenCalledTimes(1);
    expect(sendPush.mock.calls[0][1]).toBe('home');
    expect(data.get('home').incidents['incident-1']).toMatchObject({ status: 'accepted', delivered: 'unknown', attempts: 1 });
  });
  it('persists failed status and retries from the durable queue on a later authorized save', async () => {
    const { make, sendPush, data, advance } = fixture();
    sendPush.mockRejectedValueOnce(new Error('HA unavailable'));
    await make().recordCommitted({ events: [event()] }, 'home');
    expect(data.get('home').incidents['incident-1'].status).toBe('failed');
    advance(60000);
    await make().tick();
    expect(sendPush).toHaveBeenCalledTimes(2);
    expect(data.get('home').incidents['incident-1'].status).toBe('accepted');
  });
  it('registers the existing scheduler and retries durable pending work after restart without a browser save', async () => {
    const { make, sendPush, data, advance } = fixture();
    sendPush.mockRejectedValue(new Error('HA unavailable'));
    await make().recordCommitted({ events: [event()] }, 'home');
    const restarted = make();
    const scheduler = { registerTask: vi.fn() };
    restarted.register(scheduler);
    expect(scheduler.registerTask).toHaveBeenCalledWith('fitness:transport-incident-retry', '* * * * *', expect.any(Function));
    const retry = scheduler.registerTask.mock.calls[0][2];
    await retry();
    expect(sendPush).toHaveBeenCalledTimes(1);
    advance(60000); await retry();
    advance(120000); await retry();
    advance(300000); await retry();
    expect(sendPush).toHaveBeenCalledTimes(4);
    expect(data.get('home').incidents['incident-1']).toMatchObject({ status: 'failed', lastError: 'push_unavailable_or_failed' });
    sendPush.mockResolvedValue({ accepted: true });
    advance(300000); await retry();
    advance(300000); await retry();
    expect(sendPush).toHaveBeenCalledTimes(5);
    expect(data.get('home').incidents['incident-1'].status).toBe('accepted');
  });

  it('rejects unsupported households, invalid metadata and biometric fields before the provider', async () => {
    const { make, sendPush, store } = fixture();
    await make().recordCommitted({ events: [event()] }, 'other');
    expect(store.readTransportIncidents).not.toHaveBeenCalled();
    await make().recordCommitted({ events: [event('stalled'), { ...event(), data: { ...event().data, heartRate: 150 } }, { ...event(), data: { ...event().data, timestamp: 'yesterday' } }] }, 'home');
    expect(sendPush).not.toHaveBeenCalled();
  });
  it('never alerts for forbidden or failed saves, and reads only the committed session', async () => {
    const reporter = { recordCommitted: vi.fn() };
    const committed = { events: [event('lost', 'committed')] };
    const sessions = { saveSessionWithReceipt: vi.fn(async () => ({ session: committed })) };
    const config = { mayWriteSession: vi.fn(() => false) };
    const ops = new FitnessSessionOperations({ sessions, config, transportIncidents: reporter, logger: { warn: vi.fn() } });
    const request = { sessionData: { events: [event()] }, householdId: 'home', userAgent: 'Mac' };
    expect((await ops.save(request)).kind).toBe('forbidden');
    expect(reporter.recordCommitted).not.toHaveBeenCalled();
    config.mayWriteSession.mockReturnValue(true);
    await ops.save(request);
    expect(reporter.recordCommitted).toHaveBeenCalledWith(committed, 'home');
    sessions.saveSessionWithReceipt.mockRejectedValueOnce(new Error('disk failure'));
    await expect(ops.save(request)).rejects.toThrow('disk failure');
    expect(reporter.recordCommitted).toHaveBeenCalledTimes(1);
  });
});
