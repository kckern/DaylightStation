import { describe, it, expect } from 'vitest';
import { TimelinePolicy, buildLaneDay } from './TimelinePolicy.mjs';

const lanes = [
  { id: 'power', kind: 'power', power: 'sensor.panel_power', energy: 'sensor.panel_energy_today' },
  { id: 'door', kind: 'events', label: 'Doorbell', entity: 'binary_sensor.porch_visitor', camera: 'porch-cam' },
  { id: 'den', kind: 'occupancy', entity: 'binary_sensor.den_presence' },
  { id: 'tv', kind: 'screen', label: 'Den TV', power: 'sensor.den_tv_plug_power', energy: 'sensor.den_tv_plug_energy', on_watts: 30 },
];

describe('TimelinePolicy', () => {
  it('reads lanes in order with defaults', () => {
    const p = TimelinePolicy.fromConfig({ lanes });
    expect(p.lanes.map((l) => [l.id, l.kind, l.label])).toEqual([['power', 'power', 'power'], ['door', 'events', 'Doorbell'], ['den', 'occupancy', 'den'], ['tv', 'screen', 'Den TV']]);
    expect(p.lanes[3].onWatts).toBe(30);
    expect(p.laneForEntity('binary_sensor.porch_visitor').camera).toBe('porch-cam');
    expect(p.entityIds).toContain('sensor.den_tv_plug_energy');
  });
  it('defaults to one power lane from power.whole_house, else none', () => {
    expect(TimelinePolicy.fromConfig(undefined, { power: { whole_house: 'sensor.p' } }).lanes.map((l) => l.power)).toEqual(['sensor.p']);
    expect(TimelinePolicy.fromConfig(undefined, { power: {} }).lanes).toEqual([]);
  });
  it.each([
    [{ lanes: [{ id: 'x', kind: 'occupancy' }] }, 'timeline.lanes[0].entity'],
    [{ lanes: [{ id: 'x', kind: 'screen', power: 'nodot' }] }, 'timeline.lanes[0].power'],
    [{ lanes: [{ id: 'x', kind: 'radar', entity: 'a.b' }] }, 'timeline.lanes[0].kind'],
    [{ lanes: [{ id: 'a', kind: 'occupancy', entity: 'a.b' }, { id: 'a', kind: 'occupancy', entity: 'a.c' }] }, 'timeline.lanes[1].id'],
    [{ lanes: [{ id: 'x', kind: 'screen', power: 'a.b', on_watts: -1 }] }, 'timeline.lanes[0].on_watts'],
  ])('rejects %j at %s', (cfg, field) => {
    expect(() => TimelinePolicy.fromConfig(cfg)).toThrow(expect.objectContaining({ field }));
  });
});

describe('buildLaneDay', () => {
  const w = { day: '2026-10-28', startMs: 0, endMs: 3600e3 };
  const p = TimelinePolicy.fromConfig({ lanes });
  it('a screen lane is on above its threshold and its kWh comes from the meter', () => {
    const h = new Map([
      ['sensor.den_tv_plug_power', [{ t: 0, v: 1 }, { t: 600e3, v: 120 }, { t: 1800e3, v: 1 }]],
      ['sensor.den_tv_plug_energy', [{ t: 0, v: 5.0 }, { t: 1800e3, v: 5.06 }]],
    ]);
    const d = buildLaneDay(p.lanes[3], h, w, { buckets: 12 });
    expect(d.intervals).toEqual([{ from: 600e3, to: 1800e3 }]);
    expect(d.total.hours).toBeCloseTo(1 / 3);
    expect(d.total.kwh).toBeCloseTo(0.06);
  });
  it('a lane with no history says so instead of zero', () => {
    const d = buildLaneDay(p.lanes[1], new Map(), w, { buckets: 12 });
    expect(d).toEqual({ day: '2026-10-28', hasData: false, marks: [], total: { count: null } });
  });
});
