import { describe, it, expect, vi } from 'vitest';
import { GetHomeTimeline } from './GetHomeTimeline.mjs';

const NOW = Date.parse('2026-10-28T18:00:00Z');   // 11:00 local
const MID = Date.parse('2026-10-28T07:00:00Z');
const config = { power: {}, timeline: { lanes: [
  { id: 'door', kind: 'events', entity: 'binary_sensor.porch_visitor', camera: 'porch-cam' },
  { id: 'den', kind: 'occupancy', entity: 'binary_sensor.den_presence' },
] } };
const make = (history = new Map(), cfg = config) => {
  const historyGateway = { readHistory: vi.fn().mockResolvedValue(history) };
  const uc = new GetHomeTimeline({ configRepository: { load: async () => cfg }, historyGateway, timeZone: 'America/Los_Angeles', clock: () => NOW, logger: { debug: vi.fn() } });
  return { uc, historyGateway };
};

describe('GetHomeTimeline', () => {
  it('reads every lane entity once, from midnight, open-ended for today', async () => {
    const { uc, historyGateway } = make();
    await uc.execute({ range: 'today' });
    expect(historyGateway.readHistory).toHaveBeenCalledTimes(1);
    expect(historyGateway.readHistory).toHaveBeenCalledWith(['binary_sensor.porch_visitor', 'binary_sensor.den_presence'], { startMs: MID, endMs: null });
  });
  it('counts rings and says when a lane has no history', async () => {
    const { uc } = make(new Map([['binary_sensor.porch_visitor', [{ t: MID - 1, v: 'off' }, { t: MID + 3600e3, v: 'on' }, { t: MID + 3605e3, v: 'off' }]]]));
    const out = await uc.execute({ range: 'today' });
    expect(out.lanes[0]).toMatchObject({ id: 'door', camera: 'porch-cam', total: { count: 1 } });
    expect(out.lanes[0].days[0].marks).toEqual([MID + 3600e3]);
    expect(out.lanes[1].days[0].hasData).toBe(false);
    expect(out.lanes[1].total).toEqual({ hours: null });
  });
  it('week has seven days per lane and closes yesterday at midnight', async () => {
    const { uc, historyGateway } = make();
    expect((await uc.execute({ range: 'week' })).lanes[0].days).toHaveLength(7);
    await uc.execute({ range: 'yesterday' });
    expect(historyGateway.readHistory.mock.calls[1][1]).toEqual({ startMs: MID - 24 * 3600e3, endMs: MID });
  });
  it('rejects an unknown range and a bad lane config', async () => {
    await expect(make().uc.execute({ range: 'month' })).rejects.toMatchObject({ name: 'ValidationError' });
    await expect(make(new Map(), { timeline: { lanes: [{ id: 'x', kind: 'occupancy' }] } }).uc.execute({ range: 'today' }))
      .rejects.toMatchObject({ name: 'ConfigurationError' });
  });
  it('in a week, days before an entity\'s first point have no data while later days do', async () => {
    const third = MID - 4 * 24 * 3600e3; // local midnight starting the third day of the week
    const { uc } = make(new Map([
      ['binary_sensor.den_presence', [{ t: third + 3600e3, v: 'off' }]],
      ['binary_sensor.porch_visitor', [{ t: third + 3600e3, v: 'off' }, { t: third + 7200e3, v: 'on' }]],
    ]));
    const out = await uc.execute({ range: 'week' });
    expect(out.lanes[1].days.map((d) => d.hasData)).toEqual([false, false, true, true, true, true, true]);
    expect(out.lanes[1].days[0].total).toEqual({ hours: null });
    expect(out.lanes[1].days[3].total).toEqual({ hours: 0 });
    expect(out.lanes[0].days.map((d) => d.total.count)).toEqual([null, null, 1, 0, 0, 0, 0]);
    expect(out.lanes[0].total).toEqual({ count: 1 });
  });
  it('without an injected logger it never falls back to the console', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const uc = new GetHomeTimeline({ configRepository: { load: async () => config }, historyGateway: { readHistory: vi.fn().mockResolvedValue(new Map()) }, timeZone: 'America/Los_Angeles', clock: () => NOW });
    await uc.execute({ range: 'today' });
    expect(debug).not.toHaveBeenCalled();
    debug.mockRestore();
  });
});
