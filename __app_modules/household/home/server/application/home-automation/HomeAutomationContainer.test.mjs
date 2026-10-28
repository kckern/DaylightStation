import { describe, it, expect } from 'vitest';
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
});
