import { describe, it, expect, vi } from 'vitest';
import { GetEntityHistory } from './GetEntityHistory.mjs';

const NOW = Date.parse('2026-10-28T18:00:30Z');
const readings = [
  { entityId: 'sensor.den_temperature', state: '70', deviceClass: 'temperature', unit: '°F', name: 'Den', lastChanged: null, detail: {} },
  { entityId: 'light.den', state: 'on', deviceClass: null, unit: null, name: 'Den lamp', lastChanged: null, detail: {} },
  { entityId: 'cover.garage_door', state: 'open', deviceClass: null, unit: null, name: 'Garage', lastChanged: null, detail: {} },
  { entityId: 'lock.side_gate', state: 'locked', deviceClass: null, unit: null, name: 'Front', lastChanged: null, detail: {} },
  { entityId: 'media_player.den_tv', state: 'idle', deviceClass: null, unit: null, name: 'TV', lastChanged: null, detail: {} },
  { entityId: 'sensor.plug_voltage', state: '120', deviceClass: 'voltage', unit: 'V', name: null, lastChanged: null, detail: {} },
];
const make = (history, config = null) => {
  const historyGateway = { readHistory: vi.fn().mockResolvedValue(history) };
  const uc = new GetEntityHistory({
    configRepository: { load: async () => config ?? ({ entities: {}, timeline: { lanes: [{ id: 'door', kind: 'events', entity: 'binary_sensor.porch_visitor', camera: 'porch-cam' }] } }) },
    entityGateway: { listReadings: async () => readings, listRooms: async () => ({ rooms: [], assignments: {} }) },
    historyGateway, clock: () => NOW, logger: { debug: vi.fn() }, timeZone: 'America/Los_Angeles',
  });
  return { uc, historyGateway };
};

