import { describe, it, expect } from 'vitest';
import { HomeAutomationContainer } from '#apps/home-automation/HomeAutomationContainer.mjs';

const fakeRepo = { load: async () => ({ summary: {}, rooms: [] }) };
const fakeGateway = {
  getState: async () => null,
  callService: async () => ({ ok: true }),
  activateScene: async () => ({ ok: true }),
  runScript: async () => ({ ok: true }),
  waitForState: async () => ({ reached: true }),
  getStates: async () => new Map(),
  getHistory: async () => new Map(),
};

describe('HomeAutomationContainer', () => {
  it('lazy-creates use cases with injected deps', () => {
    const c = new HomeAutomationContainer({
      configRepository: fakeRepo,
      haGateway: fakeGateway,
    });
    const uc1 = c.getDashboardConfig();
    const uc2 = c.getDashboardConfig();
    expect(uc1).toBe(uc2); // cached
    expect(c.getDashboardState()).toBeTruthy();
    expect(c.getDashboardHistory()).toBeTruthy();
    expect(c.toggleDashboardEntity()).toBeTruthy();
    expect(c.activateDashboardScene()).toBeTruthy();
  });
  it('throws when required deps missing', () => {
    expect(() => new HomeAutomationContainer({ haGateway: fakeGateway }))
      .toThrow(/configRepository/);
    expect(() => new HomeAutomationContainer({ configRepository: fakeRepo }))
      .toThrow(/haGateway/);
  });
});
