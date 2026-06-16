import { normalizeAmbientZones, startAmbientZones } from '../../../backend/src/3_applications/home-automation/ambientZones.mjs';

describe('normalizeAmbientZones', () => {
  it('passes through a zones list', () => {
    const cfg = { zones: [
      { topic: 'ambient', entities: ['sensor.k1', 'sensor.k2'] },
      { topic: 'ambient:office', entities: ['sensor.o1'] },
    ] };
    expect(normalizeAmbientZones(cfg)).toEqual([
      { topic: 'ambient', entities: ['sensor.k1', 'sensor.k2'] },
      { topic: 'ambient:office', entities: ['sensor.o1'] },
    ]);
  });

  it('normalizes a legacy illuminance block to one default zone', () => {
    const cfg = { illuminance: { entities: ['sensor.k1', 'sensor.k2'] } };
    expect(normalizeAmbientZones(cfg)).toEqual([
      { topic: 'ambient', entities: ['sensor.k1', 'sensor.k2'] },
    ]);
  });

  it('honors a legacy illuminance.topic', () => {
    const cfg = { illuminance: { topic: 'lux', entities: ['sensor.k1'] } };
    expect(normalizeAmbientZones(cfg)).toEqual([{ topic: 'lux', entities: ['sensor.k1'] }]);
  });

  it('drops zones missing a topic or with no entities', () => {
    const cfg = { zones: [
      { topic: '', entities: ['sensor.x'] },
      { topic: 'ok', entities: [] },
      { entities: ['sensor.y'] },
      { topic: 'good', entities: ['sensor.z', 7, ''] },
    ] };
    expect(normalizeAmbientZones(cfg)).toEqual([{ topic: 'good', entities: ['sensor.z'] }]);
  });

  it('returns [] for empty/absent config', () => {
    expect(normalizeAmbientZones(undefined)).toEqual([]);
    expect(normalizeAmbientZones({})).toEqual([]);
    expect(normalizeAmbientZones({ illuminance: { entities: [] } })).toEqual([]);
  });
});

describe('startAmbientZones', () => {
  const haGateway = { getConnection: () => ({ baseUrl: 'http://ha:8123', token: 'T' }) };
  const eventBus = { broadcast: () => {} };
  const logger = { info: () => {}, warn: () => {} };

  it('starts one service per zone with that zone config', () => {
    const calls = [];
    const createService = (opts) => {
      calls.push(opts);
      return { start: () => { opts.__started = true; } };
    };
    const zones = [
      { topic: 'ambient', entities: ['sensor.k1'] },
      { topic: 'ambient:office', entities: ['sensor.o1'] },
    ];
    const started = startAmbientZones({ zones, haGateway, eventBus, logger, createService });
    expect(started).toHaveLength(2);
    expect(calls.map((c) => c.config)).toEqual([
      { entities: ['sensor.k1'], topic: 'ambient' },
      { entities: ['sensor.o1'], topic: 'ambient:office' },
    ]);
    expect(calls.every((c) => c.__started)).toBe(true);
  });

  it('starts nothing when the HA gateway cannot connect', () => {
    const createService = () => { throw new Error('should not be called'); };
    const started = startAmbientZones({
      zones: [{ topic: 'ambient', entities: ['sensor.k1'] }],
      haGateway: {}, eventBus, logger, createService,
    });
    expect(started).toEqual([]);
  });

  it('starts nothing for an empty zone list', () => {
    const started = startAmbientZones({ zones: [], haGateway, eventBus, logger, createService: () => ({ start() {} }) });
    expect(started).toEqual([]);
  });
});
