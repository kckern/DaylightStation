import { describe, it, expect, vi } from 'vitest';
import { HomeAutomationContainer } from './HomeAutomationContainer.mjs';

const base = { configRepository: { load: async () => ({}) }, haGateway: {}, logger: { debug() {} } };

describe('HomeAutomationContainer history getters', () => {
  it('construct once and cache when the gateways are present', () => {
    const c = new HomeAutomationContainer({ ...base, entityGateway: {}, historyGateway: {} });
    expect(c.getHomeTimeline()).toBe(c.getHomeTimeline());
    expect(c.getEntityHistory()).toBe(c.getEntityHistory());
  });
  it('throw a named message when the historyGateway is missing', () => {
    const c = new HomeAutomationContainer({ ...base, entityGateway: {} });
    expect(() => c.getHomeTimeline()).toThrow('HomeAutomationContainer: historyGateway required for getHomeTimeline');
    expect(() => c.getEntityHistory()).toThrow('HomeAutomationContainer: historyGateway required for getEntityHistory');
  });
  it('getEntityHistory also needs the entityGateway', () => {
    const c = new HomeAutomationContainer({ ...base, historyGateway: {} });
    expect(() => c.getEntityHistory()).toThrow('entityGateway required for getEntityHistory');
  });
  it('hands its clock to the history use cases, so the window and the gateway agree on now', async () => {
    const now = Date.parse('2026-10-28T18:00:30Z');
    const historyGateway = { readHistory: vi.fn().mockResolvedValue(new Map()) };
    const c = new HomeAutomationContainer({
      ...base, clock: () => now, historyGateway,
      configRepository: { load: async () => ({ entities: {}, timeline: { lanes: [{ id: 'door', kind: 'events', entity: 'binary_sensor.porch_visitor', camera: 'porch-cam' }] } }) },
      entityGateway: { listReadings: async () => [], listRooms: async () => ({ rooms: [], assignments: {} }) },
    });
    const out = await c.getEntityHistory().execute({ entityId: 'binary_sensor.porch_visitor', range: '24h' });
    expect(out.endIso).toBe(new Date(now).toISOString());
    expect(historyGateway.readHistory.mock.calls[0][1].startMs).toBe(Date.parse('2026-10-27T18:00:00Z'));
  });
});
