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

  // A1: "has data" is judged inside the day's window, not over the whole range.
  it('a day before the entity\'s first point has no data, for every lane kind', () => {
    const late = 2 * 3600e3; // first point lands after this window ends
    const h = new Map([
      ['sensor.panel_power', [{ t: late, v: 500 }]],
      ['binary_sensor.porch_visitor', [{ t: late, v: 'off' }]],
      ['binary_sensor.den_presence', [{ t: late, v: 'on' }]],
      ['sensor.den_tv_plug_power', [{ t: late, v: 120 }]],
    ]);
    expect(buildLaneDay(p.lanes[0], h, w, { buckets: 12 })).toMatchObject({ hasData: false, total: { kwh: null } });
    expect(buildLaneDay(p.lanes[1], h, w, { buckets: 12 })).toMatchObject({ hasData: false, total: { count: null } });
    expect(buildLaneDay(p.lanes[2], h, w, { buckets: 12 })).toMatchObject({ hasData: false, total: { hours: null } });
    expect(buildLaneDay(p.lanes[3], h, w, { buckets: 12 })).toMatchObject({ hasData: false, total: { hours: null, kwh: null } });
  });
  it('a day where the entity was unavailable throughout has no data, not 0 h', () => {
    const h = new Map([
      ['binary_sensor.den_presence', [{ t: -60e3, v: null }]],
      ['sensor.den_tv_plug_power', [{ t: 0, v: null }, { t: 1800e3, v: null }]],
      ['sensor.panel_power', [{ t: 0, v: null }]],
    ]);
    expect(buildLaneDay(p.lanes[2], h, w, { buckets: 12 })).toMatchObject({ hasData: false, total: { hours: null } });
    expect(buildLaneDay(p.lanes[3], h, w, { buckets: 12 })).toMatchObject({ hasData: false, total: { hours: null, kwh: null } });
    expect(buildLaneDay(p.lanes[0], h, w, { buckets: 12 })).toMatchObject({ hasData: false, total: { kwh: null } });
  });
  it('a value carried in from before the window counts as data for the day', () => {
    const h = new Map([['binary_sensor.den_presence', [{ t: -3600e3, v: 'off' }]]]);
    expect(buildLaneDay(p.lanes[2], h, w, { buckets: 12 })).toMatchObject({ hasData: true, intervals: [], total: { hours: 0 } });
  });
  it('a power lane draws its line and takes kWh from the daily meter', () => {
    const h = new Map([
      ['sensor.panel_power', [{ t: 0, v: 1000 }, { t: 1800e3, v: 3000 }]],
      ['sensor.panel_energy_today', [{ t: 0, v: 0.1 }, { t: 1800e3, v: 1.4 }]],
    ]);
    const d = buildLaneDay(p.lanes[0], h, w, { buckets: 2 });
    expect(d).toMatchObject({ hasData: true, total: { kwh: 1.4 } });
    expect(d.points.map((pt) => pt.v)).toEqual([1000, 3000]);
  });
  it('a power lane whose meter has nothing in the window integrates the line instead', () => {
    const h = new Map([
      ['sensor.panel_power', [{ t: 0, v: 1000 }]],
      ['sensor.panel_energy_today', [{ t: 2 * 3600e3, v: 9 }]],
    ]);
    expect(buildLaneDay(p.lanes[0], h, w, { buckets: 2 }).total.kwh).toBeCloseTo(1);
  });
  it('an occupancy lane sums the hours someone was there', () => {
    const h = new Map([['binary_sensor.den_presence', [{ t: 0, v: 'off' }, { t: 900e3, v: 'on' }, { t: 2700e3, v: 'off' }]]]);
    const d = buildLaneDay(p.lanes[2], h, w, { buckets: 12 });
    expect(d.intervals).toEqual([{ from: 900e3, to: 2700e3 }]);
    expect(d.total.hours).toBeCloseTo(0.5);
  });
});
