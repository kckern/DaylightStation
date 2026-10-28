// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { homeDashboardTimelineHandler, homeDashboardEntityHistoryHandler } from './timeline.mjs';

const res = () => ({ set: vi.fn(), json: vi.fn() });

describe('home-dashboard timeline handlers', () => {
  it('passes the range through, defaulting to today, uncached', async () => {
    const operation = { execute: vi.fn().mockResolvedValue({ range: 'today', lanes: [] }) };
    const r = res();
    await homeDashboardTimelineHandler({ operation })({ query: {} }, r);
    expect(operation.execute).toHaveBeenCalledWith({ range: 'today' });
    expect(r.set).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(r.json).toHaveBeenCalledWith({ range: 'today', lanes: [] });
  });
  it('passes the entity id and range, defaulting to 24h', async () => {
    const operation = { execute: vi.fn().mockResolvedValue({ kind: 'line' }) };
    await homeDashboardEntityHistoryHandler({ operation })({ params: { entityId: 'sensor.p' }, query: {} }, res());
    expect(operation.execute).toHaveBeenCalledWith({ entityId: 'sensor.p', range: '24h' });
  });
  it('require their use case', () => {
    expect(() => homeDashboardTimelineHandler({})).toThrow(/operation required/);
    expect(() => homeDashboardEntityHistoryHandler({})).toThrow(/operation required/);
  });
});