describe('GetEntityHistory', () => {
  it('a numeric reading is a bucketed line over a minute-aligned window', async () => {
    const { uc, historyGateway } = make(new Map([['sensor.den_temperature', [{ t: NOW - 3600e3, v: 70 }]]]));
    const out = await uc.execute({ entityId: 'sensor.den_temperature', range: '24h' });
    expect(out.kind).toBe('line');
    expect(out.points).toHaveLength(288);
    expect(historyGateway.readHistory.mock.calls[0][1]).toEqual({ startMs: Date.parse('2026-10-27T18:00:00Z'), endMs: null });
  });
  it('an on/off entity is intervals; a doorbell lane entity is ring marks with its camera', async () => {
    expect((await make(new Map([['light.den', [{ t: NOW - 600e3, v: 'on' }]]])).uc.execute({ entityId: 'light.den', range: '24h' })).kind).toBe('state');
    const door = await make(new Map([['binary_sensor.porch_visitor', [{ t: NOW - 7200e3, v: 'off' }, { t: NOW - 600e3, v: 'on' }]]])).uc.execute({ entityId: 'binary_sensor.porch_visitor', range: '7d' });
    expect(door).toMatchObject({ kind: 'events', camera: 'porch-cam', marks: [NOW - 600e3] });
  });
  it('names the household time zone, so a drawer files rings under local days', async () => {
    const door = await make(new Map([['binary_sensor.porch_visitor', [{ t: NOW - 600e3, v: 'on' }]]])).uc.execute({ entityId: 'binary_sensor.porch_visitor', range: '24h' });
    expect(door.timeZone).toBe('America/Los_Angeles');
  });
  it('an entity the dashboard does not show is not found; a bad range is invalid', async () => {
    await expect(make(new Map()).uc.execute({ entityId: 'sensor.plug_voltage', range: '24h' })).rejects.toMatchObject({ name: 'NotFoundError' });
    await expect(make(new Map()).uc.execute({ entityId: 'light.den', range: '30d' })).rejects.toMatchObject({ name: 'ValidationError' });
  });

  it('covers, locks and media players draw their active states as intervals', async () => {
    const cover = await make(new Map([['cover.garage_door', [{ t: NOW - 900e3, v: 'closed' }, { t: NOW - 600e3, v: 'open' }]]])).uc.execute({ entityId: 'cover.garage_door', range: '24h' });
    expect(cover).toMatchObject({ kind: 'state', intervals: [{ from: NOW - 600e3, to: NOW }] });
    const lock = await make(new Map([['lock.side_gate', [{ t: NOW - 600e3, v: 'unlocked' }, { t: NOW - 300e3, v: 'locked' }]]])).uc.execute({ entityId: 'lock.side_gate', range: '24h' });
    expect(lock.intervals).toEqual([{ from: NOW - 600e3, to: NOW - 300e3 }]);
    const tv = await make(new Map([['media_player.den_tv', [{ t: NOW - 600e3, v: 'playing' }]]])).uc.execute({ entityId: 'media_player.den_tv', range: '24h' });
    expect(tv.intervals).toEqual([{ from: NOW - 600e3, to: NOW }]);
  });

  it('says whether the entity had any history at all', async () => {
    const empty = await make(new Map()).uc.execute({ entityId: 'light.den', range: '24h' });
    expect(empty).toMatchObject({ kind: 'state', hasData: false, intervals: [] });
    const full = await make(new Map([['light.den', [{ t: NOW - 600e3, v: 'off' }]]])).uc.execute({ entityId: 'light.den', range: '24h' });
    expect(full.hasData).toBe(true);
    const door = await make(new Map()).uc.execute({ entityId: 'binary_sensor.porch_visitor', range: '24h' });
    expect(door).toMatchObject({ kind: 'events', hasData: false, marks: [] });
  });

  it('with no history, a reading-class entity is still a line and an on/off one is state', async () => {
    expect((await make(new Map()).uc.execute({ entityId: 'sensor.den_temperature', range: '24h' })).kind).toBe('line');
    expect((await make(new Map()).uc.execute({ entityId: 'cover.garage_door', range: '24h' })).kind).toBe('state');
  });

  it('line buckets sit on the window grid, not the unaligned clock', async () => {
    const out = await make(new Map([['sensor.den_temperature', [{ t: NOW - 3600e3, v: 70 }]]])).uc.execute({ entityId: 'sensor.den_temperature', range: '24h' });
    const start = Date.parse('2026-10-27T18:00:00Z');
    expect(out.points[0].t).toBe(start);
    expect(out.points[1].t - out.points[0].t).toBe(300e3);
    expect(out.points.at(-1).t).toBe(start + 24 * 3600e3 - 300e3);
  });

  it('a missing entityId is invalid input', async () => {
    await expect(make(new Map()).uc.execute({ range: '24h' })).rejects.toMatchObject({ name: 'ValidationError' });
  });

  it('a malformed timeline or entities section is a configuration error', async () => {
    await expect(make(new Map(), { entities: {}, timeline: { lanes: 'nope' } }).uc.execute({ entityId: 'light.den', range: '24h' }))
      .rejects.toMatchObject({ name: 'ConfigurationError' });
    await expect(make(new Map(), { entities: { exclude: 'switch.*' }, timeline: {} }).uc.execute({ entityId: 'light.den', range: '24h' }))
      .rejects.toMatchObject({ name: 'ConfigurationError', key: 'entities.exclude' });
  });

  it('hasData is about the window: only points after it, or unavailable throughout, is no data', async () => {
    const after = await make(new Map([['light.den', [{ t: NOW + 60e3, v: 'on' }]]])).uc.execute({ entityId: 'light.den', range: '24h' });
    expect(after.hasData).toBe(false);
    const dark = await make(new Map([['light.den', [{ t: NOW - 30 * 3600e3, v: null }, { t: NOW - 600e3, v: null }]]])).uc.execute({ entityId: 'light.den', range: '24h' });
    expect(dark.hasData).toBe(false);
    const carried = await make(new Map([['light.den', [{ t: NOW - 30 * 3600e3, v: 'off' }]]])).uc.execute({ entityId: 'light.den', range: '24h' });
    expect(carried).toMatchObject({ hasData: true, intervals: [] });
  });

  it('a lane entity is readable even when the entities section is malformed', async () => {
    const config = { entities: { exclude: 'switch.*' }, timeline: { lanes: [{ id: 'door', kind: 'events', entity: 'binary_sensor.porch_visitor', camera: 'porch-cam' }] } };
    const door = await make(new Map([['binary_sensor.porch_visitor', [{ t: NOW - 600e3, v: 'off' }]]]), config).uc.execute({ entityId: 'binary_sensor.porch_visitor', range: '24h' });
    expect(door).toMatchObject({ kind: 'events', hasData: true });
    await expect(make(new Map(), config).uc.execute({ entityId: 'light.den', range: '24h' }))
      .rejects.toMatchObject({ name: 'ConfigurationError', key: 'entities.exclude' });
  });

  it('runs without an injected logger and never falls back to the console', async () => {
    const spies = ['debug', 'info', 'warn', 'log'].map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const uc = new GetEntityHistory({
      configRepository: { load: async () => ({ entities: {}, timeline: {} }) },
      entityGateway: { listReadings: async () => readings, listRooms: async () => ({ rooms: [], assignments: {} }) },
      historyGateway: { readHistory: async () => new Map() }, clock: () => NOW,
    });
    await expect(uc.execute({ entityId: 'light.den', range: '24h' })).resolves.toMatchObject({ hasData: false });
    for (const spy of spies) { expect(spy).not.toHaveBeenCalled(); spy.mockRestore(); }
  });
});
