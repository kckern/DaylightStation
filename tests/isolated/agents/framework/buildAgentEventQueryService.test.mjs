// tests/isolated/agents/framework/buildAgentEventQueryService.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { buildAgentEventQueryService } from '../../../../backend/src/3_applications/agents/framework/buildAgentEventQueryService.mjs';

describe('buildAgentEventQueryService', () => {
  it('returns null when adapters map is null', () => {
    expect(buildAgentEventQueryService(null, null)).toBe(null);
  });

  it('returns null when adapters map is empty', () => {
    expect(buildAgentEventQueryService({}, null)).toBe(null);
  });

  it('returns null when adapters map has only null/undefined values', () => {
    expect(buildAgentEventQueryService({ workout: null, meal: undefined }, null)).toBe(null);
  });

  it('builds an EventQueryService when at least one adapter is defined', () => {
    const fakeAdapter = { list: vi.fn(), detail: vi.fn(), summary: vi.fn() };
    const svc = buildAgentEventQueryService({ workout: fakeAdapter, meal: null }, null);
    expect(svc).toBeDefined();
    expect(typeof svc.queryEvents).toBe('function');
  });

  it('forwards baselineService to EventQueryService.queryEvents', async () => {
    const fakeAdapter = {
      list: vi.fn(async () => ({ events: [], meta: { kind: 'workout', n: 0 } })),
    };
    const baselineService = { getBaselines: vi.fn(async () => ({ fitness: {} })) };
    const svc = buildAgentEventQueryService({ workout: fakeAdapter }, baselineService);
    await svc.queryEvents({ kind: 'workout', period: 'last_7d', userId: 'kc' });
    expect(baselineService.getBaselines).toHaveBeenCalledWith({ userId: 'kc' });
  });

  it('strips null adapters before constructing the dispatcher', () => {
    const fakeAdapter = { list: vi.fn(), detail: vi.fn(), summary: vi.fn() };
    const svc = buildAgentEventQueryService(
      { workout: fakeAdapter, meal: null, weigh_in: undefined },
      null,
    );
    expect(svc).toBeDefined();
  });
});
