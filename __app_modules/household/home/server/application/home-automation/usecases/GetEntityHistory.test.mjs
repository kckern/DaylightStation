import { describe, it, expect, vi } from 'vitest';
import { GetEntityHistory } from './GetEntityHistory.mjs';

const NOW = Date.parse('2026-10-28T18:00:30Z');
const readings = [
  { entityId: 'sensor.den_temperature', state: '70', deviceClass: 'temperature', unit: '°F', name: 'Den', lastChanged: null, detail: {} },
  { entityId: 'light.den', state: 'on', deviceClass: null, unit: null, name: 'Den lamp', lastChanged: null, detail: {} },
  { entityId: 'sensor.plug_voltage', state: '120', deviceClass: 'voltage', unit: 'V', name: null, lastChanged: null, detail: {} },
];
const make = (history) => {
  const historyGateway = { readHistory: vi.fn().mockResolvedValue(history) };
  const uc = new GetEntityHistory({
    configRepository: { load: async () => ({ entities: {}, timeline: { lanes: [{ id: 'door', kind: 'events', entity: 'binary_sensor.porch_visitor', camera: 'porch-cam' }] } }) },
    entityGateway: { listReadings: async () => readings, listRooms: async () => ({ rooms: [], assignments: {} }) },
    historyGateway, clock: () => NOW, logger: { debug: vi.fn() },
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
  it('an entity the dashboard does not show is not found; a bad range is invalid', async () => {
    await expect(make(new Map()).uc.execute({ entityId: 'sensor.plug_voltage', range: '24h' })).rejects.toMatchObject({ name: 'NotFoundError' });
    await expect(make(new Map()).uc.execute({ entityId: 'light.den', range: '30d' })).rejects.toMatchObject({ name: 'ValidationError' });
  });
});
